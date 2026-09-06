// Diagnostic-only SketchV4 probe (flow-layout-probe skill). Verifies port/attachment
// visual-grammar hypotheses over the real METRIC_FIXTURES set:
//   (1) illegal local attachment endpoints per fixture (engine-exposed sketchV4Summary +
//       sketchV4IllegalAttachmentRecords),
//   (2) top-port jam: >=2 distinct edges landing on the SAME target port point,
//   (3) merge side-entry / merge-top drops whose vertical passes through the target box
//       footprint (probe-local descriptive check over production route points),
//   (4) branch-label anchor distance from the source diamond (production
//       labelPointForPolyline), worst offenders per routeFamily.
// Never edits src/. Writes port_attachment_grammar_probe.json beside this file.
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(here, "..");
const BACKEND_DIR = path.join(FRONTEND, "..");
const BACKEND_URL = process.env.URM_BACKEND_URL ?? "http://127.0.0.1:8000";
const r = (n) => (Number.isFinite(n) ? Math.round(n) : n);

const fixtures = JSON.parse(execFileSync("python3",
  ["-c", "import json,fixture_kinds; print(json.dumps([{'label':f['label'],'spec':f['spec']} for f in fixture_kinds.METRIC_FIXTURES]))"],
  { cwd: BACKEND_DIR }).toString());

async function compile(spec) {
  const res = await fetch(`${BACKEND_URL}/compile-function`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
  });
  const j = await res.json();
  return j.program ?? null;
}

const server = await createServer({ root: FRONTEND, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { buildLayout } = await server.ssrLoadModule("/src/layout/sketchv4/pipeline.js");
  const sv3mod = await server.ssrLoadModule("/src/components/BetaFlowDiagram.jsx");
  const { labelPointForPolyline, buildDiagramModel } = sv3mod;

  // program-independent layout constants from one tiny SketchV3 build (same harvest as
  // _v4_grammar_audit.mjs)
  const tinyProgram = await compile({ kind: "predecessor" }) ?? [["S", 1], ["J", 1, 0, 5], ["S", 2], ["J", 0, 0, 1], ["T", 2, 0]];
  const ow = console.warn; console.warn = () => {};
  const tiny = buildDiagramModel(tinyProgram, "predecessor", { layoutMode: "sketchV3" });
  console.warn = ow;
  const ld = tiny.layout;
  const sizeForKind = (kind) =>
    kind === "start" || kind === "halt" ? [ld.terminalWidth, ld.terminalHeight]
      : kind === "conditionalJump" ? [ld.diamondWidth, ld.diamondHeight]
        : kind === "unconditionalJump" ? [ld.unconditionalNodeWidth, ld.unconditionalNodeHeight]
          : [ld.actionNodeWidth, ld.actionNodeHeight];
  const visual = {
    sizeForKind,
    branchAngleTan: Math.tan(Math.max(0.2, ((ld.branchAngleDeg ?? 30) * Math.PI) / 180)),
    pitch: { setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126 },
    terminalSize: [ld.terminalWidth, ld.terminalHeight],
    haltBandOffset: 154,
    clearance: 16,
  };

  const out = { meta: { date: new Date().toISOString().slice(0, 10), engine: "sketchV4 buildLayout v4Assigned" }, fixtures: {} };

  for (const f of fixtures) {
    let program;
    try { program = await compile(f.spec); } catch (e) { out.fixtures[f.label] = { compileError: String(e) }; continue; }
    if (!Array.isArray(program)) { out.fixtures[f.label] = { compileError: "no program" }; continue; }
    let L;
    try {
      L = buildLayout(program, { programName: f.label, orientationSource: "v4Assigned", visual, diagnostics: true });
    } catch (e) { out.fixtures[f.label] = { layoutError: String(e?.message ?? e) }; continue; }

    const S = L.diagnostics.sketchV4Summary;
    const routes = L.routed.routes;
    const boxes = L.boxes;

    // ---- (2) target/source port jams: >=2 edges at the same port point ----
    const jam = (endpoint) => {
      const groups = new Map();
      for (const e of routes) {
        const p = endpoint === "target" ? e.targetPort : e.sourcePort;
        const nodeId = endpoint === "target" ? e.target : e.source;
        if (!Array.isArray(p)) continue;
        const key = `${nodeId}@${r(p[0])},${r(p[1])}`;
        (groups.get(key) ?? groups.set(key, []).get(key)).push({ edgeId: e.edgeId, routeFamily: e.routeFamily });
      }
      return [...groups.entries()].filter(([, v]) => v.length >= 2).map(([key, v]) => ({ portKey: key, edges: v }));
    };
    const targetPortJams = jam("target");
    const sourcePortJams = jam("source");

    // ---- (3) merge routes passing through the target box INTERIOR (geometric, probe-local) ----
    // Authoritative clip test: clip every route segment against the target box interior
    // (shrunk 0.5px so boundary/port contact does not count) and record any intersection
    // longer than 1px. The old source-column proxy is kept as dropColumnInsideFootprint.
    const segBoxInteriorLen = (p, q, b) => {
      const L = b.left + 0.5, R = b.right - 0.5, T = b.top + 0.5, B = b.bottom - 0.5;
      const dx = q[0] - p[0], dy = q[1] - p[1];
      let t0 = 0, t1 = 1;
      for (const [num, den] of [[L - p[0], dx], [p[0] - R, -dx], [T - p[1], dy], [p[1] - B, -dy]]) {
        if (Math.abs(den) < 1e-9) { if (num > 0) return 0; continue; }
        const t = num / den;
        if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        if (t0 > t1) return 0;
      }
      return Math.hypot(dx, dy) * Math.max(0, t1 - t0);
    };
    const mergeRoutes = [];
    const mergeBoxClips = [];
    for (const e of routes) {
      if (e.routeFamily !== "merge-connector") continue;
      const tb = boxes.get(e.target);
      if (!tb) continue;
      let interiorLen = 0;
      for (let i = 1; i < e.points.length; i++) interiorLen += segBoxInteriorLen(e.points[i - 1], e.points[i], tb);
      const sx = e.sourcePort?.[0];
      const dropColumnInsideFootprint = sx > tb.left + 0.5 && sx < tb.right - 0.5 && Math.abs(sx - tb.cx) > 1;
      const rec = {
        edgeId: e.edgeId, portPolicyCase: e.portPolicyCase, connectorKind: e.connectorKind, target: e.target,
        points: e.points.map((p) => [r(p[0]), r(p[1])]),
        sourceDropX: r(sx), targetBox: { left: r(tb.left), right: r(tb.right), cx: r(tb.cx), top: r(tb.top) },
        interiorClipLen: r(interiorLen), dropColumnInsideFootprint,
        penetrationSx: dropColumnInsideFootprint ? r(Math.min(sx - tb.left, tb.right - sx)) : 0,
      };
      mergeRoutes.push(rec);
      if (interiorLen > 1) mergeBoxClips.push(rec);
    }

    // ---- byte-identity capture: placements + non-merge route polylines (hashed) ----
    const stable = (x) => JSON.stringify(x);
    const djb2 = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); };
    const placementBlob = stable([...L.skeleton.placements].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([id, p]) => [id, r(p.cx * 100) / 100, r(p.cy * 100) / 100])
      .concat([["halt", r(boxes.get("halt").cx * 100) / 100, r(boxes.get("halt").cy * 100) / 100]]));
    const nonMergeBlob = stable(routes.filter((e) => e.routeFamily !== "merge-connector")
      .sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1))
      .map((e) => [e.edgeId, e.points.map((p) => [r(p[0] * 100) / 100, r(p[1] * 100) / 100])]));
    const placementHash = djb2(placementBlob);
    const nonMergeRouteHash = djb2(nonMergeBlob);
    const flips = [...L.orientationMap].filter(([, o]) => o?.no === "right").map(([f]) => f).sort().join(",");

    // ---- (4) branch-label anchor distance from the source diamond ----
    const labelRows = [];
    for (const e of routes) {
      const branch = e.edgeId.endsWith("-yes") ? "yes" : e.edgeId.endsWith("-no") ? "no" : null;
      if (!branch) continue;
      const lab = labelPointForPolyline(e.points, { offset: 12 });
      const sb = boxes.get(e.source);
      if (!sb || !Array.isArray(lab)) continue;
      const d = Math.hypot(lab[0] - sb.cx, lab[1] - sb.cy);
      labelRows.push({ edgeId: e.edgeId, routeFamily: e.routeFamily, branch, labelDistFromDiamond: r(d), pointCount: e.points.length });
    }
    labelRows.sort((a, b) => b.labelDistFromDiamond - a.labelDistFromDiamond);

    out.fixtures[f.label] = {
      totalDefects: S.totalDefectCount, crossings: S.crossingCount, nodeOverlaps: S.nodeOverlapCount,
      illegalAttachmentEdges: S.illegalLocalAttachmentEdgeCount,
      illegalAttachmentEndpoints: S.illegalLocalAttachmentEndpointCount,
      illegalAttachmentDetail: L.diagnostics.sketchV4IllegalAttachmentRecords.map((x) => ({
        edgeId: x.edgeId, routeFamily: x.routeFamily,
        source: x.sourceAttachmentLegal ? null : { port: x.sourcePort, dir: x.sourceIncidentDirection, reason: x.sourceIllegalReason },
        target: x.targetAttachmentLegal ? null : { port: x.targetPort, dir: x.targetIncidentDirection, reason: x.targetIllegalReason },
      })),
      changedPortCount: S.changedPortCount,
      targetPortJams, sourcePortJamCount: sourcePortJams.length,
      mergeBoxClips, mergeRoutes,
      placementHash, nonMergeRouteHash, flips,
      labelTop3: labelRows.slice(0, 3),
      renderBounds: [S.renderBounds?.width, S.renderBounds?.height],
    };
    console.log(`${f.label.padEnd(26)} defects=${S.totalDefectCount} illegalAtt=${S.illegalLocalAttachmentEndpointCount} tgtJams=${targetPortJams.length} mergeClips=${mergeBoxClips.length} maxLabelDist=${labelRows[0]?.labelDistFromDiamond ?? "-"}`);
  }

  fs.writeFileSync(path.join(here, "port_attachment_grammar_probe.json"), JSON.stringify(out, null, 1));
  console.log("\nwrote port_attachment_grammar_probe.json");
} finally {
  await server.close();
}

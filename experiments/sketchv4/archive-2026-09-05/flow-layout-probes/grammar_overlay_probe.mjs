// Diagnostic-only SketchV4 grammar-overlay renderer (flow-layout-probe skill).
//
// Renders the PRODUCTION V4 layout (buildLayout, v4Assigned, diagnostics on) for the key
// fixtures as SVG, then appends toggleable overlay layers that expose the current grammar
// state for adjudicating VISUAL_GRAMMAR.md Q1–Q3:
//   ov-regions  : HALT band, shared halt corridor column, loop-lane strips (production data)
//   ov-ancestry : node tint by owning real-fork (ownership.ownerOf)
//   ov-anchors  : branch-label anchor markers + leader to the edge's source port
//                 (production labelPointForPolyline; red when drift > 140px)
//   ov-ports    : port-occupancy badges (>=2 endpoints at one port point = jam, orange)
//   ov-illegal  : red rings at stub-illegal endpoints (sketchV4AttachmentRecords)
//   ov-roles    : per-edge role text (hidden by default)
//
// Non-mutating: writes ONLY under .flow-layout-probes/overlays/ + its own JSON. The base
// SVG body is written separately and the overlay file is asserted to be base + appended
// <g> layers (structural proof that overlays change nothing underneath). Production
// geometry is additionally hash-compared against port_attachment_grammar_probe.json.
//
//   node .flow-layout-probes/grammar_overlay_probe.mjs
import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(here, "..");
const BACKEND_DIR = path.join(FRONTEND, "..");
const BACKEND_URL = process.env.URM_BACKEND_URL ?? "http://127.0.0.1:8000";
const OUT = path.join(here, "overlays");
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = ["predecessor", "bounded_sub", "characteristic:leq", "characteristic:lt",
  "characteristic:eq", "characteristic:divides", "divisor_count", "subst:diagonal_divides"];

const r = (n) => (Number.isFinite(n) ? Math.round(n) : n);
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" }[c]));
const FAMILY_COLOR = { "branch-exit": "#1f2937", "loop-return": "#2563eb", halt: "#dc2626", "merge-connector": "#16a34a", spine: "#9ca3af", setup: "#9ca3af", entry: "#9ca3af" };

const fixtures = JSON.parse(execFileSync("python3",
  ["-c", "import json,fixture_kinds; print(json.dumps([{'label':f['label'],'spec':f['spec']} for f in fixture_kinds.METRIC_FIXTURES]))"],
  { cwd: BACKEND_DIR }).toString());
const specByLabel = new Map(fixtures.map((f) => [f.label, f.spec]));

async function compile(spec) {
  const res = await fetch(`${BACKEND_URL}/compile-function`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
  });
  return (await res.json()).program ?? null;
}

// same hash code as port_attachment_grammar_probe.mjs so geometry can be cross-checked
const stable = (x) => JSON.stringify(x);
const djb2 = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); };

// probe-local: interior clip length of a segment vs a box (same as C3 acceptance metric)
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

const server = await createServer({ root: FRONTEND, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { buildLayout } = await server.ssrLoadModule("/src/layout/sketchv4/pipeline.js");
  const sv3mod = await server.ssrLoadModule("/src/components/BetaFlowDiagram.jsx");
  const { labelPointForPolyline, buildDiagramModel } = sv3mod;

  // layout dim constants harvested once from a tiny SketchV3 build (program-independent)
  const tinyProgram = await compile(specByLabel.get("predecessor"));
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

  // reference geometry hashes from the C3-acceptance probe (cross-check, optional)
  let refGeom = null;
  const refPath = path.join(here, "port_attachment_grammar_probe.json");
  if (fs.existsSync(refPath)) refGeom = JSON.parse(fs.readFileSync(refPath, "utf8")).fixtures;

  const out = { meta: { date: new Date().toISOString().slice(0, 10), engine: "sketchV4 buildLayout v4Assigned", outDir: path.relative(FRONTEND, OUT) }, fixtures: {} };
  const htmlBlocks = [];

  for (const label of TARGETS) {
    const spec = specByLabel.get(label);
    const program = await compile(spec);
    if (!Array.isArray(program)) { out.fixtures[label] = { error: "compile failed" }; continue; }
    const L = buildLayout(program, { programName: label, orientationSource: "v4Assigned", visual, diagnostics: true });
    const D = L.diagnostics;
    const missingData = [];
    if (!D) { out.fixtures[label] = { error: "diagnostics unavailable" }; continue; }

    const boxes = L.boxes;
    const routes = L.routed.routes;
    const rb = L.renderBounds;
    const PAD = 30;
    const vb = `${r(rb.minX - PAD)} ${r(rb.minY - PAD)} ${r(rb.width + 2 * PAD)} ${r(rb.height + 2 * PAD)}`;
    const instrText = (idx) => { const ins = program[idx]; return Array.isArray(ins) ? `${idx}:${ins[0]}(${ins.slice(1).join(",")})` : `i-${idx}`; };

    // ---------- base layer (mirrors production rendering inputs: geometry + label anchors) ----------
    let base = "";
    for (const e of routes) {
      const pts = e.points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ");
      base += `<polyline points="${pts}" fill="none" stroke="${FAMILY_COLOR[e.routeFamily] ?? "#444"}" stroke-width="1.4" marker-end="url(#arr)"/>`;
    }
    const branchAnchors = [];
    for (const e of routes) {
      const branch = e.edgeId.endsWith("-yes") ? "yes" : e.edgeId.endsWith("-no") ? "no" : null;
      if (!branch) continue;
      const [lx, ly] = labelPointForPolyline(e.points, { offset: 12 });
      const sb = boxes.get(e.source);
      const dist = sb ? Math.hypot(lx - sb.cx, ly - sb.cy) : null;
      branchAnchors.push({ edgeId: e.edgeId, routeFamily: e.routeFamily, branch, x: lx, y: ly, dist: dist == null ? null : r(dist), sourcePort: e.sourcePort });
      base += `<text x="${r2(lx)}" y="${r2(ly - 3)}" font-size="9" fill="#6b7280" text-anchor="middle">${branch}</text>`;
    }
    for (const [id, b] of boxes) {
      const kind = id === "halt" ? "halt" : L.cfg.nodeById.get(id)?.kind;
      const labelTxt = id === "start" ? "START" : id === "halt" ? "HALT" : instrText(L.cfg.nodeById.get(id).instructionIndex);
      if (kind === "conditionalJump") base += `<polygon points="${r2(b.cx)},${r2(b.top)} ${r2(b.right)},${r2(b.cy)} ${r2(b.cx)},${r2(b.bottom)} ${r2(b.left)},${r2(b.cy)}" fill="#fff" stroke="#111827" stroke-width="1.2"/>`;
      else if (kind === "start" || kind === "halt") base += `<rect x="${r2(b.left)}" y="${r2(b.top)}" width="${r2(b.right - b.left)}" height="${r2(b.bottom - b.top)}" rx="${r2((b.bottom - b.top) / 2)}" fill="#f3f4f6" stroke="#111827" stroke-width="1.2"/>`;
      else base += `<rect x="${r2(b.left)}" y="${r2(b.top)}" width="${r2(b.right - b.left)}" height="${r2(b.bottom - b.top)}" fill="#fff" stroke="#111827" stroke-width="1"/>`;
      base += `<text x="${r2(b.cx)}" y="${r2(b.cy + 3)}" font-size="9" fill="#111827" text-anchor="middle">${esc(labelTxt)}</text>`;
    }

    // ---------- overlay: regions (HALT band, corridor, lane strips) ----------
    let ovRegions = "";
    if (L.halt?.haltBox && Number.isFinite(L.halt.haltBandOffset)) {
      const bandInnerX = L.halt.haltX - L.halt.haltBandOffset;
      ovRegions += `<rect x="${r2(bandInnerX)}" y="${r(rb.minY)}" width="${r2(L.halt.haltBox.left - bandInnerX)}" height="${r(rb.height)}" fill="#dc2626" opacity="0.06"><title>HALT reserved band</title></rect>`;
      const corridors = new Set();
      for (const p of L.ports?.values?.() ?? []) if (p.role === "halt-exit" && Number.isFinite(p.corridorX)) corridors.add(r(p.corridorX));
      for (const cx of corridors) ovRegions += `<rect x="${cx - 4}" y="${r(rb.minY)}" width="8" height="${r(rb.height)}" fill="#dc2626" opacity="0.10"><title>shared HALT corridor x=${cx}</title></rect>`;
    } else missingData.push("halt band geometry");
    if (L.lanes?.laneRecords?.length) {
      for (const l of L.lanes.laneRecords) {
        const sb = boxes.get(l.source), tb = boxes.get(l.target);
        if (!sb || !tb) continue;
        const y0 = Math.min(sb.cy, tb.cy) - 10, y1 = Math.max(sb.cy, tb.cy) + 10;
        ovRegions += `<rect x="${l.railCoord - 4}" y="${r2(y0)}" width="8" height="${r2(y1 - y0)}" fill="#2563eb" opacity="0.10"><title>${esc(l.laneBundleId)} lane ${l.laneIndex} (${esc(l.edgeId)})</title></rect>`;
      }
    }

    // ---------- overlay: branch ancestry tint by owning real-fork ----------
    let ovAncestry = "";
    const forkHue = new Map(L.roles.realForkIds.map((f, i) => [f, r((i * 137.5) % 360)]));
    let untintable = 0;
    for (const [id, b] of boxes) {
      if (id === "halt" || id === "start") continue;
      const owner = L.ownership.ownerOf(id);
      if (!owner) continue;
      const hue = forkHue.get(owner.fork);
      if (hue == null) { untintable++; continue; }
      ovAncestry += `<rect x="${r2(b.left)}" y="${r2(b.top)}" width="${r2(b.right - b.left)}" height="${r2(b.bottom - b.top)}" fill="hsl(${hue},70%,50%)" opacity="0.16"><title>owner ${esc(owner.fork)} / ${esc(owner.side)}</title></rect>`;
    }

    // ---------- overlay: branch-label anchor markers + leader lines ----------
    let ovAnchors = "";
    for (const a of branchAnchors) {
      const drift = a.dist != null && a.dist > 140;
      const c = drift ? "#dc2626" : "#c026d3";
      if (Array.isArray(a.sourcePort)) ovAnchors += `<line x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(a.sourcePort[0])}" y2="${r2(a.sourcePort[1])}" stroke="${c}" stroke-width="0.7" stroke-dasharray="3,3" opacity="0.6"/>`;
      ovAnchors += `<g stroke="${c}" stroke-width="1.4"><line x1="${r2(a.x - 4)}" y1="${r2(a.y)}" x2="${r2(a.x + 4)}" y2="${r2(a.y)}"/><line x1="${r2(a.x)}" y1="${r2(a.y - 4)}" x2="${r2(a.x)}" y2="${r2(a.y + 4)}"/><title>${esc(a.edgeId)} "${a.branch}" anchor, ${a.dist}px from diamond (${esc(a.routeFamily)})</title></g>`;
    }

    // ---------- overlay: port occupancy / jams ----------
    let ovPorts = "";
    const occupancy = new Map();
    for (const e of routes) {
      for (const [nodeId, p] of [[e.source, e.sourcePort], [e.target, e.targetPort]]) {
        if (!Array.isArray(p)) continue;
        const key = `${nodeId}|${r(p[0])},${r(p[1])}`;
        (occupancy.get(key) ?? occupancy.set(key, { x: p[0], y: p[1], edges: [] }).get(key)).edges.push(e.edgeId);
      }
    }
    let jamCount = 0;
    for (const [key, o] of occupancy) {
      const n = new Set(o.edges).size;
      if (n >= 2) {
        jamCount++;
        ovPorts += `<g><circle cx="${r2(o.x)}" cy="${r2(o.y)}" r="8" fill="#f97316" opacity="0.85"/><text x="${r2(o.x)}" y="${r2(o.y + 3)}" font-size="9" font-weight="bold" fill="#fff" text-anchor="middle">${n}</text><title>${esc(key)}: ${esc(o.edges.join(", "))}</title></g>`;
      } else {
        ovPorts += `<circle cx="${r2(o.x)}" cy="${r2(o.y)}" r="1.5" fill="#9ca3af" opacity="0.7"/>`;
      }
    }

    // ---------- overlay: illegal attachment endpoints (engine-exposed stub diagnostics) ----------
    let ovIllegal = "";
    const reasonHist = {};
    let illegalEndpoints = 0;
    for (const rec of D.sketchV4AttachmentRecords ?? []) {
      for (const end of ["source", "target"]) {
        const legal = end === "source" ? rec.sourceAttachmentLegal : rec.targetAttachmentLegal;
        if (legal) continue;
        illegalEndpoints++;
        const pt = end === "source" ? rec.sourcePortPoint : rec.targetPortPoint;
        const dir = end === "source" ? rec.sourceIncidentDirection : rec.targetIncidentDirection;
        const reason = end === "source" ? rec.sourceIllegalReason : rec.targetIllegalReason;
        const kind = `${rec.routeFamily}|${end}|${dir}`;
        reasonHist[kind] = (reasonHist[kind] ?? 0) + 1;
        if (!Array.isArray(pt)) { missingData.push(`illegal endpoint without portPoint: ${rec.edgeId}/${end}`); continue; }
        ovIllegal += `<g><circle cx="${pt[0]}" cy="${pt[1]}" r="6" fill="none" stroke="#dc2626" stroke-width="1.6"/><text x="${pt[0] + 8}" y="${pt[1] - 6}" font-size="7" fill="#dc2626">${esc(dir)}</text><title>${esc(rec.edgeId)} ${end}: ${esc(reason ?? "")}</title></g>`;
      }
    }
    if (!(D.sketchV4AttachmentRecords ?? []).length) missingData.push("sketchV4AttachmentRecords");

    // ---------- overlay: edge role text (hidden by default) ----------
    let ovRoles = "";
    for (const e of routes) {
      const mid = e.points[Math.floor(e.points.length / 2)];
      if (!Array.isArray(mid)) continue;
      ovRoles += `<text x="${r2(mid[0] + 3)}" y="${r2(mid[1] - 2)}" font-size="7" fill="#374151" opacity="0.8">${esc(e.edgeRole)}</text>`;
    }

    // ---------- probe-local summary metrics ----------
    let mergeClips = 0;
    for (const e of routes) {
      if (e.routeFamily !== "merge-connector") continue;
      const tb = boxes.get(e.target);
      if (!tb) continue;
      let len = 0;
      for (let i = 1; i < e.points.length; i++) len += segBoxInteriorLen(e.points[i - 1], e.points[i], tb);
      if (len > 1) mergeClips++;
    }
    const labelDists = branchAnchors.map((a) => a.dist).filter((d) => d != null).sort((a, b) => b - a);

    // geometry cross-check vs the C3-acceptance probe (same hash code)
    const placementBlob = stable([...L.skeleton.placements].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([id, p]) => [id, r(p.cx * 100) / 100, r(p.cy * 100) / 100])
      .concat([["halt", r(boxes.get("halt").cx * 100) / 100, r(boxes.get("halt").cy * 100) / 100]]));
    const placementHash = djb2(placementBlob);
    const refHash = refGeom?.[label]?.placementHash ?? null;
    const geometryMatchesC3Probe = refHash == null ? null : refHash === placementHash;

    // ---------- assemble SVG: base file + overlay file (base + appended <g> layers) ----------
    const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="background:#fff"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#374151"/></marker></defs>`;
    const baseSvg = `${head}${base}</svg>`;
    const overlayGroups =
      `<g class="ov-regions">${ovRegions}</g>` +
      `<g class="ov-ancestry">${ovAncestry}</g>` +
      `<g class="ov-anchors">${ovAnchors}</g>` +
      `<g class="ov-ports">${ovPorts}</g>` +
      `<g class="ov-illegal">${ovIllegal}</g>` +
      `<g class="ov-roles" style="display:none">${ovRoles}</g>`;
    const overlaySvg = `${head}${base}${overlayGroups}</svg>`;
    const fileStem = label.replace(/[^a-z0-9_]+/gi, "_");
    fs.writeFileSync(path.join(OUT, `${fileStem}_base.svg`), baseSvg);
    fs.writeFileSync(path.join(OUT, `${fileStem}_overlay.svg`), overlaySvg);
    const overlayIsBasePlusLayers = overlaySvg === baseSvg.slice(0, -6) + overlayGroups + "</svg>";

    out.fixtures[label] = {
      defectsTotal: L.defects.total,
      illegalAttachmentEndpoints: illegalEndpoints,
      illegalReasonHistogram: reasonHist,
      portJamCount: jamCount,
      mergeBoxClips: mergeClips,
      labelMaxDist: labelDists[0] ?? null,
      labelDriftedOver140: labelDists.filter((d) => d > 140).length,
      branchLabelCount: branchAnchors.length,
      ancestryUntintableNodes: untintable,
      overlayIsBasePlusLayers,
      geometryMatchesC3Probe,
      missingData,
      files: [`${fileStem}_base.svg`, `${fileStem}_overlay.svg`],
    };
    htmlBlocks.push({ label, fileStem, svg: overlaySvg, summary: out.fixtures[label] });
    console.log(`${label.padEnd(26)} defects=${L.defects.total} illegal=${illegalEndpoints} jams=${jamCount} clips=${mergeClips} maxLabel=${labelDists[0] ?? "-"} basePlusLayers=${overlayIsBasePlusLayers} geomMatchesC3=${geometryMatchesC3Probe}`);
  }

  // ---------- index.html with per-layer toggles (inline SVGs so CSS reaches the groups) ----------
  const layers = [["ov-regions", "HALT band / corridor / lanes"], ["ov-ancestry", "branch ancestry"], ["ov-anchors", "label anchors"], ["ov-ports", "port occupancy"], ["ov-illegal", "illegal attachments"], ["ov-roles", "edge roles"]];
  const controls = layers.map(([cls, name]) =>
    `<label style="margin-right:14px"><input type="checkbox" data-layer="${cls}" ${cls === "ov-roles" ? "" : "checked"}> ${name}</label>`).join("");
  const blocks = htmlBlocks.map((b) => {
    const s = b.summary;
    return `<h2 id="${b.fileStem}">${esc(b.label)}</h2>
<p style="font:12px monospace">defects=${s.defectsTotal} · illegal endpoints=${s.illegalAttachmentEndpoints} · port jams=${s.portJamCount} · mergeClips=${s.mergeBoxClips} · max label dist=${s.labelMaxDist}px (drifted&gt;140: ${s.labelDriftedOver140}/${s.branchLabelCount})</p>
<div style="max-width:1400px;overflow:auto;border:1px solid #d1d5db">${b.svg.replace("<svg ", '<svg width="1200" ')}</div>`;
  }).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>SketchV4 grammar overlays</title>
<body style="font-family:system-ui;margin:16px">
<h1>SketchV4 grammar overlays</h1>
<p>Production geometry (buildLayout, v4Assigned); overlays are appended diagnostic layers only. Toggle:</p>
<div style="position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #e5e7eb">${controls}</div>
<p>Fixtures: ${htmlBlocks.map((b) => `<a href="#${b.fileStem}">${esc(b.label)}</a>`).join(" · ")}</p>
${blocks}
<script>
document.querySelectorAll("input[data-layer]").forEach((cb) => {
  const apply = () => document.querySelectorAll("g." + cb.dataset.layer).forEach((g) => { g.style.display = cb.checked ? "" : "none"; });
  cb.addEventListener("change", apply); apply();
});
</script></body>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  fs.writeFileSync(path.join(here, "grammar_overlay_probe.json"), JSON.stringify(out, null, 1));
  console.log(`\nwrote ${path.relative(FRONTEND, OUT)}/index.html (+ per-fixture base/overlay SVGs) and grammar_overlay_probe.json`);
} finally {
  await server.close();
}

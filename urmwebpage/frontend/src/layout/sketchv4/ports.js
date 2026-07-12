// SketchV4 — Phase 4a explicit port selection (runs BEFORE route bodies in routing.js).
//
// Pure/deterministic. Replaces the per-role port choices routing.js used to make implicitly
// with ONE explicit pass. Only two policies have real rules here; every other role returns
// the role default (so geometry is byte-identical for untouched families/edges):
//
//   A. shared HALT corridor / landing — branch-to-HALT exits into the single shared terminal
//      sink no longer fan into independent far-right band lanes. They share ONE corridor
//      column (corridorX) and stack their landings on the sink in slot order. A single-exit
//      sink (or an already-clean one) keeps its landing untouched; only the per-slot band
//      spread is collapsed onto the shared trunk.
//   B. merge side-entry — a merge-connector whose target's top port is already occupied by
//      that node's column/branch predecessor (true for every merge target, which is placed by
//      an earlier entry/setup/spine/branch-exit edge landing on its top-centre) enters the
//      target from the SIDE face — but ONLY when the source actually sits to one side. Column-
//      aligned merges stay bottom -> top. A side-entry approach must reach the port from
//      strictly outside the target's x-extent plus clearance (R17 / VISUAL_GRAMMAR.md C3):
//      when the source's drop column lies inside that band, the record carries sideEntryJogX
//      (the outward column just beyond the box edge) and the route body jogs out before
//      descending. The footprint TEST lives here; the jog SHAPE lives in routing.js.
//
// selectPorts returns Map<edgeId, record>; each record carries the SELECTED ports plus the
// role DEFAULT ports + a `changed` flag (for diagnostics). routing.js consumes
// record.sourcePort / record.targetPort, record.corridorX (HALT) and record.portPolicyCase
// (to choose the body shape). No placement, no rails, no pathfinding here.

const getLeft = (b) => [b.left, b.cy];
const getRight = (b) => [b.right, b.cy];
const getTop = (b) => [b.cx, b.top];
const getBottom = (b) => [b.cx, b.bottom];
const samePt = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

function record(edge, role, sPort, tPort, portPolicyCase, defS, defT, extra) {
  const corridorChanged = extra && extra.corridorX != null && extra.defaultCorridorX != null
    && Math.abs(extra.corridorX - extra.defaultCorridorX) > 0.5;
  const changed = !samePt(sPort, defS) || !samePt(tPort, defT) || !!corridorChanged;
  return {
    edgeId: edge.id, source: edge.from, target: edge.to, role, portPolicyCase,
    sourcePort: sPort, targetPort: tPort, defaultSourcePort: defS, defaultTargetPort: defT,
    changed, ...(extra || {}),
  };
}

export function selectPorts(cfg, roles, skeleton, halt, options = {}) {
  const placements = skeleton.placements;
  const colTol = options.columnTolerance ?? 1; // matches routing's straight-merge test
  const clearance = options.clearance ?? 16;
  const boxOf = (id) => (id === "halt" ? halt.haltBox : placements.get(id)?.box);
  const armByEdge = new Map(skeleton.armSegments.map((a) => [a.edgeId, a]));
  const haltSlotBySource = new Map(halt.haltExitRecords.map((h) => [h.source, h.landingSlotOrder]));

  // ---- shared HALT corridor inputs (one shared terminal sink) ----
  const hb = halt.haltBox;
  const hh = hb ? hb.bottom - hb.top : 0;
  const nHalt = Math.max(1, halt.haltExitCount);
  const bandInnerX = halt.haltX - halt.haltBandOffset;          // inner edge of the reserved band
  const corridorX = hb ? bandInnerX + (hb.left - bandInnerX) / 2 : null; // SINGLE shared trunk column
  const stepBand = hb ? (hb.left - bandInnerX) / (nHalt + 1) : 0;

  const records = new Map();

  for (const edge of cfg.edges) {
    const role = roles.edgeRoleById.get(edge.id);
    const src = edge.from, tgt = edge.to;
    const sBox = boxOf(src), tBox = boxOf(tgt);

    // ---- A. branch-to-HALT exit: shared corridor + stacked landing ----
    if (role === "halt-exit" && sBox && hb) {
      const slot = haltSlotBySource.get(src) ?? 0;
      const landY = hb.top + ((slot + 1) * hh) / (nHalt + 1); // stacked landing (slot order) — unchanged
      const sourcePort = getRight(sBox);
      const targetPort = [hb.left, landY];
      const portPolicyCase = nHalt > 1 ? "halt-shared-corridor" : "halt-single";
      // default = the OLD per-slot independent band column (landing was already stacked)
      const defaultCorridorX = bandInnerX + (slot + 1) * stepBand;
      records.set(edge.id, record(edge, role, sourcePort, targetPort, portPolicyCase,
        getRight(sBox), [hb.left, landY], { corridorX, defaultCorridorX, landingSlot: slot }));
      continue;
    }

    // ---- B. merge into an already-placed target ----
    if (role === "merge-connector" && sBox && tBox) {
      const defS = getBottom(sBox), defT = getTop(tBox);
      const columnAligned = Math.abs(sBox.cx - tBox.cx) < colTol;
      if (!columnAligned) {
        const onRight = sBox.cx > tBox.cx;
        const sourcePort = getBottom(sBox);
        const targetPort = onRight ? getRight(tBox) : getLeft(tBox);
        // R17 footprint test: the descent column (source bottom x) may not fall inside the
        // target's x-extent + clearance; if it does, the body must jog out to sideEntryJogX.
        const dropX = sourcePort[0];
        const insideFootprint = dropX > tBox.left - clearance && dropX < tBox.right + clearance;
        const sideEntryJogX = insideFootprint ? (onRight ? tBox.right + clearance : tBox.left - clearance) : null;
        records.set(edge.id, record(edge, role, sourcePort, targetPort, "merge-side-entry", defS, defT,
          sideEntryJogX == null ? null : { sideEntryJogX }));
      } else {
        records.set(edge.id, record(edge, role, defS, defT, "merge-top", defS, defT, null));
      }
      continue;
    }

    // ---- everything else: role default (no change; recorded for diagnostics parity) ----
    let sourcePort, targetPort, portPolicyCase;
    if (role === "branch-exit") {
      const arm = armByEdge.get(edge.id);
      if (arm) { sourcePort = arm.face; targetPort = arm.targetTop; }
      else { sourcePort = sBox && getBottom(sBox); targetPort = tBox && getTop(tBox); }
      portPolicyCase = "branch-exit";
    } else if (role === "loop-return") {
      // side ports are owned by lanes/routing; recorded as default-left only for parity
      sourcePort = sBox && getLeft(sBox); targetPort = tBox && getLeft(tBox); portPolicyCase = "loop-return";
    } else {
      sourcePort = sBox && getBottom(sBox); targetPort = tBox && getTop(tBox); portPolicyCase = role ?? "unknown";
    }
    records.set(edge.id, record(edge, role, sourcePort, targetPort, portPolicyCase, sourcePort, targetPort, null));
  }

  return records;
}

// SketchV4 — Phase 3 HALT-outermost sink placement.
//
// Pure/deterministic. Places the single shared HALT sink using the validated
// HALT-outermost rule: on the HALT-bearing side the HALT routeFamily reserves the
// OUTERMOST band, and loop-return rails on that side anchor INSIDE it. Same-side
// spatial order from the body outward is:
//
//   [body] -> [loop-return rails] -> [HALT reserved band] -> [HALT sink]
//
// HALT approaches and loop rails are separate routeFamilies (never shared lane
// numbering); only their spatial order is fixed. The sink coordinate is computed as
// (outermost same-side loop-rail extent) + haltBandOffset — NOT body-right + a fixed
// distance — which is what resolves the minimization i-24 graze (a right-side loop
// rail that collided with a frozen-right HALT under SketchV3).
//
// SketchV3 puts the one shared sink on the right (placedBounds.right); Phase 3 holds
// that convention (haltSide = "right"). Choosing the side is a later concern.

const HALT_BAND_OFFSET = 154;

export function placeHalt(cfg, roles, skeleton, lanes, options) {
  const { terminalSize, haltBandOffset = HALT_BAND_OFFSET, clearance = 16, haltSide = "right", round = Math.round } = options;
  const [hw, hh] = terminalSize;
  const placements = skeleton.placements;

  const nodeBoxes = [...placements.values()].map((p) => p.box);
  const maxNodeRight = Math.max(...nodeBoxes.map((b) => b.right));
  const minNodeLeft = Math.min(...nodeBoxes.map((b) => b.left));

  const sideRails = lanes.laneRecords.filter((r) => r.side === haltSide).map((r) => r.railCoord);

  let haltX, outermostLoopRail;
  if (haltSide === "right") {
    outermostLoopRail = sideRails.length ? Math.max(...sideRails) : null;
    haltX = Math.max(maxNodeRight, outermostLoopRail ?? -Infinity) + haltBandOffset;
  } else {
    outermostLoopRail = sideRails.length ? Math.min(...sideRails) : null;
    haltX = Math.min(minNodeLeft, outermostLoopRail ?? Infinity) - haltBandOffset;
  }

  // landing order + vertical position from the halt-exit sources
  const haltExits = skeleton.haltExitEdges
    .map((e) => ({ source: e.from, cy: placements.get(e.from)?.cy }))
    .filter((e) => Number.isFinite(e.cy))
    .sort((a, b) => a.cy - b.cy);
  const ys = haltExits.map((e) => e.cy);
  const haltY = ys.length ? ys[Math.floor(ys.length / 2)] : 0;

  const haltBox = { left: haltX - hw / 2, right: haltX + hw / 2, top: haltY - hh / 2, bottom: haltY + hh / 2, cx: haltX, cy: haltY };

  // band reservation: every same-side loop rail sits inside (nearer the body than) the sink
  const haltBandReserved = haltSide === "right"
    ? sideRails.every((x) => x < haltBox.left)
    : sideRails.every((x) => x > haltBox.right);
  const loopRailInsideHaltBand = haltSide === "right"
    ? sideRails.every((x) => x < haltBox.left - clearance)
    : sideRails.every((x) => x > haltBox.right + clearance);

  const haltExitRecords = haltExits.map((e, i) => ({ source: e.source, landingSlotOrder: i, sourceY: round(e.cy) }));

  return {
    haltSide,
    haltX: round(haltX),
    haltY: round(haltY),
    haltBox,
    haltBandOffset,
    outermostLoopRail: outermostLoopRail == null ? null : round(outermostLoopRail),
    sameSideLoopRailCount: sideRails.length,
    haltBandReserved,
    loopRailInsideHaltBand,
    haltExitCount: skeleton.haltExitEdges.length,
    haltExitRecords,
  };
}

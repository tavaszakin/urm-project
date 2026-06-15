import KatexMath from "./KatexMath.jsx";
import { applySketchV1Layout } from "./SketchV1FlowDiagram.jsx";
import { applySketchV3LayoutWithAutomaticRepair } from "./SketchV3FlowDiagram.jsx";
import { useEffect, useMemo, useRef, useState } from "react";

const TEXTBOOK_LAYOUT = {
  actionNodeWidth: 88,
  actionNodeHeight: 30,
  unconditionalNodeWidth: 88,
  unconditionalNodeHeight: 30,
  blockNodeWidth: 120,
  blockNodeHeight: 44,
  diamondWidth: 82,
  diamondHeight: 46,
  terminalWidth: 48,
  terminalHeight: 18,
  verticalGap: 24,
  branchExitLength: 42,
  branchForkDx: 54,
  branchForkDy: 26,
  branchAngleDeg: 33,
  diamondBranchInset: 0,
  maxDrift: 144,
  minBranchAngleDeg: 90,
  minDiagonalBranchLength: 44,
  nearbyBranchDiagonalThreshold: 3,
  sideHaltDistance: 154,
  loopLaneDistance: 54,
  loopLaneStep: 24,
  localForwardLaneDistance: 32,
  labelOffset: 4,
  arrowStrokeWidth: 0.9,
  localBranchTargetOffset: 132,
  nestedLoopForkStepY: 84,
  nestedLoopInnerColumnOffset: -126,
  nestedLoopInnerDeepColumnOffset: -252,
  nestedLoopContinuationColumnOffset: 126,
  forkTargetOffset: 132,
  nearbyJumpThreshold: 3,
  sideRouteGap: 18,
};

const NODE_TOP_PADDING = 20;
const NODE_SIDE_PADDING = 24;
const ENABLE_VISUAL_ROLE_DEBUG = false;
const ENABLE_VISUAL_GEOMETRY_DEBUG = false;
const ENABLE_GENERIC_CONTROL_FLOW_BLOCK_LAYOUT = true;
const MAX_COMFORTABLE_GRAPH_HEIGHT = 1100;
const MAX_COMFORTABLE_GRAPH_WIDTH = 1500;
const GRAPH_SCALE_NODE_THRESHOLD = 30;
const MIN_GRAPH_SCALE = 0.7;
const MAX_BETA_FLOW_DEBUG_REPORT_HISTORY = 120;
// Cap the per-phase timing log so it cannot grow without bound across repeated selections.
const MAX_BETA_FLOW_PERF_LOG_ENTRIES = 50;
let BETA_FLOW_DEBUG_RENDER_COUNTER = 0;

function normalizeOpcode(instruction) {
  return String(Array.isArray(instruction) ? instruction[0] : "").trim().toUpperCase();
}

function isInstructionList(program) {
  return Array.isArray(program) && program.every((instruction) => Array.isArray(instruction));
}

function isJumpInstruction(instruction) {
  return normalizeOpcode(instruction) === "J";
}

function getInstructionTarget(instruction) {
  const target = Number(instruction?.[3]);
  return Number.isInteger(target) ? target : null;
}

function getJumpArgs(instruction) {
  if (!isJumpInstruction(instruction)) return null;

  const leftRegister = Number(instruction?.[1]);
  const rightRegister = Number(instruction?.[2]);

  return {
    leftRegister: Number.isInteger(leftRegister) ? leftRegister : null,
    rightRegister: Number.isInteger(rightRegister) ? rightRegister : null,
    target: getInstructionTarget(instruction),
  };
}

function getInstructionRole(instruction) {
  const jumpArgs = getJumpArgs(instruction);

  if (!jumpArgs) return "action";

  return jumpArgs.leftRegister === jumpArgs.rightRegister
    ? "unconditionalJump"
    : "conditionalJump";
}

function formatInstruction(instruction) {
  if (!Array.isArray(instruction) || instruction.length === 0) {
    return "Unknown";
  }

  const [opcode, ...args] = instruction;
  return `${String(opcode).toUpperCase()}(${args.join(", ")})`;
}

function formatNodeTitle(node) {
  if (node.kind === "start" || node.kind === "halt") return node.label;
  return node.displayNode?.id ?? `I${node.instructionIndex}`;
}

function formatIndexLatex(index) {
  return `I_{${index}}`;
}

function formatIndexRangeLatex(startIndex, endIndex) {
  return startIndex === endIndex
    ? formatIndexLatex(startIndex)
    : `I_{${startIndex}}\\text{--}I_{${endIndex}}`;
}

function formatNodeTitleLatex(node) {
  if (node.kind === "start" || node.kind === "halt") return node.label;

  if (node.displayNode) {
    return formatIndexRangeLatex(node.displayNode.startIndex, node.displayNode.endIndex);
  }

  return formatIndexLatex(node.instructionIndex);
}

function formatCollapsedSummaryLatex(summary) {
  const match = /^Z\((\d+)\),\.\.\.,Z\((\d+)\)$/.exec(String(summary ?? ""));
  if (!match) return String(summary ?? "");

  const [, from, to] = match;
  return `Z(${from}),\\ldots,Z(${to})`;
}

function formatInstructionMathLatex(instruction, nodeKind) {
  const jumpArgs = getJumpArgs(instruction);

  if (jumpArgs) {
    const target = Number.isInteger(jumpArgs.target) ? jumpArgs.target : "\\text{HALT}";
    return `J(${jumpArgs.leftRegister},${jumpArgs.rightRegister},${target})`;
  }

  const opcode = normalizeOpcode(instruction);

  if (opcode === "Z") {
    const register = Number(instruction?.[1]);
    return `Z(${register})`;
  }

  if (opcode === "S") {
    const register = Number(instruction?.[1]);
    return `S(${register})`;
  }

  if (opcode === "T") {
    const source = Number(instruction?.[1]);
    const target = Number(instruction?.[2]);
    return `T(${source},${target})`;
  }

  return String(formatInstruction(instruction));
}

function getNodeMathLines(node) {
  const title = formatNodeTitleLatex(node);

  if (node.displayKind === "collapsedBlock") {
    return {
      title,
      label: formatCollapsedSummaryLatex(node.displayNode?.summary),
      summary: null,
    };
  }

  return {
    title,
    label: formatInstructionMathLatex(node.instruction, node.kind),
    summary: null,
  };
}

function buildRawDisplayNodes(program, analysis) {
  return program.map((instruction, index) => ({
    kind: "instruction",
    id: `I${index}`,
    startIndex: index,
    endIndex: index,
    instructionIndices: [index],
    instruction,
    label: formatInstruction(instruction),
    nodeType: analysis.nodeRoles[index],
  }));
}

function getZeroRegister(instruction) {
  if (normalizeOpcode(instruction) !== "Z") return null;

  const register = Number(instruction?.[1]);
  return Number.isInteger(register) ? register : null;
}

function collectJumpTargets(program) {
  return new Set(
    program
      .map((instruction) => getJumpArgs(instruction)?.target)
      .filter((target) => Number.isInteger(target) && target >= 0 && target < program.length),
  );
}

function collectNonFallthroughEntryTargets(edges) {
  return new Set(
    edges
      .filter(
        (edge) =>
          Number.isInteger(edge.targetIndex) &&
          !(
            edge.type === "fallthrough" &&
            edge.targetIndex === edge.sourceIndex + 1
          ),
      )
      .map((edge) => edge.targetIndex),
  );
}

function isUnsafeZeroingSplitPoint(index, jumpTargets, nonFallthroughEntryTargets) {
  return jumpTargets.has(index) || nonFallthroughEntryTargets.has(index);
}

function hasSafeZeroingRunEdges(edges, startIndex, endIndex) {
  for (let index = startIndex; index < endIndex; index += 1) {
    const hasFallthrough = edges.some(
      (edge) =>
        edge.type === "fallthrough" &&
        edge.sourceIndex === index &&
        edge.targetIndex === index + 1,
    );

    if (!hasFallthrough) return false;
  }

  return edges.every((edge) => {
    const sourceInside =
      Number.isInteger(edge.sourceIndex) &&
      startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= endIndex;
    const targetInside =
      Number.isInteger(edge.targetIndex) &&
      startIndex <= edge.targetIndex &&
      edge.targetIndex <= endIndex;

    if (targetInside && edge.targetIndex > startIndex) {
      return (
        edge.type === "fallthrough" &&
        edge.sourceIndex === edge.targetIndex - 1 &&
        sourceInside
      );
    }

    if (sourceInside && edge.sourceIndex < endIndex) {
      return edge.type === "fallthrough" && edge.targetIndex === edge.sourceIndex + 1;
    }

    return true;
  });
}

function createCollapsedSetupDisplayNode(program, startIndex, endIndex) {
  const firstRegister = getZeroRegister(program[startIndex]);
  const lastRegister = getZeroRegister(program[endIndex]);

  return {
    kind: "collapsedBlock",
    id: `I${startIndex}-I${endIndex}`,
    startIndex,
    endIndex,
    instructionIndices: rangeIndexes(startIndex, endIndex),
    label: "clear workspace",
    summary: `Z(${firstRegister}),...,Z(${lastRegister})`,
    nodeType: "block",
  };
}

function buildCollapsedSetupDisplayNodes(program, analysis) {
  const rawDisplayNodes = buildRawDisplayNodes(program, analysis);
  const jumpTargets = collectJumpTargets(program);
  const nonFallthroughEntryTargets = collectNonFallthroughEntryTargets(analysis.edges);
  const displayNodes = [];
  let index = 0;

  while (index < program.length) {
    const firstRegister = getZeroRegister(program[index]);

    if (firstRegister === null) {
      displayNodes.push(rawDisplayNodes[index]);
      index += 1;
      continue;
    }

    let endIndex = index;
    let expectedRegister = firstRegister + 1;

    while (
      endIndex + 1 < program.length &&
      getZeroRegister(program[endIndex + 1]) === expectedRegister
    ) {
      endIndex += 1;
      expectedRegister += 1;
    }

    let cursor = index;

    while (cursor <= endIndex) {
      if (isUnsafeZeroingSplitPoint(cursor, jumpTargets, nonFallthroughEntryTargets)) {
        displayNodes.push(rawDisplayNodes[cursor]);
        cursor += 1;
        continue;
      }

      const subRunStart = cursor;

      while (
        cursor + 1 <= endIndex &&
        !isUnsafeZeroingSplitPoint(cursor + 1, jumpTargets, nonFallthroughEntryTargets)
      ) {
        cursor += 1;
      }

      const subRunEnd = cursor;
      const subRunLength = subRunEnd - subRunStart + 1;
      const canCollapse =
        subRunLength >= 3 &&
        hasSafeZeroingRunEdges(analysis.edges, subRunStart, subRunEnd);

      if (canCollapse) {
        displayNodes.push(createCollapsedSetupDisplayNode(program, subRunStart, subRunEnd));
      } else {
        rangeIndexes(subRunStart, subRunEnd).forEach((rawIndex) => {
          displayNodes.push(rawDisplayNodes[rawIndex]);
        });
      }

      cursor = subRunEnd + 1;
    }

    index = endIndex + 1;
  }

  return displayNodes;
}

function buildDisplayNodes(program, analysis, { collapseSetupBlocks = false } = {}) {
  return collapseSetupBlocks
    ? buildCollapsedSetupDisplayNodes(program, analysis)
    : buildRawDisplayNodes(program, analysis);
}

function getDisplayNodeForInstructionIndex(displayNodes, index) {
  return displayNodes.find((displayNode) => isInstructionInsideDisplayNode(displayNode, index));
}

function isInstructionInsideDisplayNode(displayNode, index) {
  return displayNode.startIndex <= index && index <= displayNode.endIndex;
}

function createInstructionRenderNode(displayNode, { x, y, region } = {}) {
  return {
    id: `i-${displayNode.startIndex}`,
    kind: displayNode.nodeType,
    displayNode,
    displayKind: displayNode.kind,
    startIndex: displayNode.startIndex,
    endIndex: displayNode.endIndex,
    instructionIndices: displayNode.instructionIndices,
    instruction: displayNode.instruction,
    instructionIndex: displayNode.startIndex,
    label: displayNode.label,
    region,
    x: x ?? 0,
    y: y ?? 0,
  };
}

function getRenderNodeIdForInstructionIndex(displayNodes, index) {
  const displayNode = getDisplayNodeForInstructionIndex(displayNodes, index);
  return displayNode ? `i-${displayNode.startIndex}` : null;
}

function remapEdgesToDisplayNodes(edges, displayNodes) {
  return edges
    .map((edge) => {
      const from = Number.isInteger(edge.sourceIndex)
        ? getRenderNodeIdForInstructionIndex(displayNodes, edge.sourceIndex)
        : edge.from;
      const to = Number.isInteger(edge.targetIndex)
        ? getRenderNodeIdForInstructionIndex(displayNodes, edge.targetIndex) ?? edge.to
        : edge.to;

      if (from && to && from === to) return null;

      return {
        ...edge,
        from: from ?? edge.from,
        to,
      };
    })
    .filter(Boolean);
}

function buildDisplayEdges(edges, displayNodes, { collapseSetupBlocks = false } = {}) {
  return collapseSetupBlocks ? remapEdgesToDisplayNodes(edges, displayNodes) : edges;
}

function getTargetId(targetIndex, programLength) {
  return targetIndex >= 0 && targetIndex < programLength ? `i-${targetIndex}` : "halt";
}

function classifyConditionalBranch({ sourceIndex, targetIndex, programLength, layout }) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= programLength) {
    return "earlyExitToHalt";
  }

  if (targetIndex <= sourceIndex) {
    return "backwardLoop";
  }

  return targetIndex - sourceIndex <= layout.nearbyJumpThreshold
    ? "nearbyForwardBranch"
    : "farForwardBranch";
}

function isBackwardEdge(edge) {
  return Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex < edge.sourceIndex;
}

function isForwardEdge(edge) {
  return Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex > edge.sourceIndex;
}

function isHaltExitEdge(edge, programLength) {
  return !Number.isInteger(edge.targetIndex) ||
    edge.targetIndex < 0 ||
    edge.targetIndex >= programLength ||
    edge.routeKind === "earlyExitToHalt";
}

function createBetaFlowDebugIdentity({
  selectedExampleName = "",
  motifHint = null,
  program = [],
  nodeRoles = [],
  layoutMode = "tuned",
  hasTunedLayout = null,
  layoutStatus = null,
} = {}) {
  const renderCounter = BETA_FLOW_DEBUG_RENDER_COUNTER;
  BETA_FLOW_DEBUG_RENDER_COUNTER += 1;
  const conditionalDecisionCount = nodeRoles.filter((role) => role === "conditionalJump").length;
  const effectiveGeneratedLayoutMode =
    layoutMode === "generated" ||
    layoutMode === "generatedScanV2" ||
    layoutMode === "sketchV1" ||
    layoutMode === "sketchV3"
      ? layoutMode
      : null;
  const generatedStrategy =
    layoutMode === "generatedScanV2"
      ? "scanV2"
      : layoutMode === "sketchV1"
        ? "sketchV1"
      : layoutMode === "sketchV3"
        ? "sketchV3"
      : layoutMode === "generated"
        ? "legacy"
        : null;

  return {
    selectedExampleName: selectedExampleName || "unknown",
    layoutMode,
    effectiveGeneratedLayoutMode,
    generatedStrategy,
    motifHint: motifHint ?? "unknown",
    instructionCount: program.length,
    conditionalDecisionCount,
    hasTunedLayout,
    layoutStatus,
    renderCounter,
    timestampMs: Date.now(),
    firstInstructions: program.slice(0, 5).map((instruction, index) => ({
      index,
      label: formatInstruction(instruction),
    })),
  };
}

function getDebugMotif(report, kind) {
  if (!Array.isArray(report?.motifs)) return null;
  return report.motifs.find((motif) => motif?.kind === kind) ?? null;
}

function toCountMap(entries = []) {
  const counts = {};
  entries.forEach((entry) => {
    const key = String(entry ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

function sortCountMap(countMap = {}, limit = 5) {
  return Object.entries(countMap)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function summarizeProblemHotspots(findings = []) {
  const edgeCounts = {};
  const regionCounts = {};

  findings.forEach((finding) => {
    const edgeIds = Array.isArray(finding?.edgeIds) ? finding.edgeIds : [];
    const regionIds = Array.isArray(finding?.regionIds) ? finding.regionIds : [];

    edgeIds.forEach((edgeId) => {
      if (!edgeId) return;
      edgeCounts[edgeId] = (edgeCounts[edgeId] ?? 0) + 1;
    });

    regionIds.forEach((regionId) => {
      if (!regionId) return;
      regionCounts[regionId] = (regionCounts[regionId] ?? 0) + 1;
    });
  });

  return {
    topProblemEdges: sortCountMap(edgeCounts, 8),
    topProblemRegions: sortCountMap(regionCounts, 8),
  };
}

function buildDebugHistoryDiagnostics(type, report = {}) {
  if (type === "visualRoles") {
    return {
      branchMergeRegionCount: report?.summary?.branchMergeRegionCount ?? 0,
      branchMergeAuditDecisionCount: report?.summary?.branchMergeAuditDecisionCount ?? 0,
      separationFindingCount: null,
      separationSeverityCounts: null,
      generatedLaneSeparationAttempts: null,
      generatedLaneSeparationApplied: null,
      protectedRegionRerouteAttempts: null,
      protectedRegionRerouteApplied: null,
    };
  }

  if (type === "geometry") {
    const separationAudit = getDebugMotif(report, "separationOverlapAudit");
    const afterAudit = separationAudit?.afterRoutingSeparationAudit ?? separationAudit ?? {};
    const separationFindings = Array.isArray(afterAudit?.findings) ? afterAudit.findings : [];
    const severity = afterAudit?.severityCounts ?? { high: 0, medium: 0, low: 0 };
    const laneSeparation = getDebugMotif(report, "generatedLaneSeparation");
    const reroute = getDebugMotif(report, "protectedRegionAwareReroute");
    const rerouteAttempts = Array.isArray(reroute?.attempts) ? reroute.attempts : [];
    const laneAttempts = Array.isArray(laneSeparation?.attempts) ? laneSeparation.attempts : [];
    const findingKinds = toCountMap(separationFindings.map((finding) => finding?.kind ?? "unknown"));
    const suggestedFixCategoryCounts = toCountMap(
      separationFindings.map((finding) => finding?.suggestedFixCategory ?? "unknown"),
    );
    const rerouteReasonCounts = toCountMap(rerouteAttempts.map((attempt) => attempt?.reason ?? "unknown"));
    const laneReasonCounts = toCountMap(laneAttempts.map((attempt) => attempt?.reason ?? "unknown"));
    const problemHotspots = summarizeProblemHotspots(separationFindings);

    return {
      branchMergeRegionCount: report?.summary?.branchMergeRegionCount ?? 0,
      branchMergeAuditDecisionCount: report?.summary?.branchMergeAuditDecisionCount ?? 0,
      separationFindingCount: separationFindings.length,
      separationSeverityCounts: {
        high: severity?.high ?? 0,
        medium: severity?.medium ?? 0,
        low: severity?.low ?? 0,
      },
      generatedLaneSeparationAttempts: Array.isArray(laneSeparation?.attempts)
        ? laneSeparation.attempts.length
        : null,
      generatedLaneSeparationApplied: Number.isInteger(laneSeparation?.appliedCount)
        ? laneSeparation.appliedCount
        : null,
      generatedLaneSeparationSkippedReason: laneSeparation?.skippedReason ?? null,
      generatedLaneSeparationReasonCounts: laneReasonCounts,
      protectedRegionRerouteAttempts: Array.isArray(reroute?.attempts)
        ? reroute.attempts.length
        : null,
      protectedRegionRerouteApplied: Number.isInteger(reroute?.appliedCount)
        ? reroute.appliedCount
        : null,
      protectedRegionRerouteSkippedReason: reroute?.skippedReason ?? null,
      protectedRegionRerouteReasonCounts: rerouteReasonCounts,
      separationFindingKindCounts: findingKinds,
      separationFixCategoryCounts: suggestedFixCategoryCounts,
      ...problemHotspots,
    };
  }

  return {};
}

function summarizeBetaFlowDebugEntry(entry = {}) {
  const identity = entry?.identity ?? {};
  const summary = entry?.summary ?? {};
  const diagnostics = entry?.diagnostics ?? {};
  const separationSeverity = diagnostics?.separationSeverityCounts ?? {};

  return {
    type: entry?.type ?? "unknown",
    renderCounter: identity?.renderCounter ?? null,
    selectedExampleName: identity?.selectedExampleName ?? summary?.selectedFunctionId ?? "unknown",
    layoutMode: identity?.layoutMode ?? summary?.layoutMode ?? "unknown",
    effectiveGeneratedLayoutMode:
      identity?.effectiveGeneratedLayoutMode ??
      summary?.effectiveGeneratedLayoutMode ??
      null,
    generatedStrategy:
      identity?.generatedStrategy ??
      summary?.generatedStrategy ??
      null,
    motifHint: identity?.motifHint ?? summary?.motifHintKind ?? summary?.motifKind ?? "unknown",
    instructionCount: identity?.instructionCount ?? summary?.instructionCount ?? null,
    conditionalDecisionCount: identity?.conditionalDecisionCount ?? summary?.conditionalDecisionCount ?? null,
    hasTunedLayout: identity?.hasTunedLayout ?? summary?.hasTunedLayout ?? null,
    layoutStatus: identity?.layoutStatus ?? summary?.layoutStatus ?? null,
    branchMergeRegionCount: diagnostics?.branchMergeRegionCount ?? summary?.branchMergeRegionCount ?? null,
    branchMergeAuditDecisionCount:
      diagnostics?.branchMergeAuditDecisionCount ?? summary?.branchMergeAuditDecisionCount ?? null,
    separationFindingCount: diagnostics?.separationFindingCount ?? null,
    separationHighCount: separationSeverity?.high ?? null,
    separationMediumCount: separationSeverity?.medium ?? null,
    separationLowCount: separationSeverity?.low ?? null,
    generatedLaneSeparationAttempts: diagnostics?.generatedLaneSeparationAttempts ?? null,
    generatedLaneSeparationApplied: diagnostics?.generatedLaneSeparationApplied ?? null,
    generatedLaneSeparationSkippedReason: diagnostics?.generatedLaneSeparationSkippedReason ?? null,
    protectedRegionRerouteAttempts: diagnostics?.protectedRegionRerouteAttempts ?? null,
    protectedRegionRerouteApplied: diagnostics?.protectedRegionRerouteApplied ?? null,
    protectedRegionRerouteSkippedReason: diagnostics?.protectedRegionRerouteSkippedReason ?? null,
    separationFindingKindCounts: diagnostics?.separationFindingKindCounts ?? null,
    separationFixCategoryCounts: diagnostics?.separationFixCategoryCounts ?? null,
    generatedLaneSeparationReasonCounts: diagnostics?.generatedLaneSeparationReasonCounts ?? null,
    protectedRegionRerouteReasonCounts: diagnostics?.protectedRegionRerouteReasonCounts ?? null,
    topProblemEdges: diagnostics?.topProblemEdges ?? null,
    topProblemRegions: diagnostics?.topProblemRegions ?? null,
  };
}

function ensureBetaFlowDebugWindowHelpers() {
  if (typeof window === "undefined") return;
  if (window.__betaFlowDebugHelpersInstalled) return;

  window.__betaFlowLatestReport = (filters = {}) => {
    const reports = Array.isArray(window.__betaFlowDebugReports)
      ? window.__betaFlowDebugReports
      : [];
    const { exampleName = null, layoutMode = null, type = null } = filters ?? {};
    for (let index = reports.length - 1; index >= 0; index -= 1) {
      const entry = reports[index];
      const summary = summarizeBetaFlowDebugEntry(entry);
      if (type && summary.type !== type) continue;
      if (exampleName && summary.selectedExampleName !== exampleName) continue;
      if (layoutMode && summary.layoutMode !== layoutMode) continue;
      return entry;
    }
    return null;
  };

  window.__betaFlowSummarizeReports = () => {
    const reports = Array.isArray(window.__betaFlowDebugReports)
      ? window.__betaFlowDebugReports
      : [];
    return reports.map((entry) => summarizeBetaFlowDebugEntry(entry));
  };

  window.__betaFlowCompareModes = (exampleName) => {
    const reports = Array.isArray(window.__betaFlowDebugReports)
      ? window.__betaFlowDebugReports
      : [];
    const latestByMode = (mode, reportType = "geometry") => {
      for (let index = reports.length - 1; index >= 0; index -= 1) {
        const entry = reports[index];
        const summary = summarizeBetaFlowDebugEntry(entry);
        if (summary.type !== reportType) continue;
        if (summary.layoutMode !== mode) continue;
        if (exampleName && summary.selectedExampleName !== exampleName) continue;
        return { entry, summary };
      }
      return null;
    };

    const tunedMatch = latestByMode("tuned");
    const generatedMatch = latestByMode("generated");
    const tunedRolesMatch = latestByMode("tuned", "visualRoles");
    const generatedRolesMatch = latestByMode("generated", "visualRoles");
    const tuned = tunedMatch?.summary ?? null;
    const generated = generatedMatch?.summary ?? null;
    const tunedRoles = tunedRolesMatch?.summary ?? null;
    const generatedRoles = generatedRolesMatch?.summary ?? null;
    const latestAnyMatch = (() => {
      for (let index = reports.length - 1; index >= 0; index -= 1) {
        const summary = summarizeBetaFlowDebugEntry(reports[index]);
        if (exampleName && summary.selectedExampleName !== exampleName) continue;
        return summary;
      }
      return null;
    })();
    const hasTunedLayout = latestAnyMatch?.hasTunedLayout ?? null;
    const layoutStatus = latestAnyMatch?.layoutStatus ?? null;
    const warnings = [];
    if (hasTunedLayout === false) {
      warnings.push("No confirmed tuned layout exists for this example; only generated layout is available.");
    } else if (!tuned) {
      warnings.push("Missing tuned geometry report.");
    }
    if (!generated) warnings.push("Missing generated geometry report.");
    if (hasTunedLayout !== false && tunedRoles && !tuned) {
      warnings.push("Tuned visualRoles report exists, but tuned geometry report is missing.");
    }
    if (generatedRoles && !generated) {
      warnings.push("Generated visualRoles report exists, but generated geometry report is missing.");
    }

    const numericFields = [
      "instructionCount",
      "conditionalDecisionCount",
      "branchMergeRegionCount",
      "branchMergeAuditDecisionCount",
      "separationFindingCount",
      "separationHighCount",
      "separationMediumCount",
      "separationLowCount",
      "generatedLaneSeparationAttempts",
      "generatedLaneSeparationApplied",
      "protectedRegionRerouteAttempts",
      "protectedRegionRerouteApplied",
    ];
    const diff = {};
    numericFields.forEach((field) => {
      const tunedValue = tuned?.[field];
      const generatedValue = generated?.[field];
      if (typeof tunedValue === "number" && typeof generatedValue === "number") {
        diff[field] = generatedValue - tunedValue;
      } else {
        diff[field] = null;
      }
    });

    return {
      exampleName: exampleName ?? null,
      hasTunedLayout,
      layoutStatus,
      tuned,
      generated,
      diff,
      warnings,
    };
  };

  const buildLatestLookup = (reports, { exampleName = null } = {}) => {
    const latest = {};

    for (let index = reports.length - 1; index >= 0; index -= 1) {
      const entry = reports[index];
      const summary = summarizeBetaFlowDebugEntry(entry);
      if (exampleName && summary.selectedExampleName !== exampleName) continue;
      const exampleKey = summary.selectedExampleName ?? "unknown";
      const modeKey = summary.layoutMode ?? "unknown";
      const typeKey = summary.type ?? "unknown";
      latest[exampleKey] ??= {};
      latest[exampleKey][modeKey] ??= {};
      if (!latest[exampleKey][modeKey][typeKey]) {
        latest[exampleKey][modeKey][typeKey] = {
          summary,
          identity: entry?.identity ?? null,
          diagnostics: entry?.diagnostics ?? null,
          rawSummary: entry?.summary ?? null,
        };
      }
    }

    return latest;
  };

  const buildExportPayload = (exampleName = null) => {
    const reports = Array.isArray(window.__betaFlowDebugReports)
      ? window.__betaFlowDebugReports
      : [];
    const summarized = reports
      .map((entry) => summarizeBetaFlowDebugEntry(entry))
      .filter((entry) => !exampleName || entry.selectedExampleName === exampleName);
    const filteredExamples = [...new Set(summarized.map((entry) => entry.selectedExampleName).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const latestByExampleMode = buildLatestLookup(reports, { exampleName });

    const comparisons = filteredExamples.map((name) => {
      const comparison = window.__betaFlowCompareModes(name);
      const hasGenerated = Boolean(latestByExampleMode?.[name]?.generated?.geometry);
      const hasTuned = Boolean(latestByExampleMode?.[name]?.tuned?.geometry);
      const generatedOnlyWarning = hasGenerated && !hasTuned
        ? "Generated geometry exists but tuned geometry is missing."
        : null;

      return {
        exampleName: name,
        ...comparison,
        generatedOnlyWarning,
      };
    });

    const generatedOnlyWarnings = comparisons
      .filter((entry) => entry.generatedOnlyWarning)
      .map((entry) => ({
        exampleName: entry.exampleName,
        warning: entry.generatedOnlyWarning,
      }));

    return {
      timestampMs: Date.now(),
      exampleNameFilter: exampleName ?? null,
      reportCount: summarized.length,
      reports: summarized,
      allExampleNames: filteredExamples,
      latestByExampleMode,
      comparisons,
      generatedOnlyWarnings,
    };
  };

  window.__betaFlowExportAllReports = () => buildExportPayload(null);
  window.__betaFlowExportExampleReport = (exampleName) =>
    buildExportPayload(String(exampleName ?? "").trim() || null);

  window.__betaFlowDebugHelpersInstalled = true;
}

function appendBetaFlowDebugReportHistory(type, identity, summary = {}, diagnostics = {}) {
  if (typeof window === "undefined") return;

  if (!Array.isArray(window.__betaFlowDebugReports)) {
    window.__betaFlowDebugReports = [];
  }

  ensureBetaFlowDebugWindowHelpers();

  window.__betaFlowDebugReports.push({
    type,
    identity,
    summary,
    diagnostics,
  });
  if (window.__betaFlowDebugReports.length > MAX_BETA_FLOW_DEBUG_REPORT_HISTORY) {
    window.__betaFlowDebugReports.splice(
      0,
      window.__betaFlowDebugReports.length - MAX_BETA_FLOW_DEBUG_REPORT_HISTORY,
    );
  }
}

function analyzeProgramFlow(program, layout = TEXTBOOK_LAYOUT) {
  const nodeRoles = program.map((instruction) => getInstructionRole(instruction));
  const conditionalDecisionCount = nodeRoles.filter((role) => role === "conditionalJump").length;
  let edges = [
    {
      id: "start-edge",
      from: "start",
      to: program.length > 0 ? "i-0" : "halt",
      type: "start",
      edgeRole: "start",
      routeKind: "ordinaryFallthrough",
    },
  ];

  program.forEach((instruction, index) => {
    const nodeRole = nodeRoles[index];

    if (nodeRole === "conditionalJump") {
      const yesTarget = getJumpArgs(instruction)?.target;
      const noTarget = index + 1;
      const yesRouteKind = classifyConditionalBranch({
        sourceIndex: index,
        targetIndex: yesTarget,
        programLength: program.length,
        layout,
      });
      const noRouteKind =
        yesRouteKind === "nearbyForwardBranch" && noTarget < program.length
          ? "nearbyForwardBranch"
          : classifyConditionalBranch({
              sourceIndex: index,
              targetIndex: noTarget,
              programLength: program.length,
              layout,
            });
      const yesEdgeId = `i-${index}-yes`;
      const noEdgeId = `i-${index}-no`;

      edges.push({
        id: yesEdgeId,
        from: `i-${index}`,
        to: yesRouteKind === "earlyExitToHalt"
          ? `halt-${yesEdgeId}`
          : getTargetId(yesTarget, program.length),
        type: "jump",
        edgeRole: "conditionalYes",
        routeKind: yesRouteKind,
        branch: "yes",
        sourceIndex: index,
        targetIndex: yesTarget,
      });
      edges.push({
        id: noEdgeId,
        from: `i-${index}`,
        to: noRouteKind === "earlyExitToHalt"
          ? `halt-${noEdgeId}`
          : getTargetId(noTarget, program.length),
        type: "jump",
        edgeRole: "conditionalNo",
        routeKind: noRouteKind,
        branch: "no",
        sourceIndex: index,
        targetIndex: noTarget,
      });
      return;
    }

    if (nodeRole === "unconditionalJump") {
      const target = getJumpArgs(instruction)?.target;
      const targetInProgram = Number.isInteger(target) && target >= 0 && target < program.length;
      const routeKind = !targetInProgram
        ? "earlyExitToHalt"
        : target <= index
          ? "unconditionalLoopReturn"
          : "unconditionalForwardJump";
      const edgeId = `i-${index}-unconditional`;

      edges.push({
        id: edgeId,
        from: `i-${index}`,
        to: routeKind === "earlyExitToHalt" ? `halt-${edgeId}` : getTargetId(target, program.length),
        type: "jump",
        edgeRole: routeKind,
        routeKind,
        sourceIndex: index,
        targetIndex: target,
      });
      return;
    }

    edges.push({
      id: `i-${index}-fallthrough`,
      from: `i-${index}`,
      to: getTargetId(index + 1, program.length),
      type: "fallthrough",
      edgeRole: "fallthrough",
      routeKind: "ordinaryFallthrough",
      sourceIndex: index,
      targetIndex: index + 1,
    });
  });

  const preliminaryLoopIntervals = detectLoopIntervals({ program, nodeRoles, edges });
  edges = edges.map((edge) => {
    if (
      edge.branch &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex + 1
    ) {
      const containingLoop = findSmallestContainingLoop(
        preliminaryLoopIntervals,
        edge.sourceIndex,
        edge.targetIndex,
      );

      if (containingLoop) {
        return {
          ...edge,
          routeKind: "localForwardRejoin",
          loopInterval: containingLoop,
        };
      }
    }

    return edge;
  });

  const loopIntervals = detectLoopIntervals({ program, nodeRoles, edges });
  const loopMotifs = detectTextbookLoopMotifs(edges, nodeRoles);
  const {
    regions: branchMergeRegions,
    auditRows: branchMergeRegionAudit,
  } = detectBranchMergeRegions({ program, nodeRoles, edges });
  const branchMergeDebug = {
    detectBranchMergeRegionsCalled: true,
    instructionCount: program.length,
    conditionalDecisionCount,
    branchMergeRegionCount: branchMergeRegions.length,
    branchMergeRegionAuditCount: branchMergeRegionAudit.length,
  };
  const loopBodyIndexes = new Set();
  const loopTestIndexes = new Set();
  const loopReturnIndexes = new Set();

  loopMotifs.forEach((motif) => {
    loopTestIndexes.add(motif.testIndex);
    loopReturnIndexes.add(motif.returnIndex);

    for (let index = motif.testIndex; index <= motif.returnIndex; index += 1) {
      loopBodyIndexes.add(index);
    }
  });

  return {
    program,
    nodeRoles,
    edges,
    loopIntervals,
    loopLaneByEdgeId: buildLoopLaneMap(loopIntervals),
    loopMotifs,
    branchMergeRegions,
    branchMergeRegionAudit,
    branchMergeDebug,
    loopBodyIndexes,
    loopReturnIndexes,
    loopTestIndexes,
  };
}

function detectLoopIntervals(analysis) {
  const intervals = analysis.edges
    .filter(
      (edge) =>
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex < edge.sourceIndex,
    )
    .map((edge) => {
      const startIndex = edge.targetIndex;
      const endIndex = edge.sourceIndex;

      return {
        id: `loop-${startIndex}-${endIndex}-${edge.id}`,
        type: "loopInterval",
        edgeId: edge.id,
        headerIndex: startIndex,
        returnIndex: endIndex,
        startIndex,
        endIndex,
        length: endIndex - startIndex,
        returnInstruction: analysis.program[endIndex],
        isUnconditionalReturn: edge.routeKind === "unconditionalLoopReturn",
        depth: 0,
        parentLoopId: null,
        childLoopIds: [],
        exits: [],
      };
    })
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);

  intervals.forEach((interval) => {
    const parent = intervals
      .filter(
        (candidate) =>
          candidate.id !== interval.id &&
          candidate.startIndex <= interval.startIndex &&
          interval.endIndex <= candidate.endIndex,
      )
      .sort((left, right) => left.length - right.length)[0];

    interval.parentLoopId = parent?.id ?? null;
  });

  intervals.forEach((interval) => {
    if (!interval.parentLoopId) return;
    const parent = intervals.find((candidate) => candidate.id === interval.parentLoopId);
    parent?.childLoopIds.push(interval.id);
  });

  function getLoopDepth(interval) {
    if (!interval.parentLoopId) return 0;
    const parent = intervals.find((candidate) => candidate.id === interval.parentLoopId);
    return parent ? getLoopDepth(parent) + 1 : 0;
  }

  intervals.forEach((interval) => {
    interval.depth = getLoopDepth(interval);
  });

  intervals.forEach((interval) => {
    interval.exits = analysis.edges
      .filter((edge) => {
        if (
          !Number.isInteger(edge.sourceIndex) ||
          edge.sourceIndex < interval.startIndex ||
          edge.sourceIndex > interval.endIndex
        ) {
          return false;
        }

        if (edge.id === interval.edgeId && interval.isUnconditionalReturn) return false;
        if (!Number.isInteger(edge.targetIndex)) return true;

        return edge.targetIndex < interval.startIndex || edge.targetIndex > interval.endIndex;
      })
      .map((edge) => ({
        edgeId: edge.id,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        exitsToHalt:
          !Number.isInteger(edge.targetIndex) ||
          edge.targetIndex < 0 ||
          edge.targetIndex >= analysis.program.length,
        edgeRole: edge.edgeRole,
        routeKind: edge.routeKind,
      }));
  });

  return intervals;
}

function findSmallestContainingLoop(loopIntervals, sourceIndex, targetIndex) {
  return loopIntervals
    .filter((interval) => interval.startIndex <= sourceIndex && targetIndex <= interval.endIndex)
    .sort((left, right) => left.length - right.length)[0] ?? null;
}

function classifyReturnRole(edge, loopIntervals) {
  if (!isBackwardEdge(edge)) return null;

  const owningInterval = loopIntervals.find((interval) => interval.edgeId === edge.id) ?? null;
  const smallestContainingLoop = findSmallestContainingLoop(
    loopIntervals,
    edge.sourceIndex,
    edge.targetIndex,
  );

  if (!owningInterval && !smallestContainingLoop) {
    return {
      role: "localReturn",
      localLoopId: null,
      outerLoopId: null,
      smallestContainingLoopId: null,
      owningLoopId: null,
    };
  }

  const baseInterval = owningInterval ?? smallestContainingLoop;
  const hasNestedChildren = Boolean(baseInterval?.childLoopIds?.length);
  const role = hasNestedChildren ? "outerReturn" : "localReturn";

  return {
    role,
    localLoopId: role === "localReturn" ? baseInterval?.id ?? null : null,
    outerLoopId: role === "outerReturn" ? baseInterval?.id ?? null : null,
    smallestContainingLoopId: smallestContainingLoop?.id ?? null,
    owningLoopId: owningInterval?.id ?? null,
  };
}

function findEdgeBySourceAndTarget(edges, sourceIndex, targetIndex, type = null) {
  return edges.find((edge) => (
    edge.sourceIndex === sourceIndex &&
    edge.targetIndex === targetIndex &&
    (type ? edge.type === type : true)
  ));
}

function toContiguousIntervals(indexes) {
  if (!indexes || indexes.length === 0) return [];

  const sorted = [...new Set(indexes)]
    .filter((index) => Number.isInteger(index))
    .sort((left, right) => left - right);

  if (sorted.length === 0) return [];

  const intervals = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const index = sorted[i];
    if (index === end + 1) {
      end = index;
      continue;
    }

    intervals.push({ startIndex: start, endIndex: end });
    start = index;
    end = index;
  }

  intervals.push({ startIndex: start, endIndex: end });
  return intervals;
}

function expandContinuationChains(
  analysis,
  continuationEntryTargets,
  setupBoundary,
) {
  const loopHeaderIndexes = new Set(analysis.loopIntervals.map((interval) => interval.headerIndex));
  const continuationIndexes = new Set();

  continuationEntryTargets.forEach((startIndex) => {
    if (!Number.isInteger(startIndex)) return;
    if (startIndex < 0 || startIndex >= analysis.program.length) return;

    let currentIndex = startIndex;

    while (true) {
      if (continuationIndexes.has(currentIndex)) break;

      const nodeRole = analysis.nodeRoles[currentIndex];
      if (nodeRole !== "action") break;
      if (loopHeaderIndexes.has(currentIndex) && currentIndex >= setupBoundary) break;

      continuationIndexes.add(currentIndex);

      const fallthroughEdge = findEdgeBySourceAndTarget(
        analysis.edges,
        currentIndex,
        currentIndex + 1,
        "fallthrough",
      );
      if (!fallthroughEdge) break;

      const nextIndex = currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= analysis.program.length) break;
      if (loopHeaderIndexes.has(nextIndex) && nextIndex >= setupBoundary) break;
      if (analysis.nodeRoles[nextIndex] !== "action") break;

      currentIndex = nextIndex;
    }
  });

  return continuationIndexes;
}

function buildVisualRegions({
  analysis,
  setupBoundary,
  continuationIndexes,
  nodeRoleByIndex,
}) {
  const regions = [];
  const setupEndIndex = Math.max(setupBoundary - 1, -1);

  if (setupEndIndex >= 0) {
    regions.push({
      kind: "setup",
      startIndex: 0,
      endIndex: setupEndIndex,
    });
  }

  const unconditionalLoops = analysis.loopIntervals
    .filter((interval) => interval.isUnconditionalReturn)
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);

  unconditionalLoops.forEach((interval) => {
    regions.push({
      kind: interval.depth === 0 ? "coreLoop" : "innerLoop",
      startIndex: interval.startIndex,
      endIndex: interval.endIndex,
      loopIntervalId: interval.id,
      parentLoopIntervalId: interval.parentLoopId ?? null,
      depth: interval.depth,
    });
  });

  toContiguousIntervals([...continuationIndexes]).forEach((interval) => {
    regions.push({
      kind: "continuation",
      startIndex: interval.startIndex,
      endIndex: interval.endIndex,
    });
  });

  const tailIndexes = Object.entries(nodeRoleByIndex)
    .filter(([, role]) => role === "tailNode")
    .map(([index]) => Number(index));

  toContiguousIntervals(tailIndexes).forEach((interval) => {
    regions.push({
      kind: "tail",
      startIndex: interval.startIndex,
      endIndex: interval.endIndex,
    });
  });

  return regions;
}

function classifyVisualRoles(analysis, program, motifHint = null) {
  const nodeRoleByIndex = {};
  const edgeRoleById = {};
  const regionByIndex = {};
  const loopRegionByIndex = {};
  const programLength = program.length;
  const firstDecisionIndex = analysis.nodeRoles.findIndex((role) => role === "conditionalJump");
  const firstDecisionBoundary = firstDecisionIndex >= 0 ? firstDecisionIndex : programLength;
  const setupBoundary = firstDecisionBoundary;

  const continuationEntryTargets = new Set();
  const loopBodyEntryTargets = new Set();

  analysis.edges.forEach((edge) => {
    const edgeInLoop = analysis.loopIntervals.find((interval) => interval.edgeId === edge.id) ?? null;
    const smallestContainingLoop = Number.isInteger(edge.sourceIndex) && Number.isInteger(edge.targetIndex)
      ? findSmallestContainingLoop(analysis.loopIntervals, edge.sourceIndex, edge.targetIndex)
      : null;
    const sourceRole = Number.isInteger(edge.sourceIndex)
      ? analysis.nodeRoles[edge.sourceIndex]
      : null;
    const sourceInsideLoop = Boolean(
      smallestContainingLoop &&
      Number.isInteger(edge.sourceIndex) &&
      smallestContainingLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= smallestContainingLoop.endIndex,
    );
    const targetOutsideContainingLoop = Boolean(
      smallestContainingLoop &&
      Number.isInteger(edge.targetIndex) &&
      (edge.targetIndex < smallestContainingLoop.startIndex ||
        edge.targetIndex > smallestContainingLoop.endIndex),
    );

    let role = "fallthroughVertical";
    let roleMeta = null;

    if (edge.type === "start") {
      role = "startEdge";
    } else if (isHaltExitEdge(edge, programLength)) {
      role = "haltExit";
    } else if (sourceRole === "conditionalJump" && edge.targetIndex === edge.sourceIndex + 1) {
      role = "decisionContinue";
      if (Number.isInteger(edge.targetIndex)) {
        loopBodyEntryTargets.add(edge.targetIndex);
      }
    } else if (sourceRole === "conditionalJump" && isBackwardEdge(edge)) {
      role = "conditionalBackward";
    } else if (sourceRole === "conditionalJump" && isForwardEdge(edge)) {
      const jumpDistance = edge.targetIndex - edge.sourceIndex;
      if (targetOutsideContainingLoop || edge.routeKind === "farForwardBranch") {
        role = "decisionExit";
        continuationEntryTargets.add(edge.targetIndex);
      } else {
        role = jumpDistance <= 3 ? "conditionalForwardLocal" : "conditionalForwardFar";
      }
    } else if (sourceRole === "unconditionalJump" && isBackwardEdge(edge)) {
      const returnClassification = classifyReturnRole(edge, analysis.loopIntervals);
      role = returnClassification?.role ?? "localReturn";
      roleMeta = returnClassification;
    } else if (sourceRole === "unconditionalJump" && isForwardEdge(edge)) {
      role = "unconditionalForwardSkip";
      continuationEntryTargets.add(edge.targetIndex);
    } else if (isBackwardEdge(edge)) {
      role = "conditionalBackward";
    } else if (isForwardEdge(edge) && sourceInsideLoop && targetOutsideContainingLoop) {
      role = "continuationEntry";
      continuationEntryTargets.add(edge.targetIndex);
    }

    if (role === "fallthroughVertical" && edge.type === "fallthrough" && Number.isInteger(edge.targetIndex)) {
      const startsAnyLoop = analysis.loopIntervals.some(
        (interval) => interval.startIndex === edge.targetIndex && edge.sourceIndex < interval.startIndex,
      );
      if (startsAnyLoop) {
        role = "loopBodyEntry";
        loopBodyEntryTargets.add(edge.targetIndex);
      }
    }

    const isSetupFallthrough = edge.type === "fallthrough" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.sourceIndex < setupBoundary &&
      edge.targetIndex <= setupBoundary;
    const isTerminalExit = role === "haltExit" && sourceRole !== "conditionalJump";

    let flowRole = "ordinaryEdge";

    if (edge.type === "start") {
      flowRole = "start";
    } else if (isSetupFallthrough) {
      flowRole = "setupFallthrough";
    } else if (edge.type === "fallthrough") {
      flowRole = "ordinaryFallthrough";
    } else if (sourceRole === "conditionalJump") {
      flowRole = edge.branch === "yes" ? "branchTrue" : "branchFalse";
    } else if (sourceRole === "unconditionalJump") {
      flowRole = "skip";
    }

    if (role === "localReturn") flowRole = "localReturn";
    if (role === "outerReturn") flowRole = "outerReturn";
    if (role === "decisionExit" || role === "continuationEntry") flowRole = "continuation";
    if (role === "unconditionalForwardSkip") flowRole = "skip";
    if (role === "haltExit" && !isTerminalExit) flowRole = "haltBranch";
    if (isTerminalExit) flowRole = "terminalExit";

    edgeRoleById[edge.id] = {
      role,
      flowRole,
      routeKind: edge.routeKind,
      sourceIndex: edge.sourceIndex ?? null,
      targetIndex: edge.targetIndex ?? null,
      loopIntervalId: edgeInLoop?.id ?? null,
      containingLoopId: smallestContainingLoop?.id ?? null,
      ...(roleMeta ?? {}),
    };
  });

  const continuationIndexes = expandContinuationChains(
    analysis,
    continuationEntryTargets,
    setupBoundary,
  );

  for (let index = 0; index < programLength; index += 1) {
    const instructionRole = analysis.nodeRoles[index];
    const instruction = program[index];
    const jumpArgs = getJumpArgs(instruction);
    const insideLoopIntervals = analysis.loopIntervals
      .filter((interval) => interval.startIndex <= index && index <= interval.endIndex)
      .sort((left, right) => left.length - right.length);
    const localLoop = insideLoopIntervals[0] ?? null;

    let nodeRole = "bodyActionNode";

    if (instructionRole === "conditionalJump") {
      nodeRole = "decisionNode";
    } else if (instructionRole === "unconditionalJump") {
      if (Number.isInteger(jumpArgs?.target) && jumpArgs.target <= index) {
        nodeRole = "unconditionalReturnNode";
      } else {
        nodeRole = "unconditionalSkipNode";
      }
    } else if (index < setupBoundary && instructionRole === "action") {
      nodeRole = "setupSpineNode";
    } else if (continuationIndexes.has(index)) {
      nodeRole = "continuationNode";
    } else if (continuationEntryTargets.has(index)) {
      nodeRole = "continuationNode";
    } else {
      const incomingInProgramEdges = analysis.edges.filter(
        (edge) => Number.isInteger(edge.targetIndex) && edge.targetIndex === index,
      );
      const hasIncomingFromHigherIndex = incomingInProgramEdges.some(
        (edge) => Number.isInteger(edge.sourceIndex) && edge.sourceIndex > index,
      );
      const hasLoopExitAsIncoming = incomingInProgramEdges.some(
        (edge) => edgeRoleById[edge.id]?.role === "decisionExit" || edgeRoleById[edge.id]?.role === "continuationEntry",
      );

      if (hasIncomingFromHigherIndex || hasLoopExitAsIncoming) {
        nodeRole = "tailNode";
      }
    }

    if (loopBodyEntryTargets.has(index) && instructionRole === "action") {
      nodeRole = "bodyActionNode";
    }

    nodeRoleByIndex[index] = nodeRole;
    regionByIndex[index] = nodeRole;
    loopRegionByIndex[index] = localLoop
      ? {
          loopId: localLoop.id,
          depth: localLoop.depth,
          isHeader: localLoop.headerIndex === index,
          isReturn: localLoop.returnIndex === index,
        }
      : null;
  }

  const regions = buildVisualRegions({
    analysis,
    setupBoundary,
    continuationIndexes,
    nodeRoleByIndex,
  });

  return {
    nodeRoleByIndex,
    edgeRoleById,
    regionByIndex,
    loopRegionByIndex,
    regions,
    metadata: {
      firstDecisionIndex,
      setupBoundary,
      motifHintKind: motifHint?.kind ?? null,
    },
  };
}

function formatVisualRoleDebugReport(analysis, selectedFunctionId = "") {
  const visualRoles = analysis.visualRoles ?? classifyVisualRoles(
    analysis,
    analysis.program,
    detectFlowMotif(analysis, selectedFunctionId),
  );
  const nodeRows = analysis.program.map((instruction, index) => ({
    index,
    instruction: formatInstruction(instruction),
    nodeType: analysis.nodeRoles[index],
    visualRole: visualRoles.nodeRoleByIndex[index],
    region: visualRoles.regionByIndex[index],
    loopRegion: visualRoles.loopRegionByIndex[index]?.loopId ?? "-",
  }));
  const edgeRows = analysis.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    edgeRole: edge.edgeRole,
    routeKind: edge.routeKind,
    visualRole: visualRoles.edgeRoleById[edge.id]?.role ?? "-",
    flowRole: visualRoles.edgeRoleById[edge.id]?.flowRole ?? "-",
    loopId: visualRoles.edgeRoleById[edge.id]?.containingLoopId ?? "-",
    returnRole: visualRoles.edgeRoleById[edge.id]?.role === "localReturn" ||
      visualRoles.edgeRoleById[edge.id]?.role === "outerReturn"
      ? visualRoles.edgeRoleById[edge.id]?.role
      : "-",
    localLoopId: visualRoles.edgeRoleById[edge.id]?.localLoopId ?? "-",
    outerLoopId: visualRoles.edgeRoleById[edge.id]?.outerLoopId ?? "-",
  }));
  const regionRows = (visualRoles.regions ?? []).map((region) => ({
    kind: region.kind,
    startIndex: region.startIndex,
    endIndex: region.endIndex,
    loopIntervalId: region.loopIntervalId ?? "-",
    parentLoopIntervalId: region.parentLoopIntervalId ?? "-",
    depth: Number.isInteger(region.depth) ? region.depth : "-",
  }));
  const loopRows = analysis.loopIntervals.map((interval) => ({
    id: interval.id,
    kind: interval.depth === 0 ? "coreLoop" : "innerLoop",
    startIndex: interval.startIndex,
    endIndex: interval.endIndex,
    headerIndex: interval.headerIndex,
    returnIndex: interval.returnIndex,
    depth: interval.depth,
    parentLoopId: interval.parentLoopId ?? "-",
    isUnconditionalReturn: interval.isUnconditionalReturn,
  }));
  const branchMergeRows = buildBranchMergeDebugRows(
    analysis.branchMergeRegions ?? [],
    null,
    TEXTBOOK_LAYOUT,
  );
  const branchMergeAuditRows = analysis.branchMergeRegionAudit ?? [];
  const identity = analysis.debugIdentity ?? createBetaFlowDebugIdentity({
    selectedExampleName: selectedFunctionId,
    layoutMode: analysis.layoutMode ?? "tuned",
    motifHint: visualRoles.metadata.motifHintKind,
    program: analysis.program,
    nodeRoles: analysis.nodeRoles,
  });
  const branchMergeDataFlow = {
    identity,
    selectedExample: selectedFunctionId || "unknown",
    motifHintKind: visualRoles.metadata.motifHintKind ?? null,
    layoutMode: analysis.layoutMode ?? "tuned",
    instructionCount: analysis.program.length,
    conditionalDecisionCount: analysis.nodeRoles.filter((role) => role === "conditionalJump").length,
    detectBranchMergeRegionsCalled:
      analysis.branchMergeDebug?.detectBranchMergeRegionsCalled ?? false,
    branchMergeRegionAuditLength: branchMergeAuditRows.length,
    branchMergeRegionsLength: (analysis.branchMergeRegions ?? []).length,
  };

  return {
    identity,
    summary: {
      selectedFunctionId,
      selectedExampleName: identity.selectedExampleName,
      motifHintKind: visualRoles.metadata.motifHintKind,
      instructionCount: analysis.program.length,
      layoutMode: analysis.layoutMode ?? "tuned",
      effectiveGeneratedLayoutMode: identity.effectiveGeneratedLayoutMode ?? null,
      generatedStrategy: identity.generatedStrategy ?? null,
      hasTunedLayout: identity.hasTunedLayout ?? null,
      layoutStatus: identity.layoutStatus ?? null,
      edgeCount: analysis.edges.length,
      setupBoundary: visualRoles.metadata.setupBoundary,
      branchMergeRegionCount: branchMergeRows.length,
      branchMergeAuditDecisionCount: branchMergeAuditRows.length,
      conditionalDecisionCount: branchMergeDataFlow.conditionalDecisionCount,
      detectBranchMergeRegionsCalled: branchMergeDataFlow.detectBranchMergeRegionsCalled,
    },
    nodeRows,
    edgeRows,
    regionRows,
    loopRows,
    branchMergeRows,
    branchMergeAuditRows,
    branchMergeDataFlow,
  };
}

function emitVisualRoleDebugReport(analysis, selectedFunctionId = "") {
  const report = formatVisualRoleDebugReport(analysis, selectedFunctionId);

  if (typeof console !== "undefined") {
    console.groupCollapsed(
      `[beta-flow-roles] ${selectedFunctionId || "unknown"} | motif=${report.summary.motifHintKind}`,
    );
    console.log(report.summary);
    console.table(report.nodeRows);
    console.table(report.edgeRows);
    console.table(report.regionRows);
    console.table(report.loopRows);
    if (report.branchMergeRows.length > 0) {
      console.table(report.branchMergeRows);
    }
    if (report.branchMergeAuditRows.length > 0) {
      console.table(report.branchMergeAuditRows);
    }
    console.log("branchMergeDataFlow", report.branchMergeDataFlow);
    console.groupEnd();
  }

  if (typeof window !== "undefined") {
    window.__betaFlowVisualRoles = report;
    window.__betaFlowBranchMergeDataFlow = report.branchMergeDataFlow;
    window.__betaFlowBranchMergeDataFlow.identity = report.identity;
    appendBetaFlowDebugReportHistory(
      "visualRoles",
      report.identity,
      report.summary,
      buildDebugHistoryDiagnostics("visualRoles", report),
    );
  }
}

function buildLoopLaneMap(loopIntervals) {
  const laneByEdgeId = new Map();

  loopIntervals.forEach((interval) => {
    const containedLoopCount = loopIntervals.filter(
      (candidate) =>
        candidate.edgeId !== interval.edgeId &&
        interval.startIndex <= candidate.startIndex &&
        candidate.endIndex <= interval.endIndex,
    ).length;

    laneByEdgeId.set(interval.edgeId, containedLoopCount);
  });

  return laneByEdgeId;
}

function detectTextbookLoopMotifs(edges, nodeRoles) {
  return edges
    .filter((edge) => edge.edgeRole === "unconditionalLoopReturn")
    .map((returnEdge) => {
      const testIndex = returnEdge.targetIndex;
      const returnIndex = returnEdge.sourceIndex;

      if (
        !Number.isInteger(testIndex) ||
        !Number.isInteger(returnIndex) ||
        returnIndex <= testIndex ||
        nodeRoles[testIndex] !== "conditionalJump"
      ) {
        return null;
      }

      const testEdges = edges.filter((edge) => edge.sourceIndex === testIndex);
      const exitEdge = testEdges.find((edge) => edge.routeKind === "earlyExitToHalt");
      const continueEdge = testEdges.find((edge) => edge.targetIndex === testIndex + 1);

      if (!exitEdge || !continueEdge) return null;

      return {
        testIndex,
        bodyStartIndex: testIndex + 1,
        returnIndex,
        exitEdgeId: exitEdge.id,
        continueEdgeId: continueEdge.id,
        returnEdgeId: returnEdge.id,
      };
    })
    .filter(Boolean);
}

function getOutgoingEdges(edges, sourceIndex) {
  return edges.filter((edge) => edge.sourceIndex === sourceIndex);
}

function walkSimpleForwardPath(analysis, startIndex, sourceIndex, maxSteps = 16) {
  if (
    !Number.isInteger(startIndex) ||
    startIndex < 0 ||
    startIndex >= analysis.program.length
  ) {
    return [];
  }

  const path = [];
  const visited = new Set();
  let currentIndex = startIndex;

  while (
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < analysis.program.length &&
    !visited.has(currentIndex) &&
    path.length < maxSteps
  ) {
    visited.add(currentIndex);
    path.push(currentIndex);

    if (analysis.nodeRoles[currentIndex] === "conditionalJump") break;

    const outgoingEdges = getOutgoingEdges(analysis.edges, currentIndex);
    if (outgoingEdges.length !== 1) break;

    const [nextEdge] = outgoingEdges;
    if (
      !Number.isInteger(nextEdge.targetIndex) ||
      nextEdge.targetIndex <= currentIndex ||
      nextEdge.targetIndex < 0 ||
      nextEdge.targetIndex >= analysis.program.length
    ) {
      break;
    }

    currentIndex = nextEdge.targetIndex;
  }

  return path.filter((index) => index > sourceIndex);
}

function detectBranchMergeRegions(analysis) {
  const regions = [];
  const auditRows = [];
  const decisionIndexes = analysis.nodeRoles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role === "conditionalJump")
    .map(({ index }) => index);

  decisionIndexes.forEach((sourceIndex) => {
    const outgoingEdges = getOutgoingEdges(analysis.edges, sourceIndex).filter((edge) => (
      Number.isInteger(edge.targetIndex)
    ));
    const candidateEdges = outgoingEdges.filter((edge) => (
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex >= 0 &&
      edge.targetIndex < analysis.program.length &&
      edge.targetIndex > sourceIndex
    ));
    const fallthroughEdge = candidateEdges.find((edge) => edge.targetIndex === sourceIndex + 1) ?? null;
    const candidateBranchPaths = candidateEdges.map((edge) => ({
      edgeId: edge.id,
      branch: edge.branch ?? null,
      routeKind: edge.routeKind ?? null,
      startIndex: edge.targetIndex,
      startNode: formatInstructionNodeId(edge.targetIndex),
      forwardPath: walkSimpleForwardPath(analysis, edge.targetIndex, sourceIndex),
    }));
    const preferredPair = (() => {
      if (fallthroughEdge) {
        const other = candidateEdges.find((edge) => edge.id !== fallthroughEdge.id) ?? null;
        if (other) return [fallthroughEdge, other];
      }

      if (candidateEdges.length >= 2) {
        return [candidateEdges[0], candidateEdges[1]];
      }

      return null;
    })();
    const auditRow = {
      decisionIndex: sourceIndex,
      decisionNode: formatInstructionNodeId(sourceIndex),
      outgoingBranches: outgoingEdges.map((edge) => ({
        edgeId: edge.id,
        branch: edge.branch ?? null,
        routeKind: edge.routeKind ?? null,
        targetIndex: edge.targetIndex,
        targetNode: Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : null,
      })),
      candidateBranchPaths,
      shortBranchTarget: null,
      longBranchStart: null,
      fallthroughStart: Number.isInteger(sourceIndex + 1) ? sourceIndex + 1 : null,
      jumpStart: null,
      fallthroughPath: [],
      jumpPath: [],
      sharedForwardCandidates: [],
      hasSharedForwardInstruction: false,
      longBranchPath: [],
      mergeIndex: null,
      longBranchExitIndex: null,
      detectionStatus: "notDetected",
      detectionReason: "insufficientForwardBranchTargets",
    };

    if (!preferredPair) {
      auditRows.push(auditRow);
      return;
    }

    const [armAEdge, armBEdge] = preferredPair;
    const armAStart = armAEdge.targetIndex;
    const armBStart = armBEdge.targetIndex;
    const armAPath = walkSimpleForwardPath(analysis, armAStart, sourceIndex);
    const armBPath = walkSimpleForwardPath(analysis, armBStart, sourceIndex);
    const armBReachable = new Set(armBPath);
    const sharedIndexes = armAPath
      .filter((index) => armBReachable.has(index))
      .sort((left, right) => left - right);

    const armAIsFallthrough = armAStart === sourceIndex + 1;
    const armBIsFallthrough = armBStart === sourceIndex + 1;
    const fallthroughStart = armAIsFallthrough
      ? armAStart
      : armBIsFallthrough
        ? armBStart
        : armAStart;
    const jumpStart = armAIsFallthrough
      ? armBStart
      : armBIsFallthrough
        ? armAStart
        : armBStart;
    const fallthroughPath = armAIsFallthrough
      ? armAPath
      : armBIsFallthrough
        ? armBPath
        : armAPath;
    const jumpPath = armAIsFallthrough
      ? armBPath
      : armBIsFallthrough
        ? armAPath
        : armBPath;

    auditRow.jumpStart = jumpStart;
    auditRow.fallthroughPath = [...fallthroughPath];
    auditRow.jumpPath = [...jumpPath];
    auditRow.sharedForwardCandidates = [...sharedIndexes];
    auditRow.hasSharedForwardInstruction = sharedIndexes.length > 0;

    let mergeIndex = sharedIndexes[0];
    let fallthroughArm = [];
    let jumpArm = [];
    let longBranchStart = null;
    let longBranchPath = [];
    let longBranchExitIndex = null;
    let shortBranchTarget = null;
    let detectionReason = "sharedForwardNode";

    if (Number.isInteger(mergeIndex)) {
      const fallthroughMergeOffset = fallthroughPath.indexOf(mergeIndex);
      const jumpMergeOffset = jumpPath.indexOf(mergeIndex);
      fallthroughArm = fallthroughPath.slice(0, fallthroughMergeOffset);
      jumpArm = jumpPath.slice(0, jumpMergeOffset);
      const fallthroughArmLength = fallthroughArm.length;
      const jumpArmLength = jumpArm.length;
      const longIsFallthrough = fallthroughArmLength >= jumpArmLength;
      longBranchStart = longIsFallthrough ? fallthroughStart : jumpStart;
      longBranchPath = longIsFallthrough ? [...fallthroughArm] : [...jumpArm];
      longBranchExitIndex = longBranchPath.length > 0
        ? longBranchPath[longBranchPath.length - 1]
        : longBranchStart;
      shortBranchTarget = longIsFallthrough ? jumpStart : fallthroughStart;
    } else {
      const fallthroughIsLong = fallthroughPath.length >= jumpPath.length;
      const longStart = fallthroughIsLong ? fallthroughStart : jumpStart;
      const shortStart = fallthroughIsLong ? jumpStart : fallthroughStart;
      const longPath = fallthroughIsLong ? fallthroughPath : jumpPath;
      let convergenceFromIndex = null;

      for (let pathIndex = longPath.length - 1; pathIndex >= 0; pathIndex -= 1) {
        const nodeIndex = longPath[pathIndex];
        const reachesShortStart = getOutgoingEdges(analysis.edges, nodeIndex).some((edge) => (
          Number.isInteger(edge.targetIndex) &&
          edge.targetIndex === shortStart &&
          edge.targetIndex > nodeIndex
        ));
        if (reachesShortStart) {
          convergenceFromIndex = nodeIndex;
          break;
        }
      }

      if (!Number.isInteger(convergenceFromIndex)) {
        auditRow.shortBranchTarget = shortStart;
        auditRow.longBranchStart = longStart;
        auditRow.longBranchPath = [...longPath];
        auditRow.detectionReason = "noSharedForwardNodeOrDirectConvergence";
        auditRows.push(auditRow);
        return;
      }

      mergeIndex = shortStart;
      longBranchStart = longStart;
      shortBranchTarget = shortStart;
      longBranchPath = [...longPath];
      longBranchExitIndex = convergenceFromIndex;
      detectionReason = "directShortTargetConvergence";

      if (fallthroughIsLong) {
        fallthroughArm = [...longPath];
        jumpArm = [];
      } else {
        fallthroughArm = [];
        jumpArm = [...longPath];
      }
    }

    const region = {
      type: "branchMerge",
      sourceIndex,
      fallthroughStart,
      jumpStart,
      mergeIndex,
      fallthroughArm,
      jumpArm,
      continuation: walkSimpleForwardPath(analysis, mergeIndex, sourceIndex),
      shortBranchTarget,
      longBranchStart,
      longBranchPath,
      longBranchExitIndex,
      detectionReason,
    };
    regions.push(region);

    auditRows.push({
      ...auditRow,
      shortBranchTarget,
      longBranchStart,
      longBranchPath: [...longBranchPath],
      mergeIndex,
      longBranchExitIndex,
      detectionStatus: "detected",
      detectionReason,
    });
  });

  return { regions, auditRows };
}

function buildGeneratedScanRegionDecomposition(analysis, layoutMode = "tuned") {
  const isGeneratedLike = layoutMode === "generated" || layoutMode === "generatedScanV2";
  if (!isGeneratedLike) {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGenerated",
      steps: [],
      runs: [],
      pendingForwardJumpEvents: [],
      mergeAttachmentEvents: [],
      backwardClosureEvents: [],
      candidateRegions: [],
      comparisonWithDetectedLoopIntervals: {
        exactMatches: [],
        scanOnlyRegions: [],
        loopDetectionOnlyRegions: [],
        nestedContainmentRelationships: [],
      },
      summary: {
        runCount: 0,
        pendingForwardJumpCount: 0,
        resolvedForwardJumpCount: 0,
        mergeAttachmentCount: 0,
        backwardClosureCount: 0,
        obligatoryBackwardClosureCount: 0,
        conditionalBackwardClosureCount: 0,
        candidateRegionCount: 0,
        maxRegionNestingDepth: 0,
      },
    };
  }

  const programLength = analysis?.program?.length ?? 0;
  const outgoingBySource = new Map();
  (analysis?.edges ?? []).forEach((edge) => {
    if (!Number.isInteger(edge.sourceIndex)) return;
    if (!outgoingBySource.has(edge.sourceIndex)) outgoingBySource.set(edge.sourceIndex, []);
    outgoingBySource.get(edge.sourceIndex).push(edge);
  });

  const pendingForwardByTarget = new Map();
  const pendingForwardJumpEvents = [];
  const resolvedForwardJumpEvents = [];
  const mergeAttachmentEvents = [];
  const backwardClosureEvents = [];
  const steps = [];
  const runs = [];
  let runStartIndex = 0;
  let runResolvedPendingEdgeIds = [];

  const formatEdgeDescriptor = (edge) => {
    const isBackward = isBackwardEdge(edge);
    const isForward = isForwardEdge(edge);
    const isTerminal = isHaltExitEdge(edge, programLength);
    const direction = isTerminal
      ? "terminal"
      : isBackward
        ? "backward"
        : isForward
          ? "forward"
          : "selfOrUnknown";

    return {
      edgeId: edge.id,
      type: edge.type ?? null,
      edgeRole: edge.edgeRole ?? null,
      routeKind: edge.routeKind ?? null,
      sourceIndex: edge.sourceIndex ?? null,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      targetNode: Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : "HALT",
      direction,
      branch: edge.branch ?? null,
      isUnconditionalBackwardClosure:
        direction === "backward" &&
        analysis?.nodeRoles?.[edge.sourceIndex] === "unconditionalJump",
    };
  };

  for (let index = 0; index < programLength; index += 1) {
    const instruction = analysis.program[index];
    const instructionKind = analysis.nodeRoles[index];
    const outgoing = outgoingBySource.get(index) ?? [];
    const fallthroughEdge = outgoing.find((edge) => edge.type === "fallthrough") ?? null;
    const jumpEdges = outgoing.filter((edge) => edge.type === "jump");
    const pendingResolved = pendingForwardByTarget.get(index) ?? [];
    if (pendingResolved.length > 0) {
      pendingForwardByTarget.delete(index);
    }

    const loopStack = (analysis.loopIntervals ?? [])
      .filter((interval) => interval.startIndex <= index && index <= interval.endIndex)
      .sort((left, right) => left.length - right.length)
      .map((interval) => ({
        interval: `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`,
        header: formatInstructionNodeId(interval.headerIndex),
        return: formatInstructionNodeId(interval.returnIndex),
        depth: interval.depth ?? 0,
        edgeId: interval.edgeId,
      }));

    const pendingOpened = [];
    const backwardClosuresAtInstruction = [];
    jumpEdges.forEach((edge) => {
      const descriptor = formatEdgeDescriptor(edge);
      const isDeferredForwardJump = descriptor.direction === "forward" &&
        Number.isInteger(descriptor.targetIndex) &&
        descriptor.targetIndex > descriptor.sourceIndex + 1;
      if (isDeferredForwardJump) {
        const pendingEntry = {
          edgeId: descriptor.edgeId,
          sourceIndex: descriptor.sourceIndex,
          targetIndex: descriptor.targetIndex,
          branch: descriptor.branch,
          routeKind: descriptor.routeKind,
        };
        if (!pendingForwardByTarget.has(descriptor.targetIndex)) {
          pendingForwardByTarget.set(descriptor.targetIndex, []);
        }
        pendingForwardByTarget.get(descriptor.targetIndex).push(pendingEntry);
        pendingOpened.push(pendingEntry);
        pendingForwardJumpEvents.push({
          event: "openPendingForwardJump",
          atInstruction: index,
          edgeId: descriptor.edgeId,
          sourceIndex: descriptor.sourceIndex,
          targetIndex: descriptor.targetIndex,
          branch: descriptor.branch ?? null,
          routeKind: descriptor.routeKind ?? null,
        });
      } else if (descriptor.direction === "backward") {
        const closureEvent = {
          edgeId: descriptor.edgeId,
          sourceIndex: descriptor.sourceIndex,
          targetIndex: descriptor.targetIndex,
          branch: descriptor.branch ?? null,
          routeKind: descriptor.routeKind ?? null,
          instructionKind,
          closureKind: descriptor.isUnconditionalBackwardClosure
            ? "obligatoryBackwardClosure"
            : "conditionalBackwardClosure",
          closedInterval: Number.isInteger(descriptor.targetIndex)
            ? `${formatInstructionNodeId(descriptor.targetIndex)}-${formatInstructionNodeId(descriptor.sourceIndex)}`
            : null,
        };
        backwardClosureEvents.push(closureEvent);
        backwardClosuresAtInstruction.push(closureEvent);
      }
    });

    const resolvedDescriptors = pendingResolved.map((entry) => ({
      edgeId: entry.edgeId,
      sourceIndex: entry.sourceIndex,
      targetIndex: entry.targetIndex,
      branch: entry.branch ?? null,
      routeKind: entry.routeKind ?? null,
    }));
    if (resolvedDescriptors.length > 0) {
      resolvedForwardJumpEvents.push({
        event: "resolvePendingForwardJumps",
        atInstruction: index,
        targetNode: formatInstructionNodeId(index),
        resolvedPendingEdges: resolvedDescriptors.map((entry) => entry.edgeId),
        resolvedFromSources: resolvedDescriptors.map((entry) => entry.sourceIndex),
      });
    }
    if (resolvedDescriptors.length > 1) {
      mergeAttachmentEvents.push({
        event: "mergeAttachment",
        atInstruction: index,
        targetNode: formatInstructionNodeId(index),
        resolvedPendingEdges: resolvedDescriptors.map((entry) => entry.edgeId),
        resolvedFromSources: resolvedDescriptors.map((entry) => entry.sourceIndex),
      });
    }

    runResolvedPendingEdgeIds.push(...resolvedDescriptors.map((entry) => entry.edgeId));

    const step = {
      instructionIndex: index,
      nodeId: formatInstructionNodeId(index),
      instructionLabel: formatInstruction(instruction),
      instructionKind,
      fallthroughEdge: fallthroughEdge ? formatEdgeDescriptor(fallthroughEdge) : null,
      jumpEdges: jumpEdges.map(formatEdgeDescriptor),
      pendingForwardJumpsOpened: pendingOpened,
      pendingForwardJumpsResolved: resolvedDescriptors,
      mergeAttachmentEvent:
        resolvedDescriptors.length > 1
          ? {
            targetIndex: index,
            resolvedPendingEdges: resolvedDescriptors.map((entry) => entry.edgeId),
          }
          : null,
      backwardClosureEvents: backwardClosuresAtInstruction,
      activeRegionStack: loopStack,
      pendingForwardTargetCount: pendingForwardByTarget.size,
    };
    steps.push(step);

    const obligatoryClosure = backwardClosuresAtInstruction.find(
      (event) => event.closureKind === "obligatoryBackwardClosure",
    ) ?? null;
    if (obligatoryClosure) {
      runs.push({
        runIndex: runs.length,
        startIndex: runStartIndex,
        endIndex: index,
        interval: `${formatInstructionNodeId(runStartIndex)}-${formatInstructionNodeId(index)}`,
        closureEdgeId: obligatoryClosure.edgeId,
        closureSourceIndex: obligatoryClosure.sourceIndex,
        closureTargetIndex: obligatoryClosure.targetIndex,
        loopOrRegionIntervalClosed: obligatoryClosure.closedInterval,
        pendingForwardJumpsResolvedInRun: [...runResolvedPendingEdgeIds],
        pendingForwardJumpsResolvedAtRunStart: steps
          .find((row) => row.instructionIndex === runStartIndex)
          ?.pendingForwardJumpsResolved
          ?.map((entry) => entry.edgeId) ?? [],
        parentRegion: null,
      });
      runStartIndex = index + 1;
      runResolvedPendingEdgeIds = [];
    }
  }

  if (runStartIndex < programLength) {
    runs.push({
      runIndex: runs.length,
      startIndex: runStartIndex,
      endIndex: programLength - 1,
      interval: `${formatInstructionNodeId(runStartIndex)}-${formatInstructionNodeId(programLength - 1)}`,
      closureEdgeId: null,
      closureSourceIndex: null,
      closureTargetIndex: null,
      loopOrRegionIntervalClosed: null,
      pendingForwardJumpsResolvedInRun: [...runResolvedPendingEdgeIds],
      pendingForwardJumpsResolvedAtRunStart: steps
        .find((row) => row.instructionIndex === runStartIndex)
        ?.pendingForwardJumpsResolved
        ?.map((entry) => entry.edgeId) ?? [],
      parentRegion: null,
    });
  }

  const obligatoryClosures = backwardClosureEvents
    .filter((event) => event.closureKind === "obligatoryBackwardClosure")
    .map((event, idx) => ({
      id: `scan-region-${idx}`,
      startIndex: event.targetIndex,
      endIndex: event.sourceIndex,
      closureEdgeId: event.edgeId,
      closureKind: event.closureKind,
      parentId: null,
      children: [],
      depth: 0,
    }))
    .filter((region) => (
      Number.isInteger(region.startIndex) &&
      Number.isInteger(region.endIndex) &&
      region.startIndex <= region.endIndex
    ));

  obligatoryClosures.forEach((region) => {
    const parent = obligatoryClosures
      .filter((candidate) => (
        candidate.id !== region.id &&
        candidate.startIndex <= region.startIndex &&
        region.endIndex <= candidate.endIndex
      ))
      .sort((left, right) => (
        (left.endIndex - left.startIndex) - (right.endIndex - right.startIndex)
      ))[0] ?? null;
    region.parentId = parent?.id ?? null;
  });
  obligatoryClosures.forEach((region) => {
    if (!region.parentId) return;
    const parent = obligatoryClosures.find((candidate) => candidate.id === region.parentId);
    if (parent) parent.children.push(region.id);
  });
  const computeDepth = (region) => {
    if (!region.parentId) return 0;
    const parent = obligatoryClosures.find((candidate) => candidate.id === region.parentId);
    return parent ? computeDepth(parent) + 1 : 0;
  };
  obligatoryClosures.forEach((region) => {
    region.depth = computeDepth(region);
  });

  const regionByRangeKey = new Map();
  obligatoryClosures.forEach((region) => {
    const key = `${region.startIndex}-${region.endIndex}`;
    if (!regionByRangeKey.has(key)) {
      regionByRangeKey.set(key, region);
    }
  });
  const candidateRegions = Array.from(regionByRangeKey.values())
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex)
    .map((region) => ({
      id: region.id,
      interval: `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
      startIndex: region.startIndex,
      endIndex: region.endIndex,
      closureEdgeId: region.closureEdgeId,
      parentRegionId: region.parentId,
      depth: region.depth,
      children: region.children,
    }));

  const regionById = new Map(candidateRegions.map((region) => [region.id, region]));
  runs.forEach((run) => {
    if (!Number.isInteger(run.closureTargetIndex) || !Number.isInteger(run.closureSourceIndex)) return;
    const owner = candidateRegions.find((region) => (
      region.startIndex === run.closureTargetIndex &&
      region.endIndex === run.closureSourceIndex
    )) ?? null;
    run.parentRegion = owner?.parentRegionId ?? null;
  });

  const detectedLoopIntervals = (analysis.loopIntervals ?? [])
    .map((interval) => ({
      key: `${interval.startIndex}-${interval.endIndex}`,
      interval: `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`,
      startIndex: interval.startIndex,
      endIndex: interval.endIndex,
      edgeId: interval.edgeId,
      depth: interval.depth ?? 0,
    }));
  const detectedLoopKeySet = new Set(detectedLoopIntervals.map((interval) => interval.key));
  const scanRegionKeySet = new Set(candidateRegions.map((region) => `${region.startIndex}-${region.endIndex}`));
  const exactMatches = candidateRegions
    .filter((region) => detectedLoopKeySet.has(`${region.startIndex}-${region.endIndex}`))
    .map((region) => region.interval);
  const scanOnlyRegions = candidateRegions
    .filter((region) => !detectedLoopKeySet.has(`${region.startIndex}-${region.endIndex}`))
    .map((region) => region.interval);
  const loopDetectionOnlyRegions = detectedLoopIntervals
    .filter((interval) => !scanRegionKeySet.has(interval.key))
    .map((interval) => interval.interval);
  const nestedContainmentRelationships = candidateRegions
    .filter((region) => region.parentRegionId)
    .map((region) => ({
      child: region.interval,
      parent: regionById.get(region.parentRegionId)?.interval ?? null,
      childDepth: region.depth,
      parentDepth: regionById.get(region.parentRegionId)?.depth ?? null,
    }));

  const summary = {
    runCount: runs.length,
    pendingForwardJumpCount: pendingForwardJumpEvents.length,
    resolvedForwardJumpCount: resolvedForwardJumpEvents.reduce(
      (sum, event) => sum + (event.resolvedPendingEdges?.length ?? 0),
      0,
    ),
    mergeAttachmentCount: mergeAttachmentEvents.length,
    backwardClosureCount: backwardClosureEvents.length,
    obligatoryBackwardClosureCount: backwardClosureEvents.filter(
      (event) => event.closureKind === "obligatoryBackwardClosure",
    ).length,
    conditionalBackwardClosureCount: backwardClosureEvents.filter(
      (event) => event.closureKind === "conditionalBackwardClosure",
    ).length,
    candidateRegionCount: candidateRegions.length,
    maxRegionNestingDepth: candidateRegions.reduce(
      (maxDepth, region) => Math.max(maxDepth, region.depth ?? 0),
      0,
    ),
  };

  return {
    enabled: true,
    skippedReason: null,
    steps,
    runs,
    pendingForwardJumpEvents,
    resolvedForwardJumpEvents,
    mergeAttachmentEvents,
    backwardClosureEvents,
    candidateRegions,
    comparisonWithDetectedLoopIntervals: {
      exactMatches,
      scanOnlyRegions,
      loopDetectionOnlyRegions,
      nestedContainmentRelationships,
    },
    summary,
  };
}

function buildGeneratedScanLayoutPlan(scanDecomposition, analysis, layoutMode = "tuned") {
  const isGeneratedLike = layoutMode === "generated" || layoutMode === "generatedScanV2";
  if (!isGeneratedLike) {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGenerated",
      runs: [],
      regions: [],
      edges: [],
      summary: {
        runRoleCounts: {},
        regionRoleCounts: {},
        edgeClassCounts: {},
        laneTypeCounts: {},
        edgesMissingOwnerCount: 0,
        edgesMissingOwner: [],
        regionsMissingParentWhenExpectedCount: 0,
        regionsMissingParentWhenExpected: [],
      },
      suggestedMajorLayoutSkeleton: null,
    };
  }
  if (!scanDecomposition?.enabled) {
    return {
      enabled: false,
      skippedReason: "scanDecompositionUnavailable",
      runs: [],
      regions: [],
      edges: [],
      summary: {
        runRoleCounts: {},
        regionRoleCounts: {},
        edgeClassCounts: {},
        laneTypeCounts: {},
        edgesMissingOwnerCount: 0,
        edgesMissingOwner: [],
        regionsMissingParentWhenExpectedCount: 0,
        regionsMissingParentWhenExpected: [],
      },
      suggestedMajorLayoutSkeleton: null,
    };
  }

  const runs = scanDecomposition.runs ?? [];
  const candidateRegions = scanDecomposition.candidateRegions ?? [];
  const backwardClosures = scanDecomposition.backwardClosureEvents ?? [];
  const mergeEvents = scanDecomposition.mergeAttachmentEvents ?? [];
  const resolvedEvents = scanDecomposition.resolvedForwardJumpEvents ?? [];
  const pendingOpenEvents = scanDecomposition.pendingForwardJumpEvents ?? [];
  const detectedLoops = analysis.loopIntervals ?? [];

  const firstDecisionIndex = analysis.nodeRoles.findIndex((role) => role === "conditionalJump");
  const topLevelRegionStart = candidateRegions
    .filter((region) => !region.parentRegionId && Number.isInteger(region.startIndex))
    .sort((left, right) => left.startIndex - right.startIndex)[0]?.startIndex ?? null;
  const firstMainLoopStart = Number.isInteger(topLevelRegionStart) ? topLevelRegionStart : firstDecisionIndex;
  const resolvedTargetSet = new Set(resolvedEvents.map((event) => event.atInstruction));
  const mergeTargetSet = new Set(mergeEvents.map((event) => event.atInstruction));
  const backwardClosureBySource = new Map(
    backwardClosures
      .filter((event) => Number.isInteger(event.sourceIndex))
      .map((event) => [event.sourceIndex, event]),
  );
  const candidateRegionByRange = new Map(
    candidateRegions.map((region) => [`${region.startIndex}-${region.endIndex}`, region]),
  );

  const deriveSplitRuns = () => {
    const baseRuns = [...runs].sort((left, right) => (
      (left.startIndex - right.startIndex) || (left.endIndex - right.endIndex)
    ));
    const derivedRuns = [];
    let runsSplitCount = 0;

    const addBoundaryReason = (boundaryReasons, boundary, reason) => {
      if (!Number.isInteger(boundary)) return;
      if (!boundaryReasons.has(boundary)) boundaryReasons.set(boundary, new Set());
      boundaryReasons.get(boundary).add(reason);
    };

    baseRuns.forEach((baseRun, baseRunIndex) => {
      const runStart = baseRun.startIndex;
      const runEnd = baseRun.endIndex;
      if (!Number.isInteger(runStart) || !Number.isInteger(runEnd) || runStart > runEnd) return;

      const boundaryReasons = new Map();
      const boundaries = new Set([runStart, runEnd + 1]);
      addBoundaryReason(boundaryReasons, runStart, "baseRunStart");

      const addBoundary = (boundary, reason) => {
        if (!Number.isInteger(boundary)) return;
        if (boundary <= runStart || boundary > runEnd) return;
        boundaries.add(boundary);
        addBoundaryReason(boundaryReasons, boundary, reason);
      };

      if (Number.isInteger(firstMainLoopStart)) {
        addBoundary(firstMainLoopStart, "mainLoopStartBoundary");
      }

      candidateRegions.forEach((region) => {
        addBoundary(region.startIndex, `regionStart:${region.id}`);
        addBoundary(region.endIndex + 1, `regionEnd:${region.id}`);
      });

      resolvedTargetSet.forEach((targetIndex) => {
        addBoundary(targetIndex, `resolvedForwardTarget:${targetIndex}`);
      });
      mergeTargetSet.forEach((targetIndex) => {
        addBoundary(targetIndex, `mergeTarget:${targetIndex}`);
      });

      backwardClosures.forEach((closure) => {
        if (!Number.isInteger(closure.sourceIndex)) return;
        addBoundary(closure.sourceIndex + 1, `closureAfter:${closure.edgeId}`);
      });

      const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
      const segmentCount = Math.max(sortedBoundaries.length - 1, 0);
      runsSplitCount += Math.max(0, segmentCount - 1);

      for (let segmentIndex = 0; segmentIndex < sortedBoundaries.length - 1; segmentIndex += 1) {
        const startIndex = sortedBoundaries[segmentIndex];
        const endIndex = sortedBoundaries[segmentIndex + 1] - 1;
        if (startIndex > endIndex) continue;
        const splitReasons = Array.from(boundaryReasons.get(startIndex) ?? []).filter(
          (reason) => reason !== "baseRunStart",
        );
        const overlappingRegions = candidateRegions.filter((region) => !(
          region.endIndex < startIndex || endIndex < region.startIndex
        ));
        const coarseRunWarnings = [];
        if (segmentCount === 1 && endIndex - startIndex + 1 >= 10) {
          coarseRunWarnings.push("longUnsplitBaseRun");
        }
        if (overlappingRegions.length > 2 && endIndex - startIndex + 1 >= 8) {
          coarseRunWarnings.push("spansMultipleCandidateRegions");
        }

        derivedRuns.push({
          sourceRunId: `scan-source-run-${baseRunIndex}`,
          sourceRunIndex: baseRunIndex,
          sourceRunInterval: baseRun.interval,
          sourceRunStartIndex: runStart,
          sourceRunEndIndex: runEnd,
          segmentationSource: segmentCount > 1 ? "splitFromBaseRun" : "baseScanRun",
          splitReasons,
          coarseRunWarnings,
          startIndex,
          endIndex,
          interval: `${formatInstructionNodeId(startIndex)}-${formatInstructionNodeId(endIndex)}`,
          closureEdgeId: baseRun.closureEdgeId ?? null,
          closureSourceIndex: baseRun.closureSourceIndex ?? null,
          closureTargetIndex: baseRun.closureTargetIndex ?? null,
          loopOrRegionIntervalClosed: baseRun.loopOrRegionIntervalClosed ?? null,
          pendingForwardJumpsResolvedInRun: baseRun.pendingForwardJumpsResolvedInRun ?? [],
          pendingForwardJumpsResolvedAtRunStart: baseRun.pendingForwardJumpsResolvedAtRunStart ?? [],
        });
      }
    });

    return {
      derivedRuns,
      runsSplitCount,
      coarseRunWarningCount: derivedRuns.filter(
        (run) => Array.isArray(run.coarseRunWarnings) && run.coarseRunWarnings.length > 0,
      ).length,
    };
  };

  const { derivedRuns, runsSplitCount, coarseRunWarningCount } = deriveSplitRuns();

  const classifyRunRole = (run, ownerRegion) => {
    if (!Number.isInteger(run.startIndex) || !Number.isInteger(run.endIndex)) return "continuationRun";
    if (run.closureEdgeId === null && run.endIndex === analysis.program.length - 1) {
      return "exitTailRun";
    }
    if (
      Number.isInteger(firstMainLoopStart) &&
      run.startIndex < firstMainLoopStart &&
      run.endIndex < firstMainLoopStart
    ) {
      return "setupRun";
    }
    if (mergeTargetSet.has(run.startIndex) || mergeTargetSet.has(run.endIndex)) {
      return "mergeRun";
    }
    const exactRegion = candidateRegionByRange.get(`${run.startIndex}-${run.endIndex}`) ?? null;
    const closureAtRunEnd = backwardClosureBySource.get(run.endIndex) ?? null;
    const ownerDepth = ownerRegion?.depth ?? 0;
    if (exactRegion && (exactRegion.depth ?? 0) >= 2) return "nestedLoopRun";
    if (closureAtRunEnd && (closureAtRunEnd.closureKind === "obligatoryBackwardClosure")) {
      if (ownerDepth >= 2) return "nestedLoopRun";
      return "loopBodyRun";
    }
    if (resolvedTargetSet.has(run.startIndex)) return "continuationRun";
    if (ownerDepth >= 1) return "loopBodyRun";
    return "continuationRun";
  };

  const runPlacementIntentForRole = (runRole, run, ownerRegion) => {
    switch (runRole) {
      case "setupRun":
      case "loopBodyRun":
        return "main column";
      case "nestedLoopRun":
        return "inner island";
      case "mergeRun":
        return "right island";
      case "exitTailRun":
        return "outer exit corridor";
      case "continuationRun":
      default:
        if (!ownerRegion) return "outer exit corridor";
        if (resolvedTargetSet.has(run.startIndex)) return "main column";
        return "main column";
    }
  };

  const scanRuns = derivedRuns.map((run, index) => {
    const parentRegion = candidateRegions.filter((region) => (
      Number.isInteger(region.startIndex) &&
      Number.isInteger(region.endIndex) &&
      region.startIndex <= run.startIndex &&
      run.endIndex <= region.endIndex
    ))
      .sort((left, right) => (
        (right.depth ?? 0) - (left.depth ?? 0) ||
        (left.endIndex - left.startIndex) - (right.endIndex - right.startIndex)
      ))[0] ?? null;
    const roleResolved = classifyRunRole(run, parentRegion);
    return {
      runId: `scan-run-${index}`,
      interval: run.interval,
      startIndex: run.startIndex,
      endIndex: run.endIndex,
      parentRegionId: parentRegion?.id ?? null,
      nestingDepth: parentRegion?.depth ?? 0,
      role: roleResolved,
      placementIntent: runPlacementIntentForRole(roleResolved, run, parentRegion),
      closureEdgeId: run.closureEdgeId ?? null,
      loopOrRegionIntervalClosed: run.loopOrRegionIntervalClosed ?? null,
      resolvedPendingAtRunStart: run.pendingForwardJumpsResolvedAtRunStart ?? [],
      resolvedPendingInRun: run.pendingForwardJumpsResolvedInRun ?? [],
      sourceRunId: run.sourceRunId,
      sourceRunInterval: run.sourceRunInterval,
      segmentationSource: run.segmentationSource,
      splitReasons: run.splitReasons ?? [],
      coarseRunWarnings: run.coarseRunWarnings ?? [],
    };
  });

  const classifyRegionRole = (region) => {
    const hasChildren = Array.isArray(region.children) && region.children.length > 0;
    if (!region.parentRegionId && hasChildren) return "outerLoopRegion";
    if (region.depth >= 1) return "nestedLoopIsland";
    return "continuationRegion";
  };

  const regionEntriesExits = candidateRegions.map((region) => {
    const entryNodes = [];
    const exitNodes = [];
    const mergeTargetsInside = [];
    const mergeTargetsAfter = [];
    analysis.edges.forEach((edge) => {
      if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return;
      const sourceInside = region.startIndex <= edge.sourceIndex && edge.sourceIndex <= region.endIndex;
      const targetInside = region.startIndex <= edge.targetIndex && edge.targetIndex <= region.endIndex;
      if (!sourceInside && targetInside) entryNodes.push(edge.targetIndex);
      if (sourceInside && !targetInside) exitNodes.push(edge.sourceIndex);
    });
    mergeEvents.forEach((event) => {
      if (region.startIndex <= event.atInstruction && event.atInstruction <= region.endIndex) {
        mergeTargetsInside.push(event.atInstruction);
      } else if (event.atInstruction > region.endIndex) {
        const hasSourceInside = (event.resolvedFromSources ?? []).some((source) => (
          region.startIndex <= source && source <= region.endIndex
        ));
        if (hasSourceInside) mergeTargetsAfter.push(event.atInstruction);
      }
    });
    return {
      ...region,
      suggestedVisualRole: classifyRegionRole(region),
      entryNodes: Array.from(new Set(entryNodes)).sort((a, b) => a - b).map(formatInstructionNodeId),
      exitNodes: Array.from(new Set(exitNodes)).sort((a, b) => a - b).map(formatInstructionNodeId),
      mergeTargetsInside: Array.from(new Set(mergeTargetsInside)).sort((a, b) => a - b).map(formatInstructionNodeId),
      mergeTargetsAfter: Array.from(new Set(mergeTargetsAfter)).sort((a, b) => a - b).map(formatInstructionNodeId),
    };
  });

  const runByInstruction = new Map();
  scanRuns.forEach((run) => {
    for (let index = run.startIndex; index <= run.endIndex; index += 1) {
      runByInstruction.set(index, run);
    }
  });
  const regionByInstruction = new Map();
  regionEntriesExits.forEach((region) => {
    for (let index = region.startIndex; index <= region.endIndex; index += 1) {
      const current = regionByInstruction.get(index);
      if (!current || (region.depth ?? 0) > (current.depth ?? 0)) {
        regionByInstruction.set(index, region);
      }
    }
  });

  const closureByEdgeId = new Map(backwardClosures.map((closure) => [closure.edgeId, closure]));
  const pendingByEdgeId = new Map(pendingOpenEvents.map((event) => [event.edgeId, event]));
  const mergeTargetByEdgeId = new Map();
  resolvedEvents.forEach((event) => {
    (event.resolvedPendingEdges ?? []).forEach((edgeId) => {
      mergeTargetByEdgeId.set(edgeId, event.atInstruction);
    });
  });

  const edgeClassified = analysis.edges.map((edge) => {
    const sourceRun = Number.isInteger(edge.sourceIndex) ? runByInstruction.get(edge.sourceIndex) ?? null : null;
    const targetRun = Number.isInteger(edge.targetIndex) ? runByInstruction.get(edge.targetIndex) ?? null : null;
    const sourceRegion = Number.isInteger(edge.sourceIndex) ? regionByInstruction.get(edge.sourceIndex) ?? null : null;
    const targetRegion = Number.isInteger(edge.targetIndex) ? regionByInstruction.get(edge.targetIndex) ?? null : null;
    const closureEvent = closureByEdgeId.get(edge.id) ?? null;
    const pendingEvent = pendingByEdgeId.get(edge.id) ?? null;
    const mergeTarget = mergeTargetByEdgeId.get(edge.id);
    const targetsOuterExitCorridor = (
      layoutMode === "generatedScanV2" &&
      targetRun?.placementIntent === "outer exit corridor" &&
      !targetRun.parentRegionId &&
      sourceRun?.runId !== targetRun.runId
    );

    let edgeClass = "interRegionTransfer";
    if (isHaltExitEdge(edge, analysis.program.length)) {
      edgeClass = "haltExit";
    } else if (closureEvent) {
      edgeClass = (sourceRegion?.depth ?? 0) >= 2 ? "nestedLoopClosure" : "loopClosure";
    } else if (targetsOuterExitCorridor) {
      edgeClass = "exitTailTransfer";
    } else if (sourceRun && targetRun && sourceRun.runId === targetRun.runId) {
      edgeClass = "withinRun";
    } else if (pendingEvent && Number.isInteger(mergeTarget)) {
      edgeClass = "pendingForwardMerge";
    } else if (sourceRun && targetRun && targetRun.runId !== sourceRun.runId) {
      edgeClass = "runToNextRun";
    } else if (sourceRegion && !targetRegion) {
      edgeClass = "regionExit";
    }

    let laneType = "localBranch";
    if (edgeClass === "withinRun" && edge.type === "fallthrough") laneType = "localFallthrough";
    if (edgeClass === "loopClosure") laneType = "loopReturn";
    if (edgeClass === "nestedLoopClosure") laneType = "nestedLoopReturn";
    if (edgeClass === "pendingForwardMerge") laneType = "mergeAttachment";
    if (
      edgeClass === "regionExit" ||
      edgeClass === "runToNextRun" ||
      edgeClass === "exitTailTransfer"
    ) {
      laneType = "outerContinuation";
    }
    if (edgeClass === "haltExit") laneType = "haltExitCorridor";

    let exitSide = "right";
    let entrySide = "left";
    if (laneType === "localFallthrough") {
      exitSide = "bottom";
      entrySide = "top";
    } else if (laneType === "loopReturn" || laneType === "nestedLoopReturn") {
      exitSide = layoutMode === "generatedScanV2" ? "scoreLeftOrRight" : "left";
      entrySide = layoutMode === "generatedScanV2" ? "scoreLeftOrRight" : "left";
    } else if (laneType === "haltExitCorridor") {
      exitSide = "right";
      entrySide = "right";
    } else if (laneType === "mergeAttachment") {
      exitSide = "right";
      entrySide = "top";
    }

    const ownerRegionId = (() => {
      if (sourceRegion && targetRegion && sourceRegion.id === targetRegion.id) return sourceRegion.id;
      if (closureEvent) {
        const region = regionEntriesExits.find((candidate) => candidate.closureEdgeId === edge.id) ?? null;
        return region?.id ?? sourceRegion?.id ?? null;
      }
      if (sourceRegion) return sourceRegion.id;
      return targetRegion?.id ?? null;
    })();

    return {
      edgeId: edge.id,
      sourceIndex: edge.sourceIndex ?? null,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      edgeClass,
      ownerRegionId,
      sourceRegionId: sourceRegion?.id ?? null,
      targetRegionId: targetRegion?.id ?? null,
      sourceRunId: sourceRun?.runId ?? null,
      targetRunId: targetRun?.runId ?? null,
      proposedExitSide: exitSide,
      proposedEntrySide: entrySide,
      proposedLaneType: laneType,
    };
  });

  const countByKey = (rows, key) => rows.reduce((acc, row) => {
    const value = String(row?.[key] ?? "unknown");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  const runRoleCounts = countByKey(scanRuns, "role");
  const regionRoleCounts = countByKey(regionEntriesExits, "suggestedVisualRole");
  const edgeClassCounts = countByKey(edgeClassified, "edgeClass");
  const laneTypeCounts = countByKey(edgeClassified, "proposedLaneType");
  const edgesMissingOwner = edgeClassified.filter((edge) => !edge.ownerRegionId).map((edge) => edge.edgeId);
  const regionsMissingParentWhenExpected = regionEntriesExits
    .filter((region) => (region.depth ?? 0) > 0 && !region.parentRegionId)
    .map((region) => region.interval);

  const majorSkeleton = {
    outerRegions: regionEntriesExits
      .filter((region) => region.suggestedVisualRole === "outerLoopRegion")
      .map((region) => region.interval),
    nestedIslandsByOuterRegion: regionEntriesExits
      .filter((region) => region.suggestedVisualRole === "outerLoopRegion")
      .map((outer) => ({
        outerRegion: outer.interval,
        nestedIslands: regionEntriesExits
          .filter((region) => region.parentRegionId === outer.id)
          .map((region) => region.interval),
      })),
    continuationRuns: scanRuns
      .filter((run) => run.role === "continuationRun" || run.role === "mergeRun")
      .map((run) => run.interval),
    tailRuns: scanRuns
      .filter((run) => run.role === "exitTailRun")
      .map((run) => run.interval),
    setupRuns: scanRuns
      .filter((run) => run.role === "setupRun")
      .map((run) => run.interval),
  };
  const dfsGrammar = null;

  return {
    enabled: true,
    skippedReason: null,
    runs: scanRuns,
    regions: regionEntriesExits.map((region) => ({
      regionId: region.id,
      interval: region.interval,
      startIndex: region.startIndex,
      endIndex: region.endIndex,
      parentRegionId: region.parentRegionId ?? null,
      childrenRegionIds: region.children ?? [],
      closureEdgeId: region.closureEdgeId ?? null,
      entryNodes: region.entryNodes,
      exitNodes: region.exitNodes,
      mergeTargetsInside: region.mergeTargetsInside,
      mergeTargetsAfter: region.mergeTargetsAfter,
      suggestedVisualRole: region.suggestedVisualRole,
    })),
    edges: edgeClassified,
    summary: {
      runRoleCounts,
      regionRoleCounts,
      edgeClassCounts,
      laneTypeCounts,
      runSegmentationSourceCounts: countByKey(scanRuns, "segmentationSource"),
      runsSplitCount,
      coarseRunWarningCount,
      edgesMissingOwnerCount: edgesMissingOwner.length,
      edgesMissingOwner,
      regionsMissingParentWhenExpectedCount: regionsMissingParentWhenExpected.length,
      regionsMissingParentWhenExpected,
    },
    suggestedMajorLayoutSkeleton: majorSkeleton,
    dfsGrammar,
    sourceRegionComparison: scanDecomposition.comparisonWithDetectedLoopIntervals ?? null,
    sourceDetectedLoopIntervals: detectedLoops.map((interval) => ({
      interval: `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`,
      edgeId: interval.edgeId,
      depth: interval.depth ?? 0,
    })),
  };
}

function buildGeneratedScanCellLayout(
  scanLayoutPlan,
  layoutMode = "tuned",
) {
  if (layoutMode !== "generatedScanV2") {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGeneratedScanV2",
      cells: [],
      summary: {
        cellCount: 0,
        cellTypeCounts: {},
        maxCellDepth: 0,
        siblingGroups: {},
        cellsMissingParent: [],
        cellsMissingGridSlot: [],
        exitCorridorGapFromOuter: null,
        percentNodesExpectedOnMainSpine: 0,
        totalDiagramHeight: 0,
        totalDiagramWidth: 0,
        cellPackingApplied: false,
        averageVerticalGapBetweenSequentialCells: 0,
        maxVerticalGapBetweenSequentialCells: 0,
        compactnessRatio: 0,
        cellsExpandedOnlyForPaddingCount: 0,
        cellsWithExcessiveWhitespace: [],
        instructionIndexVerticalBiasCount: 0,
        neutralizedInstructionIndexVerticalBiasCount: 0,
        neutralizedInstructionIndexVerticalBiasRows: [],
        framesOrderedByInstructionIndexCount: 0,
        framesOrderedByDiscoveryCount: 0,
        nodesWithYFromInstructionIndex: [],
        nodesWithYFromControlFlowAdjacency: [],
        suspiciousLateInstructionDownshiftEdges: [],
        suspiciousLongEdgesCausedByIndexOrder: [],
        cellularityWarnings: [],
      },
    };
  }

  if (!scanLayoutPlan?.enabled) {
    return {
      enabled: false,
      skippedReason: "scanLayoutPlanUnavailable",
      cells: [],
      summary: {
        cellCount: 0,
        cellTypeCounts: {},
        maxCellDepth: 0,
        siblingGroups: {},
        cellsMissingParent: [],
        cellsMissingGridSlot: [],
        exitCorridorGapFromOuter: null,
        percentNodesExpectedOnMainSpine: 0,
        totalDiagramHeight: 0,
        totalDiagramWidth: 0,
        cellPackingApplied: false,
        averageVerticalGapBetweenSequentialCells: 0,
        maxVerticalGapBetweenSequentialCells: 0,
        compactnessRatio: 0,
        cellsExpandedOnlyForPaddingCount: 0,
        cellsWithExcessiveWhitespace: [],
        instructionIndexVerticalBiasCount: 0,
        neutralizedInstructionIndexVerticalBiasCount: 0,
        neutralizedInstructionIndexVerticalBiasRows: [],
        framesOrderedByInstructionIndexCount: 0,
        framesOrderedByDiscoveryCount: 0,
        nodesWithYFromInstructionIndex: [],
        nodesWithYFromControlFlowAdjacency: [],
        suspiciousLateInstructionDownshiftEdges: [],
        suspiciousLongEdgesCausedByIndexOrder: [],
        cellularityWarnings: [],
      },
    };
  }

  const regions = [...(scanLayoutPlan.regions ?? [])]
    .filter((region) => Number.isInteger(region.startIndex) && Number.isInteger(region.endIndex))
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);
  const runs = [...(scanLayoutPlan.runs ?? [])]
    .filter((run) => Number.isInteger(run.startIndex) && Number.isInteger(run.endIndex))
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);

  const regionById = new Map(regions.map((region) => [region.regionId, region]));
  const directChildrenByParent = new Map();
  regions.forEach((region) => {
    const parentId = region.parentRegionId ?? null;
    if (!parentId) return;
    if (!directChildrenByParent.has(parentId)) directChildrenByParent.set(parentId, []);
    directChildrenByParent.get(parentId).push(region);
  });
  directChildrenByParent.forEach((entries) => {
    entries.sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);
  });

  const computeRegionDepth = (region, guard = new Set()) => {
    if (!region?.parentRegionId) return 0;
    if (guard.has(region.regionId)) return 0;
    const parent = regionById.get(region.parentRegionId);
    if (!parent) return 0;
    guard.add(region.regionId);
    return computeRegionDepth(parent, guard) + 1;
  };
  const regionDepthById = new Map(
    regions.map((region) => [region.regionId, computeRegionDepth(region)]),
  );

  const getDirectChildren = (regionId) => [...(directChildrenByParent.get(regionId) ?? [])];
  const getIndexCount = (startIndex, endIndex) => (
    Number.isInteger(startIndex) && Number.isInteger(endIndex) && endIndex >= startIndex
      ? (endIndex - startIndex + 1)
      : 0
  );
  const intervalLabel = (startIndex, endIndex) => (
    `${formatInstructionNodeId(startIndex)}-${formatInstructionNodeId(endIndex)}`
  );
  const intervalsOverlap = (leftStart, leftEnd, rightStart, rightEnd) => (
    Number.isInteger(leftStart) &&
    Number.isInteger(leftEnd) &&
    Number.isInteger(rightStart) &&
    Number.isInteger(rightEnd) &&
    leftStart <= rightEnd &&
    rightStart <= leftEnd
  );

  const cells = [];
  const analysisEdges = scanLayoutPlan?.dfsGrammar?.programCfgEdges ?? [];
  const addCell = ({
    cellId,
    intervalStart,
    intervalEnd,
    type,
    sourceKind,
    sourceId = null,
    parentCellId = null,
    siblingGroup = null,
    placementIntent = null,
    preferredColumn = null,
    preferredRow = null,
    padding = 16,
  }) => {
    if (!Number.isInteger(intervalStart) || !Number.isInteger(intervalEnd) || intervalEnd < intervalStart) {
      return;
    }
    const indexCount = getIndexCount(intervalStart, intervalEnd);
    const typeWidth = {
      outerLoopCell: 440,
      loopIslandCell: 320,
      innerLoopCell: 240,
      guardCell: 220,
      transferCell: 240,
      mergeContinuationCell: 220,
      outerContinuationCell: 240,
      exitCorridorCell: 220,
    };
    const suggestedWidth = typeWidth[type] ?? 220;
    const isRunLike = sourceKind === "run" || sourceKind === "syntheticPhase";
    const regionBaseHeight = {
      outerLoopCell: 300,
      loopIslandCell: 230,
      innerLoopCell: 180,
      guardCell: 150,
      transferCell: 150,
      mergeContinuationCell: 140,
      outerContinuationCell: 150,
      exitCorridorCell: 140,
    };
    const runLikeHeight = Math.max(88, 34 * indexCount + 38);
    const regionHeight = Math.max(
      regionBaseHeight[type] ?? 180,
      Math.min(440, 12 * indexCount + 74),
    );
    const suggestedHeight = isRunLike ? runLikeHeight : regionHeight;

    cells.push({
      cellId,
      interval: intervalLabel(intervalStart, intervalEnd),
      startIndex: intervalStart,
      endIndex: intervalEnd,
      indexCount,
      type,
      sourceKind,
      sourceId,
      parentCellId,
      childCellIds: [],
      siblingGroup,
      suggestedGridRow: preferredRow,
      suggestedGridColumn: preferredColumn,
      columnResolutionReason: Number.isFinite(preferredColumn) ? "preassigned" : null,
      suggestedWidth,
      suggestedHeight,
      padding,
      placementIntent,
      placementParentFrameId: parentCellId,
      placementAnchorInstruction: null,
      placementAnchorEdge: null,
      placementReason: "fallbackStableOrder",
      placementOrderSource: "stableTieBreakerOnly",
      usesInstructionIndexForY: false,
      instructionIndexUseReason: "intervalIdentityAndStableTieBreakerOnly",
      box: null,
    });
  };

  const regionCellIdByRegionId = new Map();
  regions.forEach((region) => {
    const depth = regionDepthById.get(region.regionId) ?? 0;
    const hasChildren = getDirectChildren(region.regionId).length > 0;
    const type = !region.parentRegionId
      ? "outerLoopCell"
      : (depth >= 2 && !hasChildren)
        ? "innerLoopCell"
        : "loopIslandCell";
    const cellId = `cell-region:${region.regionId}`;
    regionCellIdByRegionId.set(region.regionId, cellId);
    addCell({
      cellId,
      intervalStart: region.startIndex,
      intervalEnd: region.endIndex,
      type,
      sourceKind: "region",
      sourceId: region.regionId,
      parentCellId: region.parentRegionId ? `cell-region:${region.parentRegionId}` : null,
      siblingGroup: region.parentRegionId ? `region-children:${region.parentRegionId}` : "region-roots",
      placementIntent: type === "outerLoopCell" ? "mainCellComplex" : "ownedRegionCell",
      preferredColumn: null,
      preferredRow: null,
      padding: type === "outerLoopCell" ? 24 : 16,
    });
  });

  const findOuterRegionForIndex = (index) => (
    regions
      .filter((region) => (
        !region.parentRegionId &&
        region.startIndex <= index &&
        index <= region.endIndex
      ))
      .sort((left, right) => left.startIndex - right.startIndex)[0] ?? null
  );

  runs.forEach((run) => {
    const parentRegionId = run.parentRegionId ?? null;
    const ownerRegion = parentRegionId ? regionById.get(parentRegionId) ?? null : null;
    const ownerChildren = ownerRegion ? getDirectChildren(ownerRegion.regionId) : [];
    const maxOwnerChildEnd = ownerChildren.length > 0
      ? Math.max(...ownerChildren.map((region) => region.endIndex))
      : null;
    const minOwnerChildStart = ownerChildren.length > 0
      ? Math.min(...ownerChildren.map((region) => region.startIndex))
      : null;

    let type = "transferCell";
    if (run.role === "mergeRun") {
      type = "mergeContinuationCell";
    } else if (run.role === "exitTailRun") {
      type = "exitCorridorCell";
    } else if (run.role === "setupRun") {
      type = "guardCell";
    } else if (run.role === "loopBodyRun") {
      if (
        ownerRegion &&
        Number.isInteger(minOwnerChildStart) &&
        run.startIndex <= minOwnerChildStart - 1
      ) {
        type = "guardCell";
      } else if (
        ownerRegion &&
        Number.isInteger(maxOwnerChildEnd) &&
        run.startIndex > maxOwnerChildEnd
      ) {
        type = "outerContinuationCell";
      } else {
        type = "transferCell";
      }
    } else if (run.role === "continuationRun") {
      if (!ownerRegion) {
        type = "exitCorridorCell";
      } else if (
        Number.isInteger(maxOwnerChildEnd) &&
        run.startIndex > maxOwnerChildEnd
      ) {
        type = "outerContinuationCell";
      } else {
        type = "transferCell";
      }
    }

    const parentCellId = parentRegionId ? regionCellIdByRegionId.get(parentRegionId) ?? null : null;
    addCell({
      cellId: `cell-run:${run.runId}`,
      intervalStart: run.startIndex,
      intervalEnd: run.endIndex,
      type,
      sourceKind: "run",
      sourceId: run.runId,
      parentCellId,
      siblingGroup: parentRegionId ? `run-in:${parentRegionId}` : "run-unscoped",
      placementIntent: run.placementIntent ?? null,
      preferredColumn: null,
      preferredRow: null,
      padding: 14,
    });
  });

  // Synthetic phase cells to match scan-derived cellular intent.
  const createSyntheticCellId = (kind, startIndex, endIndex, ownerId) => (
    `cell-synthetic:${kind}:${ownerId ?? "none"}:${startIndex}-${endIndex}`
  );
  const outerRegions = regions.filter((region) => !region.parentRegionId);
  outerRegions.forEach((outerRegion) => {
    const outerChildren = getDirectChildren(outerRegion.regionId);
    if (outerChildren.length === 0) return;
    const firstChild = outerChildren[0];
    const lastChild = outerChildren.at(-1);

    if (firstChild.startIndex - 1 >= outerRegion.startIndex) {
      addCell({
        cellId: createSyntheticCellId(
          "earlyGuard",
          outerRegion.startIndex,
          firstChild.startIndex - 1,
          outerRegion.regionId,
        ),
        intervalStart: outerRegion.startIndex,
        intervalEnd: firstChild.startIndex - 1,
        type: "guardCell",
        sourceKind: "syntheticPhase",
        sourceId: `outer:${outerRegion.regionId}:earlyGuard`,
        parentCellId: regionCellIdByRegionId.get(outerRegion.regionId) ?? null,
        siblingGroup: `synthetic-in:${outerRegion.regionId}`,
        placementIntent: "earlyGuardSetupPhase",
        preferredColumn: 0,
        preferredRow: null,
        padding: 14,
      });
    }

    for (let index = 0; index < outerChildren.length - 1; index += 1) {
      const leftRegion = outerChildren[index];
      const rightRegion = outerChildren[index + 1];
      const transferStart = leftRegion.endIndex + 1;
      const transferEnd = rightRegion.startIndex - 1;
      if (transferEnd < transferStart) continue;

      addCell({
        cellId: createSyntheticCellId("transfer", transferStart, transferEnd, outerRegion.regionId),
        intervalStart: transferStart,
        intervalEnd: transferEnd,
        type: "transferCell",
        sourceKind: "syntheticPhase",
        sourceId: `outer:${outerRegion.regionId}:transfer:${index}`,
        parentCellId: regionCellIdByRegionId.get(outerRegion.regionId) ?? null,
        siblingGroup: `synthetic-in:${outerRegion.regionId}`,
        placementIntent: "interIslandTransferPhase",
        preferredColumn: 0,
        preferredRow: null,
        padding: 14,
      });
    }

    // When an outer region has repeated inner loop islands (often nested one level deeper),
    // add a synthetic aggregate transfer phase between those major islands.
    const majorIslandCandidates = regions
      .filter((region) => {
        if (region.regionId === outerRegion.regionId) return false;
        if (region.startIndex <= outerRegion.startIndex || region.endIndex >= outerRegion.endIndex) {
          return false;
        }
        if (region.startIndex === outerRegion.startIndex) return false;
        if (region.suggestedVisualRole !== "nestedLoopIsland") return false;

        let cursor = region;
        while (cursor?.parentRegionId) {
          const parent = regionById.get(cursor.parentRegionId) ?? null;
          if (!parent) break;
          if (parent.regionId === outerRegion.regionId) return true;
          cursor = parent;
        }
        return false;
      })
      .filter((region) => getDirectChildren(region.regionId).length > 0)
      .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);

    if (majorIslandCandidates.length >= 2) {
      const upperIsland = majorIslandCandidates[0];
      const lowerIsland = majorIslandCandidates[1];
      const aggregateTransferStart = upperIsland.endIndex + 1;
      const aggregateTransferEnd = lowerIsland.startIndex - 1;
      if (aggregateTransferEnd >= aggregateTransferStart) {
        addCell({
          cellId: createSyntheticCellId(
            "transferAggregate",
            aggregateTransferStart,
            aggregateTransferEnd,
            outerRegion.regionId,
          ),
          intervalStart: aggregateTransferStart,
          intervalEnd: aggregateTransferEnd,
          type: "transferCell",
          sourceKind: "syntheticPhase",
          sourceId: `outer:${outerRegion.regionId}:transferAggregate`,
          parentCellId: regionCellIdByRegionId.get(outerRegion.regionId) ?? null,
          siblingGroup: `synthetic-in:${outerRegion.regionId}`,
          placementIntent: "majorIslandTransferAggregatePhase",
          preferredColumn: 0,
          preferredRow: null,
          padding: 14,
        });
      }
    }

    const continuationStart = lastChild.endIndex + 1;
    if (continuationStart <= outerRegion.endIndex) {
      addCell({
        cellId: createSyntheticCellId(
          "outerContinuation",
          continuationStart,
          outerRegion.endIndex,
          outerRegion.regionId,
        ),
        intervalStart: continuationStart,
        intervalEnd: outerRegion.endIndex,
        type: "outerContinuationCell",
        sourceKind: "syntheticPhase",
        sourceId: `outer:${outerRegion.regionId}:continuation`,
        parentCellId: regionCellIdByRegionId.get(outerRegion.regionId) ?? null,
        siblingGroup: `synthetic-in:${outerRegion.regionId}`,
        placementIntent: "outerContinuationPhase",
        preferredColumn: 0,
        preferredRow: null,
        padding: 14,
      });
    }
  });

  regions.forEach((region) => {
    const children = getDirectChildren(region.regionId);
    if (children.length === 0) return;
    const furthestChildEnd = Math.max(...children.map((child) => child.endIndex));
    const mergeStart = furthestChildEnd + 1;
    if (mergeStart > region.endIndex) return;
    addCell({
      cellId: createSyntheticCellId("mergeContinuation", mergeStart, region.endIndex, region.regionId),
      intervalStart: mergeStart,
      intervalEnd: region.endIndex,
      type: "mergeContinuationCell",
      sourceKind: "syntheticPhase",
      sourceId: `region:${region.regionId}:mergeContinuation`,
      parentCellId: regionCellIdByRegionId.get(region.regionId) ?? null,
      siblingGroup: `synthetic-in:${region.regionId}`,
      placementIntent: "postInnerMergeContinuationPhase",
      preferredColumn: null,
      preferredRow: null,
      padding: 14,
    });
  });

  if (outerRegions.length > 0) {
    const maxOuterEnd = Math.max(...outerRegions.map((region) => region.endIndex));
    const trailingRuns = runs.filter((run) => run.startIndex > maxOuterEnd);
    if (trailingRuns.length > 0) {
      const exitStart = Math.min(...trailingRuns.map((run) => run.startIndex));
      const exitEnd = Math.max(...trailingRuns.map((run) => run.endIndex));
      addCell({
        cellId: createSyntheticCellId("exitCorridor", exitStart, exitEnd, "global"),
        intervalStart: exitStart,
        intervalEnd: exitEnd,
        type: "exitCorridorCell",
        sourceKind: "syntheticPhase",
        sourceId: "globalExitCorridor",
        parentCellId: null,
        siblingGroup: "global-exit",
        placementIntent: "outsideOuterExitCorridor",
        preferredColumn: 2,
        preferredRow: null,
        padding: 14,
      });
    }
  }

  const cellById = new Map(cells.map((cell) => [cell.cellId, cell]));
  cells.forEach((cell) => {
    if (!cell.parentCellId) return;
    const parentCell = cellById.get(cell.parentCellId);
    if (!parentCell) return;
    parentCell.childCellIds.push(cell.cellId);
  });

  const dfsGrammar = scanLayoutPlan.dfsGrammar?.enabled ? scanLayoutPlan.dfsGrammar : null;
  const localMotifs = dfsGrammar?.localMotifs ?? [];
  localMotifs.forEach((motif) => {
    const motifWidth = motif.branchClearance * 2 + motif.frameClearance * 2;
    const overlappingRunCells = cells.filter((cell) => (
      cell.sourceKind === "run" &&
      motif.memberInstructionIndexes.some((index) => (
        cell.startIndex <= index && index <= cell.endIndex
      ))
    ));
    overlappingRunCells.forEach((runCell) => {
      runCell.suggestedWidth = Math.max(runCell.suggestedWidth, motifWidth);
      runCell.localMotifIds = [...(runCell.localMotifIds ?? []), motif.motifId];
      let parentCell = runCell.parentCellId ? cellById.get(runCell.parentCellId) ?? null : null;
      const visitedParents = new Set();
      while (parentCell && !visitedParents.has(parentCell.cellId)) {
        visitedParents.add(parentCell.cellId);
        parentCell.suggestedWidth = Math.max(
          parentCell.suggestedWidth,
          motifWidth + motif.frameClearance * 2,
        );
        parentCell.localMotifIds = [...(parentCell.localMotifIds ?? []), motif.motifId];
        parentCell = parentCell.parentCellId
          ? cellById.get(parentCell.parentCellId) ?? null
          : null;
      }
    });
  });
  (dfsGrammar?.diamondPortAssignments ?? []).forEach((assignment) => {
    if ((assignment.preferredDiagonalEdgeIds?.length ?? 0) === 0) return;
    const corridorWidth = (
      assignment.branchClearance * 2 +
      assignment.diagonalCorridorClearance * 2
    );
    const ownerRunCell = cells.find((cell) => (
      cell.sourceKind === "run" &&
      cell.startIndex <= assignment.decisionIndex &&
      assignment.decisionIndex <= cell.endIndex
    ));
    if (!ownerRunCell) return;

    ownerRunCell.suggestedWidth = Math.max(ownerRunCell.suggestedWidth, corridorWidth);
    ownerRunCell.diamondPortDecisionIndexes = [
      ...(ownerRunCell.diamondPortDecisionIndexes ?? []),
      assignment.decisionIndex,
    ];
    let parentCell = ownerRunCell.parentCellId
      ? cellById.get(ownerRunCell.parentCellId) ?? null
      : null;
    const visitedParents = new Set();
    while (parentCell && !visitedParents.has(parentCell.cellId)) {
      visitedParents.add(parentCell.cellId);
      parentCell.suggestedWidth = Math.max(parentCell.suggestedWidth, corridorWidth);
      parentCell.diamondPortDecisionIndexes = [
        ...(parentCell.diamondPortDecisionIndexes ?? []),
        assignment.decisionIndex,
      ];
      parentCell = parentCell.parentCellId
        ? cellById.get(parentCell.parentCellId) ?? null
        : null;
    }
  });
  const discoveryIndexByInstruction = new Map(
    Object.entries(dfsGrammar?.discoveryIndexByInstruction ?? {})
      .map(([index, rank]) => [Number(index), Number(rank)]),
  );
  const getCellDiscoveryRank = (cell) => {
    let rank = Number.POSITIVE_INFINITY;
    for (let index = cell.startIndex; index <= cell.endIndex; index += 1) {
      rank = Math.min(rank, discoveryIndexByInstruction.get(index) ?? Number.POSITIVE_INFINITY);
    }
    return Number.isFinite(rank) ? rank : cell.startIndex;
  };
  const compareCellsByDiscovery = (left, right) => (
    (getCellDiscoveryRank(left) - getCellDiscoveryRank(right)) ||
    (left.startIndex - right.startIndex) ||
    (left.sourceKind === "region" ? -1 : 1) ||
    left.cellId.localeCompare(right.cellId)
  );
  const incomingEdgesByTarget = new Map();
  analysisEdges.forEach((edge) => {
    if (!Number.isInteger(edge?.targetIndex)) return;
    if (!incomingEdgesByTarget.has(edge.targetIndex)) incomingEdgesByTarget.set(edge.targetIndex, []);
    incomingEdgesByTarget.get(edge.targetIndex).push(edge);
  });
  const resolveCellPlacementAnchor = (cell) => {
    const incomingEdges = (incomingEdgesByTarget.get(cell.startIndex) ?? [])
      .filter((edge) => (
        !Number.isInteger(edge.sourceIndex) ||
        edge.sourceIndex < cell.startIndex ||
        edge.sourceIndex > cell.endIndex
      ))
      .sort((left, right) => (
        (discoveryIndexByInstruction.get(left.sourceIndex) ?? Number.MAX_SAFE_INTEGER) -
        (discoveryIndexByInstruction.get(right.sourceIndex) ?? Number.MAX_SAFE_INTEGER)
      ));
    const anchorEdge = incomingEdges[0] ?? null;
    return {
      placementAnchorInstruction: Number.isInteger(anchorEdge?.sourceIndex)
        ? anchorEdge.sourceIndex
        : null,
      placementAnchorEdge: anchorEdge?.id ?? null,
    };
  };
  const directStructuralCellsByParent = new Map();
  cells
    .filter((cell) => cell.sourceKind === "region" || cell.sourceKind === "run")
    .forEach((cell) => {
      const parentKey = cell.parentCellId ?? "root";
      if (!directStructuralCellsByParent.has(parentKey)) {
        directStructuralCellsByParent.set(parentKey, []);
      }
      directStructuralCellsByParent.get(parentKey).push(cell);
    });
  directStructuralCellsByParent.forEach((entries) => entries.sort(compareCellsByDiscovery));

  const getLocalChildColumn = (parentColumn, childIndex) => (
    parentColumn + (childIndex % 2 === 0 ? -1 : 1)
  );
  let rowCursor = 0;
  const regionColumnByRegionId = new Map();
  const emitStructuralCell = (cell, column = 0) => {
    if (cell.sourceKind === "run") {
      const run = runs.find((candidate) => candidate.runId === cell.sourceId) ?? null;
      Object.assign(cell, resolveCellPlacementAnchor(cell));
      cell.placementParentFrameId = cell.parentCellId ?? "root";
      cell.placementReason = run?.role === "setupRun"
        ? "initialSpine"
        : cell.placementAnchorEdge
          ? "ordinaryControlFlowContinuation"
          : "fallbackStableOrder";
      cell.placementOrderSource = cell.placementAnchorEdge
        ? "controlFlowDiscovery"
        : "stableTieBreakerOnly";
      cell.suggestedGridColumn = run?.role === "setupRun" ? 0 : column;
      cell.columnResolutionReason = run?.role === "setupRun"
        ? "setupPrefixGlobalCenter"
        : "parentRegionLocalFrame";
      cell.suggestedGridRow = rowCursor;
      rowCursor += 1;
      return;
    }

    cell.suggestedGridColumn = column;
    cell.placementParentFrameId = cell.parentCellId ?? "root";
    cell.placementReason = "parentChildAttachment";
    cell.placementOrderSource = "parentChildAttachment";
    cell.columnResolutionReason = cell.parentCellId ? "parentRegionLocalFrame" : "rootStructuralFrame";
    cell.suggestedGridRow = rowCursor;
    regionColumnByRegionId.set(cell.sourceId, column);
    const ownedCells = directStructuralCellsByParent.get(cell.cellId) ?? [];
    if (ownedCells.length === 0) {
      rowCursor += 1;
      return;
    }

    let childRegionIndex = 0;
    ownedCells.forEach((ownedCell) => {
      if (ownedCell.sourceKind === "region") {
        const childColumn = getLocalChildColumn(column, childRegionIndex);
        childRegionIndex += 1;
        emitStructuralCell(ownedCell, childColumn);
        return;
      }
      emitStructuralCell(ownedCell, column);
    });
  };

  (directStructuralCellsByParent.get("root") ?? []).forEach((cell) => {
    emitStructuralCell(cell, 0);
  });

  const getNearestRunCell = (cell) => cells
    .filter((candidate) => candidate.sourceKind === "run")
    .sort((left, right) => {
      const leftOverlap = intervalsOverlap(
        cell.startIndex,
        cell.endIndex,
        left.startIndex,
        left.endIndex,
      ) ? 0 : 1;
      const rightOverlap = intervalsOverlap(
        cell.startIndex,
        cell.endIndex,
        right.startIndex,
        right.endIndex,
      ) ? 0 : 1;
      return (
        (leftOverlap - rightOverlap) ||
        (Math.abs(getCellDiscoveryRank(left) - getCellDiscoveryRank(cell)) -
          Math.abs(getCellDiscoveryRank(right) - getCellDiscoveryRank(cell)))
      );
    })[0] ?? null;
  cells
    .filter((cell) => cell.sourceKind === "syntheticPhase")
    .forEach((cell) => {
      const nearestRunCell = getNearestRunCell(cell);
      const parentRegionId = cell.parentCellId?.startsWith("cell-region:")
        ? cell.parentCellId.slice("cell-region:".length)
        : null;
      const parentRegionColumn = regionColumnByRegionId.get(parentRegionId);
      if (Number.isFinite(nearestRunCell?.suggestedGridColumn)) {
        cell.suggestedGridColumn = nearestRunCell.suggestedGridColumn;
        cell.columnResolutionReason = "nearestRunLocalFrame";
      } else if (Number.isFinite(parentRegionColumn)) {
        cell.suggestedGridColumn = parentRegionColumn;
        cell.columnResolutionReason = "parentRegionLocalFrame";
      } else {
        cell.suggestedGridColumn = 0;
        cell.columnResolutionReason = "unknownFallback";
      }
      cell.suggestedGridRow = Number.isInteger(nearestRunCell?.suggestedGridRow)
        ? nearestRunCell.suggestedGridRow
        : rowCursor;
    });

  // Align run-owned transfer segments to aggregate transfer bridge cells when present.
  const aggregateTransferCells = cells.filter((cell) => (
    cell.sourceKind === "syntheticPhase" &&
    String(cell.sourceId ?? "").includes("transferAggregate") &&
    Number.isFinite(cell.suggestedGridColumn)
  ));
  if (aggregateTransferCells.length > 0) {
    const runCells = cells.filter((cell) => cell.sourceKind === "run");
    aggregateTransferCells.forEach((aggregateCell) => {
      runCells.forEach((runCell) => {
        if (!intervalsOverlap(
          runCell.startIndex,
          runCell.endIndex,
          aggregateCell.startIndex,
          aggregateCell.endIndex,
        )) {
          return;
        }
        runCell.suggestedGridColumn = aggregateCell.suggestedGridColumn;
        runCell.columnResolutionReason = "aggregateTransferLocalFrame";
        runCell.placementIntent = runCell.placementIntent ?? "bridgeTransferAttachedRun";
      });
    });
  }

  const nonExitColumns = cells
    .filter((cell) => cell.type !== "exitCorridorCell" && Number.isInteger(cell.suggestedGridColumn))
    .map((cell) => cell.suggestedGridColumn);
  const defaultExitColumn = Math.max(2, (nonExitColumns.length > 0 ? Math.max(...nonExitColumns) + 1 : 2));

  cells
    .filter((cell) => cell.type === "exitCorridorCell")
    .sort((left, right) => left.startIndex - right.startIndex)
    .forEach((exitCell, index) => {
    if (Number.isFinite(exitCell.suggestedGridColumn) && Number.isInteger(exitCell.suggestedGridRow)) return;
    exitCell.suggestedGridColumn = defaultExitColumn;
    exitCell.columnResolutionReason = "exitLane";
    exitCell.suggestedGridRow = rowCursor + index * 2;
  });

  cells.forEach((cell, index) => {
    if (!Number.isFinite(cell.suggestedGridColumn)) {
      const parentCell = cell.parentCellId
        ? cells.find((candidate) => candidate.cellId === cell.parentCellId) ?? null
        : null;
      if (Number.isFinite(parentCell?.suggestedGridColumn)) {
        cell.suggestedGridColumn = parentCell.suggestedGridColumn;
        cell.columnResolutionReason = "parentRegionLocalFrame";
      } else {
        cell.suggestedGridColumn = 0;
        cell.columnResolutionReason = "unknownFallback";
      }
    }
    if (!Number.isInteger(cell.suggestedGridRow)) {
      cell.suggestedGridRow = rowCursor + index;
    }
  });

  const columnWidth = 220;
  const defaultRowHeight = 64;
  const rowGap = 28;
  const rowGroups = new Map();
  cells.forEach((cell) => {
    const row = Number.isInteger(cell.suggestedGridRow) ? cell.suggestedGridRow : 0;
    if (!rowGroups.has(row)) rowGroups.set(row, []);
    rowGroups.get(row).push(cell);
  });
  const sortedRows = [...rowGroups.keys()].sort((left, right) => left - right);
  const rowTopByRow = new Map();
  const rowPackingRows = [];
  let packedCursorY = 0;
  sortedRows.forEach((row) => {
    const rowCells = rowGroups.get(row) ?? [];
    const rowHeightSource = rowCells.filter((cell) => (
      cell.sourceKind === "run" ||
      cell.sourceKind === "syntheticPhase" ||
      cell.type === "exitCorridorCell"
    ));
    const measuredCells = rowHeightSource.length > 0 ? rowHeightSource : rowCells;
    const maxRowHeight = measuredCells.length > 0
      ? Math.max(...measuredCells.map((cell) => cell.suggestedHeight))
      : defaultRowHeight;
    rowTopByRow.set(row, packedCursorY);
    const reservedRowHeight = Math.max(defaultRowHeight, maxRowHeight);
    rowPackingRows.push({
      row,
      topY: Number(packedCursorY.toFixed(2)),
      reservedRowHeight: Number(reservedRowHeight.toFixed(2)),
      rowGap,
      forcingCellIds: measuredCells
        .filter((cell) => Math.abs(cell.suggestedHeight - maxRowHeight) <= 0.01)
        .map((cell) => cell.cellId),
      measuredCellIds: measuredCells.map((cell) => cell.cellId),
    });
    packedCursorY += reservedRowHeight + rowGap;
  });

  const cellPackingApplied = true;
  const spineTolerancePx = Math.max(10, Math.round(columnWidth * 0.12));
  cells.forEach((cell) => {
    const centerX = cell.suggestedGridColumn * columnWidth;
    const topY = rowTopByRow.get(cell.suggestedGridRow) ?? 0;
    cell.box = {
      left: Number((centerX - cell.suggestedWidth / 2).toFixed(2)),
      right: Number((centerX + cell.suggestedWidth / 2).toFixed(2)),
      top: Number(topY.toFixed(2)),
      bottom: Number((topY + cell.suggestedHeight).toFixed(2)),
      width: Number(cell.suggestedWidth.toFixed(2)),
      height: Number(cell.suggestedHeight.toFixed(2)),
    };
  });

  const getTopLevelOwnerId = (cell) => {
    let cursor = cell;
    let topLevelRegionCellId = null;
    const guard = new Set();
    while (cursor?.parentCellId && !guard.has(cursor.parentCellId)) {
      guard.add(cursor.parentCellId);
      const parent = cellById.get(cursor.parentCellId) ?? null;
      if (!parent) break;
      if (parent.sourceKind === "region") {
        topLevelRegionCellId = parent.cellId;
      }
      cursor = parent;
    }
    return topLevelRegionCellId ?? "global";
  };

  const maxSequentialGap = 96;
  const runLikeCellsForCompaction = cells
    .filter((cell) => cell.box && (cell.sourceKind === "run" || cell.sourceKind === "syntheticPhase"))
    .map((cell) => ({
      cellId: cell.cellId,
      startIndex: cell.startIndex,
      endIndex: cell.endIndex,
      ownerId: getTopLevelOwnerId(cell),
      discoveryRank: getCellDiscoveryRank(cell),
      suggestedGridRow: cell.suggestedGridRow,
    }))
    .sort((left, right) => (
      (left.suggestedGridRow - right.suggestedGridRow) ||
      (left.discoveryRank - right.discoveryRank) ||
      (left.startIndex - right.startIndex) ||
      (left.endIndex - right.endIndex)
    ));

  const initialCellBoxes = new Map(
    cells.filter((cell) => cell.box).map((cell) => [cell.cellId, { ...cell.box }]),
  );
  const compactBoxesInOrder = (orderedCells) => {
    const boxes = new Map(
      Array.from(initialCellBoxes, ([cellId, box]) => [cellId, { ...box }]),
    );
    const shiftBoxesFromY = (fromY, deltaY) => {
      boxes.forEach((box) => {
        if (box.top + 0.01 < fromY) return;
        box.top = Number((box.top + deltaY).toFixed(2));
        box.bottom = Number((box.bottom + deltaY).toFixed(2));
      });
    };
    orderedCells.forEach((current, index) => {
      const next = orderedCells[index + 1];
      if (!next || current.ownerId !== next.ownerId) return;
      const currentBox = boxes.get(current.cellId);
      const nextBox = boxes.get(next.cellId);
      if (!currentBox || !nextBox) return;
      const gap = nextBox.top - currentBox.bottom;
      if (!Number.isFinite(gap) || gap <= maxSequentialGap) return;
      shiftBoxesFromY(nextBox.top, -(gap - maxSequentialGap));
    });
    return boxes;
  };
  const instructionIndexOrderedCells = [...runLikeCellsForCompaction].sort((left, right) => (
    (left.startIndex - right.startIndex) ||
    (left.endIndex - right.endIndex)
  ));
  const numericCompactionBoxes = compactBoxesInOrder(instructionIndexOrderedCells);
  const discoveryCompactionBoxes = compactBoxesInOrder(runLikeCellsForCompaction);
  discoveryCompactionBoxes.forEach((box, cellId) => {
    const cell = cellById.get(cellId);
    if (cell) cell.box = box;
  });
  const neutralizedInstructionIndexVerticalBiasRows = cells
    .filter((cell) => cell.box)
    .map((cell) => {
      const numericBox = numericCompactionBoxes.get(cell.cellId);
      const discoveryBox = discoveryCompactionBoxes.get(cell.cellId);
      if (!numericBox || !discoveryBox) return null;
      const deltaY = Number((discoveryBox.top - numericBox.top).toFixed(2));
      if (Math.abs(deltaY) <= 0.01) return null;
      return {
        cellId: cell.cellId,
        interval: cell.interval,
        numericOrderTopY: numericBox.top,
        discoveryOrderTopY: discoveryBox.top,
        deltaY,
        placementOrderSource: cell.placementOrderSource,
        instructionIndexUseReason: "removedNumericCompactionOrder",
      };
    })
    .filter(Boolean);

  const estimateCellContentHeight = (cell) => {
    const indexCount = Number.isInteger(cell?.indexCount) ? cell.indexCount : 0;
    if (indexCount <= 0) return 0;
    const nodeHeight = 30;
    const step = 14;
    return nodeHeight + Math.max(0, indexCount - 1) * (nodeHeight + step);
  };
  const cellsWithWhitespace = cells
    .filter((cell) => cell.box && (cell.sourceKind === "run" || cell.sourceKind === "syntheticPhase"))
    .map((cell) => {
      const contentHeight = estimateCellContentHeight(cell);
      const whitespace = Math.max(0, cell.box.height - contentHeight);
      return {
        cellId: cell.cellId,
        interval: cell.interval,
        sourceKind: cell.sourceKind,
        type: cell.type,
        contentHeight: Number(contentHeight.toFixed(2)),
        whitespace: Number(whitespace.toFixed(2)),
      };
    });
  const cellsExpandedOnlyForPaddingCount = cellsWithWhitespace.filter((row) => row.whitespace <= 40).length;
  const cellsWithExcessiveWhitespace = cellsWithWhitespace
    .filter((row) => row.whitespace > Math.max(90, row.contentHeight * 0.65))
    .map((row) => row.cellId);
  const frameEnvelopeInflationRows = cells
    .filter((cell) => cell.box)
    .map((cell) => {
      const nodeHeight = estimateCellContentHeight(cell);
      const nodeWidth = 88;
      const reservedWidth = cell.box.width;
      const reservedHeight = cell.box.height;
      const reservedToNodeHeightRatio = nodeHeight > 0 ? reservedHeight / nodeHeight : null;
      const reservedToNodeWidthRatio = reservedWidth / nodeWidth;
      const heightInflated = Number.isFinite(reservedToNodeHeightRatio) && reservedToNodeHeightRatio > 1.65;
      const widthInflated = reservedToNodeWidthRatio > 1.65;
      return {
        frameId: cell.cellId,
        frameKind: cell.type,
        ownerFrameId: cell.parentCellId,
        sourceKind: cell.sourceKind,
        interval: cell.interval,
        estimatedNodeBBox: {
          width: nodeWidth,
          height: Number(nodeHeight.toFixed(2)),
        },
        reservedBBox: cell.box,
        reservedToNodeHeightRatio: Number.isFinite(reservedToNodeHeightRatio)
          ? Number(reservedToNodeHeightRatio.toFixed(3))
          : null,
        reservedToNodeWidthRatio: Number(reservedToNodeWidthRatio.toFixed(3)),
        overInflated: heightInflated && widthInflated
          ? "both"
          : heightInflated
            ? "heightInflated"
            : widthInflated
              ? "widthInflated"
              : "none",
        inflationSource: cell.sourceKind === "syntheticPhase"
          ? "fallbackPadding"
          : cell.localMotifIds?.length || cell.diamondPortDecisionIndexes?.length
            ? "routeReservation"
            : "fallbackPadding",
      };
    });
  const overInflatedFrameRows = frameEnvelopeInflationRows.filter((row) => row.overInflated !== "none");
  const maxReservedToNodeHeightRatio = frameEnvelopeInflationRows.reduce(
    (maxRatio, row) => Math.max(maxRatio, row.reservedToNodeHeightRatio ?? 0),
    0,
  );
  const maxReservedToNodeWidthRatio = frameEnvelopeInflationRows.reduce(
    (maxRatio, row) => Math.max(maxRatio, row.reservedToNodeWidthRatio ?? 0),
    0,
  );

  const runLikeCellsSorted = cells
    .filter((cell) => cell.box && (cell.sourceKind === "run" || cell.sourceKind === "syntheticPhase"))
    .sort((left, right) => (
      (left.suggestedGridRow - right.suggestedGridRow) ||
      (getCellDiscoveryRank(left) - getCellDiscoveryRank(right)) ||
      (left.startIndex - right.startIndex) ||
      (left.endIndex - right.endIndex)
    ));
  const sequentialGaps = [];
  const verticalGapConstraintRows = [];
  for (let index = 0; index + 1 < runLikeCellsSorted.length; index += 1) {
    const current = runLikeCellsSorted[index];
    const next = runLikeCellsSorted[index + 1];
    const gap = Number((next.box.top - current.box.bottom).toFixed(2));
    if (Number.isFinite(gap) && gap >= 0) {
      sequentialGaps.push(gap);
      if (gap > rowGap * 1.5) {
        const previousRow = rowPackingRows.find((row) => row.row === current.suggestedGridRow) ?? null;
        verticalGapConstraintRows.push({
          sourceFrameId: current.cellId,
          targetFrameId: next.cellId,
          relationship: current.ownerId === next.ownerId
            ? "siblingFrameSpacing"
            : "parentChildSpacing",
          sourceY: current.box.top,
          targetY: next.box.top,
          dy: Number((next.box.top - current.box.top).toFixed(2)),
          gap,
          sourceFrameBBox: current.box,
          targetFrameBBox: next.box,
          ownerFrameId: current.ownerId === next.ownerId ? current.ownerId : null,
          spacingConstraint: gap >= maxSequentialGap
            ? "sameOwnerSequentialCompactionCap"
            : "globalRowPacking",
          forcingConstraintSource: gap >= maxSequentialGap
            ? "discovery-order stacking"
            : "fallback run packing",
          forcingCellIds: previousRow?.forcingCellIds ?? [],
        });
      }
    }
  }
  const averageVerticalGapBetweenSequentialCells = sequentialGaps.length > 0
    ? Number((sequentialGaps.reduce((sum, value) => sum + value, 0) / sequentialGaps.length).toFixed(2))
    : 0;
  const maxVerticalGapBetweenSequentialCells = sequentialGaps.length > 0
    ? Number(Math.max(...sequentialGaps).toFixed(2))
    : 0;
  const allCellLeft = cells.filter((cell) => cell.box).map((cell) => cell.box.left);
  const allCellRight = cells.filter((cell) => cell.box).map((cell) => cell.box.right);
  const allCellTop = cells.filter((cell) => cell.box).map((cell) => cell.box.top);
  const allCellBottom = cells.filter((cell) => cell.box).map((cell) => cell.box.bottom);
  const totalDiagramWidth = allCellLeft.length > 0
    ? Number((Math.max(...allCellRight) - Math.min(...allCellLeft)).toFixed(2))
    : 0;
  const totalDiagramHeight = allCellTop.length > 0
    ? Number((Math.max(...allCellBottom) - Math.min(...allCellTop)).toFixed(2))
    : 0;
  const totalDiagramArea = totalDiagramWidth * totalDiagramHeight;
  const runLikeArea = runLikeCellsSorted.reduce((sum, cell) => sum + ((cell.box?.width ?? 0) * (cell.box?.height ?? 0)), 0);
  const compactnessRatio = totalDiagramArea > 0
    ? Number((runLikeArea / totalDiagramArea).toFixed(4))
    : 0;

  const countBy = (rows, selector) => rows.reduce((acc, row) => {
    const key = String(selector(row) ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const outerCellBoxes = cells.filter((cell) => cell.type === "outerLoopCell" && cell.box);
  const exitCells = cells.filter((cell) => cell.type === "exitCorridorCell" && cell.box);
  const maxOuterRight = outerCellBoxes.length > 0
    ? Math.max(...outerCellBoxes.map((cell) => cell.box.right))
    : null;
  const minExitLeft = exitCells.length > 0
    ? Math.min(...exitCells.map((cell) => cell.box.left))
    : null;
  const exitCorridorGapFromOuter = (
    Number.isFinite(maxOuterRight) &&
    Number.isFinite(minExitLeft)
  )
    ? Number((minExitLeft - maxOuterRight).toFixed(2))
    : null;

  const loopSiblingGroups = new Map();
  cells
    .filter((cell) => cell.type === "loopIslandCell" && cell.siblingGroup)
    .forEach((cell) => {
      if (!loopSiblingGroups.has(cell.siblingGroup)) loopSiblingGroups.set(cell.siblingGroup, []);
      loopSiblingGroups.get(cell.siblingGroup).push(cell);
    });
  const siblingLoopIslandsShareSameGridColumn = Array.from(loopSiblingGroups.values()).some((group) => {
    if (group.length < 2) return false;
    const columns = group.map((cell) => cell.suggestedGridColumn);
    return new Set(columns).size < columns.length;
  });

  const transferAggregateRanges = cells
    .filter((cell) => (
      cell?.sourceKind === "syntheticPhase" &&
      String(cell?.sourceId ?? "").includes("transferAggregate")
    ))
    .map((cell) => ({ startIndex: cell.startIndex, endIndex: cell.endIndex }));
  const hasOuterLoopParent = (cell) => {
    if (!cell?.parentCellId) return false;
    const parent = cellById.get(cell.parentCellId) ?? null;
    return parent?.type === "outerLoopCell";
  };
  const transferRelevantRunCells = cells.filter((cell) => (
    cell.sourceKind === "run" &&
    cell.box &&
    (
      String(cell.placementIntent ?? "").includes("bridgeTransfer") ||
      transferAggregateRanges.some((range) => (
        intervalsOverlap(
          cell.startIndex,
          cell.endIndex,
          range.startIndex,
          range.endIndex,
        )
      )) ||
      (cell.type === "transferCell" && hasOuterLoopParent(cell))
    )
  ));
  const transferCellCollapsedOntoMainSpine = transferRelevantRunCells.some((cell) => {
    const centerX = (cell.box.left + cell.box.right) / 2;
    return Math.abs(centerX) <= spineTolerancePx;
  });
  const exitCorridorTooCloseToOuterCell = Number.isFinite(exitCorridorGapFromOuter)
    ? exitCorridorGapFromOuter < 24
    : false;

  const mainSpineIndices = new Set();
  const totalIndices = new Set();
  cells
    .filter((cell) => cell.sourceKind === "run")
    .forEach((cell) => {
      const centerX = cell.box ? (cell.box.left + cell.box.right) / 2 : (cell.suggestedGridColumn * columnWidth);
      for (let index = cell.startIndex; index <= cell.endIndex; index += 1) {
        totalIndices.add(index);
        if (Math.abs(centerX) <= spineTolerancePx) {
          mainSpineIndices.add(index);
        }
      }
    });
  const percentNodesExpectedOnMainSpine = totalIndices.size > 0
    ? Number((mainSpineIndices.size / totalIndices.size).toFixed(3))
    : 0;

  const siblingGroups = countBy(cells.filter((cell) => cell.siblingGroup), (cell) => cell.siblingGroup);
  const cellsMissingParent = cells
    .filter((cell) => cell.parentCellId && !cellById.has(cell.parentCellId))
    .map((cell) => cell.cellId);
  const cellsMissingGridSlot = cells
    .filter((cell) => !Number.isFinite(cell.suggestedGridColumn) || !Number.isInteger(cell.suggestedGridRow))
    .map((cell) => cell.cellId);
  const maxCellDepth = cells.reduce((maxDepth, cell) => {
    let depth = 0;
    let current = cell;
    const guard = new Set();
    while (current?.parentCellId && !guard.has(current.parentCellId)) {
      guard.add(current.parentCellId);
      current = cellById.get(current.parentCellId) ?? null;
      depth += 1;
    }
    return Math.max(maxDepth, depth);
  }, 0);

  const cellularityWarnings = [];
  if (siblingLoopIslandsShareSameGridColumn) {
    cellularityWarnings.push("siblingLoopIslandsShareSameGridColumn");
  }
  if (transferCellCollapsedOntoMainSpine) {
    cellularityWarnings.push("transferCellCollapsedOntoMainSpine");
  }
  if (exitCorridorTooCloseToOuterCell) {
    cellularityWarnings.push("exitCorridorTooCloseToOuterCell");
  }

  return {
    enabled: true,
    skippedReason: null,
    cells,
    summary: {
      cellCount: cells.length,
      cellTypeCounts: countBy(cells, (cell) => cell.type),
      maxCellDepth,
      siblingGroups,
      cellsMissingParent,
      cellsMissingGridSlot,
      exitCorridorGapFromOuter,
      percentNodesExpectedOnMainSpine,
      totalDiagramHeight,
      totalDiagramWidth,
      cellPackingApplied,
      averageVerticalGapBetweenSequentialCells,
      maxVerticalGapBetweenSequentialCells,
      compactnessRatio,
      cellsExpandedOnlyForPaddingCount,
      cellsWithExcessiveWhitespace,
      instructionIndexVerticalBiasCount: 0,
      neutralizedInstructionIndexVerticalBiasCount:
        neutralizedInstructionIndexVerticalBiasRows.length,
      neutralizedInstructionIndexVerticalBiasRows,
      framesOrderedByInstructionIndexCount: 0,
      framesOrderedByDiscoveryCount: Array.from(directStructuralCellsByParent.values())
        .reduce((count, entries) => count + Math.max(0, entries.length - 1), 0),
      nodesWithYFromInstructionIndex: [],
      nodesWithYFromControlFlowAdjacency: cells
        .filter((cell) => cell.sourceKind === "run" && cell.placementAnchorEdge)
        .map((cell) => ({
          cellId: cell.cellId,
          interval: cell.interval,
          placementAnchorInstruction: cell.placementAnchorInstruction,
          placementAnchorEdge: cell.placementAnchorEdge,
          placementReason: cell.placementReason,
          placementOrderSource: cell.placementOrderSource,
        })),
      suspiciousLateInstructionDownshiftEdges: [],
      suspiciousLongEdgesCausedByIndexOrder: [],
      ...(isBetaFlowAuditDebugEnabled() ? {
        verticalStretchGapCount: verticalGapConstraintRows.length,
        overInflatedFrameCount: overInflatedFrameRows.length,
        maxReservedToNodeHeightRatio: Number(maxReservedToNodeHeightRatio.toFixed(3)),
        maxReservedToNodeWidthRatio: Number(maxReservedToNodeWidthRatio.toFixed(3)),
        maxLoopEnvelopeToBodyHeightRatio: 0,
        frameEnvelopeInflationRows,
        verticalGapConstraintRows,
        rowPackingRows,
      } : {}),
      cellularityWarnings,
    },
  };
}

function buildBranchMergeDebugRows(branchMergeRegions = [], nodeLookup = null, layout = TEXTBOOK_LAYOUT) {
  const tolerance = Math.max(8, Math.round((layout?.verticalGap ?? 24) * 0.35));

  return (branchMergeRegions ?? []).map((region, regionIndex) => {
    const fallthroughArm = Array.isArray(region.fallthroughArm) ? region.fallthroughArm : [];
    const jumpArm = Array.isArray(region.jumpArm) ? region.jumpArm : [];
    const fallthroughPathLength = fallthroughArm.length;
    const jumpPathLength = jumpArm.length;
    const longBranchKind = fallthroughPathLength >= jumpPathLength ? "fallthrough" : "jump";
    const shortBranchKind = longBranchKind === "fallthrough" ? "jump" : "fallthrough";
    const derivedLongBranchStart = longBranchKind === "fallthrough"
      ? region.fallthroughStart
      : region.jumpStart;
    const derivedShortBranchTarget = shortBranchKind === "fallthrough"
      ? region.fallthroughStart
      : region.jumpStart;
    const longBranchArm = longBranchKind === "fallthrough" ? fallthroughArm : jumpArm;
    const derivedLongBranchPath = longBranchArm.length > 0
      ? [...longBranchArm]
      : (Number.isInteger(derivedLongBranchStart) && derivedLongBranchStart !== region.mergeIndex
        ? [derivedLongBranchStart]
        : []);
    const derivedLongBranchExitIndex = derivedLongBranchPath.length > 0
      ? derivedLongBranchPath[derivedLongBranchPath.length - 1]
      : null;
    const longBranchStart = Number.isInteger(region.longBranchStart)
      ? region.longBranchStart
      : derivedLongBranchStart;
    const shortBranchTarget = Number.isInteger(region.shortBranchTarget)
      ? region.shortBranchTarget
      : derivedShortBranchTarget;
    const longBranchPath = Array.isArray(region.longBranchPath) && region.longBranchPath.length > 0
      ? [...region.longBranchPath]
      : derivedLongBranchPath;
    const longBranchExitIndex = Number.isInteger(region.longBranchExitIndex)
      ? region.longBranchExitIndex
      : derivedLongBranchExitIndex;
    const mergeNode = Number.isInteger(region.mergeIndex) ? nodeLookup?.get(region.mergeIndex) : null;
    const longExitNode = Number.isInteger(longBranchExitIndex) ? nodeLookup?.get(longBranchExitIndex) : null;
    const mergeY = Number.isFinite(mergeNode?.y) ? mergeNode.y : null;
    const longExitY = Number.isFinite(longExitNode?.y) ? longExitNode.y : null;
    const deltaY = Number.isFinite(mergeY) && Number.isFinite(longExitY)
      ? Number((mergeY - longExitY).toFixed(2))
      : null;
    const mergePlacementVsLongExit = !Number.isFinite(deltaY)
      ? "notComputable"
      : deltaY < -tolerance
        ? "above"
        : deltaY > tolerance
          ? "below"
          : "level";
    const levelMismatch = !Number.isFinite(deltaY)
      ? "notComputable"
      : mergePlacementVsLongExit === "above"
        ? "upwardMergeRisk"
        : "none";

    return {
      id: `branch-merge-${regionIndex}`,
      decisionIndex: region.sourceIndex,
      decisionNode: Number.isInteger(region.sourceIndex) ? formatInstructionNodeId(region.sourceIndex) : null,
      shortBranchTarget,
      shortBranchNode: Number.isInteger(shortBranchTarget) ? formatInstructionNodeId(shortBranchTarget) : null,
      longBranchStart,
      longBranchStartNode: Number.isInteger(longBranchStart) ? formatInstructionNodeId(longBranchStart) : null,
      longBranchPath,
      longBranchPathNodes: longBranchPath.map((index) => formatInstructionNodeId(index)),
      longBranchExitIndex,
      longBranchExitNode: Number.isInteger(longBranchExitIndex) ? formatInstructionNodeId(longBranchExitIndex) : null,
      mergeIndex: region.mergeIndex,
      mergeNode: Number.isInteger(region.mergeIndex) ? formatInstructionNodeId(region.mergeIndex) : null,
      fallthroughArmNodes: fallthroughArm.map((index) => formatInstructionNodeId(index)),
      jumpArmNodes: jumpArm.map((index) => formatInstructionNodeId(index)),
      longBranchKind,
      shortBranchKind,
      mergePlacementVsLongExit,
      longExitY: Number.isFinite(longExitY) ? Number(longExitY.toFixed(2)) : null,
      mergeY: Number.isFinite(mergeY) ? Number(mergeY.toFixed(2)) : null,
      mergeMinusLongExitY: deltaY,
      levelTolerance: tolerance,
      levelMismatch,
      detectionReason: region.detectionReason ?? "unknown",
    };
  });
}

function instructionMatches(instruction, expected) {
  return (
    Array.isArray(instruction) &&
    instruction.length === expected.length &&
    expected.every((part, index) => String(instruction[index]).toUpperCase() === String(part).toUpperCase())
  );
}

function isPredecessorProgramShape(program) {
  const predecessorInstructions = [
    ["J", 0, 3, 7],
    ["S", 2],
    ["J", 0, 2, 6],
    ["S", 1],
    ["S", 2],
    ["J", 0, 0, 2],
    ["T", 1, 0],
  ];

  return (
    program.length === predecessorInstructions.length &&
    predecessorInstructions.every((expected, index) => instructionMatches(program[index], expected))
  );
}

function detectSingleLoopMotif(analysis) {
  const backwardEdges = analysis.edges.filter(
    (edge) =>
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex <= edge.sourceIndex,
  );
  const unconditionalLoopReturns = backwardEdges.filter(
    (edge) => edge.routeKind === "unconditionalLoopReturn",
  );

  if (backwardEdges.length !== 1 || unconditionalLoopReturns.length !== 1) {
    return null;
  }

  const returnEdge = unconditionalLoopReturns[0];
  const testIndex = returnEdge.targetIndex;
  const returnIndex = returnEdge.sourceIndex;

  if (
    !Number.isInteger(testIndex) ||
    !Number.isInteger(returnIndex) ||
    returnIndex <= testIndex ||
    analysis.nodeRoles[testIndex] !== "conditionalJump"
  ) {
    return null;
  }

  for (let index = testIndex + 1; index < returnIndex; index += 1) {
    if (analysis.nodeRoles[index] !== "action") return null;
  }

  const testEdges = analysis.edges.filter((edge) => edge.sourceIndex === testIndex);
  const continueEdge = testEdges.find((edge) => edge.targetIndex === testIndex + 1);
  const exitEdge = testEdges.find((edge) => {
    if (edge.id === continueEdge?.id) return false;
    if (edge.routeKind === "earlyExitToHalt") return true;

    return (
      Number.isInteger(edge.targetIndex) &&
      (edge.targetIndex < testIndex || edge.targetIndex > returnIndex)
    );
  });

  if (!continueEdge || !exitEdge) return null;

  return {
    testIndex,
    bodyStartIndex: testIndex + 1,
    returnIndex,
    exitEdgeId: exitEdge.id,
    continueEdgeId: continueEdge.id,
    returnEdgeId: returnEdge.id,
    exitsToHalt: exitEdge.routeKind === "earlyExitToHalt",
  };
}

function detectNestedLoopMotif(analysis) {
  const unconditionalIntervals = analysis.loopIntervals.filter(
    (interval) => interval.isUnconditionalReturn,
  );

  if (unconditionalIntervals.length !== 2) return null;

  const outerLoop = unconditionalIntervals.find(
    (interval) => interval.depth === 0 && interval.childLoopIds.length === 1,
  );
  const innerLoop = unconditionalIntervals.find(
    (interval) => interval.depth === 1 && interval.parentLoopId === outerLoop?.id,
  );

  if (!outerLoop || !innerLoop) return null;

  return {
    outerLoop,
    innerLoop,
    prelude: rangeIndexes(0, outerLoop.startIndex - 1),
    outerHeader: outerLoop.headerIndex,
    outerBodyBeforeInner: rangeIndexes(outerLoop.startIndex + 1, innerLoop.startIndex - 1),
    innerLoopIndexes: rangeIndexes(innerLoop.startIndex, innerLoop.endIndex),
    outerContinuationAfterInner: rangeIndexes(innerLoop.endIndex + 1, outerLoop.endIndex),
  };
}

function detectMinimizationFlowMotif(analysis, selectedFunctionId) {
  const normalizedFunctionId = String(selectedFunctionId ?? "").toLowerCase();

  if (
    !normalizedFunctionId.includes("minimization") &&
    !normalizedFunctionId.includes("min")
  ) {
    return null;
  }

  const program = analysis.program;

  if (
    program.length !== 26 ||
    analysis.nodeRoles[10] !== "conditionalJump" ||
    analysis.nodeRoles[20] !== "unconditionalJump" ||
    analysis.nodeRoles[24] !== "unconditionalJump" ||
    getJumpArgs(program[10])?.target !== 21 ||
    getJumpArgs(program[20])?.target !== 10 ||
    getJumpArgs(program[24])?.target !== 2
  ) {
    return null;
  }

  return {
    setupSpine: rangeIndexes(0, 9),
    mainDecisionIndex: 10,
    internalBranch: rangeIndexes(11, 20),
    exitBranch: rangeIndexes(21, 25),
    predicateLoop: {
      startIndex: 13,
      endIndex: 17,
      edgeId: "i-17-unconditional",
    },
    mainReturn: {
      startIndex: 10,
      endIndex: 20,
      edgeId: "i-20-unconditional",
    },
    candidateReturn: {
      startIndex: 2,
      endIndex: 24,
      edgeId: "i-24-unconditional",
    },
  };
}

function detectFlowMotif(analysis, selectedFunctionId) {
  const normalizedFunctionId = String(selectedFunctionId ?? "").toLowerCase();
  const firstLoopMotif = analysis.loopMotifs[0] ?? null;
  const singleLoopMotif = detectSingleLoopMotif(analysis);
  const nestedLoopMotif = detectNestedLoopMotif(analysis);
  const minimizationFlowMotif = detectMinimizationFlowMotif(analysis, selectedFunctionId);

  if (
    normalizedFunctionId.includes("add") ||
    (
      firstLoopMotif &&
      analysis.nodeRoles.length === 5 &&
      firstLoopMotif.testIndex === 1 &&
      firstLoopMotif.returnIndex === 4
    )
  ) {
    return {
      kind: "additionLoop",
      primaryLoop: firstLoopMotif,
    };
  }

  if (
    normalizedFunctionId.includes("pred") ||
    normalizedFunctionId.includes("predecessor") ||
    isPredecessorProgramShape(analysis.program)
  ) {
    return {
      kind: "predecessorLoop",
      primaryLoop: {
        testIndex: 2,
        bodyStartIndex: 3,
        returnIndex: 5,
        exitIndex: 6,
        returnEdgeId: "i-5-unconditional",
      },
    };
  }

  if (minimizationFlowMotif) {
    return {
      kind: "minimizationFlow",
      ...minimizationFlowMotif,
    };
  }

  if (singleLoopMotif) {
    return {
      kind: "singleLoop",
      primaryLoop: singleLoopMotif,
    };
  }

  if (nestedLoopMotif) {
    return {
      kind: "nestedLoop",
      ...nestedLoopMotif,
      primaryLoop: nestedLoopMotif.outerLoop,
    };
  }

  return {
    kind: "genericInstructionFallback",
    primaryLoop: firstLoopMotif,
  };
}

function rangeIndexes(startIndex, endIndex) {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
    return [];
  }

  return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => startIndex + offset);
}

function buildInstructionNodes(program, analysis, layout, { collapseSetupBlocks = false } = {}) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const displayNodes = buildDisplayNodes(program, analysis, { collapseSetupBlocks });
  const xByIndex = Array.from({ length: program.length }, () => 0);

  analysis.edges.forEach((edge) => {
    if (
      edge.routeKind !== "nearbyForwardBranch" ||
      !Number.isInteger(edge.sourceIndex) ||
      !Number.isInteger(edge.targetIndex)
    ) {
      return;
    }

    if (
      analysis.loopBodyIndexes.has(edge.sourceIndex) &&
      analysis.loopBodyIndexes.has(edge.targetIndex)
    ) {
      return;
    }

    xByIndex[edge.targetIndex] = edge.branch === "yes"
      ? layout.localBranchTargetOffset
      : -layout.localBranchTargetOffset;
  });

  return [
    {
      id: "start",
      kind: "start",
      label: "START",
      x: 0,
      y: 0,
    },
    ...displayNodes.map((displayNode, displayIndex) => ({
      ...createInstructionRenderNode(displayNode, {
        x: xByIndex[displayNode.startIndex],
        y: (displayIndex + 1) * stepY,
      }),
    })),
  ];
}

function buildPredecessorInstructionNodes(
  program,
  analysis,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const displayNodes = buildDisplayNodes(program, analysis, { collapseSetupBlocks });
  const bodyColumnX = -layout.localBranchTargetOffset;
  const outputColumnX = layout.localBranchTargetOffset;

  const positionsByIndex = [
    [0, stepY],
    [0, stepY * 2],
    [0, stepY * 3],
    [bodyColumnX, stepY * 4.25],
    [bodyColumnX, stepY * 5.25],
    [bodyColumnX, stepY * 6.25],
    [outputColumnX, stepY * 4.25],
  ];

  return [
    {
      id: "start",
      kind: "start",
      label: "START",
      x: 0,
      y: 0,
    },
    ...displayNodes.map((displayNode) => createInstructionRenderNode(displayNode, {
      x: positionsByIndex[displayNode.startIndex]?.[0] ?? 0,
      y: positionsByIndex[displayNode.startIndex]?.[1] ?? (displayNode.startIndex + 1) * stepY,
    })),
  ];
}

function buildPredecessorEdges(analysis) {
  return analysis.edges.map((edge) => {
    if (edge.id === "i-0-yes") {
      return {
        ...edge,
        to: "predecessor-halt",
        routeKind: "predecessorGuardExit",
      };
    }

    if (edge.id === "i-6-fallthrough") {
      return {
        ...edge,
        to: "predecessor-halt",
        routeKind: "predecessorOutputExit",
      };
    }

    if (edge.id === "i-0-no") {
      return {
        ...edge,
        routeKind: "predecessorGuardContinue",
      };
    }

    if (edge.id === "i-2-no") {
      return {
        ...edge,
        routeKind: "predecessorBodyBranch",
      };
    }

    if (edge.id === "i-2-yes") {
      return {
        ...edge,
        routeKind: "predecessorOutputBranch",
      };
    }

    if (edge.id === "i-5-unconditional") {
      return {
        ...edge,
        routeKind: "predecessorLoopReturn",
      };
    }

    return edge;
  });
}

function buildSingleLoopInstructionNodes(
  program,
  analysis,
  motif,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const displayNodes = buildDisplayNodes(program, analysis, { collapseSetupBlocks });
  const exitTarget = analysis.edges.find((edge) => edge.id === motif.primaryLoop.exitEdgeId)?.targetIndex;
  const exitColumnX = layout.localBranchTargetOffset;

  return [
    {
      id: "start",
      kind: "start",
      label: "START",
      x: 0,
      y: 0,
    },
    ...displayNodes.map((displayNode, displayIndex) => {
      const index = displayNode.startIndex;
      const exitsToInProgramRegion =
        Number.isInteger(exitTarget) &&
        exitTarget >= 0 &&
        index >= exitTarget &&
        (index < motif.primaryLoop.testIndex || index > motif.primaryLoop.returnIndex);

      return createInstructionRenderNode(displayNode, {
        x: exitsToInProgramRegion ? exitColumnX : 0,
        y: (displayIndex + 1) * stepY,
      });
    }),
  ];
}

function buildSingleLoopEdges(analysis, motif) {
  return analysis.edges.map((edge) => {
    if (edge.id === motif.primaryLoop.exitEdgeId) {
      return {
        ...edge,
        to: motif.primaryLoop.exitsToHalt ? "single-loop-halt" : edge.to,
        routeKind: "singleLoopExit",
      };
    }

    if (edge.id === motif.primaryLoop.continueEdgeId) {
      return {
        ...edge,
        routeKind: "singleLoopContinue",
      };
    }

    if (edge.id === motif.primaryLoop.returnEdgeId) {
      return {
        ...edge,
        routeKind: "singleLoopReturn",
      };
    }

    return edge;
  });
}

// Shared beta flow visual grammar. Motif recipes stay explicit, but these helpers
// keep repeated spine, fork, guard, continuation, and return shapes consistent.
function placeVerticalSpine(index, anchorIndex, stepY, x = 0) {
  return {
    x,
    y: (index - anchorIndex) * stepY,
  };
}

function placeExitColumn(index, startIndex, baseY, stepY, x) {
  return {
    x,
    y: baseY + (index - startIndex) * stepY,
  };
}

function buildNestedLoopLayoutSections(motif) {
  return {
    forkIndex: motif.innerLoop.startIndex - 1,
    continuationStartIndex: motif.innerLoop.endIndex + 1,
  };
}

function getNestedLoopNodeRegion(index, motif) {
  const isInnerLoopNode =
    motif.innerLoop.startIndex <= index &&
    index <= motif.innerLoop.endIndex;

  if (index < motif.outerLoop.startIndex) return "nestedLoopPrelude";
  if (index === motif.outerLoop.headerIndex) return "nestedLoopOuterHeader";
  if (motif.outerBodyBeforeInner.includes(index)) return "nestedLoopOuterBodyBeforeInner";
  if (isInnerLoopNode) return "nestedLoopInner";
  if (motif.outerContinuationAfterInner.includes(index)) return "nestedLoopOuterContinuation";
  return "nestedLoopOther";
}

function getNestedLoopNodePosition(index, motif, layout, sections) {
  const stepY = layout.nestedLoopForkStepY;
  const isInnerLoopNode =
    motif.innerLoop.startIndex <= index &&
    index <= motif.innerLoop.endIndex;
  const isOuterContinuationNode = motif.outerContinuationAfterInner.includes(index);
  const innerOffset = index - motif.innerLoop.startIndex;
  const continuationOffset = index - sections.continuationStartIndex;
  const isInnerLoopTailNode = index === motif.innerLoop.endIndex - 1;
  const isInnerLoopReturnNode = index === motif.innerLoop.endIndex;

  if (isInnerLoopNode) {
    return {
      x: isInnerLoopTailNode || isInnerLoopReturnNode
        ? layout.nestedLoopInnerDeepColumnOffset
        : innerOffset <= 2
          ? layout.nestedLoopInnerColumnOffset
          : layout.nestedLoopInnerDeepColumnOffset,
      y: isInnerLoopTailNode
        ? 3 * stepY
        : isInnerLoopReturnNode
          ? 2 * stepY
          : (innerOffset + 1) * stepY,
    };
  }

  if (isOuterContinuationNode) {
    return placeExitColumn(
      index,
      sections.continuationStartIndex,
      3 * stepY,
      stepY,
      layout.nestedLoopContinuationColumnOffset,
    );
  }

  return placeVerticalSpine(index, sections.forkIndex, stepY);
}

function buildNestedLoopInstructionNodes(program, analysis, motif, layout) {
  const stepY = layout.nestedLoopForkStepY;
  const displayNodes = buildRawDisplayNodes(program, analysis);
  const sections = buildNestedLoopLayoutSections(motif);

  return [
    {
      id: "start",
      kind: "start",
      label: "START",
      x: 0,
      y: -(sections.forkIndex + 1) * stepY,
    },
    ...displayNodes.map((displayNode) => {
      const index = displayNode.startIndex;
      const position = getNestedLoopNodePosition(index, motif, layout, sections);

      return createInstructionRenderNode(displayNode, {
        region: getNestedLoopNodeRegion(index, motif),
        ...position,
      });
    }),
  ];
}

function buildNestedLoopEdges(analysis, motif) {
  const outerExitEdge = analysis.edges.find(
    (edge) =>
      edge.sourceIndex === motif.outerLoop.headerIndex &&
      edge.routeKind === "earlyExitToHalt",
  );

  return analysis.edges.map((edge) => {
    if (edge.id === outerExitEdge?.id) {
      return {
        ...edge,
        to: "nested-loop-halt",
        routeKind: "nestedLoopOuterExit",
      };
    }

    if (
      edge.sourceIndex === motif.outerLoop.headerIndex &&
      edge.targetIndex === motif.outerLoop.headerIndex + 1
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopOuterContinue",
      };
    }

    if (edge.id === motif.innerLoop.edgeId) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerReturn",
      };
    }

    if (edge.id === motif.outerLoop.edgeId) {
      return {
        ...edge,
        routeKind: "nestedLoopOuterReturn",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      edge.sourceIndex === motif.innerLoop.startIndex - 1 &&
      edge.targetIndex === motif.innerLoop.startIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopEnterInner",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      motif.innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex < motif.innerLoop.endIndex &&
      edge.targetIndex === edge.sourceIndex + 1
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerContinue",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.sourceIndex < motif.innerLoop.startIndex &&
      edge.targetIndex > motif.innerLoop.endIndex &&
      edge.targetIndex <= motif.outerLoop.endIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopSkipInner",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      motif.innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= motif.innerLoop.endIndex &&
      edge.targetIndex > motif.innerLoop.endIndex &&
      edge.targetIndex <= motif.outerLoop.endIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerExit",
      };
    }

    return edge;
  });
}

function detectEmbeddedNestedLoopRegionLayout(analysis, motif) {
  if (!analysis.visualRoles || motif.kind !== "nestedLoop") return null;

  const regions = analysis.visualRoles.regions ?? [];
  const setupRegion = regions.find((region) => region.kind === "setup") ?? null;
  const coreLoops = regions.filter((region) => region.kind === "coreLoop");
  const innerLoops = regions.filter((region) => region.kind === "innerLoop");

  if (!setupRegion || coreLoops.length !== 1 || innerLoops.length !== 1) {
    return null;
  }

  const coreLoop = coreLoops[0];
  const innerLoop = innerLoops[0];

  if (innerLoop.parentLoopIntervalId !== coreLoop.loopIntervalId) {
    return null;
  }

  const continuationRegions = regions
    .filter((region) => region.kind === "continuation" && region.startIndex > coreLoop.endIndex)
    .sort((left, right) => left.startIndex - right.startIndex);
  const tailRegions = regions
    .filter((region) => region.kind === "tail" && region.startIndex > coreLoop.endIndex)
    .sort((left, right) => left.startIndex - right.startIndex);
  const postCoreRegion = continuationRegions[0] ?? tailRegions[0] ?? null;

  if (!postCoreRegion) return null;

  const visualEdgeRoles = analysis.visualRoles.edgeRoleById ?? {};
  const localReturnEdges = analysis.edges.filter((edge) => {
    const role = visualEdgeRoles[edge.id]?.role;
    return (
      role === "localReturn" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= innerLoop.endIndex &&
      innerLoop.startIndex <= edge.targetIndex &&
      edge.targetIndex <= innerLoop.endIndex
    );
  });
  const outerReturnEdges = analysis.edges.filter((edge) => {
    const role = visualEdgeRoles[edge.id]?.role;
    return (
      role === "outerReturn" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      coreLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= coreLoop.endIndex &&
      edge.targetIndex === coreLoop.startIndex
    );
  });

  if (localReturnEdges.length !== 1 || outerReturnEdges.length !== 1) {
    return null;
  }

  return {
    setupRegion,
    coreLoop,
    innerLoop,
    postCoreRegion,
    continuationRegion: postCoreRegion,
    localReturnEdgeId: localReturnEdges[0].id,
    outerReturnEdgeId: outerReturnEdges[0].id,
  };
}

function detectEmbeddedNestedLoopBlocksForGenericFallback(analysis, motif) {
  if (!analysis.visualRoles || motif.kind !== "genericInstructionFallback") return null;

  const regions = analysis.visualRoles.regions ?? [];
  const edgeRoleById = analysis.visualRoles.edgeRoleById ?? {};
  const loopIntervalById = new Map((analysis.loopIntervals ?? []).map((interval) => [interval.id, interval]));
  const coreLoops = regions
    .filter((region) => region.kind === "coreLoop")
    .sort((left, right) => left.startIndex - right.startIndex);
  const innerLoops = regions
    .filter((region) => region.kind === "innerLoop")
    .sort((left, right) => left.startIndex - right.startIndex);

  if (coreLoops.length === 0) return null;

  const blocks = [];

  for (let coreIndex = 0; coreIndex < coreLoops.length; coreIndex += 1) {
    const coreLoop = coreLoops[coreIndex];
    const nextCoreLoop = coreLoops[coreIndex + 1] ?? null;
    const outerLoopInterval = loopIntervalById.get(coreLoop.loopIntervalId);

    if (!outerLoopInterval) return null;
    if (!Number.isInteger(coreLoop.startIndex) || !Number.isInteger(coreLoop.endIndex)) return null;
    if (!Number.isInteger(outerLoopInterval.headerIndex)) return null;

    const coreInnerLoops = innerLoops.filter((innerLoop) => (
      innerLoop.parentLoopIntervalId === coreLoop.loopIntervalId &&
      coreLoop.startIndex <= innerLoop.startIndex &&
      innerLoop.endIndex <= coreLoop.endIndex
    ));

    if (coreInnerLoops.length !== 1) return null;

    const innerLoop = coreInnerLoops[0];
    const innerLoopInterval = loopIntervalById.get(innerLoop.loopIntervalId);

    if (!innerLoopInterval) return null;
    if (!Number.isInteger(innerLoopInterval.headerIndex)) return null;

    const localReturnEdges = analysis.edges.filter((edge) => (
      edgeRoleById[edge.id]?.role === "localReturn" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= innerLoop.endIndex &&
      innerLoop.startIndex <= edge.targetIndex &&
      edge.targetIndex <= innerLoop.endIndex
    ));
    const outerReturnEdges = analysis.edges.filter((edge) => (
      edgeRoleById[edge.id]?.role === "outerReturn" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      coreLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= coreLoop.endIndex &&
      (edge.targetIndex === coreLoop.startIndex || edge.targetIndex === outerLoopInterval.headerIndex)
    ));

    if (localReturnEdges.length !== 1 || outerReturnEdges.length !== 1) {
      return null;
    }

    const postCoreBoundary = Number.isInteger(nextCoreLoop?.startIndex)
      ? nextCoreLoop.startIndex
      : analysis.program.length;
    const continuationRegion = regions
      .filter((region) => (
        (region.kind === "continuation" || region.kind === "tail") &&
        Number.isInteger(region.startIndex) &&
        Number.isInteger(region.endIndex) &&
        region.startIndex > coreLoop.endIndex &&
        region.startIndex < postCoreBoundary
      ))
      .sort((left, right) => left.startIndex - right.startIndex)[0] ?? null;

    blocks.push({
      coreLoop,
      innerLoop,
      outerLoopInterval,
      innerLoopInterval,
      localReturnEdgeId: localReturnEdges[0].id,
      outerReturnEdgeId: outerReturnEdges[0].id,
      continuationRegion,
    });
  }

  const hasAmbiguousOverlap = blocks.some((block, index) => {
    const nextBlock = blocks[index + 1];
    if (!nextBlock) return false;
    return nextBlock.coreLoop.startIndex <= block.coreLoop.endIndex;
  });
  if (hasAmbiguousOverlap) return null;

  return blocks;
}

function buildNestedLoopIslandMotifFromBlock(block) {
  return {
    outerLoop: {
      ...block.outerLoopInterval,
      startIndex: block.coreLoop.startIndex,
      endIndex: block.coreLoop.endIndex,
      headerIndex: block.outerLoopInterval.headerIndex,
      edgeId: block.outerReturnEdgeId,
    },
    innerLoop: {
      ...block.innerLoopInterval,
      startIndex: block.innerLoop.startIndex,
      endIndex: block.innerLoop.endIndex,
      headerIndex: block.innerLoopInterval.headerIndex,
      edgeId: block.localReturnEdgeId,
    },
    outerBodyBeforeInner: rangeIndexes(
      block.coreLoop.startIndex + 1,
      block.innerLoop.startIndex - 1,
    ),
    outerContinuationAfterInner: rangeIndexes(
      block.innerLoop.endIndex + 1,
      block.coreLoop.endIndex,
    ),
  };
}

function intervalOverlaps(startIndex, endIndex, otherStart, otherEnd) {
  return startIndex <= otherEnd && otherStart <= endIndex;
}

function isDisplayNodeInsideProtectedIntervals(displayNode, protectedIntervals) {
  return protectedIntervals.some((interval) => (
    intervalOverlaps(
      displayNode.startIndex,
      displayNode.endIndex,
      interval.startIndex,
      interval.endIndex,
    )
  ));
}

function buildProtectedIntervalsFromBlocks(blocks) {
  return (blocks ?? [])
    .map((block) => ({
      startIndex: block.coreLoop.startIndex,
      endIndex: block.coreLoop.endIndex,
    }))
    .sort((left, right) => left.startIndex - right.startIndex);
}

function buildGenericRegionModel(
  analysis,
  displayNodes,
  protectedIntervals = [],
  layout = TEXTBOOK_LAYOUT,
  { attachedSideRegions = [] } = {},
) {
  const genericRegions = [];
  const genericRegionIdByIndex = new Map();
  const sideColumnByIndex = new Map();
  const incomingEdgeCountByTarget = new Map();
  const attachedIntervals = mergeIntervals(
    attachedSideRegions.map((region) => ({
      startIndex: region.startIndex,
      endIndex: region.endIndex,
    })),
  );
  const isProtectedIndex = (index) => protectedIntervals.some((interval) => (
    interval.startIndex <= index && index <= interval.endIndex
  ));
  const isAttachedIndex = (index) => attachedIntervals.some((interval) => (
    interval.startIndex <= index && index <= interval.endIndex
  ));

  analysis.edges.forEach((edge) => {
    if (!Number.isInteger(edge.targetIndex)) return;
    incomingEdgeCountByTarget.set(
      edge.targetIndex,
      (incomingEdgeCountByTarget.get(edge.targetIndex) ?? 0) + 1,
    );
  });

  let regionStart = null;
  for (let index = 0; index < analysis.program.length; index += 1) {
    if (isProtectedIndex(index) || isAttachedIndex(index)) {
      if (Number.isInteger(regionStart)) {
        genericRegions.push({ startIndex: regionStart, endIndex: index - 1 });
        regionStart = null;
      }
      continue;
    }

    if (!Number.isInteger(regionStart)) {
      regionStart = index;
    }
  }

  if (Number.isInteger(regionStart)) {
    genericRegions.push({ startIndex: regionStart, endIndex: analysis.program.length - 1 });
  }

  genericRegions.forEach((region, regionId) => {
    for (let index = region.startIndex; index <= region.endIndex; index += 1) {
      genericRegionIdByIndex.set(index, regionId);
    }
  });

  const fallthroughTargetBySource = new Map(
    analysis.edges
      .filter((edge) => (
        edge.type === "fallthrough" &&
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex)
      ))
      .map((edge) => [edge.sourceIndex, edge.targetIndex]),
  );

  const markSideRun = (startIndex, side) => {
    const regionId = genericRegionIdByIndex.get(startIndex);
    if (!Number.isInteger(regionId)) return;
    const region = genericRegions[regionId];
    if (!region) return;

    const sideX = side === "left"
      ? -layout.localBranchTargetOffset
      : layout.localBranchTargetOffset;
    let currentIndex = startIndex;

    while (Number.isInteger(currentIndex)) {
      if (currentIndex < region.startIndex || currentIndex > region.endIndex) break;
      if (isProtectedIndex(currentIndex) || isAttachedIndex(currentIndex)) break;
      if (analysis.nodeRoles[currentIndex] !== "action") break;

      if (!sideColumnByIndex.has(currentIndex)) {
        sideColumnByIndex.set(currentIndex, sideX);
      }

      const nextIndex = fallthroughTargetBySource.get(currentIndex);
      if (!Number.isInteger(nextIndex)) break;
      if (nextIndex !== currentIndex + 1) break;
      if ((incomingEdgeCountByTarget.get(nextIndex) ?? 0) > 1) break;
      if (analysis.nodeRoles[nextIndex] !== "action") break;

      currentIndex = nextIndex;
    }
  };

  analysis.edges.forEach((edge) => {
    if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return;
    if (edge.targetIndex <= edge.sourceIndex) return;
    if (
      isProtectedIndex(edge.sourceIndex) ||
      isProtectedIndex(edge.targetIndex) ||
      isAttachedIndex(edge.sourceIndex) ||
      isAttachedIndex(edge.targetIndex)
    ) return;

    const sourceRegionId = genericRegionIdByIndex.get(edge.sourceIndex);
    const targetRegionId = genericRegionIdByIndex.get(edge.targetIndex);
    if (!Number.isInteger(sourceRegionId) || sourceRegionId !== targetRegionId) return;

    if (analysis.nodeRoles[edge.sourceIndex] === "conditionalJump" && edge.targetIndex > edge.sourceIndex + 1) {
      markSideRun(edge.targetIndex, edge.branch === "no" ? "left" : "right");
      return;
    }

    if (analysis.nodeRoles[edge.sourceIndex] === "unconditionalJump" && edge.targetIndex > edge.sourceIndex + 1) {
      markSideRun(edge.targetIndex, "right");
    }
  });

  const xByDisplayNodeStartIndex = new Map();

  const attachedSideRegionForIndex = (index) => (
    attachedSideRegions.find(
      (region) => region.startIndex <= index && index <= region.endIndex,
    ) ?? null
  );

  displayNodes.forEach((displayNode) => {
    if (isDisplayNodeInsideProtectedIntervals(displayNode, protectedIntervals)) return;
    const startIndex = displayNode.startIndex;
    const attachedSideRegion = attachedSideRegionForIndex(startIndex);
    if (attachedSideRegion && Number.isFinite(attachedSideRegion.columnX)) {
      xByDisplayNodeStartIndex.set(startIndex, attachedSideRegion.columnX);
      return;
    }
    const sideX = sideColumnByIndex.get(startIndex);
    xByDisplayNodeStartIndex.set(startIndex, Number.isFinite(sideX) ? sideX : 0);
  });

  return {
    protectedIntervals,
    attachedIntervals,
    genericRegions,
    genericRegionIdByIndex,
    sideColumnByIndex,
    xByDisplayNodeStartIndex,
    isProtectedIndex,
    isAttachedIndex,
    attachedSideRegions,
  };
}

function applyGenericRegionPlacementToNodes(nodes, genericRegionModel) {
  nodes.forEach((node) => {
    const displayNode = node.displayNode;
    if (!displayNode) return;
    if (isDisplayNodeInsideProtectedIntervals(displayNode, genericRegionModel.protectedIntervals)) return;

    const targetX = genericRegionModel.xByDisplayNodeStartIndex.get(displayNode.startIndex);
    if (Number.isFinite(targetX)) {
      node.x = targetX;
    }
  });
}

function mergeIntervals(intervals = []) {
  const sorted = intervals
    .filter((interval) => Number.isInteger(interval?.startIndex) && Number.isInteger(interval?.endIndex))
    .sort((left, right) => left.startIndex - right.startIndex);

  const merged = [];
  sorted.forEach((interval) => {
    const current = { startIndex: interval.startIndex, endIndex: interval.endIndex };
    const last = merged[merged.length - 1];
    if (!last || current.startIndex > last.endIndex + 1) {
      merged.push(current);
      return;
    }

    last.endIndex = Math.max(last.endIndex, current.endIndex);
  });

  return merged;
}

function createGenericControlFlowBlockKind({
  analysis,
  startIndex,
  endIndex,
  firstDecisionIndex,
}) {
  if (Number.isInteger(firstDecisionIndex) && endIndex < firstDecisionIndex) {
    return "setup";
  }

  const hasDecision = rangeIndexes(startIndex, endIndex).some(
    (index) => analysis.nodeRoles[index] === "conditionalJump",
  );
  if (hasDecision) return "decision";

  const hasLoopHeader = rangeIndexes(startIndex, endIndex).some(
    (index) => analysis.visualRoles?.loopRegionByIndex?.[index]?.isHeader,
  );
  if (hasLoopHeader) return "loopHeader";

  const hasLoopBody = rangeIndexes(startIndex, endIndex).some(
    (index) => analysis.visualRoles?.loopRegionByIndex?.[index]?.loopId,
  );
  if (hasLoopBody) return "loopBody";

  const hasContinuationRole = rangeIndexes(startIndex, endIndex).some(
    (index) => analysis.visualRoles?.nodeRoleByIndex?.[index] === "continuationNode",
  );
  if (hasContinuationRole) return "continuation";

  const hasTailRole = rangeIndexes(startIndex, endIndex).some(
    (index) => analysis.visualRoles?.nodeRoleByIndex?.[index] === "tailNode",
  );
  if (hasTailRole) return "tail";

  const outgoingEdges = analysis.edges.filter((edge) => (
    Number.isInteger(edge.sourceIndex) &&
    startIndex <= edge.sourceIndex &&
    edge.sourceIndex <= endIndex
  ));
  const exitsToHalt = outgoingEdges.some((edge) => isHaltExitEdge(edge, analysis.program.length));
  if (exitsToHalt) return "terminal";

  const containsOutputWrite = rangeIndexes(startIndex, endIndex).some((index) => {
    const instruction = analysis.program[index];
    const opcode = normalizeOpcode(instruction);
    const targetRegister = Number(instruction?.[1]);
    return (opcode === "Z" || opcode === "S" || opcode === "T") && targetRegister === 0;
  });
  if (containsOutputWrite) return "result";

  return "straightLine";
}

function determinePreferredBlockColumn(block, blockIncoming, blockById, layout) {
  const sideColumns = {
    left: -Math.round(layout.localBranchTargetOffset * 1.2),
    right: Math.round(layout.localBranchTargetOffset * 1.2),
    continuation: Math.round(layout.nestedLoopContinuationColumnOffset * 2),
  };

  if (block.kind === "result") {
    return {
      x: sideColumns.right,
      placement: "horizontal",
      reason: "resultBranchSidePlacement",
    };
  }

  if (block.kind === "continuation") {
    return {
      x: sideColumns.continuation,
      placement: "horizontal",
      reason: "continuationSidePlacement",
    };
  }

  for (const incoming of blockIncoming) {
    if (!incoming) continue;
    const sourceBlock = Number.isInteger(incoming.sourceBlockId)
      ? blockById.get(incoming.sourceBlockId)
      : null;
    if (!sourceBlock) {
      if (incoming.sourceScope?.startsWith("protected:")) {
        return {
          x: sideColumns.continuation,
          placement: "horizontal",
          reason: "protectedExitToGenericRegion",
        };
      }
      continue;
    }

    if (incoming.type === "fallthrough" && incoming.targetIndex === sourceBlock.endIndex + 1) {
      continue;
    }

    if (incoming.branch === "no") {
      return {
        x: sideColumns.left,
        placement: "horizontal",
        reason: "decisionNoBranchSidePlacement",
      };
    }

    if (incoming.branch === "yes") {
      return {
        x: sideColumns.right,
        placement: "horizontal",
        reason: "decisionYesBranchSidePlacement",
      };
    }

    if (incoming.routeKind === "unconditionalForwardJump" || incoming.flowRole === "skip") {
      return {
        x: sideColumns.right,
        placement: "horizontal",
        reason: "forwardSkipSidePlacement",
      };
    }
  }

  return {
    x: 0,
    placement: "vertical",
    reason: "straightFallthroughSpine",
  };
}

function parseScopedInterval(scope, prefix) {
  if (typeof scope !== "string" || !scope.startsWith(`${prefix}:`)) return null;
  const match = new RegExp(`^${prefix}:I(\\d+)-I(\\d+)$`).exec(scope);
  if (!match) return null;
  const startIndex = Number(match[1]);
  const endIndex = Number(match[2]);
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) return null;
  return { startIndex, endIndex };
}

function parseInstructionIntervalLabel(label) {
  const match = /^I(\d+)-I(\d+)$/.exec(String(label ?? ""));
  if (!match) return null;
  const startIndex = Number(match[1]);
  const endIndex = Number(match[2]);
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) return null;
  return { startIndex, endIndex };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(min) && !Number.isFinite(max)) return value;
  if (!Number.isFinite(min)) return Math.min(value, max);
  if (!Number.isFinite(max)) return Math.max(value, min);
  return Math.min(Math.max(value, min), max);
}

function boundsOverlap(left, right, epsilon = 0.5) {
  if (!left || !right) return false;
  const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return horizontalOverlap > epsilon && verticalOverlap > epsilon;
}

function intervalsOverlap(startA, endA, startB, endB, epsilon = 0.5) {
  return Math.min(endA, endB) - Math.max(startA, startB) > epsilon;
}

function classifyGenericDecisionOutgoingEdge({
  edgeRecord,
  edge,
  analysis,
  programLength,
  findMajorLoopIslandForIndex,
}) {
  if (!edgeRecord) return "unclassified";

  const sourceIndex = Number.isInteger(edgeRecord.sourceIndex) ? edgeRecord.sourceIndex : null;
  const targetIndex = Number.isInteger(edgeRecord.targetIndex) ? edgeRecord.targetIndex : null;

  if (edge && isHaltExitEdge(edge, programLength)) return "terminalExit";
  if (targetIndex === null) return "terminalExit";

  const isDirectFallthrough =
    edgeRecord.type === "fallthrough" &&
    sourceIndex !== null &&
    targetIndex === sourceIndex + 1;
  if (isDirectFallthrough) return "fallthroughBody";

  const sourceLoopIsland = sourceIndex !== null
    ? findMajorLoopIslandForIndex(sourceIndex)
    : null;
  const targetLoopIsland = findMajorLoopIslandForIndex(targetIndex);
  if (
    targetLoopIsland &&
    (!sourceLoopIsland || sourceLoopIsland.intervalKey !== targetLoopIsland.intervalKey)
  ) {
    return "loopEntry";
  }

  const isForward = sourceIndex !== null && targetIndex > sourceIndex;
  const isForwardSkip = isForward && (
    edgeRecord.routeKind === "unconditionalForwardJump" ||
    edgeRecord.flowRole === "skip" ||
    analysis.nodeRoles[sourceIndex] === "unconditionalJump"
  );
  if (isForwardSkip) return "forwardSkip";

  const targetNodeRole = analysis.visualRoles?.nodeRoleByIndex?.[targetIndex] ?? null;
  if (edgeRecord.branch === "yes" || edgeRecord.branch === "no") {
    if (targetNodeRole === "continuationNode" || targetNodeRole === "tailNode") {
      return "continuationBranch";
    }
    if (isForward) return "sideBranch";
  }

  if (isForward && targetNodeRole === "continuationNode") {
    return "continuationBranch";
  }

  if (isForward) return "sideBranch";
  return "unclassified";
}

function findInstructionRenderNodeByIndex(instructionNodes, index) {
  if (!Number.isInteger(index)) return null;

  return instructionNodes.find((node) => {
    const startIndex = node.displayNode?.startIndex;
    const endIndex = node.displayNode?.endIndex;
    return Number.isInteger(startIndex) &&
      Number.isInteger(endIndex) &&
      startIndex <= index &&
      index <= endIndex;
  }) ?? null;
}

function applyBranchMergePromotionPlacement({
  analysis,
  instructionNodes,
  layout,
}) {
  const promotions = [];
  const mergeYOffset = Math.max(6, Math.round(layout.verticalGap * 0.25));

  (analysis.branchMergeRegions ?? []).forEach((region) => {
    const decisionIndex = region.sourceIndex;
    const mergeIndex = region.mergeIndex;
    const longBranchExitIndex = region.longBranchExitIndex;
    const record = {
      decisionIndex,
      mergeIndex,
      oldMergeY: null,
      newMergeY: null,
      longExitY: null,
      applied: false,
      reason: "unknown",
      collisionAdjusted: false,
      shiftedNodeCount: 0,
      shiftedIntervals: [],
    };

    if (!Number.isInteger(mergeIndex) || !Number.isInteger(longBranchExitIndex)) {
      record.reason = "missingMergeOrLongBranchExitIndex";
      promotions.push(record);
      return;
    }

    const mergeNode = findInstructionRenderNodeByIndex(instructionNodes, mergeIndex);
    const longExitNode = findInstructionRenderNodeByIndex(instructionNodes, longBranchExitIndex);

    if (!mergeNode || !longExitNode) {
      record.reason = "missingMergeOrLongBranchExitNode";
      promotions.push(record);
      return;
    }

    const oldMergeY = mergeNode.y;
    const longExitY = longExitNode.y;
    record.oldMergeY = Number(oldMergeY.toFixed(2));
    record.longExitY = Number(longExitY.toFixed(2));

    if (oldMergeY >= longExitY) {
      record.newMergeY = Number(oldMergeY.toFixed(2));
      record.reason = "mergeNotAboveLongBranchExit";
      promotions.push(record);
      return;
    }

    const continuationIndexes = new Set([
      mergeIndex,
      ...((region.continuation ?? []).filter((index) => Number.isInteger(index) && index >= mergeIndex)),
    ]);
    const continuationNodes = instructionNodes.filter((node) => (
      Array.isArray(node.instructionIndices) &&
      node.instructionIndices.some((index) => continuationIndexes.has(index))
    ));
    if (!continuationNodes.some((node) => node.id === mergeNode.id)) {
      continuationNodes.push(mergeNode);
    }
    const continuationNodeIds = new Set(continuationNodes.map((node) => node.id));

    const mergeBounds = getNodeBounds(mergeNode, layout);
    let shiftY = longExitY + mergeYOffset - oldMergeY;
    const proposedTop = mergeBounds.top + shiftY;
    const proposedBottom = mergeBounds.bottom + shiftY;
    const collidingNode = instructionNodes.find((node) => {
      if (continuationNodeIds.has(node.id)) return false;
      const bounds = getNodeBounds(node, layout);
      return intervalsOverlap(proposedTop, proposedBottom, bounds.top, bounds.bottom, 0.5) &&
        intervalsOverlap(mergeBounds.left, mergeBounds.right, bounds.left, bounds.right, 0.5);
    }) ?? null;

    if (collidingNode) {
      const collidingBounds = getNodeBounds(collidingNode, layout);
      const nudgedShift = collidingBounds.bottom + layout.verticalGap - mergeBounds.top;
      shiftY = Math.max(shiftY, nudgedShift);
      record.collisionAdjusted = true;
    }

    continuationNodes.forEach((node) => {
      node.y += shiftY;
    });

    const shiftedIndexes = Array.from(
      new Set(
        continuationNodes
          .flatMap((node) => node.instructionIndices ?? [])
          .filter((index) => Number.isInteger(index)),
      ),
    );
    record.newMergeY = Number((oldMergeY + shiftY).toFixed(2));
    record.applied = true;
    record.reason = "promotedBelowLongBranchExit";
    record.shiftedNodeCount = continuationNodes.length;
    record.shiftedIntervals = toContiguousIntervals(shiftedIndexes)
      .map((interval) => `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`);
    promotions.push(record);
  });

  return promotions;
}

function applyGenericControlFlowBlockLayout({
  analysis,
  instructionNodes,
  layout,
  genericRegionModel,
  attachedSideRegions = [],
}) {
  const originalPositions = new Map(
    instructionNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );

  if (!ENABLE_GENERIC_CONTROL_FLOW_BLOCK_LAYOUT) {
    return {
      applied: false,
      status: "disabled",
      warning: "genericControlFlowBlockLayoutDisabled",
      blocks: [],
      blockEdges: [],
    };
  }

  try {
    const displayNodes = instructionNodes
      .filter((node) => node.displayNode && node.id.startsWith("i-"))
      .sort((left, right) => left.displayNode.startIndex - right.displayNode.startIndex);
    const protectedIntervals = mergeIntervals([
      ...(genericRegionModel?.protectedIntervals ?? []),
      ...attachedSideRegions.map((region) => ({
        startIndex: region.startIndex,
        endIndex: region.endIndex,
      })),
    ]);
    const isProtectedIndex = (index) => protectedIntervals.some(
      (interval) => interval.startIndex <= index && index <= interval.endIndex,
    );
    const firstDecisionIndex = analysis.visualRoles?.metadata?.firstDecisionIndex ?? null;
    const jumpTargets = new Set(
      analysis.edges
        .map((edge) => edge.targetIndex)
        .filter((index) => Number.isInteger(index) && !isProtectedIndex(index)),
    );
    const splitBefore = new Set(jumpTargets);
    analysis.edges.forEach((edge) => {
      if (!Number.isInteger(edge.sourceIndex)) return;
      if (analysis.nodeRoles[edge.sourceIndex] === "conditionalJump" || analysis.nodeRoles[edge.sourceIndex] === "unconditionalJump") {
        const splitIndex = edge.sourceIndex + 1;
        if (Number.isInteger(splitIndex) && splitIndex < analysis.program.length && !isProtectedIndex(splitIndex)) {
          splitBefore.add(splitIndex);
        }
      }
    });

    const blockCandidateNodes = displayNodes.filter((node) => (
      !isDisplayNodeInsideProtectedIntervals(node.displayNode, protectedIntervals)
    ));
    const blocks = [];
    let currentBlock = null;

    blockCandidateNodes.forEach((node, orderIndex) => {
      const startIndex = node.displayNode.startIndex;
      const endIndex = node.displayNode.endIndex;
      const previousNode = blockCandidateNodes[orderIndex - 1] ?? null;
      const shouldSplit = !currentBlock ||
        splitBefore.has(startIndex) ||
        !previousNode ||
        startIndex > previousNode.displayNode.endIndex + 1;

      if (shouldSplit) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = {
          id: blocks.length,
          startIndex,
          endIndex,
          nodeIds: [node.id],
          instructionIds: rangeIndexes(startIndex, endIndex).map(formatInstructionNodeId),
        };
      } else {
        currentBlock.endIndex = Math.max(currentBlock.endIndex, endIndex);
        currentBlock.nodeIds.push(node.id);
        currentBlock.instructionIds = rangeIndexes(currentBlock.startIndex, currentBlock.endIndex)
          .map(formatInstructionNodeId);
      }
    });
    if (currentBlock) blocks.push(currentBlock);

    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const blockIdByInstructionIndex = new Map();
    blocks.forEach((block) => {
      for (let index = block.startIndex; index <= block.endIndex; index += 1) {
        blockIdByInstructionIndex.set(index, block.id);
      }
    });

    const blockEdges = [];
    const incomingByBlock = new Map();
    const outgoingByBlock = new Map();
    const makeScope = (index) => describeEdgeScope(index, genericRegionModel);
    const visualEdgeRoles = analysis.visualRoles?.edgeRoleById ?? {};
    const edgeById = new Map(analysis.edges.map((edge) => [edge.id, edge]));

    analysis.edges.forEach((edge) => {
      const sourceBlockId = Number.isInteger(edge.sourceIndex)
        ? blockIdByInstructionIndex.get(edge.sourceIndex)
        : null;
      const targetBlockId = Number.isInteger(edge.targetIndex)
        ? blockIdByInstructionIndex.get(edge.targetIndex)
        : null;

      if (sourceBlockId === targetBlockId) return;

      const record = {
        edgeId: edge.id,
        sourceBlockId: Number.isInteger(sourceBlockId) ? sourceBlockId : null,
        targetBlockId: Number.isInteger(targetBlockId) ? targetBlockId : null,
        sourceIndex: edge.sourceIndex ?? null,
        targetIndex: edge.targetIndex ?? null,
        sourceScope: makeScope(edge.sourceIndex),
        targetScope: makeScope(edge.targetIndex),
        branch: edge.branch ?? null,
        type: edge.type,
        routeKind: edge.routeKind ?? null,
        flowRole: analysis.visualRoles?.edgeRoleById?.[edge.id]?.flowRole ?? null,
      };

      blockEdges.push(record);

      if (Number.isInteger(record.sourceBlockId)) {
        if (!outgoingByBlock.has(record.sourceBlockId)) outgoingByBlock.set(record.sourceBlockId, []);
        outgoingByBlock.get(record.sourceBlockId).push(record);
      }
      if (Number.isInteger(record.targetBlockId)) {
        if (!incomingByBlock.has(record.targetBlockId)) incomingByBlock.set(record.targetBlockId, []);
        incomingByBlock.get(record.targetBlockId).push(record);
      }
    });

    const nodeById = new Map(instructionNodes.map((node) => [node.id, node]));
    const protectedLoopIntervals = (genericRegionModel?.protectedIntervals ?? [])
      .filter((interval) => Number.isInteger(interval?.startIndex) && Number.isInteger(interval?.endIndex))
      .map((interval) => ({
        startIndex: interval.startIndex,
        endIndex: interval.endIndex,
        source: "protected",
      }));
    const genericLoopIntervals = (analysis.loopIntervals ?? [])
      .filter((interval) => Number.isInteger(interval?.startIndex) && Number.isInteger(interval?.endIndex))
      .filter((interval) => !protectedLoopIntervals.some((protectedInterval) => (
        protectedInterval.startIndex <= interval.startIndex &&
        interval.endIndex <= protectedInterval.endIndex
      )))
      .map((interval) => ({
        startIndex: interval.startIndex,
        endIndex: interval.endIndex,
        source: "genericLoop",
      }));
    const uniqueLoopIntervalsByKey = new Map();
    [...protectedLoopIntervals, ...genericLoopIntervals].forEach((interval) => {
      const key = `${interval.startIndex}-${interval.endIndex}`;
      if (!uniqueLoopIntervalsByKey.has(key)) {
        uniqueLoopIntervalsByKey.set(key, interval);
      }
    });
    const loopIntervalCandidates = Array.from(uniqueLoopIntervalsByKey.values())
      .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);
    const stepY = layout.actionNodeHeight + layout.verticalGap;
    const majorLoopIslandGap = Math.round(stepY * 1.25);
    const setupRegion = (analysis.visualRoles?.regions ?? []).find((region) => region.kind === "setup") ?? null;

    blocks.forEach((block) => {
      block.kind = createGenericControlFlowBlockKind({
        analysis,
        startIndex: block.startIndex,
        endIndex: block.endIndex,
        firstDecisionIndex,
      });
    });

    const setupEndIndex = Number.isInteger(setupRegion?.endIndex) ? setupRegion.endIndex : null;
    const setupStartIndex = Number.isInteger(setupRegion?.startIndex) ? setupRegion.startIndex : 0;
    const majorGapThresholdMultiplier = 2.5;

    const loopIslandEnvelopes = loopIntervalCandidates
      .map((interval, order) => {
        const coreNodes = instructionNodes.filter((node) => {
          const index = node.displayNode?.startIndex;
          return Number.isInteger(index) &&
            interval.startIndex <= index &&
            index <= interval.endIndex;
        });
        const coreBounds = getRegionNodeBounds(coreNodes, layout);
        if (!coreBounds) return null;

        let leftReturnExtent = 0;
        let rightReturnExtent = 0;
        analysis.edges.forEach((edge) => {
          if (
            !Number.isInteger(edge.sourceIndex) ||
            !Number.isInteger(edge.targetIndex) ||
            edge.targetIndex >= edge.sourceIndex
          ) {
            return;
          }
          if (
            edge.sourceIndex < interval.startIndex ||
            edge.sourceIndex > interval.endIndex ||
            edge.targetIndex < interval.startIndex ||
            edge.targetIndex > interval.endIndex
          ) {
            return;
          }

          const role = visualEdgeRoles[edge.id]?.role ?? null;
          if (role === "outerReturn") {
            leftReturnExtent = Math.max(
              leftReturnExtent,
              layout.loopLaneDistance + layout.loopLaneStep * 4,
            );
          } else if (role === "localReturn") {
            leftReturnExtent = Math.max(
              leftReturnExtent,
              layout.loopLaneDistance + layout.loopLaneStep * 2,
            );
          } else {
            leftReturnExtent = Math.max(
              leftReturnExtent,
              layout.loopLaneDistance + layout.loopLaneStep,
            );
          }
        });

        const xPadding = Math.max(layout.sideRouteGap * 2, 20);
        const yPadding = Math.round(layout.verticalGap * 0.65);
        const intervalKey = `${interval.startIndex}-${interval.endIndex}`;
        return {
          id: order,
          source: interval.source,
          intervalKey,
          startIndex: interval.startIndex,
          endIndex: interval.endIndex,
          coreLeft: coreBounds.left,
          coreRight: coreBounds.right,
          coreTop: coreBounds.top,
          coreBottom: coreBounds.bottom,
          leftReturnExtent,
          rightReturnExtent,
          left: coreBounds.left - leftReturnExtent - xPadding,
          right: coreBounds.right + rightReturnExtent + xPadding,
          top: coreBounds.top - yPadding,
          bottom: coreBounds.bottom + yPadding,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.startIndex - right.startIndex);
    const majorLoopIslandEnvelopes = loopIslandEnvelopes.filter((candidate) => (
      !loopIslandEnvelopes.some((container) => (
        container.intervalKey !== candidate.intervalKey &&
        container.startIndex <= candidate.startIndex &&
        candidate.endIndex <= container.endIndex
      ))
    ));

    const loopEnvelopeByIntervalKey = new Map(
      loopIslandEnvelopes.map((entry) => [entry.intervalKey, entry]),
    );
    const majorLoopEnvelopeByIntervalKey = new Map(
      majorLoopIslandEnvelopes.map((entry) => [entry.intervalKey, entry]),
    );
    const sideRegionVerticalGap = Math.round(stepY * 0.35);
    const sideColumnStep = Math.max(layout.localBranchTargetOffset * 0.65, 72);
    const sideBandPadding = Math.round(stepY * 0.65);
    const findMajorLoopIslandForIndex = (index) => {
      if (!Number.isInteger(index)) return null;
      return majorLoopIslandEnvelopes.find((entry) => (
        entry.startIndex <= index && index <= entry.endIndex
      )) ?? null;
    };
    const findNonOwnerOverlappingLoopEnvelope = (bounds, ownerKey = null) => (
      majorLoopIslandEnvelopes.find((entry) => (
        entry.intervalKey !== ownerKey && boundsOverlap(bounds, entry, 0.1)
      )) ?? null
    );
    const sideBlockOwnershipRows = [];
    const sideBlocksOutsideOwnerBand = [];
    const blocksOverlappingNonOwnerLoopEnvelope = [];

    const sideRegionRows = [];
    const sideColumnsBySide = new Map();
    const sortedAttachedSideRegions = [...attachedSideRegions].sort((left, right) => (
      left.ownerStartIndex - right.ownerStartIndex || left.startIndex - right.startIndex
    ));

    sortedAttachedSideRegions.forEach((region) => {
      if (!region.nodes?.length) return;

      const ownerKey = `${region.ownerStartIndex}-${region.ownerEndIndex}`;
      const ownerEnvelope = loopEnvelopeByIntervalKey.get(ownerKey) ??
        majorLoopEnvelopeByIntervalKey.get(ownerKey) ??
        null;
      const nextOwnerEnvelope = majorLoopIslandEnvelopes.find(
        (candidate) => candidate.startIndex > region.ownerEndIndex,
      ) ?? null;
      const regionBoundsBefore = getRegionNodeBounds(region.nodes, layout);
      if (!regionBoundsBefore) return;
      const regionWidth = regionBoundsBefore.right - regionBoundsBefore.left;
      const regionHeight = regionBoundsBefore.bottom - regionBoundsBefore.top;

      if (!ownerEnvelope) {
        const intervalLabel = `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`;
        const ownerLabel = `${formatInstructionNodeId(region.ownerStartIndex)}-${formatInstructionNodeId(region.ownerEndIndex)}`;
        sideRegionRows.push({
          kind: "attachedSideRegion",
          interval: intervalLabel,
          startIndex: region.startIndex,
          endIndex: region.endIndex,
          owner: ownerLabel,
          side: region.side,
          withinOwnerVerticalBand: false,
          overlapsLoopIslandEnvelope: Boolean(findNonOwnerOverlappingLoopEnvelope(regionBoundsBefore)),
          placementReason: "conservativeNoOwnerPlacement",
          x: Number((((regionBoundsBefore.left + regionBoundsBefore.right) / 2).toFixed(2))),
          y: Number((((regionBoundsBefore.top + regionBoundsBefore.bottom) / 2).toFixed(2))),
          width: Number(regionWidth.toFixed(2)),
          height: Number(regionHeight.toFixed(2)),
        });
        sideBlockOwnershipRows.push({
          interval: intervalLabel,
          ownerBlockId: null,
          ownerInterval: ownerLabel,
          ownerBand: null,
          bandStatus: "noOwner",
          placementReason: "conservativeNoOwnerPlacement",
        });
        if (findNonOwnerOverlappingLoopEnvelope(regionBoundsBefore)) {
          blocksOverlappingNonOwnerLoopEnvelope.push(intervalLabel);
        }
        return;
      }

      const side = region.side === "left" ? "left" : "right";
      const minSideGap = Math.max(layout.localBranchTargetOffset, layout.sideRouteGap * 3);
      const baseX = side === "right"
        ? Math.max(region.columnX ?? Number.NEGATIVE_INFINITY, ownerEnvelope.right + minSideGap)
        : Math.min(region.columnX ?? Number.POSITIVE_INFINITY, ownerEnvelope.left - minSideGap);
      const ownerBand = {
        top: ownerEnvelope.top - sideBandPadding,
        bottom: ownerEnvelope.bottom + sideBandPadding,
      };
      let preferredTop = ownerEnvelope.top + Math.round((ownerEnvelope.bottom - ownerEnvelope.top) * 0.24);
      let clampedToOwnerBand = false;
      const maxOwnerBandTop = ownerBand.bottom - regionHeight;
      if (preferredTop < ownerBand.top) {
        preferredTop = ownerBand.top;
        clampedToOwnerBand = true;
      }
      if (preferredTop > maxOwnerBandTop) {
        preferredTop = maxOwnerBandTop;
        clampedToOwnerBand = true;
      }
      if (nextOwnerEnvelope) {
        const maxTopBeforeNext = nextOwnerEnvelope.top - majorLoopIslandGap - regionHeight;
        if (preferredTop > maxTopBeforeNext) {
          preferredTop = maxTopBeforeNext;
          clampedToOwnerBand = true;
        }
      }

      if (!sideColumnsBySide.has(side)) sideColumnsBySide.set(side, []);
      const columns = sideColumnsBySide.get(side);
      const findColumnByX = (x) => columns.find((column) => Math.abs(column.x - x) < 0.1) ?? null;
      const sideDirection = side === "right" ? 1 : -1;
      const eligibleExistingColumns = columns
        .filter((column) => (sideDirection > 0 ? column.x >= baseX : column.x <= baseX))
        .sort((left, right) => (
          Math.abs(left.x - baseX) - Math.abs(right.x - baseX)
        ));
      const existingBoundary = columns.length > 0
        ? (sideDirection > 0
          ? Math.max(...columns.map((column) => column.x))
          : Math.min(...columns.map((column) => column.x)))
        : baseX;
      const candidateXValues = [
        ...eligibleExistingColumns.map((column) => column.x),
      ];
      const attempts = 10;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const newColumnX = columns.length === 0 && attempt === 0
          ? baseX
          : existingBoundary + sideDirection * sideColumnStep * (attempt + 1);
        candidateXValues.push(newColumnX);
      }
      const uniqueCandidateXValues = candidateXValues.filter((value, index, array) => (
        array.findIndex((candidate) => Math.abs(candidate - value) < 0.1) === index
      ));

      let selectedColumn = null;
      let selectedColumnX = null;
      let shiftedToParallelSideColumn = false;
      for (let attempt = 0; attempt < uniqueCandidateXValues.length; attempt += 1) {
        const candidateX = uniqueCandidateXValues[attempt];
        const candidateColumn = findColumnByX(candidateX) ?? {
          x: candidateX,
          occupiedBands: [],
        };
        const hasColumnBandOverlap = (candidateColumn.occupiedBands ?? []).some((band) => (
          intervalsOverlap(
            preferredTop,
            preferredTop + regionHeight,
            band.top - sideRegionVerticalGap,
            band.bottom + sideRegionVerticalGap,
            0.1,
          )
        ));
        if (hasColumnBandOverlap) continue;

        const candidateBounds = {
          left: candidateX - regionWidth / 2,
          right: candidateX + regionWidth / 2,
          top: preferredTop,
          bottom: preferredTop + regionHeight,
        };
        const overlapsNonOwnerLoop = Boolean(findNonOwnerOverlappingLoopEnvelope(candidateBounds, ownerKey));
        if (overlapsNonOwnerLoop) continue;

        selectedColumn = candidateColumn;
        selectedColumnX = candidateX;
        shiftedToParallelSideColumn = candidateX !== baseX;
        break;
      }

      if (!selectedColumn) {
        selectedColumnX = existingBoundary + sideDirection * sideColumnStep * (attempts + 1);
        selectedColumn = findColumnByX(selectedColumnX) ?? {
          x: selectedColumnX,
          occupiedBands: [],
        };
        shiftedToParallelSideColumn = true;
      }

      if (!findColumnByX(selectedColumn.x)) {
        columns.push(selectedColumn);
      }

      const currentCenterX = (regionBoundsBefore.left + regionBoundsBefore.right) / 2;
      const deltaX = selectedColumnX - currentCenterX;
      const deltaY = preferredTop - regionBoundsBefore.top;

      region.nodes.forEach((node) => {
        node.x += deltaX;
        node.y += deltaY;
      });

      let adjustedBounds = getRegionNodeBounds(region.nodes, layout);
      const ownerBandTop = ownerBand.top;
      const ownerBandBottom = ownerBand.bottom;
      const withinOwnerVerticalBand = adjustedBounds.top >= ownerBandTop &&
        adjustedBounds.bottom <= ownerBandBottom;
      const bandStatus = withinOwnerVerticalBand
        ? "inside"
        : adjustedBounds.bottom < ownerBandTop || adjustedBounds.top > ownerBandBottom
          ? "outside"
          : "near";
      const overlapsNonOwnerLoopEnvelope = Boolean(
        findNonOwnerOverlappingLoopEnvelope(adjustedBounds, ownerKey),
      );
      if (overlapsNonOwnerLoopEnvelope) {
        blocksOverlappingNonOwnerLoopEnvelope.push(
          `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
        );
      }
      if (bandStatus === "outside") {
        sideBlocksOutsideOwnerBand.push(
          `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
        );
      }
      selectedColumn.occupiedBands = [
        ...(selectedColumn.occupiedBands ?? []),
        { top: adjustedBounds.top, bottom: adjustedBounds.bottom },
      ];
      region.columnX = selectedColumnX;
      region.topY = adjustedBounds.top;
      region.bottomY = adjustedBounds.bottom;
      const placementReason = shiftedToParallelSideColumn
        ? "shiftedToParallelSideColumn"
        : clampedToOwnerBand
          ? "clampedToOwnerBand"
          : "ownerAdjacentSideBlock";
      const intervalLabel = `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`;
      const ownerLabel = `${formatInstructionNodeId(region.ownerStartIndex)}-${formatInstructionNodeId(region.ownerEndIndex)}`;

      sideRegionRows.push({
        kind: "attachedSideRegion",
        interval: intervalLabel,
        startIndex: region.startIndex,
        endIndex: region.endIndex,
        owner: ownerLabel,
        side,
        withinOwnerVerticalBand,
        overlapsLoopIslandEnvelope: overlapsNonOwnerLoopEnvelope,
        placementReason,
        x: Number((((adjustedBounds.left + adjustedBounds.right) / 2).toFixed(2))),
        y: Number((((adjustedBounds.top + adjustedBounds.bottom) / 2).toFixed(2))),
        width: Number((adjustedBounds.right - adjustedBounds.left).toFixed(2)),
        height: Number((adjustedBounds.bottom - adjustedBounds.top).toFixed(2)),
      });
      sideBlockOwnershipRows.push({
        interval: intervalLabel,
        ownerBlockId: ownerEnvelope.id ?? null,
        ownerInterval: ownerLabel,
        ownerBand: {
          top: Number(ownerBandTop.toFixed(2)),
          bottom: Number(ownerBandBottom.toFixed(2)),
        },
        bandStatus,
        placementReason,
      });
    });

    const laneBottomByX = new Map();
    const blockPlacementRows = [];
    const beforeBounds = computeInstructionBounds(instructionNodes, layout);
    const firstNodeAfterSetup = Number.isInteger(setupEndIndex) ? setupEndIndex + 1 : null;
    const setupPrefixBlocks = Number.isInteger(setupEndIndex)
      ? blocks
        .filter((block) => block.startIndex >= setupStartIndex && block.endIndex <= setupEndIndex)
        .sort((left, right) => left.startIndex - right.startIndex)
      : [];
    const setupPrefixBlockIdSet = new Set(setupPrefixBlocks.map((block) => block.id));
    const setupPrefixNodeIds = Number.isInteger(setupEndIndex)
      ? rangeIndexes(setupStartIndex, setupEndIndex).map(formatInstructionNodeId)
      : [];
    const setupPrefixOrderingWarnings = [];
    const setupPrefixBlocksMisorderedBeforeFix = [];
    const setupPrefixBlocksMisorderedAfterFix = [];
    let setupPrefixTopY = null;
    let setupPrefixBottomY = null;
    let setupPrefixContiguous = false;
    let sequenceTopCursor = Number.NEGATIVE_INFINITY;
    let firstNonSetupPlaced = false;
    const sideRegionBounds = sideRegionRows.map((row) => ({
      ...row,
      left: row.x - row.width / 2,
      right: row.x + row.width / 2,
      top: row.y - row.height / 2,
      bottom: row.y + row.height / 2,
    }));
    const firstMajorLoopStartIndex = majorLoopIslandEnvelopes
      .map((entry) => entry.startIndex)
      .filter((index) => Number.isInteger(index))
      .sort((left, right) => left - right)[0] ?? null;
    const decisionRegionByOwnerId = new Map();
    const decisionOwnedByBlockId = new Map();
    const preLoopDecisionRegions = [];
    const decisionRegionPlacementWarnings = [];
    const sideOrTerminalEdgesCrossingLoopEnvelope = [];

    const decisionOwnerSideForEdge = (edgeRecord) => {
      if (edgeRecord?.branch === "no") return "left";
      if (edgeRecord?.branch === "yes") return "right";
      if (
        Number.isInteger(edgeRecord?.sourceIndex) &&
        Number.isInteger(edgeRecord?.targetIndex) &&
        edgeRecord.targetIndex < edgeRecord.sourceIndex
      ) {
        return "left";
      }
      return "right";
    };

    const decisionOwnershipPriority = {
      loopEntry: 5,
      continuationBranch: 4,
      sideBranch: 3,
      forwardSkip: 2,
      terminalExit: 1,
      fallthroughBody: 0,
      unclassified: 0,
    };

    blocks
      .filter((block) => block.kind === "decision" && !setupPrefixBlockIdSet.has(block.id))
      .sort((left, right) => left.startIndex - right.startIndex)
      .forEach((block) => {
        const outgoing = outgoingByBlock.get(block.id) ?? [];
        const ownerDecisionIndex = rangeIndexes(block.startIndex, block.endIndex).find(
          (index) => analysis.nodeRoles[index] === "conditionalJump",
        ) ?? block.startIndex;
        const outgoingClassifications = outgoing.map((edgeRecord) => {
          const edge = edgeById.get(edgeRecord.edgeId) ?? null;
          const classification = classifyGenericDecisionOutgoingEdge({
            edgeRecord,
            edge,
            analysis,
            programLength: analysis.program.length,
            findMajorLoopIslandForIndex,
          });
          const targetBlock = Number.isInteger(edgeRecord.targetBlockId)
            ? blockById.get(edgeRecord.targetBlockId)
            : null;
          const targetInterval = targetBlock
            ? `${formatInstructionNodeId(targetBlock.startIndex)}-${formatInstructionNodeId(targetBlock.endIndex)}`
            : null;

          return {
            edgeId: edgeRecord.edgeId,
            sourceIndex: edgeRecord.sourceIndex,
            targetIndex: edgeRecord.targetIndex,
            targetBlockId: edgeRecord.targetBlockId,
            targetInterval,
            branch: edgeRecord.branch ?? null,
            classification,
            side: decisionOwnerSideForEdge(edgeRecord),
          };
        });

        const regionRecord = {
          ownerBlockId: block.id,
          ownerDecisionIndex,
          ownerInterval: `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
          outgoingClassifications,
          fallthroughTarget: outgoingClassifications
            .find((entry) => entry.classification === "fallthroughBody")
            ?.targetInterval ?? null,
          sideBranchTargets: outgoingClassifications
            .filter((entry) => entry.classification === "sideBranch")
            .map((entry) => entry.targetInterval ?? formatInstructionNodeId(entry.targetIndex)),
          terminalTargets: outgoingClassifications
            .filter((entry) => entry.classification === "terminalExit")
            .map((entry) => entry.targetInterval ?? "HALT"),
          loopEntryTargets: outgoingClassifications
            .filter((entry) => entry.classification === "loopEntry")
            .map((entry) => entry.targetInterval ?? formatInstructionNodeId(entry.targetIndex)),
          continuationTargets: outgoingClassifications
            .filter((entry) => entry.classification === "continuationBranch")
            .map((entry) => entry.targetInterval ?? formatInstructionNodeId(entry.targetIndex)),
          forwardSkipTargets: outgoingClassifications
            .filter((entry) => entry.classification === "forwardSkip")
            .map((entry) => entry.targetInterval ?? formatInstructionNodeId(entry.targetIndex)),
          ownedBlockIds: [],
          placementReason: "decisionRegionOwner",
        };

        decisionRegionByOwnerId.set(block.id, regionRecord);

        if (
          Number.isInteger(firstMajorLoopStartIndex) &&
          block.startIndex < firstMajorLoopStartIndex
        ) {
          preLoopDecisionRegions.push(regionRecord.ownerInterval);
        }

        outgoingClassifications.forEach((classifiedEdge) => {
          if (!Number.isInteger(classifiedEdge.targetBlockId)) return;
          const targetBlock = blockById.get(classifiedEdge.targetBlockId);
          if (!targetBlock || targetBlock.id === block.id) return;
          if (setupPrefixBlockIdSet.has(targetBlock.id)) return;

          const existing = decisionOwnedByBlockId.get(targetBlock.id);
          const existingPriority = existing
            ? decisionOwnershipPriority[existing.classification] ?? 0
            : -1;
          const candidatePriority = decisionOwnershipPriority[classifiedEdge.classification] ?? 0;
          const replaceExisting = !existing ||
            candidatePriority > existingPriority ||
            (
              candidatePriority === existingPriority &&
              block.startIndex < existing.ownerStartIndex
            );

          if (replaceExisting) {
            decisionOwnedByBlockId.set(targetBlock.id, {
              ownerBlockId: block.id,
              ownerDecisionIndex,
              ownerStartIndex: block.startIndex,
              classification: classifiedEdge.classification,
              edgeId: classifiedEdge.edgeId,
              branch: classifiedEdge.branch,
              side: classifiedEdge.side,
            });
          }
        });
      });

    decisionOwnedByBlockId.forEach((ownership, targetBlockId) => {
      const ownerRegion = decisionRegionByOwnerId.get(ownership.ownerBlockId);
      if (!ownerRegion) return;
      const ownedBlock = blockById.get(targetBlockId);
      if (!ownedBlock) return;
      ownerRegion.ownedBlockIds.push(
        `${formatInstructionNodeId(ownedBlock.startIndex)}-${formatInstructionNodeId(ownedBlock.endIndex)}`,
      );
    });

    const firstMajorLoopBeforeFix = majorLoopIslandEnvelopes
      .filter((entry) => !Number.isInteger(setupEndIndex) || entry.startIndex >= firstNodeAfterSetup)
      .sort((left, right) => left.startIndex - right.startIndex)[0] ?? null;
    const firstMajorTopBeforeFix = firstMajorLoopBeforeFix?.top ?? null;
    if (Number.isFinite(firstMajorTopBeforeFix)) {
      setupPrefixBlocks.forEach((block) => {
        const setupNodes = block.nodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
        const setupBounds = getRegionNodeBounds(setupNodes, layout);
        if (setupBounds && setupBounds.top > firstMajorTopBeforeFix) {
          setupPrefixBlocksMisorderedBeforeFix.push(
            `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
          );
        }
      });
    }

    if (setupPrefixBlocksMisorderedBeforeFix.length > 0) {
      setupPrefixOrderingWarnings.push("setupPrefixBlocksMisorderedBeforeFix");
    }

    if (setupPrefixBlocks.length > 0) {
      const setupPrefixAllNodes = setupPrefixBlocks
        .flatMap((block) => block.nodeIds.map((nodeId) => nodeById.get(nodeId)))
        .filter(Boolean);
      const setupPrefixAnchorBounds = getRegionNodeBounds(setupPrefixAllNodes, layout);
      let setupCursorTop = setupPrefixAnchorBounds?.top ?? 0;

      setupPrefixBlocks.forEach((block, setupOrderIndex) => {
        const regionNodes = block.nodeIds
          .map((nodeId) => nodeById.get(nodeId))
          .filter(Boolean);
        const bounds = getRegionNodeBounds(regionNodes, layout);
        if (!bounds) return;

        const targetXCenter = 0;
        const targetTop = setupOrderIndex === 0
          ? setupCursorTop
          : sequenceTopCursor + stepY;
        const deltaX = targetXCenter - ((bounds.left + bounds.right) / 2);
        const deltaY = targetTop - bounds.top;
        regionNodes.forEach((node) => {
          node.x += deltaX;
          node.y += deltaY;
        });
        const adjustedBounds = getRegionNodeBounds(regionNodes, layout);
        const nextTop = adjustedBounds?.bottom ?? targetTop;
        sequenceTopCursor = nextTop;
        laneBottomByX.set(String(targetXCenter), nextTop);
        block._placedBottom = nextTop;
        setupCursorTop = targetTop;

        blockPlacementRows.push({
          id: block.id,
          interval: `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
          startIndex: block.startIndex,
          endIndex: block.endIndex,
          blockKind: block.kind,
          instructionIds: block.instructionIds,
          incomingBlockEdges: (incomingByBlock.get(block.id) ?? []).map((entry) => entry.edgeId),
          outgoingBlockEdges: (outgoingByBlock.get(block.id) ?? []).map((entry) => entry.edgeId),
          width: Number(((adjustedBounds?.right ?? 0) - (adjustedBounds?.left ?? 0)).toFixed(2)),
          height: Number(((adjustedBounds?.bottom ?? 0) - (adjustedBounds?.top ?? 0)).toFixed(2)),
          x: Number((((adjustedBounds?.left ?? 0) + (adjustedBounds?.right ?? 0)) / 2).toFixed(2)),
          y: Number((((adjustedBounds?.top ?? 0) + (adjustedBounds?.bottom ?? 0)) / 2).toFixed(2)),
          placement: "vertical",
          placementReason: "setupPrefixPlacement",
          ownerLoopIsland: null,
          withinOwnerVerticalBand: null,
          overlapsLoopIslandEnvelope: false,
        });
      });

      const setupBoundsAfterFix = getRegionNodeBounds(
        setupPrefixBlocks
          .flatMap((block) => block.nodeIds.map((nodeId) => nodeById.get(nodeId)))
          .filter(Boolean),
        layout,
      );
      setupPrefixTopY = setupBoundsAfterFix?.top ?? null;
      setupPrefixBottomY = setupBoundsAfterFix?.bottom ?? null;
    }

    blocks.forEach((block) => {
      if (setupPrefixBlockIdSet.has(block.id)) return;
      const regionNodes = block.nodeIds
        .map((nodeId) => nodeById.get(nodeId))
        .filter(Boolean);
      const bounds = getRegionNodeBounds(regionNodes, layout);
      if (!bounds) return;

      const incoming = incomingByBlock.get(block.id) ?? [];
      const defaultColumnDecision = determinePreferredBlockColumn(block, incoming, blockById, layout);
      const previousLoopIsland = [...majorLoopIslandEnvelopes]
        .reverse()
        .find((entry) => entry.endIndex < block.startIndex) ?? null;
      const nextLoopIsland = majorLoopIslandEnvelopes
        .find((entry) => entry.startIndex > block.endIndex) ?? null;
      const protectedIncoming = incoming.find((entry) => entry.sourceScope?.startsWith("protected:")) ?? null;
      const protectedIncomingInterval = parseScopedInterval(protectedIncoming?.sourceScope, "protected");
      const protectedIncomingKey = protectedIncomingInterval
        ? `${protectedIncomingInterval.startIndex}-${protectedIncomingInterval.endIndex}`
        : null;
      const ownerFromProtectedIncoming = protectedIncomingKey
        ? majorLoopEnvelopeByIntervalKey.get(protectedIncomingKey) ??
          loopEnvelopeByIntervalKey.get(protectedIncomingKey) ??
          null
        : null;
      const ownerFromSourceBlock = incoming
        .map((entry) => blockById.get(entry.sourceBlockId))
        .filter(Boolean)
        .map((sourceBlock) => findMajorLoopIslandForIndex(sourceBlock.startIndex))
        .find(Boolean) ?? null;
      const ownerLoopIsland = ownerFromProtectedIncoming ?? ownerFromSourceBlock ?? null;
      const ownerBranchIncoming = ownerLoopIsland
        ? incoming.find((entry) => (
          Number.isInteger(entry.sourceIndex) &&
          ownerLoopIsland.startIndex <= entry.sourceIndex &&
          entry.sourceIndex <= ownerLoopIsland.endIndex &&
          (entry.branch === "yes" || entry.branch === "no")
        ))?.branch ?? null
        : null;
      const protectedIncomingSide = ownerBranchIncoming === "no"
        ? "left"
        : protectedIncoming?.branch === "no"
          ? "left"
          : "right";
      const hasBranchIncoming = incoming.some((entry) => entry.branch === "yes" || entry.branch === "no");
      const hasSideIncomingFromOwner = ownerLoopIsland
        ? incoming.some((entry) => (
          Number.isInteger(entry.sourceIndex) &&
          ownerLoopIsland.startIndex <= entry.sourceIndex &&
          entry.sourceIndex <= ownerLoopIsland.endIndex &&
          (
            entry.branch === "yes" ||
            entry.branch === "no" ||
            entry.type !== "fallthrough" ||
            !(
              Number.isInteger(entry.sourceIndex) &&
              Number.isInteger(entry.targetIndex) &&
              entry.targetIndex === entry.sourceIndex + 1
            )
          )
        ))
        : false;
      const decisionRegionOwnerRecord = decisionRegionByOwnerId.get(block.id) ?? null;
      const ownedByDecision = decisionOwnedByBlockId.get(block.id) ?? null;
      const ownerDecisionBlock = ownedByDecision
        ? blockById.get(ownedByDecision.ownerBlockId)
        : null;
      const ownerDecisionNodes = ownerDecisionBlock
        ? ownerDecisionBlock.nodeIds
          .map((nodeId) => nodeById.get(nodeId))
          .filter(Boolean)
        : [];
      const ownerDecisionBounds = ownerDecisionNodes.length > 0
        ? getRegionNodeBounds(ownerDecisionNodes, layout)
        : null;
      const ownerDecisionLoopIsland = ownerDecisionBlock
        ? findMajorLoopIslandForIndex(ownerDecisionBlock.startIndex)
        : null;
      const ownerDecisionSideGap = Math.max(
        layout.localBranchTargetOffset * 1.1,
        layout.sideRouteGap * 4,
      );
      const ownerDecisionSide = ownedByDecision?.side ?? "right";
      const ownerDecisionIsPreLoop = Boolean(
        ownerDecisionBlock &&
        Number.isInteger(firstMajorLoopStartIndex) &&
        ownerDecisionBlock.startIndex < firstMajorLoopStartIndex,
      );

      let columnDecision = defaultColumnDecision;
      if (decisionRegionOwnerRecord) {
        columnDecision = {
          x: 0,
          placement: "vertical",
          reason: Number.isInteger(firstMajorLoopStartIndex) && block.startIndex < firstMajorLoopStartIndex
            ? "preLoopDecisionOwner"
            : "decisionRegionOwner",
        };
      } else if (ownedByDecision && ownerDecisionBounds) {
        if (ownedByDecision.classification === "loopEntry") {
          columnDecision = {
            x: 0,
            placement: "vertical",
            reason: "decisionRegionLoopEntry",
          };
        } else if (ownedByDecision.classification === "terminalExit") {
          columnDecision = {
            x: ownerDecisionSide === "left"
              ? ((ownerDecisionBounds.left + ownerDecisionBounds.right) / 2) - ownerDecisionSideGap
              : ((ownerDecisionBounds.left + ownerDecisionBounds.right) / 2) + ownerDecisionSideGap,
            placement: "horizontal",
            reason: "decisionRegionTerminalExit",
          };
        } else if (
          ownedByDecision.classification === "sideBranch" ||
          ownedByDecision.classification === "continuationBranch" ||
          ownedByDecision.classification === "forwardSkip"
        ) {
          columnDecision = {
            x: ownerDecisionSide === "left"
              ? ((ownerDecisionBounds.left + ownerDecisionBounds.right) / 2) - ownerDecisionSideGap
              : ((ownerDecisionBounds.left + ownerDecisionBounds.right) / 2) + ownerDecisionSideGap,
            placement: "horizontal",
            reason: ownedByDecision.classification === "continuationBranch"
              ? "decisionRegionContinuationBranch"
              : ownedByDecision.classification === "forwardSkip"
                ? "decisionRegionForwardSkip"
                : "decisionRegionSideBranch",
          };
        }
      } else if (ownerLoopIsland && hasSideIncomingFromOwner) {
        const ownerSideGap = Math.max(layout.localBranchTargetOffset, layout.sideRouteGap * 3);
        columnDecision = {
          x: protectedIncomingSide === "left"
            ? ownerLoopIsland.left - ownerSideGap
            : ownerLoopIsland.right + ownerSideGap,
          placement: "horizontal",
          reason: "ownerAdjacentSideBlock",
        };
      } else if (ownerLoopIsland) {
        columnDecision = {
          x: 0,
          placement: "vertical",
          reason: "mainContinuationAfterOwner",
        };
      } else if (block.kind === "terminal") {
        columnDecision = {
          x: Math.max(
            layout.nestedLoopContinuationColumnOffset * 2,
            layout.localBranchTargetOffset * 1.7,
          ),
          placement: "horizontal",
          reason: "terminalSeparatedFromLoop",
        };
      } else if (
        block.kind === "result" ||
        hasBranchIncoming
      ) {
        columnDecision = {
          ...defaultColumnDecision,
          reason: defaultColumnDecision.reason === "straightFallthroughSpine"
            ? "resultBranchSidePlacement"
            : defaultColumnDecision.reason,
        };
      } else if (previousLoopIsland && nextLoopIsland) {
        columnDecision = {
          x: 0,
          placement: "vertical",
          reason: "majorLoopIslandStack",
        };
      }

      const targetXCenter = columnDecision.x;
      const currentXCenter = (bounds.left + bounds.right) / 2;
      const blockHeight = bounds.bottom - bounds.top;
      const blockWidth = bounds.right - bounds.left;

      let preferredTop = bounds.top;
      const incomingFromPlacedSource = incoming
        .map((entry) => blockById.get(entry.sourceBlockId))
        .filter((sourceBlock) => sourceBlock && Number.isFinite(sourceBlock._placedBottom));
      if (incomingFromPlacedSource.length > 0) {
        const sourceBottom = Math.max(...incomingFromPlacedSource.map((sourceBlock) => sourceBlock._placedBottom));
        preferredTop = sourceBottom + stepY;
      } else if (Number.isFinite(sequenceTopCursor)) {
        preferredTop = sequenceTopCursor + (firstNonSetupPlaced ? stepY : majorLoopIslandGap);
      }

      if (ownedByDecision && ownerDecisionBounds) {
        if (ownedByDecision.classification === "loopEntry") {
          preferredTop = Math.max(preferredTop, ownerDecisionBounds.bottom + majorLoopIslandGap);
        } else if (ownedByDecision.classification === "terminalExit") {
          preferredTop = ownerDecisionBounds.top + Math.round(stepY * 0.35);
        } else {
          preferredTop = ownerDecisionBounds.top + Math.round(stepY * 0.55);
        }
      }

      if (ownerLoopIsland && !incomingFromPlacedSource.length) {
        preferredTop = ownerLoopIsland.top + Math.round(stepY * 0.65);
      }

      if (!ownerLoopIsland && !previousLoopIsland && nextLoopIsland) {
        preferredTop = Math.min(
          preferredTop,
          nextLoopIsland.top - majorLoopIslandGap - blockHeight,
        );
      } else if (previousLoopIsland && nextLoopIsland && !ownerLoopIsland) {
        const minTop = previousLoopIsland.bottom + majorLoopIslandGap;
        const maxTop = nextLoopIsland.top - majorLoopIslandGap - blockHeight;
        if (maxTop >= minTop) {
          preferredTop = clampNumber(preferredTop, minTop, maxTop);
        } else {
          preferredTop = Math.max(preferredTop, minTop);
        }
      } else if (previousLoopIsland && !nextLoopIsland && !ownerLoopIsland) {
        preferredTop = Math.max(preferredTop, previousLoopIsland.bottom + majorLoopIslandGap);
        if (block.kind === "terminal") {
          columnDecision.reason = "terminalSeparatedFromLoop";
        }
      }

      if (ownedByDecision && ownerDecisionIsPreLoop && nextLoopIsland) {
        const maxTopBeforeLoop = nextLoopIsland.top - majorLoopIslandGap - blockHeight;
        preferredTop = Math.min(preferredTop, maxTopBeforeLoop);
      }

      const laneKey = String(targetXCenter);
      const laneBottom = laneBottomByX.get(laneKey);
      if (Number.isFinite(laneBottom)) {
        preferredTop = Math.max(preferredTop, laneBottom + stepY);
      }

      let proposedBounds = {
        left: targetXCenter - blockWidth / 2,
        right: targetXCenter + blockWidth / 2,
        top: preferredTop,
        bottom: preferredTop + blockHeight,
      };
      for (const loopIsland of majorLoopIslandEnvelopes) {
        if (ownerLoopIsland?.intervalKey === loopIsland.intervalKey) continue;
        if (!boundsOverlap(proposedBounds, loopIsland, 0.2)) continue;
        preferredTop = loopIsland.bottom + majorLoopIslandGap;
        proposedBounds = {
          left: targetXCenter - blockWidth / 2,
          right: targetXCenter + blockWidth / 2,
          top: preferredTop,
          bottom: preferredTop + blockHeight,
        };
      }
      const ownerLoopLabel = ownerLoopIsland
        ? `${formatInstructionNodeId(ownerLoopIsland.startIndex)}-${formatInstructionNodeId(ownerLoopIsland.endIndex)}`
        : null;
      let sideOverlap = sideRegionBounds.find((sideRegion) => (
        sideRegion.owner !== ownerLoopLabel &&
        boundsOverlap(proposedBounds, sideRegion, 0.2)
      )) ?? null;
      let overlapGuard = 0;
      while (sideOverlap && overlapGuard < 8) {
        preferredTop = sideOverlap.bottom + Math.round(stepY * 0.75);
        proposedBounds = {
          left: targetXCenter - blockWidth / 2,
          right: targetXCenter + blockWidth / 2,
          top: preferredTop,
          bottom: preferredTop + blockHeight,
        };
        sideOverlap = sideRegionBounds.find((sideRegion) => (
          sideRegion.owner !== ownerLoopLabel &&
          boundsOverlap(proposedBounds, sideRegion, 0.2)
        )) ?? null;
        overlapGuard += 1;
      }

      const deltaX = targetXCenter - currentXCenter;
      const deltaY = preferredTop - bounds.top;
      regionNodes.forEach((node) => {
        node.x += deltaX;
        node.y += deltaY;
      });
      const adjustedBounds = getRegionNodeBounds(regionNodes, layout);
      laneBottomByX.set(laneKey, adjustedBounds?.bottom ?? laneBottom ?? preferredTop);
      sequenceTopCursor = Math.max(sequenceTopCursor, adjustedBounds?.bottom ?? preferredTop);
      block._placedBottom = adjustedBounds?.bottom ?? preferredTop;
      const blockBoundsForDebug = adjustedBounds ?? bounds;
      const ownerBandTop = ownerLoopIsland
        ? ownerLoopIsland.top - stepY
        : null;
      const ownerBandBottom = ownerLoopIsland
        ? ownerLoopIsland.bottom + stepY
        : null;
      const withinOwnerVerticalBand = ownerLoopIsland
        ? blockBoundsForDebug.top >= ownerBandTop && blockBoundsForDebug.bottom <= ownerBandBottom
        : null;
      const overlapsLoopIslandEnvelope = loopIslandEnvelopes.some((loopIsland) => (
        (!ownerLoopIsland || loopIsland.intervalKey !== ownerLoopIsland.intervalKey) &&
        boundsOverlap(blockBoundsForDebug, loopIsland, 0.1)
      ));
      const hasDecisionOwnedSideOrTerminalRole = Boolean(
        ownedByDecision && (
          ownedByDecision.classification === "sideBranch" ||
          ownedByDecision.classification === "continuationBranch" ||
          ownedByDecision.classification === "terminalExit" ||
          ownedByDecision.classification === "forwardSkip"
        ),
      );
      if (hasDecisionOwnedSideOrTerminalRole) {
        const overlapLoopIsland = majorLoopIslandEnvelopes.find((loopIsland) => (
          (!ownerDecisionLoopIsland || loopIsland.intervalKey !== ownerDecisionLoopIsland.intervalKey) &&
          boundsOverlap(blockBoundsForDebug, loopIsland, 0.1)
        )) ?? null;
        if (overlapLoopIsland) {
          sideOrTerminalEdgesCrossingLoopEnvelope.push({
            owner: ownerDecisionBlock
              ? `${formatInstructionNodeId(ownerDecisionBlock.startIndex)}-${formatInstructionNodeId(ownerDecisionBlock.endIndex)}`
              : null,
            ownedBlock: `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
            classification: ownedByDecision.classification,
            overlappingLoopIsland:
              `${formatInstructionNodeId(overlapLoopIsland.startIndex)}-${formatInstructionNodeId(overlapLoopIsland.endIndex)}`,
            edgeId: ownedByDecision.edgeId,
          });
        }
      }
      if (overlapsLoopIslandEnvelope) {
        blocksOverlappingNonOwnerLoopEnvelope.push(
          `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
        );
      }

      blockPlacementRows.push({
        id: block.id,
        interval: `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
        startIndex: block.startIndex,
        endIndex: block.endIndex,
        blockKind: block.kind,
        instructionIds: block.instructionIds,
        incomingBlockEdges: incoming.map((entry) => entry.edgeId),
        outgoingBlockEdges: (outgoingByBlock.get(block.id) ?? []).map((entry) => entry.edgeId),
        width: Number(((adjustedBounds?.right ?? 0) - (adjustedBounds?.left ?? 0)).toFixed(2)),
        height: Number(((adjustedBounds?.bottom ?? 0) - (adjustedBounds?.top ?? 0)).toFixed(2)),
        x: Number((((adjustedBounds?.left ?? 0) + (adjustedBounds?.right ?? 0)) / 2).toFixed(2)),
        y: Number((((adjustedBounds?.top ?? 0) + (adjustedBounds?.bottom ?? 0)) / 2).toFixed(2)),
        placement: columnDecision.placement,
        placementReason: columnDecision.reason,
        ownerLoopIsland: ownerLoopLabel,
        ownerDecisionRegion: ownerDecisionBlock
          ? `${formatInstructionNodeId(ownerDecisionBlock.startIndex)}-${formatInstructionNodeId(ownerDecisionBlock.endIndex)}`
          : null,
        decisionOwnedClassification: ownedByDecision?.classification ?? null,
        withinOwnerVerticalBand,
        overlapsLoopIslandEnvelope,
      });
      firstNonSetupPlaced = true;
    });

    const getSetupNodesFromCurrentPositions = () => (
      Number.isInteger(setupEndIndex)
        ? instructionNodes.filter((node) => {
          const index = node.displayNode?.startIndex;
          return Number.isInteger(index) &&
            setupStartIndex <= index &&
            index <= setupEndIndex;
        })
        : []
    );
    const getFirstMajorDescriptorFromCurrentState = () => {
      const firstLoopCandidate = majorLoopIslandEnvelopes
        .filter((entry) => !Number.isInteger(setupEndIndex) || entry.startIndex > setupEndIndex)
        .sort((left, right) => left.startIndex - right.startIndex)[0] ?? null;
      const firstControlBlock = blocks
        .filter((block) => block.kind !== "setup")
        .filter((block) => !Number.isInteger(setupEndIndex) || block.startIndex > setupEndIndex)
        .sort((left, right) => left.startIndex - right.startIndex)[0] ?? null;
      const candidates = [];
      if (firstLoopCandidate) {
        candidates.push({
          source: "loopIsland",
          startIndex: firstLoopCandidate.startIndex,
          endIndex: firstLoopCandidate.endIndex,
          interval: `${formatInstructionNodeId(firstLoopCandidate.startIndex)}-${formatInstructionNodeId(firstLoopCandidate.endIndex)}`,
        });
      }
      if (firstControlBlock) {
        candidates.push({
          source: "genericBlock",
          blockKind: firstControlBlock.kind,
          startIndex: firstControlBlock.startIndex,
          endIndex: firstControlBlock.endIndex,
          interval: `${formatInstructionNodeId(firstControlBlock.startIndex)}-${formatInstructionNodeId(firstControlBlock.endIndex)}`,
        });
      }
      return candidates.sort((left, right) => left.startIndex - right.startIndex)[0] ?? null;
    };
    const getNodesForInstructionInterval = (startIndex, endIndex) => (
      instructionNodes.filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          startIndex <= index &&
          index <= endIndex;
      })
    );
    const finalCompactionWarnings = [];
    const finalCompactionDiagnostics = {
      setupBottomYFinalBeforeCompaction: null,
      firstMajorTopYFinalBeforeCompaction: null,
      finalGapBeforeCompaction: null,
      finalCompactionShift: 0,
      setupBottomYFinalAfterCompaction: null,
      firstMajorTopYFinalAfterCompaction: null,
      finalGapAfterCompaction: null,
      nodesShiftedCount: 0,
      shiftedStartIndex: null,
      shiftedIntervals: [],
      includedProtectedNodesInShift: false,
      includedAttachedSideNodesInShift: false,
      includedTerminalNodesInShift: false,
      includedSyntheticTerminalNodesInShift: false,
      firstMajorRegionInterval: null,
    };
    const finalGapThreshold = majorLoopIslandGap * majorGapThresholdMultiplier;
    const setupBoundsBeforeCompaction = getRegionNodeBounds(
      getSetupNodesFromCurrentPositions(),
      layout,
    );
    const firstMajorDescriptor = getFirstMajorDescriptorFromCurrentState();
    finalCompactionDiagnostics.firstMajorRegionInterval = firstMajorDescriptor?.interval ?? null;
    const firstMajorBoundsBeforeCompaction = firstMajorDescriptor
      ? getRegionNodeBounds(
        getNodesForInstructionInterval(
          firstMajorDescriptor.startIndex,
          firstMajorDescriptor.endIndex,
        ),
        layout,
      )
      : null;
    const setupPrefixMisorderedBeforeCompaction = [];
    if (Number.isFinite(firstMajorBoundsBeforeCompaction?.top)) {
      setupPrefixBlocks.forEach((block) => {
        const setupNodes = block.nodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
        const setupBounds = getRegionNodeBounds(setupNodes, layout);
        if (setupBounds && setupBounds.top > firstMajorBoundsBeforeCompaction.top) {
          setupPrefixMisorderedBeforeCompaction.push(
            `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
          );
        }
      });
    }
    const setupPrefixContiguousBeforeCompaction = setupPrefixMisorderedBeforeCompaction.length === 0;
    finalCompactionDiagnostics.setupBottomYFinalBeforeCompaction = Number.isFinite(setupBoundsBeforeCompaction?.bottom)
      ? Number(setupBoundsBeforeCompaction.bottom.toFixed(2))
      : null;
    finalCompactionDiagnostics.firstMajorTopYFinalBeforeCompaction = Number.isFinite(firstMajorBoundsBeforeCompaction?.top)
      ? Number(firstMajorBoundsBeforeCompaction.top.toFixed(2))
      : null;
    finalCompactionDiagnostics.finalGapBeforeCompaction = Number.isFinite(setupBoundsBeforeCompaction?.bottom) &&
      Number.isFinite(firstMajorBoundsBeforeCompaction?.top)
      ? Number((firstMajorBoundsBeforeCompaction.top - setupBoundsBeforeCompaction.bottom).toFixed(2))
      : null;

    if (!firstMajorDescriptor) {
      finalCompactionWarnings.push("finalCompactionCouldNotIdentifyFirstMajorRegion");
    }
    if (!setupPrefixContiguousBeforeCompaction) {
      finalCompactionWarnings.push("finalCompactionSkippedDueToSplitSetupPrefix");
    }

    if (
      firstMajorDescriptor &&
      setupPrefixContiguousBeforeCompaction &&
      Number.isFinite(finalCompactionDiagnostics.finalGapBeforeCompaction) &&
      finalCompactionDiagnostics.finalGapBeforeCompaction > finalGapThreshold
    ) {
      const finalCompactionShift = finalCompactionDiagnostics.finalGapBeforeCompaction - majorLoopIslandGap;
      const shiftedNodes = instructionNodes.filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) && index >= firstMajorDescriptor.startIndex;
      });
      if (shiftedNodes.length === 0) {
        finalCompactionWarnings.push("finalCompactionGapExceededButNoNodesShifted");
      } else {
        shiftedNodes.forEach((node) => {
          node.y -= finalCompactionShift;
        });
      }

      const shiftedInstructionIndexes = shiftedNodes
        .map((node) => node.displayNode?.startIndex)
        .filter((index) => Number.isInteger(index));
      const shiftedIntervals = toContiguousIntervals(shiftedInstructionIndexes)
        .map((interval) => `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`);
      const protectedNodesIncluded = shiftedInstructionIndexes.some((index) => (
        (genericRegionModel?.protectedIntervals ?? []).some((interval) => (
          interval.startIndex <= index && index <= interval.endIndex
        ))
      ));
      const attachedNodesIncluded = shiftedInstructionIndexes.some((index) => (
        attachedSideRegions.some((region) => region.startIndex <= index && index <= region.endIndex)
      ));
      const terminalNodesIncluded = shiftedInstructionIndexes.some((index) => (
        blocks.some((block) => (
          block.kind === "terminal" &&
          block.startIndex <= index &&
          index <= block.endIndex
        )) || index === analysis.program.length - 1
      ));

      finalCompactionDiagnostics.finalCompactionShift = Number(finalCompactionShift.toFixed(2));
      finalCompactionDiagnostics.nodesShiftedCount = shiftedNodes.length;
      finalCompactionDiagnostics.shiftedStartIndex = firstMajorDescriptor.startIndex;
      finalCompactionDiagnostics.shiftedIntervals = shiftedIntervals;
      finalCompactionDiagnostics.includedProtectedNodesInShift = protectedNodesIncluded;
      finalCompactionDiagnostics.includedAttachedSideNodesInShift = attachedNodesIncluded;
      finalCompactionDiagnostics.includedTerminalNodesInShift = terminalNodesIncluded;
      finalCompactionDiagnostics.includedSyntheticTerminalNodesInShift = false;

      const expectedProtectedShiftCandidates = instructionNodes.some((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          index >= firstMajorDescriptor.startIndex &&
          (genericRegionModel?.protectedIntervals ?? []).some((interval) => (
            interval.startIndex <= index && index <= interval.endIndex
          ));
      });
      const expectedAttachedShiftCandidates = instructionNodes.some((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          index >= firstMajorDescriptor.startIndex &&
          attachedSideRegions.some((region) => region.startIndex <= index && index <= region.endIndex);
      });

      if (expectedProtectedShiftCandidates && !protectedNodesIncluded) {
        finalCompactionWarnings.push("finalCompactionShiftExcludedProtectedNodesUnexpectedly");
      }
      if (expectedAttachedShiftCandidates && !attachedNodesIncluded) {
        finalCompactionWarnings.push("finalCompactionShiftExcludedAttachedSideNodesUnexpectedly");
      }
    }

    const setupBoundsAfterCompaction = getRegionNodeBounds(
      getSetupNodesFromCurrentPositions(),
      layout,
    );
    const firstMajorBoundsAfterCompaction = firstMajorDescriptor
      ? getRegionNodeBounds(
        getNodesForInstructionInterval(
          firstMajorDescriptor.startIndex,
          firstMajorDescriptor.endIndex,
        ),
        layout,
      )
      : null;
    finalCompactionDiagnostics.setupBottomYFinalAfterCompaction = Number.isFinite(setupBoundsAfterCompaction?.bottom)
      ? Number(setupBoundsAfterCompaction.bottom.toFixed(2))
      : null;
    finalCompactionDiagnostics.firstMajorTopYFinalAfterCompaction = Number.isFinite(firstMajorBoundsAfterCompaction?.top)
      ? Number(firstMajorBoundsAfterCompaction.top.toFixed(2))
      : null;
    finalCompactionDiagnostics.finalGapAfterCompaction = Number.isFinite(setupBoundsAfterCompaction?.bottom) &&
      Number.isFinite(firstMajorBoundsAfterCompaction?.top)
      ? Number((firstMajorBoundsAfterCompaction.top - setupBoundsAfterCompaction.bottom).toFixed(2))
      : null;

    if (
      Number.isFinite(finalCompactionDiagnostics.finalGapAfterCompaction) &&
      finalCompactionDiagnostics.finalGapAfterCompaction > finalGapThreshold
    ) {
      finalCompactionWarnings.push("finalCompactionGapStillExceedsThreshold");
    }
    const mergeNodePromotions = applyBranchMergePromotionPlacement({
      analysis,
      instructionNodes,
      layout,
    });

    const recomputePlacementRowsFromFinalNodePositions = () => {
      const sideRegionRowByInterval = new Map(sideRegionRows.map((row) => [row.interval, row]));
      attachedSideRegions.forEach((region) => {
        const rowKey = `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`;
        const row = sideRegionRowByInterval.get(rowKey);
        if (!row) return;
        const rowBounds = getRegionNodeBounds(region.nodes ?? [], layout);
        if (!rowBounds) return;
        row.x = Number((((rowBounds.left + rowBounds.right) / 2).toFixed(2)));
        row.y = Number((((rowBounds.top + rowBounds.bottom) / 2).toFixed(2)));
        row.width = Number((rowBounds.right - rowBounds.left).toFixed(2));
        row.height = Number((rowBounds.bottom - rowBounds.top).toFixed(2));
      });

      blockPlacementRows.forEach((row) => {
        const block = blockById.get(row.id);
        if (!block) return;
        const rowNodes = block.nodeIds
          .map((nodeId) => nodeById.get(nodeId))
          .filter(Boolean);
        const rowBounds = getRegionNodeBounds(rowNodes, layout);
        if (!rowBounds) return;
        row.x = Number((((rowBounds.left + rowBounds.right) / 2).toFixed(2)));
        row.y = Number((((rowBounds.top + rowBounds.bottom) / 2).toFixed(2)));
        row.width = Number((rowBounds.right - rowBounds.left).toFixed(2));
        row.height = Number((rowBounds.bottom - rowBounds.top).toFixed(2));
      });
    };

    recomputePlacementRowsFromFinalNodePositions();

    const blockPlacementById = new Map(blockPlacementRows.map((row) => [row.id, row]));
    const decisionRegionOwnedBlockIdSet = new Set();
    const decisionRegionRows = Array.from(decisionRegionByOwnerId.values())
      .map((decisionRegion) => {
        const ownerRow = blockPlacementById.get(decisionRegion.ownerBlockId);
        if (!ownerRow) return null;

        const ownedRows = Array.from(decisionOwnedByBlockId.entries())
          .filter(([, ownership]) => ownership.ownerBlockId === decisionRegion.ownerBlockId)
          .map(([targetBlockId, ownership]) => {
            const row = blockPlacementById.get(targetBlockId);
            if (!row) return null;
            return {
              ...row,
              decisionClassification: ownership.classification,
              decisionEdgeId: ownership.edgeId,
            };
          })
          .filter(Boolean);

        decisionRegionOwnedBlockIdSet.add(decisionRegion.ownerBlockId);
        ownedRows.forEach((row) => decisionRegionOwnedBlockIdSet.add(row.id));

        const ownerTop = ownerRow.y - ownerRow.height / 2;
        const ownerBottom = ownerRow.y + ownerRow.height / 2;
        const ownerLeft = ownerRow.x - ownerRow.width / 2;
        const ownerRight = ownerRow.x + ownerRow.width / 2;
        const topY = Math.min(
          ownerTop,
          ...ownedRows.map((row) => row.y - row.height / 2),
        );
        const bottomY = Math.max(
          ownerBottom,
          ...ownedRows.map((row) => row.y + row.height / 2),
        );
        const leftX = Math.min(
          ownerLeft,
          ...ownedRows.map((row) => row.x - row.width / 2),
        );
        const rightX = Math.max(
          ownerRight,
          ...ownedRows.map((row) => row.x + row.width / 2),
        );
        const centerX = (leftX + rightX) / 2;

        const ownedSideOrTerminalRows = ownedRows.filter((row) => (
          row.decisionClassification === "sideBranch" ||
          row.decisionClassification === "continuationBranch" ||
          row.decisionClassification === "terminalExit" ||
          row.decisionClassification === "forwardSkip"
        ));
        const overlapsLoopIslandEnvelope = ownedSideOrTerminalRows.some((row) => row.overlapsLoopIslandEnvelope);
        if (overlapsLoopIslandEnvelope) {
          decisionRegionPlacementWarnings.push(
            `decisionRegion ${decisionRegion.ownerInterval} has side/terminal owned blocks overlapping loop envelope`,
          );
        }

        return {
          ownerId: decisionRegion.ownerBlockId,
          ownerIndex: decisionRegion.ownerDecisionIndex,
          interval: decisionRegion.ownerInterval,
          topY: Number(topY.toFixed(2)),
          bottomY: Number(bottomY.toFixed(2)),
          x: Number(centerX.toFixed(2)),
          fallthroughTarget: decisionRegion.fallthroughTarget,
          sideBranchTargets: decisionRegion.sideBranchTargets,
          terminalTargets: decisionRegion.terminalTargets,
          loopEntryTargets: decisionRegion.loopEntryTargets,
          continuationTargets: decisionRegion.continuationTargets,
          forwardSkipTargets: decisionRegion.forwardSkipTargets,
          ownedBlocks: ownedRows.map((row) => ({
            interval: row.interval,
            blockKind: row.blockKind,
            classification: row.decisionClassification,
            placementReason: row.placementReason,
            overlapsLoopIslandEnvelope: row.overlapsLoopIslandEnvelope,
          })),
          outgoingEdgeClassifications: decisionRegion.outgoingClassifications,
          placementReason: Number.isInteger(firstMajorLoopStartIndex) &&
            decisionRegion.ownerDecisionIndex < firstMajorLoopStartIndex
            ? "preLoopDecisionRegion"
            : "decisionRegionCluster",
          overlapsLoopIslandEnvelope,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.topY - right.topY || left.x - right.x);

    const decisionRegionOrder = decisionRegionRows.map((entry) => entry.interval);

    const buildMajorRegionOrderFromFinalPositions = () => [
      ...decisionRegionRows.map((entry) => ({
        kind: "decisionRegion",
        interval: entry.interval,
        topY: entry.topY,
        bottomY: entry.bottomY,
        x: entry.x,
        placementReason: entry.placementReason,
      })),
      ...majorLoopIslandEnvelopes.map((entry) => {
        const regionNodes = getNodesForInstructionInterval(entry.startIndex, entry.endIndex);
        const regionBounds = getRegionNodeBounds(regionNodes, layout);
        return {
          kind: "loopIsland",
          interval: `${formatInstructionNodeId(entry.startIndex)}-${formatInstructionNodeId(entry.endIndex)}`,
          topY: Number((regionBounds?.top ?? entry.top).toFixed(2)),
          bottomY: Number((regionBounds?.bottom ?? entry.bottom).toFixed(2)),
          x: Number(((((regionBounds?.left ?? entry.left) + (regionBounds?.right ?? entry.right)) / 2).toFixed(2))),
          placementReason: "majorLoopIslandStack",
        };
      }),
      ...sideRegionRows.map((entry) => ({
        kind: "attachedSideRegion",
        interval: entry.interval,
        topY: Number((entry.y - entry.height / 2).toFixed(2)),
        bottomY: Number((entry.y + entry.height / 2).toFixed(2)),
        x: entry.x,
        placementReason: entry.placementReason,
      })),
      ...blockPlacementRows.map((entry) => ({
        id: entry.id,
        kind: "genericBlock",
        blockKind: entry.blockKind,
        interval: entry.interval,
        topY: Number((entry.y - entry.height / 2).toFixed(2)),
        bottomY: Number((entry.y + entry.height / 2).toFixed(2)),
        x: entry.x,
        placementReason: entry.placementReason,
      })).filter((entry) => !decisionRegionOwnedBlockIdSet.has(entry.id)),
    ]
      .sort((left, right) => left.topY - right.topY || left.x - right.x);

    const majorRegionOrder = buildMajorRegionOrderFromFinalPositions();
    const setupBoundsAfterPlacement = getRegionNodeBounds(getSetupNodesFromCurrentPositions(), layout);
    const setupRegionOrderRow = setupBoundsAfterPlacement
      ? {
        kind: "setup",
        interval: `${formatInstructionNodeId(setupStartIndex)}-${formatInstructionNodeId(setupEndIndex)}`,
        topY: Number(setupBoundsAfterPlacement.top.toFixed(2)),
        bottomY: Number(setupBoundsAfterPlacement.bottom.toFixed(2)),
        x: Number((((setupBoundsAfterPlacement.left + setupBoundsAfterPlacement.right) / 2).toFixed(2))),
        placementReason: "setupAnchor",
      }
      : null;
    if (Number.isFinite(setupPrefixTopY) && Number.isFinite(setupPrefixBottomY) && setupPrefixBlocks.length > 0) {
      const setupRowsSorted = blockPlacementRows
        .filter((row) => setupPrefixBlockIdSet.has(row.id))
        .sort((left, right) => left.startIndex - right.startIndex);
      setupPrefixContiguous = setupRowsSorted.every((row, index) => {
        if (index === 0) return true;
        const previousRow = setupRowsSorted[index - 1];
        const previousBottom = previousRow.y + previousRow.height / 2;
        const currentTop = row.y - row.height / 2;
        return currentTop >= previousBottom - 0.5 && currentTop - previousBottom <= stepY * 1.25;
      }) && setupPrefixBlocksMisorderedAfterFix.length === 0;
    } else {
      setupPrefixContiguous = setupPrefixBlocks.length === 0;
    }
    const orderedMajorRegionsForGap = [
      ...(setupRegionOrderRow ? [setupRegionOrderRow] : []),
      ...majorRegionOrder,
    ]
      .sort((left, right) => left.topY - right.topY || left.x - right.x);
    const majorRegionVerticalGaps = [];
    for (let index = 0; index < orderedMajorRegionsForGap.length - 1; index += 1) {
      const current = orderedMajorRegionsForGap[index];
      const next = orderedMajorRegionsForGap[index + 1];
      const gap = Number((next.topY - current.bottomY).toFixed(2));
      const expectedGap = majorLoopIslandGap;
      const reason = current.kind === "setup"
        ? "setupToFirstMajorRegion"
        : current.kind === "decisionRegion" && next.kind === "loopIsland"
          ? "decisionRegionToLoopIsland"
          : next.kind === "decisionRegion"
            ? "decisionRegionCluster"
        : next.kind === "attachedSideRegion"
          ? "ownerAdjacentSideBlock"
          : "majorLoopIslandStack";
      majorRegionVerticalGaps.push({
        from: `${current.kind}:${current.interval}`,
        to: `${next.kind}:${next.interval}`,
        gap,
        expectedGap,
        reason,
      });
    }
    const largestVerticalGap = majorRegionVerticalGaps.length > 0
      ? majorRegionVerticalGaps.reduce((largest, entry) => (
        entry.gap > largest.gap ? entry : largest
      ))
      : null;
    const firstMajorRegionRow = orderedMajorRegionsForGap.find((entry) => (
      entry.kind !== "setup" &&
      (
        entry.kind === "decisionRegion" ||
        entry.kind === "loopIsland" ||
        (entry.kind === "genericBlock" && entry.blockKind !== "setup")
      )
    )) ?? null;
    const setupBottomY = setupRegionOrderRow?.bottomY ?? null;
    const firstMajorRegionY = firstMajorRegionRow?.topY ?? null;
    if (Number.isFinite(firstMajorRegionY)) {
      setupPrefixBlocks.forEach((block) => {
        const setupNodes = block.nodeIds.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
        const setupBounds = getRegionNodeBounds(setupNodes, layout);
        if (setupBounds && setupBounds.top > firstMajorRegionY) {
          setupPrefixBlocksMisorderedAfterFix.push(
            `${formatInstructionNodeId(block.startIndex)}-${formatInstructionNodeId(block.endIndex)}`,
          );
        }
      });
    }
    if (setupPrefixBlocksMisorderedAfterFix.length > 0) {
      setupPrefixOrderingWarnings.push("setupPrefixBlocksMisorderedAfterFix");
      setupPrefixContiguous = false;
      throw new Error("setupPrefixOrderingFailedAfterPlacement");
    }
    const gapFromSetupToFirstMajorRegion = Number.isFinite(setupBottomY) && Number.isFinite(firstMajorRegionY)
      ? Number((firstMajorRegionY - setupBottomY).toFixed(2))
      : null;
    const hasExcessiveMajorRegionGap = majorRegionVerticalGaps.some((entry) => (
      entry.gap > entry.expectedGap * majorGapThresholdMultiplier
    ));
    const afterBounds = computeInstructionBounds(instructionNodes, layout);
    const uniqueOverlappingBlocks = Array.from(new Set(blocksOverlappingNonOwnerLoopEnvelope));
    const uniqueSideBlocksOutsideOwnerBand = Array.from(new Set(sideBlocksOutsideOwnerBand));
    const uniquePreLoopDecisionRegions = Array.from(new Set(preLoopDecisionRegions));
    const uniqueSideOrTerminalEdgesCrossingLoopEnvelope = Array.from(
      new Map(
        sideOrTerminalEdgesCrossingLoopEnvelope.map((entry) => [
          `${entry.owner}|${entry.ownedBlock}|${entry.classification}|${entry.overlappingLoopIsland}|${entry.edgeId}`,
          entry,
        ]),
      ).values(),
    );
    const hasLoopIslandEnvelopeOverlap = blockPlacementRows.some(
      (entry) => entry.overlapsLoopIslandEnvelope,
    ) || sideRegionRows.some((entry) => entry.overlapsLoopIslandEnvelope);

    return {
      applied: true,
      status: "applied",
      blocks: blockPlacementRows,
      blockEdges,
      loopIslandEnvelopes: loopIslandEnvelopes.map((entry) => ({
        interval: `${formatInstructionNodeId(entry.startIndex)}-${formatInstructionNodeId(entry.endIndex)}`,
        source: entry.source,
        coreBounds: {
          left: Number(entry.coreLeft.toFixed(2)),
          right: Number(entry.coreRight.toFixed(2)),
          top: Number(entry.coreTop.toFixed(2)),
          bottom: Number(entry.coreBottom.toFixed(2)),
        },
        envelopeBounds: {
          left: Number(entry.left.toFixed(2)),
          right: Number(entry.right.toFixed(2)),
          top: Number(entry.top.toFixed(2)),
          bottom: Number(entry.bottom.toFixed(2)),
        },
        returnLaneExtents: {
          left: Number(entry.leftReturnExtent.toFixed(2)),
          right: Number(entry.rightReturnExtent.toFixed(2)),
        },
      })),
      attachedSideBlocks: sideRegionRows,
      sideBlockOwnership: sideBlockOwnershipRows,
      decisionRegions: decisionRegionRows,
      preLoopDecisionRegions: uniquePreLoopDecisionRegions,
      decisionRegionOrder,
      decisionRegionPlacementWarnings,
      sideOrTerminalEdgesCrossingLoopEnvelope: uniqueSideOrTerminalEdgesCrossingLoopEnvelope,
      blocksOverlappingNonOwnerLoopEnvelope: uniqueOverlappingBlocks,
      sideBlocksOutsideOwnerBand: uniqueSideBlocksOutsideOwnerBand,
      hasLoopIslandEnvelopeOverlap,
      setupPrefixInterval: Number.isInteger(setupEndIndex)
        ? `${formatInstructionNodeId(setupStartIndex)}-${formatInstructionNodeId(setupEndIndex)}`
        : null,
      setupPrefixNodeIds,
      setupPrefixTopY: Number.isFinite(setupPrefixTopY) ? Number(setupPrefixTopY.toFixed(2)) : null,
      setupPrefixBottomY: Number.isFinite(setupPrefixBottomY) ? Number(setupPrefixBottomY.toFixed(2)) : null,
      setupPrefixContiguous,
      setupBlocksMisorderedBeforeFix: setupPrefixBlocksMisorderedBeforeFix,
      setupBlocksMisorderedAfterFix: setupPrefixBlocksMisorderedAfterFix,
      firstMajorAfterSetup: firstMajorRegionRow?.interval ?? firstMajorDescriptor?.interval ?? null,
      gapFromSetupPrefixToFirstMajor: Number.isFinite(setupPrefixBottomY) && Number.isFinite(firstMajorRegionY)
        ? Number((firstMajorRegionY - setupPrefixBottomY).toFixed(2))
        : null,
      setupPrefixOrderingWarnings,
      majorRegionOrder,
      majorRegionVerticalGaps,
      largestVerticalGap,
      firstMajorRegionY,
      setupBottomY,
      gapFromSetupToFirstMajorRegion,
      hasExcessiveMajorRegionGap,
      expectedMajorRegionGap: majorLoopIslandGap,
      setupBottomYFinalBeforeCompaction: finalCompactionDiagnostics.setupBottomYFinalBeforeCompaction,
      firstMajorTopYFinalBeforeCompaction: finalCompactionDiagnostics.firstMajorTopYFinalBeforeCompaction,
      finalGapBeforeCompaction: finalCompactionDiagnostics.finalGapBeforeCompaction,
      finalCompactionShift: finalCompactionDiagnostics.finalCompactionShift,
      setupBottomYFinalAfterCompaction: finalCompactionDiagnostics.setupBottomYFinalAfterCompaction,
      firstMajorTopYFinalAfterCompaction: finalCompactionDiagnostics.firstMajorTopYFinalAfterCompaction,
      finalGapAfterCompaction: finalCompactionDiagnostics.finalGapAfterCompaction,
      nodesShiftedCount: finalCompactionDiagnostics.nodesShiftedCount,
      shiftedStartIndex: finalCompactionDiagnostics.shiftedStartIndex,
      shiftedIntervals: finalCompactionDiagnostics.shiftedIntervals,
      includedProtectedNodesInShift: finalCompactionDiagnostics.includedProtectedNodesInShift,
      includedAttachedSideNodesInShift: finalCompactionDiagnostics.includedAttachedSideNodesInShift,
      includedTerminalNodesInShift: finalCompactionDiagnostics.includedTerminalNodesInShift,
      includedSyntheticTerminalNodesInShift:
        finalCompactionDiagnostics.includedSyntheticTerminalNodesInShift,
      firstMajorRegionInterval: finalCompactionDiagnostics.firstMajorRegionInterval,
      finalCompactionWarnings,
      mergeNodePromotions,
      beforeBounds,
      afterBounds,
      heightReduction: Number((beforeBounds.height - afterBounds.height).toFixed(2)),
      widthIncrease: Number((afterBounds.width - beforeBounds.width).toFixed(2)),
      fallbackStatus: "none",
      warning: finalCompactionWarnings.length > 0
        ? finalCompactionWarnings.join(";")
        : null,
    };
  } catch (error) {
    instructionNodes.forEach((node) => {
      const original = originalPositions.get(node.id);
      if (!original) return;
      node.x = original.x;
      node.y = original.y;
    });

    return {
      applied: false,
      status: "failed",
      blocks: [],
      blockEdges: [],
      loopIslandEnvelopes: [],
      attachedSideBlocks: [],
      sideBlockOwnership: [],
      decisionRegions: [],
      preLoopDecisionRegions: [],
      decisionRegionOrder: [],
      decisionRegionPlacementWarnings: [],
      sideOrTerminalEdgesCrossingLoopEnvelope: [],
      blocksOverlappingNonOwnerLoopEnvelope: [],
      sideBlocksOutsideOwnerBand: [],
      hasLoopIslandEnvelopeOverlap: false,
      setupPrefixInterval: null,
      setupPrefixNodeIds: [],
      setupPrefixTopY: null,
      setupPrefixBottomY: null,
      setupPrefixContiguous: false,
      setupBlocksMisorderedBeforeFix: [],
      setupBlocksMisorderedAfterFix: [],
      firstMajorAfterSetup: null,
      gapFromSetupPrefixToFirstMajor: null,
      setupPrefixOrderingWarnings: [],
      majorRegionOrder: [],
      majorRegionVerticalGaps: [],
      largestVerticalGap: null,
      firstMajorRegionY: null,
      setupBottomY: null,
      gapFromSetupToFirstMajorRegion: null,
      hasExcessiveMajorRegionGap: false,
      expectedMajorRegionGap: null,
      setupBottomYFinalBeforeCompaction: null,
      firstMajorTopYFinalBeforeCompaction: null,
      finalGapBeforeCompaction: null,
      finalCompactionShift: null,
      setupBottomYFinalAfterCompaction: null,
      firstMajorTopYFinalAfterCompaction: null,
      finalGapAfterCompaction: null,
      nodesShiftedCount: 0,
      shiftedStartIndex: null,
      shiftedIntervals: [],
      includedProtectedNodesInShift: false,
      includedAttachedSideNodesInShift: false,
      includedTerminalNodesInShift: false,
      includedSyntheticTerminalNodesInShift: false,
      firstMajorRegionInterval: null,
      finalCompactionWarnings: [],
      mergeNodePromotions: [],
      beforeBounds: null,
      afterBounds: null,
      heightReduction: null,
      widthIncrease: null,
      fallbackStatus: "fallbackToPreviousGenericPlacement",
      warning: `genericControlFlowBlockLayoutFailed: ${error?.message ?? "unknown error"}`,
    };
  }
}

function computeInstructionBounds(nodes, layout) {
  const instructionBounds = nodes
    .filter((node) => node.id.startsWith("i-"))
    .map((node) => getNodeBounds(node, layout));

  if (instructionBounds.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

  const minX = Math.min(...instructionBounds.map((bounds) => bounds.left));
  const maxX = Math.max(...instructionBounds.map((bounds) => bounds.right));
  const minY = Math.min(...instructionBounds.map((bounds) => bounds.top));
  const maxY = Math.max(...instructionBounds.map((bounds) => bounds.bottom));

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getRegionNodeBounds(regionNodes, layout) {
  if (!regionNodes || regionNodes.length === 0) return null;

  const bounds = regionNodes.map((node) => getNodeBounds(node, layout));

  return {
    left: Math.min(...bounds.map((entry) => entry.left)),
    right: Math.max(...bounds.map((entry) => entry.right)),
    top: Math.min(...bounds.map((entry) => entry.top)),
    bottom: Math.max(...bounds.map((entry) => entry.bottom)),
  };
}

function applyGenericEmbeddedBlockPacking(
  instructionNodes,
  blocks,
  attachedSideRegions,
  layout,
) {
  const blockEntries = blocks
    .map((block) => {
      const coreNodes = instructionNodes.filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          block.coreLoop.startIndex <= index &&
          index <= block.coreLoop.endIndex;
      });
      const ownedSideRegions = attachedSideRegions.filter(
        (region) => region.ownerStartIndex === block.coreLoop.startIndex &&
          region.ownerEndIndex === block.coreLoop.endIndex,
      );
      const ownedSideNodes = ownedSideRegions.flatMap((region) => region.nodes ?? []);

      return {
        block,
        coreNodes,
        ownedSideRegions,
        ownedSideNodes,
      };
    })
    .sort((left, right) => left.block.coreLoop.startIndex - right.block.coreLoop.startIndex);

  const beforeBounds = computeInstructionBounds(instructionNodes, layout);
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const blockPlacementRows = [];
  let previousCoreBottom = null;

  blockEntries.forEach((entry) => {
    const coreBoundsBefore = getRegionNodeBounds(entry.coreNodes, layout);
    if (!coreBoundsBefore) return;

    const desiredTop = Number.isFinite(previousCoreBottom)
      ? previousCoreBottom + stepY * 1.1
      : coreBoundsBefore.top;
    const deltaY = desiredTop - coreBoundsBefore.top;

    if (Math.abs(deltaY) > 0.01) {
      [...entry.coreNodes, ...entry.ownedSideNodes].forEach((node) => {
        node.y += deltaY;
      });
    }

    const coreBoundsAfter = getRegionNodeBounds(entry.coreNodes, layout);
    previousCoreBottom = coreBoundsAfter?.bottom ?? previousCoreBottom;

    blockPlacementRows.push({
      kind: "protectedBlock",
      interval: `${formatInstructionNodeId(entry.block.coreLoop.startIndex)}-${formatInstructionNodeId(entry.block.coreLoop.endIndex)}`,
      x: Number(((coreBoundsAfter?.left ?? 0) + (coreBoundsAfter?.right ?? 0)) / 2),
      y: Number(((coreBoundsAfter?.top ?? 0) + (coreBoundsAfter?.bottom ?? 0)) / 2),
      width: Number((coreBoundsAfter?.right ?? 0) - (coreBoundsAfter?.left ?? 0)),
      height: Number((coreBoundsAfter?.bottom ?? 0) - (coreBoundsAfter?.top ?? 0)),
      placement: Math.abs(deltaY) > 0.01 ? "verticalCompacted" : "kept",
      reason: Number.isFinite(previousCoreBottom)
        ? "stackByCoreEnvelopeNotByAttachedSideHeight"
        : "anchorFirstProtectedBlock",
    });
  });

  const bySide = new Map();
  attachedSideRegions.forEach((region) => {
    if (!bySide.has(region.side)) bySide.set(region.side, []);
    bySide.get(region.side).push(region);
  });
  const sideColumnStep = Math.max(layout.localBranchTargetOffset * 0.65, 72);
  const sideRegionVerticalGap = Math.round(stepY * 0.35);

  bySide.forEach((regions, side) => {
    const sorted = [...regions].sort((left, right) => {
      const leftTop = Math.min(...(left.nodes ?? []).map((node) => getNodeBounds(node, layout).top));
      const rightTop = Math.min(...(right.nodes ?? []).map((node) => getNodeBounds(node, layout).top));
      return leftTop - rightTop;
    });
    const columns = [];

    sorted.forEach((region) => {
      const ownerCoreNodes = instructionNodes.filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          region.ownerStartIndex <= index &&
          index <= region.ownerEndIndex;
      });
      const ownerBounds = getRegionNodeBounds(ownerCoreNodes, layout);
      if (!ownerBounds || !region.nodes?.length) return;

      const regionBounds = getRegionNodeBounds(region.nodes, layout);
      const localReturnLaneX = ownerBounds.left - layout.loopLaneDistance - layout.loopLaneStep * 3;
      const ownerSafeRightX = Math.max(
        ownerBounds.right + layout.localBranchTargetOffset,
        ownerBounds.right + layout.sideRouteGap * 2,
      );
      const ownerSafeLeftX = Math.min(
        localReturnLaneX - layout.sideRouteGap * 2,
        ownerBounds.left - layout.localBranchTargetOffset,
      );
      const baseX = side === "right"
        ? Math.max(region.columnX ?? ownerSafeRightX, ownerSafeRightX)
        : Math.min(region.columnX ?? ownerSafeLeftX, ownerSafeLeftX);

      let selectedColumn = null;
      for (const column of columns) {
        const noOverlap = regionBounds.top > column.lastBottom + sideRegionVerticalGap;
        const validBase = side === "right"
          ? column.x >= baseX
          : column.x <= baseX;
        if (noOverlap && validBase) {
          selectedColumn = column;
          break;
        }
      }

      if (!selectedColumn) {
        const boundary = columns.length > 0
          ? (side === "right"
            ? Math.max(...columns.map((column) => column.x))
            : Math.min(...columns.map((column) => column.x)))
          : baseX;
        selectedColumn = {
          x: columns.length === 0
            ? baseX
            : side === "right"
              ? Math.max(baseX, boundary + sideColumnStep)
              : Math.min(baseX, boundary - sideColumnStep),
          lastBottom: -Infinity,
        };
        columns.push(selectedColumn);
      }

      region.nodes.forEach((node) => {
        node.x = selectedColumn.x;
      });
      const adjustedBounds = getRegionNodeBounds(region.nodes, layout);
      selectedColumn.lastBottom = adjustedBounds?.bottom ?? selectedColumn.lastBottom;

      region.columnX = selectedColumn.x;
      region.topY = adjustedBounds?.top ?? region.topY;
      region.bottomY = adjustedBounds?.bottom ?? region.bottomY;
    });
  });

  attachedSideRegions.forEach((region) => {
    const regionBounds = getRegionNodeBounds(region.nodes, layout);
    blockPlacementRows.push({
      kind: "attachedSideRegion",
      interval: `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
      x: Number(((regionBounds?.left ?? 0) + (regionBounds?.right ?? 0)) / 2),
      y: Number(((regionBounds?.top ?? 0) + (regionBounds?.bottom ?? 0)) / 2),
      width: Number((regionBounds?.right ?? 0) - (regionBounds?.left ?? 0)),
      height: Number((regionBounds?.bottom ?? 0) - (regionBounds?.top ?? 0)),
      placement: "horizontalSidePlacement",
      reason: "ownedByProtectedBlockSideExit",
      owner: `${formatInstructionNodeId(region.ownerStartIndex)}-${formatInstructionNodeId(region.ownerEndIndex)}`,
      side: region.side,
      columnX: region.columnX,
    });
  });

  const afterBounds = computeInstructionBounds(instructionNodes, layout);

  return {
    beforeBounds,
    afterBounds,
    heightReduction: Number((beforeBounds.height - afterBounds.height).toFixed(2)),
    widthIncrease: Number((afterBounds.width - beforeBounds.width).toFixed(2)),
    regionBlocks: blockPlacementRows,
  };
}

function buildEmbeddedNestedLoopInstructionNodes(
  program,
  analysis,
  motif,
  embeddedRegionLayout,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const setupStepY = layout.actionNodeHeight + layout.verticalGap;
  const displayNodes = buildDisplayNodes(program, analysis, { collapseSetupBlocks });
  const sections = buildNestedLoopLayoutSections(motif);
  const setupDisplayNodes = displayNodes.filter(
    (displayNode) => displayNode.endIndex < embeddedRegionLayout.coreLoop.startIndex,
  );
  const setupOrderByStartIndex = new Map(
    setupDisplayNodes.map((displayNode, index) => [displayNode.startIndex, index]),
  );
  const continuationDisplayNodes = displayNodes.filter(
    (displayNode) => displayNode.startIndex >= embeddedRegionLayout.continuationRegion.startIndex,
  );
  const continuationOrderByStartIndex = new Map(
    continuationDisplayNodes.map((displayNode, index) => [displayNode.startIndex, index]),
  );
  const terminalTailPattern = detectEmbeddedTailSharedHaltPattern(
    analysis.edges,
    analysis,
    embeddedRegionLayout.continuationRegion?.startIndex ?? null,
  );
  const terminalActionIndex = terminalTailPattern?.terminalActionIndex ?? null;
  const terminalTailExtraGap = Math.round(layout.verticalGap * 0.9);

  const rawOuterHeaderPosition = getNestedLoopNodePosition(
    motif.outerLoop.headerIndex,
    motif,
    layout,
    sections,
  );
  const desiredOuterHeaderY = (setupDisplayNodes.length + 2) * setupStepY;
  const coreOffsetY = desiredOuterHeaderY - rawOuterHeaderPosition.y;
  const fallbackContinuationBaseY = desiredOuterHeaderY + setupStepY * 2;
  const continuationEntryEdge = analysis.edges.find((edge) => (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    embeddedRegionLayout.coreLoop.startIndex <= edge.sourceIndex &&
    edge.sourceIndex <= embeddedRegionLayout.coreLoop.endIndex &&
    edge.targetIndex >= embeddedRegionLayout.continuationRegion.startIndex
  )) ?? null;
  const continuationEntrySourceIndex = continuationEntryEdge?.sourceIndex ?? null;
  const coreDisplayNodes = displayNodes.filter(
    (displayNode) => displayNode.startIndex <= embeddedRegionLayout.coreLoop.endIndex,
  );
  const corePositionByStartIndex = new Map();

  coreDisplayNodes.forEach((displayNode) => {
    const instructionIndex = displayNode.startIndex;

    if (displayNode.endIndex < embeddedRegionLayout.coreLoop.startIndex) {
      const setupOrder = setupOrderByStartIndex.get(displayNode.startIndex) ?? 0;
      corePositionByStartIndex.set(displayNode.startIndex, {
        x: 0,
        y: (setupOrder + 1) * setupStepY,
      });
      return;
    }

    const nestedPosition = getNestedLoopNodePosition(
      instructionIndex,
      motif,
      layout,
      sections,
    );
    corePositionByStartIndex.set(displayNode.startIndex, {
      x: nestedPosition.x,
      y: nestedPosition.y + coreOffsetY,
    });
  });

  const entrySourceDisplayNode = Number.isInteger(continuationEntrySourceIndex)
    ? getDisplayNodeForInstructionIndex(displayNodes, continuationEntrySourceIndex)
    : null;
  const entrySourcePosition = entrySourceDisplayNode
    ? corePositionByStartIndex.get(entrySourceDisplayNode.startIndex)
    : null;
  const coreRightBound = Math.max(
    ...coreDisplayNodes.map((displayNode) => {
      const position = corePositionByStartIndex.get(displayNode.startIndex) ?? { x: 0, y: 0 };
      const renderNodeKind = displayNode.nodeType;
      const nodeSize = getNodeSize({ kind: renderNodeKind }, layout);
      return position.x + nodeSize.width / 2;
    }),
  );
  const continuationColumnX = Math.max(
    layout.nestedLoopContinuationColumnOffset * 2,
    coreRightBound + layout.localBranchTargetOffset,
  );
  const continuationBaseY = entrySourcePosition
    ? entrySourcePosition.y + layout.nestedLoopForkStepY + layout.verticalGap
    : fallbackContinuationBaseY;

  const renderNodes = displayNodes.map((displayNode) => {
    const instructionIndex = displayNode.startIndex;

    if (displayNode.endIndex < embeddedRegionLayout.coreLoop.startIndex) {
      const setupOrder = setupOrderByStartIndex.get(displayNode.startIndex) ?? 0;

      return createInstructionRenderNode(displayNode, {
        x: 0,
        y: (setupOrder + 1) * setupStepY,
        region: "embeddedNestedLoopSetup",
      });
    }

    if (instructionIndex <= embeddedRegionLayout.coreLoop.endIndex) {
      const nestedPosition = corePositionByStartIndex.get(displayNode.startIndex) ?? {
        x: 0,
        y: (instructionIndex + 1) * setupStepY,
      };

      return createInstructionRenderNode(displayNode, {
        x: nestedPosition.x,
        y: nestedPosition.y,
        region: getNestedLoopNodeRegion(instructionIndex, motif),
      });
    }

    const continuationOrder = continuationOrderByStartIndex.get(displayNode.startIndex) ?? 0;
    const terminalTailOffset = Number.isInteger(terminalActionIndex) &&
      displayNode.startIndex >= terminalActionIndex
      ? terminalTailExtraGap
      : 0;

    return createInstructionRenderNode(displayNode, {
      x: continuationColumnX,
      y: continuationBaseY + continuationOrder * setupStepY + terminalTailOffset,
      region: "embeddedNestedLoopContinuation",
    });
  });

  const firstInstructionNode = renderNodes[0];
  const startNode = {
    id: "start",
    kind: "start",
    label: "START",
    x: firstInstructionNode?.x ?? 0,
    y: (firstInstructionNode?.y ?? setupStepY) - setupStepY,
  };

  return [startNode, ...renderNodes];
}

function buildEmbeddedNestedLoopEdges(analysis, motif, embeddedRegionLayout = null) {
  return analysis.edges.map((edge) => {
    if (
      embeddedRegionLayout &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      embeddedRegionLayout.coreLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= embeddedRegionLayout.coreLoop.endIndex &&
      edge.targetIndex >= embeddedRegionLayout.continuationRegion.startIndex
    ) {
      return {
        ...edge,
        routeKind: "embeddedNestedLoopContinuationEntry",
      };
    }

    if (edge.id === motif.innerLoop.edgeId) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerReturn",
      };
    }

    if (edge.id === motif.outerLoop.edgeId) {
      return {
        ...edge,
        routeKind: "nestedLoopOuterReturn",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      edge.sourceIndex === motif.outerLoop.headerIndex &&
      edge.targetIndex === motif.outerLoop.headerIndex + 1
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopOuterContinue",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      edge.sourceIndex === motif.innerLoop.startIndex - 1 &&
      edge.targetIndex === motif.innerLoop.startIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopEnterInner",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      motif.innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex < motif.innerLoop.endIndex &&
      edge.targetIndex === edge.sourceIndex + 1
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerContinue",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.sourceIndex < motif.innerLoop.startIndex &&
      edge.targetIndex > motif.innerLoop.endIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopSkipInner",
      };
    }

    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      motif.innerLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= motif.innerLoop.endIndex &&
      edge.targetIndex > motif.innerLoop.endIndex
    ) {
      return {
        ...edge,
        routeKind: "nestedLoopInnerExit",
      };
    }

    return edge;
  });
}

function buildGenericEmbeddedNestedLoopBlockEdges(analysis, blocks) {
  return analysis.edges.map((edge) => {
    for (const block of blocks) {
      const islandMotif = buildNestedLoopIslandMotifFromBlock(block);

      if (edge.id === block.localReturnEdgeId) {
        return {
          ...edge,
          routeKind: "nestedLoopInnerReturn",
        };
      }

      if (edge.id === block.outerReturnEdgeId) {
        return {
          ...edge,
          routeKind: "nestedLoopOuterReturn",
        };
      }

      if (
        Number.isInteger(edge.sourceIndex) &&
        edge.sourceIndex === islandMotif.outerLoop.headerIndex &&
        edge.targetIndex === islandMotif.outerLoop.headerIndex + 1
      ) {
        return {
          ...edge,
          routeKind: "nestedLoopOuterContinue",
        };
      }

      if (
        Number.isInteger(edge.sourceIndex) &&
        edge.sourceIndex === islandMotif.innerLoop.startIndex - 1 &&
        edge.targetIndex === islandMotif.innerLoop.startIndex
      ) {
        return {
          ...edge,
          routeKind: "nestedLoopEnterInner",
        };
      }

      if (
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        islandMotif.innerLoop.startIndex <= edge.sourceIndex &&
        edge.sourceIndex < islandMotif.innerLoop.endIndex &&
        edge.targetIndex === edge.sourceIndex + 1
      ) {
        return {
          ...edge,
          routeKind: "nestedLoopInnerContinue",
        };
      }

      if (
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        edge.sourceIndex < islandMotif.innerLoop.startIndex &&
        edge.targetIndex > islandMotif.innerLoop.endIndex &&
        edge.targetIndex <= islandMotif.outerLoop.endIndex
      ) {
        return {
          ...edge,
          routeKind: "nestedLoopSkipInner",
        };
      }

      if (
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        islandMotif.innerLoop.startIndex <= edge.sourceIndex &&
        edge.sourceIndex <= islandMotif.innerLoop.endIndex &&
        edge.targetIndex > islandMotif.innerLoop.endIndex &&
        edge.targetIndex <= islandMotif.outerLoop.endIndex
      ) {
        return {
          ...edge,
          routeKind: "nestedLoopInnerExit",
        };
      }

      if (
        block.continuationRegion &&
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        block.coreLoop.startIndex <= edge.sourceIndex &&
        edge.sourceIndex <= block.coreLoop.endIndex &&
        block.continuationRegion.startIndex <= edge.targetIndex &&
        edge.targetIndex <= block.continuationRegion.endIndex
      ) {
        return {
          ...edge,
          routeKind: "embeddedNestedLoopContinuationEntry",
        };
      }
    }

    return edge;
  });
}

function buildGenericEmbeddedNestedLoopBlockInstructionNodes(
  program,
  analysis,
  blocks,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const sideColumnStep = Math.max(layout.localBranchTargetOffset * 0.65, 72);
  const sideRegionVerticalGap = Math.round(stepY * 0.35);
  const baselineNodes = buildInstructionNodes(program, analysis, layout, { collapseSetupBlocks });
  const startNode = baselineNodes.find((node) => node.id === "start") ?? {
    id: "start",
    kind: "start",
    label: "START",
    x: 0,
    y: 0,
  };
  const instructionNodes = baselineNodes
    .filter((node) => node.id.startsWith("i-"))
    .map((node) => ({ ...node }));
  const nodeByStartIndex = new Map(
    instructionNodes
      .filter((node) => Number.isInteger(node?.displayNode?.startIndex))
      .map((node) => [node.displayNode.startIndex, node]),
  );
  const pendingAttachedSideRegions = [];

  blocks.forEach((block) => {
    const islandMotif = buildNestedLoopIslandMotifFromBlock(block);
    const sections = buildNestedLoopLayoutSections(islandMotif);
    const headerNode = nodeByStartIndex.get(islandMotif.outerLoop.headerIndex);

    if (!headerNode) return;

    const rawHeaderPosition = getNestedLoopNodePosition(
      islandMotif.outerLoop.headerIndex,
      islandMotif,
      layout,
      sections,
    );
    const offsetX = headerNode.x - rawHeaderPosition.x;
    const offsetY = headerNode.y - rawHeaderPosition.y;

    instructionNodes.forEach((node) => {
      const index = node.displayNode?.startIndex;
      if (!Number.isInteger(index)) return;
      if (index < block.coreLoop.startIndex || index > block.coreLoop.endIndex) return;

      const rawPosition = getNestedLoopNodePosition(index, islandMotif, layout, sections);
      node.x = rawPosition.x + offsetX;
      node.y = rawPosition.y + offsetY;
      node.region = getNestedLoopNodeRegion(index, islandMotif);
    });

    if (!block.continuationRegion) return;

    const continuationNodes = instructionNodes
      .filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          block.continuationRegion.startIndex <= index &&
          index <= block.continuationRegion.endIndex;
      })
      .sort((left, right) => left.displayNode.startIndex - right.displayNode.startIndex);

    if (continuationNodes.length === 0) return;

    const entryEdge = analysis.edges.find((edge) => (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      block.coreLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= block.coreLoop.endIndex &&
      block.continuationRegion.startIndex <= edge.targetIndex &&
      edge.targetIndex <= block.continuationRegion.endIndex
    )) ?? null;
    const entrySourceNode = Number.isInteger(entryEdge?.sourceIndex)
      ? nodeByStartIndex.get(entryEdge.sourceIndex)
      : null;

    const coreBounds = instructionNodes
      .filter((node) => {
        const index = node.displayNode?.startIndex;
        return Number.isInteger(index) &&
          block.coreLoop.startIndex <= index &&
          index <= block.coreLoop.endIndex;
      })
      .map((node) => getNodeBounds(node, layout));
    const coreLeftBound = coreBounds.length > 0
      ? Math.min(...coreBounds.map((bounds) => bounds.left))
      : 0;
    const coreRightBound = coreBounds.length > 0
      ? Math.max(...coreBounds.map((bounds) => bounds.right))
      : 0;
    const defaultSide = entryEdge?.branch === "no" ? "left" : "right";
    const continuationColumnX = defaultSide === "right"
      ? Math.max(
        layout.nestedLoopContinuationColumnOffset * 2,
        coreRightBound + layout.localBranchTargetOffset,
        coreRightBound + layout.sideRouteGap * 2,
      )
      : Math.min(
        layout.nestedLoopInnerDeepColumnOffset * 1.5,
        coreLeftBound - layout.localBranchTargetOffset,
        coreLeftBound - layout.sideRouteGap * 2,
      );
    const continuationBaseY = entrySourceNode
      ? entrySourceNode.y + layout.nestedLoopForkStepY + layout.verticalGap
      : continuationNodes[0].y;
    const continuationTopY = continuationBaseY;
    const continuationBottomY = continuationBaseY + (continuationNodes.length - 1) * stepY;

    continuationNodes.forEach((node, index) => {
      node.x = continuationColumnX;
      node.y = continuationBaseY + index * stepY;
      node.region = "embeddedNestedLoopAttachedSide";
    });

    pendingAttachedSideRegions.push({
      ownerStartIndex: block.coreLoop.startIndex,
      ownerEndIndex: block.coreLoop.endIndex,
      startIndex: block.continuationRegion.startIndex,
      endIndex: block.continuationRegion.endIndex,
      side: defaultSide,
      baseX: continuationColumnX,
      topY: continuationTopY,
      bottomY: continuationBottomY,
      nodes: continuationNodes,
    });
  });

  const regionsBySide = new Map();
  pendingAttachedSideRegions.forEach((region) => {
    if (!regionsBySide.has(region.side)) {
      regionsBySide.set(region.side, []);
    }
    regionsBySide.get(region.side).push(region);
  });

  const attachedSideRegions = [];
  regionsBySide.forEach((sideRegions, side) => {
    const sortedRegions = [...sideRegions].sort((left, right) => left.topY - right.topY);
    const columns = [];

    sortedRegions.forEach((region) => {
      let assignedColumn = null;

      for (const column of columns) {
        const noVerticalOverlap = region.topY > column.lastBottomY + sideRegionVerticalGap;
        const respectsBaseX = side === "right"
          ? column.x >= region.baseX
          : column.x <= region.baseX;

        if (noVerticalOverlap && respectsBaseX) {
          assignedColumn = column;
          break;
        }
      }

      if (!assignedColumn) {
        const existingColumnEdge = columns.length > 0
          ? (side === "right"
            ? Math.max(...columns.map((column) => column.x))
            : Math.min(...columns.map((column) => column.x)))
          : region.baseX;
        const nextX = columns.length === 0
          ? region.baseX
          : side === "right"
            ? Math.max(region.baseX, existingColumnEdge + sideColumnStep)
            : Math.min(region.baseX, existingColumnEdge - sideColumnStep);

        assignedColumn = {
          x: nextX,
          lastBottomY: -Infinity,
        };
        columns.push(assignedColumn);
      }

      region.nodes.forEach((node) => {
        node.x = assignedColumn.x;
      });
      assignedColumn.lastBottomY = region.bottomY;
      attachedSideRegions.push({
        ownerStartIndex: region.ownerStartIndex,
        ownerEndIndex: region.ownerEndIndex,
        startIndex: region.startIndex,
        endIndex: region.endIndex,
        side,
        columnX: assignedColumn.x,
        topY: region.topY,
        bottomY: region.bottomY,
        nodes: region.nodes,
      });
    });
  });
  const packingDebug = applyGenericEmbeddedBlockPacking(
    instructionNodes,
    blocks,
    attachedSideRegions,
    layout,
  );

  return {
    nodes: [startNode, ...instructionNodes],
    attachedSideRegions,
    packingDebug,
  };
}

function buildGenericEmbeddedNestedLoopBlocksLayoutPlan(
  analysis,
  motif,
  blocks,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const {
    nodes: instructionNodes,
    attachedSideRegions,
    packingDebug,
  } = buildGenericEmbeddedNestedLoopBlockInstructionNodes(
    analysis.program,
    analysis,
    blocks,
    layout,
    { collapseSetupBlocks },
  );
  const protectedIntervals = buildProtectedIntervalsFromBlocks(blocks);
  const displayNodes = getDisplayNodesFromRenderNodes(instructionNodes);
  const genericRegionModel = buildGenericRegionModel(
    analysis,
    displayNodes,
    protectedIntervals,
    layout,
    { attachedSideRegions },
  );
  applyGenericRegionPlacementToNodes(instructionNodes, genericRegionModel);
  const genericControlFlowBlocksDebug = applyGenericControlFlowBlockLayout({
    analysis,
    instructionNodes,
    layout,
    genericRegionModel,
    attachedSideRegions,
  });
  const edges = buildDisplayEdges(
    buildGenericEmbeddedNestedLoopBlockEdges(analysis, blocks),
    displayNodes,
    { collapseSetupBlocks },
  );
  const nodeMapWithoutHalts = new Map(instructionNodes.map((node) => [node.id, node]));
  const lastInstruction = instructionNodes.at(-1);
  const contextualHaltNodes = edges
    .filter((edge) => edge.routeKind === "earlyExitToHalt")
    .map((edge) => {
      const source = nodeMapWithoutHalts.get(edge.from);
      const sourceBounds = source ? getNodeBounds(source, layout) : null;
      const branch = edge.branch ?? "yes";
      const direction = branch === "no" ? -1 : 1;

      return {
        id: edge.to,
        kind: "halt",
        label: "HALT",
        x: (source?.x ?? 0) + direction * layout.sideHaltDistance,
        y: sourceBounds?.centerY ?? 0,
      };
    });
  const needsBottomHalt = edges.some((edge) => edge.to === "halt");
  const bottomHaltNode = needsBottomHalt
    ? {
        id: "halt",
        kind: "halt",
        label: "HALT",
        x: 0,
        y: (lastInstruction?.y ?? 0) + layout.actionNodeHeight + layout.verticalGap,
      }
    : null;
  const nodes = bottomHaltNode
    ? [...instructionNodes, ...contextualHaltNodes, bottomHaltNode]
    : [...instructionNodes, ...contextualHaltNodes];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return {
    analysis,
    motif: {
      ...motif,
      kind: "genericEmbeddedNestedLoopBlocks",
      embeddedNestedLoopBlocks: blocks,
    },
    regionBlockPackingDebug: {
      ...packingDebug,
      fallbackStatus: genericControlFlowBlocksDebug.fallbackStatus,
      warning: genericControlFlowBlocksDebug.warning,
    },
    genericControlFlowBlocksDebug,
    genericRegionModel,
    layout,
    nodes,
    displayNodes: getDisplayNodesFromRenderNodes(nodes),
    nodeMap,
    edges,
  };
}

function detectEmbeddedTailSharedHaltPattern(edges, analysis, continuationStartIndex) {
  if (!Number.isInteger(continuationStartIndex)) return null;

  for (let index = continuationStartIndex; index < analysis.program.length - 1; index += 1) {
    if (analysis.nodeRoles[index] !== "conditionalJump") continue;

    const decisionHaltEdge = edges.find(
      (edge) =>
        edge.sourceIndex === index &&
        edge.routeKind === "earlyExitToHalt",
    );
    const decisionContinueEdge = edges.find(
      (edge) =>
        edge.sourceIndex === index &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex === index + 1,
    );

    if (!decisionHaltEdge || !decisionContinueEdge) continue;
    if (analysis.nodeRoles[index + 1] !== "action") continue;

    const terminalActionHaltEdge = edges.find(
      (edge) =>
        edge.sourceIndex === index + 1 &&
        edge.type === "fallthrough" &&
        (!Number.isInteger(edge.targetIndex) || edge.targetIndex >= analysis.program.length),
    );

    if (!terminalActionHaltEdge) continue;

    return {
      decisionIndex: index,
      terminalActionIndex: index + 1,
      decisionHaltEdgeId: decisionHaltEdge.id,
      terminalActionHaltEdgeId: terminalActionHaltEdge.id,
      sharedHaltNodeId: `embedded-tail-halt-${index}`,
    };
  }

  return null;
}

function getMinimizationNodePosition(index, layout, mainDecisionY = null) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;
  const decisionY = mainDecisionY ?? stepY * 11;
  const branchStepY = layout.nestedLoopForkStepY;
  const internalColumnX = layout.nestedLoopInnerColumnOffset;
  const internalDeepColumnX = layout.nestedLoopInnerDeepColumnOffset;
  const internalTailColumnX = layout.nestedLoopInnerDeepColumnOffset * 1.5;
  const exitColumnX = layout.nestedLoopContinuationColumnOffset;
  const finalColumnX = layout.nestedLoopContinuationColumnOffset * 2;

  if (index <= 10) {
    return {
      x: 0,
      y: index === 10 ? decisionY : (index + 1) * stepY,
    };
  }

  const positionsByIndex = {
    11: [internalColumnX, decisionY + branchStepY],
    12: [internalColumnX, decisionY + branchStepY * 2],
    13: [internalDeepColumnX, decisionY + branchStepY * 3],
    14: [internalDeepColumnX, decisionY + branchStepY * 4],
    15: [internalDeepColumnX, decisionY + branchStepY * 5],
    16: [internalTailColumnX, decisionY + branchStepY * 5],
    17: [internalTailColumnX, decisionY + branchStepY * 4],
    18: [internalColumnX, decisionY + branchStepY * 5],
    19: [internalColumnX, decisionY + branchStepY * 6],
    20: [internalColumnX, decisionY + branchStepY * 7],
    25: [finalColumnX, decisionY + branchStepY * 2],
  };

  if (21 <= index && index <= 24) {
    return placeExitColumn(index, 21, decisionY + branchStepY, branchStepY, exitColumnX);
  }

  const [x, y] = positionsByIndex[index] ?? [0, (index + 1) * stepY];

  return { x, y };
}

function getMinimizationMainDecisionY(displayNodes, layout, collapseSetupBlocks) {
  const stepY = layout.actionNodeHeight + layout.verticalGap;

  if (!collapseSetupBlocks) return stepY * 11;

  const decisionDisplayIndex = displayNodes.findIndex((displayNode) =>
    isInstructionInsideDisplayNode(displayNode, 10),
  );

  return decisionDisplayIndex >= 0 ? (decisionDisplayIndex + 1) * stepY : stepY * 11;
}

function getMinimizationDisplayNodePosition(
  displayNode,
  displayIndex,
  layout,
  { collapseSetupBlocks = false, mainDecisionY = null } = {},
) {
  if (collapseSetupBlocks && displayNode.startIndex <= 10) {
    return {
      x: 0,
      y: (displayIndex + 1) * (layout.actionNodeHeight + layout.verticalGap),
    };
  }

  return getMinimizationNodePosition(displayNode.startIndex, layout, mainDecisionY);
}

function getMinimizationNodeRegion(index) {
  if (index <= 9) return "minimizationSetupSpine";
  if (index === 10) return "minimizationMainDecision";
  if (11 <= index && index <= 20) return "minimizationInternalBranch";
  if (21 <= index && index <= 25) return "minimizationExitBranch";
  return "minimizationOther";
}

function buildMinimizationFlowInstructionNodes(
  program,
  analysis,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const displayNodes = buildDisplayNodes(program, analysis, { collapseSetupBlocks });
  const mainDecisionY = getMinimizationMainDecisionY(displayNodes, layout, collapseSetupBlocks);
  const firstInstructionPosition = getMinimizationDisplayNodePosition(displayNodes[0], 0, layout, {
    collapseSetupBlocks,
    mainDecisionY,
  });

  return [
    {
      id: "start",
      kind: "start",
      label: "START",
      x: firstInstructionPosition.x,
      y: firstInstructionPosition.y - (layout.actionNodeHeight + layout.verticalGap),
    },
    ...displayNodes.map((displayNode, displayIndex) => createInstructionRenderNode(displayNode, {
      region: getMinimizationNodeRegion(displayNode.startIndex),
      ...getMinimizationDisplayNodePosition(displayNode, displayIndex, layout, {
        collapseSetupBlocks,
        mainDecisionY,
      }),
    })),
  ];
}

function buildMinimizationFlowEdges(analysis) {
  return analysis.edges.map((edge) => {
    if (edge.id === "i-10-no") {
      return {
        ...edge,
        routeKind: "minimizationMainEnterInternal",
      };
    }

    if (edge.id === "i-10-yes") {
      return {
        ...edge,
        routeKind: "minimizationMainExit",
      };
    }

    if (edge.id === "i-12-no") {
      return {
        ...edge,
        routeKind: "minimizationPredicateEnter",
      };
    }

    if (edge.id === "i-12-yes") {
      return {
        ...edge,
        routeKind: "minimizationPredicateExit",
      };
    }

    if (edge.id === "i-15-no") {
      return {
        ...edge,
        routeKind: "minimizationPredicateContinue",
      };
    }

    if (edge.id === "i-15-yes") {
      return {
        ...edge,
        routeKind: "minimizationPredicateExit",
      };
    }

    if (edge.id === "i-17-unconditional") {
      return {
        ...edge,
        routeKind: "minimizationLocalReturn",
      };
    }

    if (edge.id === "i-20-unconditional") {
      return {
        ...edge,
        routeKind: "minimizationMainReturn",
      };
    }

    if (edge.id === "i-22-yes") {
      return {
        ...edge,
        routeKind: "minimizationFinalize",
      };
    }

    if (edge.id === "i-22-no") {
      return {
        ...edge,
        routeKind: "minimizationContinueSearch",
      };
    }

    if (edge.id === "i-24-unconditional") {
      return {
        ...edge,
        routeKind: "minimizationCandidateReturn",
      };
    }

    if (edge.id === "i-25-fallthrough") {
      return {
        ...edge,
        to: "minimization-halt",
        routeKind: "minimizationFinalHalt",
      };
    }

    return edge;
  });
}

function getNodeSize(node, layout) {
  if (node.kind === "start" || node.kind === "halt") {
    return {
      width: layout.terminalWidth,
      height: layout.terminalHeight,
    };
  }

  if (node.kind === "conditionalJump") {
    return {
      width: layout.diamondWidth,
      height: layout.diamondHeight,
    };
  }

  if (node.kind === "block") {
    return {
      width: layout.blockNodeWidth,
      height: layout.blockNodeHeight,
    };
  }

  return {
    width: node.kind === "unconditionalJump"
      ? layout.unconditionalNodeWidth
      : layout.actionNodeWidth,
    height: node.kind === "unconditionalJump"
      ? layout.unconditionalNodeHeight
      : layout.actionNodeHeight,
  };
}

function getNodeBounds(node, layout) {
  const { width, height } = getNodeSize(node, layout);

  return {
    left: node.x - width / 2,
    right: node.x + width / 2,
    top: node.y - height / 2,
    bottom: node.y + height / 2,
    centerX: node.x,
    centerY: node.y,
  };
}

function getBottomPort(bounds) {
  return [bounds.centerX, bounds.bottom];
}

function getTopPort(bounds) {
  return [bounds.centerX, bounds.top];
}

function getLeftPort(bounds) {
  return [bounds.left, bounds.centerY];
}

function getRightPort(bounds) {
  return [bounds.right, bounds.centerY];
}

function getDiamondAnchors(bounds) {
  const topAnchor = [bounds.centerX, bounds.top];
  const bottomAnchor = [bounds.centerX, bounds.bottom];
  const leftAnchor = [bounds.left, bounds.centerY];
  const rightAnchor = [bounds.right, bounds.centerY];

  return {
    topAnchor,
    bottomAnchor,
    leftAnchor,
    rightAnchor,
    lowerLeftSideCenter: interpolatePoint(leftAnchor, bottomAnchor, 0.5),
    lowerRightSideCenter: interpolatePoint(rightAnchor, bottomAnchor, 0.5),
    bottomLeftOutgoing: interpolatePoint(leftAnchor, bottomAnchor, 0.68),
    bottomRightOutgoing: interpolatePoint(rightAnchor, bottomAnchor, 0.68),
  };
}

function isTextbookLoopContinueEdge(edge, analysis) {
  return analysis.loopMotifs.some((motif) => motif.continueEdgeId === edge.id);
}

function getConditionalBranchStart(bounds, branch, routeKind, context = {}) {
  const anchors = getDiamondAnchors(bounds);

  if (context.forceVerticalContinue) {
    return anchors.bottomAnchor;
  }

  if (routeKind === "earlyExitToHalt") {
    return branch === "no" ? anchors.lowerLeftSideCenter : anchors.rightAnchor;
  }

  const targetBounds = context.targetBounds;
  const targetDx = targetBounds ? targetBounds.centerX - bounds.centerX : 0;

  if (branch === "yes") {
    if (targetDx > 18) return anchors.lowerRightSideCenter;
    if (targetDx < -18) return anchors.bottomRightOutgoing;
    return anchors.bottomRightOutgoing;
  }

  if (branch === "no") {
    if (targetDx < -18) return anchors.lowerLeftSideCenter;
    if (targetDx > 18) return anchors.bottomLeftOutgoing;
    return anchors.bottomAnchor;
  }

  return routeKind === "earlyExitToHalt" ? anchors.lowerRightSideCenter : anchors.bottomAnchor;
}

function getConditionalForkPoint(start, branch, routeKind, layout, context = {}) {
  if (routeKind === "earlyExitToHalt") {
    return [
      start[0] + layout.branchExitLength,
      start[1],
    ];
  }

  const targetBounds = context.targetBounds;
  const targetDx = targetBounds ? targetBounds.centerX - context.sourceBounds.centerX : 0;

  if (branch === "yes") {
    const direction = targetDx < -18 ? -1 : 1;

    return [
      start[0] + direction * layout.branchForkDx,
      start[1] + layout.branchForkDy,
    ];
  }

  const direction = targetDx > 18 ? 1 : -1;

  return [
    start[0] + direction * layout.branchForkDx,
    start[1] + layout.branchForkDy,
  ];
}

function routeWithoutAcuteBends(points, layout) {
  if (points.length < 3) return points;

  const [start, first, second] = points;
  const firstDx = first[0] - start[0];
  const secondDx = second[0] - first[0];

  if (firstDx !== 0 && secondDx !== 0 && Math.sign(firstDx) !== Math.sign(secondDx)) {
    const adjustedSecond = [
      first[0] + Math.sign(firstDx) * Math.max(Math.abs(secondDx), layout.minDiagonalBranchLength),
      second[1],
    ];

    return [start, first, adjustedSecond, ...points.slice(3)];
  }

  return points;
}

function interpolatePoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
  ];
}

function routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout, context = {}) {
  const start = edge.edgeRole === "conditionalNo"
    ? getConditionalBranchStart(fromBounds, "no", edge.routeKind, context)
    : getBottomPort(fromBounds);
  const end = getTopPort(toBounds);
  const labelPoint = edge.edgeRole === "conditionalNo"
    ? interpolatePoint(start, end, 0.34)
    : null;

  return {
    ...edge,
    points: [start, end],
    labelX: labelPoint?.[0],
    labelY: labelPoint?.[1],
  };
}

function routeEarlyExit(edge, fromBounds, toBounds, layout) {
  const branch = edge.branch ?? "yes";
  const start = getConditionalBranchStart(fromBounds, branch, "earlyExitToHalt", {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const fork = getConditionalForkPoint(start, branch, "earlyExitToHalt", layout, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const end = branch === "no" ? getRightPort(toBounds) : getLeftPort(toBounds);
  const labelPoint = interpolatePoint(start, fork, 0.52);

  return {
    ...edge,
    points: routeWithoutAcuteBends([start, fork, end], layout),
    labelX: labelPoint[0],
    labelY: labelPoint[1] - layout.labelOffset,
  };
}

function routeNearbyForward(edge, fromBounds, toBounds, layout) {
  const branch = edge.branch ?? "yes";
  const start = getConditionalBranchStart(fromBounds, branch, edge.routeKind, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const fork = getConditionalForkPoint(start, branch, edge.routeKind, layout, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const end = getTopPort(toBounds);
  const labelPoint = interpolatePoint(start, fork, 0.48);

  return {
    ...edge,
    points: routeWithoutAcuteBends([start, fork, end], layout),
    labelX: labelPoint[0],
    labelY: labelPoint[1] - layout.labelOffset,
  };
}

function routeFarForward(edge, fromBounds, toBounds, layout) {
  const branch = edge.branch ?? "yes";
  const direction = branch === "no" ? -1 : 1;
  const start = getConditionalBranchStart(fromBounds, branch, edge.routeKind, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const fork = getConditionalForkPoint(start, branch, edge.routeKind, layout, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const sideX = direction > 0
    ? Math.max(fromBounds.right, toBounds.right, fork[0] + layout.minDiagonalBranchLength) + layout.sideRouteGap
    : Math.min(fromBounds.left, toBounds.left, fork[0] - layout.minDiagonalBranchLength) - layout.sideRouteGap;
  const end = getTopPort(toBounds);
  const labelPoint = interpolatePoint(start, fork, 0.48);

  return {
    ...edge,
    points: routeWithoutAcuteBends([
      start,
      fork,
      [sideX, fork[1]],
      [sideX, end[1] - layout.sideRouteGap],
      end,
    ], layout),
    labelX: labelPoint[0],
    labelY: labelPoint[1] - layout.labelOffset,
  };
}

function routeLocalForwardRejoin(edge, fromBounds, toBounds, layout) {
  const branch = edge.branch ?? "yes";
  const start = getConditionalBranchStart(fromBounds, branch, edge.routeKind, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const fork = getConditionalForkPoint(start, branch, edge.routeKind, layout, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const end = getTopPort(toBounds);
  const sideX = Math.max(
    fromBounds.right,
    toBounds.right,
    fork[0] + layout.minDiagonalBranchLength,
  ) + layout.localForwardLaneDistance;
  const labelPoint = interpolatePoint(start, fork, 0.46);

  return {
    ...edge,
    points: routeWithoutAcuteBends([
      start,
      fork,
      [sideX, fork[1]],
      [sideX, end[1] - layout.sideRouteGap],
      end,
    ], layout),
    labelX: labelPoint[0],
    labelY: labelPoint[1] - layout.labelOffset,
  };
}

function routeLoopReturn(edge, fromBounds, toBounds, layout, nodeMap, loopLaneByEdgeId) {
  const loopBounds = [];

  for (let index = edge.targetIndex; index <= edge.sourceIndex; index += 1) {
    const node = nodeMap.get(`i-${index}`);
    if (node) loopBounds.push(getNodeBounds(node, layout));
  }

  const minLoopLeft = Math.min(...loopBounds.map((bounds) => bounds.left));
  const laneRank = loopLaneByEdgeId.get(edge.id) ?? 0;
  const laneX = minLoopLeft - layout.loopLaneDistance - laneRank * layout.loopLaneStep;
  const start = getLeftPort(fromBounds);
  const end = getLeftPort(toBounds);

  return {
    ...edge,
    points: [
      start,
      [laneX, start[1]],
      [laneX, end[1]],
      end,
    ],
  };
}

function routeUnconditionalForward(edge, fromBounds, toBounds, layout) {
  const start = getBottomPort(fromBounds);
  const end = getTopPort(toBounds);

  if (Math.abs(start[0] - end[0]) < 8) {
    return {
      ...edge,
      points: [start, end],
    };
  }

  const midY = start[1] + layout.branchExitLength;

  return {
    ...edge,
    points: [start, [start[0], midY], [end[0], midY], end],
  };
}

function routeContinuationElbow(edge, fromBounds, toBounds, layout) {
  const targetTop = getTopPort(toBounds);
  const sourceCenter = [fromBounds.centerX, fromBounds.centerY];
  const preferRight = targetTop[0] >= sourceCenter[0];
  const start = fromBounds.centerY > targetTop[1]
    ? (preferRight ? getRightPort(fromBounds) : getLeftPort(fromBounds))
    : (preferRight ? getRightPort(fromBounds) : getLeftPort(fromBounds));
  const bend = [targetTop[0], start[1]];
  const labelPoint = edge.branch
    ? interpolatePoint(start, bend, 0.48)
    : null;

  return {
    ...edge,
    points: buildOrthogonalRoute([start, bend, targetTop]),
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeTerminalExit(edge, fromBounds, toBounds) {
  const dx = toBounds.centerX - fromBounds.centerX;
  const dy = toBounds.centerY - fromBounds.centerY;

  if (Math.abs(dy) > Math.abs(dx)) {
    return {
      ...edge,
      points: [getBottomPort(fromBounds), getTopPort(toBounds)],
    };
  }

  if (dx >= 0) {
    return {
      ...edge,
      points: [getRightPort(fromBounds), getLeftPort(toBounds)],
    };
  }

  return {
    ...edge,
    points: [getLeftPort(fromBounds), getRightPort(toBounds)],
  };
}

function canUseContinuationFlowOverride(edge, analysis) {
  const sourceIndex = edge.sourceIndex;
  const targetIndex = edge.targetIndex;

  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) return false;
  if (targetIndex <= sourceIndex) return false;

  const nodeRoles = analysis.visualRoles?.nodeRoleByIndex ?? {};
  const sourceRole = nodeRoles[sourceIndex];
  const targetRole = nodeRoles[targetIndex];

  const sourceCompatible = sourceRole === "decisionNode" ||
    sourceRole === "continuationNode" ||
    sourceRole === "tailNode";
  const targetCompatible = targetRole === "continuationNode" ||
    targetRole === "tailNode";

  return sourceCompatible && targetCompatible;
}

function canUseTerminalExitFlowOverride(edge, toNode) {
  const isHaltNode = toNode?.kind === "halt";
  const isSyntheticTerminalTarget = typeof edge.to === "string" && edge.to.startsWith("halt");
  return isHaltNode && isSyntheticTerminalTarget;
}

function routeDefaultEdge(edge, nodeMap, layout, analysis) {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);

  if (!from || !to) return null;

  const fromBounds = getNodeBounds(from, layout);
  const toBounds = getNodeBounds(to, layout);
  const visualEdgeRole = analysis.visualRoles?.edgeRoleById?.[edge.id];
  const flowRole = visualEdgeRole?.flowRole;

  if (isTextbookLoopContinueEdge(edge, analysis)) {
    return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout, {
      forceVerticalContinue: true,
    });
  }

  if (flowRole === "continuation" && canUseContinuationFlowOverride(edge, analysis)) {
    return routeContinuationElbow(edge, fromBounds, toBounds, layout);
  }

  if (flowRole === "terminalExit" && canUseTerminalExitFlowOverride(edge, to)) {
    return routeTerminalExit(edge, fromBounds, toBounds);
  }

  if (edge.routeKind === "earlyExitToHalt") {
    return routeEarlyExit(edge, fromBounds, toBounds, layout);
  }

  if (edge.routeKind === "unconditionalLoopReturn" || edge.routeKind === "backwardLoop") {
    return routeLoopReturn(edge, fromBounds, toBounds, layout, nodeMap, analysis.loopLaneByEdgeId);
  }

  if (edge.routeKind === "localForwardRejoin") {
    return routeLocalForwardRejoin(edge, fromBounds, toBounds, layout);
  }

  if (edge.routeKind === "nearbyForwardBranch") {
    return routeNearbyForward(edge, fromBounds, toBounds, layout);
  }

  if (edge.routeKind === "farForwardBranch") {
    return routeFarForward(edge, fromBounds, toBounds, layout);
  }

  if (edge.routeKind === "unconditionalForwardJump") {
    return routeUnconditionalForward(edge, fromBounds, toBounds, layout);
  }

  return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout);
}

function buildRoutedEdges(edges, nodeMap, layout, analysis) {
  return edges.map((edge) => routeDefaultEdge(edge, nodeMap, layout, analysis)).filter(Boolean);
}

function buildPredecessorLayoutPlan(
  analysis,
  motif,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const instructionNodes = buildPredecessorInstructionNodes(analysis.program, analysis, layout, {
    collapseSetupBlocks,
  });
  const outputNode = instructionNodes.find((node) => node.id === "i-6");
  const haltNode = {
    id: "predecessor-halt",
    kind: "halt",
    label: "HALT",
    x: (outputNode?.x ?? 0) + layout.sideHaltDistance,
    y: outputNode?.y ?? 0,
  };
  const nodes = [...instructionNodes, haltNode];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const displayNodes = getDisplayNodesFromRenderNodes(nodes);
  const edges = buildDisplayEdges(buildPredecessorEdges(analysis), displayNodes, {
    collapseSetupBlocks,
  });

  return {
    analysis,
    motif,
    layout,
    nodes,
    displayNodes,
    nodeMap,
    edges,
  };
}

function getDisplayNodesFromRenderNodes(nodes) {
  return nodes
    .map((node) => node.displayNode)
    .filter(Boolean);
}

function buildSingleLoopLayoutPlan(
  analysis,
  motif,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const instructionNodes = buildSingleLoopInstructionNodes(analysis.program, analysis, motif, layout, {
    collapseSetupBlocks,
  });
  const testNode = instructionNodes.find((node) => node.id === `i-${motif.primaryLoop.testIndex}`);
  const lastInstruction = instructionNodes.at(-1);
  const instructionDisplayNodes = getDisplayNodesFromRenderNodes(instructionNodes);
  const edges = buildDisplayEdges(buildSingleLoopEdges(analysis, motif), instructionDisplayNodes, {
    collapseSetupBlocks,
  });
  const haltNode = motif.primaryLoop.exitsToHalt
    ? {
        id: "single-loop-halt",
        kind: "halt",
        label: "HALT",
        x: (testNode?.x ?? 0) + layout.sideHaltDistance,
        y: testNode?.y ?? 0,
      }
    : null;
  const bottomHaltNode = edges.some((edge) => edge.to === "halt")
    ? {
        id: "halt",
        kind: "halt",
        label: "HALT",
        x: 0,
        y: (lastInstruction?.y ?? 0) + layout.actionNodeHeight + layout.verticalGap,
      }
    : null;
  const nodes = [
    ...instructionNodes,
    ...(haltNode ? [haltNode] : []),
    ...(bottomHaltNode ? [bottomHaltNode] : []),
  ];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const displayNodes = getDisplayNodesFromRenderNodes(nodes);

  return {
    analysis,
    motif,
    layout,
    nodes,
    displayNodes,
    nodeMap,
    edges,
  };
}

function buildNestedLoopLayoutPlan(analysis, motif, layout) {
  const instructionNodes = buildNestedLoopInstructionNodes(analysis.program, analysis, motif, layout);
  const outerHeaderNode = instructionNodes.find((node) => node.id === `i-${motif.outerLoop.headerIndex}`);
  const haltNode = {
    id: "nested-loop-halt",
    kind: "halt",
    label: "HALT",
    x: (outerHeaderNode?.x ?? 0) + layout.sideHaltDistance,
    y: outerHeaderNode?.y ?? 0,
  };
  const nodes = [...instructionNodes, haltNode];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return {
    analysis,
    motif,
    layout,
    nodes,
    displayNodes: getDisplayNodesFromRenderNodes(nodes),
    nodeMap,
    edges: buildNestedLoopEdges(analysis, motif),
  };
}

function buildEmbeddedNestedLoopLayoutPlan(
  analysis,
  motif,
  embeddedRegionLayout,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const instructionNodes = buildEmbeddedNestedLoopInstructionNodes(
    analysis.program,
    analysis,
    motif,
    embeddedRegionLayout,
    layout,
    { collapseSetupBlocks },
  );
  const displayNodes = getDisplayNodesFromRenderNodes(instructionNodes);
  const continuationStartIndex = embeddedRegionLayout.continuationRegion?.startIndex ?? null;
  const sharedTailHaltPattern = detectEmbeddedTailSharedHaltPattern(
    analysis.edges,
    analysis,
    continuationStartIndex,
  );
  const baseEdges = buildEmbeddedNestedLoopEdges(analysis, motif, embeddedRegionLayout);
  const embeddedEdges = sharedTailHaltPattern
    ? baseEdges.map((edge) => {
        if (edge.id === sharedTailHaltPattern.decisionHaltEdgeId) {
          return {
            ...edge,
            to: sharedTailHaltPattern.sharedHaltNodeId,
            routeKind: "embeddedTailSharedHaltDecision",
          };
        }

        if (edge.id === sharedTailHaltPattern.terminalActionHaltEdgeId) {
          return {
            ...edge,
            to: sharedTailHaltPattern.sharedHaltNodeId,
            routeKind: "embeddedTailSharedHaltFinal",
          };
        }

        return edge;
      })
    : baseEdges;
  const edges = buildDisplayEdges(embeddedEdges, displayNodes, {
    collapseSetupBlocks,
  });
  const nodeMapWithoutHalts = new Map(instructionNodes.map((node) => [node.id, node]));
  const haltEdgeRouteKinds = new Set([
    "earlyExitToHalt",
    "embeddedTailSharedHaltDecision",
    "embeddedTailSharedHaltFinal",
  ]);
  const contextualHaltNodes = Array.from(new Map(
    edges
      .filter((edge) => haltEdgeRouteKinds.has(edge.routeKind))
      .map((edge) => {
      const source = nodeMapWithoutHalts.get(edge.from);
      const sourceBounds = source ? getNodeBounds(source, layout) : null;
      const branch = edge.branch ?? "yes";
      const direction = branch === "no" ? -1 : 1;

        return [
          edge.to,
          {
            id: edge.to,
            kind: "halt",
            label: "HALT",
            x: (source?.x ?? 0) + direction * layout.sideHaltDistance,
            y: sourceBounds?.centerY ?? 0,
          },
        ];
      }),
  ).values());
  const needsBottomHalt = edges.some((edge) => edge.to === "halt");
  const bottomReferenceNode = instructionNodes.at(-1);
  const bottomHaltNode = needsBottomHalt
    ? {
        id: "halt",
        kind: "halt",
        label: "HALT",
        x: bottomReferenceNode?.x ?? 0,
        y: (bottomReferenceNode?.y ?? 0) + layout.actionNodeHeight + layout.verticalGap,
      }
    : null;
  const nodes = [
    ...instructionNodes,
    ...contextualHaltNodes,
    ...(bottomHaltNode ? [bottomHaltNode] : []),
  ];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return {
    analysis,
    motif: {
      ...motif,
      kind: "embeddedNestedLoop",
      embeddedRegionLayout,
    },
    layout,
    nodes,
    displayNodes: getDisplayNodesFromRenderNodes(nodes),
    nodeMap,
    edges,
  };
}

function buildMinimizationFlowLayoutPlan(
  analysis,
  motif,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const instructionNodes = buildMinimizationFlowInstructionNodes(analysis.program, analysis, layout, {
    collapseSetupBlocks,
  });
  const finalNode = instructionNodes.find((node) => node.id === "i-25");
  const haltNode = {
    id: "minimization-halt",
    kind: "halt",
    label: "HALT",
    x: (finalNode?.x ?? 0) + layout.sideHaltDistance,
    y: finalNode?.y ?? 0,
  };
  const nodes = [...instructionNodes, haltNode];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const displayNodes = getDisplayNodesFromRenderNodes(nodes);
  const edges = buildDisplayEdges(buildMinimizationFlowEdges(analysis), displayNodes, {
    collapseSetupBlocks,
  });

  return {
    analysis,
    motif,
    layout,
    nodes,
    displayNodes,
    nodeMap,
    edges,
  };
}

function buildGenericInstructionFallbackLayoutPlan(
  analysis,
  motif,
  layout,
  { collapseSetupBlocks = false } = {},
) {
  const instructionNodes = buildInstructionNodes(analysis.program, analysis, layout, {
    collapseSetupBlocks,
  });
  const prePlacementBounds = computeInstructionBounds(instructionNodes, layout);
  const displayNodes = getDisplayNodesFromRenderNodes(instructionNodes);
  const genericRegionModel = buildGenericRegionModel(analysis, displayNodes, [], layout);
  applyGenericRegionPlacementToNodes(instructionNodes, genericRegionModel);
  const genericControlFlowBlocksDebug = applyGenericControlFlowBlockLayout({
    analysis,
    instructionNodes,
    layout,
    genericRegionModel,
    attachedSideRegions: [],
  });
  const postPlacementBounds = computeInstructionBounds(instructionNodes, layout);
  const remappedDisplayNodes = getDisplayNodesFromRenderNodes(instructionNodes);
  const displayEdges = collapseSetupBlocks
    ? remapEdgesToDisplayNodes(analysis.edges, remappedDisplayNodes)
    : analysis.edges;
  const nodeMapWithoutHalts = new Map(instructionNodes.map((node) => [node.id, node]));
  const lastInstruction = instructionNodes.at(-1);
  const contextualHaltNodes = analysis.edges
    .filter((edge) => edge.routeKind === "earlyExitToHalt")
    .map((edge) => {
      const source = nodeMapWithoutHalts.get(edge.from);
      const sourceBounds = source ? getNodeBounds(source, layout) : null;
      const branch = edge.branch ?? "yes";
      const direction = branch === "no" ? -1 : 1;

      return {
        id: edge.to,
        kind: "halt",
        label: "HALT",
        x: (source?.x ?? 0) + direction * layout.sideHaltDistance,
        y: sourceBounds?.centerY ?? 0,
      };
    });
  const needsBottomHalt = analysis.edges.some((edge) => edge.to === "halt");
  const bottomHaltNode = needsBottomHalt
    ? {
        id: "halt",
        kind: "halt",
        label: "HALT",
        x: 0,
        y: (lastInstruction?.y ?? 0) + layout.actionNodeHeight + layout.verticalGap,
      }
    : null;
  const nodes = bottomHaltNode
    ? [...instructionNodes, ...contextualHaltNodes, bottomHaltNode]
    : [...instructionNodes, ...contextualHaltNodes];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const regionBlocks = genericRegionModel.genericRegions.map((region) => {
    const regionNodes = instructionNodes.filter((node) => {
      const index = node.displayNode?.startIndex;
      return Number.isInteger(index) &&
        region.startIndex <= index &&
        index <= region.endIndex;
    });
    const bounds = getRegionNodeBounds(regionNodes, layout);
    const regionHasSidePlacement = regionNodes.some((node) => Math.abs(node.x) > 1);

    return {
      kind: "genericRegion",
      interval: `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
      x: Number(((bounds?.left ?? 0) + (bounds?.right ?? 0)) / 2),
      y: Number(((bounds?.top ?? 0) + (bounds?.bottom ?? 0)) / 2),
      width: Number((bounds?.right ?? 0) - (bounds?.left ?? 0)),
      height: Number((bounds?.bottom ?? 0) - (bounds?.top ?? 0)),
      placement: regionHasSidePlacement ? "mixedHorizontal" : "vertical",
      reason: regionHasSidePlacement
        ? "containsBranchOrSkipSidePlacement"
        : "straightFallthroughSpine",
    };
  });

  return {
    analysis,
    motif,
    regionBlockPackingDebug: {
      beforeBounds: prePlacementBounds,
      afterBounds: postPlacementBounds,
      heightReduction: Number((prePlacementBounds.height - postPlacementBounds.height).toFixed(2)),
      widthIncrease: Number((postPlacementBounds.width - prePlacementBounds.width).toFixed(2)),
      regionBlocks,
      fallbackStatus: genericControlFlowBlocksDebug.fallbackStatus,
      warning: genericControlFlowBlocksDebug.warning,
    },
    genericControlFlowBlocksDebug,
    genericRegionModel,
    layout,
    nodes,
    displayNodes: getDisplayNodesFromRenderNodes(nodes),
    nodeMap,
    edges: displayEdges,
  };
}

function buildLayoutPlan(analysis, motif, layout = TEXTBOOK_LAYOUT, { collapseSetupBlocks = false } = {}) {
  if (motif.kind === "predecessorLoop") {
    return buildPredecessorLayoutPlan(analysis, motif, layout, { collapseSetupBlocks });
  }

  if (motif.kind === "minimizationFlow") {
    return buildMinimizationFlowLayoutPlan(analysis, motif, layout, { collapseSetupBlocks });
  }

  if (motif.kind === "singleLoop") {
    return buildSingleLoopLayoutPlan(analysis, motif, layout, { collapseSetupBlocks });
  }

  if (motif.kind === "nestedLoop") {
    const embeddedRegionLayout = detectEmbeddedNestedLoopRegionLayout(analysis, motif);

    if (embeddedRegionLayout) {
      return buildEmbeddedNestedLoopLayoutPlan(analysis, motif, embeddedRegionLayout, layout, {
        collapseSetupBlocks,
      });
    }

    return buildNestedLoopLayoutPlan(analysis, motif, layout);
  }

  if (motif.kind === "genericInstructionFallback") {
    const embeddedBlocks = detectEmbeddedNestedLoopBlocksForGenericFallback(analysis, motif);

    if (embeddedBlocks && embeddedBlocks.length >= 1) {
      return buildGenericEmbeddedNestedLoopBlocksLayoutPlan(
        analysis,
        motif,
        embeddedBlocks,
        layout,
        { collapseSetupBlocks },
      );
    }

    return buildGenericInstructionFallbackLayoutPlan(
      analysis,
      motif,
      layout,
      { collapseSetupBlocks },
    );
  }

  return buildGenericInstructionFallbackLayoutPlan(
    analysis,
    motif,
    layout,
    { collapseSetupBlocks },
  );
}

function applyGeneratedLocalSideChainPlacement(layoutPlan) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGenerated",
      detectedTriples: [],
      appliedCount: 0,
      fakeThirdExitBeforeCount: 0,
      fakeThirdExitAfterCount: 0,
    };
  }

  if (!layoutPlan.genericRegionModel) {
    return {
      enabled: false,
      skippedReason: "genericRegionModelMissing",
      detectedTriples: [],
      appliedCount: 0,
      fakeThirdExitBeforeCount: 0,
      fakeThirdExitAfterCount: 0,
    };
  }

  const analysis = layoutPlan.analysis;
  const programLength = analysis.program.length;
  const instructionNodeLookup = getInstructionNodeLookup(layoutPlan);
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const stepY = layoutPlan.layout.actionNodeHeight + layoutPlan.layout.verticalGap;
  const moderateReadableGapCap = stepY + Math.round(layoutPlan.layout.verticalGap * 0.35);
  const centerThreshold = 8;
  const sideThreshold = Math.max(layoutPlan.layout.sideRouteGap * 2, 24);
  const defaultOverlapShiftSteps = 3;

  const edgesBySourceTarget = new Map();
  const incomingByTarget = new Map();
  const layoutEdgeById = new Map((layoutPlan.edges ?? []).map((edge) => [edge.id, edge]));
  analysis.edges.forEach((edge) => {
    if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return;
    const key = `${edge.sourceIndex}->${edge.targetIndex}`;
    if (!edgesBySourceTarget.has(key)) {
      edgesBySourceTarget.set(key, []);
    }
    edgesBySourceTarget.get(key).push(edge);
    if (!incomingByTarget.has(edge.targetIndex)) {
      incomingByTarget.set(edge.targetIndex, []);
    }
    incomingByTarget.get(edge.targetIndex).push(edge);
  });

  const detectedTriples = [];
  let fakeThirdExitBeforeCount = 0;
  let fakeThirdExitAfterCount = 0;
  let appliedCount = 0;

  const hasOverlapAt = (targetNode, x, y, ignoredNodeIds = new Set()) => {
    const movedBounds = getNodeBounds(
      { ...targetNode, x, y },
      layoutPlan.layout,
    );
    return instructionNodes.some((candidate) => {
      if (candidate.id === targetNode.id) return false;
      if (ignoredNodeIds.has(candidate.id)) return false;
      const candidateBounds = getNodeBounds(candidate, layoutPlan.layout);
      return boundsOverlap(movedBounds, candidateBounds, 0.5);
    });
  };

  const buildLocalFindingSummary = (
    decisionNode,
    sideNode,
    continuationNode,
    semanticDecisionToContinuationExists,
    minReadableDToAGap,
  ) => {
    if (!decisionNode || !sideNode || !continuationNode) {
      return {
        count: 0,
        kinds: [],
      };
    }
    const sideOffset = Math.abs(sideNode.x - decisionNode.x);
    const sidePlaced = sideOffset >= sideThreshold;
    const continuationCentered = Math.abs(continuationNode.x - decisionNode.x) <= centerThreshold;
    const dToAGap = sideNode.y - decisionNode.y;
    const kinds = [];
    if (!semanticDecisionToContinuationExists && sidePlaced && continuationCentered) {
      kinds.push("fakeThirdExit");
    }
    if (dToAGap < minReadableDToAGap) {
      kinds.push("sideChainAAlmostLevelWithD");
    }
    if (sidePlaced && dToAGap <= layoutPlan.layout.verticalGap * 1.3) {
      kinds.push("sideChainReadsAsHorizontalAnnotation");
    }
    return {
      count: kinds.length,
      kinds,
    };
  };

  for (let decisionIndex = 0; decisionIndex < programLength - 2; decisionIndex += 1) {
    if (analysis.nodeRoles[decisionIndex] !== "conditionalJump") continue;

    const sideIndex = decisionIndex + 1;
    const continuationIndex = decisionIndex + 2;
    const edgesDA = edgesBySourceTarget.get(`${decisionIndex}->${sideIndex}`) ?? [];
    const edgesAB = edgesBySourceTarget.get(`${sideIndex}->${continuationIndex}`) ?? [];
    const edgesDB = edgesBySourceTarget.get(`${decisionIndex}->${continuationIndex}`) ?? [];

    if (edgesDA.length === 0 || edgesAB.length === 0) continue;

    const decisionNode = instructionNodeLookup.get(decisionIndex) ?? null;
    const sideNode = instructionNodeLookup.get(sideIndex) ?? null;
    const continuationNode = instructionNodeLookup.get(continuationIndex) ?? null;
    const containingLoops = (analysis.loopIntervals ?? [])
      .filter((interval) => interval.startIndex <= decisionIndex && decisionIndex <= interval.endIndex)
      .sort((left, right) => left.length - right.length);
    const smallestContainingLoop = containingLoops[0] ?? null;
    const incomingToB = incomingByTarget.get(continuationIndex) ?? [];
    const incomingFromNonSide = incomingToB.filter((edge) => edge.sourceIndex !== sideIndex);

    const record = {
      decisionIndex,
      sideIndex,
      continuationIndex,
      edgeIds: {
        decisionToSide: edgesDA[0]?.id ?? null,
        sideToContinuation: edgesAB[0]?.id ?? null,
        decisionToContinuation: edgesDB[0]?.id ?? null,
      },
      semanticDecisionToContinuationExists: edgesDB.length > 0,
      oldCoordinates: {
        side: sideNode ? { x: sideNode.x, y: sideNode.y } : null,
        continuation: continuationNode ? { x: continuationNode.x, y: continuationNode.y } : null,
      },
      newCoordinates: {
        side: sideNode ? { x: sideNode.x, y: sideNode.y } : null,
        continuation: continuationNode ? { x: continuationNode.x, y: continuationNode.y } : null,
      },
      fakeThirdExitBefore: false,
      fakeThirdExitAfter: false,
      dToAVerticalGapBefore: null,
      dToAVerticalGapAfter: null,
      minReadableDToAGap: null,
      sideChainAAlmostLevelWithDBefore: false,
      sideChainAAlmostLevelWithDAfter: false,
      sideChainReadsAsHorizontalAnnotationBefore: false,
      sideChainReadsAsHorizontalAnnotationAfter: false,
      requestedDToAGap: null,
      cappedDToAGap: null,
      finalDToAGap: null,
      moderateGapCap: moderateReadableGapCap,
      capApplied: false,
      capReason: null,
      isNestedOrDeep: false,
      containingLoopDepth: smallestContainingLoop?.depth ?? null,
      containingLoopId: smallestContainingLoop?.id ?? null,
      overlapAvoidanceShifted: false,
      overlapShiftStepCount: 0,
      applied: false,
      reason: "notApplicable",
      incomingToContinuationCount: incomingToB.length,
      incomingFromNonSideCount: incomingFromNonSide.length,
      localFindingsBefore: null,
      localFindingsAfter: null,
    };

    if (!decisionNode || !sideNode || !continuationNode) {
      record.reason = "missingInstructionRenderNodes";
      detectedTriples.push(record);
      continue;
    }

    const decisionBounds = getNodeBounds(decisionNode, layoutPlan.layout);
    const sideBounds = getNodeBounds(sideNode, layoutPlan.layout);
    const decisionHeight = Math.max(0, decisionBounds.bottom - decisionBounds.top);
    const sideHeight = Math.max(0, sideBounds.bottom - sideBounds.top);
    const minReadableDToAGap = Math.round(
      decisionHeight / 2 +
      layoutPlan.layout.verticalGap +
      sideHeight / 2,
    );
    record.minReadableDToAGap = minReadableDToAGap;
    const sideOffsetBefore = Math.abs(sideNode.x - decisionNode.x);
    const dToAVerticalGapBefore = sideNode.y - decisionNode.y;
    record.dToAVerticalGapBefore = Number(dToAVerticalGapBefore.toFixed(2));
    const containingLoopDepth = Number.isInteger(smallestContainingLoop?.depth)
      ? smallestContainingLoop.depth
      : 0;
    const isNestedOrDeep = containingLoopDepth >= 2 || containingLoops.length >= 2;
    record.isNestedOrDeep = isNestedOrDeep;
    const continuationCenteredBefore = Math.abs(continuationNode.x - decisionNode.x) <= centerThreshold;
    const sidePlacedBefore = sideOffsetBefore >= sideThreshold;
    const sideChainAAlmostLevelWithDBefore = dToAVerticalGapBefore < minReadableDToAGap;
    record.sideChainAAlmostLevelWithDBefore = sideChainAAlmostLevelWithDBefore;
    record.sideChainReadsAsHorizontalAnnotationBefore = sidePlacedBefore && sideChainAAlmostLevelWithDBefore;
    const localFindingsBefore = buildLocalFindingSummary(
      decisionNode,
      sideNode,
      continuationNode,
      record.semanticDecisionToContinuationExists,
      minReadableDToAGap,
    );
    record.localFindingsBefore = localFindingsBefore;
    const fakeThirdExitBefore = (
      !record.semanticDecisionToContinuationExists &&
      sidePlacedBefore &&
      continuationCenteredBefore
    );
    record.fakeThirdExitBefore = fakeThirdExitBefore;
    if (fakeThirdExitBefore) {
      fakeThirdExitBeforeCount += 1;
    }

    if (record.semanticDecisionToContinuationExists) {
      record.reason = "semanticDecisionToContinuationExists";
      record.fakeThirdExitAfter = fakeThirdExitBefore;
      if (record.fakeThirdExitAfter) {
        fakeThirdExitAfterCount += 1;
      }
      detectedTriples.push(record);
      continue;
    }

    if (incomingFromNonSide.length > 0) {
      record.reason = "continuationHasAdditionalIncomingEdges";
      record.fakeThirdExitAfter = fakeThirdExitBefore;
      if (record.fakeThirdExitAfter) {
        fakeThirdExitAfterCount += 1;
      }
      detectedTriples.push(record);
      continue;
    }

    if (!sidePlacedBefore) {
      record.reason = "notSidePlacedRelativeToDecision";
      record.fakeThirdExitAfter = fakeThirdExitBefore;
      const dToAVerticalGapAfter = sideNode.y - decisionNode.y;
      record.dToAVerticalGapAfter = Number(dToAVerticalGapAfter.toFixed(2));
      record.finalDToAGap = record.dToAVerticalGapAfter;
      record.sideChainAAlmostLevelWithDAfter = dToAVerticalGapAfter < minReadableDToAGap;
      record.sideChainReadsAsHorizontalAnnotationAfter = sidePlacedBefore && record.sideChainAAlmostLevelWithDAfter;
      record.localFindingsAfter = localFindingsBefore;
      if (record.fakeThirdExitAfter) {
        fakeThirdExitAfterCount += 1;
      }
      detectedTriples.push(record);
      continue;
    }

    const targetX = sideNode.x;
    const requestedSideY = Math.max(sideNode.y, decisionNode.y + minReadableDToAGap);
    const requestedDToAGap = requestedSideY - decisionNode.y;
    const conservativeGapCap = moderateReadableGapCap + Math.round(layoutPlan.layout.verticalGap * 0.35);
    const deepGapCap = moderateReadableGapCap;
    const maxAllowedDToAGap = isNestedOrDeep ? deepGapCap : conservativeGapCap;
    const cappedDToAGap = Math.min(requestedDToAGap, maxAllowedDToAGap);
    const desiredSideY = decisionNode.y + cappedDToAGap;
    const sideShiftDelta = desiredSideY - sideNode.y;
    const maxOverlapShiftSteps = isNestedOrDeep ? 1 : defaultOverlapShiftSteps;
    record.requestedDToAGap = Number(requestedDToAGap.toFixed(2));
    record.cappedDToAGap = Number(cappedDToAGap.toFixed(2));
    record.capApplied = requestedDToAGap > cappedDToAGap + 0.01;
    record.capReason = isNestedOrDeep ? "nestedOrDeep" : "conservativeGlobalCap";
    const desiredContinuationY = Math.max(
      continuationNode.y + sideShiftDelta,
      desiredSideY + stepY,
    );

    const ignoredNodeIds = new Set([sideNode.id, continuationNode.id]);
    let resolvedSideY = desiredSideY;
    let resolvedContinuationY = desiredContinuationY;
    let foundPlacement = false;
    const sideCandidates = [
      desiredSideY,
      sideNode.y,
    ].filter((value, index, values) => values.indexOf(value) === index);
    for (const sideCandidateY of sideCandidates) {
      const sideOverlaps = hasOverlapAt(sideNode, sideNode.x, sideCandidateY, ignoredNodeIds);
      if (sideOverlaps) continue;
      const baseContinuationY = Math.max(
        continuationNode.y + (sideCandidateY - sideNode.y),
        sideCandidateY + stepY,
      );
      const continuationOverlaps = hasOverlapAt(
        continuationNode,
        targetX,
        baseContinuationY,
        ignoredNodeIds,
      );
      if (!continuationOverlaps) {
        resolvedSideY = sideCandidateY;
        resolvedContinuationY = baseContinuationY;
        foundPlacement = true;
        break;
      }

      for (let step = 1; step <= maxOverlapShiftSteps; step += 1) {
        const shiftedContinuationY = baseContinuationY + step * stepY;
        const shiftedContinuationOverlaps = hasOverlapAt(
          continuationNode,
          targetX,
          shiftedContinuationY,
          ignoredNodeIds,
        );
        if (!shiftedContinuationOverlaps) {
          resolvedSideY = sideCandidateY;
          resolvedContinuationY = shiftedContinuationY;
          foundPlacement = true;
          record.overlapAvoidanceShifted = true;
          record.overlapShiftStepCount = step;
          break;
        }
      }

      if (foundPlacement) break;
    }

    if (!foundPlacement) {
      record.reason = "overlapRiskNoSafeShift";
      record.fakeThirdExitAfter = fakeThirdExitBefore;
      const dToAVerticalGapAfter = sideNode.y - decisionNode.y;
      record.dToAVerticalGapAfter = Number(dToAVerticalGapAfter.toFixed(2));
      record.finalDToAGap = record.dToAVerticalGapAfter;
      record.sideChainAAlmostLevelWithDAfter = dToAVerticalGapAfter < minReadableDToAGap;
      record.sideChainReadsAsHorizontalAnnotationAfter = sidePlacedBefore && record.sideChainAAlmostLevelWithDAfter;
      record.localFindingsAfter = localFindingsBefore;
      if (record.fakeThirdExitAfter) {
        fakeThirdExitAfterCount += 1;
      }
      detectedTriples.push(record);
      continue;
    }

    sideNode.y = resolvedSideY;
    continuationNode.x = targetX;
    continuationNode.y = resolvedContinuationY;
    record.newCoordinates.side = { x: sideNode.x, y: sideNode.y };
    record.newCoordinates.continuation = { x: continuationNode.x, y: continuationNode.y };
    record.applied = true;
    record.reason = continuationCenteredBefore
      ? "groupedContinuationWithSideChain"
      : "normalizedSideChainVerticalReadability";
    appliedCount += 1;

    const decisionToSideLayoutEdge = layoutEdgeById.get(record.edgeIds.decisionToSide);
    if (decisionToSideLayoutEdge) {
      decisionToSideLayoutEdge.generatedLocalSideChainRole = "decisionToSide";
      decisionToSideLayoutEdge.generatedLocalSideChainTriple = {
        decisionIndex,
        sideIndex,
        continuationIndex,
      };
    }
    const sideToContinuationLayoutEdge = layoutEdgeById.get(record.edgeIds.sideToContinuation);
    if (sideToContinuationLayoutEdge) {
      sideToContinuationLayoutEdge.generatedLocalSideChainRole = "sideToContinuation";
      sideToContinuationLayoutEdge.generatedLocalSideChainTriple = {
        decisionIndex,
        sideIndex,
        continuationIndex,
      };
    }

    const sideOffsetAfter = Math.abs(sideNode.x - decisionNode.x);
    const dToAVerticalGapAfter = sideNode.y - decisionNode.y;
    record.dToAVerticalGapAfter = Number(dToAVerticalGapAfter.toFixed(2));
    record.finalDToAGap = record.dToAVerticalGapAfter;
    record.sideChainAAlmostLevelWithDAfter = dToAVerticalGapAfter < minReadableDToAGap;
    record.sideChainReadsAsHorizontalAnnotationAfter = sideOffsetAfter >= sideThreshold &&
      record.sideChainAAlmostLevelWithDAfter;
    record.localFindingsAfter = buildLocalFindingSummary(
      decisionNode,
      sideNode,
      continuationNode,
      record.semanticDecisionToContinuationExists,
      minReadableDToAGap,
    );
    const continuationCenteredAfter = Math.abs(continuationNode.x - decisionNode.x) <= centerThreshold;
    const sidePlacedAfter = sideOffsetAfter >= sideThreshold;
    record.fakeThirdExitAfter = (
      !record.semanticDecisionToContinuationExists &&
      sidePlacedAfter &&
      continuationCenteredAfter
    );
    if (record.fakeThirdExitAfter) {
      fakeThirdExitAfterCount += 1;
    }

    detectedTriples.push(record);
  }

  return {
    enabled: true,
    skippedReason: null,
    detectedTriples,
    appliedCount,
    fakeThirdExitBeforeCount,
    fakeThirdExitAfterCount,
  };
}

function buildGeneratedLocalSideChainRenderedAudit(layoutPlan, localSideChainDebug) {
  if (!localSideChainDebug?.enabled) {
    return {
      enabled: false,
      skippedReason: localSideChainDebug?.skippedReason ?? "localSideChainDebugDisabled",
      triples: [],
      summary: {
        strictFakeThirdExitCount: 0,
        strictFakeThirdExitResolvedCount: 0,
      },
    };
  }

  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const routedEdges = layoutPlan.edges ?? [];
  const edgeBySourceTarget = new Map();
  const outgoingBySource = new Map();
  const incomingByTarget = new Map();
  routedEdges.forEach((edge) => {
    if (Number.isInteger(edge.sourceIndex) && Number.isInteger(edge.targetIndex)) {
      const key = `${edge.sourceIndex}->${edge.targetIndex}`;
      if (!edgeBySourceTarget.has(key)) edgeBySourceTarget.set(key, []);
      edgeBySourceTarget.get(key).push(edge);

      if (!outgoingBySource.has(edge.sourceIndex)) outgoingBySource.set(edge.sourceIndex, []);
      outgoingBySource.get(edge.sourceIndex).push(edge);

      if (!incomingByTarget.has(edge.targetIndex)) incomingByTarget.set(edge.targetIndex, []);
      incomingByTarget.get(edge.targetIndex).push(edge);
    }
  });

  const strictRows = [];

  const triples = (localSideChainDebug.detectedTriples ?? []).map((triple) => {
    const decisionNode = nodeLookup.get(triple.decisionIndex) ?? null;
    const sideNode = nodeLookup.get(triple.sideIndex) ?? null;
    const continuationNode = nodeLookup.get(triple.continuationIndex) ?? null;

    const decisionBounds = decisionNode ? getNodeBounds(decisionNode, layoutPlan.layout) : null;
    const continuationBounds = continuationNode ? getNodeBounds(continuationNode, layoutPlan.layout) : null;
    const decisionWidth = decisionBounds
      ? Math.max(0, decisionBounds.right - decisionBounds.left)
      : 0;
    const continuationWidth = continuationBounds
      ? Math.max(0, continuationBounds.right - continuationBounds.left)
      : 0;
    const centerCorridorHalfWidth = decisionBounds
      ? Math.max(decisionWidth * 0.35, 18)
      : 24;
    const decisionConeBounds = decisionBounds && continuationBounds
      ? {
        left: decisionBounds.centerX - centerCorridorHalfWidth,
        right: decisionBounds.centerX + centerCorridorHalfWidth,
        top: decisionBounds.bottom,
        bottom: continuationBounds.top,
      }
      : null;

    const edgeDecisionToSide = edgeBySourceTarget.get(`${triple.decisionIndex}->${triple.sideIndex}`)?.[0] ?? null;
    const edgeSideToContinuation = edgeBySourceTarget.get(`${triple.sideIndex}->${triple.continuationIndex}`)?.[0] ?? null;
    const outgoingDecisionEdges = outgoingBySource.get(triple.decisionIndex) ?? [];
    const incomingContinuationEdges = incomingByTarget.get(triple.continuationIndex) ?? [];
    const decisionOtherBranchEdge = outgoingDecisionEdges
      .find((edge) => edge.targetIndex !== triple.sideIndex) ?? null;

    const edgesNearContinuation = routedEdges.filter((edge) => (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      (
        edge.sourceIndex === triple.continuationIndex ||
        edge.targetIndex === triple.continuationIndex
      )
    ));
    const expandedContinuationBounds = continuationBounds
      ? {
        left: continuationBounds.left - 12,
        right: continuationBounds.right + 12,
        top: continuationBounds.top - 12,
        bottom: continuationBounds.bottom + 12,
      }
      : null;
    const edgesPassingNearContinuation = expandedContinuationBounds
      ? routedEdges.filter((edge) => {
        const points = edge.points ?? [];
        for (let index = 1; index < points.length; index += 1) {
          if (segmentIntersectsRectInterior(points[index - 1], points[index], expandedContinuationBounds, 0.01)) {
            return true;
          }
        }
        return false;
      })
      : [];

    const bWithinDecisionCenterCorridor = Boolean(
      decisionBounds &&
      continuationBounds &&
      Math.abs(continuationBounds.centerX - decisionBounds.centerX) <= centerCorridorHalfWidth,
    );
    const aToBPassesThroughDecisionCone = Boolean(
      decisionConeBounds &&
      edgeSideToContinuation &&
      (edgeSideToContinuation.points ?? []).some((point, index, points) => (
        index > 0 &&
        segmentIntersectsRectInterior(points[index - 1], point, decisionConeBounds, 0.01)
      )),
    );
    const anyNonAToBEdgeEntersBFromTopCenter = incomingContinuationEdges.some((edge) => {
      if (!continuationBounds || edge.sourceIndex === triple.sideIndex) return false;
      const points = edge.points ?? [];
      if (points.length < 2) return false;
      const penultimate = points[points.length - 2];
      const last = points[points.length - 1];
      const entersFromAbove = penultimate[1] < continuationBounds.top + 1 && last[1] <= continuationBounds.top + 1;
      const endsNearCenter = Math.abs(last[0] - continuationBounds.centerX) <= Math.max(10, continuationWidth * 0.3);
      return entersFromAbove && endsNearCenter;
    });
    const decisionConeIntersections = routedEdges.filter((edge) => {
      if (!decisionConeBounds) return false;
      const points = edge.points ?? [];
      for (let index = 1; index < points.length; index += 1) {
        if (segmentIntersectsRectInterior(points[index - 1], points[index], decisionConeBounds, 0.01)) {
          return true;
        }
      }
      return false;
    }).map((edge) => edge.id);
    const decisionHasThreeOutgoingLookingSegments = decisionConeIntersections.length >= 3;

    const strictFakeThirdExit = Boolean(
      !triple.semanticDecisionToContinuationExists &&
      bWithinDecisionCenterCorridor &&
      (aToBPassesThroughDecisionCone || anyNonAToBEdgeEntersBFromTopCenter || decisionHasThreeOutgoingLookingSegments)
    );
    strictRows.push({
      decisionIndex: triple.decisionIndex,
      sideIndex: triple.sideIndex,
      continuationIndex: triple.continuationIndex,
      strictFakeThirdExit,
      resolvedByPass: triple.fakeThirdExitBefore && !strictFakeThirdExit,
    });

    return {
      ...triple,
      finalCoordinates: {
        decision: decisionNode ? { x: decisionNode.x, y: decisionNode.y } : null,
        side: sideNode ? { x: sideNode.x, y: sideNode.y } : null,
        continuation: continuationNode ? { x: continuationNode.x, y: continuationNode.y } : null,
      },
      renderedEdges: {
        decisionToSide: edgeDecisionToSide
          ? {
            id: edgeDecisionToSide.id,
            routeKind: edgeDecisionToSide.routeKind ?? null,
            points: edgeDecisionToSide.points ?? [],
          }
          : null,
        sideToContinuation: edgeSideToContinuation
          ? {
            id: edgeSideToContinuation.id,
            routeKind: edgeSideToContinuation.routeKind ?? null,
            points: edgeSideToContinuation.points ?? [],
          }
          : null,
        decisionOtherBranch: decisionOtherBranchEdge
          ? {
            id: decisionOtherBranchEdge.id,
            sourceIndex: decisionOtherBranchEdge.sourceIndex ?? null,
            targetIndex: decisionOtherBranchEdge.targetIndex ?? null,
            routeKind: decisionOtherBranchEdge.routeKind ?? null,
            points: decisionOtherBranchEdge.points ?? [],
          }
          : null,
        edgesNearContinuation: edgesNearContinuation.map((edge) => ({
          id: edge.id,
          sourceIndex: edge.sourceIndex ?? null,
          targetIndex: edge.targetIndex ?? null,
          routeKind: edge.routeKind ?? null,
          points: edge.points ?? [],
        })),
        edgesPassingNearContinuation: edgesPassingNearContinuation.map((edge) => ({
          id: edge.id,
          sourceIndex: edge.sourceIndex ?? null,
          targetIndex: edge.targetIndex ?? null,
          routeKind: edge.routeKind ?? null,
          points: edge.points ?? [],
        })),
      },
      strictVisualMetrics: {
        decisionHasThreeOutgoingLookingSegments,
        aToBPassesThroughDecisionCone,
        bWithinDecisionCenterCorridor,
        anyNonAToBEdgeEntersBFromTopCenter,
        decisionConeIntersections,
      },
    };
  });

  const strictFakeThirdExitCount = strictRows.filter((row) => row.strictFakeThirdExit).length;
  const strictFakeThirdExitResolvedCount = strictRows.filter((row) => row.resolvedByPass).length;

  return {
    enabled: true,
    skippedReason: null,
    triples,
    summary: {
      strictFakeThirdExitCount,
      strictFakeThirdExitResolvedCount,
    },
  };
}

function measureLayoutPlan(layoutPlan, routedEdges) {
  const { nodes, layout } = layoutPlan;
  const nodeBounds = nodes.map((node) => getNodeBounds(node, layout));
  const allPoints = routedEdges.flatMap((edge) => edge.points);
  const minX = Math.min(
    ...nodeBounds.map((bounds) => bounds.left),
    ...allPoints.map((point) => point[0]),
  );
  const maxX = Math.max(
    ...nodeBounds.map((bounds) => bounds.right),
    ...allPoints.map((point) => point[0]),
  );
  const minY = Math.min(
    ...nodeBounds.map((bounds) => bounds.top),
    ...allPoints.map((point) => point[1]),
  );
  const maxY = Math.max(
    ...nodeBounds.map((bounds) => bounds.bottom),
    ...allPoints.map((point) => point[1]),
  );

  return {
    ...layoutPlan,
    edges: routedEdges,
    width: maxX - minX + NODE_SIDE_PADDING * 2,
    height: maxY - minY + NODE_TOP_PADDING * 2,
    offsetX: NODE_SIDE_PADDING - minX,
    offsetY: NODE_TOP_PADDING - minY,
  };
}

function routeDecisionFork(edge, fromBounds, toBounds, layout, direction, labelAmount = 0.34) {
  const anchors = getDiamondAnchors(fromBounds);
  const start = direction === "left"
    ? anchors.lowerLeftSideCenter
    : anchors.lowerRightSideCenter;
  const end = getTopPort(toBounds);
  const labelPoint = edge.branch
    ? interpolatePoint(start, end, labelAmount)
    : null;

  return {
    ...edge,
    points: [start, end],
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeStraightFallthrough(edge, fromBounds, toBounds) {
  return {
    ...edge,
    points: [getBottomPort(fromBounds), getTopPort(toBounds)],
  };
}

function routeHaltBranch(edge, fromBounds, toBounds) {
  return {
    ...edge,
    points: [getRightPort(fromBounds), getLeftPort(toBounds)],
  };
}

function routePredecessorEdges(layoutPlan) {
  const { edges, nodeMap, layout } = layoutPlan;

  return edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);

    if (!from || !to) return null;

    const fromBounds = getNodeBounds(from, layout);
    const toBounds = getNodeBounds(to, layout);

    if (edge.id === "start-edge" || edge.id === "i-1-fallthrough") {
      return routeStraightFallthrough(edge, fromBounds, toBounds);
    }

    if (edge.id === "i-0-yes") {
      return routeGuardExit(edge, fromBounds, toBounds, layout);
    }

    if (edge.id === "i-0-no") {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    if (edge.id === "i-2-no") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "left", 0.42);
    }

    if (edge.id === "i-2-yes") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "right", 0.42);
    }

    if (edge.id === "i-3-fallthrough" || edge.id === "i-4-fallthrough") {
      return routeStraightFallthrough(edge, fromBounds, toBounds);
    }

    if (edge.id === "i-5-unconditional") {
      const loopNodes = ["i-2", "i-3", "i-4", "i-5"]
        .map((nodeId) => nodeMap.get(nodeId))
        .filter(Boolean)
        .map((node) => getNodeBounds(node, layout));
      const laneX = Math.min(...loopNodes.map((bounds) => bounds.left)) - layout.loopLaneDistance;

      return {
        ...edge,
        points: buildLeftReturnRoute(fromBounds, toBounds, laneX),
      };
    }

    if (edge.id === "i-6-fallthrough") {
      return routeHaltBranch(edge, fromBounds, toBounds);
    }

    return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout);
  }).filter(Boolean);
}

function routeSingleLoopEdges(layoutPlan) {
  const { edges, nodeMap, layout, motif } = layoutPlan;

  return edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);

    if (!from || !to) return null;

    const fromBounds = getNodeBounds(from, layout);
    const toBounds = getNodeBounds(to, layout);

    if (edge.routeKind === "singleLoopExit") {
      return routeGuardExit(edge, fromBounds, toBounds, layout, { branchAware: true });
    }

    if (edge.routeKind === "singleLoopContinue") {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "singleLoopReturn") {
      const loopBounds = [];

      for (
        let index = motif.primaryLoop.testIndex;
        index <= motif.primaryLoop.returnIndex;
        index += 1
      ) {
        const node = nodeMap.get(`i-${index}`);
        if (node) loopBounds.push(getNodeBounds(node, layout));
      }

      const laneX = Math.min(...loopBounds.map((bounds) => bounds.left)) - layout.loopLaneDistance;

      return {
        ...edge,
        points: buildLeftReturnRoute(fromBounds, toBounds, laneX),
      };
    }

    return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout);
  }).filter(Boolean);
}

function buildOrthogonalRoute(points) {
  return points;
}

function routeGuardExit(edge, fromBounds, toBounds, layout, { branchAware = false } = {}) {
  const anchors = getDiamondAnchors(fromBounds);
  const start = branchAware && edge.branch === "no"
    ? anchors.lowerLeftSideCenter
    : anchors.rightAnchor;
  const end = branchAware && edge.branch === "no"
    ? getRightPort(toBounds)
    : getLeftPort(toBounds);
  const cornerX = end[0] - layout.branchExitLength;
  const firstSegmentEnd = [cornerX, start[1]];
  const labelPoint = interpolatePoint(start, firstSegmentEnd, 0.54);

  return {
    ...edge,
    points: buildOrthogonalRoute([
      start,
      firstSegmentEnd,
      [cornerX, end[1]],
      end,
    ]),
    labelX: labelPoint[0],
    labelY: labelPoint[1] - layout.labelOffset,
  };
}

function routeGuardContinue(edge, fromBounds, toBounds, layout) {
  const anchors = getDiamondAnchors(fromBounds);
  const start = anchors.bottomAnchor;
  const end = getTopPort(toBounds);
  const labelPoint = interpolatePoint(start, end, 0.34);

  return {
    ...edge,
    points: [start, end],
    labelX: labelPoint[0] - layout.labelOffset,
    labelY: labelPoint[1],
  };
}

function buildLocalReturnRoute(fromBounds, toBounds) {
  const start = getTopPort(fromBounds);
  const end = getLeftPort(toBounds);

  return [
    start,
    [start[0], end[1]],
    end,
  ];
}

function buildLeftReturnRoute(fromBounds, toBounds, laneX) {
  return buildOrthogonalRoute([
    getLeftPort(fromBounds),
    [laneX, fromBounds.centerY],
    [laneX, toBounds.centerY],
    getLeftPort(toBounds),
  ]);
}

function buildRightReturnRoute(fromBounds, toBounds, laneX) {
  return buildOrthogonalRoute([
    getRightPort(fromBounds),
    [laneX, fromBounds.centerY],
    [laneX, toBounds.centerY],
    getRightPort(toBounds),
  ]);
}

function routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, direction) {
  const anchors = getDiamondAnchors(fromBounds);
  const start = direction === "left" ? anchors.leftAnchor : anchors.rightAnchor;
  const end = direction === "left" ? getRightPort(toBounds) : getLeftPort(toBounds);
  const turn = [end[0], start[1]];
  const labelPoint = edge.branch
    ? interpolatePoint(start, turn, 0.42)
    : null;

  return {
    ...edge,
    points: buildOrthogonalRoute([start, turn, end]),
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeSkipToContinuation(edge, fromBounds, toBounds, layout, fromKind) {
  const anchors = fromKind === "conditionalJump"
    ? getDiamondAnchors(fromBounds)
    : null;
  const start = anchors ? anchors.lowerRightSideCenter : getRightPort(fromBounds);
  const end = getTopPort(toBounds);
  const exitDx = layout.branchExitLength;
  const exitDy = layout.branchForkDy * 0.75;
  const verticalEntry = [
    end[0],
    start[1] + ((end[0] - start[0]) / exitDx) * exitDy,
  ];
  const labelPoint = edge.branch
    ? interpolatePoint(start, verticalEntry, 0.16)
    : null;

  return {
    ...edge,
    points: [
      start,
      verticalEntry,
      end,
    ],
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeSideExit(edge, fromBounds, toBounds, layout, fromKind) {
  const anchors = fromKind === "conditionalJump"
    ? getDiamondAnchors(fromBounds)
    : null;
  const start = anchors
    ? anchors.rightAnchor
    : getBottomPort(fromBounds);
  const end = getLeftPort(toBounds);
  const labelPoint = edge.branch
    ? interpolatePoint(start, end, 0.42)
    : null;

  return {
    ...edge,
    points: [start, end],
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeNestedLoopEdges(layoutPlan) {
  const { edges, nodeMap, layout, analysis, motif } = layoutPlan;
  const allInstructionBounds = layoutPlan.nodes
    .filter((node) => node.id.startsWith("i-"))
    .map((node) => getNodeBounds(node, layout));
  const globalMinLeft = Math.min(...allInstructionBounds.map((bounds) => bounds.left));
  const outerReturnLaneX = globalMinLeft - layout.loopLaneDistance - layout.loopLaneStep * 4;
  const embeddedContinuationStartIndex =
    motif.kind === "embeddedNestedLoop"
      ? motif.embeddedRegionLayout?.continuationRegion?.startIndex ?? null
      : null;
  const isEmbeddedTailEdge = (edge) =>
    motif.kind === "embeddedNestedLoop" &&
    Number.isInteger(embeddedContinuationStartIndex) &&
    Number.isInteger(edge.sourceIndex) &&
    edge.sourceIndex >= embeddedContinuationStartIndex;

  return edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);

    if (!from || !to) return null;

    const fromBounds = getNodeBounds(from, layout);
    const toBounds = getNodeBounds(to, layout);

    if (edge.routeKind === "nestedLoopOuterExit") {
      return routeGuardExit(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "nestedLoopOuterContinue") {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "nestedLoopInnerReturn") {
      return {
        ...edge,
        points: buildLocalReturnRoute(fromBounds, toBounds),
      };
    }

    if (edge.routeKind === "nestedLoopOuterReturn") {
      return {
        ...edge,
        points: buildLeftReturnRoute(fromBounds, toBounds, outerReturnLaneX),
      };
    }

    if (edge.routeKind === "nestedLoopEnterInner") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "left");
    }

    if (edge.routeKind === "nestedLoopInnerContinue") {
      if (from.kind === "conditionalJump") {
        return routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, "left");
      }

      return {
        ...edge,
        points: [getTopPort(fromBounds), getBottomPort(toBounds)],
      };
    }

    if (edge.routeKind === "nestedLoopSkipInner") {
      return routeSkipToContinuation(edge, fromBounds, toBounds, layout, from.kind);
    }

    if (edge.routeKind === "embeddedNestedLoopContinuationEntry") {
      const anchors = from.kind === "conditionalJump"
        ? getDiamondAnchors(fromBounds)
        : null;
      const start = anchors ? anchors.rightAnchor : getRightPort(fromBounds);
      const end = getTopPort(toBounds);
      const bend = [end[0], start[1]];
      const labelPoint = edge.branch
        ? interpolatePoint(start, bend, 0.48)
        : null;

      return {
        ...edge,
        points: buildOrthogonalRoute([
          start,
          bend,
          end,
        ]),
        labelX: labelPoint?.[0],
        labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
      };
    }

    if (edge.routeKind === "nestedLoopInnerExit") {
      return routeSideExit(edge, fromBounds, toBounds, layout, from.kind);
    }

    if (edge.routeKind === "earlyExitToHalt") {
      if (
        isEmbeddedTailEdge(edge) &&
        from.kind === "conditionalJump"
      ) {
        return routeGuardExit(edge, fromBounds, toBounds, layout, { branchAware: true });
      }

      return routeEarlyExit(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "embeddedTailSharedHaltDecision") {
      return routeGuardExit(edge, fromBounds, toBounds, layout, { branchAware: true });
    }

    if (edge.routeKind === "embeddedTailSharedHaltFinal") {
      const start = getRightPort(fromBounds);
      const end = getLeftPort(toBounds);

      return {
        ...edge,
        points: [start, end],
      };
    }

    if (
      isEmbeddedTailEdge(edge) &&
      from.kind === "conditionalJump" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex === edge.sourceIndex + 1
    ) {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "localForwardRejoin") {
      return routeLocalForwardRejoin(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "nearbyForwardBranch") {
      return routeNearbyForward(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "farForwardBranch") {
      return routeFarForward(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "unconditionalForwardJump") {
      return routeUnconditionalForward(edge, fromBounds, toBounds, layout);
    }

    if (isTextbookLoopContinueEdge(edge, analysis)) {
      return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout, {
        forceVerticalContinue: true,
      });
    }

    return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout);
  }).filter(Boolean);
}

function routeGenericEmbeddedNestedLoopBlockEdges(layoutPlan) {
  const { edges, nodeMap, layout, analysis, motif } = layoutPlan;
  const blockBoundsByOuterReturnEdgeId = new Map(
    (motif.embeddedNestedLoopBlocks ?? []).map((block) => {
      const instructionBounds = layoutPlan.nodes
        .filter((node) => {
          const startIndex = node.displayNode?.startIndex;
          return Number.isInteger(startIndex) &&
            block.coreLoop.startIndex <= startIndex &&
            startIndex <= block.coreLoop.endIndex;
        })
        .map((node) => getNodeBounds(node, layout));
      const minLeft = instructionBounds.length > 0
        ? Math.min(...instructionBounds.map((bounds) => bounds.left))
        : null;

      return [block.outerReturnEdgeId, minLeft];
    }),
  );

  return edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);

    if (!from || !to) return null;

    const fromBounds = getNodeBounds(from, layout);
    const toBounds = getNodeBounds(to, layout);
    if (edge.routeKind === "nestedLoopInnerReturn") {
      return {
        ...edge,
        points: buildLocalReturnRoute(fromBounds, toBounds),
      };
    }

    if (edge.routeKind === "nestedLoopOuterReturn") {
      const blockLaneMinLeft = blockBoundsByOuterReturnEdgeId.get(edge.id);
      const laneX = Number.isFinite(blockLaneMinLeft)
        ? blockLaneMinLeft - layout.loopLaneDistance - layout.loopLaneStep * 3
        : Math.min(fromBounds.left, toBounds.left) - layout.loopLaneDistance;

      return {
        ...edge,
        points: buildLeftReturnRoute(fromBounds, toBounds, laneX),
      };
    }

    if (edge.routeKind === "nestedLoopOuterContinue") {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "nestedLoopEnterInner") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "left");
    }

    if (edge.routeKind === "nestedLoopInnerContinue") {
      if (from.kind === "conditionalJump") {
        return routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, "left");
      }

      return {
        ...edge,
        points: [getTopPort(fromBounds), getBottomPort(toBounds)],
      };
    }

    if (edge.routeKind === "nestedLoopSkipInner") {
      return routeSkipToContinuation(edge, fromBounds, toBounds, layout, from.kind);
    }

    if (edge.routeKind === "nestedLoopInnerExit") {
      return routeSideExit(edge, fromBounds, toBounds, layout, from.kind);
    }

    if (edge.routeKind === "embeddedNestedLoopContinuationEntry") {
      const anchors = from.kind === "conditionalJump"
        ? getDiamondAnchors(fromBounds)
        : null;
      const start = anchors ? anchors.rightAnchor : getRightPort(fromBounds);
      const end = getTopPort(toBounds);
      const bend = [end[0], start[1]];
      const labelPoint = edge.branch ? interpolatePoint(start, bend, 0.48) : null;

      return {
        ...edge,
        points: buildOrthogonalRoute([start, bend, end]),
        labelX: labelPoint?.[0],
        labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
      };
    }

    return routeEdgeWithGenericRegionGrammar(
      edge,
      from,
      to,
      layout,
      analysis,
      nodeMap,
      layoutPlan.genericRegionModel,
    );
  }).filter(Boolean);
}

function routeGenericForwardBranchCompact(edge, fromBounds, toBounds, layout) {
  const branch = edge.branch ?? "yes";
  const start = getConditionalBranchStart(fromBounds, branch, edge.routeKind, {
    sourceBounds: fromBounds,
    targetBounds: toBounds,
  });
  const end = getTopPort(toBounds);
  const laneY = Math.min(
    end[1] - layout.sideRouteGap,
    start[1] + layout.branchForkDy,
  );
  const firstTurn = [start[0], laneY];
  const secondTurn = [end[0], laneY];
  const labelPoint = edge.branch
    ? interpolatePoint(start, firstTurn, 0.5)
    : null;

  return {
    ...edge,
    points: buildOrthogonalRoute([start, firstTurn, secondTurn, end]),
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeSketchV1Edge(edge, fromNode, toNode, layout, analysis, nodeMap) {
  const fromBounds = getNodeBounds(fromNode, layout);
  const toBounds = getNodeBounds(toNode, layout);
  const reservedRoute = edge.sketchV1ReservedRoute;

  if (
    Array.isArray(reservedRoute?.points) &&
    reservedRoute.points.length >= 2 &&
    reservedRoute.points.every((point) => (
      Array.isArray(point) &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    ))
  ) {
    return {
      ...edge,
      points: reservedRoute.points,
      labelX: Number.isFinite(reservedRoute.labelX)
        ? reservedRoute.labelX
        : edge.labelX,
      labelY: Number.isFinite(reservedRoute.labelY)
        ? reservedRoute.labelY - layout.labelOffset
        : edge.labelY,
      sketchV1RouteKind: reservedRoute.routeKind ?? "reserved",
    };
  }

  if (isHaltExitEdge(edge, analysis.program.length) || toNode.kind === "halt") {
    return {
      ...routeTerminalExit(edge, fromBounds, toBounds),
      sketchV1RouteKind: "haltExit",
    };
  }

  if (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  ) {
    return {
      ...routeLoopReturn(edge, fromBounds, toBounds, layout, nodeMap, analysis.loopLaneByEdgeId),
      sketchV1RouteKind: "loopReturn",
    };
  }

  if (fromNode.kind === "conditionalJump" && edge.branch) {
    const anchors = getDiamondAnchors(fromBounds);
    const start = edge.branch === "no"
      ? anchors.lowerLeftSideCenter
      : anchors.lowerRightSideCenter;
    const end = getTopPort(toBounds);
    const labelPoint = interpolatePoint(start, end, 0.42);

    return {
      ...edge,
      points: [start, end],
      labelX: labelPoint[0],
      labelY: labelPoint[1] - layout.labelOffset,
      sketchV1RouteKind: edge.branch === "no" ? "noSplitDiagonal" : "yesSplitDiagonal",
    };
  }

  return {
    ...edge,
    points: [getBottomPort(fromBounds), getTopPort(toBounds)],
    sketchV1RouteKind: "directContinuation",
  };
}

function routeSketchV3Edge(edge, fromNode, toNode, layout) {
  const reservedRoute = edge.sketchV3ReservedRoute;

  if (
    Array.isArray(reservedRoute?.points) &&
    reservedRoute.points.length >= 2 &&
    reservedRoute.points.every((point) => (
      Array.isArray(point) &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    ))
  ) {
    return {
      ...edge,
      points: reservedRoute.points,
      labelX: Number.isFinite(reservedRoute.labelX)
        ? reservedRoute.labelX
        : edge.labelX,
      labelY: Number.isFinite(reservedRoute.labelY)
        ? reservedRoute.labelY - layout.labelOffset
        : edge.labelY,
      sketchV3RouteKind: reservedRoute.routeKind ?? "reserved",
    };
  }

  const fromBounds = getNodeBounds(fromNode, layout);
  const toBounds = getNodeBounds(toNode, layout);

  return {
    ...edge,
    points: [getBottomPort(fromBounds), getTopPort(toBounds)],
    sketchV3RouteKind: "fallbackDirect",
  };
}

function routeGeneratedSideChainEntry(edge, fromBounds, toBounds, layout) {
  const start = getBottomPort(fromBounds);
  const end = getTopPort(toBounds);
  const verticalLift = Math.max(layout.branchForkDy, 18);
  const approachPadding = Math.max(Math.round(layout.verticalGap * 0.45), 10);
  const turnY = Math.max(start[1] + verticalLift, end[1] - approachPadding);
  const labelPoint = edge.branch
    ? interpolatePoint(start, [start[0], turnY], 0.5)
    : null;

  return {
    ...edge,
    points: buildOrthogonalRoute([
      start,
      [start[0], turnY],
      [end[0], turnY],
      end,
    ]),
    labelX: labelPoint?.[0],
    labelY: labelPoint ? labelPoint[1] - layout.labelOffset : undefined,
  };
}

function routeEdgeWithGenericRegionGrammar(
  edge,
  fromNode,
  toNode,
  layout,
  analysis,
  nodeMap,
  genericRegionModel = null,
) {
  const fromBounds = getNodeBounds(fromNode, layout);
  const toBounds = getNodeBounds(toNode, layout);

  if (analysis.layoutMode === "sketchV1") {
    return routeSketchV1Edge(edge, fromNode, toNode, layout, analysis, nodeMap);
  }

  if (analysis.layoutMode === "sketchV3") {
    return routeSketchV3Edge(edge, fromNode, toNode, layout);
  }

  if (isHaltExitEdge(edge, analysis.program.length)) {
    return routeTerminalExit(edge, fromBounds, toBounds);
  }

  if (!genericRegionModel) {
    return routeDefaultEdge(edge, nodeMap, layout, analysis);
  }

  const sourceIndex = edge.sourceIndex;
  const targetIndex = edge.targetIndex;
  const sourceProtected = Number.isInteger(sourceIndex)
    ? genericRegionModel.isProtectedIndex(sourceIndex)
    : false;
  const targetProtected = Number.isInteger(targetIndex)
    ? genericRegionModel.isProtectedIndex(targetIndex)
    : false;
  const sourceRegionId = Number.isInteger(sourceIndex)
    ? genericRegionModel.genericRegionIdByIndex.get(sourceIndex)
    : null;
  const targetRegionId = Number.isInteger(targetIndex)
    ? genericRegionModel.genericRegionIdByIndex.get(targetIndex)
    : null;
  const sameGenericRegion = Number.isInteger(sourceRegionId) && sourceRegionId === targetRegionId;
  const isForward = Number.isInteger(sourceIndex) && Number.isInteger(targetIndex) && targetIndex > sourceIndex;
  if (edge.generatedLocalSideChainRole === "decisionToSide") {
    return routeGeneratedSideChainEntry(edge, fromBounds, toBounds, layout);
  }

  if (edge.generatedLocalSideChainRole === "sideToContinuation") {
    return routeStraightFallthrough(edge, fromBounds, toBounds);
  }

  if (
    edge.type === "fallthrough" &&
    sameGenericRegion &&
    !sourceProtected &&
    !targetProtected
  ) {
    return routeStraightFallthrough(edge, fromBounds, toBounds);
  }

  if (
    isForward &&
    !sourceProtected &&
    !targetProtected &&
    analysis.nodeRoles[sourceIndex] === "conditionalJump" &&
    sameGenericRegion
  ) {
    if (targetIndex === sourceIndex + 1) {
      return routeGuardContinue(edge, fromBounds, toBounds, layout);
    }

    return routeGenericForwardBranchCompact(edge, fromBounds, toBounds, layout);
  }

  if (
    isForward &&
    !sourceProtected &&
    !targetProtected &&
    analysis.nodeRoles[sourceIndex] === "unconditionalJump" &&
    sameGenericRegion
  ) {
    return routeUnconditionalForward(edge, fromBounds, toBounds, layout);
  }

  if (isForward && sourceProtected !== targetProtected) {
    return routeContinuationElbow(edge, fromBounds, toBounds, layout);
  }

  return routeDefaultEdge(edge, nodeMap, layout, analysis);
}

function isEdgeEndpointProtected(edge, genericRegionModel) {
  if (!genericRegionModel) return false;
  const sourceProtected = Number.isInteger(edge.sourceIndex)
    ? genericRegionModel.isProtectedIndex(edge.sourceIndex)
    : false;
  const targetProtected = Number.isInteger(edge.targetIndex)
    ? genericRegionModel.isProtectedIndex(edge.targetIndex)
    : false;

  return sourceProtected || targetProtected;
}

function isEdgeFullyInsideProtectedBlock(edge, genericRegionModel) {
  if (!genericRegionModel) return false;
  if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return false;
  return genericRegionModel.isProtectedIndex(edge.sourceIndex) &&
    genericRegionModel.isProtectedIndex(edge.targetIndex);
}

function getGenericEdgeNudgePriority(edge, analysis, genericRegionModel) {
  if (!genericRegionModel) return null;
  if (isEdgeFullyInsideProtectedBlock(edge, genericRegionModel)) return null;
  if (isHaltExitEdge(edge, analysis.program.length) || isLikelyHaltNodeId(edge.to)) return null;

  const edgeRole = analysis.visualRoles?.edgeRoleById?.[edge.id]?.role;
  if (edgeRole === "localReturn" || edgeRole === "outerReturn") return null;

  const blockedRouteKinds = new Set([
    "nestedLoopInnerReturn",
    "nestedLoopOuterReturn",
    "nestedLoopOuterContinue",
    "nestedLoopEnterInner",
    "nestedLoopInnerContinue",
    "nestedLoopSkipInner",
    "nestedLoopInnerExit",
    "singleLoopReturn",
    "minimizationLocalReturn",
    "minimizationMainReturn",
    "minimizationCandidateReturn",
    "predecessorLoopReturn",
  ]);
  if (blockedRouteKinds.has(edge.routeKind)) return null;

  const sourceIndex = Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : -1;
  const edgeClass = edge.type === "fallthrough"
    ? 3
    : edge.branch || edge.routeKind === "embeddedNestedLoopContinuationEntry" || edge.routeKind === "unconditionalForwardJump"
      ? 1
      : 2;

  return {
    sourceIndex,
    edgeClass,
  };
}

function compareNudgePriority(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.sourceIndex !== right.sourceIndex) {
    return left.sourceIndex > right.sourceIndex ? 1 : -1;
  }
  if (left.edgeClass !== right.edgeClass) {
    return left.edgeClass < right.edgeClass ? 1 : -1;
  }
  return 0;
}

function applyOrthogonalSegmentNudge(points, segmentIndex, orientation, delta) {
  if (!Array.isArray(points) || segmentIndex < 0 || segmentIndex >= points.length - 1) {
    return points;
  }

  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];

  if (!start || !end) return points;

  const nudgeStart = orientation === "horizontal"
    ? [start[0], start[1] + delta]
    : [start[0] + delta, start[1]];
  const nudgeEnd = orientation === "horizontal"
    ? [end[0], end[1] + delta]
    : [end[0] + delta, end[1]];

  return [
    ...points.slice(0, segmentIndex + 1),
    nudgeStart,
    nudgeEnd,
    ...points.slice(segmentIndex + 1),
  ];
}

function resolveGenericPathOverlapMerges(routedEdges, layoutPlan) {
  const genericModes = new Set(["genericInstructionFallback", "genericEmbeddedNestedLoopBlocks"]);
  if (!genericModes.has(layoutPlan.motif.kind)) return routedEdges;
  if (!layoutPlan.genericRegionModel) return routedEdges;

  const edgeRoleById = layoutPlan.analysis.visualRoles?.edgeRoleById ?? {};
  const laneDelta = Math.max(10, Math.round(layoutPlan.layout.sideRouteGap * 0.66));
  let workingEdges = routedEdges.map((edge) => ({
    ...edge,
    points: edge.points.map(([x, y]) => [x, y]),
  }));
  const maxIterations = 12;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const overlapReport = detectPathSegmentOverlaps(workingEdges, edgeRoleById);
    const nextForbidden = overlapReport.forbiddenOverlaps;
    if (nextForbidden.length === 0) break;

    const chosenOverlap = nextForbidden.find((overlap) => {
      const edgeA = workingEdges.find((edge) => edge.id === overlap.edgeA);
      const edgeB = workingEdges.find((edge) => edge.id === overlap.edgeB);
      const priorityA = edgeA
        ? getGenericEdgeNudgePriority(edgeA, layoutPlan.analysis, layoutPlan.genericRegionModel)
        : null;
      const priorityB = edgeB
        ? getGenericEdgeNudgePriority(edgeB, layoutPlan.analysis, layoutPlan.genericRegionModel)
        : null;
      return Boolean(priorityA || priorityB);
    });

    if (!chosenOverlap) {
      break;
    }

    const edgeA = workingEdges.find((edge) => edge.id === chosenOverlap.edgeA);
    const edgeB = workingEdges.find((edge) => edge.id === chosenOverlap.edgeB);
    const priorityA = edgeA
      ? getGenericEdgeNudgePriority(edgeA, layoutPlan.analysis, layoutPlan.genericRegionModel)
      : null;
    const priorityB = edgeB
      ? getGenericEdgeNudgePriority(edgeB, layoutPlan.analysis, layoutPlan.genericRegionModel)
      : null;

    let targetEdge = null;
    let targetSegmentIndex = null;

    if (compareNudgePriority(priorityA, priorityB) >= 0 && priorityA) {
      targetEdge = edgeA;
      targetSegmentIndex = chosenOverlap.segmentAIndex;
    } else if (priorityB) {
      targetEdge = edgeB;
      targetSegmentIndex = chosenOverlap.segmentBIndex;
    }

    if (!targetEdge || !Number.isInteger(targetSegmentIndex)) {
      break;
    }

    const deltaSign = (iteration % 2 === 0) ? 1 : -1;
    targetEdge.points = applyOrthogonalSegmentNudge(
      targetEdge.points,
      targetSegmentIndex,
      chosenOverlap.orientation,
      laneDelta * deltaSign,
    );
  }

  return workingEdges;
}

function routeMinimizationVerticalConditional(edge, fromBounds, toBounds, layout) {
  const anchors = getDiamondAnchors(fromBounds);
  const start = anchors.bottomAnchor;
  const end = getTopPort(toBounds);
  const labelPoint = edge.branch
    ? interpolatePoint(start, end, 0.34)
    : null;

  return {
    ...edge,
    points: [start, end],
    labelX: labelPoint ? labelPoint[0] - layout.labelOffset : undefined,
    labelY: labelPoint?.[1],
  };
}

function routeMinimizationOuterReturn(edge, fromBounds, toBounds, layout, nodeMap, indexes) {
  const loopBounds = indexes
    .map((index) => nodeMap.get(`i-${index}`))
    .filter(Boolean)
    .map((node) => getNodeBounds(node, layout));
  const laneX = Math.min(...loopBounds.map((bounds) => bounds.left)) - layout.loopLaneDistance;

  return {
    ...edge,
    points: buildLeftReturnRoute(fromBounds, toBounds, laneX),
  };
}

function routeMinimizationCandidateReturn(edge, fromBounds, toBounds, layout, nodeMap) {
  const instructionBounds = Array.from(nodeMap.values())
    .filter((node) => node.id.startsWith("i-"))
    .map((node) => getNodeBounds(node, layout));
  const laneX = Math.max(...instructionBounds.map((bounds) => bounds.right)) + layout.loopLaneDistance;

  return {
    ...edge,
    points: buildRightReturnRoute(fromBounds, toBounds, laneX),
  };
}

function routeMinimizationFlowEdges(layoutPlan) {
  const { edges, nodeMap, layout } = layoutPlan;

  return edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);

    if (!from || !to) return null;

    const fromBounds = getNodeBounds(from, layout);
    const toBounds = getNodeBounds(to, layout);

    if (edge.routeKind === "minimizationMainEnterInternal") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "left");
    }

    if (edge.routeKind === "minimizationMainExit") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "right");
    }

    if (edge.routeKind === "minimizationPredicateEnter") {
      return routeDecisionFork(edge, fromBounds, toBounds, layout, "left");
    }

    if (edge.routeKind === "minimizationPredicateExit") {
      if (from.kind === "conditionalJump" && Math.abs(fromBounds.centerY - toBounds.centerY) < 8) {
        return routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, "right");
      }

      return routeMinimizationVerticalConditional(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "minimizationPredicateContinue") {
      return routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, "left");
    }

    if (edge.routeKind === "minimizationLocalReturn") {
      return {
        ...edge,
        points: buildLocalReturnRoute(fromBounds, toBounds),
      };
    }

    if (edge.routeKind === "minimizationMainReturn") {
      return routeMinimizationOuterReturn(
        edge,
        fromBounds,
        toBounds,
        layout,
        nodeMap,
        rangeIndexes(10, 20),
      );
    }

    if (edge.routeKind === "minimizationFinalize") {
      return routeHorizontalDiamondSplit(edge, fromBounds, toBounds, layout, "right");
    }

    if (edge.routeKind === "minimizationContinueSearch") {
      return routeMinimizationVerticalConditional(edge, fromBounds, toBounds, layout);
    }

    if (edge.routeKind === "minimizationCandidateReturn") {
      return routeMinimizationCandidateReturn(edge, fromBounds, toBounds, layout, nodeMap);
    }

    if (edge.routeKind === "minimizationFinalHalt") {
      return routeHaltBranch(edge, fromBounds, toBounds);
    }

    if (fromBounds.centerY > toBounds.centerY) {
      return {
        ...edge,
        points: [getTopPort(fromBounds), getBottomPort(toBounds)],
      };
    }

    return routeOrdinaryFallthrough(edge, fromBounds, toBounds, layout);
  }).filter(Boolean);
}

function simplifyOrthogonalPoints(points, epsilon = 0.01) {
  if (!Array.isArray(points) || points.length < 2) return points ?? [];

  const deduped = [];
  points.forEach((point) => {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(last[0] - point[0]) > epsilon || Math.abs(last[1] - point[1]) > epsilon) {
      deduped.push(point);
    }
  });

  if (deduped.length < 3) return deduped;

  const simplified = [deduped[0]];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const prev = simplified[simplified.length - 1];
    const current = deduped[index];
    const next = deduped[index + 1];
    const prevDx = current[0] - prev[0];
    const prevDy = current[1] - prev[1];
    const nextDx = next[0] - current[0];
    const nextDy = next[1] - current[1];
    const prevHorizontal = Math.abs(prevDy) <= epsilon;
    const prevVertical = Math.abs(prevDx) <= epsilon;
    const nextHorizontal = Math.abs(nextDy) <= epsilon;
    const nextVertical = Math.abs(nextDx) <= epsilon;

    if (
      (prevHorizontal && nextHorizontal) ||
      (prevVertical && nextVertical)
    ) {
      continue;
    }

    simplified.push(current);
  }
  simplified.push(deduped.at(-1));
  return simplified;
}

function buildSingleLaneOrthogonalCandidate(start, end, laneKind, laneCoord) {
  if (laneKind === "vertical") {
    return simplifyOrthogonalPoints([
      start,
      [laneCoord, start[1]],
      [laneCoord, end[1]],
      end,
    ]);
  }

  return simplifyOrthogonalPoints([
    start,
    [start[0], laneCoord],
    [end[0], laneCoord],
    end,
  ]);
}

function collectEdgeIntersectionNodeIds(edgePoints, instructionNodes, nodeBoundsById, sourceNodeId, targetNodeId) {
  const hits = new Set();
  if (!Array.isArray(edgePoints) || edgePoints.length < 2) return hits;

  instructionNodes.forEach((node) => {
    if (node.id === sourceNodeId || node.id === targetNodeId) return;
    const bounds = nodeBoundsById.get(node.id);
    if (!bounds) return;

    for (let index = 1; index < edgePoints.length; index += 1) {
      if (segmentIntersectsRectInterior(edgePoints[index - 1], edgePoints[index], bounds, 0.01)) {
        hits.add(node.id);
        return;
      }
    }
  });

  return hits;
}

function collectEdgeForeignRegionIds(edgePoints, protectedRegions, allowedRegionIds) {
  const hits = new Set();
  if (!Array.isArray(edgePoints) || edgePoints.length < 2) return hits;

  protectedRegions.forEach((region) => {
    if (allowedRegionIds.has(region.id)) return;
    for (let index = 1; index < edgePoints.length; index += 1) {
      if (segmentIntersectsRectInterior(edgePoints[index - 1], edgePoints[index], region.bounds, 0.01)) {
        hits.add(region.id);
        return;
      }
    }
  });

  return hits;
}

function evaluateEdgeHighSeverityViolations({
  edge,
  points,
  instructionNodes,
  nodeBoundsById,
  sourceNodeId,
  targetNodeId,
  protectedRegions,
  allowedRegionIds,
}) {
  const intersectingNodeIds = collectEdgeIntersectionNodeIds(
    points,
    instructionNodes,
    nodeBoundsById,
    sourceNodeId,
    targetNodeId,
  );
  const foreignRegionIds = collectEdgeForeignRegionIds(points, protectedRegions, allowedRegionIds);

  return {
    highCount: intersectingNodeIds.size + foreignRegionIds.size,
    intersectingNodeIds: [...intersectingNodeIds],
    foreignRegionIds: [...foreignRegionIds],
  };
}

function buildProtectedAwareCandidateLanes(start, end, obstacleBounds, layout) {
  const laneGap = Math.max(layout.sideRouteGap * 2, layout.localForwardLaneDistance * 1.25, 24);
  const minX = Math.min(start[0], end[0], ...obstacleBounds.map((bounds) => bounds.left));
  const maxX = Math.max(start[0], end[0], ...obstacleBounds.map((bounds) => bounds.right));
  const minY = Math.min(start[1], end[1], ...obstacleBounds.map((bounds) => bounds.top));
  const maxY = Math.max(start[1], end[1], ...obstacleBounds.map((bounds) => bounds.bottom));

  return [
    { laneName: "left", laneKind: "vertical", laneCoord: minX - laneGap },
    { laneName: "right", laneKind: "vertical", laneCoord: maxX + laneGap },
    { laneName: "top", laneKind: "horizontal", laneCoord: minY - laneGap },
    { laneName: "bottom", laneKind: "horizontal", laneCoord: maxY + laneGap },
  ];
}

function buildProtectedAwareReroutePoints({
  edge,
  fromNode,
  toNode,
  obstacleBounds,
  layout,
}) {
  const start = edge.points?.[0] ?? (() => {
    const fromBounds = getNodeBounds(fromNode, layout);
    return edge.branch === "no" ? getLeftPort(fromBounds) : getBottomPort(fromBounds);
  })();
  const end = edge.points?.at(-1) ?? (() => {
    const toBounds = getNodeBounds(toNode, layout);
    return getTopPort(toBounds);
  })();
  const lanes = buildProtectedAwareCandidateLanes(start, end, obstacleBounds, layout);
  return lanes.map((lane) => ({
    ...lane,
    points: buildSingleLaneOrthogonalCandidate(start, end, lane.laneKind, lane.laneCoord),
  }));
}

function buildEdgeFindingSummaryMap(findings = []) {
  const summaryByEdgeId = new Map();
  findings.forEach((finding) => {
    (finding.edgeIds ?? []).forEach((edgeId) => {
      if (!summaryByEdgeId.has(edgeId)) {
        summaryByEdgeId.set(edgeId, {
          totalCount: 0,
          highCount: 0,
          kindCounts: {},
        });
      }
      const summary = summaryByEdgeId.get(edgeId);
      summary.totalCount += 1;
      if (finding.severity === "high") summary.highCount += 1;
      const kind = String(finding.kind ?? "unknown");
      summary.kindCounts[kind] = (summary.kindCounts[kind] ?? 0) + 1;
    });
  });
  return summaryByEdgeId;
}

function getCrossedAvoidProtectedRegionIdsForPlanRow({
  points,
  row,
  protectedRegions = [],
  protectedRegionIds = new Set(),
}) {
  const mayCrossSet = new Set(
    (row?.mayCrossProtectedRegionIds ?? []).filter((regionId) => protectedRegionIds.has(regionId)),
  );
  const avoidSet = new Set(
    (row?.shouldAvoidProtectedRegionIds ?? []).filter((regionId) => protectedRegionIds.has(regionId)),
  );
  const foreignRegionIds = collectEdgeForeignRegionIds(points, protectedRegions, mayCrossSet);
  return [...foreignRegionIds].filter((regionId) => avoidSet.has(regionId));
}

function countCrossedAvoidPlanViolationsForEdges({
  rowsByEdgeId,
  routedEdges = [],
  protectedRegions = [],
}) {
  const protectedRegionIds = new Set((protectedRegions ?? []).map((region) => region.id));
  let count = 0;
  routedEdges.forEach((edge) => {
    const row = rowsByEdgeId.get(edge.id);
    if (!row) return;
    if (!row.ownerRegionId) return;
    if (!Array.isArray(row.shouldAvoidProtectedRegionIds) || row.shouldAvoidProtectedRegionIds.length === 0) {
      return;
    }
    const crossedAvoidRegionIds = getCrossedAvoidProtectedRegionIdsForPlanRow({
      points: edge.points ?? [],
      row,
      protectedRegions,
      protectedRegionIds,
    });
    if (crossedAvoidRegionIds.length > 0) count += 1;
  });
  return count;
}

function getPreferredLaneNameOrderForRegionPlanRow(row, edge) {
  const preferredExitSide = row?.preferredExitSide ?? null;
  if (preferredExitSide === "left") return ["left", "right", "top", "bottom"];
  if (preferredExitSide === "right") return ["right", "left", "top", "bottom"];
  if (Number.isInteger(edge?.sourceIndex) && Number.isInteger(edge?.targetIndex)) {
    if (edge.targetIndex >= edge.sourceIndex) return ["right", "left", "top", "bottom"];
    return ["left", "right", "top", "bottom"];
  }
  return ["right", "left", "top", "bottom"];
}

function applyGeneratedRegionPlanProtectedReroute(layoutPlan, routedEdges) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "layoutModeNotGenerated",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
        beforeAudit: null,
        afterAudit: null,
        beforeCrossedAvoidPlanViolationCount: 0,
        afterCrossedAvoidPlanViolationCount: 0,
      },
    };
  }
  if (!layoutPlan.genericRegionModel) {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "genericRegionModelMissing",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
        beforeAudit: null,
        afterAudit: null,
        beforeCrossedAvoidPlanViolationCount: 0,
        afterCrossedAvoidPlanViolationCount: 0,
      },
    };
  }
  const regionEdgePlan = layoutPlan.generatedRegionEdgePlanDebug ?? null;
  if (!regionEdgePlan?.enabled || !Array.isArray(regionEdgePlan.rows) || regionEdgePlan.rows.length === 0) {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "generatedRegionEdgePlanMissing",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
        beforeAudit: null,
        afterAudit: null,
        beforeCrossedAvoidPlanViolationCount: 0,
        afterCrossedAvoidPlanViolationCount: 0,
      },
    };
  }

  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const protectedRegions = buildProtectedRegionDiagnostics(
    layoutPlan,
    analysis,
    visualRoles,
    nodeLookup,
    layoutPlan.layout,
  );
  const protectedRegionIds = new Set(protectedRegions.map((region) => region.id));
  const regionById = new Map(protectedRegions.map((region) => [region.id, region]));
  const rowsByEdgeId = new Map((regionEdgePlan.rows ?? []).map((row) => [row.edgeId, row]));
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const nodeBoundsById = new Map(
    instructionNodes.map((node) => [node.id, getNodeBounds(node, layoutPlan.layout)]),
  );
  const evidenceKinds = new Set([
    "edgePassesThroughForeignProtectedRegion",
    "edgeNodeIntersection",
    "longDiagonalCrossesProtectedRegion",
  ]);
  const shortLocalSpanThreshold = Math.max(
    layoutPlan.layout.verticalGap * 2.2,
    layoutPlan.layout.actionNodeHeight * 2.4,
    84,
  );

  const computeAuditBundle = (candidateEdges) => {
    const candidateLayoutPlan = {
      ...layoutPlan,
      edges: candidateEdges,
    };
    const laneAssignments = buildGenericLaneAssignments(candidateLayoutPlan, edgeRoleById);
    const overlaps = detectPathSegmentOverlaps(
      candidateEdges,
      edgeRoleById,
      laneAssignments.byEdgeId ?? {},
    );
    const audit = buildSeparationAndOverlapAudit({
      layoutPlan: candidateLayoutPlan,
      routedEdges: candidateEdges,
      analysis,
      visualRoles,
      edgeRoleById,
      nodeLookup,
      laneAssignmentsByEdgeId: laneAssignments.byEdgeId ?? {},
      pathSegmentOverlaps: overlaps,
    });
    return { laneAssignments, overlaps, audit };
  };

  let workingEdges = cloneRoutedEdges(routedEdges);
  const initialBaselineBundle = computeAuditBundle(workingEdges);
  let baselineBundle = initialBaselineBundle;
  let edgeFindingSummaryByEdgeId = buildEdgeFindingSummaryMap(baselineBundle.audit.findings);
  const attempts = [];
  const exhaustedEdgeIds = new Set();

  const maxAttempts = 36;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const candidates = [];
    workingEdges.forEach((edge) => {
      if (exhaustedEdgeIds.has(edge.id)) return;
      const row = rowsByEdgeId.get(edge.id);
      if (!row) return;
      if (!row.ownerRegionId) return;
      if (!Array.isArray(row.shouldAvoidProtectedRegionIds) || row.shouldAvoidProtectedRegionIds.length === 0) {
        return;
      }

      const crossedAvoidRegionIds = getCrossedAvoidProtectedRegionIdsForPlanRow({
        points: edge.points ?? [],
        row,
        protectedRegions,
        protectedRegionIds,
      });
      if (crossedAvoidRegionIds.length === 0) return;

      const findingSummary = edgeFindingSummaryByEdgeId.get(edge.id) ?? {
        totalCount: 0,
        highCount: 0,
        kindCounts: {},
      };
      const evidenceKindsPresent = Object.keys(findingSummary.kindCounts)
        .filter((kind) => evidenceKinds.has(kind));
      if (evidenceKindsPresent.length === 0) return;

      const points = Array.isArray(edge.points) ? edge.points : [];
      if (points.length < 2) return;
      const verticalSpan = Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]));
      const isImmediateFallthrough = edge.type === "fallthrough" &&
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex === edge.sourceIndex + 1;
      const hasOnlyForeignEvidence = evidenceKindsPresent.every((kind) => kind === "edgePassesThroughForeignProtectedRegion");
      const isShortLocalHarmless = isImmediateFallthrough &&
        verticalSpan <= shortLocalSpanThreshold &&
        crossedAvoidRegionIds.length <= 1 &&
        hasOnlyForeignEvidence;
      if (isShortLocalHarmless) return;

      candidates.push({
        edge,
        row,
        findingSummary,
        crossedAvoidRegionIds,
        evidenceKindsPresent,
        verticalSpan,
      });
    });

    if (candidates.length === 0) break;

    candidates.sort((left, right) => {
      if (right.crossedAvoidRegionIds.length !== left.crossedAvoidRegionIds.length) {
        return right.crossedAvoidRegionIds.length - left.crossedAvoidRegionIds.length;
      }
      if (right.findingSummary.highCount !== left.findingSummary.highCount) {
        return right.findingSummary.highCount - left.findingSummary.highCount;
      }
      if (right.findingSummary.totalCount !== left.findingSummary.totalCount) {
        return right.findingSummary.totalCount - left.findingSummary.totalCount;
      }
      return left.edge.id.localeCompare(right.edge.id);
    });

    const target = candidates[0];
    const edge = target.edge;
    const row = target.row;
    const fromNode = layoutPlan.nodeMap.get(edge.from);
    const toNode = layoutPlan.nodeMap.get(edge.to);
    const sourceLabel = Number.isInteger(edge.sourceIndex) ? formatInstructionNodeId(edge.sourceIndex) : edge.from;
    const targetLabel = Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : edge.to;

    const baseAttempt = {
      edgeId: edge.id,
      sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      source: sourceLabel,
      target: targetLabel,
      ownerRegionId: row.ownerRegionId ?? null,
      routeKind: row.routeKind ?? edge.routeKind ?? null,
      avoidRegionIdsBefore: target.crossedAvoidRegionIds,
      avoidRegionIdsAfter: target.crossedAvoidRegionIds,
      separationFindingsBefore: Object.keys(target.findingSummary.kindCounts),
      separationFindingsAfter: Object.keys(target.findingSummary.kindCounts),
      oldRoutePoints: Array.isArray(edge.points) ? edge.points.map(([x, y]) => [x, y]) : [],
      candidateRoutePoints: null,
      applied: false,
      reason: "notApplied",
    };

    if (!fromNode || !toNode || !Array.isArray(edge.points) || edge.points.length < 2) {
      attempts.push({
        ...baseAttempt,
        reason: "missingNodesOrRoutePoints",
      });
      continue;
    }

    const mayCrossSet = new Set(
      (row.mayCrossProtectedRegionIds ?? []).filter((regionId) => protectedRegionIds.has(regionId)),
    );
    const baselineEvaluation = evaluateEdgeHighSeverityViolations({
      edge,
      points: edge.points,
      instructionNodes,
      nodeBoundsById,
      sourceNodeId: fromNode.id,
      targetNodeId: toNode.id,
      protectedRegions,
      allowedRegionIds: mayCrossSet,
    });
    const baselineHighFindingCount = target.findingSummary.highCount;
    const obstacleBounds = [
      ...target.crossedAvoidRegionIds
        .map((regionId) => regionById.get(regionId)?.bounds)
        .filter(Boolean),
      ...baselineEvaluation.intersectingNodeIds
        .map((nodeId) => nodeBoundsById.get(nodeId))
        .filter(Boolean),
    ];
    if (obstacleBounds.length === 0) {
      attempts.push({
        ...baseAttempt,
        reason: "noObstacleBounds",
      });
      continue;
    }

    const laneNameOrder = getPreferredLaneNameOrderForRegionPlanRow(row, edge);
    const routeCandidates = buildProtectedAwareReroutePoints({
      edge,
      fromNode,
      toNode,
      obstacleBounds,
      layout: layoutPlan.layout,
    })
      .sort((left, right) => laneNameOrder.indexOf(left.laneName) - laneNameOrder.indexOf(right.laneName));

    let bestAppliedCandidate = null;
    routeCandidates.forEach((candidate) => {
      const candidateEdges = cloneRoutedEdges(workingEdges);
      const candidateEdge = candidateEdges.find((item) => item.id === edge.id);
      if (!candidateEdge) return;
      candidateEdge.points = candidate.points;
      if (edge.branch && Array.isArray(candidate.points) && candidate.points.length >= 2) {
        const [p0, p1] = candidate.points;
        candidateEdge.labelX = Number(((p0[0] + p1[0]) / 2).toFixed(2));
        candidateEdge.labelY = Number(((p0[1] + p1[1]) / 2 - 3).toFixed(2));
      }

      const candidateBundle = computeAuditBundle(candidateEdges);
      const candidateSummaryMap = buildEdgeFindingSummaryMap(candidateBundle.audit.findings);
      const candidateFindingSummary = candidateSummaryMap.get(edge.id) ?? {
        totalCount: 0,
        highCount: 0,
        kindCounts: {},
      };
      const candidateCrossedAvoidRegionIds = getCrossedAvoidProtectedRegionIdsForPlanRow({
        points: candidate.points,
        row,
        protectedRegions,
        protectedRegionIds,
      });
      const candidateForeignFindingCount =
        candidateFindingSummary.kindCounts.edgePassesThroughForeignProtectedRegion ?? 0;
      const baselineForeignFindingCount =
        target.findingSummary.kindCounts.edgePassesThroughForeignProtectedRegion ?? 0;
      const decreasesAvoidCrossings = candidateCrossedAvoidRegionIds.length < target.crossedAvoidRegionIds.length;
      const doesNotIncreaseHighFindings = candidateFindingSummary.highCount <= baselineHighFindingCount;
      const improvesForeignProtected = candidateForeignFindingCount < baselineForeignFindingCount;
      if (!decreasesAvoidCrossings) return;
      if (!doesNotIncreaseHighFindings) return;

      const candidateScore = {
        improvesForeignProtected: improvesForeignProtected ? 1 : 0,
        avoidCount: candidateCrossedAvoidRegionIds.length,
        highCount: candidateFindingSummary.highCount,
        totalCount: candidateFindingSummary.totalCount,
        segmentCount: Math.max(candidate.points.length - 1, 0),
      };

      if (!bestAppliedCandidate) {
        bestAppliedCandidate = {
          laneName: candidate.laneName,
          points: candidate.points,
          bundle: candidateBundle,
          summaryMap: candidateSummaryMap,
          findingSummary: candidateFindingSummary,
          crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
          score: candidateScore,
        };
        return;
      }

      if (candidateScore.improvesForeignProtected !== bestAppliedCandidate.score.improvesForeignProtected) {
        if (candidateScore.improvesForeignProtected > bestAppliedCandidate.score.improvesForeignProtected) {
          bestAppliedCandidate = {
            laneName: candidate.laneName,
            points: candidate.points,
            bundle: candidateBundle,
            summaryMap: candidateSummaryMap,
            findingSummary: candidateFindingSummary,
            crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
            score: candidateScore,
          };
        }
        return;
      }
      if (candidateScore.avoidCount !== bestAppliedCandidate.score.avoidCount) {
        if (candidateScore.avoidCount < bestAppliedCandidate.score.avoidCount) {
          bestAppliedCandidate = {
            laneName: candidate.laneName,
            points: candidate.points,
            bundle: candidateBundle,
            summaryMap: candidateSummaryMap,
            findingSummary: candidateFindingSummary,
            crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
            score: candidateScore,
          };
        }
        return;
      }
      if (candidateScore.highCount !== bestAppliedCandidate.score.highCount) {
        if (candidateScore.highCount < bestAppliedCandidate.score.highCount) {
          bestAppliedCandidate = {
            laneName: candidate.laneName,
            points: candidate.points,
            bundle: candidateBundle,
            summaryMap: candidateSummaryMap,
            findingSummary: candidateFindingSummary,
            crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
            score: candidateScore,
          };
        }
        return;
      }
      if (candidateScore.totalCount !== bestAppliedCandidate.score.totalCount) {
        if (candidateScore.totalCount < bestAppliedCandidate.score.totalCount) {
          bestAppliedCandidate = {
            laneName: candidate.laneName,
            points: candidate.points,
            bundle: candidateBundle,
            summaryMap: candidateSummaryMap,
            findingSummary: candidateFindingSummary,
            crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
            score: candidateScore,
          };
        }
        return;
      }
      if (candidateScore.segmentCount < bestAppliedCandidate.score.segmentCount) {
        bestAppliedCandidate = {
          laneName: candidate.laneName,
          points: candidate.points,
          bundle: candidateBundle,
          summaryMap: candidateSummaryMap,
          findingSummary: candidateFindingSummary,
          crossedAvoidRegionIds: candidateCrossedAvoidRegionIds,
          score: candidateScore,
        };
      }
    });

    if (!bestAppliedCandidate) {
      attempts.push({
        ...baseAttempt,
        reason: "candidateDidNotMeetAcceptanceRule",
      });
      exhaustedEdgeIds.add(edge.id);
      continue;
    }

    const updatedEdge = workingEdges.find((item) => item.id === edge.id);
    if (!updatedEdge) {
      attempts.push({
        ...baseAttempt,
        reason: "missingWorkingEdge",
      });
      continue;
    }
    updatedEdge.points = bestAppliedCandidate.points;
    if (edge.branch && Array.isArray(bestAppliedCandidate.points) && bestAppliedCandidate.points.length >= 2) {
      const [p0, p1] = bestAppliedCandidate.points;
      updatedEdge.labelX = Number(((p0[0] + p1[0]) / 2).toFixed(2));
      updatedEdge.labelY = Number(((p0[1] + p1[1]) / 2 - 3).toFixed(2));
    }
    baselineBundle = bestAppliedCandidate.bundle;
    edgeFindingSummaryByEdgeId = bestAppliedCandidate.summaryMap;
    attempts.push({
      ...baseAttempt,
      avoidRegionIdsAfter: bestAppliedCandidate.crossedAvoidRegionIds,
      separationFindingsAfter: Object.keys(bestAppliedCandidate.findingSummary.kindCounts),
      candidateRoutePoints: bestAppliedCandidate.points.map(([x, y]) => [x, y]),
      applied: true,
      reason: bestAppliedCandidate.score.improvesForeignProtected
        ? "reducedAvoidRegionsAndForeignProtectedFindings"
        : "reducedAvoidRegionsWithoutIncreasingHighFindings",
      chosenLane: bestAppliedCandidate.laneName,
    });
    exhaustedEdgeIds.delete(edge.id);
  }

  const beforeCrossedAvoidPlanViolationCount = countCrossedAvoidPlanViolationsForEdges({
    rowsByEdgeId,
    routedEdges,
    protectedRegions,
  });
  const afterCrossedAvoidPlanViolationCount = countCrossedAvoidPlanViolationsForEdges({
    rowsByEdgeId,
    routedEdges: workingEdges,
    protectedRegions,
  });

  return {
    routedEdges: workingEdges,
    debug: {
      enabled: true,
      skippedReason: null,
      attempts,
      appliedCount: attempts.filter((entry) => entry.applied).length,
      beforeEdges: routedEdges,
      beforeAudit: {
        findingCount: initialBaselineBundle.audit.findings.length,
        severityCounts: initialBaselineBundle.audit.severityCounts,
        findingKindCounts: toCountMap(
          (initialBaselineBundle.audit.findings ?? []).map((finding) => finding.kind ?? "unknown"),
        ),
      },
      afterAudit: {
        findingCount: baselineBundle.audit.findings.length,
        severityCounts: baselineBundle.audit.severityCounts,
        findingKindCounts: toCountMap(
          (baselineBundle.audit.findings ?? []).map((finding) => finding.kind ?? "unknown"),
        ),
      },
      auditComparison: buildSeparationAuditComparisonSummary(
        initialBaselineBundle.audit,
        baselineBundle.audit,
      ),
      beforeCrossedAvoidPlanViolationCount,
      afterCrossedAvoidPlanViolationCount,
    },
  };
}

function applyConservativeProtectedRegionAwareRerouting(layoutPlan, routedEdges) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "layoutModeNotGenerated",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
      },
    };
  }
  if (!layoutPlan.genericRegionModel) {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "genericRegionModelMissing",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
      },
    };
  }

  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const protectedRegions = buildProtectedRegionDiagnostics(
    layoutPlan,
    analysis,
    visualRoles,
    nodeLookup,
    layoutPlan.layout,
  );
  const protectedEdgeOwnership = buildEdgeProtectedRegionOwnership({
    routedEdges,
    analysis,
    protectedRegions,
    edgeRoleById,
  });
  const regionById = new Map(protectedRegions.map((region) => [region.id, region]));
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const nodeBoundsById = new Map(
    instructionNodes.map((node) => [node.id, getNodeBounds(node, layoutPlan.layout)]),
  );
  const rerouteAttempts = [];
  const reroutedEdges = routedEdges.map((edge) => {
    const fromNode = layoutPlan.nodeMap.get(edge.from);
    const toNode = layoutPlan.nodeMap.get(edge.to);
    const sourceLabel = Number.isInteger(edge.sourceIndex) ? formatInstructionNodeId(edge.sourceIndex) : edge.from;
    const targetLabel = Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : edge.to;
    const ownership = protectedEdgeOwnership.byEdgeId[edge.id] ?? {
      sourceRegionIds: [],
      targetRegionIds: [],
      ownedRegionIds: [],
      foreignRegionIds: [],
    };
    const allowedRegionIds = new Set([
      ...(ownership.ownedRegionIds ?? []),
      ...(ownership.sourceRegionIds ?? []),
      ...(ownership.targetRegionIds ?? []),
    ]);

    const oldEvaluation = evaluateEdgeHighSeverityViolations({
      edge,
      points: edge.points,
      instructionNodes,
      nodeBoundsById,
      sourceNodeId: fromNode?.id ?? null,
      targetNodeId: toNode?.id ?? null,
      protectedRegions,
      allowedRegionIds,
    });

    const attempt = {
      edgeId: edge.id,
      source: sourceLabel,
      target: targetLabel,
      originalRouteKind: edge.routeKind ?? null,
      avoidedRegionIds: oldEvaluation.foreignRegionIds,
      chosenSideLane: null,
      oldSegmentCount: Math.max((edge.points?.length ?? 1) - 1, 0),
      newSegmentCount: null,
      oldHighFindingCount: oldEvaluation.highCount,
      newHighFindingCount: oldEvaluation.highCount,
      applied: false,
      reason: "noViolation",
    };

    if (!fromNode || !toNode || !Array.isArray(edge.points) || edge.points.length < 2) {
      attempt.reason = "missingNodesOrRoutePoints";
      rerouteAttempts.push(attempt);
      return edge;
    }

    if (oldEvaluation.highCount === 0) {
      rerouteAttempts.push(attempt);
      return edge;
    }

    const intersectingNodeBounds = oldEvaluation.intersectingNodeIds
      .map((nodeId) => nodeBoundsById.get(nodeId))
      .filter(Boolean);
    const foreignRegionBounds = oldEvaluation.foreignRegionIds
      .map((regionId) => regionById.get(regionId)?.bounds)
      .filter(Boolean);
    const obstacleBounds = [...intersectingNodeBounds, ...foreignRegionBounds];
    if (obstacleBounds.length === 0) {
      attempt.reason = "violationsWithoutConcreteObstacles";
      rerouteAttempts.push(attempt);
      return edge;
    }

    const candidates = buildProtectedAwareReroutePoints({
      edge,
      fromNode,
      toNode,
      obstacleBounds,
      layout: layoutPlan.layout,
    });
    let bestCandidate = null;

    candidates.forEach((candidate) => {
      const evaluation = evaluateEdgeHighSeverityViolations({
        edge,
        points: candidate.points,
        instructionNodes,
        nodeBoundsById,
        sourceNodeId: fromNode.id,
        targetNodeId: toNode.id,
        protectedRegions,
        allowedRegionIds,
      });
      const segmentCount = Math.max(candidate.points.length - 1, 0);
      const candidateScore = {
        highCount: evaluation.highCount,
        segmentCount,
      };

      if (!bestCandidate) {
        bestCandidate = {
          ...candidate,
          evaluation,
          score: candidateScore,
        };
        return;
      }

      if (candidateScore.highCount < bestCandidate.score.highCount) {
        bestCandidate = { ...candidate, evaluation, score: candidateScore };
        return;
      }

      if (
        candidateScore.highCount === bestCandidate.score.highCount &&
        candidateScore.segmentCount < bestCandidate.score.segmentCount
      ) {
        bestCandidate = { ...candidate, evaluation, score: candidateScore };
      }
    });

    if (!bestCandidate) {
      attempt.reason = "noCandidateGenerated";
      rerouteAttempts.push(attempt);
      return edge;
    }

    attempt.chosenSideLane = bestCandidate.laneName;
    attempt.newSegmentCount = bestCandidate.score.segmentCount;
    attempt.newHighFindingCount = bestCandidate.score.highCount;

    if (bestCandidate.score.highCount >= oldEvaluation.highCount) {
      attempt.reason = "candidateDidNotReduceHighFindings";
      rerouteAttempts.push(attempt);
      return edge;
    }

    const rerouted = {
      ...edge,
      points: bestCandidate.points,
    };
    if (edge.branch && Array.isArray(bestCandidate.points) && bestCandidate.points.length >= 2) {
      const [p0, p1] = bestCandidate.points;
      rerouted.labelX = Number(((p0[0] + p1[0]) / 2).toFixed(2));
      rerouted.labelY = Number(((p0[1] + p1[1]) / 2 - 3).toFixed(2));
    }

    attempt.applied = true;
    attempt.reason = "rerouteReducedHighFindings";
    rerouteAttempts.push(attempt);
    return rerouted;
  });

  return {
    routedEdges: reroutedEdges,
    debug: {
      enabled: true,
      skippedReason: null,
      attempts: rerouteAttempts,
      appliedCount: rerouteAttempts.filter((entry) => entry.applied).length,
      beforeEdges: routedEdges,
    },
  };
}

function collectCrossedProtectedRegionIds(edgePoints, protectedRegions = []) {
  if (!Array.isArray(edgePoints) || edgePoints.length < 2) return [];

  return protectedRegions
    .filter((region) => {
      for (let index = 1; index < edgePoints.length; index += 1) {
        if (segmentIntersectsRectInterior(edgePoints[index - 1], edgePoints[index], region.bounds, 0.01)) {
          return true;
        }
      }
      return false;
    })
    .map((region) => region.id);
}

function buildOuterContinuationLaneRoute(points, laneX) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(laneX)) {
    return points ?? [];
  }
  const start = points[0];
  const end = points.at(-1);
  return simplifyOrthogonalPoints([
    start,
    [laneX, start[1]],
    [laneX, end[1]],
    end,
  ]);
}

function applyGeneratedOuterContinuationLanePass(layoutPlan, routedEdges) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "layoutModeNotGenerated",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
        beforeAudit: null,
        afterAudit: null,
        auditComparison: null,
      },
    };
  }

  if (!layoutPlan.genericRegionModel) {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "genericRegionModelMissing",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
        beforeAudit: null,
        afterAudit: null,
        auditComparison: null,
      },
    };
  }

  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const protectedRegions = buildProtectedRegionDiagnostics(
    layoutPlan,
    analysis,
    visualRoles,
    nodeLookup,
    layoutPlan.layout,
  );
  const protectedEdgeOwnership = buildEdgeProtectedRegionOwnership({
    routedEdges,
    analysis,
    protectedRegions,
    edgeRoleById,
  });
  const regionById = new Map(protectedRegions.map((region) => [region.id, region]));
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const nodeBoundsById = new Map(
    instructionNodes.map((node) => [node.id, getNodeBounds(node, layoutPlan.layout)]),
  );
  const attempts = [];
  const longSpanThreshold = Math.max(
    layoutPlan.layout.verticalGap * 5,
    layoutPlan.layout.actionNodeHeight * 8,
    220,
  );
  const laneGap = Math.max(
    layoutPlan.layout.loopLaneDistance * 1.35,
    layoutPlan.layout.sideRouteGap * 2,
    28,
  );

  const computeAuditBundle = (candidateEdges) => {
    const candidateLayoutPlan = {
      ...layoutPlan,
      edges: candidateEdges,
    };
    const laneAssignments = buildGenericLaneAssignments(candidateLayoutPlan, edgeRoleById);
    const overlaps = detectPathSegmentOverlaps(
      candidateEdges,
      edgeRoleById,
      laneAssignments.byEdgeId ?? {},
    );
    const audit = buildSeparationAndOverlapAudit({
      layoutPlan: candidateLayoutPlan,
      routedEdges: candidateEdges,
      analysis,
      visualRoles,
      edgeRoleById,
      nodeLookup,
      laneAssignmentsByEdgeId: laneAssignments.byEdgeId ?? {},
      pathSegmentOverlaps: overlaps,
    });
    return { laneAssignments, overlaps, audit };
  };

  let workingEdges = cloneRoutedEdges(routedEdges);

  workingEdges = workingEdges.map((edge) => {
    const edgeRole = edgeRoleById[edge.id] ?? {};
    const sourceLabel = Number.isInteger(edge.sourceIndex) ? formatInstructionNodeId(edge.sourceIndex) : edge.from;
    const targetLabel = Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : edge.to;
    const fromNode = layoutPlan.nodeMap.get(edge.from);
    const toNode = layoutPlan.nodeMap.get(edge.to);
    const ownership = protectedEdgeOwnership.byEdgeId[edge.id] ?? {
      sourceRegionIds: [],
      targetRegionIds: [],
      ownedRegionIds: [],
      foreignRegionIds: [],
    };
    const allowedRegionIds = new Set([
      ...(ownership.ownedRegionIds ?? []),
      ...(ownership.sourceRegionIds ?? []),
      ...(ownership.targetRegionIds ?? []),
    ]);
    const points = Array.isArray(edge.points) ? edge.points : [];
    const verticalSpan = points.length >= 2
      ? Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]))
      : 0;
    const crossedProtectedRegionIds = collectCrossedProtectedRegionIds(points, protectedRegions);
    const foreignRegionIds = collectEdgeForeignRegionIds(points, protectedRegions, allowedRegionIds);
    const hasBaseEligibleRole =
      edgeRole.role === "decisionExit" ||
      edgeRole.role === "continuationEntry" ||
      edgeRole.role === "outerReturn" ||
      edgeRole.flowRole === "continuation" ||
      edgeRole.flowRole === "outerReturn" ||
      edge.routeKind === "farForwardBranch";
    const isForwardIndexEdge = Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex;
    const isConditionalYesEdge = edge.edgeRole === "conditionalYes" || edge.branch === "yes";
    const isForwardFallthroughEdge = edge.type === "fallthrough" && isForwardIndexEdge;
    const isForwardBypassEdge = isForwardIndexEdge &&
      (
        edge.routeKind === "nearbyForwardBranch" ||
        edge.routeKind === "localForwardRejoin" ||
        edge.routeKind === "farForwardBranch"
      );
    const isLongEdge = verticalSpan >= longSpanThreshold;
    const isForwardExit = edgeRole.role === "decisionExit" || edge.routeKind === "farForwardBranch";
    const isContinuation = edgeRole.role === "continuationEntry" || edgeRole.flowRole === "continuation";
    const isOuterReturn = edgeRole.role === "outerReturn" || edgeRole.flowRole === "outerReturn";
    const edgeMinY = points.length >= 2 ? Math.min(...points.map((point) => point[1])) : null;
    const edgeMaxY = points.length >= 2 ? Math.max(...points.map((point) => point[1])) : null;
    const edgeMinX = points.length >= 2 ? Math.min(...points.map((point) => point[0])) : null;
    const edgeMaxX = points.length >= 2 ? Math.max(...points.map((point) => point[0])) : null;
    const spannedProtectedRegionIds = (
      Number.isFinite(edgeMinY) &&
      Number.isFinite(edgeMaxY) &&
      Number.isFinite(edgeMinX) &&
      Number.isFinite(edgeMaxX)
    )
      ? protectedRegions
        .filter((region) => {
          const verticalOverlap = Math.min(edgeMaxY, region.bounds.bottom) - Math.max(edgeMinY, region.bounds.top);
          const horizontalOverlap = Math.min(edgeMaxX, region.bounds.right) - Math.max(edgeMinX, region.bounds.left);
          return verticalOverlap > 0 && horizontalOverlap > -layoutPlan.layout.sideRouteGap;
        })
        .map((region) => region.id)
      : [];
    const relevantProtectedRegionIds = crossedProtectedRegionIds.length > 0
      ? crossedProtectedRegionIds
      : spannedProtectedRegionIds;
    const hasProtectedCrossingOverride = relevantProtectedRegionIds.length >= 2 &&
      (
        isLongEdge ||
        isConditionalYesEdge ||
        isForwardFallthroughEdge ||
        isForwardBypassEdge
      );
    const isEligibleRole = hasBaseEligibleRole || hasProtectedCrossingOverride;

    const attempt = {
      edgeId: edge.id,
      sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      source: sourceLabel,
      target: targetLabel,
      originalRouteKind: edge.routeKind ?? null,
      verticalSpan: Number(verticalSpan.toFixed(2)),
      crossedProtectedRegionIds,
      spannedProtectedRegionIds,
      foreignRegionIds,
      edgeClass: {
        isForwardExit,
        isContinuation,
        isOuterReturn,
      },
      eligibility: {
        hasBaseEligibleRole,
        hasProtectedCrossingOverride,
        isLongEdge,
        isForwardIndexEdge,
        isConditionalYesEdge,
        isForwardFallthroughEdge,
        isForwardBypassEdge,
        relevantProtectedRegionCount: relevantProtectedRegionIds.length,
      },
      chosenOuterLaneX: null,
      chosenOuterLaneSide: null,
      applied: false,
      reason: "notEligibleRole",
      oldHighFindingCount: null,
      newHighFindingCount: null,
      oldForeignRegionCount: foreignRegionIds.length,
      newForeignRegionCount: foreignRegionIds.length,
      oldCrossedProtectedRegionCount: crossedProtectedRegionIds.length,
      newCrossedProtectedRegionCount: crossedProtectedRegionIds.length,
      oldViolationProfile: null,
      candidateViolationProfile: null,
      violationDelta: null,
      rejectionGate: null,
    };

    if (!isEligibleRole) {
      attempts.push(attempt);
      return edge;
    }

    if (!isLongEdge && relevantProtectedRegionIds.length === 0) {
      attempt.reason = "notLongAndNoProtectedSpan";
      attempts.push(attempt);
      return edge;
    }

    if (!fromNode || !toNode || points.length < 2) {
      attempt.reason = "missingNodesOrRoutePoints";
      attempts.push(attempt);
      return edge;
    }

    if (relevantProtectedRegionIds.length === 0) {
      attempt.reason = "noRelevantProtectedRegionSpan";
      attempts.push(attempt);
      return edge;
    }

    const crossedBounds = relevantProtectedRegionIds
      .map((regionId) => regionById.get(regionId)?.bounds)
      .filter(Boolean);
    if (crossedBounds.length === 0) {
      attempt.reason = "crossingWithoutRegionBounds";
      attempts.push(attempt);
      return edge;
    }

    const minLeft = Math.min(...crossedBounds.map((bounds) => bounds.left));
    const maxRight = Math.max(...crossedBounds.map((bounds) => bounds.right));
    const leftLaneX = minLeft - laneGap;
    const rightLaneX = maxRight + laneGap;
    const start = points[0];
    const end = points.at(-1);
    const leftScore = Math.abs(start[0] - leftLaneX) + Math.abs(end[0] - leftLaneX);
    const rightScore = Math.abs(start[0] - rightLaneX) + Math.abs(end[0] - rightLaneX);
    const strongLeftIndicator = isOuterReturn ||
      (start[0] <= minLeft && end[0] <= minLeft) ||
      (leftScore + layoutPlan.layout.sideRouteGap < rightScore);
    const chosenOuterLaneX = strongLeftIndicator ? leftLaneX : rightLaneX;
    const chosenOuterLaneSide = strongLeftIndicator ? "left" : "right";
    const candidatePoints = buildOuterContinuationLaneRoute(points, chosenOuterLaneX);

    const oldEvaluation = evaluateEdgeHighSeverityViolations({
      edge,
      points,
      instructionNodes,
      nodeBoundsById,
      sourceNodeId: fromNode.id,
      targetNodeId: toNode.id,
      protectedRegions,
      allowedRegionIds,
    });
    const newEvaluation = evaluateEdgeHighSeverityViolations({
      edge,
      points: candidatePoints,
      instructionNodes,
      nodeBoundsById,
      sourceNodeId: fromNode.id,
      targetNodeId: toNode.id,
      protectedRegions,
      allowedRegionIds,
    });
    const newForeignRegionIds = collectEdgeForeignRegionIds(candidatePoints, protectedRegions, allowedRegionIds);
    const newCrossedProtectedRegionIds = collectCrossedProtectedRegionIds(candidatePoints, protectedRegions);

    attempt.chosenOuterLaneX = Number(chosenOuterLaneX.toFixed(2));
    attempt.chosenOuterLaneSide = chosenOuterLaneSide;
    attempt.oldHighFindingCount = oldEvaluation.highCount;
    attempt.newHighFindingCount = newEvaluation.highCount;
    attempt.newForeignRegionCount = newForeignRegionIds.size;
    attempt.newCrossedProtectedRegionCount = newCrossedProtectedRegionIds.length;
    attempt.oldViolationProfile = {
      highCount: oldEvaluation.highCount,
      intersectingNodeCount: oldEvaluation.intersectingNodeIds.length,
      foreignRegionCount: oldEvaluation.foreignRegionIds.length,
      crossedProtectedRegionCount: crossedProtectedRegionIds.length,
    };
    attempt.candidateViolationProfile = {
      highCount: newEvaluation.highCount,
      intersectingNodeCount: newEvaluation.intersectingNodeIds.length,
      foreignRegionCount: newForeignRegionIds.size,
      crossedProtectedRegionCount: newCrossedProtectedRegionIds.length,
    };
    attempt.violationDelta = {
      highCount: newEvaluation.highCount - oldEvaluation.highCount,
      intersectingNodeCount: newEvaluation.intersectingNodeIds.length - oldEvaluation.intersectingNodeIds.length,
      foreignRegionCount: newForeignRegionIds.size - oldEvaluation.foreignRegionIds.length,
      crossedProtectedRegionCount: newCrossedProtectedRegionIds.length - crossedProtectedRegionIds.length,
    };

    const reducedForeign = newForeignRegionIds.size < foreignRegionIds.size;
    const reducedCrossedProtected = newCrossedProtectedRegionIds.length < crossedProtectedRegionIds.length;
    const reducedHigh = newEvaluation.highCount < oldEvaluation.highCount;
    const safeNotWorse = newEvaluation.highCount <= oldEvaluation.highCount;
    const requiresOverrideImprovement = !hasBaseEligibleRole && hasProtectedCrossingOverride;

    if (requiresOverrideImprovement && !reducedForeign && !reducedCrossedProtected) {
      attempt.reason = "overrideDidNotReduceProtectedCrossings";
      attempt.rejectionGate = {
        reducedHigh,
        reducedForeign,
        reducedCrossedProtected,
        safeNotWorse,
        trigger: "overrideRequiresProtectedCrossingReduction",
      };
      attempts.push(attempt);
      return edge;
    }

    if (!reducedHigh && !(reducedForeign && safeNotWorse)) {
      attempt.reason = "candidateDidNotImproveViolations";
      attempt.rejectionGate = {
        reducedHigh,
        reducedForeign,
        reducedCrossedProtected,
        safeNotWorse,
        trigger: reducedHigh
          ? null
          : (reducedForeign ? "highIncreased" : "noHighOrForeignReduction"),
      };
      attempts.push(attempt);
      return edge;
    }

    const rerouted = {
      ...edge,
      points: candidatePoints,
    };
    if (edge.branch && candidatePoints.length >= 2) {
      const [p0, p1] = candidatePoints;
      rerouted.labelX = Number(((p0[0] + p1[0]) / 2).toFixed(2));
      rerouted.labelY = Number(((p0[1] + p1[1]) / 2 - 3).toFixed(2));
    }

    attempt.applied = true;
    attempt.reason = reducedHigh
      ? "reducedHighSeverityFindings"
      : "reducedForeignRegionCrossings";
    attempt.rejectionGate = {
      reducedHigh,
      reducedForeign,
      reducedCrossedProtected,
      safeNotWorse,
      trigger: null,
    };
    attempts.push(attempt);
    return rerouted;
  });

  const beforeAuditBundle = computeAuditBundle(routedEdges);
  const afterAuditBundle = computeAuditBundle(workingEdges);
  const auditComparison = buildSeparationAuditComparisonSummary(
    beforeAuditBundle.audit,
    afterAuditBundle.audit,
  );
  const rejectionReasonSummaryByEdgeRole = {};
  const rejectionDeltaSummaryByKind = {
    highCount: {},
    intersectingNodeCount: {},
    foreignRegionCount: {},
    crossedProtectedRegionCount: {},
  };
  attempts.forEach((attempt) => {
    if (attempt.applied) return;
    const roleKey = attempt.originalRouteKind ?? "unknown";
    if (!rejectionReasonSummaryByEdgeRole[roleKey]) {
      rejectionReasonSummaryByEdgeRole[roleKey] = {};
    }
    const reasonKey = attempt.reason ?? "unknown";
    rejectionReasonSummaryByEdgeRole[roleKey][reasonKey] =
      (rejectionReasonSummaryByEdgeRole[roleKey][reasonKey] ?? 0) + 1;
    if (!attempt.violationDelta) return;
    const classifyDelta = (delta) => {
      if (delta < 0) return "improved";
      if (delta > 0) return "worsened";
      return "unchanged";
    };
    Object.entries(attempt.violationDelta).forEach(([kind, delta]) => {
      if (!rejectionDeltaSummaryByKind[kind]) return;
      const bucket = classifyDelta(delta);
      rejectionDeltaSummaryByKind[kind][bucket] =
        (rejectionDeltaSummaryByKind[kind][bucket] ?? 0) + 1;
    });
  });

  return {
    routedEdges: workingEdges,
    debug: {
      enabled: true,
      skippedReason: null,
      attempts,
      appliedCount: attempts.filter((entry) => entry.applied).length,
      beforeEdges: routedEdges,
      beforeAudit: {
        findingCount: beforeAuditBundle.audit.findings.length,
        severityCounts: beforeAuditBundle.audit.severityCounts,
      },
      afterAudit: {
        findingCount: afterAuditBundle.audit.findings.length,
        severityCounts: afterAuditBundle.audit.severityCounts,
      },
      auditComparison,
      rejectionReasonSummaryByEdgeRole,
      rejectionDeltaSummaryByKind,
    },
  };
}

function countEdgeRegionBoxIntersections(points = [], regionBoxes = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let count = 0;
  regionBoxes.forEach((regionBox) => {
    if (
      !regionBox ||
      !Number.isFinite(regionBox.left) ||
      !Number.isFinite(regionBox.right) ||
      !Number.isFinite(regionBox.top) ||
      !Number.isFinite(regionBox.bottom)
    ) {
      return;
    }
    for (let index = 1; index < points.length; index += 1) {
      if (segmentIntersectsRectInterior(points[index - 1], points[index], regionBox, 0.01)) {
        count += 1;
        return;
      }
    }
  });
  return count;
}

function cloneRoutedEdges(routedEdges) {
  return routedEdges.map((edge) => ({
    ...edge,
    points: Array.isArray(edge.points)
      ? edge.points.map(([x, y]) => [x, y])
      : [],
  }));
}

function countSharedCorridorFindings(findings = []) {
  const sharedKinds = new Set([
    "edgeEdgeSharedSegment",
    "unrelatedEdgeCorridorNearShare",
  ]);
  return findings.filter((finding) => sharedKinds.has(finding.kind)).length;
}

function countHighProtectedFindings(findings = []) {
  return findings.filter((finding) => (
    finding.severity === "high" &&
    finding.suggestedFixCategory === "route_around_protected_region"
  )).length;
}

function buildSharedCorridorCandidates(routedEdges, edgeRoleById = {}, epsilon = 3) {
  const segmentsByEdge = routedEdges.map((edge) => ({
    edge,
    segments: buildAxisAlignedSegments(edge),
  }));
  const candidates = [];

  for (let i = 0; i < segmentsByEdge.length; i += 1) {
    for (let j = i + 1; j < segmentsByEdge.length; j += 1) {
      const left = segmentsByEdge[i];
      const right = segmentsByEdge[j];
      if (left.edge.id === right.edge.id) continue;

      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          if (leftSegment.orientation !== rightSegment.orientation) continue;
          if (Math.abs(leftSegment.lineCoord - rightSegment.lineCoord) > epsilon) continue;

          const overlapStart = Math.max(leftSegment.rangeStart, rightSegment.rangeStart);
          const overlapEnd = Math.min(leftSegment.rangeEnd, rightSegment.rangeEnd);
          const overlapLength = overlapEnd - overlapStart;
          if (overlapLength <= 8) continue;

          const sameTarget = left.edge.to === right.edge.to;
          const intentionalMerge = isIntentionalTerminalMergePair(left.edge, right.edge, edgeRoleById);
          if (sameTarget && intentionalMerge) continue;

          candidates.push({
            corridorId: `${leftSegment.orientation}:${Number(((leftSegment.lineCoord + rightSegment.lineCoord) / 2).toFixed(1))}:${Number(overlapStart.toFixed(1))}-${Number(overlapEnd.toFixed(1))}`,
            orientation: leftSegment.orientation,
            overlapLength: Number(overlapLength.toFixed(2)),
            edgeA: left.edge.id,
            edgeB: right.edge.id,
            segmentAIndex: leftSegment.segmentIndex,
            segmentBIndex: rightSegment.segmentIndex,
            sameTarget,
            intentionalMerge,
          });
        }
      }
    }
  }

  return candidates.sort((left, right) => right.overlapLength - left.overlapLength);
}

function applyGeneratedLaneSeparationForSharedCorridors(layoutPlan, routedEdges) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "layoutModeNotGenerated",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
      },
    };
  }
  if (!layoutPlan.genericRegionModel) {
    return {
      routedEdges,
      debug: {
        enabled: false,
        skippedReason: "genericRegionModelMissing",
        attempts: [],
        appliedCount: 0,
        beforeEdges: routedEdges,
      },
    };
  }

  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const laneDelta = Math.max(8, Math.round(layoutPlan.layout.sideRouteGap * 0.6));
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const maxAttempts = 24;
  const attempts = [];
  let workingEdges = cloneRoutedEdges(routedEdges);

  const computeAuditBundle = (candidateEdges) => {
    const candidateLayoutPlan = {
      ...layoutPlan,
      edges: candidateEdges,
    };
    const laneAssignments = buildGenericLaneAssignments(candidateLayoutPlan, edgeRoleById);
    const overlaps = detectPathSegmentOverlaps(
      candidateEdges,
      edgeRoleById,
      laneAssignments.byEdgeId ?? {},
    );
    const audit = buildSeparationAndOverlapAudit({
      layoutPlan: candidateLayoutPlan,
      routedEdges: candidateEdges,
      analysis,
      visualRoles,
      edgeRoleById,
      nodeLookup,
      laneAssignmentsByEdgeId: laneAssignments.byEdgeId ?? {},
      pathSegmentOverlaps: overlaps,
    });
    return { laneAssignments, overlaps, audit };
  };

  let baselineBundle = computeAuditBundle(workingEdges);

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const candidates = buildSharedCorridorCandidates(
      workingEdges,
      edgeRoleById,
      3,
    );
    if (candidates.length === 0) break;

    const chosen = candidates[0];
    const edgeA = workingEdges.find((edge) => edge.id === chosen.edgeA) ?? null;
    const edgeB = workingEdges.find((edge) => edge.id === chosen.edgeB) ?? null;
    if (!edgeA || !edgeB) break;

    const priorityA = getGenericEdgeNudgePriority(edgeA, analysis, layoutPlan.genericRegionModel);
    const priorityB = getGenericEdgeNudgePriority(edgeB, analysis, layoutPlan.genericRegionModel);
    let targetEdge = null;
    let targetSegmentIndex = null;
    if (compareNudgePriority(priorityA, priorityB) >= 0 && priorityA) {
      targetEdge = edgeA;
      targetSegmentIndex = chosen.segmentAIndex;
    } else if (priorityB) {
      targetEdge = edgeB;
      targetSegmentIndex = chosen.segmentBIndex;
    }

    const attempt = {
      layoutMode: layoutPlan.layoutMode ?? "unknown",
      corridorId: chosen.corridorId,
      involvedEdgeIds: [chosen.edgeA, chosen.edgeB],
      shareSameTarget: chosen.sameTarget,
      assignedLaneOffsets: {},
      beforeFindingCounts: {
        sharedCorridor: countSharedCorridorFindings(baselineBundle.audit.findings),
        highProtected: countHighProtectedFindings(baselineBundle.audit.findings),
      },
      afterFindingCounts: null,
      applied: false,
      reason: "noEligibleTargetEdge",
    };

    if (!targetEdge || !Number.isInteger(targetSegmentIndex)) {
      attempts.push(attempt);
      continue;
    }

    const deltaSign = attemptIndex % 2 === 0 ? 1 : -1;
    const offsetDelta = laneDelta * deltaSign;
    const candidateEdges = cloneRoutedEdges(workingEdges);
    const candidateTargetEdge = candidateEdges.find((edge) => edge.id === targetEdge.id);
    if (!candidateTargetEdge) {
      attempt.reason = "missingCandidateTargetEdge";
      attempts.push(attempt);
      continue;
    }

    candidateTargetEdge.points = applyOrthogonalSegmentNudge(
      candidateTargetEdge.points,
      targetSegmentIndex,
      chosen.orientation,
      offsetDelta,
    );
    candidateTargetEdge.points = simplifyOrthogonalPoints(candidateTargetEdge.points);
    attempt.assignedLaneOffsets = {
      [targetEdge.id]: offsetDelta,
    };

    const candidateBundle = computeAuditBundle(candidateEdges);
    const afterCounts = {
      sharedCorridor: countSharedCorridorFindings(candidateBundle.audit.findings),
      highProtected: countHighProtectedFindings(candidateBundle.audit.findings),
    };
    attempt.afterFindingCounts = afterCounts;

    const reducesSharedCorridor = afterCounts.sharedCorridor < attempt.beforeFindingCounts.sharedCorridor;
    const doesNotIncreaseHighProtected = afterCounts.highProtected <= attempt.beforeFindingCounts.highProtected;
    const shouldApply = reducesSharedCorridor || doesNotIncreaseHighProtected;

    if (!shouldApply) {
      attempt.reason = "guardRejectedNoAuditImprovement";
      attempts.push(attempt);
      continue;
    }

    workingEdges = candidateEdges;
    baselineBundle = candidateBundle;
    attempt.applied = true;
    attempt.reason = reducesSharedCorridor
      ? "reducedSharedCorridorFindings"
      : "didNotIncreaseHighProtectedFindings";
    attempts.push(attempt);
  }

  return {
    routedEdges: workingEdges,
    debug: {
      enabled: true,
      skippedReason: null,
      attempts,
      appliedCount: attempts.filter((entry) => entry.applied).length,
      beforeEdges: routedEdges,
    },
  };
}

function routeFlowEdges(layoutPlan) {
  if (layoutPlan.layoutMode === "sketchV3") {
    const routedEdges = layoutPlan.edges
      .map((edge) => {
        const from = layoutPlan.nodeMap.get(edge.from);
        const to = layoutPlan.nodeMap.get(edge.to);
        if (!from || !to) return null;
        return routeSketchV3Edge(edge, from, to, layoutPlan.layout);
      })
      .filter(Boolean);
    return measureLayoutPlan(layoutPlan, routedEdges);
  }

  const finalizeWithGeneratedPasses = (plan, initialEdges) => {
    const outerContinuationLanePass = applyGeneratedOuterContinuationLanePass(
      plan,
      initialEdges,
    );
    const regionPlanProtectedReroute = applyGeneratedRegionPlanProtectedReroute(
      {
        ...plan,
        generatedOuterContinuationLaneDebug: outerContinuationLanePass.debug,
      },
      outerContinuationLanePass.routedEdges,
    );
    const reroute = applyConservativeProtectedRegionAwareRerouting(
      {
        ...plan,
        generatedOuterContinuationLaneDebug: outerContinuationLanePass.debug,
        generatedRegionPlanProtectedRerouteDebug: regionPlanProtectedReroute.debug,
      },
      regionPlanProtectedReroute.routedEdges,
    );
    const laneSeparation = applyGeneratedLaneSeparationForSharedCorridors(
      {
        ...plan,
        generatedOuterContinuationLaneDebug: outerContinuationLanePass.debug,
        generatedRegionPlanProtectedRerouteDebug: regionPlanProtectedReroute.debug,
        protectedRegionAwareRerouteDebug: reroute.debug,
      },
      reroute.routedEdges,
    );

    return measureLayoutPlan(
      {
        ...plan,
        generatedOuterContinuationLaneDebug: outerContinuationLanePass.debug,
        generatedRegionPlanProtectedRerouteDebug: regionPlanProtectedReroute.debug,
        protectedRegionAwareRerouteDebug: reroute.debug,
        generatedLaneSeparationDebug: laneSeparation.debug,
      },
      laneSeparation.routedEdges,
    );
  };

  if (layoutPlan.motif.kind === "predecessorLoop") {
    return finalizeWithGeneratedPasses(layoutPlan, routePredecessorEdges(layoutPlan));
  }

  if (layoutPlan.motif.kind === "minimizationFlow") {
    return finalizeWithGeneratedPasses(layoutPlan, routeMinimizationFlowEdges(layoutPlan));
  }

  if (layoutPlan.motif.kind === "singleLoop") {
    return finalizeWithGeneratedPasses(layoutPlan, routeSingleLoopEdges(layoutPlan));
  }

  if (layoutPlan.motif.kind === "nestedLoop" || layoutPlan.motif.kind === "embeddedNestedLoop") {
    return finalizeWithGeneratedPasses(layoutPlan, routeNestedLoopEdges(layoutPlan));
  }

  if (layoutPlan.motif.kind === "genericEmbeddedNestedLoopBlocks") {
    const routedEdges = routeGenericEmbeddedNestedLoopBlockEdges(layoutPlan);
    return finalizeWithGeneratedPasses(layoutPlan, routedEdges);
  }

  if (layoutPlan.motif.kind === "genericInstructionFallback") {
    const routedEdges = layoutPlan.edges
      .map((edge) => {
        const from = layoutPlan.nodeMap.get(edge.from);
        const to = layoutPlan.nodeMap.get(edge.to);
        if (!from || !to) return null;

        return routeEdgeWithGenericRegionGrammar(
          edge,
          from,
          to,
          layoutPlan.layout,
          layoutPlan.analysis,
          layoutPlan.nodeMap,
          layoutPlan.genericRegionModel ?? null,
        );
      })
      .filter(Boolean);
    return finalizeWithGeneratedPasses(layoutPlan, routedEdges);
  }

  const routedEdges = buildRoutedEdges(
    layoutPlan.edges,
    layoutPlan.nodeMap,
    layoutPlan.layout,
    layoutPlan.analysis,
  );

  return finalizeWithGeneratedPasses(layoutPlan, routedEdges);
}

function isTruncatedSubtractionKind(selectedFunctionId) {
  const normalizedFunctionId = String(selectedFunctionId ?? "").toLowerCase();
  return (
    normalizedFunctionId.includes("bounded_sub") ||
    normalizedFunctionId.includes("truncated_sub") ||
    normalizedFunctionId.includes("truncated_subtraction") ||
    normalizedFunctionId === "sub"
  );
}

function buildDiagramModelUnsafe(program, selectedFunctionId, options = {}, layout = TEXTBOOK_LAYOUT) {
  const layoutMode = options.layoutMode ?? "tuned";
  const normalizedLayoutMode = layoutMode === "generatedAlgorithm" ? "generated" : layoutMode;
  const isGeneratedLikeLayoutMode =
    normalizedLayoutMode === "generated" ||
    normalizedLayoutMode === "generatedScanV2" ||
    normalizedLayoutMode === "sketchV1" ||
    normalizedLayoutMode === "sketchV3";
  const useGeneratedAlgorithmLayout = isGeneratedLikeLayoutMode;
  const _pt = typeof performance !== "undefined" ? performance : null;
  const _t0 = _pt?.now() ?? 0;
  const baseAnalysis = analyzeProgramFlow(program, layout);
  const _t1 = _pt?.now() ?? 0;
  const detectedMotif = detectFlowMotif(baseAnalysis, selectedFunctionId);
  const debugIdentity = createBetaFlowDebugIdentity({
    selectedExampleName: options.selectedExampleName ?? selectedFunctionId,
    layoutMode: normalizedLayoutMode,
    motifHint: detectedMotif.kind,
    program,
    nodeRoles: baseAnalysis.nodeRoles,
    hasTunedLayout: options.debugLayoutMetadata?.hasTunedLayout ?? null,
    layoutStatus: options.debugLayoutMetadata?.layoutStatus ?? null,
  });
  const visualRoles = classifyVisualRoles(baseAnalysis, baseAnalysis.program, detectedMotif);
  const _t2 = _pt?.now() ?? 0;
  const analysis = {
    ...baseAnalysis,
    visualRoles,
    layoutMode: normalizedLayoutMode,
    debugIdentity,
  };

  if (ENABLE_VISUAL_ROLE_DEBUG || isBetaFlowAuditDebugEnabled()) {
    emitVisualRoleDebugReport(analysis, selectedFunctionId);
  }

  const keepNestedLoopUncollapsed =
    detectedMotif.kind === "nestedLoop" &&
    isTruncatedSubtractionKind(selectedFunctionId);
  const canUseEmbeddedNestedLoopWithCollapse =
    detectedMotif.kind === "nestedLoop" &&
    Boolean(detectEmbeddedNestedLoopRegionLayout(analysis, detectedMotif));
  let motifForLayout;
  if (useGeneratedAlgorithmLayout) {
    motifForLayout = {
      kind: "genericInstructionFallback",
      primaryLoop: detectedMotif.primaryLoop ?? baseAnalysis.loopMotifs[0] ?? null,
      comparisonMode: "generated",
      sourceMotifKind: detectedMotif.kind,
    };
  } else {
    motifForLayout =
      options.collapseSetupBlocks &&
      detectedMotif.kind === "nestedLoop" &&
      !canUseEmbeddedNestedLoopWithCollapse &&
      !keepNestedLoopUncollapsed
        ? {
            kind: "genericInstructionFallback",
            primaryLoop: detectedMotif.primaryLoop ?? baseAnalysis.loopMotifs[0] ?? null,
          }
        : detectedMotif;
  }

  const layoutPlan = buildLayoutPlan(analysis, motifForLayout, layout, {
    collapseSetupBlocks:
      options.collapseSetupBlocks &&
      !keepNestedLoopUncollapsed,
  });
  const _t3 = _pt?.now() ?? 0;
  if (normalizedLayoutMode === "sketchV3") {
    const sketchV3Placement = applySketchV3LayoutWithAutomaticRepair({
      ...layoutPlan,
      layoutMode: normalizedLayoutMode,
      sketchV3DiagnosticsRequested: isSketchV3DiagnosticsRequested(),
    });
    const _t4 = _pt?.now() ?? 0;
    const routed = routeFlowEdges({
      ...sketchV3Placement.layoutPlan,
      layoutMode: normalizedLayoutMode,
      sketchV3PlacementDebug: sketchV3Placement.diagnostics,
    });
    const _t5 = _pt?.now() ?? 0;
    if (typeof window !== "undefined" && _pt) {
      const perfLog = window.__betaFlowPerfLog ?? [];
      perfLog.push({
        type: "phases",
        layoutMode: "sketchV3",
        n: program.length,
        analyzeProgramFlow: _t1 - _t0,
        classifyVisualRoles: _t2 - _t1,
        buildLayoutPlan: _t3 - _t2,
        applySketchV3Layout: _t4 - _t3,
        routeFlowEdges: _t5 - _t4,
        total: _t5 - _t0,
      });
      // Keep only the most recent entries so repeated selections cannot grow this unbounded.
      if (perfLog.length > MAX_BETA_FLOW_PERF_LOG_ENTRIES) {
        perfLog.splice(0, perfLog.length - MAX_BETA_FLOW_PERF_LOG_ENTRIES);
      }
      window.__betaFlowPerfLog = perfLog;
    }
    return routed;
  }

  const sketchV1Placement = applySketchV1Layout(
    {
      ...layoutPlan,
      layoutMode: normalizedLayoutMode,
    },
    {
      getNodeSize,
      includeVerboseDiagnostics: isBetaFlowAuditDebugEnabled(),
    },
  );
  const activeLayoutPlan = sketchV1Placement.layoutPlan;
  const generatedLocalSideChainPlacementDebug = applyGeneratedLocalSideChainPlacement({
    ...activeLayoutPlan,
    layoutMode: normalizedLayoutMode,
  });
  const generatedRegionEdgePlanDebug = buildGeneratedRegionEdgePlan({
    ...activeLayoutPlan,
    layoutMode: normalizedLayoutMode,
  });

  return routeFlowEdges({
    ...activeLayoutPlan,
    layoutMode: normalizedLayoutMode,
    sketchV1PlacementDebug: sketchV1Placement.diagnostics,
    generatedLocalSideChainPlacementDebug,
    generatedRegionEdgePlanDebug,
  });
}

function getInvalidDiagramGeometryReason(layoutPlan) {
  if (!layoutPlan || typeof layoutPlan !== "object") return "layoutPlanUnavailable";
  if (!Array.isArray(layoutPlan.nodes) || layoutPlan.nodes.length === 0) return "nodesUnavailable";
  if (!Array.isArray(layoutPlan.edges)) return "edgesUnavailable";
  if (!Number.isFinite(layoutPlan.width) || layoutPlan.width <= 0) return "invalidCanvasWidth";
  if (!Number.isFinite(layoutPlan.height) || layoutPlan.height <= 0) return "invalidCanvasHeight";
  if (!Number.isFinite(layoutPlan.offsetX) || !Number.isFinite(layoutPlan.offsetY)) {
    return "invalidCanvasOffset";
  }

  const invalidNode = layoutPlan.nodes.find((node) => (
    !Number.isFinite(node?.x) || !Number.isFinite(node?.y)
  ));
  if (invalidNode) return `invalidNodeCoordinates:${invalidNode.id ?? "unknown"}`;

  const invalidEdge = layoutPlan.edges.find((edge) => (
    !Array.isArray(edge?.points) ||
    edge.points.length < 2 ||
    edge.points.some((point) => (
      !Array.isArray(point) ||
      point.length < 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ))
  ));
  if (invalidEdge) return `invalidEdgePoints:${invalidEdge.id ?? "unknown"}`;

  return null;
}

function buildDiagramModel(program, selectedFunctionId, options = {}, layout = TEXTBOOK_LAYOUT) {
  const requestedLayoutMode = options.layoutMode === "generatedAlgorithm"
    ? "generated"
    : (options.layoutMode ?? "tuned");
  if (requestedLayoutMode === "sketchV3") {
    try {
      const layoutPlan = buildDiagramModelUnsafe(program, selectedFunctionId, options, layout);
      const invalidGeometryReason = getInvalidDiagramGeometryReason(layoutPlan);
      if (invalidGeometryReason) {
        throw new Error(invalidGeometryReason);
      }
      return {
        ...layoutPlan,
        sketchV3FallbackUsed: false,
        sketchV3FallbackReason: null,
      };
    } catch (error) {
      const sketchV3FallbackReason = String(error?.message ?? error ?? "unknownError");
      const sketchV3FallbackDiagnostics = error?.sketchV3FallbackDiagnostics ?? null;
      console.warn(
        "[beta-flow] sketchV3 placement failed; using legacy generated layout for this render.",
        {
          sketchV3FallbackUsed: true,
          sketchV3FallbackReason,
          sketchV3FallbackDiagnostics,
          selectedFunctionId,
        },
      );
      const fallbackPlan = buildDiagramModelUnsafe(
        program,
        selectedFunctionId,
        { ...options, layoutMode: "generated" },
        layout,
      );
      const fallbackDebugIdentity = fallbackPlan.analysis?.debugIdentity ?? null;
      const sketchV3DebugIdentity = fallbackDebugIdentity
        ? {
            ...fallbackDebugIdentity,
            layoutMode: "sketchV3",
            effectiveGeneratedLayoutMode: "sketchV3",
            generatedStrategy: "sketchV3",
          }
        : fallbackDebugIdentity;

      return {
        ...fallbackPlan,
        layoutMode: "sketchV3",
        analysis: {
          ...fallbackPlan.analysis,
          layoutMode: "sketchV3",
          debugIdentity: sketchV3DebugIdentity,
        },
        sketchV3FallbackUsed: true,
        sketchV3FallbackReason,
        sketchV3FallbackDiagnostics,
      };
    }
  }
  if (requestedLayoutMode === "sketchV1") {
    try {
      const layoutPlan = buildDiagramModelUnsafe(program, selectedFunctionId, options, layout);
      const invalidGeometryReason = getInvalidDiagramGeometryReason(layoutPlan);
      if (invalidGeometryReason) {
        throw new Error(invalidGeometryReason);
      }
      return {
        ...layoutPlan,
        sketchV1FallbackUsed: false,
        sketchV1FallbackReason: null,
      };
    } catch (error) {
      const sketchV1FallbackReason = String(error?.message ?? error ?? "unknownError");
      const sketchV1FallbackDiagnostics = error?.sketchV1FallbackDiagnostics ?? null;
      console.warn(
        "[beta-flow] sketchV1 placement failed; using legacy generated layout for this render.",
        {
          sketchV1FallbackUsed: true,
          sketchV1FallbackReason,
          sketchV1FallbackDiagnostics,
          selectedFunctionId,
        },
      );
      return {
        ...buildDiagramModelUnsafe(
          program,
          selectedFunctionId,
          { ...options, layoutMode: "generated" },
          layout,
        ),
        sketchV1FallbackUsed: true,
        sketchV1FallbackReason,
        sketchV1FallbackDiagnostics,
      };
    }
  }
  return buildDiagramModelUnsafe(program, selectedFunctionId, options, layout);
}

function pointsToString(points, offsetX, offsetY) {
  const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
  const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
  return (Array.isArray(points) ? points : [])
    .filter((point) => (
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    ))
    .map(([x, y]) => `${x + safeOffsetX},${y + safeOffsetY}`)
    .join(" ");
}

function safeSvgCoordinate(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function getVisibleInstructionCount(layoutPlan) {
  if (Array.isArray(layoutPlan.displayNodes) && layoutPlan.displayNodes.length > 0) {
    return layoutPlan.displayNodes.length;
  }

  return layoutPlan.nodes.filter((node) => node.id.startsWith("i-")).length;
}

function computeGraphRenderScale(layoutPlan) {
  const visibleInstructionCount = getVisibleInstructionCount(layoutPlan);
  const canvasHeight = Number.isFinite(layoutPlan.height) && layoutPlan.height > 0
    ? layoutPlan.height
    : MAX_COMFORTABLE_GRAPH_HEIGHT;
  const canvasWidth = Number.isFinite(layoutPlan.width) && layoutPlan.width > 0
    ? layoutPlan.width
    : MAX_COMFORTABLE_GRAPH_WIDTH;
  const heightScale = canvasHeight > MAX_COMFORTABLE_GRAPH_HEIGHT
    ? MAX_COMFORTABLE_GRAPH_HEIGHT / canvasHeight
    : 1;
  const widthScale = canvasWidth > MAX_COMFORTABLE_GRAPH_WIDTH
    ? MAX_COMFORTABLE_GRAPH_WIDTH / canvasWidth
    : 1;
  const instructionScale = visibleInstructionCount > GRAPH_SCALE_NODE_THRESHOLD
    ? Math.sqrt(GRAPH_SCALE_NODE_THRESHOLD / visibleInstructionCount)
    : 1;

  return Math.max(
    MIN_GRAPH_SCALE,
    Math.min(1, heightScale, widthScale, instructionScale),
  );
}

function getInstructionNodeLookup(layoutPlan) {
  const map = new Map();

  layoutPlan.nodes.forEach((node) => {
    if (!Array.isArray(node.instructionIndices)) return;
    node.instructionIndices.forEach((index) => {
      if (Number.isInteger(index) && !map.has(index)) {
        map.set(index, node);
      }
    });
  });

  return map;
}

function getEdgeBendCount(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;

  const directions = [];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    if (Math.abs(dx) < 0.01) directions.push("v");
    else if (Math.abs(dy) < 0.01) directions.push("h");
    else directions.push("d");
  }

  let bends = 0;
  for (let i = 1; i < directions.length; i += 1) {
    if (directions[i] !== directions[i - 1]) bends += 1;
  }

  return bends;
}

function getEdgeFirstDirection(edge) {
  if (!Array.isArray(edge.points) || edge.points.length < 2) return "none";
  const [x0, y0] = edge.points[0];
  const [x1, y1] = edge.points[1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > 0.01) return dy > 0 ? "down" : "up";
  return "none";
}

function getPolylineLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    length += Math.hypot(x1 - x0, y1 - y0);
  }

  return length;
}

function buildAxisAlignedSegments(edge, epsilon = 0.01) {
  if (!Array.isArray(edge?.points) || edge.points.length < 2) return [];

  const segments = [];

  for (let index = 1; index < edge.points.length; index += 1) {
    const [x0, y0] = edge.points[index - 1];
    const [x1, y1] = edge.points[index];
    const dx = x1 - x0;
    const dy = y1 - y0;

    if (Math.abs(dx) <= epsilon && Math.abs(dy) <= epsilon) continue;

    if (Math.abs(dy) <= epsilon) {
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      if (maxX - minX <= epsilon) continue;
      segments.push({
        edgeId: edge.id,
        edge,
        segmentIndex: index - 1,
        orientation: "horizontal",
        lineCoord: (y0 + y1) / 2,
        rangeStart: minX,
        rangeEnd: maxX,
        p0: [x0, y0],
        p1: [x1, y1],
      });
      continue;
    }

    if (Math.abs(dx) <= epsilon) {
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);
      if (maxY - minY <= epsilon) continue;
      segments.push({
        edgeId: edge.id,
        edge,
        segmentIndex: index - 1,
        orientation: "vertical",
        lineCoord: (x0 + x1) / 2,
        rangeStart: minY,
        rangeEnd: maxY,
        p0: [x0, y0],
        p1: [x1, y1],
      });
    }
  }

  return segments;
}

function findCollinearOverlapInterval(segmentA, segmentB, epsilon = 0.5) {
  if (segmentA.orientation !== segmentB.orientation) return null;
  if (Math.abs(segmentA.lineCoord - segmentB.lineCoord) > epsilon) return null;

  const start = Math.max(segmentA.rangeStart, segmentB.rangeStart);
  const end = Math.min(segmentA.rangeEnd, segmentB.rangeEnd);

  if (end - start <= epsilon) return null;

  return { start, end };
}

function isLikelyHaltNodeId(nodeId) {
  return typeof nodeId === "string" && nodeId.toLowerCase().includes("halt");
}

function isIntentionalTerminalMergePair(edgeA, edgeB, edgeRoleById = {}) {
  const explicitSharedTerminalRouteKinds = new Set([
    "embeddedTailSharedHaltDecision",
    "embeddedTailSharedHaltFinal",
  ]);
  const edgeAKind = edgeA?.routeKind ?? null;
  const edgeBKind = edgeB?.routeKind ?? null;
  const bothExplicitShared = explicitSharedTerminalRouteKinds.has(edgeAKind) &&
    explicitSharedTerminalRouteKinds.has(edgeBKind);

  if (bothExplicitShared) return true;

  const edgeARole = edgeRoleById?.[edgeA.id]?.role;
  const edgeBRole = edgeRoleById?.[edgeB.id]?.role;
  const edgeATerminal = edgeARole === "haltExit" || edgeAKind === "earlyExitToHalt";
  const edgeBTerminal = edgeBRole === "haltExit" || edgeBKind === "earlyExitToHalt";
  const sameHaltTarget = isLikelyHaltNodeId(edgeA?.to) &&
    edgeA?.to === edgeB?.to;

  return Boolean(edgeATerminal && edgeBTerminal && sameHaltTarget);
}

function findProtectedIntervalForIndex(protectedIntervals = [], index) {
  if (!Number.isInteger(index)) return null;
  return protectedIntervals.find(
    (interval) => interval.startIndex <= index && index <= interval.endIndex,
  ) ?? null;
}

function describeEdgeScope(index, genericRegionModel) {
  if (!genericRegionModel) return "n/a";
  if (!Number.isInteger(index)) return "synthetic";

  const protectedInterval = findProtectedIntervalForIndex(
    genericRegionModel.protectedIntervals,
    index,
  );
  if (protectedInterval) {
    return `protected:${formatInstructionNodeId(protectedInterval.startIndex)}-${formatInstructionNodeId(protectedInterval.endIndex)}`;
  }

  const attachedSideRegion = (genericRegionModel.attachedSideRegions ?? []).find(
    (region) => region.startIndex <= index && index <= region.endIndex,
  );
  if (attachedSideRegion) {
    return `attachedSide:${formatInstructionNodeId(attachedSideRegion.startIndex)}-${formatInstructionNodeId(attachedSideRegion.endIndex)}`;
  }

  const genericRegionId = genericRegionModel.genericRegionIdByIndex.get(index);
  if (Number.isInteger(genericRegionId)) {
    const region = genericRegionModel.genericRegions?.[genericRegionId];
    if (region) {
      return `generic:${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`;
    }
    return `genericRegion:${genericRegionId}`;
  }

  return "outsideGenericRegions";
}

function buildRegionLookupForPlan(protectedRegions = []) {
  const protectedRegionById = new Map((protectedRegions ?? []).map((region) => [region.id, region]));
  const protectedRegionIds = new Set(protectedRegionById.keys());
  const regionsByIndex = new Map();

  (protectedRegions ?? []).forEach((region) => {
    const indexes = Array.isArray(region.memberIndexes)
      ? region.memberIndexes
      : [];
    indexes.forEach((index) => {
      if (!Number.isInteger(index)) return;
      if (!regionsByIndex.has(index)) regionsByIndex.set(index, []);
      regionsByIndex.get(index).push(region);
    });
  });

  const getMostSpecificRegionForIndex = (index) => {
    if (!Number.isInteger(index)) return null;
    const candidates = regionsByIndex.get(index) ?? [];
    if (candidates.length === 0) return null;
    return [...candidates].sort((left, right) => {
      const leftSpan = Number.isInteger(left.startIndex) && Number.isInteger(left.endIndex)
        ? left.endIndex - left.startIndex
        : Number.POSITIVE_INFINITY;
      const rightSpan = Number.isInteger(right.startIndex) && Number.isInteger(right.endIndex)
        ? right.endIndex - right.startIndex
        : Number.POSITIVE_INFINITY;
      return leftSpan - rightSpan;
    })[0] ?? null;
  };

  return {
    protectedRegionById,
    protectedRegionIds,
    regionsByIndex,
    getMostSpecificRegionForIndex,
  };
}

function classifyRegionPlanEdgeClass({
  edge,
  analysis,
  sourceRegion,
  targetRegion,
  incomingEdgeCountByTarget,
  edgeRole,
}) {
  if (isHaltExitEdge(edge, analysis.program.length) || isLikelyHaltNodeId(edge.to)) {
    return "halt/terminal exit";
  }

  const sourceIndex = edge.sourceIndex;
  const targetIndex = edge.targetIndex;
  const sourceRole = Number.isInteger(sourceIndex) ? analysis.nodeRoles[sourceIndex] : null;
  const isBackward = Number.isInteger(sourceIndex) && Number.isInteger(targetIndex) && targetIndex < sourceIndex;
  const isForward = Number.isInteger(sourceIndex) && Number.isInteger(targetIndex) && targetIndex > sourceIndex;
  const sameRegion = sourceRegion?.id && sourceRegion.id === targetRegion?.id;

  if (isBackward || edgeRole === "localReturn" || edgeRole === "outerReturn") {
    return "loop return";
  }

  if (edge.type === "fallthrough" && Number.isInteger(sourceIndex) && Number.isInteger(targetIndex)) {
    if (targetIndex === sourceIndex + 1 && sameRegion) {
      return "local fallthrough";
    }
    if (targetIndex === sourceIndex + 1) {
      return "inter-region transfer";
    }
  }

  const sourceLoopRegion = sourceRegion?.kind === "loopRegion" ? sourceRegion : null;
  if (
    isForward &&
    sourceLoopRegion &&
    (!targetRegion || targetRegion.id !== sourceLoopRegion.id)
  ) {
    return "loop exit";
  }

  if (edgeRole === "continuationEntry" || edgeRole === "decisionExit") {
    return "outer continuation";
  }

  if (
    isForward &&
    sourceRole === "conditionalJump" &&
    targetIndex > sourceIndex + 1
  ) {
    const incomingCount = incomingEdgeCountByTarget.get(targetIndex) ?? 0;
    if (incomingCount > 1) return "branch rejoin";
    return "local branch";
  }

  if (
    isForward &&
    sourceRole === "conditionalJump" &&
    targetIndex === sourceIndex + 1
  ) {
    return "local branch";
  }

  if (isForward && sourceRegion?.id && targetRegion?.id && sourceRegion.id !== targetRegion.id) {
    return "inter-region transfer";
  }

  if (isForward && edge.type === "jump") {
    return "outer continuation";
  }

  return "inter-region transfer";
}

function getPreferredSidesForRegionPlanEdge(edgeClass, edge, sourceNode, targetNode) {
  const sourceX = Number.isFinite(sourceNode?.x) ? sourceNode.x : 0;
  const targetX = Number.isFinite(targetNode?.x) ? targetNode.x : 0;
  const targetAtOrRight = targetX >= sourceX;

  if (edgeClass === "local fallthrough") {
    return { exit: "bottom", entry: "top" };
  }
  if (edgeClass === "loop return") {
    return { exit: "left", entry: "left" };
  }
  if (edgeClass === "loop exit") {
    return {
      exit: edge.branch === "no" ? "left" : "right",
      entry: "top",
    };
  }
  if (edgeClass === "outer continuation") {
    return {
      exit: edge.branch === "no" ? "left" : "right",
      entry: targetAtOrRight ? "left" : "right",
    };
  }
  if (edgeClass === "halt/terminal exit") {
    return { exit: "right", entry: "left" };
  }
  if (edgeClass === "branch rejoin" || edgeClass === "local branch") {
    return {
      exit: edge.branch === "no" ? "left" : "right",
      entry: "top",
    };
  }

  return {
    exit: targetAtOrRight ? "right" : "left",
    entry: "top",
  };
}

function getPreferredLaneGroupForRegionPlanEdge(edgeClass) {
  if (edgeClass === "local fallthrough") return "local";
  if (edgeClass === "local branch" || edgeClass === "branch rejoin") return "branch-owned";
  if (edgeClass === "loop return" || edgeClass === "loop exit") return "loop-owned";
  if (edgeClass === "outer continuation" || edgeClass === "inter-region transfer") return "outer-continuation";
  if (edgeClass === "halt/terminal exit") return "halt-exit";
  return "outer-continuation";
}

function buildGeneratedRegionEdgePlan(layoutPlan) {
  if (layoutPlan.layoutMode !== "generated") {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGenerated",
      rows: [],
      summary: {
        totalPlannedEdges: 0,
        edgesWithOwnerRegion: 0,
        edgesMissingOwnerRegion: 0,
      },
      protectedRegions: [],
    };
  }

  if (!layoutPlan.genericRegionModel) {
    return {
      enabled: false,
      skippedReason: "genericRegionModelMissing",
      rows: [],
      summary: {
        totalPlannedEdges: 0,
        edgesWithOwnerRegion: 0,
        edgesMissingOwnerRegion: 0,
      },
      protectedRegions: [],
    };
  }

  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const protectedRegions = buildProtectedRegionDiagnostics(
    layoutPlan,
    analysis,
    visualRoles,
    nodeLookup,
    layoutPlan.layout,
  );
  const regionLookup = buildRegionLookupForPlan(protectedRegions);
  const incomingEdgeCountByTarget = new Map();
  analysis.edges.forEach((edge) => {
    if (!Number.isInteger(edge.targetIndex)) return;
    incomingEdgeCountByTarget.set(
      edge.targetIndex,
      (incomingEdgeCountByTarget.get(edge.targetIndex) ?? 0) + 1,
    );
  });

  const rows = layoutPlan.edges.map((edge) => {
    const sourceRegion = regionLookup.getMostSpecificRegionForIndex(edge.sourceIndex);
    const targetRegion = regionLookup.getMostSpecificRegionForIndex(edge.targetIndex);
    const edgeRole = edgeRoleById[edge.id]?.role ?? null;
    const sourceNode = Number.isInteger(edge.sourceIndex)
      ? nodeLookup.get(edge.sourceIndex)
      : null;
    const targetNode = Number.isInteger(edge.targetIndex)
      ? nodeLookup.get(edge.targetIndex)
      : null;
    const edgeClass = classifyRegionPlanEdgeClass({
      edge,
      analysis,
      sourceRegion,
      targetRegion,
      incomingEdgeCountByTarget,
      edgeRole,
    });
    const ownerRegion = (() => {
      if (sourceRegion?.id && targetRegion?.id && sourceRegion.id === targetRegion.id) return sourceRegion;
      if (edgeClass === "loop return" || edgeClass === "loop exit") {
        if (sourceRegion?.kind === "loopRegion") return sourceRegion;
      }
      if (sourceRegion?.id && (edgeClass === "local branch" || edgeClass === "local fallthrough")) {
        return sourceRegion;
      }
      if (targetRegion?.id && edgeClass === "branch rejoin") {
        return targetRegion;
      }
      return null;
    })();
    const preferredSides = getPreferredSidesForRegionPlanEdge(edgeClass, edge, sourceNode, targetNode);
    const preferredLaneGroup = getPreferredLaneGroupForRegionPlanEdge(edgeClass);
    const mayCrossProtectedRegionIds = [
      ownerRegion?.id,
      sourceRegion?.id,
      targetRegion?.id,
    ]
      .filter(Boolean)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .filter((id) => regionLookup.protectedRegionIds.has(id));
    const shouldAvoidProtectedRegionIds = protectedRegions
      .map((region) => region.id)
      .filter((regionId) => !mayCrossProtectedRegionIds.includes(regionId));

    return {
      edgeId: edge.id,
      sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      routeKind: edge.routeKind ?? null,
      sourceRegionId: sourceRegion?.id ?? null,
      sourceRegionType: sourceRegion?.kind ?? null,
      targetRegionId: targetRegion?.id ?? null,
      targetRegionType: targetRegion?.kind ?? null,
      ownerRegionId: ownerRegion?.id ?? null,
      ownerRegionType: ownerRegion?.kind ?? null,
      edgeClass,
      preferredExitSide: preferredSides.exit,
      preferredEntrySide: preferredSides.entry,
      preferredLaneGroup,
      mayCrossProtectedRegionIds,
      shouldAvoidProtectedRegionIds,
    };
  });

  const edgesWithOwnerRegion = rows.filter((row) => Boolean(row.ownerRegionId)).length;

  return {
    enabled: true,
    skippedReason: null,
    rows,
    summary: {
      totalPlannedEdges: rows.length,
      edgesWithOwnerRegion,
      edgesMissingOwnerRegion: rows.length - edgesWithOwnerRegion,
    },
    protectedRegions: protectedRegions.map((region) => ({
      id: region.id,
      kind: region.kind,
      startIndex: region.startIndex,
      endIndex: region.endIndex,
    })),
  };
}

function getActualEntrySide(points) {
  if (!Array.isArray(points) || points.length < 2) return "unknown";
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  const dx = last[0] - penultimate[0];
  const dy = last[1] - penultimate[1];
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "left" : "right";
  if (Math.abs(dy) > 0.01) return dy > 0 ? "top" : "bottom";
  return "unknown";
}

function getActualExitSide(points) {
  if (!Array.isArray(points) || points.length < 2) return "unknown";
  const first = points[0];
  const second = points[1];
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > 0.01) return dy > 0 ? "bottom" : "top";
  return "unknown";
}

function classifyRegionEdgePlanViolation({
  violation,
  row,
  edgeFindingKinds,
  hasSeparationFindings,
}) {
  if (!row?.ownerRegionId) return "missingOwnership";

  if (violation.kind === "crossedAvoidProtectedRegion") {
    if (
      edgeFindingKinds.has("edgePassesThroughForeignProtectedRegion") ||
      edgeFindingKinds.has("edgeNodeIntersection") ||
      edgeFindingKinds.has("longDiagonalCrossesProtectedRegion")
    ) {
      return "actionableTrueViolation";
    }
    return hasSeparationFindings ? "ambiguousNeedsManualReview" : "likelyFalsePositive";
  }

  if (violation.kind === "localBranchLeftOwnerRegion") {
    return hasSeparationFindings ? "actionableTrueViolation" : "planTooStrict";
  }

  if (violation.kind === "laneGroupMismatch") {
    if (!hasSeparationFindings) return "planTooStrict";
    if (row.edgeClass === "local fallthrough") return "likelyFalsePositive";
    return "ambiguousNeedsManualReview";
  }

  if (violation.kind === "misleadingEntrySide" || violation.kind === "misleadingExitSide") {
    if (
      edgeFindingKinds.has("edgeNodeIntersection") ||
      edgeFindingKinds.has("longDiagonalCrossesProtectedRegion")
    ) {
      return "actionableTrueViolation";
    }
    return hasSeparationFindings ? "ambiguousNeedsManualReview" : "planTooStrict";
  }

  return hasSeparationFindings ? "ambiguousNeedsManualReview" : "likelyFalsePositive";
}

function buildGeneratedRegionEdgePlanComparison({
  layoutPlan,
  regionEdgePlan,
  laneAssignmentsByEdgeId,
  protectedRegions,
  separationFindings = [],
}) {
  if (!regionEdgePlan?.enabled) {
    return {
      enabled: false,
      skippedReason: regionEdgePlan?.skippedReason ?? "regionEdgePlanDisabled",
      violations: [],
      summary: {
        totalPlannedEdges: 0,
        edgesWithOwnerRegion: 0,
        edgesMissingOwnerRegion: 0,
        routePlanViolationsByKind: {},
        topViolatingEdges: [],
        missingOwnershipExamples: [],
      },
    };
  }

  const routedEdgeById = new Map((layoutPlan.edges ?? []).map((edge) => [edge.id, edge]));
  const planRowByEdgeId = new Map((regionEdgePlan.rows ?? []).map((row) => [row.edgeId, row]));
  const protectedRegionIds = new Set((protectedRegions ?? []).map((region) => region.id));
  const violations = [];
  const violationKindsByEdge = new Map();
  const edgeFindingKindsByEdgeId = new Map();

  (separationFindings ?? []).forEach((finding) => {
    (finding.edgeIds ?? []).forEach((edgeId) => {
      if (!edgeFindingKindsByEdgeId.has(edgeId)) {
        edgeFindingKindsByEdgeId.set(edgeId, new Set());
      }
      edgeFindingKindsByEdgeId.get(edgeId).add(finding.kind ?? "unknown");
    });
  });

  const isLaneCategoryAligned = (preferredLaneGroup, laneCategory) => {
    const allowedByGroup = {
      local: new Set(["centerFallthroughLane"]),
      "branch-owned": new Set(["branchLane"]),
      "loop-owned": new Set(["localReturnLane", "outerReturnLane"]),
      "outer-continuation": new Set(["continuationLane", "skipLane", "branchLane"]),
      "halt-exit": new Set(["terminalLane"]),
    };
    const allowed = allowedByGroup[preferredLaneGroup] ?? null;
    if (!allowed) return true;
    return allowed.has(laneCategory);
  };

  const addViolation = (edgeId, kind, details = {}) => {
    violations.push({ edgeId, kind, ...details });
    if (!violationKindsByEdge.has(edgeId)) violationKindsByEdge.set(edgeId, new Set());
    violationKindsByEdge.get(edgeId).add(kind);
  };

  regionEdgePlan.rows.forEach((row) => {
    const routedEdge = routedEdgeById.get(row.edgeId);
    if (!routedEdge) {
      addViolation(row.edgeId, "missingRoutedEdge", {});
      return;
    }
    const points = routedEdge.points ?? [];
    const allowedSet = new Set((row.mayCrossProtectedRegionIds ?? []).filter((id) => protectedRegionIds.has(id)));
    const foreignRegionIds = [
      ...collectEdgeForeignRegionIds(points, protectedRegions ?? [], allowedSet),
    ];
    const avoidCrossedRegionIds = foreignRegionIds.filter((regionId) => (
      (row.shouldAvoidProtectedRegionIds ?? []).includes(regionId)
    ));
    if (avoidCrossedRegionIds.length > 0) {
      addViolation(row.edgeId, "crossedAvoidProtectedRegion", {
        crossedRegionIds: avoidCrossedRegionIds,
      });
    }

    const laneCategory = laneAssignmentsByEdgeId?.[row.edgeId]?.laneCategory ?? null;
    if (!isLaneCategoryAligned(row.preferredLaneGroup, laneCategory)) {
      addViolation(row.edgeId, "laneGroupMismatch", {
        preferredLaneGroup: row.preferredLaneGroup,
        actualLaneCategory: laneCategory,
      });
    }

    const actualEntrySide = getActualEntrySide(points);
    if (row.preferredEntrySide && actualEntrySide !== "unknown" && row.preferredEntrySide !== actualEntrySide) {
      addViolation(row.edgeId, "misleadingEntrySide", {
        preferredEntrySide: row.preferredEntrySide,
        actualEntrySide,
      });
    }

    const actualExitSide = getActualExitSide(points);
    if (row.preferredExitSide && actualExitSide !== "unknown" && row.preferredExitSide !== actualExitSide) {
      addViolation(row.edgeId, "misleadingExitSide", {
        preferredExitSide: row.preferredExitSide,
        actualExitSide,
      });
    }

    if (row.edgeClass === "local branch" && avoidCrossedRegionIds.length > 0) {
      addViolation(row.edgeId, "localBranchLeftOwnerRegion", {
        crossedRegionIds: avoidCrossedRegionIds,
      });
    }
  });

  const routePlanViolationsByKind = {};
  const violationClassificationCounts = {};
  let actionableViolationCount = 0;
  let falsePositiveSuspectCount = 0;
  let violationsWithSeparationFindings = 0;
  let violationsWithoutSeparationFindings = 0;
  violations.forEach((violation) => {
    routePlanViolationsByKind[violation.kind] = (routePlanViolationsByKind[violation.kind] ?? 0) + 1;
    const row = planRowByEdgeId.get(violation.edgeId) ?? null;
    const edgeFindingKinds = edgeFindingKindsByEdgeId.get(violation.edgeId) ?? new Set();
    const hasSeparationFindings = edgeFindingKinds.size > 0;
    const classification = classifyRegionEdgePlanViolation({
      violation,
      row,
      edgeFindingKinds,
      hasSeparationFindings,
    });
    violation.classification = classification;
    violation.hasSeparationFindings = hasSeparationFindings;
    violation.separationFindingKinds = [...edgeFindingKinds].sort();
    violationClassificationCounts[classification] = (violationClassificationCounts[classification] ?? 0) + 1;
    if (classification === "actionableTrueViolation") actionableViolationCount += 1;
    if (classification === "likelyFalsePositive" || classification === "planTooStrict") {
      falsePositiveSuspectCount += 1;
    }
    if (hasSeparationFindings) violationsWithSeparationFindings += 1;
    else violationsWithoutSeparationFindings += 1;
  });
  const topViolatingEdges = [...violationKindsByEdge.entries()]
    .map(([edgeId, kinds]) => ({ edgeId, violationCount: kinds.size, kinds: [...kinds].sort() }))
    .sort((left, right) => right.violationCount - left.violationCount || left.edgeId.localeCompare(right.edgeId))
    .slice(0, 12);
  const missingOwnershipExamples = regionEdgePlan.rows
    .filter((row) => !row.ownerRegionId)
    .slice(0, 12)
    .map((row) => ({
      edgeId: row.edgeId,
      sourceIndex: row.sourceIndex,
      targetIndex: row.targetIndex,
      edgeClass: row.edgeClass,
      sourceRegionId: row.sourceRegionId,
      targetRegionId: row.targetRegionId,
    }));
  const topActionableEdges = violations
    .filter((violation) => violation.classification === "actionableTrueViolation")
    .map((violation) => ({
      edgeId: violation.edgeId,
      kind: violation.kind,
      sourceIndex: planRowByEdgeId.get(violation.edgeId)?.sourceIndex ?? null,
      targetIndex: planRowByEdgeId.get(violation.edgeId)?.targetIndex ?? null,
      separationFindingKinds: violation.separationFindingKinds ?? [],
    }))
    .slice(0, 12);

  return {
    enabled: true,
    skippedReason: null,
    violations,
    summary: {
      totalPlannedEdges: regionEdgePlan.summary?.totalPlannedEdges ?? regionEdgePlan.rows.length,
      edgesWithOwnerRegion: regionEdgePlan.summary?.edgesWithOwnerRegion ?? 0,
      edgesMissingOwnerRegion: regionEdgePlan.summary?.edgesMissingOwnerRegion ?? 0,
      routePlanViolationsByKind,
      violationClassificationCounts,
      actionableViolationCount,
      falsePositiveSuspectCount,
      violationsWithSeparationFindings,
      violationsWithoutSeparationFindings,
      topActionableEdges,
      topViolatingEdges,
      missingOwnershipExamples,
    },
  };
}

function buildGenericLaneAssignments(layoutPlan, edgeRoleById = {}) {
  const analysis = layoutPlan.analysis;
  const genericRegionModel = layoutPlan.genericRegionModel ?? null;

  if (layoutPlan.layoutMode !== "generated") {
    return {
      enabled: false,
      skippedReason: "layoutModeNotGenerated",
      byEdgeId: {},
      rows: [],
    };
  }

  if (!genericRegionModel) {
    return {
      enabled: false,
      skippedReason: "genericRegionModelMissing",
      byEdgeId: {},
      rows: [],
    };
  }

  const byEdgeId = {};
  const rows = layoutPlan.edges.map((edge) => {
    const sourceIndex = edge.sourceIndex;
    const targetIndex = edge.targetIndex;
    const sourceProtected = Number.isInteger(sourceIndex) && genericRegionModel.isProtectedIndex(sourceIndex);
    const targetProtected = Number.isInteger(targetIndex) && genericRegionModel.isProtectedIndex(targetIndex);
    const protectedInternal = sourceProtected && targetProtected;
    const structuralRole = edgeRoleById[edge.id]?.role ?? null;
    const flowRole = edgeRoleById[edge.id]?.flowRole ?? null;
    const sourceNodeRole = Number.isInteger(sourceIndex) ? analysis.nodeRoles[sourceIndex] : null;
    const isForward = Number.isInteger(sourceIndex) && Number.isInteger(targetIndex) && targetIndex > sourceIndex;

    let laneCategory = null;
    let laneId = null;
    let laneShareAllowed = false;
    let laneShareReason = "forbidden:unrelatedLaneSharing";

    if (protectedInternal) {
      laneShareReason = "notAssigned:protectedMotifInternal";
    } else if (isHaltExitEdge(edge, analysis.program.length) || isLikelyHaltNodeId(edge.to)) {
      laneCategory = "terminalLane";
      laneId = `terminal:${edge.to ?? "halt"}`;
      laneShareAllowed = true;
      laneShareReason = "allowed:intentionalTerminalMergeCandidate";
    } else if (structuralRole === "localReturn") {
      laneCategory = "localReturnLane";
      laneId = `localReturn:${edge.id}`;
    } else if (structuralRole === "outerReturn") {
      laneCategory = "outerReturnLane";
      laneId = `outerReturn:${edge.id}`;
    } else if (
      edge.type === "fallthrough" &&
      Number.isInteger(sourceIndex) &&
      Number.isInteger(targetIndex) &&
      targetIndex === sourceIndex + 1
    ) {
      laneCategory = "centerFallthroughLane";
      laneId = `centerFallthrough:${edge.id}`;
    } else if (
      isForward &&
      sourceNodeRole === "unconditionalJump"
    ) {
      laneCategory = "skipLane";
      laneId = `skip:${edge.id}`;
    } else if (
      isForward &&
      (flowRole === "continuation" || structuralRole === "continuationEntry" || structuralRole === "decisionExit")
    ) {
      laneCategory = "continuationLane";
      laneId = `continuation:${edge.id}`;
    } else if (
      isForward &&
      sourceNodeRole === "conditionalJump"
    ) {
      laneCategory = "branchLane";
      laneId = `branch:${edge.id}`;
    } else if (flowRole === "skip") {
      laneCategory = "skipLane";
      laneId = `skip:${edge.id}`;
    } else {
      laneCategory = "branchLane";
      laneId = `branch:${edge.id}`;
      laneShareReason = "forbidden:fallbackGenericLane";
    }

    const laneSide = (() => {
      const routedEdge = layoutPlan.edges.find((candidate) => candidate.id === edge.id);
      return routedEdge ? getEdgeFirstDirection(routedEdge) : "none";
    })();

    const row = {
      edgeId: edge.id,
      source: Number.isInteger(sourceIndex) ? formatInstructionNodeId(sourceIndex) : edge.from,
      target: Number.isInteger(targetIndex) ? formatInstructionNodeId(targetIndex) : edge.to,
      structuralRole,
      flowRole,
      routeKind: edge.routeKind ?? null,
      pathKind: edge.pathKind ?? null,
      sourceScope: describeEdgeScope(sourceIndex, genericRegionModel),
      targetScope: describeEdgeScope(targetIndex, genericRegionModel),
      laneCategory,
      laneId,
      laneSide,
      laneShareAllowed,
      laneShareReason,
    };

    byEdgeId[edge.id] = row;
    return row;
  });

  return {
    enabled: true,
    skippedReason: null,
    byEdgeId,
    rows,
  };
}

function detectPathSegmentOverlaps(
  routedEdges,
  edgeRoleById = {},
  laneAssignmentsByEdgeId = {},
  epsilon = 0.5,
) {
  const segmentsByEdge = routedEdges.map((edge) => ({
    edge,
    segments: buildAxisAlignedSegments(edge),
  }));
  const forbiddenOverlaps = [];
  const allowedTerminalMerges = [];

  for (let i = 0; i < segmentsByEdge.length; i += 1) {
    for (let j = i + 1; j < segmentsByEdge.length; j += 1) {
      const left = segmentsByEdge[i];
      const right = segmentsByEdge[j];

      if (left.edge.id === right.edge.id) continue;

      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          const interval = findCollinearOverlapInterval(leftSegment, rightSegment, epsilon);
          if (!interval) continue;

          const overlapRecord = {
            edgeA: left.edge.id,
            edgeB: right.edge.id,
            orientation: leftSegment.orientation,
            lineCoord: Number(leftSegment.lineCoord.toFixed(2)),
            overlapStart: Number(interval.start.toFixed(2)),
            overlapEnd: Number(interval.end.toFixed(2)),
            overlapLength: Number((interval.end - interval.start).toFixed(2)),
            segmentAIndex: leftSegment.segmentIndex,
            segmentBIndex: rightSegment.segmentIndex,
            sourceA: left.edge.from,
            targetA: left.edge.to,
            sourceB: right.edge.from,
            targetB: right.edge.to,
            edgeALaneCategory: laneAssignmentsByEdgeId[left.edge.id]?.laneCategory ?? null,
            edgeALaneId: laneAssignmentsByEdgeId[left.edge.id]?.laneId ?? null,
            edgeBLaneCategory: laneAssignmentsByEdgeId[right.edge.id]?.laneCategory ?? null,
            edgeBLaneId: laneAssignmentsByEdgeId[right.edge.id]?.laneId ?? null,
            overlapCause: laneAssignmentsByEdgeId[left.edge.id]?.laneId &&
              laneAssignmentsByEdgeId[left.edge.id]?.laneId === laneAssignmentsByEdgeId[right.edge.id]?.laneId
              ? "sameLaneAssignment"
              : "differentLaneGeometryOverlap",
          };
          const suppressedAsTerminalMerge = isIntentionalTerminalMergePair(
            left.edge,
            right.edge,
            edgeRoleById,
          );

          if (suppressedAsTerminalMerge) {
            allowedTerminalMerges.push({
              ...overlapRecord,
              allowedAs: "terminalMerge",
            });
            continue;
          }

          forbiddenOverlaps.push(overlapRecord);
        }
      }
    }
  }

  return { forbiddenOverlaps, allowedTerminalMerges };
}

function rangesOverlap(startA, endA, startB, endB, epsilon = 0.5) {
  return Math.min(endA, endB) - Math.max(startA, startB) > epsilon;
}

function isPointInRect(point, rect, epsilon = 0.01) {
  const [x, y] = point;
  return x > rect.left + epsilon &&
    x < rect.right - epsilon &&
    y > rect.top + epsilon &&
    y < rect.bottom - epsilon;
}

function orientation2D(a, b, c, epsilon = 0.01) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) <= epsilon) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment2D(a, b, c, epsilon = 0.01) {
  return b[0] <= Math.max(a[0], c[0]) + epsilon &&
    b[0] >= Math.min(a[0], c[0]) - epsilon &&
    b[1] <= Math.max(a[1], c[1]) + epsilon &&
    b[1] >= Math.min(a[1], c[1]) - epsilon;
}

function segmentsIntersect2D(p1, q1, p2, q2, epsilon = 0.01) {
  const o1 = orientation2D(p1, q1, p2, epsilon);
  const o2 = orientation2D(p1, q1, q2, epsilon);
  const o3 = orientation2D(p2, q2, p1, epsilon);
  const o4 = orientation2D(p2, q2, q1, epsilon);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment2D(p1, p2, q1, epsilon)) return true;
  if (o2 === 0 && onSegment2D(p1, q2, q1, epsilon)) return true;
  if (o3 === 0 && onSegment2D(p2, p1, q2, epsilon)) return true;
  if (o4 === 0 && onSegment2D(p2, q1, q2, epsilon)) return true;
  return false;
}

function segmentIntersectsRectInterior(p0, p1, rect, epsilon = 0.01) {
  if (isPointInRect(p0, rect, epsilon) || isPointInRect(p1, rect, epsilon)) {
    return true;
  }

  const edges = [
    [[rect.left, rect.top], [rect.right, rect.top]],
    [[rect.right, rect.top], [rect.right, rect.bottom]],
    [[rect.right, rect.bottom], [rect.left, rect.bottom]],
    [[rect.left, rect.bottom], [rect.left, rect.top]],
  ];

  return edges.some(([a, b]) => segmentsIntersect2D(p0, p1, a, b, epsilon));
}

function buildProtectedRegionDiagnostics(layoutPlan, analysis, visualRoles, nodeLookup, layout) {
  const protectedRegions = [];
  const seenRegionIds = new Set();
  const pushRegion = (region) => {
    if (!region || seenRegionIds.has(region.id)) return;
    seenRegionIds.add(region.id);
    protectedRegions.push(region);
  };

  (analysis.loopIntervals ?? []).forEach((interval) => {
    const nodes = rangeIndexes(interval.startIndex, interval.endIndex)
      .map((index) => nodeLookup.get(index))
      .filter(Boolean);
    const bounds = getRegionNodeBounds(nodes, layout);
    if (!bounds) return;
    pushRegion({
      id: `loop:${interval.startIndex}-${interval.endIndex}`,
      kind: "loopRegion",
      startIndex: interval.startIndex,
      endIndex: interval.endIndex,
      rangeLabel: `${formatInstructionNodeId(interval.startIndex)}-${formatInstructionNodeId(interval.endIndex)}`,
      memberIndexes: rangeIndexes(interval.startIndex, interval.endIndex),
      bounds,
      metadata: {
        headerIndex: interval.headerIndex,
        returnIndex: interval.returnIndex,
        depth: interval.depth,
      },
    });
  });

  (analysis.branchMergeRegions ?? []).forEach((region, index) => {
    const members = [
      region.sourceIndex,
      region.shortBranchTarget,
      region.longBranchStart,
      ...(region.longBranchPath ?? []),
      region.longBranchExitIndex,
      region.mergeIndex,
      ...(region.continuation ?? []),
    ].filter((value) => Number.isInteger(value));
    const uniqueMembers = Array.from(new Set(members));
    if (uniqueMembers.length === 0) return;
    const nodes = uniqueMembers
      .map((instructionIndex) => nodeLookup.get(instructionIndex))
      .filter(Boolean);
    const bounds = getRegionNodeBounds(nodes, layout);
    if (!bounds) return;
    pushRegion({
      id: `branchIsland:${region.sourceIndex}-${region.mergeIndex}-${index}`,
      kind: "branchIsland",
      startIndex: Math.min(...uniqueMembers),
      endIndex: Math.max(...uniqueMembers),
      rangeLabel:
        `${formatInstructionNodeId(Math.min(...uniqueMembers))}-${formatInstructionNodeId(Math.max(...uniqueMembers))}`,
      memberIndexes: uniqueMembers.sort((left, right) => left - right),
      bounds,
      metadata: {
        decisionIndex: region.sourceIndex,
        mergeIndex: region.mergeIndex,
        longBranchExitIndex: region.longBranchExitIndex ?? null,
      },
    });
  });

  (visualRoles.regions ?? [])
    .filter((region) => region.kind === "continuation" || region.kind === "tail")
    .forEach((region) => {
      const memberIndexes = rangeIndexes(region.startIndex, region.endIndex);
      const nodes = memberIndexes
        .map((index) => nodeLookup.get(index))
        .filter(Boolean);
      const bounds = getRegionNodeBounds(nodes, layout);
      if (!bounds) return;
      pushRegion({
        id: `${region.kind}:${region.startIndex}-${region.endIndex}`,
        kind: "continuationChain",
        startIndex: region.startIndex,
        endIndex: region.endIndex,
        rangeLabel: `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
        memberIndexes,
        bounds,
        metadata: {
          regionKind: region.kind,
        },
      });
    });

  (layoutPlan.genericRegionModel?.attachedSideRegions ?? []).forEach((region) => {
    const memberIndexes = rangeIndexes(region.startIndex, region.endIndex);
    const nodes = memberIndexes
      .map((index) => nodeLookup.get(index))
      .filter(Boolean);
    const bounds = getRegionNodeBounds(nodes, layout);
    if (!bounds) return;
    pushRegion({
      id: `attachedSide:${region.startIndex}-${region.endIndex}`,
      kind: "branchIsland",
      startIndex: region.startIndex,
      endIndex: region.endIndex,
      rangeLabel: `${formatInstructionNodeId(region.startIndex)}-${formatInstructionNodeId(region.endIndex)}`,
      memberIndexes,
      bounds,
      metadata: {
        ownerStartIndex: region.ownerStartIndex ?? null,
        ownerEndIndex: region.ownerEndIndex ?? null,
      },
    });
  });

  const regionById = new Map(protectedRegions.map((region) => [region.id, region]));
  protectedRegions.forEach((region) => {
    region.parentRegionId = null;
    region.childRegionIds = [];
  });
  protectedRegions.forEach((candidate) => {
    const parent = protectedRegions
      .filter((region) => region.id !== candidate.id)
      .filter((region) => (
        Number.isInteger(region.startIndex) &&
        Number.isInteger(region.endIndex) &&
        Number.isInteger(candidate.startIndex) &&
        Number.isInteger(candidate.endIndex) &&
        region.startIndex <= candidate.startIndex &&
        candidate.endIndex <= region.endIndex
      ))
      .sort((left, right) => (
        (left.endIndex - left.startIndex) - (right.endIndex - right.startIndex)
      ))[0] ?? null;

    if (!parent) return;
    candidate.parentRegionId = parent.id;
    const parentRegion = regionById.get(parent.id);
    if (!parentRegion) return;
    parentRegion.childRegionIds = [...new Set([...(parentRegion.childRegionIds ?? []), candidate.id])];
  });

  return protectedRegions;
}

function buildEdgeProtectedRegionOwnership({
  routedEdges,
  analysis,
  protectedRegions,
  edgeRoleById = {},
}) {
  const regionByEdgeSourceIndex = new Map();
  const regionByEdgeTargetIndex = new Map();
  const protectedRegionsById = new Map(protectedRegions.map((region) => [region.id, region]));

  const getRegionIdsForIndex = (index) => {
    if (!Number.isInteger(index)) return [];
    return protectedRegions
      .filter((region) => region.memberIndexes.includes(index))
      .map((region) => region.id);
  };

  routedEdges.forEach((edge) => {
    regionByEdgeSourceIndex.set(edge.id, getRegionIdsForIndex(edge.sourceIndex));
    regionByEdgeTargetIndex.set(edge.id, getRegionIdsForIndex(edge.targetIndex));
  });

  const ownershipByEdgeId = {};

  routedEdges.forEach((edge) => {
    const sourceRegionIds = regionByEdgeSourceIndex.get(edge.id) ?? [];
    const targetRegionIds = regionByEdgeTargetIndex.get(edge.id) ?? [];
    const sourceSet = new Set(sourceRegionIds);
    const targetSet = new Set(targetRegionIds);
    const sharedRegionIds = sourceRegionIds.filter((id) => targetSet.has(id));
    const ownedRegionIds = [...sharedRegionIds];
    const role = edgeRoleById[edge.id]?.role ?? null;
    const flowRole = edgeRoleById[edge.id]?.flowRole ?? null;

    if ((role === "localReturn" || role === "outerReturn") && Number.isInteger(edge.sourceIndex) && Number.isInteger(edge.targetIndex)) {
      const loopInterval = (analysis.loopIntervals ?? []).find((interval) => interval.edgeId === edge.id) ??
        findSmallestContainingLoop(
          analysis.loopIntervals ?? [],
          edge.sourceIndex,
          edge.targetIndex,
        );
      if (loopInterval) {
        const loopRegionId = `loop:${loopInterval.startIndex}-${loopInterval.endIndex}`;
        if (protectedRegionsById.has(loopRegionId) && !ownedRegionIds.includes(loopRegionId)) {
          ownedRegionIds.push(loopRegionId);
        }
      }
    }

    if (isHaltExitEdge(edge, analysis.program.length) || isLikelyHaltNodeId(edge.to)) {
      ownershipByEdgeId[edge.id] = {
        edgeId: edge.id,
        sourceRegionIds,
        targetRegionIds,
        ownedRegionIds: [],
        isBoundaryCrossing: false,
        ambiguousOwnership: false,
        ownershipReason: "terminalExitNoOwnership",
        flowRole,
        structuralRole: role,
      };
      return;
    }

    const isBoundaryCrossing =
      sourceRegionIds.length > 0 &&
      targetRegionIds.length > 0 &&
      ownedRegionIds.length === 0;
    const ambiguousOwnership = ownedRegionIds.length > 1;
    let ownershipReason = "noProtectedRegionOwnership";
    if (ownedRegionIds.length === 1) ownershipReason = "interiorOwned";
    else if (ambiguousOwnership) ownershipReason = "ambiguousMultipleOwnedRegions";
    else if (isBoundaryCrossing) ownershipReason = "boundaryCrossing";

    ownershipByEdgeId[edge.id] = {
      edgeId: edge.id,
      sourceRegionIds,
      targetRegionIds,
      ownedRegionIds,
      isBoundaryCrossing,
      ambiguousOwnership,
      ownershipReason,
      flowRole,
      structuralRole: role,
    };
  });

  routedEdges.forEach((edge) => {
    const ownership = ownershipByEdgeId[edge.id];
    if (!Array.isArray(edge.points) || edge.points.length < 2) {
      ownership.foreignRegionIds = [];
      ownership.crossesForeignProtectedRegion = false;
      return;
    }

    const allowedRegionIds = new Set([
      ...(ownership.ownedRegionIds ?? []),
      ...(ownership.sourceRegionIds ?? []),
      ...(ownership.targetRegionIds ?? []),
    ]);
    const foreignRegionIds = protectedRegions
      .filter((region) => !allowedRegionIds.has(region.id))
      .filter((region) => {
        for (let i = 1; i < edge.points.length; i += 1) {
          if (segmentIntersectsRectInterior(edge.points[i - 1], edge.points[i], region.bounds, 0.01)) {
            return true;
          }
        }
        return false;
      })
      .map((region) => region.id);

    ownership.foreignRegionIds = foreignRegionIds;
    ownership.crossesForeignProtectedRegion = foreignRegionIds.length > 0;
  });

  const summary = {
    edgesWithoutProtectedRegionIssues: Object.values(ownershipByEdgeId).filter((entry) => (
      !entry.crossesForeignProtectedRegion && !entry.ambiguousOwnership
    )).length,
    edgesCrossingForeignProtectedRegions: Object.values(ownershipByEdgeId).filter(
      (entry) => entry.crossesForeignProtectedRegion,
    ).length,
    edgesWithAmbiguousOwnership: Object.values(ownershipByEdgeId).filter(
      (entry) => entry.ambiguousOwnership,
    ).length,
  };

  return {
    byEdgeId: ownershipByEdgeId,
    summary,
  };
}

function buildEdgeCorridorAssignments(routedEdges, laneAssignmentsByEdgeId = {}, protectedOwnershipByEdgeId = {}) {
  return routedEdges.map((edge) => {
    const axisSegments = buildAxisAlignedSegments(edge, 0.01).map((segment) => ({
      segmentIndex: segment.segmentIndex,
      orientation: segment.orientation,
      lineCoord: Number(segment.lineCoord.toFixed(2)),
      rangeStart: Number(segment.rangeStart.toFixed(2)),
      rangeEnd: Number(segment.rangeEnd.toFixed(2)),
      length: Number((segment.rangeEnd - segment.rangeStart).toFixed(2)),
    }));
    const diagonalSegments = [];
    if (Array.isArray(edge.points)) {
      for (let i = 1; i < edge.points.length; i += 1) {
        const [x0, y0] = edge.points[i - 1];
        const [x1, y1] = edge.points[i];
        const dx = x1 - x0;
        const dy = y1 - y0;
        if (Math.abs(dx) < 0.01 || Math.abs(dy) < 0.01) continue;
        diagonalSegments.push({
          segmentIndex: i - 1,
          from: [Number(x0.toFixed(2)), Number(y0.toFixed(2))],
          to: [Number(x1.toFixed(2)), Number(y1.toFixed(2))],
          length: Number(Math.hypot(dx, dy).toFixed(2)),
        });
      }
    }

    return {
      edgeId: edge.id,
      laneCategory: laneAssignmentsByEdgeId[edge.id]?.laneCategory ?? null,
      laneId: laneAssignmentsByEdgeId[edge.id]?.laneId ?? null,
      source: edge.from,
      target: edge.to,
      ownedRegionIds: protectedOwnershipByEdgeId[edge.id]?.ownedRegionIds ?? [],
      sourceRegionIds: protectedOwnershipByEdgeId[edge.id]?.sourceRegionIds ?? [],
      targetRegionIds: protectedOwnershipByEdgeId[edge.id]?.targetRegionIds ?? [],
      crossesForeignProtectedRegion:
        protectedOwnershipByEdgeId[edge.id]?.crossesForeignProtectedRegion ?? false,
      foreignRegionIds: protectedOwnershipByEdgeId[edge.id]?.foreignRegionIds ?? [],
      protectedOwnershipReason:
        protectedOwnershipByEdgeId[edge.id]?.ownershipReason ?? "noOwnershipMetadata",
      axisSegments,
      diagonalSegments,
    };
  });
}

function detectSeparationAuditFindings({
  layoutPlan,
  analysis,
  edgeRoleById,
  nodeLookup,
  laneAssignmentsByEdgeId,
  protectedRegions,
  protectedOwnershipByEdgeId,
  edgeCorridors,
  pathSegmentOverlaps,
}) {
  const findings = [];
  const instructionNodes = layoutPlan.nodes.filter((node) => node.id.startsWith("i-"));
  const nodeBoundsById = new Map(
    instructionNodes.map((node) => [node.id, getNodeBounds(node, layoutPlan.layout)]),
  );
  const edgeById = new Map(layoutPlan.edges.map((edge) => [edge.id, edge]));

  const addFinding = ({
    kind,
    severity = "medium",
    message,
    edgeIds = [],
    nodeIds = [],
    regionIds = [],
    suggestedFixCategory = null,
    details = {},
  }) => {
    findings.push({
      kind,
      severity,
      message,
      edgeIds,
      nodeIds,
      regionIds,
      suggestedFixCategory,
      details,
    });
  };

  for (let i = 0; i < instructionNodes.length; i += 1) {
    for (let j = i + 1; j < instructionNodes.length; j += 1) {
      const left = instructionNodes[i];
      const right = instructionNodes[j];
      const leftBounds = nodeBoundsById.get(left.id);
      const rightBounds = nodeBoundsById.get(right.id);
      if (!leftBounds || !rightBounds) continue;

      const overlapX = Math.min(leftBounds.right, rightBounds.right) - Math.max(leftBounds.left, rightBounds.left);
      const overlapY = Math.min(leftBounds.bottom, rightBounds.bottom) - Math.max(leftBounds.top, rightBounds.top);
      if (overlapX > 0.5 && overlapY > 0.5) {
        addFinding({
          kind: "nodeNodeOverlap",
          severity: "high",
          message: `Node overlap between ${left.id} and ${right.id}`,
          nodeIds: [left.id, right.id],
          suggestedFixCategory: "increase_vertical_spacing",
          details: {
            overlapX: Number(overlapX.toFixed(2)),
            overlapY: Number(overlapY.toFixed(2)),
          },
        });
        continue;
      }

      const horizontalGap = Math.max(leftBounds.left - rightBounds.right, rightBounds.left - leftBounds.right, 0);
      const verticalGap = Math.max(leftBounds.top - rightBounds.bottom, rightBounds.top - leftBounds.bottom, 0);
      if (horizontalGap <= 8 && verticalGap <= 8) {
        addFinding({
          kind: "nodeNodeNearOverlap",
          severity: "medium",
          message: `Nodes ${left.id} and ${right.id} are tightly packed`,
          nodeIds: [left.id, right.id],
          suggestedFixCategory: horizontalGap <= verticalGap
            ? "increase_horizontal_lane_separation"
            : "increase_vertical_spacing",
          details: {
            horizontalGap: Number(horizontalGap.toFixed(2)),
            verticalGap: Number(verticalGap.toFixed(2)),
          },
        });
      }
    }
  }

  layoutPlan.edges.forEach((edge) => {
    if (!Array.isArray(edge.points) || edge.points.length < 2) return;
    const sourceNode = layoutPlan.nodeMap.get(edge.from);
    const targetNode = layoutPlan.nodeMap.get(edge.to);
    const sourceId = sourceNode?.id ?? null;
    const targetId = targetNode?.id ?? null;

    instructionNodes.forEach((node) => {
      if (node.id === sourceId || node.id === targetId) return;
      const bounds = nodeBoundsById.get(node.id);
      if (!bounds) return;

      for (let pointIndex = 1; pointIndex < edge.points.length; pointIndex += 1) {
        const p0 = edge.points[pointIndex - 1];
        const p1 = edge.points[pointIndex];
        if (!segmentIntersectsRectInterior(p0, p1, bounds, 0.01)) continue;

        addFinding({
          kind: "edgeNodeIntersection",
          severity: "high",
          message: `Edge ${edge.id} intersects node ${node.id}`,
          edgeIds: [edge.id],
          nodeIds: [node.id],
          suggestedFixCategory: "route_around_protected_region",
          details: {
            segmentIndex: pointIndex - 1,
            source: edge.from,
            target: edge.to,
          },
        });
        break;
      }
    });
  });

  pathSegmentOverlaps.forbiddenOverlaps.forEach((overlap) => {
    addFinding({
      kind: "edgeEdgeSharedSegment",
      severity: "high",
      message: `Edges ${overlap.edgeA} and ${overlap.edgeB} share a ${overlap.orientation} segment`,
      edgeIds: [overlap.edgeA, overlap.edgeB],
      suggestedFixCategory: "increase_horizontal_lane_separation",
      details: overlap,
    });
  });

  for (let i = 0; i < edgeCorridors.length; i += 1) {
    for (let j = i + 1; j < edgeCorridors.length; j += 1) {
      const left = edgeCorridors[i];
      const right = edgeCorridors[j];
      if (left.edgeId === right.edgeId) continue;
      if (isIntentionalTerminalMergePair(edgeById.get(left.edgeId), edgeById.get(right.edgeId), edgeRoleById)) {
        continue;
      }

      left.axisSegments.forEach((leftSegment) => {
        right.axisSegments.forEach((rightSegment) => {
          if (leftSegment.orientation !== rightSegment.orientation) return;
          const lineDistance = Math.abs(leftSegment.lineCoord - rightSegment.lineCoord);
          if (lineDistance > 12) return;
          if (!rangesOverlap(
            leftSegment.rangeStart,
            leftSegment.rangeEnd,
            rightSegment.rangeStart,
            rightSegment.rangeEnd,
            4,
          )) {
            return;
          }
          addFinding({
            kind: "unrelatedEdgeCorridorNearShare",
            severity: "medium",
            message: `Edges ${left.edgeId} and ${right.edgeId} run in adjacent ${leftSegment.orientation} corridors`,
            edgeIds: [left.edgeId, right.edgeId],
            suggestedFixCategory: leftSegment.orientation === "vertical"
              ? "increase_horizontal_lane_separation"
              : "increase_vertical_spacing",
            details: {
              orientation: leftSegment.orientation,
              corridorLineDistance: Number(lineDistance.toFixed(2)),
              overlapRange: [
                Number(
                  Math.max(leftSegment.rangeStart, rightSegment.rangeStart).toFixed(2),
                ),
                Number(
                  Math.min(leftSegment.rangeEnd, rightSegment.rangeEnd).toFixed(2),
                ),
              ],
              leftLaneId: left.laneId,
              rightLaneId: right.laneId,
            },
          });
        });
      });
    }
  }

  layoutPlan.edges.forEach((edge) => {
    if (!Array.isArray(edge.points) || edge.points.length < 2) return;
    const edgeRole = edgeRoleById[edge.id]?.role ?? null;
    const flowRole = edgeRoleById[edge.id]?.flowRole ?? null;
    const ownership = protectedOwnershipByEdgeId[edge.id] ?? null;
    const ownedRegions = new Set([
      ...(ownership?.ownedRegionIds ?? []),
      ...(ownership?.sourceRegionIds ?? []),
      ...(ownership?.targetRegionIds ?? []),
    ]);

    protectedRegions.forEach((region) => {
      if (ownedRegions.has(region.id)) return;
      let intersects = false;
      for (let i = 1; i < edge.points.length; i += 1) {
        if (segmentIntersectsRectInterior(edge.points[i - 1], edge.points[i], region.bounds, 0.01)) {
          intersects = true;
          break;
        }
      }
      if (!intersects) return;

      const isLoopRegion = region.kind === "loopRegion";
      const isReturnLane = edgeRole === "localReturn" || edgeRole === "outerReturn";
      const isBranchLike = edge.branch || flowRole === "branch" || flowRole === "continuation";

      addFinding({
        kind: "edgePassesThroughForeignProtectedRegion",
        severity: isLoopRegion ? "high" : "medium",
        message: `Edge ${edge.id} passes through protected region ${region.id}`,
        edgeIds: [edge.id],
        regionIds: [region.id],
        suggestedFixCategory: isReturnLane && isLoopRegion
          ? "reserve_separate_return_lane"
          : "route_around_protected_region",
        details: {
          edgeRole,
          flowRole,
          ownershipReason: ownership?.ownershipReason ?? "unknown",
          regionKind: region.kind,
          branchLike: Boolean(isBranchLike),
        },
      });
    });
  });

  layoutPlan.edges.forEach((edge) => {
    if (!Array.isArray(edge.points) || edge.points.length < 2) return;
    for (let i = 1; i < edge.points.length; i += 1) {
      const [x0, y0] = edge.points[i - 1];
      const [x1, y1] = edge.points[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (Math.abs(dx) < 0.01 || Math.abs(dy) < 0.01) continue;
      const length = Math.hypot(dx, dy);
      if (length < 120) continue;
      const ratio = Math.abs(dy / dx);
      if (ratio > 1.2) continue;

      const crossedRegions = protectedRegions
        .filter((region) => !(
          Number.isInteger(edge.sourceIndex) &&
          region.memberIndexes.includes(edge.sourceIndex)
        ))
        .filter((region) => segmentIntersectsRectInterior(edge.points[i - 1], edge.points[i], region.bounds, 0.01))
        .map((region) => region.id);
      if (crossedRegions.length === 0) continue;

      addFinding({
        kind: "longDiagonalCrossesProtectedRegion",
        severity: "medium",
        message: `Edge ${edge.id} has a long diagonal crossing protected regions`,
        edgeIds: [edge.id],
        regionIds: crossedRegions,
        suggestedFixCategory: "split_expand_loop_region",
        details: {
          segmentIndex: i - 1,
          segmentLength: Number(length.toFixed(2)),
          diagonalRatio: Number(ratio.toFixed(3)),
        },
      });
    }
  });

  return findings;
}

function buildSeparationAndOverlapAudit({
  layoutPlan,
  routedEdges,
  analysis,
  visualRoles,
  edgeRoleById,
  nodeLookup,
  laneAssignmentsByEdgeId,
  pathSegmentOverlaps,
}) {
  const protectedRegions = buildProtectedRegionDiagnostics(
    layoutPlan,
    analysis,
    visualRoles,
    nodeLookup,
    layoutPlan.layout,
  );
  const protectedEdgeOwnership = buildEdgeProtectedRegionOwnership({
    routedEdges,
    analysis,
    protectedRegions,
    edgeRoleById,
  });
  const edgeCorridors = buildEdgeCorridorAssignments(
    routedEdges,
    laneAssignmentsByEdgeId,
    protectedEdgeOwnership.byEdgeId,
  );
  const findings = detectSeparationAuditFindings({
    layoutPlan: {
      ...layoutPlan,
      edges: routedEdges,
    },
    analysis,
    edgeRoleById,
    nodeLookup,
    laneAssignmentsByEdgeId,
    protectedRegions,
    protectedOwnershipByEdgeId: protectedEdgeOwnership.byEdgeId,
    edgeCorridors,
    pathSegmentOverlaps,
  });
  const severityCounts = findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, { high: 0, medium: 0, low: 0 });

  return {
    enabled: true,
    protectedRegions: protectedRegions.map((region) => ({
      ...region,
      bounds: {
        left: Number(region.bounds.left.toFixed(2)),
        right: Number(region.bounds.right.toFixed(2)),
        top: Number(region.bounds.top.toFixed(2)),
        bottom: Number(region.bounds.bottom.toFixed(2)),
      },
    })),
    protectedEdgeOwnership: protectedEdgeOwnership.byEdgeId,
    protectedEdgeOwnershipSummary: protectedEdgeOwnership.summary,
    edgeCorridors,
    findings,
    severityCounts,
  };
}

function countFindingsByField(findings = [], fieldName) {
  const counts = {};
  findings.forEach((finding) => {
    const rawValue = finding?.[fieldName];
    const key = rawValue == null || rawValue === "" ? "unclassified" : String(rawValue);
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function buildSeparationAuditComparisonSummary(beforeAudit, afterAudit) {
  const beforeFindings = beforeAudit?.findings ?? [];
  const afterFindings = afterAudit?.findings ?? [];
  return {
    totalFindingsBefore: beforeFindings.length,
    totalFindingsAfter: afterFindings.length,
    severityBefore: beforeAudit?.severityCounts ?? { high: 0, medium: 0, low: 0 },
    severityAfter: afterAudit?.severityCounts ?? { high: 0, medium: 0, low: 0 },
    byFixCategoryBefore: countFindingsByField(beforeFindings, "suggestedFixCategory"),
    byFixCategoryAfter: countFindingsByField(afterFindings, "suggestedFixCategory"),
    byKindBefore: countFindingsByField(beforeFindings, "kind"),
    byKindAfter: countFindingsByField(afterFindings, "kind"),
  };
}

function formatInstructionNodeId(index) {
  return `I${index}`;
}

function classifyVisualGeometry(layoutPlan, selectedFunctionId = "") {
  const analysis = layoutPlan.analysis;
  const visualRoles = analysis.visualRoles ?? {};
  const edgeRoleById = visualRoles.edgeRoleById ?? {};
  const nodeLookup = getInstructionNodeLookup(layoutPlan);
  const routedEdgeById = new Map(layoutPlan.edges.map((edge) => [edge.id, edge]));
  const setupRegion = (visualRoles.regions ?? []).find((region) => region.kind === "setup") ?? null;
  const loopIntervals = analysis.loopIntervals ?? [];
  const loopByEdgeId = new Map(loopIntervals.map((interval) => [interval.edgeId, interval]));
  const decisionIndexes = analysis.nodeRoles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role === "conditionalJump")
    .map(({ index }) => index);
  const firstDecisionIndex = decisionIndexes[0] ?? null;
  const outgoingBySource = new Map();
  analysis.edges.forEach((edge) => {
    if (!Number.isInteger(edge.sourceIndex)) return;
    if (!outgoingBySource.has(edge.sourceIndex)) {
      outgoingBySource.set(edge.sourceIndex, []);
    }
    outgoingBySource.get(edge.sourceIndex).push(edge);
  });

  const motifs = [];
  const warnings = [];
  const detectedMotifKinds = new Set();
  if (isBetaFlowAuditDebugEnabled()) {
    motifs.push({
      kind: "layoutCoordinateAudit",
      canvas: {
        width: layoutPlan.width,
        height: layoutPlan.height,
        offsetX: layoutPlan.offsetX,
        offsetY: layoutPlan.offsetY,
      },
      nodes: layoutPlan.nodes.map((node) => ({
        nodeId: node.id,
        instructionIndex: Number.isInteger(node.instructionIndex) ? node.instructionIndex : null,
        kind: node.kind,
        x: node.x,
        y: node.y,
        generatedScanV2LocalFrameId: node.generatedScanV2LocalFrameId ?? null,
        sketchV1FrameId: node.sketchV1FrameId ?? null,
      })),
      edges: layoutPlan.edges.map((edge) => ({
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
        targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
        branch: edge.branch ?? null,
        role: edgeRoleById[edge.id]?.role ?? null,
        flowRole: edgeRoleById[edge.id]?.flowRole ?? null,
        points: edge.points ?? [],
      })),
    });
  }
  const layoutMaxSpan = Math.max(layoutPlan.width, layoutPlan.height, 1);
  const genericRegionModel = layoutPlan.genericRegionModel ?? null;
  const unconditionalLoops = loopIntervals.filter((interval) => interval.isUnconditionalReturn);
  const backwardEdges = analysis.edges.filter((edge) => (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex < edge.sourceIndex
  ));
  const branchMergeRows = buildBranchMergeDebugRows(
    analysis.branchMergeRegions ?? [],
    nodeLookup,
    layoutPlan.layout,
  );
  const branchMergeAuditRows = analysis.branchMergeRegionAudit ?? [];
  const identity = analysis.debugIdentity ?? createBetaFlowDebugIdentity({
    selectedExampleName: selectedFunctionId,
    layoutMode: layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
    motifHint: layoutPlan.motif.kind,
    program: analysis.program,
    nodeRoles: analysis.nodeRoles,
  });
  const branchMergeDataFlow = {
    identity,
    selectedExample: selectedFunctionId || "unknown",
    motifKind: layoutPlan.motif.kind,
    layoutMode: layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
    instructionCount: analysis.program.length,
    conditionalDecisionCount: analysis.nodeRoles.filter((role) => role === "conditionalJump").length,
    detectBranchMergeRegionsCalled:
      analysis.branchMergeDebug?.detectBranchMergeRegionsCalled ?? false,
    branchMergeRegionAuditLength: branchMergeAuditRows.length,
    branchMergeRegionsLength: (analysis.branchMergeRegions ?? []).length,
  };
  motifs.push({
    kind: "branchMergeRegions",
    detected: branchMergeRows.length > 0,
    rows: branchMergeRows,
  });
  motifs.push({
    kind: "branchMergeRegionAudit",
    detected: branchMergeAuditRows.length > 0,
    rows: branchMergeAuditRows,
  });
  branchMergeRows
    .filter((row) => row.levelMismatch === "upwardMergeRisk" && row.longBranchExitNode && row.mergeNode)
    .forEach((row) => {
      warnings.push(
        `Branch merge ${row.decisionNode}→${row.mergeNode} currently places merge above long-branch exit ${row.longBranchExitNode}.`,
      );
    });
  const localReturnEdges = analysis.edges.filter((edge) => {
    if (edgeRoleById[edge.id]?.role !== "localReturn") return false;
    if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return false;
    if (edge.targetIndex >= edge.sourceIndex) return false;

    const smallestContainingLoop = findSmallestContainingLoop(
      loopIntervals,
      edge.sourceIndex,
      edge.targetIndex,
    );
    if (!smallestContainingLoop) return false;

    return edge.targetIndex === smallestContainingLoop.headerIndex ||
      edge.targetIndex === smallestContainingLoop.startIndex;
  });
  const outerReturnEdges = analysis.edges.filter((edge) => {
    if (edgeRoleById[edge.id]?.role !== "outerReturn") return false;
    if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return false;
    if (edge.targetIndex >= edge.sourceIndex) return false;

    const owningLoop = loopByEdgeId.get(edge.id) ??
      findSmallestContainingLoop(loopIntervals, edge.sourceIndex, edge.targetIndex);
    if (!owningLoop) return false;

    const targetsLoopAnchor = edge.targetIndex === owningLoop.headerIndex ||
      edge.targetIndex === owningLoop.startIndex;
    const sourceInOwningLoop = owningLoop.startIndex <= edge.sourceIndex &&
      edge.sourceIndex <= owningLoop.endIndex;

    return Boolean(targetsLoopAnchor && sourceInOwningLoop && owningLoop.childLoopIds?.length);
  });
  const postCoreRegions = (visualRoles.regions ?? []).filter((region) => (
    (region.kind === "continuation" || region.kind === "tail") && Number.isInteger(region.startIndex)
  ));
  const protectedBlockBounds = (layoutPlan.motif?.embeddedNestedLoopBlocks ?? [])
    .map((block) => {
      const regionNodes = rangeIndexes(block.coreLoop.startIndex, block.coreLoop.endIndex)
        .map((index) => nodeLookup.get(index))
        .filter(Boolean)
        .map((node) => getNodeBounds(node, layoutPlan.layout));

      if (regionNodes.length === 0) return null;

      return {
        startIndex: block.coreLoop.startIndex,
        endIndex: block.coreLoop.endIndex,
        left: Math.min(...regionNodes.map((bounds) => bounds.left)),
        right: Math.max(...regionNodes.map((bounds) => bounds.right)),
        top: Math.min(...regionNodes.map((bounds) => bounds.top)),
        bottom: Math.max(...regionNodes.map((bounds) => bounds.bottom)),
      };
    })
    .filter(Boolean);
  const genericLaneAssignments = buildGenericLaneAssignments(layoutPlan, edgeRoleById);

  const setupNodes = setupRegion
    ? Array.from(
      new Set(
        rangeIndexes(setupRegion.startIndex, setupRegion.endIndex)
          .map((index) => nodeLookup.get(index))
          .filter(Boolean),
      ),
    )
    : [];
  if (setupNodes.length > 0) {
    const xValues = setupNodes.map((node) => node.x);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const setupFallthroughEdges = analysis.edges.filter((edge) => (
      edge.type === "fallthrough" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.sourceIndex >= setupRegion.startIndex &&
      edge.targetIndex <= setupRegion.endIndex + 1
    ));
    const setupFallthroughVertical = setupFallthroughEdges.every((edge) => {
      const routed = routedEdgeById.get(edge.id);
      if (!routed?.points?.length) return false;
      return Math.abs(routed.points[0][0] - routed.points.at(-1)[0]) < 1.5;
    });
    const motif = {
      kind: "verticalSetupSpine",
      detected: setupFallthroughVertical && (maxX - minX) <= 1.5,
      setupNodes: setupNodes.map((node) => node.displayNode?.id ?? node.id),
      firstNodeAfterSetup: Number.isInteger(setupRegion.endIndex)
        ? formatInstructionNodeId(setupRegion.endIndex + 1)
        : null,
      allSetupFallthroughsVertical: setupFallthroughVertical,
      alignedXSpread: Number((maxX - minX).toFixed(2)),
    };
    motifs.push(motif);
    if (motif.detected) detectedMotifKinds.add("verticalSetupSpine");
  } else {
    motifs.push({ kind: "verticalSetupSpine", detected: false });
  }

  const localReturnLaneMotif = {
    kind: "localReturnLane",
    detected: localReturnEdges.length > 0,
    edges: localReturnEdges.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      const loop = loopByEdgeId.get(edge.id) ??
        findSmallestContainingLoop(loopIntervals, edge.sourceIndex, edge.targetIndex) ??
        null;
      return {
        edgeId: edge.id,
        source: formatInstructionNodeId(edge.sourceIndex),
        target: formatInstructionNodeId(edge.targetIndex),
        side: routed ? getEdgeFirstDirection(routed) : "unknown",
        xOffset: routed && routed.points?.[1]
          ? Number(Math.abs(routed.points[1][0] - routed.points[0][0]).toFixed(1))
          : null,
        associatedLoopGuard: Number.isInteger(loop?.headerIndex)
          ? formatInstructionNodeId(loop.headerIndex)
          : null,
      };
    }),
  };
  motifs.push(localReturnLaneMotif);
  if (localReturnLaneMotif.detected) detectedMotifKinds.add("localReturnLane");

  const outerReturnLaneMotif = {
    kind: "outerReturnLane",
    detected: outerReturnEdges.length > 0,
    edges: outerReturnEdges.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      const loop = loopByEdgeId.get(edge.id) ??
        findSmallestContainingLoop(loopIntervals, edge.sourceIndex, edge.targetIndex) ??
        null;
      return {
        edgeId: edge.id,
        source: formatInstructionNodeId(edge.sourceIndex),
        target: formatInstructionNodeId(edge.targetIndex),
        side: routed ? getEdgeFirstDirection(routed) : "unknown",
        xOffset: routed && routed.points?.[1]
          ? Number(Math.abs(routed.points[1][0] - routed.points[0][0]).toFixed(1))
          : null,
        wrappedEnvelope: loop
          ? `${formatInstructionNodeId(loop.startIndex)}-${formatInstructionNodeId(loop.endIndex)}`
          : null,
      };
    }),
  };
  motifs.push(outerReturnLaneMotif);
  if (outerReturnLaneMotif.detected) detectedMotifKinds.add("outerReturnLane");

  const outerLoopCandidate = unconditionalLoops.find((interval) => (
    interval.depth === 0 &&
    interval.childLoopIds.some((childId) => unconditionalLoops.some((candidate) => candidate.id === childId))
  )) ?? null;
  const innerLoopCandidate = outerLoopCandidate
    ? unconditionalLoops.find((interval) => interval.parentLoopId === outerLoopCandidate.id) ?? null
    : null;
  const nestedLoopDetected = Boolean(
    outerLoopCandidate &&
    innerLoopCandidate &&
    localReturnEdges.some((edge) => edge.id === innerLoopCandidate.edgeId) &&
    outerReturnEdges.some((edge) => edge.id === outerLoopCandidate.edgeId) &&
    outerLoopCandidate.startIndex <= innerLoopCandidate.startIndex &&
    innerLoopCandidate.endIndex <= outerLoopCandidate.endIndex,
  );
  const nestedMotif = {
    kind: "nestedLoopMotif",
    detected: nestedLoopDetected,
    outerGuard: outerLoopCandidate ? formatInstructionNodeId(outerLoopCandidate.headerIndex) : null,
    innerGuard: innerLoopCandidate ? formatInstructionNodeId(innerLoopCandidate.headerIndex) : null,
    innerBodyNodes: innerLoopCandidate
      ? rangeIndexes(innerLoopCandidate.startIndex, innerLoopCandidate.endIndex).map(formatInstructionNodeId)
      : [],
    outerBodyNodes: outerLoopCandidate
      ? rangeIndexes(outerLoopCandidate.startIndex, outerLoopCandidate.endIndex).map(formatInstructionNodeId)
      : [],
    localReturnEdge: innerLoopCandidate
      ? `${formatInstructionNodeId(innerLoopCandidate.returnIndex)}→${formatInstructionNodeId(innerLoopCandidate.headerIndex)}`
      : null,
    outerReturnEdge: outerLoopCandidate
      ? `${formatInstructionNodeId(outerLoopCandidate.returnIndex)}→${formatInstructionNodeId(outerLoopCandidate.headerIndex)}`
      : null,
  };
  motifs.push(nestedMotif);
  if (nestedMotif.detected) detectedMotifKinds.add("nestedLoopMotif");

  const embeddedNestedLoopBlocks = unconditionalLoops
    .map((outerLoop) => {
      const innerCandidates = unconditionalLoops.filter((candidate) => (
        candidate.parentLoopId === outerLoop.id &&
        outerLoop.startIndex <= candidate.startIndex &&
        candidate.endIndex <= outerLoop.endIndex
      ));

      if (innerCandidates.length !== 1) return null;
      const innerLoop = innerCandidates[0];

      const hasSingleLocalReturnLane = localReturnEdges.filter(
        (edge) => edge.id === innerLoop.edgeId,
      ).length === 1;
      const hasSingleOuterReturnLane = outerReturnEdges.filter(
        (edge) => edge.id === outerLoop.edgeId,
      ).length === 1;
      const hasMainGuard = Number.isInteger(outerLoop.headerIndex) &&
        analysis.nodeRoles[outerLoop.headerIndex] === "conditionalJump";

      if (!hasSingleLocalReturnLane || !hasSingleOuterReturnLane || !hasMainGuard) {
        return null;
      }

      const guardOutgoing = analysis.edges.filter((edge) => (
        edge.sourceIndex === outerLoop.headerIndex &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex > outerLoop.headerIndex
      ));
      const sideExitEdge = guardOutgoing.find((edge) => (
        edge.targetIndex > outerLoop.endIndex &&
        !isHaltExitEdge(edge, analysis.program.length)
      )) ?? null;
      const sideExitKind = sideExitEdge ? edgeRoleById[sideExitEdge.id]?.role ?? null : null;
      const resultBranchRegion = sideExitEdge
        ? postCoreRegions.find(
          (region) => region.startIndex <= sideExitEdge.targetIndex && sideExitEdge.targetIndex <= region.endIndex,
        ) ?? null
        : null;

      return {
        interval: `${formatInstructionNodeId(outerLoop.startIndex)}-${formatInstructionNodeId(outerLoop.endIndex)}`,
        startIndex: outerLoop.startIndex,
        endIndex: outerLoop.endIndex,
        outerGuard: formatInstructionNodeId(outerLoop.headerIndex),
        innerGuard: formatInstructionNodeId(innerLoop.headerIndex),
        localReturnEdge: `${formatInstructionNodeId(innerLoop.returnIndex)}→${formatInstructionNodeId(innerLoop.headerIndex)}`,
        outerReturnEdge: `${formatInstructionNodeId(outerLoop.returnIndex)}→${formatInstructionNodeId(outerLoop.headerIndex)}`,
        sideExitContinuation: sideExitEdge
          ? `${formatInstructionNodeId(sideExitEdge.sourceIndex)}→${formatInstructionNodeId(sideExitEdge.targetIndex)}`
          : null,
        sideExitRole: sideExitKind,
        resultBranch: resultBranchRegion
          ? `${formatInstructionNodeId(resultBranchRegion.startIndex)}-${formatInstructionNodeId(resultBranchRegion.endIndex)}`
          : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startIndex - right.startIndex);

  const embeddedNestedLoopBlocksMotif = {
    kind: "embeddedNestedLoopBlocks",
    detected: embeddedNestedLoopBlocks.length > 0,
    blocks: embeddedNestedLoopBlocks,
  };
  motifs.push(embeddedNestedLoopBlocksMotif);

  const unconditionalBackwardEdges = analysis.edges.filter((edge) => (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex < edge.sourceIndex &&
    analysis.nodeRoles[edge.sourceIndex] === "unconditionalJump"
  ));
  const compactLoopDetected = !nestedLoopDetected &&
    unconditionalLoops.length === 1 &&
    unconditionalLoops.every((interval) => interval.depth === 0) &&
    unconditionalBackwardEdges.length === 1 &&
    localReturnEdges.length === 1 &&
    outerReturnEdges.length === 0;
  const compactLoop = unconditionalLoops[0] ?? null;
  const compactReturnEdge = compactLoop
    ? analysis.edges.find((edge) => edge.id === compactLoop.edgeId) ??
      unconditionalBackwardEdges[0] ??
      null
    : null;
  const compactReturnRouted = compactReturnEdge ? routedEdgeById.get(compactReturnEdge.id) : null;
  const compactLoopMotif = {
    kind: "compactLinearLoop",
    detected: compactLoopDetected,
    guardNode: compactLoop && Number.isInteger(compactLoop.headerIndex)
      ? formatInstructionNodeId(compactLoop.headerIndex)
      : null,
    bodyNodes: compactLoop
      ? rangeIndexes(compactLoop.startIndex, compactLoop.endIndex).map(formatInstructionNodeId)
      : [],
    returnEdge: compactReturnEdge
      ? `${formatInstructionNodeId(compactReturnEdge.sourceIndex)}→${formatInstructionNodeId(compactReturnEdge.targetIndex)}`
      : null,
    laneSide: compactReturnRouted ? getEdgeFirstDirection(compactReturnRouted) : "unknown",
    laneOffset: compactReturnRouted && compactReturnRouted.points?.[1]
      ? Number(Math.abs(compactReturnRouted.points[1][0] - compactReturnRouted.points[0][0]).toFixed(1))
      : null,
  };
  motifs.push(compactLoopMotif);
  if (compactLoopMotif.detected) detectedMotifKinds.add("compactLinearLoop");

  if (Number.isInteger(firstDecisionIndex)) {
    const outgoing = (outgoingBySource.get(firstDecisionIndex) ?? []).map((edge) => {
      const targetIndex = Number.isInteger(edge.targetIndex) ? edge.targetIndex : null;
      const targetNodeRole = Number.isInteger(targetIndex)
        ? visualRoles.nodeRoleByIndex?.[targetIndex] ?? null
        : null;

      return {
        edgeId: edge.id,
        target: Number.isInteger(targetIndex) ? formatInstructionNodeId(targetIndex) : "HALT",
        flowRole: edgeRoleById[edge.id]?.flowRole ?? null,
        role: edgeRoleById[edge.id]?.role ?? null,
        targetKind: !Number.isInteger(targetIndex)
          ? "halt"
          : targetNodeRole === "bodyActionNode"
            ? "body"
            : targetNodeRole === "continuationNode" || targetNodeRole === "tailNode"
              ? "continuation"
              : "resultOrOther",
      };
    });

    const motif = {
      kind: "mainDecisionAnchor",
      detected: outgoing.length >= 2,
      decisionNode: formatInstructionNodeId(firstDecisionIndex),
      outgoingEdges: outgoing,
    };
    motifs.push(motif);
    if (motif.detected) detectedMotifKinds.add("mainDecisionAnchor");
  } else {
    motifs.push({ kind: "mainDecisionAnchor", detected: false });
  }

  const sideExits = analysis.edges.filter((edge) => {
    if (!Number.isInteger(edge.sourceIndex) || !Number.isInteger(edge.targetIndex)) return false;
    if (edge.targetIndex <= edge.sourceIndex) return false;
    if (analysis.nodeRoles[edge.sourceIndex] !== "conditionalJump") return false;
    if (isHaltExitEdge(edge, analysis.program.length)) return false;

    const role = edgeRoleById[edge.id]?.role;
    const flowRole = edgeRoleById[edge.id]?.flowRole;
    if (flowRole === "continuation" || role === "continuationEntry" || role === "decisionExit") {
      return true;
    }

    const targetRegionRole = visualRoles.nodeRoleByIndex?.[edge.targetIndex] ?? null;
    return targetRegionRole === "continuationNode" || targetRegionRole === "tailNode";
  });
  const sideExitMotif = {
    kind: "sideExitContinuation",
    detected: sideExits.length > 0,
    edges: sideExits.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      return {
        edgeId: edge.id,
        source: Number.isInteger(edge.sourceIndex) ? formatInstructionNodeId(edge.sourceIndex) : edge.from,
        target: Number.isInteger(edge.targetIndex) ? formatInstructionNodeId(edge.targetIndex) : edge.to,
        side: routed ? getEdgeFirstDirection(routed) : "unknown",
        bends: routed ? getEdgeBendCount(routed.points) : null,
      };
    }),
  };
  motifs.push(sideExitMotif);
  if (sideExitMotif.detected) detectedMotifKinds.add("sideExitContinuation");

  const resultBranchEdges = sideExits.filter((edge) => {
    const targetIndex = edge.targetIndex;
    if (!Number.isInteger(targetIndex)) return false;

    const targetRole = visualRoles.nodeRoleByIndex?.[targetIndex];
    if (targetRole !== "continuationNode" && targetRole !== "tailNode") return false;

    const containingLoops = loopIntervals.filter((interval) => (
      interval.startIndex <= edge.sourceIndex && edge.sourceIndex <= interval.endIndex
    ));
    const targetInsideSameLoop = containingLoops.some((interval) => (
      interval.startIndex <= targetIndex && targetIndex <= interval.endIndex
    ));
    if (targetInsideSameLoop) return false;

    if (nestedLoopDetected && innerLoopCandidate) {
      if (innerLoopCandidate.startIndex <= targetIndex && targetIndex <= innerLoopCandidate.endIndex) {
        return false;
      }
    }

    return true;
  });
  const resultBranchMotif = {
    kind: "resultBranch",
    detected: resultBranchEdges.length > 0,
    branches: resultBranchEdges.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      const targetIndex = edge.targetIndex;
      const region = postCoreRegions.find(
        (candidate) => candidate.startIndex <= targetIndex && targetIndex <= candidate.endIndex,
      );
      const branchNodes = region
        ? rangeIndexes(region.startIndex, region.endIndex).map(formatInstructionNodeId)
        : [formatInstructionNodeId(targetIndex)];

      return {
        branchSource: formatInstructionNodeId(edge.sourceIndex),
        branchNodes,
        branchSide: routed ? getEdgeFirstDirection(routed) : "unknown",
        exitEdge: edge.id,
      };
    }),
  };
  motifs.push(resultBranchMotif);
  if (resultBranchMotif.detected) detectedMotifKinds.add("resultBranch");

  const terminalExits = analysis.edges.filter((edge) => (
    edgeRoleById[edge.id]?.role === "haltExit" &&
    Number.isInteger(edge.sourceIndex) &&
    (
      !Number.isInteger(edge.targetIndex) ||
      edge.targetIndex >= analysis.program.length ||
      String(edge.to).startsWith("halt")
    )
  ));
  const terminalHaltMotif = {
    kind: "terminalHaltExit",
    detected: terminalExits.length > 0,
    edges: terminalExits.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      return {
        source: formatInstructionNodeId(edge.sourceIndex),
        haltTarget: edge.to,
        side: routed ? getEdgeFirstDirection(routed) : "unknown",
        bends: routed ? getEdgeBendCount(routed.points) : null,
        shortRoute: routed ? getPolylineLength(routed.points) <= layoutMaxSpan * 0.55 : null,
      };
    }),
  };
  motifs.push(terminalHaltMotif);
  if (terminalHaltMotif.detected) detectedMotifKinds.add("terminalHaltExit");

  const forwardSkips = analysis.edges.filter((edge) => (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex > edge.sourceIndex + 1 &&
    (
      edgeRoleById[edge.id]?.role === "unconditionalForwardSkip" ||
      analysis.nodeRoles[edge.sourceIndex] === "unconditionalJump" ||
      edge.routeKind === "unconditionalForwardJump"
    ) &&
    !["localReturn", "outerReturn"].includes(edgeRoleById[edge.id]?.role)
  ));
  const forwardSkipMotif = {
    kind: "forwardSkip",
    detected: forwardSkips.length > 0,
    edges: forwardSkips.map((edge) => {
      const routed = routedEdgeById.get(edge.id);
      return {
        source: formatInstructionNodeId(edge.sourceIndex),
        target: formatInstructionNodeId(edge.targetIndex),
        skippedRange: `${formatInstructionNodeId(edge.sourceIndex + 1)}-${formatInstructionNodeId(edge.targetIndex - 1)}`,
        bends: routed ? getEdgeBendCount(routed.points) : null,
        usesReturnLane: ["localReturn", "outerReturn"].includes(edgeRoleById[edge.id]?.role),
      };
    }),
  };
  motifs.push(forwardSkipMotif);
  if (forwardSkipMotif.detected) detectedMotifKinds.add("forwardSkip");

  motifs.push({
    kind: "genericLaneAssignments",
    detected: genericLaneAssignments.enabled,
    skippedReason: genericLaneAssignments.skippedReason ?? null,
    assignments: genericLaneAssignments.rows,
  });

  if (layoutPlan.genericControlFlowBlocksDebug) {
    motifs.push({
      kind: "genericControlFlowBlocks",
      detected: layoutPlan.genericControlFlowBlocksDebug.applied,
      blocks: layoutPlan.genericControlFlowBlocksDebug.blocks ?? [],
      blockEdges: layoutPlan.genericControlFlowBlocksDebug.blockEdges ?? [],
      loopIslandEnvelopes: layoutPlan.genericControlFlowBlocksDebug.loopIslandEnvelopes ?? [],
      attachedSideBlocks: layoutPlan.genericControlFlowBlocksDebug.attachedSideBlocks ?? [],
      sideBlockOwnership: layoutPlan.genericControlFlowBlocksDebug.sideBlockOwnership ?? [],
      decisionRegions: layoutPlan.genericControlFlowBlocksDebug.decisionRegions ?? [],
      preLoopDecisionRegions:
        layoutPlan.genericControlFlowBlocksDebug.preLoopDecisionRegions ?? [],
      decisionRegionOrder:
        layoutPlan.genericControlFlowBlocksDebug.decisionRegionOrder ?? [],
      decisionRegionPlacementWarnings:
        layoutPlan.genericControlFlowBlocksDebug.decisionRegionPlacementWarnings ?? [],
      sideOrTerminalEdgesCrossingLoopEnvelope:
        layoutPlan.genericControlFlowBlocksDebug.sideOrTerminalEdgesCrossingLoopEnvelope ?? [],
      blocksOverlappingNonOwnerLoopEnvelope:
        layoutPlan.genericControlFlowBlocksDebug.blocksOverlappingNonOwnerLoopEnvelope ?? [],
      sideBlocksOutsideOwnerBand:
        layoutPlan.genericControlFlowBlocksDebug.sideBlocksOutsideOwnerBand ?? [],
      hasLoopIslandEnvelopeOverlap:
        layoutPlan.genericControlFlowBlocksDebug.hasLoopIslandEnvelopeOverlap ?? false,
      setupPrefixInterval:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixInterval ?? null,
      setupPrefixNodeIds:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixNodeIds ?? [],
      setupPrefixTopY:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixTopY ?? null,
      setupPrefixBottomY:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixBottomY ?? null,
      setupPrefixContiguous:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixContiguous ?? false,
      setupBlocksMisorderedBeforeFix:
        layoutPlan.genericControlFlowBlocksDebug.setupBlocksMisorderedBeforeFix ?? [],
      setupBlocksMisorderedAfterFix:
        layoutPlan.genericControlFlowBlocksDebug.setupBlocksMisorderedAfterFix ?? [],
      firstMajorAfterSetup:
        layoutPlan.genericControlFlowBlocksDebug.firstMajorAfterSetup ?? null,
      gapFromSetupPrefixToFirstMajor:
        layoutPlan.genericControlFlowBlocksDebug.gapFromSetupPrefixToFirstMajor ?? null,
      setupPrefixOrderingWarnings:
        layoutPlan.genericControlFlowBlocksDebug.setupPrefixOrderingWarnings ?? [],
      majorRegionOrder: layoutPlan.genericControlFlowBlocksDebug.majorRegionOrder ?? [],
      majorRegionVerticalGaps: layoutPlan.genericControlFlowBlocksDebug.majorRegionVerticalGaps ?? [],
      largestVerticalGap: layoutPlan.genericControlFlowBlocksDebug.largestVerticalGap ?? null,
      firstMajorRegionY: layoutPlan.genericControlFlowBlocksDebug.firstMajorRegionY ?? null,
      setupBottomY: layoutPlan.genericControlFlowBlocksDebug.setupBottomY ?? null,
      gapFromSetupToFirstMajorRegion:
        layoutPlan.genericControlFlowBlocksDebug.gapFromSetupToFirstMajorRegion ?? null,
      hasExcessiveMajorRegionGap:
        layoutPlan.genericControlFlowBlocksDebug.hasExcessiveMajorRegionGap ?? false,
      expectedMajorRegionGap:
        layoutPlan.genericControlFlowBlocksDebug.expectedMajorRegionGap ?? null,
      setupBottomYFinalBeforeCompaction:
        layoutPlan.genericControlFlowBlocksDebug.setupBottomYFinalBeforeCompaction ?? null,
      firstMajorTopYFinalBeforeCompaction:
        layoutPlan.genericControlFlowBlocksDebug.firstMajorTopYFinalBeforeCompaction ?? null,
      finalGapBeforeCompaction:
        layoutPlan.genericControlFlowBlocksDebug.finalGapBeforeCompaction ?? null,
      finalCompactionShift:
        layoutPlan.genericControlFlowBlocksDebug.finalCompactionShift ?? null,
      setupBottomYFinalAfterCompaction:
        layoutPlan.genericControlFlowBlocksDebug.setupBottomYFinalAfterCompaction ?? null,
      firstMajorTopYFinalAfterCompaction:
        layoutPlan.genericControlFlowBlocksDebug.firstMajorTopYFinalAfterCompaction ?? null,
      finalGapAfterCompaction:
        layoutPlan.genericControlFlowBlocksDebug.finalGapAfterCompaction ?? null,
      nodesShiftedCount:
        layoutPlan.genericControlFlowBlocksDebug.nodesShiftedCount ?? 0,
      shiftedStartIndex:
        layoutPlan.genericControlFlowBlocksDebug.shiftedStartIndex ?? null,
      shiftedIntervals:
        layoutPlan.genericControlFlowBlocksDebug.shiftedIntervals ?? [],
      includedProtectedNodesInShift:
        layoutPlan.genericControlFlowBlocksDebug.includedProtectedNodesInShift ?? false,
      includedAttachedSideNodesInShift:
        layoutPlan.genericControlFlowBlocksDebug.includedAttachedSideNodesInShift ?? false,
      includedTerminalNodesInShift:
        layoutPlan.genericControlFlowBlocksDebug.includedTerminalNodesInShift ?? false,
      includedSyntheticTerminalNodesInShift:
        layoutPlan.genericControlFlowBlocksDebug.includedSyntheticTerminalNodesInShift ?? false,
      firstMajorRegionInterval:
        layoutPlan.genericControlFlowBlocksDebug.firstMajorRegionInterval ?? null,
      finalCompactionWarnings:
        layoutPlan.genericControlFlowBlocksDebug.finalCompactionWarnings ?? [],
      mergeNodePromotions:
        layoutPlan.genericControlFlowBlocksDebug.mergeNodePromotions ?? [],
      placement: layoutPlan.genericControlFlowBlocksDebug.status ?? "unknown",
      beforeBounds: layoutPlan.genericControlFlowBlocksDebug.beforeBounds ?? null,
      afterBounds: layoutPlan.genericControlFlowBlocksDebug.afterBounds ?? null,
      heightReduction: layoutPlan.genericControlFlowBlocksDebug.heightReduction ?? null,
      widthIncrease: layoutPlan.genericControlFlowBlocksDebug.widthIncrease ?? null,
      fallbackStatus: layoutPlan.genericControlFlowBlocksDebug.fallbackStatus ?? "none",
      warning: layoutPlan.genericControlFlowBlocksDebug.warning ?? null,
    });
  }

  if (layoutPlan.regionBlockPackingDebug) {
    motifs.push({
      kind: "regionBlockPacking",
      detected: true,
      ...layoutPlan.regionBlockPackingDebug,
    });
  }

  analysis.edges.forEach((edge) => {
    const routed = routedEdgeById.get(edge.id);
    const edgeRole = edgeRoleById[edge.id]?.role;
    const flowRole = edgeRoleById[edge.id]?.flowRole;
    const isBackward = Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex < edge.sourceIndex;
    const isForward = Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex;
    const bends = routed ? getEdgeBendCount(routed.points) : 0;

    if (isBackward && !["localReturn", "outerReturn"].includes(edgeRole)) {
      warnings.push(`Backward edge ${edge.id} lacks local/outer return classification.`);
    }
    if (edgeRole === "haltExit" && ["localReturn", "outerReturn"].includes(flowRole)) {
      warnings.push(`Halt edge ${edge.id} uses return-lane-like flow role.`);
    }
    if (edgeRole === "haltExit" && routed?.points) {
      const routeLength = getPolylineLength(routed.points);
      if (routeLength > layoutMaxSpan * 0.65) {
        warnings.push(`Terminal exit ${edge.id} is longer than expected for a short HALT route.`);
      }
    }
    if (edge.branch && bends > 2) {
      warnings.push(`Branch edge ${edge.id} has more than 2 bends (${bends}).`);
    }
    if (
      genericRegionModel &&
      edge.type === "fallthrough" &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      !genericRegionModel.isProtectedIndex(edge.sourceIndex) &&
      !genericRegionModel.isProtectedIndex(edge.targetIndex) &&
      !genericRegionModel.isAttachedIndex?.(edge.sourceIndex) &&
      !genericRegionModel.isAttachedIndex?.(edge.targetIndex)
    ) {
      const sourceRegionId = genericRegionModel.genericRegionIdByIndex.get(edge.sourceIndex);
      const targetRegionId = genericRegionModel.genericRegionIdByIndex.get(edge.targetIndex);
      if (
        Number.isInteger(sourceRegionId) &&
        sourceRegionId === targetRegionId &&
        routed?.points?.length
      ) {
        const startX = routed.points[0][0];
        const endX = routed.points.at(-1)[0];
        if (Math.abs(startX - endX) > 1.5) {
          warnings.push(`Generic-region fallthrough edge ${edge.id} is not vertical.`);
        }
      }
    }
    if (routed?.points) {
      for (let i = 1; i < routed.points.length; i += 1) {
        const [x0, y0] = routed.points[i - 1];
        const [x1, y1] = routed.points[i];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.01 && Math.abs(dy) > 0.01 && len > 90) {
          const ratio = Math.abs(dy / dx);
          if (ratio < 0.5) {
            warnings.push(`Edge ${edge.id} contains a long shallow diagonal segment.`);
            break;
          }
        }
      }
    }
    if (edge.branch && !["localReturn", "outerReturn"].includes(edgeRole) && routed?.points?.length >= 4) {
      const xs = routed.points.map(([x]) => x);
      const ys = routed.points.map(([, y]) => y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      if (spanX > layoutPlan.layout.localBranchTargetOffset * 1.6 && spanY > layoutPlan.layout.verticalGap * 1.2) {
        warnings.push(`Branch edge ${edge.id} uses a large rectangular lane-like path.`);
      }
    }
    if (isForward && ["localReturn", "outerReturn"].includes(edgeRole)) {
      warnings.push(`Forward edge ${edge.id} is classified as return-like geometry.`);
    }
    if (
      protectedBlockBounds.length > 0 &&
      routed?.points?.length &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex)
    ) {
      const crossesProtected = protectedBlockBounds.some((bounds) => {
        const sourceInside = bounds.startIndex <= edge.sourceIndex && edge.sourceIndex <= bounds.endIndex;
        const targetInside = bounds.startIndex <= edge.targetIndex && edge.targetIndex <= bounds.endIndex;
        if (sourceInside || targetInside) return false;

        return routed.points.some(([x, y]) => (
          bounds.left <= x && x <= bounds.right && bounds.top <= y && y <= bounds.bottom
        ));
      });

      if (crossesProtected) {
        warnings.push(`Edge ${edge.id} appears to pass through a protected motif block envelope.`);
      }
    }
  });

  if (loopIntervals.length > 0 && !nestedMotif.detected && !compactLoopMotif.detected) {
    warnings.push("Graph has loops but no detected loop motif.");
  }
  if (loopIntervals.length === 0) {
    const hasReturnLike = analysis.edges.some((edge) => ["localReturn", "outerReturn"].includes(edgeRoleById[edge.id]?.role));
    if (hasReturnLike) warnings.push("Graph has no loops but contains return-lane geometry classification.");
  }

  const separationAuditEnabled =
    layoutPlan.layoutMode === "generated" ||
    layoutPlan.layoutMode === "generatedScanV2";
  const shouldBuildGeneratedScanDiagnostics = layoutPlan.layoutMode !== "sketchV1";
  const generatedScanRegionDecomposition = shouldBuildGeneratedScanDiagnostics
    ? layoutPlan.generatedScanRegionDecompositionDebug ??
      buildGeneratedScanRegionDecomposition(
        analysis,
        layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
      )
    : null;
  const generatedScanLayoutPlanDebug = shouldBuildGeneratedScanDiagnostics
    ? layoutPlan.generatedScanLayoutPlanDebug ??
      buildGeneratedScanLayoutPlan(
        generatedScanRegionDecomposition,
        analysis,
        layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
      )
    : null;
  const generatedScanCellLayoutDebug = shouldBuildGeneratedScanDiagnostics
    ? layoutPlan.generatedScanCellLayoutDebug ??
      buildGeneratedScanCellLayout(
        generatedScanLayoutPlanDebug,
        layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
      )
    : null;
  const sketchV1PlacementDebug = layoutPlan.sketchV1PlacementDebug ?? null;
  const sketchV3PlacementDebug = layoutPlan.sketchV3PlacementDebug ?? null;
  const scanV2AuditEnabled =
    layoutPlan.layoutMode === "generatedScanV2" &&
    isBetaFlowAuditDebugEnabled();
  const includeVerboseScanDiagnostics =
    layoutPlan.layoutMode !== "generatedScanV2" ||
    scanV2AuditEnabled;
  const generatedScanV2VisualReadabilityDebug = { available: false, skippedReason: "auditModeDisabled" };
  const generatedScanV2VisualGrammarDebug = { available: false, skippedReason: "auditModeDisabled", hardFailureRules: [] };
  const generatedLocalSideChainPlacementDebug = layoutPlan.generatedLocalSideChainPlacementDebug ?? null;
  const generatedRegionEdgePlanDebug = layoutPlan.generatedRegionEdgePlanDebug ?? null;
  const outerContinuationLaneDebug = layoutPlan.generatedOuterContinuationLaneDebug ?? null;
  const generatedRegionPlanProtectedRerouteDebug =
    layoutPlan.generatedRegionPlanProtectedRerouteDebug ?? null;
  const rerouteDebug = layoutPlan.protectedRegionAwareRerouteDebug ?? null;
  const laneSeparationDebug = layoutPlan.generatedLaneSeparationDebug ?? null;
  const rerouteBeforeEdges = Array.isArray(rerouteDebug?.beforeEdges)
    ? rerouteDebug.beforeEdges
    : null;
  const beforeRoutingEdges = separationAuditEnabled
    ? (rerouteBeforeEdges ?? buildRoutedEdges(
      layoutPlan.edges,
      layoutPlan.nodeMap,
      layoutPlan.layout,
      layoutPlan.analysis,
    ))
    : layoutPlan.edges;
  const beforeRoutingLayoutForAudit = {
    ...layoutPlan,
    edges: beforeRoutingEdges,
  };
  const beforeRoutingLaneAssignments = separationAuditEnabled
    ? buildGenericLaneAssignments(beforeRoutingLayoutForAudit, edgeRoleById)
    : genericLaneAssignments;
  const beforePathSegmentOverlaps = detectPathSegmentOverlaps(
    beforeRoutingEdges,
    edgeRoleById,
    beforeRoutingLaneAssignments.byEdgeId ?? {},
  );
  const pathSegmentOverlaps = detectPathSegmentOverlaps(
    layoutPlan.edges,
    edgeRoleById,
    genericLaneAssignments.byEdgeId,
  );
  pathSegmentOverlaps.forbiddenOverlaps.forEach((overlap) => {
    if (overlap.orientation === "horizontal") {
      warnings.push(
        `Forbidden path merge: edge ${overlap.edgeA} and edge ${overlap.edgeB} share horizontal segment y=${overlap.lineCoord}, x=${overlap.overlapStart}-${overlap.overlapEnd} (${overlap.overlapCause})`,
      );
      return;
    }

    warnings.push(
      `Forbidden path merge: edge ${overlap.edgeA} and edge ${overlap.edgeB} share vertical segment x=${overlap.lineCoord}, y=${overlap.overlapStart}-${overlap.overlapEnd} (${overlap.overlapCause})`,
    );
  });
  motifs.push({
    kind: "pathSegmentOverlap",
    detected: pathSegmentOverlaps.forbiddenOverlaps.length > 0,
    forbiddenOverlaps: pathSegmentOverlaps.forbiddenOverlaps,
    allowedTerminalMerges: pathSegmentOverlaps.allowedTerminalMerges,
    beforeRoutingForbiddenOverlaps: beforePathSegmentOverlaps.forbiddenOverlaps,
    beforeRoutingAllowedTerminalMerges: beforePathSegmentOverlaps.allowedTerminalMerges,
  });
  const beforeRoutingSeparationAudit = separationAuditEnabled
    ? buildSeparationAndOverlapAudit({
      layoutPlan: beforeRoutingLayoutForAudit,
      routedEdges: beforeRoutingEdges,
      analysis,
      visualRoles,
      edgeRoleById,
      nodeLookup,
      laneAssignmentsByEdgeId: beforeRoutingLaneAssignments.byEdgeId,
      pathSegmentOverlaps: beforePathSegmentOverlaps,
    })
    : {
      enabled: false,
      protectedRegions: [],
      edgeCorridors: [],
      findings: [],
      severityCounts: { high: 0, medium: 0, low: 0 },
    };
  const afterRoutingSeparationAudit = separationAuditEnabled
    ? buildSeparationAndOverlapAudit({
      layoutPlan,
      routedEdges: layoutPlan.edges,
      analysis,
      visualRoles,
      edgeRoleById,
      nodeLookup,
      laneAssignmentsByEdgeId: genericLaneAssignments.byEdgeId,
      pathSegmentOverlaps,
    })
    : {
      enabled: false,
      protectedRegions: [],
      edgeCorridors: [],
      findings: [],
      severityCounts: { high: 0, medium: 0, low: 0 },
    };
  const separationAuditComparison = buildSeparationAuditComparisonSummary(
    beforeRoutingSeparationAudit,
    afterRoutingSeparationAudit,
  );
  motifs.push({
    kind: "separationOverlapAudit",
    detected: afterRoutingSeparationAudit.findings.length > 0,
    enabled: afterRoutingSeparationAudit.enabled,
    beforeRoutingSeparationAudit,
    afterRoutingSeparationAudit,
    comparison: separationAuditComparison,
  });
  if (generatedRegionEdgePlanDebug) {
    const generatedRegionEdgePlanComparison = buildGeneratedRegionEdgePlanComparison({
      layoutPlan,
      regionEdgePlan: generatedRegionEdgePlanDebug,
      laneAssignmentsByEdgeId: genericLaneAssignments.byEdgeId ?? {},
      protectedRegions: afterRoutingSeparationAudit.protectedRegions ?? [],
      separationFindings: afterRoutingSeparationAudit.findings ?? [],
    });
    motifs.push({
      kind: "generatedRegionEdgePlan",
      enabled: generatedRegionEdgePlanDebug.enabled ?? false,
      skippedReason: generatedRegionEdgePlanDebug.skippedReason ?? null,
      rows: generatedRegionEdgePlanDebug.rows ?? [],
      summary: generatedRegionEdgePlanDebug.summary ?? null,
      protectedRegions: generatedRegionEdgePlanDebug.protectedRegions ?? [],
      comparison: generatedRegionEdgePlanComparison,
    });
  }
  if (generatedScanRegionDecomposition) {
    motifs.push({
      kind: "generatedScanRegionDecomposition",
      enabled: generatedScanRegionDecomposition.enabled ?? false,
      skippedReason: generatedScanRegionDecomposition.skippedReason ?? null,
      summary: generatedScanRegionDecomposition.summary ?? null,
      ...(includeVerboseScanDiagnostics ? {
        runs: generatedScanRegionDecomposition.runs ?? [],
        steps: generatedScanRegionDecomposition.steps ?? [],
        pendingForwardJumpEvents:
          generatedScanRegionDecomposition.pendingForwardJumpEvents ?? [],
        resolvedForwardJumpEvents:
          generatedScanRegionDecomposition.resolvedForwardJumpEvents ?? [],
        mergeAttachmentEvents:
          generatedScanRegionDecomposition.mergeAttachmentEvents ?? [],
        backwardClosureEvents:
          generatedScanRegionDecomposition.backwardClosureEvents ?? [],
        candidateRegions: generatedScanRegionDecomposition.candidateRegions ?? [],
        comparisonWithDetectedLoopIntervals:
          generatedScanRegionDecomposition.comparisonWithDetectedLoopIntervals ?? null,
      } : {}),
    });
  }
  if (generatedScanLayoutPlanDebug) {
    motifs.push({
      kind: "generatedScanLayoutPlan",
      enabled: generatedScanLayoutPlanDebug.enabled ?? false,
      skippedReason: generatedScanLayoutPlanDebug.skippedReason ?? null,
      summary: generatedScanLayoutPlanDebug.summary ?? null,
      suggestedMajorLayoutSkeleton:
        generatedScanLayoutPlanDebug.suggestedMajorLayoutSkeleton ?? null,
      ...(includeVerboseScanDiagnostics ? {
        runs: generatedScanLayoutPlanDebug.runs ?? [],
        regions: generatedScanLayoutPlanDebug.regions ?? [],
        edges: generatedScanLayoutPlanDebug.edges ?? [],
        dfsGrammar: generatedScanLayoutPlanDebug.dfsGrammar ?? null,
        sourceRegionComparison:
          generatedScanLayoutPlanDebug.sourceRegionComparison ?? null,
        sourceDetectedLoopIntervals:
          generatedScanLayoutPlanDebug.sourceDetectedLoopIntervals ?? [],
      } : {}),
    });
  }
  if (generatedScanCellLayoutDebug) {
    motifs.push({
      kind: "generatedScanCellLayout",
      enabled: generatedScanCellLayoutDebug.enabled ?? false,
      skippedReason: generatedScanCellLayoutDebug.skippedReason ?? null,
      summary: generatedScanCellLayoutDebug.summary ?? null,
      ...(includeVerboseScanDiagnostics ? {
        cells: generatedScanCellLayoutDebug.cells ?? [],
      } : {}),
    });
  }
  if (sketchV1PlacementDebug && isBetaFlowAuditDebugEnabled()) {
    motifs.push({
      kind: "sketchV1Placement",
      sketchV1Enabled: sketchV1PlacementDebug.sketchV1Enabled ?? false,
      sketchV1FallbackUsed: layoutPlan.sketchV1FallbackUsed ?? false,
      traversalEventCount: sketchV1PlacementDebug.traversalEventCount ?? 0,
      frameTreeDepth: sketchV1PlacementDebug.frameTreeDepth ?? 0,
      frameCount: sketchV1PlacementDebug.frameCount ?? 0,
      recursiveFramePackingUsed: sketchV1PlacementDebug.recursiveFramePackingUsed ?? false,
      additiveRecursiveDfsUsed: sketchV1PlacementDebug.additiveRecursiveDfsUsed ?? false,
      globalRowCursorUsed: sketchV1PlacementDebug.globalRowCursorUsed ?? false,
      coordinatesCommittedOnce: sketchV1PlacementDebug.coordinatesCommittedOnce ?? false,
      nodesMissingSketchFrame: sketchV1PlacementDebug.nodesMissingSketchFrame ?? [],
      invalidSketchCoordinates: sketchV1PlacementDebug.invalidSketchCoordinates ?? [],
      localBBoxSafetyChecksPassed:
        sketchV1PlacementDebug.localBBoxSafetyChecksPassed ?? false,
      broaderEnvelopeFallbackConsulted:
        sketchV1PlacementDebug.broaderEnvelopeFallbackConsulted ?? false,
      pendingYesBranchStackUsed:
        sketchV1PlacementDebug.pendingYesBranchStackUsed ?? false,
      haltExitCount: sketchV1PlacementDebug.haltExitCount ?? 0,
      backwardEdgeCount: sketchV1PlacementDebug.backwardEdgeCount ?? 0,
      sketchReservationCount:
        sketchV1PlacementDebug.sketchReservationCount ?? 0,
      sketchActiveReservationCount:
        sketchV1PlacementDebug.sketchActiveReservationCount ?? 0,
      sketchReservationConflictCount:
        sketchV1PlacementDebug.sketchReservationConflictCount ?? 0,
      sketchRawReservationOverlapCount:
        sketchV1PlacementDebug.sketchRawReservationOverlapCount ?? 0,
      sketchAllowedReservationOverlapCount:
        sketchV1PlacementDebug.sketchAllowedReservationOverlapCount ?? 0,
      sketchExpectedReservationContainmentCount:
        sketchV1PlacementDebug.sketchExpectedReservationContainmentCount ?? 0,
      sketchTrueIllegalReservationConflictCount:
        sketchV1PlacementDebug.sketchTrueIllegalReservationConflictCount ?? 0,
      sketchReservationExpansionCount:
        sketchV1PlacementDebug.sketchReservationExpansionCount ?? 0,
      sketchEdgeReservationCrossingCount:
        sketchV1PlacementDebug.sketchEdgeReservationCrossingCount ?? 0,
      sketchDrawnGeometryLedgerCount:
        sketchV1PlacementDebug.sketchDrawnGeometryLedgerCount ?? 0,
      sketchCandidatePlacementAttemptCount:
        sketchV1PlacementDebug.sketchCandidatePlacementAttemptCount ?? 0,
      sketchCandidateRejectionCount:
        sketchV1PlacementDebug.sketchCandidateRejectionCount ?? 0,
      sketchCommittedEdgeSegmentCount:
        sketchV1PlacementDebug.sketchCommittedEdgeSegmentCount ?? 0,
      sketchVisibleEdgeCrossesNodeBox:
        sketchV1PlacementDebug.sketchVisibleEdgeCrossesNodeBox ?? false,
      sketchVisibleEdgeNodeBoxCrossingCount:
        sketchV1PlacementDebug.sketchVisibleEdgeNodeBoxCrossingCount ?? 0,
      sketchOrdinaryVisibleEdgeCrossesOrdinaryVisibleEdge:
        sketchV1PlacementDebug.sketchOrdinaryVisibleEdgeCrossesOrdinaryVisibleEdge ?? false,
      sketchOrdinaryVisibleEdgeCrossingCount:
        sketchV1PlacementDebug.sketchOrdinaryVisibleEdgeCrossingCount ?? 0,
      sketchExactEdgeOverlapCount:
        sketchV1PlacementDebug.sketchExactEdgeOverlapCount ?? 0,
      sketchPartialEdgeOverlapCount:
        sketchV1PlacementDebug.sketchPartialEdgeOverlapCount ?? 0,
      sketchNearParallelEdgeOverlapCount:
        sketchV1PlacementDebug.sketchNearParallelEdgeOverlapCount ?? 0,
      sketchOrdinaryForwardDiamondExitLShaped:
        sketchV1PlacementDebug.sketchOrdinaryForwardDiamondExitLShaped ?? false,
      sketchAllOrdinaryForwardDiamondExitsStraightDownwardOutwardDiagonals:
        sketchV1PlacementDebug.sketchAllOrdinaryForwardDiamondExitsStraightDownwardOutwardDiagonals ?? false,
      sketchNoYesSideOwnershipPreservedForNewOrdinaryForwardSplits:
        sketchV1PlacementDebug.sketchNoYesSideOwnershipPreservedForNewOrdinaryForwardSplits ?? false,
      sketchNestedSplitDistancesDecreaseByDefault:
        sketchV1PlacementDebug.sketchNestedSplitDistancesDecreaseByDefault ?? false,
      sketchAlreadyPlacedNodeMoved:
        sketchV1PlacementDebug.sketchAlreadyPlacedNodeMoved ?? false,
      sketchNodeBoxCrossesExistingEdgeDuringPlacement:
        sketchV1PlacementDebug.sketchNodeBoxCrossesExistingEdgeDuringPlacement ?? false,
      sketchNodeBoxExistingEdgePlacementRejectionCount:
        sketchV1PlacementDebug.sketchNodeBoxExistingEdgePlacementRejectionCount ?? 0,
      firstPassTopologyPreservingSpacingAdjustmentCount:
        sketchV1PlacementDebug.firstPassTopologyPreservingSpacingAdjustmentCount ?? 0,
      sketchFrameRows: sketchV1PlacementDebug.sketchFrameRows ?? [],
      sketchTraversalRows: sketchV1PlacementDebug.sketchTraversalRows ?? [],
      sketchOwnershipRows: sketchV1PlacementDebug.sketchOwnershipRows ?? [],
      sketchLocalBBoxSafetyRows: sketchV1PlacementDebug.sketchLocalBBoxSafetyRows ?? [],
      sketchDfsVisitRows: sketchV1PlacementDebug.sketchDfsVisitRows ?? [],
      sketchPendingYesStackRows:
        sketchV1PlacementDebug.sketchPendingYesStackRows ?? [],
      sketchBranchStopRows: sketchV1PlacementDebug.sketchBranchStopRows ?? [],
      sketchBranchClassificationRows:
        sketchV1PlacementDebug.sketchBranchClassificationRows ?? [],
      sketchPlacementRows: sketchV1PlacementDebug.sketchPlacementRows ?? [],
      sketchHaltExitRows: sketchV1PlacementDebug.sketchHaltExitRows ?? [],
      sketchBackwardEdgeRows: sketchV1PlacementDebug.sketchBackwardEdgeRows ?? [],
      sketchSpacingAdjustmentRows:
        sketchV1PlacementDebug.sketchSpacingAdjustmentRows ?? [],
      sketchEdgeIntentRows:
        sketchV1PlacementDebug.sketchEdgeIntentRows ?? [],
      sketchDrawnGeometryLedgerRows:
        sketchV1PlacementDebug.sketchDrawnGeometryLedgerRows ?? [],
      sketchDrawnNodeBoxRows:
        sketchV1PlacementDebug.sketchDrawnNodeBoxRows ?? [],
      sketchDrawnEdgeSegmentRows:
        sketchV1PlacementDebug.sketchDrawnEdgeSegmentRows ?? [],
      sketchCandidatePlacementRows:
        sketchV1PlacementDebug.sketchCandidatePlacementRows ?? [],
      sketchCandidateRejectionRows:
        sketchV1PlacementDebug.sketchCandidateRejectionRows ?? [],
      sketchCommittedEdgeSegmentRows:
        sketchV1PlacementDebug.sketchCommittedEdgeSegmentRows ?? [],
      sketchDrawnEdgeNodeBoxCrossingRows:
        sketchV1PlacementDebug.sketchDrawnEdgeNodeBoxCrossingRows ?? [],
      sketchDrawnOrdinaryEdgeCrossingRows:
        sketchV1PlacementDebug.sketchDrawnOrdinaryEdgeCrossingRows ?? [],
      sketchExactEdgeOverlapRows:
        sketchV1PlacementDebug.sketchExactEdgeOverlapRows ?? [],
      sketchPartialEdgeOverlapRows:
        sketchV1PlacementDebug.sketchPartialEdgeOverlapRows ?? [],
      sketchNearParallelEdgeOverlapRows:
        sketchV1PlacementDebug.sketchNearParallelEdgeOverlapRows ?? [],
      sketchDiamondExitGrammarRows:
        sketchV1PlacementDebug.sketchDiamondExitGrammarRows ?? [],
      sketchNoYesSideOwnershipRows:
        sketchV1PlacementDebug.sketchNoYesSideOwnershipRows ?? [],
      sketchSplitDistanceRows:
        sketchV1PlacementDebug.sketchSplitDistanceRows ?? [],
      sketchSplitDistanceDecreaseRows:
        sketchV1PlacementDebug.sketchSplitDistanceDecreaseRows ?? [],
      sketchAlreadyPlacedNodeMoveRows:
        sketchV1PlacementDebug.sketchAlreadyPlacedNodeMoveRows ?? [],
      sketchNodeBoxExistingEdgePlacementRejectionRows:
        sketchV1PlacementDebug.sketchNodeBoxExistingEdgePlacementRejectionRows ?? [],
      sketchBackwardRoutingDecisionRows:
        sketchV1PlacementDebug.sketchBackwardRoutingDecisionRows ?? [],
      sketchFinalHaltRoutingRows:
        sketchV1PlacementDebug.sketchFinalHaltRoutingRows ?? [],
      sketchReservationRows:
        sketchV1PlacementDebug.sketchReservationRows ?? [],
      sketchActiveReservationRows:
        sketchV1PlacementDebug.sketchActiveReservationRows ?? [],
      sketchReservationConflictRows:
        sketchV1PlacementDebug.sketchReservationConflictRows ?? [],
      sketchRawReservationOverlapRows:
        sketchV1PlacementDebug.sketchRawReservationOverlapRows ?? [],
      sketchAllowedReservationOverlapRows:
        sketchV1PlacementDebug.sketchAllowedReservationOverlapRows ?? [],
      sketchExpectedReservationContainmentRows:
        sketchV1PlacementDebug.sketchExpectedReservationContainmentRows ?? [],
      sketchTrueIllegalReservationConflictRows:
        sketchV1PlacementDebug.sketchTrueIllegalReservationConflictRows ?? [],
      sketchAttemptedRawReservationOverlapRows:
        sketchV1PlacementDebug.sketchAttemptedRawReservationOverlapRows ?? [],
      sketchAttemptedAllowedReservationOverlapRows:
        sketchV1PlacementDebug.sketchAttemptedAllowedReservationOverlapRows ?? [],
      sketchReservationExpansionRows:
        sketchV1PlacementDebug.sketchReservationExpansionRows ?? [],
      sketchLoopCorridorRows:
        sketchV1PlacementDebug.sketchLoopCorridorRows ?? [],
      sketchHaltCorridorRows:
        sketchV1PlacementDebug.sketchHaltCorridorRows ?? [],
      sketchEdgeReservationCrossingRows:
        sketchV1PlacementDebug.sketchEdgeReservationCrossingRows ?? [],
      sketchAdditiveDfsParameters:
        sketchV1PlacementDebug.sketchAdditiveDfsParameters ?? null,
    });
  }
  if (layoutPlan.sketchV1FallbackDiagnostics && isBetaFlowAuditDebugEnabled()) {
    motifs.push({
      kind: "sketchV1FallbackDiagnostics",
      sketchV1FallbackUsed: layoutPlan.sketchV1FallbackUsed ?? false,
      sketchV1FallbackReason: layoutPlan.sketchV1FallbackReason ?? null,
      ...layoutPlan.sketchV1FallbackDiagnostics,
    });
  }
  if (sketchV3PlacementDebug && isBetaFlowAuditDebugEnabled()) {
    motifs.push({
      kind: "sketchV3Placement",
      sketchV3Enabled: sketchV3PlacementDebug.sketchV3Enabled ?? false,
      sketchV3FallbackUsed: layoutPlan.sketchV3FallbackUsed ?? false,
      sketchV3FallbackReason: layoutPlan.sketchV3FallbackReason ?? null,
      sketchV3DrawingState: sketchV3PlacementDebug.sketchV3DrawingState ?? null,
      sketchV3NodeRecords: sketchV3PlacementDebug.sketchV3NodeRecords ?? [],
      sketchV3EdgeRecords: sketchV3PlacementDebug.sketchV3EdgeRecords ?? [],
      sketchV3DiamondRecords: sketchV3PlacementDebug.sketchV3DiamondRecords ?? [],
      sketchV3BranchPathRows: sketchV3PlacementDebug.sketchV3BranchPathRows ?? [],
      sketchV3PendingBranchRows: sketchV3PlacementDebug.sketchV3PendingBranchRows ?? [],
      sketchV3PendingCorridorLifecycleRows:
        sketchV3PlacementDebug.sketchV3PendingCorridorLifecycleRows ?? [],
      sketchV3HaltExitRecords:
        sketchV3PlacementDebug.sketchV3HaltExitRecords ?? [],
      sketchV3OrdinaryDiamondSplitExitNotStraightFixedAngle:
        sketchV3PlacementDebug.sketchV3OrdinaryDiamondSplitExitNotStraightFixedAngle ?? false,
      sketchV3OrdinaryDiamondSplitExitLShaped:
        sketchV3PlacementDebug.sketchV3OrdinaryDiamondSplitExitLShaped ?? false,
      sketchV3NoYesSideOwnershipPreserved:
        sketchV3PlacementDebug.sketchV3NoYesSideOwnershipPreserved ?? false,
      sketchV3DiamondExitRows: sketchV3PlacementDebug.sketchV3DiamondExitRows ?? [],
      sketchV3NonStraightDiamondExitRows:
        sketchV3PlacementDebug.sketchV3NonStraightDiamondExitRows ?? [],
      sketchV3LShapedDiamondExitRows:
        sketchV3PlacementDebug.sketchV3LShapedDiamondExitRows ?? [],
      sketchV3NoYesSideOwnershipRows:
        sketchV3PlacementDebug.sketchV3NoYesSideOwnershipRows ?? [],
      sketchV3LoopReturnRows:
        sketchV3PlacementDebug.sketchV3LoopReturnRows ?? [],
      sketchV3LoopReturnBelowClearanceRows:
        sketchV3PlacementDebug.sketchV3LoopReturnBelowClearanceRows ?? [],
      sketchV3LoopReturnDiamondObstacleRows:
        sketchV3PlacementDebug.sketchV3LoopReturnDiamondObstacleRows ?? [],
      sketchV3LoopReturnSplitExitLaneConflictRows:
        sketchV3PlacementDebug.sketchV3LoopReturnSplitExitLaneConflictRows ?? [],
      sketchV3LoopReturnUnrelatedEdgeLaneConflictRows:
        sketchV3PlacementDebug.sketchV3LoopReturnUnrelatedEdgeLaneConflictRows ?? [],
      sketchV3PlacementRejectionRows:
        sketchV3PlacementDebug.sketchV3PlacementRejectionRows ?? [],
      sketchV3DeferredHaltRows:
        sketchV3PlacementDebug.sketchV3DeferredHaltRows ?? [],
      sketchV3DeferredHaltConflictRows:
        sketchV3PlacementDebug.sketchV3DeferredHaltConflictRows ?? [],
      sketchV3HaltCommittedBeforeOrdinaryPlacementComplete:
        sketchV3PlacementDebug.sketchV3HaltCommittedBeforeOrdinaryPlacementComplete ?? false,
      sketchV3SharedHaltNodeId:
        sketchV3PlacementDebug.sketchV3SharedHaltNodeId ?? null,
      sketchV3PlacementRows: sketchV3PlacementDebug.sketchV3PlacementRows ?? [],
      sketchV3TraversalRows: sketchV3PlacementDebug.sketchV3TraversalRows ?? [],
      sketchV3PendingBranchCorridorRows:
        sketchV3PlacementDebug.sketchV3PendingBranchCorridorRows ?? [],
      sketchV3PendingBranchCorridorConflictRows:
        sketchV3PlacementDebug.sketchV3PendingBranchCorridorConflictRows ?? [],
      sketchV3FailureRows: sketchV3PlacementDebug.sketchV3FailureRows ?? [],
    });
  }
  if (layoutPlan.sketchV3FallbackDiagnostics && isBetaFlowAuditDebugEnabled()) {
    motifs.push({
      kind: "sketchV3FallbackDiagnostics",
      sketchV3FallbackUsed: layoutPlan.sketchV3FallbackUsed ?? false,
      sketchV3FallbackReason: layoutPlan.sketchV3FallbackReason ?? null,
      ...layoutPlan.sketchV3FallbackDiagnostics,
    });
  }
  if (generatedScanV2VisualReadabilityDebug.available) {
    motifs.push({
      kind: "generatedScanV2VisualReadability",
      ...generatedScanV2VisualReadabilityDebug,
    });

    if (generatedScanV2VisualReadabilityDebug.excessiveTopWhitespace) {
      warnings.push("GeneratedScanV2 readability failure: excessive top whitespace before first instruction node.");
    }
    if (generatedScanV2VisualReadabilityDebug.graphTooSmallForCanvas) {
      warnings.push("GeneratedScanV2 readability failure: graph content occupies too little of the canvas height.");
    }
    if (generatedScanV2VisualReadabilityDebug.graphVerticallyMiscentered) {
      warnings.push("GeneratedScanV2 readability failure: graph center is vertically miscentered in the canvas.");
    }
    if (generatedScanV2VisualReadabilityDebug.excessiveLongEdges) {
      warnings.push("GeneratedScanV2 readability failure: too many long edges relative to local node spacing.");
    }
    if ((generatedScanV2VisualReadabilityDebug.unreadableNodeCount ?? 0) > 0) {
      warnings.push("GeneratedScanV2 readability failure: rendered nodes are below readability threshold.");
    }
  } else if (layoutPlan.layoutMode === "generatedScanV2") {
    motifs.push({
      kind: "generatedScanV2VisualReadability",
      available: false,
      skippedReason: generatedScanV2VisualReadabilityDebug.skippedReason ?? "unavailable",
    });
  }
  if (generatedScanV2VisualGrammarDebug.available) {
    motifs.push({
      kind: "generatedScanV2VisualGrammar",
      ...generatedScanV2VisualGrammarDebug,
    });
    (generatedScanV2VisualGrammarDebug.hardFailureRules ?? []).forEach((rule) => {
      warnings.push(`GeneratedScanV2 visual grammar hard failure: ${rule}.`);
    });
  } else if (layoutPlan.layoutMode === "generatedScanV2") {
    motifs.push({
      kind: "generatedScanV2VisualGrammar",
      available: false,
      skippedReason: generatedScanV2VisualGrammarDebug.skippedReason ?? "unavailable",
    });
  }
  if (generatedLocalSideChainPlacementDebug) {
    const renderedLocalSideChainAudit = buildGeneratedLocalSideChainRenderedAudit(
      layoutPlan,
      generatedLocalSideChainPlacementDebug,
    );
    motifs.push({
      kind: "generatedLocalSideChainPlacement",
      enabled: generatedLocalSideChainPlacementDebug.enabled ?? false,
      skippedReason: generatedLocalSideChainPlacementDebug.skippedReason ?? null,
      detectedTriples: generatedLocalSideChainPlacementDebug.detectedTriples ?? [],
      appliedCount: generatedLocalSideChainPlacementDebug.appliedCount ?? 0,
      fakeThirdExitBeforeCount: generatedLocalSideChainPlacementDebug.fakeThirdExitBeforeCount ?? 0,
      fakeThirdExitAfterCount: generatedLocalSideChainPlacementDebug.fakeThirdExitAfterCount ?? 0,
      renderedAudit: renderedLocalSideChainAudit,
      passContext: {
        layoutMode: layoutPlan.layoutMode ?? analysis.layoutMode ?? "unknown",
        selectedExampleName: analysis.debugIdentity?.selectedExampleName ?? null,
        layoutStatus: analysis.debugIdentity?.layoutStatus ?? null,
        hasTunedLayout: analysis.debugIdentity?.hasTunedLayout ?? null,
      },
    });
  }
  if (rerouteDebug) {
    motifs.push({
      kind: "protectedRegionAwareReroute",
      enabled: rerouteDebug.enabled ?? false,
      skippedReason: rerouteDebug.skippedReason ?? null,
      appliedCount: rerouteDebug.appliedCount ?? 0,
      attempts: rerouteDebug.attempts ?? [],
    });
  }
  if (outerContinuationLaneDebug) {
    motifs.push({
      kind: "generatedOuterContinuationLanes",
      enabled: outerContinuationLaneDebug.enabled ?? false,
      skippedReason: outerContinuationLaneDebug.skippedReason ?? null,
      appliedCount: outerContinuationLaneDebug.appliedCount ?? 0,
      attempts: outerContinuationLaneDebug.attempts ?? [],
      beforeAudit: outerContinuationLaneDebug.beforeAudit ?? null,
      afterAudit: outerContinuationLaneDebug.afterAudit ?? null,
      comparison: outerContinuationLaneDebug.auditComparison ?? null,
      rejectionReasonSummaryByEdgeRole: outerContinuationLaneDebug.rejectionReasonSummaryByEdgeRole ?? {},
      rejectionDeltaSummaryByKind: outerContinuationLaneDebug.rejectionDeltaSummaryByKind ?? {},
    });
  }
  if (generatedRegionPlanProtectedRerouteDebug) {
    motifs.push({
      kind: "generatedRegionPlanProtectedReroute",
      enabled: generatedRegionPlanProtectedRerouteDebug.enabled ?? false,
      skippedReason: generatedRegionPlanProtectedRerouteDebug.skippedReason ?? null,
      appliedCount: generatedRegionPlanProtectedRerouteDebug.appliedCount ?? 0,
      attempts: generatedRegionPlanProtectedRerouteDebug.attempts ?? [],
      beforeAudit: generatedRegionPlanProtectedRerouteDebug.beforeAudit ?? null,
      afterAudit: generatedRegionPlanProtectedRerouteDebug.afterAudit ?? null,
      comparison: generatedRegionPlanProtectedRerouteDebug.auditComparison ?? null,
      beforeCrossedAvoidPlanViolationCount:
        generatedRegionPlanProtectedRerouteDebug.beforeCrossedAvoidPlanViolationCount ?? null,
      afterCrossedAvoidPlanViolationCount:
        generatedRegionPlanProtectedRerouteDebug.afterCrossedAvoidPlanViolationCount ?? null,
    });
  }
  if (laneSeparationDebug) {
    motifs.push({
      kind: "generatedLaneSeparation",
      enabled: laneSeparationDebug.enabled ?? false,
      skippedReason: laneSeparationDebug.skippedReason ?? null,
      appliedCount: laneSeparationDebug.appliedCount ?? 0,
      attempts: laneSeparationDebug.attempts ?? [],
    });
  }
  afterRoutingSeparationAudit.findings.forEach((finding) => {
    const edgeLabel = finding.edgeIds?.length
      ? `edges ${finding.edgeIds.join(", ")}`
      : "edges n/a";
    const regionLabel = finding.regionIds?.length
      ? ` regions ${finding.regionIds.join(", ")}`
      : "";
    warnings.push(
      `[${finding.severity}] ${finding.kind}: ${edgeLabel}${regionLabel} | fix=${finding.suggestedFixCategory ?? "n/a"}`,
    );
  });

  const signatureOrder = [
    "verticalSetupSpine",
    "compactLinearLoop",
    "nestedLoopMotif",
    "localReturnLane",
    "outerReturnLane",
    "sideExitContinuation",
    "resultBranch",
    "forwardSkip",
    "terminalHaltExit",
    "mainDecisionAnchor",
  ];
  const signature = signatureOrder.filter((kind) => detectedMotifKinds.has(kind)).join(" + ");

  return {
    identity,
    summary: {
      selectedFunctionId,
      selectedExampleName: identity.selectedExampleName,
      layoutMode: layoutPlan.layoutMode ?? analysis.layoutMode ?? "tuned",
      effectiveGeneratedLayoutMode: identity.effectiveGeneratedLayoutMode ?? null,
      generatedStrategy: identity.generatedStrategy ?? null,
      generatedScanV2FallbackUsed: layoutPlan.generatedScanV2FallbackUsed ?? false,
      generatedScanV2FallbackReason: layoutPlan.generatedScanV2FallbackReason ?? null,
      sketchV1FallbackUsed: layoutPlan.sketchV1FallbackUsed ?? false,
      sketchV1FallbackReason: layoutPlan.sketchV1FallbackReason ?? null,
      sketchV3FallbackUsed: layoutPlan.sketchV3FallbackUsed ?? false,
      sketchV3FallbackReason: layoutPlan.sketchV3FallbackReason ?? null,
      hasTunedLayout: identity.hasTunedLayout ?? null,
      layoutStatus: identity.layoutStatus ?? null,
      generatedScanV2VisuallyReadable:
        layoutPlan.layoutMode === "generatedScanV2" && generatedScanV2VisualGrammarDebug.available
          ? generatedScanV2VisualGrammarDebug.generatedScanV2VisuallyReadable
          : null,
      motifKind: layoutPlan.motif.kind,
      instructionCount: analysis.program.length,
      renderedEdgeCount: layoutPlan.edges.length,
      grammarSignature: signature || "not detected",
      branchMergeRegionCount: branchMergeRows.length,
      branchMergeAuditDecisionCount: branchMergeAuditRows.length,
      conditionalDecisionCount: branchMergeDataFlow.conditionalDecisionCount,
      detectBranchMergeRegionsCalled: branchMergeDataFlow.detectBranchMergeRegionsCalled,
    },
    motifs,
    warnings,
    branchMergeDataFlow,
    compact: {
      graph: selectedFunctionId || layoutPlan.motif.kind,
      detectedMotifs: signatureOrder.filter((kind) => detectedMotifKinds.has(kind)),
      signature: signature || "not detected",
    },
  };
}

function emitVisualGeometryDebugReport(layoutPlan, selectedFunctionId = "") {
  const report = classifyVisualGeometry(layoutPlan, selectedFunctionId);

  if (typeof console !== "undefined") {
    console.groupCollapsed(
      `[beta-flow-geometry] ${selectedFunctionId || "unknown"} | motif=${report.summary.motifKind}`,
    );
    console.log(report.summary);
    console.log("Graph signature:", report.compact.signature);
    console.log("Compact summary:", report.compact);
    console.table(report.motifs);
    if (report.warnings.length > 0) {
      console.warn("Geometry warnings:", report.warnings);
    }
    console.groupEnd();
  }

  if (typeof window !== "undefined") {
    window.__betaFlowGeometry = report;
    appendBetaFlowDebugReportHistory(
      "geometry",
      report.identity,
      report.summary,
      buildDebugHistoryDiagnostics("geometry", report),
    );
  }
}

function renderNodeShape(node, layout, offsetX, offsetY) {
  const x = safeSvgCoordinate(node.x + offsetX);
  const y = safeSvgCoordinate(node.y + offsetY);
  const { width, height } = getNodeSize(node, layout);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const className = `beta-flow-node-shape beta-flow-node-${node.kind}`;

  if (node.kind === "start" || node.kind === "halt") {
    return null;
  }

  if (node.kind === "conditionalJump") {
    const points = [
      [x, y - halfHeight],
      [x + halfWidth, y],
      [x, y + halfHeight],
      [x - halfWidth, y],
    ];

    return <polygon className={className} points={pointsToString(points, 0, 0)} />;
  }

  return (
    <rect
      className={className}
      x={x - halfWidth}
      y={y - halfHeight}
      width={width}
      height={height}
      rx="2"
      ry="2"
    />
  );
}

function renderMathNodeLabel(node, layout, offsetX, offsetY) {
  const { width, height } = getNodeSize(node, layout);
  const x = safeSvgCoordinate(node.x + offsetX);
  const y = safeSvgCoordinate(node.y + offsetY);
  const { title, label, summary } = getNodeMathLines(node);
  const hasSummary = Boolean(summary);
  const labelBoxHeight = Math.max(height - 4, 20);

  return (
    <foreignObject
      className={`beta-flow-node-label-object${node.displayKind === "collapsedBlock" ? " is-collapsed" : ""}`}
      x={x - width / 2 + 2}
      y={y - labelBoxHeight / 2}
      width={Math.max(width - 4, 10)}
      height={labelBoxHeight}
    >
      <div className="beta-flow-node-label-html">
        <div className="beta-flow-node-title-math">
          <KatexMath expression={title} fallback={formatNodeTitle(node)} />
        </div>
        <div className="beta-flow-node-body-math">
          <KatexMath expression={label} fallback={node.label} />
        </div>
        {hasSummary ? (
          <div className="beta-flow-node-body-math">
            <KatexMath expression={summary} fallback={node.displayNode?.summary ?? ""} />
          </div>
        ) : null}
      </div>
    </foreignObject>
  );
}

// Padding (px) subtracted from the measured container width before fitting.
const FIT_PANEL_PADDING = 24;
// Maximum display height (px). Diagrams taller than this are scaled down so the
// full diagram is visible without scrolling. 72% of viewport height at render time.
function getFitMaxHeight() {
  return typeof window !== "undefined" ? Math.max(360, window.innerHeight * 0.72) : 860;
}

// ---------------------------------------------------------------------------
// Edge/bounds audit helpers (debug instrumentation — does not affect rendering)
// ---------------------------------------------------------------------------

function auditEdgeBoundsForLayoutPlan(layoutPlan) {
  const { nodes, edges, layout, offsetX, offsetY, width: planWidth, height: planHeight } = layoutPlan;
  const graphScale = computeGraphRenderScale(layoutPlan);
  const naturalWidth = planWidth * graphScale;
  const naturalHeight = planHeight * graphScale;

  // Recompute what measureLayoutPlan actually used
  const nodeBounds = nodes.map((n) => getNodeBounds(n, layout));
  const nodeMinY = Math.min(...nodeBounds.map((b) => b.top));
  const nodeMaxY = Math.max(...nodeBounds.map((b) => b.bottom));
  const nodeMinX = Math.min(...nodeBounds.map((b) => b.left));
  const nodeMaxX = Math.max(...nodeBounds.map((b) => b.right));

  // What the bounds WOULD be if edge Y points were included
  const allPoints = edges.flatMap((e) => (Array.isArray(e.points) ? e.points : []));
  const edgeMinX = allPoints.length ? Math.min(...allPoints.map((p) => p[0])) : nodeMinX;
  const edgeMaxX = allPoints.length ? Math.max(...allPoints.map((p) => p[0])) : nodeMaxX;
  const edgeMinY = allPoints.length ? Math.min(...allPoints.map((p) => p[1])) : nodeMinY;
  const edgeMaxY = allPoints.length ? Math.max(...allPoints.map((p) => p[1])) : nodeMaxY;

  // Edges whose points fall outside the node Y envelope
  const edgeAudit = edges.map((edge) => {
    const pts = Array.isArray(edge.points) ? edge.points : [];
    const outsideNodeY = pts.filter((p) => p[1] < nodeMinY || p[1] > nodeMaxY);
    const svgPts = pts.map(([x, y]) => [
      (x + offsetX) * graphScale,
      (y + offsetY) * graphScale,
    ]);
    const outsideViewBox = svgPts.filter(([sx, sy]) =>
      sx < 0 || sy < 0 || sx > naturalWidth || sy > naturalHeight,
    );
    const firstPt = pts[0] ?? null;
    const lastPt = pts[pts.length - 1] ?? null;

    // Expected ports from the node map
    const fromNode = layoutPlan.nodeMap?.get(edge.from) ?? null;
    const toNode = layoutPlan.nodeMap?.get(edge.to) ?? null;
    const fromBounds = fromNode ? getNodeBounds(fromNode, layout) : null;
    const toBounds = toNode ? getNodeBounds(toNode, layout) : null;
    const expectedSrcBottom = fromBounds ? getBottomPort(fromBounds) : null;
    const expectedDstTop = toBounds ? getTopPort(toBounds) : null;

    const dist = (a, b) =>
      a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null;

    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      sourceIndex: edge.sourceIndex ?? null,
      targetIndex: edge.targetIndex ?? null,
      branch: edge.branch ?? null,
      routeKind: edge.sketchV3RouteKind ?? edge.routeKind ?? null,
      type: edge.type ?? null,
      pointCount: pts.length,
      firstPt,
      lastPt,
      outsideNodeYCount: outsideNodeY.length,
      outsideViewBoxCount: outsideViewBox.length,
      outsideNodeYPoints: outsideNodeY,
      outsideViewBoxPoints: outsideViewBox,
      distFirstToExpectedSrcBottom: dist(firstPt, expectedSrcBottom),
      distLastToExpectedDstTop: dist(lastPt, expectedDstTop),
    };
  });

  const suspicious = edgeAudit.filter((r) => r.outsideNodeYCount > 0 || r.outsideViewBoxCount > 0);

  return {
    layoutMode: layoutPlan.layoutMode ?? "unknown",
    plan: {
      width: planWidth,
      height: planHeight,
      offsetX,
      offsetY,
      graphScale,
      naturalWidth,
      naturalHeight,
    },
    nodeYEnvelope: { nodeMinY, nodeMaxY, nodeMinX, nodeMaxX },
    edgeEnvelope: { edgeMinX, edgeMaxX, edgeMinY, edgeMaxY },
    missingFromYBounds: {
      belowNodes: edgeMaxY > nodeMaxY ? edgeMaxY - nodeMaxY : 0,
      aboveNodes: edgeMinY < nodeMinY ? nodeMinY - edgeMinY : 0,
    },
    correctHeight: edgeMaxY - edgeMinY + NODE_TOP_PADDING * 2,
    currentHeight: planHeight,
    heightUnderestimate:
      Math.max(edgeMaxY, nodeMaxY) - Math.min(edgeMinY, nodeMinY) + NODE_TOP_PADDING * 2
      - planHeight,
    suspiciousEdgeCount: suspicious.length,
    suspiciousEdges: suspicious,
    allEdges: edgeAudit,
  };
}

function FlowSvgDisplay({ layoutPlan, ariaLabel = "Instruction-level URM flow diagram" }) {
  const { layout } = layoutPlan;
  const containerRef = useRef(null);
  // Start with MAX_COMFORTABLE_GRAPH_WIDTH so the first render matches the existing
  // graphScale behavior. ResizeObserver updates this to the actual container width.
  const [containerWidth, setContainerWidth] = useState(MAX_COMFORTABLE_GRAPH_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setContainerWidth(initial);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Run edge/bounds audit on every layout plan change and expose on window.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audit = auditEdgeBoundsForLayoutPlan(layoutPlan);
    window.__betaFlowEdgeAudit = window.__betaFlowEdgeAudit ?? {};
    window.__betaFlowEdgeAudit[audit.layoutMode] = audit;
    if (audit.suspiciousEdgeCount > 0 || audit.heightUnderestimate > 1) {
      console.warn(
        `[beta-flow] bounds audit (${audit.layoutMode}): `
        + `heightUnderestimate=${audit.heightUnderestimate.toFixed(1)}px `
        + `suspiciousEdges=${audit.suspiciousEdgeCount}`,
        audit.suspiciousEdges.map((e) => ({
          id: e.id, from: e.from, to: e.to,
          routeKind: e.routeKind,
          outsideNodeYPoints: e.outsideNodeYPoints,
          outsideViewBoxPoints: e.outsideViewBoxPoints,
        })),
      );
    }

    // Loop-return side coherence audit: expose full diagnostic for every backward edge.
    const debug = layoutPlan.sketchV3PlacementDebug ?? null;
    if (!debug) return;
    const loopRows = debug.sketchV3LoopReturnRows ?? [];
    const nodeRecords = debug.sketchV3NodeRecords ?? [];
    const haltExitRecords = debug.sketchV3HaltExitRecords ?? [];
    const nodeById = Object.fromEntries(nodeRecords.map((n) => [n.id, n]));

    const loopAudit = loopRows.map((row) => {
      const diag = row.sketchV3LoopReturnDiagnostic ?? row;
      const srcNode = nodeById[diag.source ?? row.source] ?? null;
      const dstNode = nodeById[diag.target ?? row.target] ?? null;
      const sourceBranchPath = srcNode?.branchPath ?? [];
      const targetBranchPath = dstNode?.branchPath ?? [];
      const srcBranchInnermost = sourceBranchPath[sourceBranchPath.length - 1] ?? null;
      const branchCoherentSide = srcBranchInnermost?.endsWith("-yes")
        ? "right"
        : srcBranchInnermost?.endsWith("-no")
          ? "left"
          : null;
      const accepted = diag.side ?? null;
      const preferred = diag.preferredSide ?? null;
      const haltExitsInSiblingBranch = haltExitRecords.filter((he) => {
        if (!srcBranchInnermost) return false;
        const siblingEntry = srcBranchInnermost.endsWith("-yes")
          ? `${srcBranchInnermost.slice(0, -4)}-no`
          : srcBranchInnermost.endsWith("-no")
            ? `${srcBranchInnermost.slice(0, -3)}-yes`
            : null;
        if (!siblingEntry) return false;
        const siblingPath = [...sourceBranchPath.slice(0, -1), siblingEntry];
        const hePath = he.sourceBranchPath ?? [];
        return siblingPath.length <= hePath.length &&
          siblingPath.every((e, i) => e === hePath[i]);
      });

      // Summarise candidate rejections grouped by side and blocker type
      const candidateDiags = diag.candidateRouteDiagnostics ?? [];
      const rejectionSummary = {};
      candidateDiags.forEach((c) => {
        const s = c.side ?? "unknown";
        if (!rejectionSummary[s]) rejectionSummary[s] = { legal: 0, rejected: 0, rejectionReasons: {} };
        if (c.accepted) {
          rejectionSummary[s].legal += 1;
        } else {
          rejectionSummary[s].rejected += 1;
          const role = c.firstRejection?.blockingGeometryRole ?? "unknown";
          rejectionSummary[s].rejectionReasons[role] = (rejectionSummary[s].rejectionReasons[role] ?? 0) + 1;
        }
      });

      // Right-side candidates rejected by HALT only
      const rightCandidates = candidateDiags.filter((c) => c.side === "right");
      const rightRejectedByHaltOnly = rightCandidates.filter((c) =>
        !c.accepted &&
        (c.firstRejection?.blockingGeometryRole === "HALT" ||
         (c.blockingRows ?? []).every((r) => r.blockingGeometryRole === "HALT")),
      );
      const rightRejectedByNonHalt = rightCandidates.filter((c) =>
        !c.accepted &&
        c.firstRejection?.blockingGeometryRole !== "HALT" &&
        c.firstRejection?.blockingGeometryRole != null,
      );

      return {
        edgeId: diag.edgeId ?? row.edgeId,
        source: diag.source ?? row.source,
        target: diag.target ?? row.target,
        acceptedSide: accepted,
        preferredSide: preferred,
        preferredSidePendingCorridorBlocked: diag.preferredSidePendingCorridorBlocked ?? false,
        branchCoherentSide,
        sourceBranchPath,
        targetBranchPath,
        sourceIsDeeper: sourceBranchPath.length > targetBranchPath.length,
        haltExitsInSiblingBranchCount: haltExitsInSiblingBranch.length,
        haltExitsInSiblingBranch: haltExitsInSiblingBranch.map((h) => ({
          id: h.id, sourceId: h.sourceId, sourceBranchPath: h.sourceBranchPath,
        })),
        legalCandidateCount: diag.legalCandidateCount ?? 0,
        totalCandidateCount: candidateDiags.length,
        rejectionSummary,
        rightCandidateCount: rightCandidates.length,
        rightLegalCount: rightCandidates.filter((c) => c.accepted).length,
        rightRejectedByHaltOnlyCount: rightRejectedByHaltOnly.length,
        rightRejectedByNonHaltCount: rightRejectedByNonHalt.length,
        firstRightRejection: rightCandidates.find((c) => !c.accepted)?.firstRejection ?? null,
        firstRightRejectedByHaltOnly: rightRejectedByHaltOnly[0]?.firstRejection ?? null,
        coherenceViolation: accepted !== null && branchCoherentSide !== null && accepted !== branchCoherentSide,
      };
    });

    window.__betaFlowLoopReturnAudit = window.__betaFlowLoopReturnAudit ?? {};
    window.__betaFlowLoopReturnAudit[audit.layoutMode] = loopAudit;
    // Diagnostic: expose full sketchV3LoopReturnDiagnostic for each backward edge.
    // loopRows entries ARE the diagnostic object (spread-in by buildLoopReturnDiagnostics),
    // so row itself is the diag — not row.sketchV3LoopReturnDiagnostic.
    window.__sketchV3LoopReturnFullDiag = loopRows.map((row) => ({ ...row }));
  }, [layoutPlan]);

  const graphScale = computeGraphRenderScale(layoutPlan);
  // naturalWidth/Height: the diagram's coordinate extent after the existing graphScale.
  // The SVG viewBox covers this space; displayed pixel size is derived from fitScale below.
  const naturalWidth = layoutPlan.width * graphScale;
  const naturalHeight = layoutPlan.height * graphScale;

  const availWidth = Math.max(64, containerWidth - FIT_PANEL_PADDING * 2);
  const availHeight = getFitMaxHeight();

  // fitScale ≤ 1: shrink-only. Never enlarge a small diagram beyond its natural size.
  const fitScale = Math.min(1, availWidth / naturalWidth, availHeight / naturalHeight);
  const displayWidth = Math.round(naturalWidth * fitScale);
  const displayHeight = Math.round(naturalHeight * fitScale);

  // Show debug info whenever the diagram is scaled down, or when audit debug is on.
  const isScaled = fitScale < 0.999;
  const showDebugInfo = isScaled || isBetaFlowAuditDebugEnabled();
  const debugText = isScaled
    ? `bounds ${Math.round(layoutPlan.width)}×${Math.round(layoutPlan.height)} | fit ${(fitScale * 100).toFixed(0)}% → ${displayWidth}×${displayHeight}px`
    : `bounds ${Math.round(layoutPlan.width)}×${Math.round(layoutPlan.height)}`;

  return (
    <div
      ref={containerRef}
      className="beta-flow-svg-shell"
      data-fit-scale={fitScale.toFixed(4)}
      data-diagram-bounds={`${Math.round(layoutPlan.width)}x${Math.round(layoutPlan.height)}`}
    >
      <svg
        className="beta-flow-svg"
        style={{ display: "block", width: displayWidth, height: displayHeight, flex: "none" }}
        viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <marker
            id="beta-flow-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L9,4.5 L0,9 Z" className="beta-flow-arrow-head" />
          </marker>
        </defs>

        <g transform={`scale(${graphScale})`}>
          <g className="beta-flow-edges">
            {layoutPlan.edges.map((edge) => (
              <g key={edge.id} className={`beta-flow-edge beta-flow-edge-${edge.type}`}>
                <polyline
                  fill="none"
                  stroke="currentColor"
                  points={pointsToString(edge.points, layoutPlan.offsetX, layoutPlan.offsetY)}
                  markerEnd="url(#beta-flow-arrow)"
                  strokeWidth={layout.arrowStrokeWidth}
                />
                {edge.branch ? (
                  <text
                    className="beta-flow-edge-label"
                    x={safeSvgCoordinate(edge.labelX + layoutPlan.offsetX)}
                    y={safeSvgCoordinate(edge.labelY + layoutPlan.offsetY - 3)}
                    textAnchor="middle"
                  >
                    {edge.branch}
                  </text>
                ) : null}
              </g>
            ))}
          </g>

          <g className="beta-flow-nodes">
            {layoutPlan.nodes.map((node) => (
              <g key={node.id} className="beta-flow-node">
                {renderNodeShape(node, layout, layoutPlan.offsetX, layoutPlan.offsetY)}
                {node.kind === "start" || node.kind === "halt" ? (
                  <text
                    className="beta-flow-terminal-label"
                    x={safeSvgCoordinate(node.x + layoutPlan.offsetX)}
                    y={safeSvgCoordinate(node.y + layoutPlan.offsetY + 4)}
                    textAnchor="middle"
                  >
                    {node.label}
                  </text>
                ) : (
                  renderMathNodeLabel(node, layout, layoutPlan.offsetX, layoutPlan.offsetY)
                )}
              </g>
            ))}
          </g>
        </g>
      </svg>
      {showDebugInfo ? (
        <div className="beta-flow-diagram-debug-info" aria-hidden="true">{debugText}</div>
      ) : null}
    </div>
  );
}

function renderFlowSvg(layoutPlan, { ariaLabel = "Instruction-level URM flow diagram" } = {}) {
  return <FlowSvgDisplay layoutPlan={layoutPlan} ariaLabel={ariaLabel} />;
}

function renderFlowSvgPanel(
  layoutPlan,
  title,
  subtitle = null,
  ariaLabel = "Instruction-level URM flow diagram",
  debugBadge = null,
  headerControl = null,
) {
  return (
    <section className="beta-flow-comparison-panel" aria-label={title}>
      <header className="beta-flow-comparison-panel-header">
        <div className="beta-flow-comparison-panel-title-row">
          <h4 className="beta-flow-comparison-panel-title">{title}</h4>
          {(debugBadge || headerControl) ? (
            <div className="beta-flow-comparison-panel-title-tools">
              {debugBadge ? (
                <span className="beta-flow-comparison-panel-badge">{debugBadge}</span>
              ) : null}
              {headerControl}
            </div>
          ) : null}
        </div>
        {subtitle ? (
          <p className="beta-flow-comparison-panel-note">{subtitle}</p>
        ) : null}
      </header>
      {renderFlowSvg(layoutPlan, { ariaLabel })}
    </section>
  );
}

function isVisualGeometryDebugEnabled() {
  if (ENABLE_VISUAL_GEOMETRY_DEBUG || isBetaFlowAuditDebugEnabled()) return true;
  return false;
}

// Signals to the SketchV3 engine (via layoutPlan.sketchV3DiagnosticsRequested) whether the
// full sketchV3PlacementDebug payload is actually consumed this render. It is only read by
// the geometry-debug / audit reports, the geometry-collection report (buildFlowGeometryReport
// -> classifyVisualGeometry), and automatic split-orientation repair (handled inside the
// engine). On the normal render path none of these are active, so the engine skips the
// expensive post-layout diagnostic assembly. (Comparison mode renders nodes/edges only and
// does not read the debug payload, so it does not force diagnostics on its own.)
function isSketchV3DiagnosticsRequested() {
  if (isVisualGeometryDebugEnabled()) return true; // covers betaFlowAudit + geometryDebug
  if (typeof window === "undefined") return true;   // headless harness / tests / SSR
  try {
    if (new URLSearchParams(window.location.search).get("geometryCollect") === "1") return true;
  } catch {
    // Ignore URL parsing issues in debug-only collection mode.
  }
  try {
    if (window.localStorage?.getItem("betaFlowGeometryCollect") === "1") return true;
  } catch {
    // Ignore localStorage access issues in debug-only collection mode.
  }
  return false;
}

function isBetaFlowAuditDebugEnabled() {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("betaFlowAudit") === "1" || params.get("geometryDebug") === "1") {
      return true;
    }
  } catch {
    // Ignore URL parsing issues in non-browser/debug contexts.
  }

  try {
    return (
      window.localStorage?.getItem("betaFlowAudit") === "1" ||
      window.localStorage?.getItem("betaFlowGeometryDebug") === "1"
    );
  } catch {
    return false;
  }
}

function safeComputeLayout(program, selectedFunctionId, options, layout) {
  try {
    return [buildDiagramModel(program, selectedFunctionId, options, layout), null];
  } catch (error) {
    return [null, error];
  }
}

// Headless verification entry point (node harness / dev console); not used by the app UI.
export { buildDiagramModel };

export function buildFlowGeometryReport(
  program,
  selectedFunctionId,
  options = {},
  layout = TEXTBOOK_LAYOUT,
) {
  if (!isInstructionList(program)) {
    return null;
  }

  const layoutPlan = buildDiagramModel(program, selectedFunctionId, options, layout);
  return classifyVisualGeometry(layoutPlan, selectedFunctionId);
}

export default function BetaFlowDiagram({
  program,
  selectedFunctionId,
  selectedExampleName = null,
  layoutMetadata = null,
  collapseSetupBlocks = false,
  showLayoutComparison = false,
}) {
  // Memoize layout computations so they only re-run when their inputs change.
  // Both hooks must be called unconditionally before any early returns (Rules of Hooks).
  // useMemo callbacks are pure — no side effects, no try/catch, no performance.now().
  // Logging and counts are flushed to window via useEffect below.
  //
  // layoutMetadata is intentionally excluded from this dep array.
  // It is passed only as debugLayoutMetadata which populates the debug identity object
  // (hasTunedLayout, layoutStatus) — it has no effect on node positions, edge routes, or
  // any other visual output.  layoutMetadata always changes atomically with program (both
  // derive from compiledResult), so omitting it here never skips a visually-relevant recompute.
  // Including it caused unnecessary expensive recomputes when compiledResult was replaced with
  // a new object holding the same program reference (e.g., from a run result matching a compile).
  const layoutPlan = useMemo(
    () => isInstructionList(program)
      ? buildDiagramModel(program, selectedFunctionId, {
          collapseSetupBlocks,
          layoutMode: "sketchV3",
          selectedExampleName,
          debugLayoutMetadata: layoutMetadata,
        })
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, selectedFunctionId, collapseSetupBlocks, selectedExampleName],
  );

  const [generatedLayoutPlan, generatedLayoutError] = useMemo(
    () => isInstructionList(program) && showLayoutComparison
      ? safeComputeLayout(program, selectedFunctionId, {
          collapseSetupBlocks,
          // Phase C2a: the kept comparison always targets the tuned/reference
          // layout. URL/localStorage override modes no longer affect this target.
          layoutMode: "tuned",
          selectedExampleName,
          debugLayoutMetadata: layoutMetadata,
        })
      : [null, null],
    [program, selectedFunctionId, collapseSetupBlocks, selectedExampleName, layoutMetadata, showLayoutComparison],
  );

  // Ref to detect genuine cache misses (useMemo fires) vs no-ops.
  const prevLayoutPlanRef = useRef(null);
  const prevGeneratedLayoutPlanRef = useRef(null);

  // Flush compute-count and timing data to window globals after each render.
  // Reading from window.__betaFlowPerfLog in DevTools shows per-phase timings
  // recorded by buildDiagramModelUnsafe/_t0.._t5 during the actual computation.
  useEffect(() => {
    if (layoutPlan === prevLayoutPlanRef.current) return;
    prevLayoutPlanRef.current = layoutPlan;
    if (typeof window === "undefined") return;
    window.__betaFlowPrimaryComputeCount = (window.__betaFlowPrimaryComputeCount ?? 0) + 1;
    // Dev/debug only: expose the rendered layout plan so manual verification
    // tooling (DevTools, headless drivers) can inspect the exact plan the SVG uses.
    window.__betaFlowLastLayoutPlan = layoutPlan;
  }, [layoutPlan]);

  useEffect(() => {
    if (generatedLayoutPlan === prevGeneratedLayoutPlanRef.current) return;
    prevGeneratedLayoutPlanRef.current = generatedLayoutPlan;
    if (!generatedLayoutPlan || typeof window === "undefined") return;
    window.__betaFlowComparisonComputeCount = (window.__betaFlowComparisonComputeCount ?? 0) + 1;
  }, [generatedLayoutPlan]);

  if (!isInstructionList(program)) {
    return (
      <div className="beta-flow-placeholder">
        Run or compile a valid function to preview its instruction flow.
      </div>
    );
  }

  const hasTunedLayout = Boolean(layoutMetadata?.hasTunedLayout);
  const shouldShowTunedComparisonPanel = showLayoutComparison && hasTunedLayout;

  if (isVisualGeometryDebugEnabled() && (!showLayoutComparison || shouldShowTunedComparisonPanel)) {
    emitVisualGeometryDebugReport(layoutPlan, selectedFunctionId);
  }

  // Layout comparison is only meaningful when a tuned/reference layout exists for
  // this function. Without it (or with comparison off) render the single sketchV3
  // view; the legacy no-tuned comparison grid below is intentionally unreachable now.
  if (!shouldShowTunedComparisonPanel) {
    return renderFlowSvg(layoutPlan);
  }

  const geometryDebugEnabled = isVisualGeometryDebugEnabled();
  // The kept comparison always targets the tuned/reference layout; a static
  // badge labels it and there is no engine selector.
  const generatedStrategyLabel = "Reference (tuned)";
  // generatedLayoutPlan and generatedLayoutError come from the useMemo above.

  if (geometryDebugEnabled && generatedLayoutPlan) {
    emitVisualGeometryDebugReport(generatedLayoutPlan, selectedFunctionId);
  }

  const generatedUnavailableNote = generatedLayoutError
    ? `Reference (tuned) layout is unavailable for this example (${generatedLayoutError?.message ?? "unknown error"}).`
    : null;

  return (
    <div className="beta-flow-comparison-grid">
      {renderFlowSvgPanel(
        layoutPlan,
        "sketchV3 layout",
        null,
        "sketchV3 URM flow diagram",
      )}
      {generatedLayoutPlan
        ? renderFlowSvgPanel(
          generatedLayoutPlan,
          "Reference (tuned) layout",
          null,
          "Reference (tuned) URM flow diagram",
          generatedStrategyLabel,
        )
        : (
          <section className="beta-flow-comparison-panel beta-flow-comparison-panel-empty" aria-label="Reference (tuned) layout unavailable">
            <header className="beta-flow-comparison-panel-header">
              <div className="beta-flow-comparison-panel-title-row">
                <h4 className="beta-flow-comparison-panel-title">Reference (tuned) layout</h4>
                <div className="beta-flow-comparison-panel-title-tools">
                  <span className="beta-flow-comparison-panel-badge">{generatedStrategyLabel}</span>
                </div>
              </div>
            </header>
            <div className="beta-flow-placeholder">
              {generatedUnavailableNote ?? "Reference (tuned) layout is not available for this example yet."}
            </div>
          </section>
        )}
    </div>
  );
}

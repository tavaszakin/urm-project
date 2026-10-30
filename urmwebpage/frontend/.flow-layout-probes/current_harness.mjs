// Current-only SketchV4 checkpoint harness. Historical experiment constructors are archived
// outside the frontend tree and are not part of this module graph.
import { buildCfg } from "../src/layout/sketchv4/cfg.js";
import { classifyRoles } from "../src/layout/sketchv4/roles.js";
import { computeOwnership } from "../src/layout/sketchv4/ownership.js";
import { buildRealForkTree } from "../src/layout/sketchv4/realforktree.js";
import { buildSkeleton } from "../src/layout/sketchv4/skeleton.js";
import { computeLanes } from "../src/layout/sketchv4/lanes.js";
import { routeEdges } from "../src/layout/sketchv4/routing.js";
import { evaluateDefects } from "../src/layout/sketchv4/defects.js";
import { assignOrientation } from "../src/layout/sketchv4/orientation.js";
import { getLegalIncidentStubsForNode, validateEdgeAttachments } from "../src/layout/sketchv4/attachmentStubs.js";
import { buildLayout, roleGuardOrientation } from "../src/layout/sketchv4/pipeline.js";
//#region .flow-layout-probes/_current_bundle_source.mjs
const DEFAULT = {
	no: "left",
	yes: "right"
};
const CLEARANCE = 16;
const SYNTHETIC_OPCODE = ["Z", 0];
const sizeForCurrentKind = (kind) => kind === "start" || kind === "halt" ? [48, 18] : kind === "conditionalJump" ? [82, 46] : [88, 30];
const sizeForOrdinaryKind = (kind) => kind === "start" ? [48, 18] : kind === "conditionalJump" ? [82, 46] : [88, 30];
const ordinaryVisual = {
	sizeForKind: sizeForCurrentKind,
	branchAngleTan: Math.tan(33 * Math.PI / 180),
	pitch: {
		setupPitch: 54,
		ordinaryPitch: 82,
		branchRayDistance: 126
	},
	terminalSize: [48, 18],
	haltBandOffset: 154,
	clearance: CLEARANCE,
	sizeForKind: sizeForOrdinaryKind
};
const NO_HALT_CONTEXT = Object.freeze({
	haltBox: null,
	haltExitRecords: Object.freeze([]),
	haltExitCount: 0,
	haltX: 0,
	haltBandOffset: 0
});
const cloneInstruction = (instruction) => Array.isArray(instruction) ? [...instruction] : instruction;
const mapToObject = (map) => Object.fromEntries([...map].map(([id, value]) => [id, { ...value }]));
const bitName = (value) => value?.no === "right" ? "flipped" : "default";
function fail(message) {
	throw new Error(`ordinary-HALT purity assertion failed: ${message}`);
}
function buildOrdinaryTerminalCfg(program) {
	const originalCount = program.length;
	const terminalIndex = originalCount;
	const terminalId = `i-${terminalIndex}`;
	const originalCfg = buildCfg(program);
	const originalRoles = classifyRoles(originalCfg);
	const originalHaltEdgeIds = new Set(originalCfg.edges.filter((edge) => originalRoles.edgeRoleById.get(edge.id) === "halt-exit").map((edge) => edge.id));
	const augmentedProgram = program.map((raw) => {
		const instruction = cloneInstruction(raw);
		if (Array.isArray(instruction) && String(instruction[0]).toUpperCase() === "J") {
			const target = Number(instruction[3]);
			if (!Number.isInteger(target) || target < 0 || target >= originalCount) instruction[3] = terminalIndex;
		}
		return instruction;
	});
	augmentedProgram.push([...SYNTHETIC_OPCODE]);
	const cfg = buildCfg(augmentedProgram);
	const syntheticOutgoingId = cfg.outgoingByIndex.get(terminalIndex)?.cont?.id;
	cfg.nodes = cfg.nodes.filter((node) => node.id !== "halt");
	cfg.nodeById.delete("halt");
	cfg.edges = cfg.edges.filter((edge) => edge.id !== syntheticOutgoingId && edge.to !== "halt");
	cfg.edgeById = new Map(cfg.edges.map((edge) => [edge.id, edge]));
	cfg.outgoingByIndex.set(terminalIndex, {
		yes: null,
		no: null,
		cont: null
	});
	cfg.sinkNodeId = terminalId;
	const incomingIds = new Set(cfg.edges.filter((edge) => edge.to === terminalId).map((edge) => edge.id));
	if (incomingIds.size !== originalHaltEdgeIds.size || [...originalHaltEdgeIds].some((id) => !incomingIds.has(id))) fail(`redirected terminal inputs {${[...incomingIds]}} do not match original HALT inputs {${[...originalHaltEdgeIds]}}`);
	if (cfg.nodeById.has("halt") || cfg.edges.some((edge) => edge.to === "halt")) fail("legacy halt survived CFG transformation");
	if (!cfg.dfsOrder.includes(terminalId) || !cfg.incomingEdgeByNode.has(terminalId)) fail("synthetic terminal was not placed by buildCfg traversal");
	return {
		cfg,
		originalCfg,
		originalRoles,
		originalHaltEdgeIds,
		terminalId,
		terminalIndex,
		augmentedProgram
	};
}
function boundsOver(boxes, routes) {
	const points = [];
	for (const box of boxes.values()) points.push([box.left, box.top], [box.right, box.bottom]);
	for (const route of routes) points.push(...route.points);
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
	return {
		minX,
		maxX,
		minY,
		maxY,
		width: maxX - minX,
		height: maxY - minY
	};
}
function attachmentRecords(cfg, roles, boxes, routes) {
	return routes.map((route) => {
		const record = validateEdgeAttachments(route, cfg.nodeById.get(route.source), cfg.nodeById.get(route.target), route.points, {
			sourceBox: boxes.get(route.source),
			targetBox: boxes.get(route.target)
		});
		return {
			...record,
			source: record.source,
			target: record.target
		};
	});
}
function realizeExperimental(base, orientationMap) {
	const { cfg, roles, ownership, tree, guardOrientationOf } = base;
	const orientationOf = (id) => roles.realForkSet.has(id) ? orientationMap.get(id) ?? DEFAULT : guardOrientationOf(id) ?? DEFAULT;
	const skeleton = buildSkeleton(cfg, roles, {
		orientationOf,
		sizeForKind: ordinaryVisual.sizeForKind,
		branchAngleTan: ordinaryVisual.branchAngleTan,
		pitch: ordinaryVisual.pitch
	});
	const lanes = computeLanes(cfg, roles, ownership, skeleton, { orientationOf });
	const routed = routeEdges(cfg, roles, ownership, skeleton, lanes, NO_HALT_CONTEXT, { clearance: CLEARANCE });
	const boxes = new Map([...skeleton.placements].map(([id, placement]) => [id, placement.box]));
	const defects = evaluateDefects({
		routes: routed.routes,
		boxes
	}, {
		realForkSet: roles.realForkSet,
		lcaRF: tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: base.programName,
		orientationSource: "ordinarySyntheticTerminal"
	});
	if (skeleton.placements.has("halt") || boxes.has("halt")) fail("legacy halt received placement");
	if (routed.routes.some((route) => route.edgeRole === "halt-exit" || route.routeFamily === "halt")) fail("special HALT route path executed");
	if ([...routed.ports.values()].some((port) => String(port.portPolicyCase).startsWith("halt-"))) fail("special HALT port policy executed");
	if (!skeleton.placements.has(base.terminalId)) fail("synthetic terminal missing ordinary skeleton placement");
	const terminalPlacement = skeleton.placements.get(base.terminalId);
	if (terminalPlacement.kind !== "action" || terminalPlacement.box.w !== 88 || terminalPlacement.box.h !== 30) fail("synthetic terminal did not receive ordinary action-node geometry");
	return {
		mode: "ordinary",
		programName: base.programName,
		program: base.program,
		cfg,
		roles,
		ownership,
		tree,
		orientationMap,
		orientationOf,
		skeleton,
		lanes,
		routed,
		ports: routed.ports,
		boxes,
		defects,
		renderBounds: boundsOver(boxes, routed.routes),
		attachments: attachmentRecords(cfg, roles, boxes, routed.routes),
		terminalId: base.terminalId,
		purity: {
			placeHaltCalled: false,
			legacyHaltNodePresent: false,
			haltExitRoleCount: 0,
			haltRouteCount: 0,
			haltPortPolicyCount: 0,
			inertRouteApiContextOnly: true
		}
	};
}
function buildRawRoleOrdinaryTerminalBase(program, programName) {
	const parts = buildOrdinaryTerminalCfg(program);
	const roles = classifyRoles(parts.cfg);
	if ([...roles.edgeRoleById.values()].includes("halt-exit")) fail("halt-exit role survived raw-role classification");
	const ownership = computeOwnership(parts.cfg, roles);
	const tree = buildRealForkTree(parts.cfg, roles);
	const guardOrientationOf = roleGuardOrientation(parts.cfg, roles);
	return {
		...parts,
		roles,
		ownership,
		tree,
		guardOrientationOf,
		program,
		programName
	};
}
function applyRightToRightHvhMerge(view, edgeId = "i-57-cont") {
	const edge = view.cfg.edgeById.get(edgeId);
	const baselineRoute = view.routed.routes.find((route) => route.edgeId === edgeId);
	const sourceBox = view.boxes.get(edge?.from);
	const targetBox = view.boxes.get(edge?.to);
	if (!edge || !baselineRoute || !sourceBox || !targetBox || baselineRoute.edgeRole !== "merge-connector") fail(`cannot apply right-to-right H/V/H diagnostic to ${edgeId}`);
	const oldSourcePort = [...baselineRoute.sourcePort];
	const oldTargetPort = [...baselineRoute.targetPort];
	const oldPoints = baselineRoute.points.map((point) => [...point]);
	const sourcePort = [sourceBox.right, sourceBox.cy];
	const targetPort = [targetBox.right, targetBox.cy];
	const corridorX = Math.max(sourceBox.right, targetBox.right) + CLEARANCE;
	const points = [
		sourcePort,
		[corridorX, sourcePort[1]],
		[corridorX, targetPort[1]],
		targetPort
	];
	const route = {
		...baselineRoute,
		sourcePort,
		targetPort,
		points,
		connectorKind: "sideEntryJog"
	};
	const routes = view.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
	const ports = new Map(view.routed.ports);
	ports.set(edgeId, {
		...ports.get(edgeId),
		sourcePort,
		targetPort,
		sideEntryJogX: corridorX,
		experimentalRightToRightHvh: true
	});
	const routed = {
		...view.routed,
		routes,
		ports
	};
	const defects = evaluateDefects({
		routes,
		boxes: view.boxes
	}, {
		realForkSet: view.roles.realForkSet,
		lcaRF: view.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: view.programName,
		orientationSource: "rawRolesI57RightToRightHvh"
	});
	return {
		...view,
		routed,
		ports,
		defects,
		renderBounds: boundsOver(view.boxes, routes),
		attachments: attachmentRecords(view.cfg, view.roles, view.boxes, routes),
		experimentalRouteSplice: {
			edgeId,
			edgeRole: route.edgeRole,
			routeFamily: route.routeFamily,
			connectorKind: route.connectorKind,
			routeShape: "right port -> H -> V -> H -> right port",
			corridorRule: "max(sourceBox.right, targetBox.right) + existing V4 clearance",
			clearance: CLEARANCE,
			corridorX,
			oldSourcePort,
			newSourcePort: sourcePort,
			oldTargetPort,
			newTargetPort: targetPort,
			oldRoutePoints: oldPoints,
			newRoutePoints: points
		},
		purity: {
			...view.purity,
			oneEdgeGeometrySpliceOnly: edgeId,
			routeFamilyChanged: false,
			automaticRepairAfterConstruction: false,
			obstacleSearchUsed: false,
			haltSpecificMachineryAdded: false
		}
	};
}
function buildGeneralizedLoopSourcePortView(currentBaseline) {
	const EPSILON = 1e-9;
	const same = (a, b) => Math.abs(a - b) <= EPSILON;
	const routesById = /* @__PURE__ */ new Map();
	const ports = new Map(currentBaseline.routed.ports);
	const census = [];
	const loopRoutes = currentBaseline.routed.routes.filter((route) => route.edgeRole === "loop-return");
	for (const baselineRoute of loopRoutes) {
		const edge = currentBaseline.cfg.edgeById.get(baselineRoute.edgeId);
		const sourceNode = currentBaseline.cfg.nodeById.get(edge?.from);
		const targetNode = currentBaseline.cfg.nodeById.get(edge?.to);
		const sourceBox = currentBaseline.boxes.get(edge?.from);
		if (!edge || !sourceNode || !targetNode || !sourceBox || baselineRoute.points.length < 3) fail(`cannot classify generalized loop source for ${baselineRoute.edgeId}`);
		if (!Number.isInteger(sourceNode.instructionIndex) || !Number.isInteger(targetNode.instructionIndex) || sourceNode.instructionIndex <= targetNode.instructionIndex) fail(`${baselineRoute.edgeId} is not a backward instruction-index loop`);
		const oldSourcePort = [...baselineRoute.sourcePort];
		const targetPort = [...baselineRoute.targetPort];
		const oldPoints = baselineRoute.points.map((point) => [...point]);
		if (JSON.stringify(oldPoints[0]) !== JSON.stringify(oldSourcePort)) fail(`${baselineRoute.edgeId} route does not begin at its recorded source port`);
		const sourceSide = same(oldSourcePort[0], sourceBox.left) ? "left" : same(oldSourcePort[0], sourceBox.right) ? "right" : null;
		if (!sourceSide) fail(`${baselineRoute.edgeId} does not begin at a rectangle side port`);
		const [first, second, third] = oldPoints;
		const verticalFirst = same(first[0], second[0]) && second[1] > first[1] + EPSILON && same(second[1], third[1]) && !same(second[0], third[0]);
		const outwardDirection = sourceSide === "left" ? -1 : 1;
		const lateralFirst = same(first[1], second[1]) && (second[0] - first[0]) * outwardDirection > EPSILON;
		if (!verticalFirst && !lateralFirst) fail(`${baselineRoute.edgeId} is neither vertical-first nor legal outward lateral-first`);
		const bodyClassification = verticalFirst ? "vertical-first" : "lateral-first";
		const bendRow = verticalFirst ? second[1] : first[1];
		const sourcePort = verticalFirst ? [sourceBox.cx, sourceBox.bottom] : oldSourcePort;
		const points = verticalFirst ? [
			sourcePort,
			[sourcePort[0], bendRow],
			...oldPoints.slice(2).map((point) => [...point])
		] : oldPoints.map((point) => [...point]);
		const route = verticalFirst ? {
			...baselineRoute,
			sourcePort,
			targetPort,
			points
		} : baselineRoute;
		routesById.set(baselineRoute.edgeId, route);
		if (verticalFirst) ports.set(baselineRoute.edgeId, {
			...ports.get(baselineRoute.edgeId),
			sourcePort,
			changed: true,
			experimentalGeneralizedBottomSourcePort: true
		});
		census.push({
			edgeId: baselineRoute.edgeId,
			source: edge.from,
			target: edge.to,
			sourceInstructionIndex: sourceNode.instructionIndex,
			targetInstructionIndex: targetNode.instructionIndex,
			existingSourceSide: sourceSide,
			existingSourcePort: oldSourcePort,
			bodyClassification,
			resultingSourceSide: verticalFirst ? "bottom" : sourceSide,
			resultingSourcePort: sourcePort,
			bendRow,
			railCoord: baselineRoute.railCoord,
			targetPort,
			oldRoutePoints: oldPoints,
			newRoutePoints: points,
			sourceAttachmentRule: verticalFirst ? "bottom-center port, then vertical downward to unchanged loop bend row" : `unchanged ${sourceSide} port and existing outward horizontal departure`,
			outwardDeparture: lateralFirst ? [first, second] : null,
			routeChanged: verticalFirst,
			preservedRouteSuffix: verticalFirst ? oldPoints.slice(2).map((point) => [...point]) : oldPoints.slice(1).map((point) => [...point])
		});
	}
	const routes = currentBaseline.routed.routes.map((route) => routesById.get(route.edgeId) ?? route);
	const routed = {
		...currentBaseline.routed,
		routes,
		ports
	};
	const defects = evaluateDefects({
		routes,
		boxes: currentBaseline.boxes
	}, {
		realForkSet: currentBaseline.roles.realForkSet,
		lcaRF: currentBaseline.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: currentBaseline.programName,
		orientationSource: "generalizedLoopSourcePortProbe"
	});
	const attachments = attachmentRecords(currentBaseline.cfg, currentBaseline.roles, currentBaseline.boxes, routes);
	const attachmentCensus = census.map((row) => {
		const oldAttachment = currentBaseline.attachments.find((record) => record.edgeId === row.edgeId);
		const newAttachment = attachments.find((record) => record.edgeId === row.edgeId);
		return {
			...row,
			oldAttachmentLegality: {
				source: oldAttachment?.source?.legal ?? null,
				target: oldAttachment?.target?.legal ?? null,
				overall: oldAttachment?.legal ?? null
			},
			newAttachmentLegality: {
				source: newAttachment?.source?.legal ?? null,
				target: newAttachment?.target?.legal ?? null,
				overall: newAttachment?.legal ?? null
			}
		};
	});
	return {
		...currentBaseline,
		routed,
		ports,
		defects,
		attachments,
		renderBounds: boundsOver(currentBaseline.boxes, routes),
		viewLabel: "Ordinary HALT — generalized backward-loop source-port probe",
		experimentalRouteSplices: [...currentBaseline.experimentalRouteSplices ?? [], ...attachmentCensus],
		experimentalLoopSourcePortCensus: attachmentCensus,
		purity: {
			...currentBaseline.purity,
			loopSourceGeneralizationConsideredEdgeIds: attachmentCensus.map((row) => row.edgeId),
			loopSourceGeneralizationChangedEdgeIds: attachmentCensus.filter((row) => row.routeChanged).map((row) => row.edgeId),
			loopSourceGeneralizationVerticalFirstCount: attachmentCensus.filter((row) => row.bodyClassification === "vertical-first").length,
			loopSourceGeneralizationLateralFirstCount: attachmentCensus.filter((row) => row.bodyClassification === "lateral-first").length,
			loopReturnRailsChanged: false,
			loopBendRowsChanged: false,
			targetPortsChanged: false,
			targetEntryGeometryChanged: false,
			nodePositionsChanged: false,
			orientationSelectionRerun: false,
			nonLoopRoutesChanged: false,
			automaticRepairAfterConstruction: false
		}
	};
}
function buildGeneralizedLoopTargetAttachmentView(composedView) {
	const EPSILON = 1e-9;
	const changedById = /* @__PURE__ */ new Map();
	const ports = new Map(composedView.routed.ports);
	const census = [];
	for (const baselineRoute of composedView.routed.routes.filter((route) => route.edgeRole === "loop-return")) {
		const edge = composedView.cfg.edgeById.get(baselineRoute.edgeId);
		const sourceNode = composedView.cfg.nodeById.get(edge?.from);
		const targetNode = composedView.cfg.nodeById.get(edge?.to);
		const sourceBox = composedView.boxes.get(edge?.from);
		const targetBox = composedView.boxes.get(edge?.to);
		const oldAttachment = composedView.attachments.find((record) => record.edgeId === baselineRoute.edgeId);
		if (!edge || !sourceNode || !targetNode || !sourceBox || !targetBox || !oldAttachment || !Number.isInteger(sourceNode.instructionIndex) || !Number.isInteger(targetNode.instructionIndex) || sourceNode.instructionIndex <= targetNode.instructionIndex) fail(`cannot classify generalized loop target for ${baselineRoute.edgeId}`);
		const oldPoints = baselineRoute.points.map((point) => [...point]);
		const oldTargetPort = [...baselineRoute.targetPort];
		const oldRouteSuffix = oldPoints.slice(-3).map((point) => [...point]);
		let route = baselineRoute;
		let outcome = "unchanged-already-legal";
		let approachOrientation = null;
		let approachStart = null;
		let approachEnd = null;
		let inspectedPortRays = [];
		let compatibleCandidates = [];
		if (!oldAttachment.target.legal) {
			outcome = "unchanged-no-compatible-port";
			if (oldPoints.length >= 3) {
				approachStart = [...oldPoints[oldPoints.length - 3]];
				approachEnd = [...oldPoints[oldPoints.length - 2]];
				const approachDx = approachEnd[0] - approachStart[0];
				const approachDy = approachEnd[1] - approachStart[1];
				approachOrientation = Math.abs(approachDy) <= EPSILON && Math.abs(approachDx) > EPSILON ? "horizontal" : Math.abs(approachDx) <= EPSILON && Math.abs(approachDy) > EPSILON ? "vertical" : null;
				if (approachOrientation) {
					inspectedPortRays = getLegalIncidentStubsForNode(targetNode, { box: targetBox }).filter((stub) => stub.portPoint && stub.incidentDirection.includes("-")).map((stub) => {
						const port = [...stub.portPoint];
						const rayVector = [port[0] - targetBox.cx, port[1] - targetBox.cy];
						let rayParameter = null;
						let intersection = null;
						if (approachOrientation === "horizontal" && Math.abs(rayVector[1]) > EPSILON) {
							rayParameter = (approachStart[1] - port[1]) / rayVector[1];
							intersection = [port[0] + rayParameter * rayVector[0], approachStart[1]];
						} else if (approachOrientation === "vertical" && Math.abs(rayVector[0]) > EPSILON) {
							rayParameter = (approachStart[0] - port[0]) / rayVector[0];
							intersection = [approachStart[0], port[1] + rayParameter * rayVector[1]];
						}
						let approachParameter = null;
						if (intersection) approachParameter = approachOrientation === "horizontal" ? (intersection[0] - approachStart[0]) / approachDx : (intersection[1] - approachStart[1]) / approachDy;
						const rayPointsOutward = rayParameter != null && rayParameter > EPSILON;
						const intersectionOnDirectedSegment = approachParameter != null && approachParameter > EPSILON && approachParameter <= 1 + EPSILON;
						const proposedPoints = rayPointsOutward && intersectionOnDirectedSegment ? [
							...oldPoints.slice(0, -2).map((point) => [...point]),
							intersection,
							port
						] : null;
						const validation = proposedPoints ? validateEdgeAttachments({
							...baselineRoute,
							targetPort: port,
							points: proposedPoints
						}, sourceNode, targetNode, proposedPoints, {
							sourceBox,
							targetBox
						}) : null;
						const compatible = !!proposedPoints && validation?.target?.legal === true && validation.target.portName === stub.portName && validation.target.incidentDirection === stub.incidentDirection;
						return {
							portName: stub.portName,
							port,
							incidentDirection: stub.incidentDirection,
							rayVector,
							rayParameter,
							intersection,
							approachParameter,
							rayPointsOutward,
							intersectionOnDirectedSegment,
							resultingTargetLegal: validation?.target?.legal ?? null,
							resultingTargetIncidentDirection: validation?.target?.incidentDirection ?? null,
							compatible,
							proposedPoints
						};
					});
					compatibleCandidates = inspectedPortRays.filter((candidate) => candidate.compatible);
				}
			}
			if (compatibleCandidates.length === 1) {
				const selected = compatibleCandidates[0];
				route = {
					...baselineRoute,
					targetPort: [...selected.port],
					points: selected.proposedPoints.map((point) => [...point])
				};
				changedById.set(baselineRoute.edgeId, route);
				ports.set(baselineRoute.edgeId, {
					...ports.get(baselineRoute.edgeId),
					targetPort: [...selected.port],
					changed: true,
					experimentalGeneralizedTargetPort: true,
					experimentalTargetRayIntersection: [...selected.intersection]
				});
				outcome = "generalized-unique-compatible-port";
			} else if (compatibleCandidates.length > 1) outcome = "unchanged-ambiguous-compatible-ports";
		}
		census.push({
			edgeId: baselineRoute.edgeId,
			source: edge.from,
			target: edge.to,
			sourceInstructionIndex: sourceNode.instructionIndex,
			targetInstructionIndex: targetNode.instructionIndex,
			currentTargetPort: oldTargetPort,
			currentTargetPortName: oldAttachment.target.portName,
			currentTargetLegal: oldAttachment.target.legal,
			outcome,
			routeChanged: route !== baselineRoute,
			candidateCount: compatibleCandidates.length,
			candidateNamedPort: compatibleCandidates.length === 1 ? compatibleCandidates[0].portName : null,
			candidateIncidentDirection: compatibleCandidates.length === 1 ? compatibleCandidates[0].incidentDirection : null,
			intersection: compatibleCandidates.length === 1 ? compatibleCandidates[0].intersection : null,
			approachOrientation,
			approachStart,
			approachEnd,
			inspectedPortRays,
			oldRouteSuffix,
			newRouteSuffix: route.points.slice(-3).map((point) => [...point]),
			oldRoutePoints: oldPoints,
			newRoutePoints: route.points.map((point) => [...point]),
			railCoord: baselineRoute.railCoord,
			sourcePort: [...baselineRoute.sourcePort]
		});
	}
	const routes = composedView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
	const routed = {
		...composedView.routed,
		routes,
		ports
	};
	const defects = evaluateDefects({
		routes,
		boxes: composedView.boxes
	}, {
		realForkSet: composedView.roles.realForkSet,
		lcaRF: composedView.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: composedView.programName,
		orientationSource: "generalizedLoopTargetAttachmentProbe"
	});
	const attachments = attachmentRecords(composedView.cfg, composedView.roles, composedView.boxes, routes);
	const completedCensus = census.map((row) => {
		const newAttachment = attachments.find((record) => record.edgeId === row.edgeId);
		return {
			...row,
			resultingTargetPort: newAttachment?.target?.portPoint ?? null,
			resultingTargetPortName: newAttachment?.target?.portName ?? null,
			resultingTargetIncidentDirection: newAttachment?.target?.incidentDirection ?? null,
			resultingTargetLegal: newAttachment?.target?.legal ?? null,
			resultingOverallAttachmentLegal: newAttachment?.legal ?? null
		};
	});
	const changedEdgeIds = completedCensus.filter((row) => row.routeChanged).map((row) => row.edgeId);
	const ambiguousEdgeIds = completedCensus.filter((row) => row.outcome === "unchanged-ambiguous-compatible-ports").map((row) => row.edgeId);
	const noCandidateEdgeIds = completedCensus.filter((row) => row.outcome === "unchanged-no-compatible-port").map((row) => row.edgeId);
	const unexpectedlyChangedLegalEdgeIds = completedCensus.filter((row) => row.currentTargetLegal && row.routeChanged).map((row) => row.edgeId);
	return {
		...composedView,
		routed,
		ports,
		defects,
		attachments,
		renderBounds: boundsOver(composedView.boxes, routes),
		viewLabel: "Ordinary HALT — generalized backward-loop target attachments",
		experimentalRouteSplices: [...composedView.experimentalRouteSplices ?? [], ...completedCensus],
		experimentalLoopTargetAttachmentCensus: completedCensus,
		purity: {
			...composedView.purity,
			loopTargetGeneralizationConsideredEdgeIds: completedCensus.map((row) => row.edgeId),
			loopTargetGeneralizationChangedEdgeIds: changedEdgeIds,
			loopTargetGeneralizationAmbiguousEdgeIds: ambiguousEdgeIds,
			loopTargetGeneralizationNoCandidateEdgeIds: noCandidateEdgeIds,
			unexpectedlyChangedLegalEdgeIds,
			fixedLengthTargetStubUsed: false,
			crossingOrDefectScoreUsedForSelection: false,
			obstacleOrClearanceSearchUsedForSelection: false,
			sourcePortsChanged: false,
			sourceGeometryChanged: false,
			loopReturnRailsChanged: false,
			loopBendRowsChanged: false,
			nodePositionsChanged: false,
			orientationSelectionRerun: false,
			nonLoopRoutesChanged: false,
			automaticRepairAfterConstruction: false
		}
	};
}
function buildComposedLoopEndpointRealizer(rawView) {
	const base = {
		cfg: rawView.cfg,
		roles: rawView.roles,
		ownership: rawView.ownership,
		tree: rawView.tree,
		guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
		program: rawView.program,
		programName: rawView.programName,
		terminalId: rawView.terminalId
	};
	const includesRightReentry = rawView.programName === "characteristic:divides";
	const realizeExistingStack = (orientationMap) => {
		const adaptive = buildAdaptiveBranchRayMergeSourcesView(realizeExperimental(base, orientationMap));
		return includesRightReentry ? applyRightToRightHvhMerge(adaptive) : adaptive;
	};
	const realizeSources = (orientationMap) => buildGeneralizedLoopSourcePortView(realizeExistingStack(orientationMap));
	const realizeEndpoints = (orientationMap) => buildGeneralizedLoopTargetAttachmentView(realizeSources(orientationMap));
	return { includesRightReentry, realizeExistingStack, realizeSources, realizeEndpoints };
}
function buildComposedLoopEndpointCandidate(rawView) {
	const { includesRightReentry, realizeExistingStack, realizeEndpoints } = buildComposedLoopEndpointRealizer(rawView);
	const orientationResult = assignOrientation({
		realForks: rawView.roles.realForkIds,
		bottomUp: rawView.tree.bottomUp,
		rfParent: rawView.tree.rfParent,
		rfChildren: rawView.tree.rfChildren,
		evaluate: (orientationMap) => realizeEndpoints(orientationMap).defects,
		pins: /* @__PURE__ */ new Map()
	});
	const sameOrientationPreSourceControl = realizeExistingStack(orientationResult.orientationMap);
	const sameOrientationSourceControl = buildGeneralizedLoopSourcePortView(sameOrientationPreSourceControl);
	const view = buildGeneralizedLoopTargetAttachmentView(sameOrientationSourceControl);
	view.orientationResult = orientationResult;
	view.viewLabel = "Ordinary HALT — composed generalized loop endpoints";
	view.purity = {
		...view.purity,
		compositionOrder: [
			"raw transformed realization",
			"adaptive branch-merge routes",
			...includesRightReentry ? ["i-57 right-to-right H/V/H"] : [],
			"generalized backward-loop source attachment",
			"generalized backward-loop target attachment"
		],
		includesDividesOnlyRightReentry: includesRightReentry,
		orientationSelectionUsesComposedGeometry: true,
		orientationSelectionUsesComposedEndpointGeometry: true,
		orientationSelectionPins: [],
		orientationSelectionRerun: true,
		directLoopSourceChangesAgainstSameOrientation: sameOrientationSourceControl.experimentalLoopSourcePortCensus.filter((row) => row.routeChanged).map((row) => row.edgeId),
		directLoopTargetChangesAgainstSameOrientation: view.experimentalLoopTargetAttachmentCensus.filter((row) => row.routeChanged).map((row) => row.edgeId),
		automaticRepairAfterConstruction: false
	};
	return {
		view,
		sameOrientationPreSourceControl,
		sameOrientationSourceControl,
		realizeEndpoints
	};
}
function buildBranchPreservingMergeSourceView(rawView, edgeId = "i-0-yes") {
	const edge = rawView.cfg.edgeById.get(edgeId);
	const baselineRoute = rawView.routed.routes.find((route) => route.edgeId === edgeId);
	if (!edge || !baselineRoute) fail(`missing branch-preserving merge edge ${edgeId}`);
	if (edge.branch !== "yes" && edge.branch !== "no" || baselineRoute.edgeRole !== "merge-connector") fail(`${edgeId} is not the expected semantic-branch merge connector`);
	const sourcePlacement = rawView.skeleton.placements.get(edge.from);
	const visualSide = rawView.orientationOf(edge.from)?.[edge.branch];
	const siblingArm = rawView.skeleton.armSegments.find((arm) => arm.srcDiamond === edge.from && arm.side !== visualSide);
	if (!sourcePlacement || !siblingArm || baselineRoute.points.length < 2) fail(`cannot derive ordinary branch doorway for ${edgeId}`);
	const sourceBox = sourcePlacement.box;
	const sourcePort = visualSide === "left" ? [(sourceBox.left + sourceBox.cx) / 2, (sourceBox.cy + sourceBox.bottom) / 2] : [(sourceBox.cx + sourceBox.right) / 2, (sourceBox.cy + sourceBox.bottom) / 2];
	const siblingVector = [siblingArm.targetTop[0] - siblingArm.face[0], siblingArm.targetTop[1] - siblingArm.face[1]];
	const branchRayEnd = [sourcePort[0] + (visualSide === "left" ? -Math.abs(siblingVector[0]) : Math.abs(siblingVector[0])), sourcePort[1] + siblingVector[1]];
	const mergeResumePoint = [...baselineRoute.points[1]];
	const points = [
		sourcePort,
		branchRayEnd,
		mergeResumePoint,
		...baselineRoute.points.slice(2).map((point) => [...point])
	];
	const splicedRoute = {
		...baselineRoute,
		sourcePort,
		points,
		connectorKind: `${baselineRoute.connectorKind}+branchSourceStub`
	};
	const routes = rawView.routed.routes.map((route) => route.edgeId === edgeId ? splicedRoute : route);
	const ports = new Map(rawView.routed.ports);
	const baselinePort = ports.get(edgeId);
	ports.set(edgeId, {
		...baselinePort,
		sourcePort,
		experimentalBranchPreservingSource: true
	});
	const routed = {
		...rawView.routed,
		routes,
		ports
	};
	const defects = evaluateDefects({
		routes,
		boxes: rawView.boxes
	}, {
		realForkSet: rawView.roles.realForkSet,
		lcaRF: rawView.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: rawView.programName,
		orientationSource: "rawRolesBranchPreservingMergeSource"
	});
	return {
		...rawView,
		routed,
		ports,
		defects,
		renderBounds: boundsOver(rawView.boxes, routes),
		attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
		viewLabel: "Ordinary HALT — raw roles + branch-preserving merge source",
		experimentalRouteSplice: {
			edgeId,
			edgeRole: splicedRoute.edgeRole,
			routeFamily: splicedRoute.routeFamily,
			semanticBranch: edge.branch,
			visualSide,
			sourcePort,
			branchRay: [sourcePort, branchRayEnd],
			splice: [branchRayEnd, mergeResumePoint],
			mergeResumesAt: mergeResumePoint,
			targetPort: splicedRoute.targetPort,
			baselineMergeBodyAfterResume: baselineRoute.points.slice(1),
			finalRoutePoints: points
		},
		purity: {
			...rawView.purity,
			oneEdgeGeometrySpliceOnly: edgeId,
			haltSpecificMachineryAdded: false
		}
	};
}
function buildYesRayVerticalHorizontalMergeView(rawView, edgeId = "i-0-yes") {
	const departure = buildBranchPreservingMergeSourceView(rawView, edgeId).experimentalRouteSplice;
	const baselineRoute = rawView.routed.routes.find((route) => route.edgeId === edgeId);
	if (!departure || !baselineRoute) fail(`cannot construct YES ray + V/H route for ${edgeId}`);
	const sourcePort = [...departure.sourcePort];
	const branchRayEnd = [...departure.branchRay[1]];
	const targetPort = [...baselineRoute.targetPort];
	const verticalEnd = [branchRayEnd[0], targetPort[1]];
	const points = [
		sourcePort,
		branchRayEnd,
		verticalEnd,
		targetPort
	];
	const experimentalRoute = {
		...baselineRoute,
		sourcePort,
		targetPort,
		points,
		connectorKind: "branchSourceRay+verticalHorizontal"
	};
	const routes = rawView.routed.routes.map((route) => route.edgeId === edgeId ? experimentalRoute : route);
	const ports = new Map(rawView.routed.ports);
	const baselinePort = ports.get(edgeId);
	ports.set(edgeId, {
		...baselinePort,
		sourcePort,
		targetPort,
		experimentalBranchPreservingSource: true
	});
	const routed = {
		...rawView.routed,
		routes,
		ports
	};
	const defects = evaluateDefects({
		routes,
		boxes: rawView.boxes
	}, {
		realForkSet: rawView.roles.realForkSet,
		lcaRF: rawView.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: rawView.programName,
		orientationSource: "rawRolesYesRayVerticalHorizontalMerge"
	});
	return {
		...rawView,
		routed,
		ports,
		defects,
		renderBounds: boundsOver(rawView.boxes, routes),
		attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
		viewLabel: "Ordinary HALT — YES ray + V/H merge",
		experimentalRouteSplice: {
			edgeId,
			edgeRole: experimentalRoute.edgeRole,
			routeFamily: experimentalRoute.routeFamily,
			semanticBranch: rawView.cfg.edgeById.get(edgeId)?.branch,
			visualSide: departure.visualSide,
			sourcePort,
			branchRay: [sourcePort, branchRayEnd],
			verticalSegment: [branchRayEnd, verticalEnd],
			horizontalSegment: [verticalEnd, targetPort],
			targetPort,
			finalRoutePoints: points
		},
		purity: {
			...rawView.purity,
			oneEdgeGeometrySpliceOnly: edgeId,
			haltSpecificMachineryAdded: false
		}
	};
}
function buildBranchPreservingMergeSourcesView(rawView) {
	const eligibleEdges = rawView.cfg.edges.filter((edge) => (edge.branch === "yes" || edge.branch === "no") && rawView.roles.edgeRoleById.get(edge.id) === "merge-connector" && rawView.cfg.nodeById.get(edge.from)?.kind === "conditionalJump");
	let view = rawView;
	const changedRoutes = [];
	for (const edge of eligibleEdges) {
		view = buildYesRayVerticalHorizontalMergeView(view, edge.id);
		changedRoutes.push(view.experimentalRouteSplice);
	}
	return {
		...view,
		viewLabel: "Ordinary HALT — branch-preserving merge sources",
		experimentalRouteSplice: null,
		experimentalRouteSplices: changedRoutes,
		purity: {
			...view.purity,
			generalizedEligibleEdgeIds: eligibleEdges.map((edge) => edge.id),
			routeConstruction: "ordinary branch ray, then fixed vertical, then fixed horizontal",
			automaticRepairAfterConstruction: false,
			haltSpecificMachineryAdded: false
		}
	};
}
function buildAdaptiveBranchRayMergeSourcesView(rawView) {
	const fullRayView = buildBranchPreservingMergeSourcesView(rawView);
	const eligibleIds = fullRayView.purity.generalizedEligibleEdgeIds;
	const changedById = /* @__PURE__ */ new Map();
	const decisions = [];
	for (const full of fullRayView.experimentalRouteSplices) {
		const edge = rawView.cfg.edgeById.get(full.edgeId);
		const fullRoute = fullRayView.routed.routes.find((route) => route.edgeId === full.edgeId);
		if (!edge || !fullRoute) fail(`cannot construct adaptive branch ray for ${full.edgeId}`);
		const direction = full.visualSide === "left" ? -1 : 1;
		const sourcePort = [...full.sourcePort];
		const fullRayEndpoint = [...full.branchRay[1]];
		const targetPort = [...full.targetPort];
		const fullHorizontalRun = direction * (fullRayEndpoint[0] - sourcePort[0]);
		const verticalMinY = Math.min(fullRayEndpoint[1], targetPort[1]);
		const verticalMaxY = Math.max(fullRayEndpoint[1], targetPort[1]);
		const candidates = [...rawView.boxes].filter(([nodeId, box]) => nodeId !== edge.from && nodeId !== edge.to && box.bottom >= verticalMinY && box.top <= verticalMaxY).map(([nodeId, box]) => {
			const nearBoundaryX = direction > 0 ? box.left : box.right;
			return {
				nodeId,
				nodeBox: {
					left: box.left,
					right: box.right,
					top: box.top,
					bottom: box.bottom
				},
				nearBoundaryX,
				boundaryGap: direction * (nearBoundaryX - sourcePort[0])
			};
		}).filter((candidate) => candidate.boundaryGap > 1e-9).sort((a, b) => a.boundaryGap - b.boundaryGap || a.nodeId.localeCompare(b.nodeId));
		const nearestGap = candidates[0]?.boundaryGap ?? null;
		const tiedNearest = nearestGap == null ? [] : candidates.filter((candidate) => Math.abs(candidate.boundaryGap - nearestGap) < 1e-9);
		const clearanceAtFullLeg = nearestGap == null ? null : nearestGap - fullHorizontalRun;
		const midpointRun = nearestGap == null ? null : nearestGap / 2;
		const shortened = nearestGap != null && clearanceAtFullLeg < CLEARANCE && midpointRun < fullHorizontalRun;
		const chosenHorizontalRun = shortened ? midpointRun : fullHorizontalRun;
		const chosenRayEndpoint = shortened ? [sourcePort[0] + direction * chosenHorizontalRun, sourcePort[1] + chosenHorizontalRun * ordinaryVisual.branchAngleTan] : [...fullRayEndpoint];
		const points = [
			sourcePort,
			chosenRayEndpoint,
			[chosenRayEndpoint[0], targetPort[1]],
			targetPort
		];
		const route = shortened ? {
			...fullRoute,
			points,
			connectorKind: "adaptiveBranchRay+verticalHorizontal"
		} : fullRoute;
		if (shortened) changedById.set(full.edgeId, route);
		decisions.push({
			edgeId: full.edgeId,
			edgeRole: fullRoute.edgeRole,
			routeFamily: fullRoute.routeFamily,
			semanticBranch: edge.branch,
			visualSide: full.visualSide,
			sourcePort,
			fullSiblingRayLength: Math.hypot(fullRayEndpoint[0] - sourcePort[0], fullRayEndpoint[1] - sourcePort[1]),
			fullRayEndpoint,
			shortened,
			relevantVerticalYSpan: [verticalMinY, verticalMaxY],
			nearestRelevantObstruction: tiedNearest.length ? {
				kind: "node-box-boundary",
				nodeIds: tiedNearest.map((candidate) => candidate.nodeId),
				boundaryX: tiedNearest[0].nearBoundaryX,
				boxes: tiedNearest.map((candidate) => ({
					nodeId: candidate.nodeId,
					...candidate.nodeBox
				}))
			} : null,
			availableBoundaryGap: nearestGap,
			clearanceAtFullLeg,
			clearanceThreshold: CLEARANCE,
			chosenRayEndpoint,
			chosenRayLength: Math.hypot(chosenRayEndpoint[0] - sourcePort[0], chosenRayEndpoint[1] - sourcePort[1]),
			targetPort,
			finalRoutePoints: route.points
		});
	}
	const routes = fullRayView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
	const routed = {
		...fullRayView.routed,
		routes
	};
	const defects = evaluateDefects({
		routes,
		boxes: rawView.boxes
	}, {
		realForkSet: rawView.roles.realForkSet,
		lcaRF: rawView.tree.lcaRF
	}, {
		clearance: CLEARANCE,
		program: rawView.programName,
		orientationSource: "rawRolesAdaptiveBranchRayVerticalHorizontalMerge"
	});
	return {
		...fullRayView,
		routed,
		defects,
		renderBounds: boundsOver(rawView.boxes, routes),
		attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
		viewLabel: "Ordinary HALT — adaptive branch ray + V/H merge",
		experimentalRouteSplices: decisions,
		purity: {
			...fullRayView.purity,
			generalizedEligibleEdgeIds: eligibleIds,
			adaptiveChangedEdgeIds: [...changedById.keys()],
			obstructionVocabulary: "nearest unrelated node-box boundary overlapping the full V-leg Y-span",
			crowdingThreshold: "less than one existing V4 clearance unit (16px)",
			shortenedPlacement: "midpoint of doorway-to-obstruction boundary gap",
			edgeGeometryInfluencesDecision: false,
			automaticRepairAfterConstruction: false
		}
	};
}
function segmentOrientation(a, b, c) {
	return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}
function properIntersection(a, b, c, d) {
	const o1 = segmentOrientation(a, b, c), o2 = segmentOrientation(a, b, d);
	const o3 = segmentOrientation(c, d, a), o4 = segmentOrientation(c, d, b);
	if (!(o1 * o2 < -.001 && o3 * o4 < -.001)) return null;
	const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
	if (Math.abs(denominator) < 1e-9) return null;
	const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denominator;
	return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
function crossingDetails(routes) {
	const output = [];
	for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
		const a = routes[i], b = routes[j];
		if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
		let found = null;
		for (let ai = 0; ai < a.points.length - 1 && !found; ai++) for (let bi = 0; bi < b.points.length - 1 && !found; bi++) {
			const point = properIntersection(a.points[ai], a.points[ai + 1], b.points[bi], b.points[bi + 1]);
			if (point) found = {
				edgeA: a.edgeId,
				edgeB: b.edgeId,
				segmentA: ai,
				segmentB: bi,
				point
			};
		}
		if (found) output.push(found);
	}
	return output;
}
function nodeOverlapDetails(boxes) {
	const entries = [...boxes];
	const output = [];
	for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
		const [idA, a] = entries[i], [idB, b] = entries[j];
		const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
		const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
		if (overlapX > 1 && overlapY > 1) output.push({
			nodeA: idA,
			nodeB: idB,
			overlapX,
			overlapY
		});
	}
	return output;
}
function edgeOverlapDetails(routes) {
	const epsilon = 1e-7;
	const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
	const overlaps = [];
	for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
		const routeA = routes[i], routeB = routes[j];
		for (let segmentA = 0; segmentA < routeA.points.length - 1; segmentA++) {
			const a = routeA.points[segmentA], b = routeA.points[segmentA + 1];
			const vectorA = [b[0] - a[0], b[1] - a[1]];
			const lengthA = Math.hypot(...vectorA);
			if (lengthA <= epsilon) continue;
			for (let segmentB = 0; segmentB < routeB.points.length - 1; segmentB++) {
				const c = routeB.points[segmentB], d = routeB.points[segmentB + 1];
				const vectorB = [d[0] - c[0], d[1] - c[1]];
				const lengthB = Math.hypot(...vectorB);
				if (lengthB <= epsilon) continue;
				if (Math.abs(cross(vectorA, vectorB)) > epsilon * lengthA * lengthB) continue;
				if (Math.abs(cross([c[0] - a[0], c[1] - a[1]], vectorA)) > epsilon * lengthA) continue;
				const axis = Math.abs(vectorA[0]) >= Math.abs(vectorA[1]) ? 0 : 1;
				const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
				const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
				if (high - low <= epsilon) continue;
				const pointAt = (coordinate) => {
					const t = (coordinate - a[axis]) / vectorA[axis];
					return [a[0] + vectorA[0] * t, a[1] + vectorA[1] * t];
				};
				overlaps.push({
					edgeA: routeA.edgeId,
					edgeB: routeB.edgeId,
					segmentA,
					segmentB,
					interval: [pointAt(low), pointAt(high)]
				});
			}
		}
	}
	return overlaps;
}
const INTRUSION_EPSILON = 1e-9;
function segmentInteriorInterval(start, end, box) {
	const dx = end[0] - start[0], dy = end[1] - start[1];
	if (Math.hypot(dx, dy) <= INTRUSION_EPSILON) return null;
	let low = 0, high = 1;
	for (const [origin, delta, minimum, maximum] of [[
		start[0],
		dx,
		box.left,
		box.right
	], [
		start[1],
		dy,
		box.top,
		box.bottom
	]]) {
		if (Math.abs(delta) <= INTRUSION_EPSILON) {
			if (!(origin > minimum + INTRUSION_EPSILON && origin < maximum - INTRUSION_EPSILON)) return null;
			continue;
		}
		const first = (minimum - origin) / delta;
		const second = (maximum - origin) / delta;
		low = Math.max(low, Math.min(first, second));
		high = Math.min(high, Math.max(first, second));
		if (high - low <= INTRUSION_EPSILON) return null;
	}
	if (high - low <= INTRUSION_EPSILON || high < -INTRUSION_EPSILON || low > 1 + INTRUSION_EPSILON) return null;
	const tStart = Math.max(0, low), tEnd = Math.min(1, high);
	if (tEnd - tStart <= INTRUSION_EPSILON) return null;
	const pointAt = (t) => [start[0] + dx * t, start[1] + dy * t];
	const startStrictlyInside = start[0] > box.left + INTRUSION_EPSILON && start[0] < box.right - INTRUSION_EPSILON && start[1] > box.top + INTRUSION_EPSILON && start[1] < box.bottom - INTRUSION_EPSILON;
	const endStrictlyInside = end[0] > box.left + INTRUSION_EPSILON && end[0] < box.right - INTRUSION_EPSILON && end[1] > box.top + INTRUSION_EPSILON && end[1] < box.bottom - INTRUSION_EPSILON;
	const crossesCompletelyThrough = !startStrictlyInside && !endStrictlyInside && tStart > INTRUSION_EPSILON && tEnd < 1 - INTRUSION_EPSILON;
	const penetrationKind = crossesCompletelyThrough ? "crosses-completely-through" : startStrictlyInside && endStrictlyInside ? "segment-contained-inside" : "enters-partway";
	return {
		tStart,
		tEnd,
		interval: [pointAt(tStart), pointAt(tEnd)],
		crossesCompletelyThrough,
		penetrationKind
	};
}
function unrelatedNodeEdgeIntersections(routes, boxes) {
	const intersections = [];
	for (const route of routes) for (let segmentIndex = 0; segmentIndex < route.points.length - 1; segmentIndex++) {
		const segmentStart = route.points[segmentIndex];
		const segmentEnd = route.points[segmentIndex + 1];
		if (Math.hypot(segmentEnd[0] - segmentStart[0], segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON) continue;
		const orientation = Math.abs(segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON ? "horizontal" : Math.abs(segmentEnd[0] - segmentStart[0]) <= INTRUSION_EPSILON ? "vertical" : "diagonal";
		for (const [nodeId, box] of boxes) {
			if (nodeId === route.source || nodeId === route.target) continue;
			const interior = segmentInteriorInterval(segmentStart, segmentEnd, box);
			if (!interior) continue;
			intersections.push({
				nodeId,
				edgeId: route.edgeId,
				nodeBox: {
					left: box.left,
					right: box.right,
					top: box.top,
					bottom: box.bottom
				},
				segmentIndex,
				segmentStart: [...segmentStart],
				segmentEnd: [...segmentEnd],
				orientation,
				intersectionInterval: interior.interval,
				parameterInterval: [interior.tStart, interior.tEnd],
				crossesCompletelyThrough: interior.crossesCompletelyThrough,
				penetrationKind: interior.penetrationKind
			});
		}
	}
	return intersections;
}
function attachmentLegalitySnapshot(view) {
	const rowFor = (record) => ({
		edgeId: record.edgeId,
		edgeRole: record.edgeRole,
		routeFamily: record.routeFamily,
		legal: record.legal,
		source: {
			nodeId: record.source.nodeId,
			portName: record.source.portName,
			portPoint: record.source.portPoint,
			incidentDirection: record.source.incidentDirection,
			legal: record.source.legal,
			reason: record.source.reason
		},
		target: {
			nodeId: record.target.nodeId,
			portName: record.target.portName,
			portPoint: record.target.portPoint,
			incidentDirection: record.target.incidentDirection,
			legal: record.target.legal,
			reason: record.target.reason
		}
	});
	const illegal = view.attachments.filter((record) => !record.legal).map(rowFor);
	const loopReturn = view.attachments.filter((record) => record.edgeRole === "loop-return").map(rowFor);
	return {
		edgeCount: view.attachments.length,
		legalEdgeCount: view.attachments.length - illegal.length,
		illegalEdgeCount: illegal.length,
		illegalEdges: illegal,
		loopReturnEdgeCount: loopReturn.length,
		legalLoopReturnEdgeCount: loopReturn.filter((record) => record.legal).length,
		loopReturnEdges: loopReturn
	};
}
function summarizeView(view) {
	const crossings = crossingDetails(view.routed.routes);
	const edgeOverlaps = edgeOverlapDetails(view.routed.routes);
	const overlaps = nodeOverlapDetails(view.boxes);
	const intrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes);
	const terminalBox = view.boxes.get(view.terminalId);
	const incoming = view.routed.routes.filter((route) => route.target === view.terminalId).map((route) => {
		const attachment = view.attachments.find((record) => record.edgeId === route.edgeId);
		return {
			edgeId: route.edgeId,
			source: route.source,
			edgeRole: route.edgeRole,
			routeFamily: route.routeFamily,
			connectorKind: route.connectorKind,
			portPolicyCase: route.portPolicyCase,
			sourcePort: route.sourcePort,
			targetPort: route.targetPort,
			incomingPort: attachment?.target?.portName ?? null,
			attachmentLegal: attachment?.legal ?? null,
			points: route.points
		};
	});
	const orientation = mapToObject(view.orientationMap);
	const flippedForks = [...view.orientationMap].filter(([, value]) => bitName(value) === "flipped").map(([id]) => id);
	const warnings = {
		cfg: view.cfg.warnings ?? [],
		roles: view.roles.warnings ?? [],
		skeleton: view.skeleton.warnings ?? [],
		lanes: view.lanes.warnings ?? [],
		routing: view.routed.warnings ?? []
	};
	const rejectionOrFallback = Object.values(warnings).some((rows) => rows.length > 0) || view.routed.routes.some((route) => route.legal === false);
	let terminalPlacement;
	if (view.mode === "ordinary") {
		const placingEdgeId = view.cfg.incomingEdgeByNode.get(view.terminalId);
		terminalPlacement = {
			syntheticId: view.terminalId,
			displayLabel: `HALT (${view.terminalId})`,
			kindUsedByLayout: view.cfg.nodeById.get(view.terminalId)?.kind,
			nodeRole: view.roles.nodeRoleById.get(view.terminalId),
			box: terminalBox,
			branchPath: view.ownership.branchPath(view.terminalId),
			owner: view.ownership.ownerOf(view.terminalId),
			parentSource: view.cfg.edgeById.get(placingEdgeId)?.from ?? null,
			placingEdgeId,
			placedOrder: view.cfg.dfsOrder.indexOf(view.terminalId),
			incomingPorts: incoming.map((row) => ({
				edgeId: row.edgeId,
				port: row.incomingPort,
				point: row.targetPort
			}))
		};
	} else terminalPlacement = {
		syntheticId: null,
		displayLabel: "HALT",
		kindUsedByLayout: "halt",
		nodeRole: view.roles.nodeRoleById.get("halt"),
		box: terminalBox,
		branchPath: null,
		owner: null,
		parentSource: null,
		placingEdgeId: null,
		placedOrder: null,
		note: "Placed by current special HALT phase, not ordinary traversal.",
		incomingPorts: incoming.map((row) => ({
			edgeId: row.edgeId,
			port: row.incomingPort,
			point: row.targetPort
		}))
	};
	return {
		label: view.viewLabel,
		mode: view.mode,
		nodeCount: view.cfg.nodes.length,
		edgeCount: view.cfg.edges.length,
		orientation,
		flippedForks,
		orientationCost: view.defects.total,
		currentProductionStyleCost: view.defects.total,
		intrusionAwareOrientationCost: view.defects.total + intrusions.length,
		properCrossingCount: crossings.length,
		properCrossings: crossings,
		edgeOverlapCount: edgeOverlaps.length,
		edgeOverlaps,
		trueNodeOverlapCount: overlaps.length,
		trueNodeOverlaps: overlaps,
		experimentalNodeEdgeIntrusionCount: intrusions.length,
		unrelatedNodeEdgeIntersections: intrusions,
		attachmentLegality: attachmentLegalitySnapshot(view),
		terminal: terminalPlacement,
		incomingEdges: incoming,
		warnings,
		fallbackOrRejectionFired: rejectionOrFallback,
		experimentalRouteSplice: view.experimentalRouteSplice ?? null,
		experimentalRouteSplices: view.experimentalRouteSplices ?? [],
		i22FlipExperiment: view.i22FlipExperiment ?? null,
		orientationCostExperiment: view.orientationCostExperiment ?? null,
		orientationTransientDiagnosis: view.orientationTransientDiagnosis ?? null,
		completedCandidateOrientationExperiment: view.completedCandidateOrientationExperiment ?? null,
		selfConsistentOrientationExperiment: view.selfConsistentOrientationExperiment ?? null,
		purity: view.purity
	};
}
//#endregion
//#region .flow-layout-probes/_current_entry.mjs
function buildCurrentCheckpointView(program, programName) {
	return buildComposedLoopEndpointCandidate(buildRawRoleOrdinaryTerminalBase(program, programName)).view;
}

const CHECKPOINT_STAGE_IDS = Object.freeze(["BASE", "A", "B", "C", "D", "E"]);
const CURRENT_VISUAL = Object.freeze({
	sizeForKind: sizeForCurrentKind,
	branchAngleTan: ordinaryVisual.branchAngleTan,
	pitch: Object.freeze({ ...ordinaryVisual.pitch }),
	terminalSize: Object.freeze([48, 18]),
	haltBandOffset: 154,
	clearance: CLEARANCE
});

function buildNativeProductionBaseView(program, programName) {
	const layout = buildLayout(program, {
		programName,
		orientationSource: "v4Assigned",
		visual: CURRENT_VISUAL,
		pins: /* @__PURE__ */ new Map(),
		diagnostics: true
	});
	return {
		...layout,
		mode: "current",
		programName,
		program,
		attachments: attachmentRecords(layout.cfg, layout.roles, layout.boxes, layout.routed.routes),
		terminalId: "halt",
		viewLabel: "Current native production V4",
		purity: { controlUsesCurrentPipelineUnchanged: true }
	};
}

function buildCheckpointStageRealizer(rawBase, stage) {
	const normalizedStage = String(stage ?? "").toUpperCase();
	if (!CHECKPOINT_STAGE_IDS.includes(normalizedStage) || normalizedStage === "BASE") {
		throw new Error(`unknown composed checkpoint stage ${stage}`);
	}
	const realizeA = (orientationMap) => realizeExperimental(rawBase, orientationMap);
	const realizeB = (orientationMap) => buildAdaptiveBranchRayMergeSourcesView(realizeA(orientationMap));
	const realizeC = (orientationMap) => {
		const adaptive = realizeB(orientationMap);
		return rawBase.programName === "characteristic:divides" ? applyRightToRightHvhMerge(adaptive) : adaptive;
	};
	const realizeD = (orientationMap) => buildGeneralizedLoopSourcePortView(realizeC(orientationMap));
	const realizeE = (orientationMap) => buildGeneralizedLoopTargetAttachmentView(realizeD(orientationMap));
	return { A: realizeA, B: realizeB, C: realizeC, D: realizeD, E: realizeE }[normalizedStage];
}

function stageTransformStack(stage, includesRightReentry) {
	const normalizedStage = String(stage).toUpperCase();
	if (normalizedStage === "BASE") return ["native production SketchV4 realization"];
	const stack = ["ordinary synthetic terminal with raw transformed roles"];
	if (["B", "C", "D", "E"].includes(normalizedStage)) stack.push("adaptive conditional merge doorways and rays");
	if (["C", "D", "E"].includes(normalizedStage) && includesRightReentry) stack.push("divides i-57 right-to-right H/V/H compatibility route");
	if (["D", "E"].includes(normalizedStage)) stack.push("generalized backward-loop source attachment");
	if (normalizedStage === "E") stack.push("generalized backward-loop target attachment");
	return stack;
}

function buildCheckpointStageView(program, programName, stage, options = {}) {
	const normalizedStage = String(stage ?? "").toUpperCase();
	if (!CHECKPOINT_STAGE_IDS.includes(normalizedStage)) throw new Error(`unknown checkpoint stage ${stage}`);
	if (normalizedStage === "BASE") {
		if (options.orientationMap) throw new Error("BASE does not accept a harness orientation override");
		const view = buildNativeProductionBaseView(program, programName);
		view.checkpointStage = normalizedStage;
		view.stageTransformStack = stageTransformStack(normalizedStage, false);
		return view;
	}

	const rawBase = buildRawRoleOrdinaryTerminalBase(program, programName);
	const realize = buildCheckpointStageRealizer(rawBase, normalizedStage);
	let orientationResult = null;
	let orientationMap = options.orientationMap ?? null;
	if (!orientationMap) {
		orientationResult = assignOrientation({
			realForks: rawBase.roles.realForkIds,
			bottomUp: rawBase.tree.bottomUp,
			rfParent: rawBase.tree.rfParent,
			rfChildren: rawBase.tree.rfChildren,
			evaluate: (candidateMap) => realize(candidateMap).defects,
			pins: /* @__PURE__ */ new Map()
		});
		orientationMap = orientationResult.orientationMap;
	}
	const view = realize(orientationMap);
	view.orientationMap = orientationMap;
	view.orientationResult = orientationResult;
	view.checkpointStage = normalizedStage;
	view.stageTransformStack = stageTransformStack(normalizedStage, programName === "characteristic:divides");
	return view;
}
function canonicalGeometry(view) {
	return JSON.stringify({
		nodeBoxes: [...view.boxes].sort(([a], [b]) => a.localeCompare(b)).map(([id, box]) => [
			id,
			box.left,
			box.right,
			box.top,
			box.bottom,
			box.cx,
			box.cy,
			box.w,
			box.h
		]),
		routes: view.routed.routes.slice().sort((a, b) => a.edgeId.localeCompare(b.edgeId)).map((route) => [
			route.edgeId,
			route.source,
			route.target,
			route.sourcePort,
			route.targetPort,
			route.points
		]),
		orientation: [...view.orientationMap].sort(([a], [b]) => a.localeCompare(b)).map(([id, orientation]) => [
			id,
			orientation.no,
			orientation.yes
		])
	});
}
function namedOrientationMap(view) {
	return Object.fromEntries([...view.orientationMap].sort(([a], [b]) => a.localeCompare(b)).map(([id, orientation]) => [id, orientation.no === "right" ? "flipped" : "default"]));
}
//#endregion
export { CHECKPOINT_STAGE_IDS, buildCheckpointStageView, buildComposedLoopEndpointRealizer, buildCurrentCheckpointView, buildRawRoleOrdinaryTerminalBase, canonicalGeometry, namedOrientationMap, summarizeView, unrelatedNodeEdgeIntersections };

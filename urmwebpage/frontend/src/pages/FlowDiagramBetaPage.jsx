import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../api.js";
import BetaFlowDiagram, {
  buildFlowGeometryReport,
} from "../components/BetaFlowDiagram.jsx";
import FunctionRunner from "../components/FunctionRunner.jsx";
import { normalizeFunctionKind } from "../functionMetadata.js";
import { normalizeCharacteristicRelation } from "../characteristicMetadata.js";
import {
  normalizeFunctionSpec,
  validateFunctionSpec,
} from "../components/FunctionSpecBuilder.jsx";

const DEFAULT_FUNCTION_SPEC = { kind: "successor" };
const GEOMETRY_COLLECTION_PRESETS = [
  { id: "minimization", label: "Minimization", functionSpec: { kind: "minimization", inner: { kind: "bounded_sub" } } },
  { id: "truncated-subtraction", label: "Truncated subtraction", functionSpec: { kind: "bounded_sub" } },
  { id: "predecessor", label: "Predecessor", functionSpec: { kind: "predecessor" } },
  { id: "addition", label: "Addition", functionSpec: { kind: "add" } },
  {
    id: "composition-bounded-sub",
    label: "Composition with truncated subtraction",
    functionSpec: { kind: "compose", outer: { kind: "successor" }, inner: { kind: "bounded_sub" } },
  },
  {
    id: "characteristic-leq",
    label: "Characteristic Function x \u2264 y",
    functionSpec: { kind: "characteristic", relation: "leq" },
  },
  {
    id: "characteristic-eq",
    label: "Characteristic Function x = y",
    functionSpec: { kind: "characteristic", relation: "eq" },
  },
  {
    id: "primitive-recursion-basic",
    label: "Primitive recursion example",
    functionSpec: {
      kind: "primrec",
      base: { kind: "zero" },
      step: { kind: "add" },
      recursion_index: 0,
    },
  },
  {
    id: "primitive-recursion-long",
    label: "Primitive recursion (long)",
    functionSpec: {
      kind: "primrec",
      base: { kind: "bounded_sub" },
      step: { kind: "compose", outer: { kind: "add" }, inner: { kind: "bounded_sub" } },
      recursion_index: 0,
    },
  },
];

function summarizeComposeShape(spec) {
  const outerKind = normalizeFunctionKind(spec?.outer?.kind);
  const innerKind = normalizeFunctionKind(spec?.inner?.kind);
  return `${outerKind}|${innerKind}`;
}

function summarizePrimrecShape(spec) {
  const baseKind = normalizeFunctionKind(spec?.base?.kind);
  const stepKind = normalizeFunctionKind(spec?.step?.kind);
  const stepOuterKind = normalizeFunctionKind(spec?.step?.outer?.kind);
  const stepInnerKind = normalizeFunctionKind(spec?.step?.inner?.kind);
  const recursionIndex = Number.isInteger(spec?.recursion_index) ? spec.recursion_index : null;
  return `${baseKind}|${stepKind}|${stepOuterKind}|${stepInnerKind}|${recursionIndex}`;
}

function getBetaFlowLayoutMetadata(functionSpec) {
  const kind = normalizeFunctionKind(functionSpec?.kind);

  if (kind === "predecessor") {
    return {
      exampleKey: "predecessor",
      hasTunedLayout: true,
      layoutStatus: "confirmedTuned",
    };
  }

  if (kind === "add") {
    return {
      exampleKey: "addition",
      hasTunedLayout: true,
      layoutStatus: "confirmedTuned",
    };
  }

  if (kind === "bounded_sub") {
    return {
      exampleKey: "bounded_sub",
      hasTunedLayout: true,
      layoutStatus: "confirmedTuned",
    };
  }

  if (kind === "minimization") {
    const innerKind = normalizeFunctionKind(functionSpec?.inner?.kind);
    if (innerKind === "bounded_sub") {
      return {
        exampleKey: "minimization:bounded_sub",
        hasTunedLayout: true,
        layoutStatus: "confirmedTuned",
      };
    }

    return {
      exampleKey: `minimization:${innerKind}`,
      hasTunedLayout: false,
      layoutStatus: "genericDefault",
    };
  }

  if (kind === "compose") {
    const composeShape = summarizeComposeShape(functionSpec);
    if (composeShape === "successor|bounded_sub") {
      return {
        exampleKey: "compose:successor|bounded_sub",
        hasTunedLayout: true,
        layoutStatus: "confirmedTuned",
      };
    }
    if (composeShape === "successor|add") {
      return {
        exampleKey: "compose:successor|add",
        hasTunedLayout: false,
        layoutStatus: "motifSpecificButUnconfirmed",
      };
    }

    return {
      exampleKey: `compose:${composeShape}`,
      hasTunedLayout: false,
      layoutStatus: "genericDefault",
    };
  }

  if (kind === "characteristic") {
    const relation = normalizeCharacteristicRelation(functionSpec?.relation);
    if (relation === "eq" || relation === "divides") {
      return {
        exampleKey: `characteristic:${relation}`,
        hasTunedLayout: false,
        layoutStatus: "experimentalGeneratedOnly",
      };
    }
    if (relation === "leq" || relation === "lt") {
      return {
        exampleKey: `characteristic:${relation}`,
        hasTunedLayout: false,
        layoutStatus: "motifSpecificButUnconfirmed",
      };
    }

    return {
      exampleKey: `characteristic:${relation}`,
      hasTunedLayout: false,
      layoutStatus: "genericDefault",
    };
  }

  if (kind === "zero") {
    return {
      exampleKey: "zero",
      hasTunedLayout: false,
      layoutStatus: "experimentalGeneratedOnly",
    };
  }

  if (kind === "successor") {
    return {
      exampleKey: "successor",
      hasTunedLayout: false,
      layoutStatus: "experimentalGeneratedOnly",
    };
  }

  if (kind === "primrec") {
    const shape = summarizePrimrecShape(functionSpec);
    if (shape === "constant|successor|||" || shape === "constant|successor|||0") {
      return {
        exampleKey: `primrec:${shape}`,
        hasTunedLayout: false,
        layoutStatus: "motifSpecificButUnconfirmed",
      };
    }
    if (shape === "zero|add|||0") {
      return {
        exampleKey: `primrec:${shape}`,
        hasTunedLayout: false,
        layoutStatus: "motifSpecificButUnconfirmed",
      };
    }
    if (shape === "bounded_sub|compose|add|bounded_sub|0") {
      return {
        exampleKey: `primrec:${shape}`,
        hasTunedLayout: false,
        layoutStatus: "experimentalGeneratedOnly",
      };
    }

    return {
      exampleKey: `primrec:${shape}`,
      hasTunedLayout: false,
      layoutStatus: "genericDefault",
    };
  }

  return {
    exampleKey: kind || "unknown",
    hasTunedLayout: false,
    layoutStatus: "genericDefault",
  };
}

function isGeometryCollectionModeEnabled() {
  if (import.meta.env.PROD) return false;
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("geometryCollect") === "1") return true;
  } catch {
    // Ignore URL parsing issues in debug-only collection mode.
  }

  try {
    return window.localStorage?.getItem("betaFlowGeometryCollect") === "1";
  } catch {
    return false;
  }
}

export default function FlowDiagramBetaPage() {
  const [selectedFunctionState, setSelectedFunctionState] = useState({
    functionSpec: DEFAULT_FUNCTION_SPEC,
  });
  // compiledResult bundles the program with the functionSpec that produced it so that
  // both change atomically in a single render when a compile completes. This prevents
  // BetaFlowDiagram from receiving mismatched (old-program, new-functionId) inputs,
  // which previously caused SketchV3 to compute once with stale data before the correct
  // program arrived.
  const [compiledResult, setCompiledResult] = useState(null);
  const [generationRequest, setGenerationRequest] = useState(null);
  const latestGenerationRef = useRef(null);
  const [diagramMessage, setDiagramMessage] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  // "Collapse setup blocks" (v1) is disabled/archived — see
  // .sketchv3-harness/archive/collapse_setup_blocks_v1_disabled.md. The control was removed and
  // BetaFlowDiagram hardcodes collapseSetupBlocks=false, so the active SketchV4 layout always runs
  // on the original full program. To be rebuilt as a post-layout display macro layer (v2).
  const [showLayoutComparison, setShowLayoutComparison] = useState(false);
  // Derive layoutMetadata from the compiled functionSpec (not the UI-selected one) so it
  // changes atomically with program. compiledResult is stable state — only updates on compile.
  const layoutMetadata = useMemo(
    () => getBetaFlowLayoutMetadata(compiledResult?.functionSpec ?? null),
    [compiledResult],
  );

  // FunctionRunner has a useEffect([onRunDataChange, runData]) that fires whenever either dep
  // changes.  An inline onRunDataChange is a new reference every render, so after the user
  // clicks Run (runData != null) any state change in this component would re-fire that effect,
  // call setCompiledResult with a new object, which triggers another render, which creates
  // another new onRunDataChange — an infinite loop.
  //
  // Fix: keep a ref to the current functionSpec so the callback can always access the latest
  // value without being recreated, then use an empty-dep useCallback so its identity is stable.
  const selectedFunctionStateRef = useRef(selectedFunctionState);
  selectedFunctionStateRef.current = selectedFunctionState;

  const handleRunDataChange = useCallback((runData) => {
    if (!Array.isArray(runData?.program)) {
      latestGenerationRef.current = null;
      setGenerationRequest(null);
      setCompiledResult(null);
      setIsCompiling(false);
      setDiagramMessage(runData ? "No program was returned for the selected function." : "");
      return;
    }
    const { functionSpec } = selectedFunctionStateRef.current;
    if (JSON.stringify(normalizeFunctionSpec(runData.function)) !== JSON.stringify(normalizeFunctionSpec(functionSpec))) return;
    if (latestGenerationRef.current?.runData === runData
      && latestGenerationRef.current.functionSpec === functionSpec) return;

    const request = { runData, functionSpec };
    latestGenerationRef.current = request;
    setGenerationRequest(request);
    setCompiledResult(null);
    setIsCompiling(true);
    setDiagramMessage("");
  }, []);

  const handleFunctionStateChange = useCallback((state) => {
    selectedFunctionStateRef.current = state;
    setSelectedFunctionState(state);
    handleRunDataChange(null);
  }, [handleRunDataChange]);

  // Only accepted explicit generation starts compilation. Setup edits invalidate
  // the request synchronously, before effect cleanup aborts any pending fetch.
  useEffect(() => {
    if (!generationRequest || latestGenerationRef.current !== generationRequest) return undefined;
    const { functionSpec } = generationRequest;
    const validationMessage = validateFunctionSpec(functionSpec);

    if (validationMessage) {
      setIsCompiling(false);
      setDiagramMessage(validationMessage);
      return undefined;
    }

    const controller = new AbortController();

    async function compileSelectedFunction() {
      try {
        const response = await fetch(`${API_URL}/compile-function`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(normalizeFunctionSpec(functionSpec)),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`Compile failed: ${response.status}`);
        const payload = await response.json();
        if (controller.signal.aborted || latestGenerationRef.current !== generationRequest) return;
        if (!Array.isArray(payload?.program)) throw new Error("No compiled program returned");
        if (JSON.stringify(normalizeFunctionSpec(payload.function)) !== JSON.stringify(normalizeFunctionSpec(functionSpec))) {
          throw new Error("Compiled program does not match the selected function");
        }

        setCompiledResult({ program: payload.program, functionSpec });
        setIsCompiling(false);
        setDiagramMessage("");
      } catch (error) {
        if (error.name === "AbortError" || latestGenerationRef.current !== generationRequest) return;
        setCompiledResult(null);
        setIsCompiling(false);
        setDiagramMessage("Could not generate the flow diagram. Please try again.");
      }
    }

    void compileSelectedFunction();
    return () => controller.abort();
  }, [generationRequest]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!isGeometryCollectionModeEnabled()) return undefined;

    let disposed = false;

    function normalizeOnlyFilter(only, presets) {
      if (only === undefined || only === null || only === "") return presets;
      const values = Array.isArray(only) ? only : [only];
      const wanted = new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean));

      return presets.filter((preset) => (
        wanted.has(String(preset.id).toLowerCase()) ||
        wanted.has(String(preset.label).toLowerCase())
      ));
    }

    async function parseCompileErrorBody(response) {
      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();

      try {
        if (contentType.includes("application/json")) {
          return await response.json();
        }
      } catch {
        // Fall through to text attempt.
      }

      try {
        const text = await response.text();
        return text || null;
      } catch {
        return null;
      }
    }

    async function compileProgram(functionSpec, presetLabel = "unknown preset") {
      const compilePayload = normalizeFunctionSpec(functionSpec);
      const response = await fetch(`${API_URL}/compile-function`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(compilePayload),
      });

      if (!response.ok) {
        const responseBody = await parseCompileErrorBody(response);
        const error = new Error(`[${presetLabel}] compile failed: ${response.status}`);
        error.status = response.status;
        error.responseBody = responseBody;
        error.compilePayload = compilePayload;
        throw error;
      }

      const payload = await response.json();
      if (!Array.isArray(payload?.program)) {
        const error = new Error(`[${presetLabel}] compile succeeded but no program returned.`);
        error.status = response.status;
        error.responseBody = payload ?? null;
        error.compilePayload = compilePayload;
        throw error;
      }

      return {
        program: payload.program,
        compilePayload,
      };
    }

    async function collectFlowGeometryReports({
      collapse = false,
      presets = GEOMETRY_COLLECTION_PRESETS,
      only = null,
    } = {}) {
      const selectedPresets = normalizeOnlyFilter(only, presets);
      const reports = [];

      for (const preset of selectedPresets) {
        if (disposed) break;

        try {
          const { program, compilePayload } = await compileProgram(preset.functionSpec, `${preset.id} (${preset.label})`);
          const report = buildFlowGeometryReport(program, preset.functionSpec?.kind, {
            collapseSetupBlocks: collapse,
          });

          reports.push({
            ok: true,
            id: preset.id,
            label: preset.label,
            functionSpec: compilePayload,
            summary: report?.summary ?? null,
            compact: report?.compact ?? null,
            motifs: report?.motifs ?? [],
            warnings: report?.warnings ?? [],
          });
        } catch (error) {
          const status = Number.isInteger(error?.status) ? error.status : null;
          const responseBody = error?.responseBody ?? null;
          const compilePayload = error?.compilePayload ?? normalizeFunctionSpec(preset.functionSpec);

          const failedEntry = {
            ok: false,
            id: preset.id,
            label: preset.label,
            functionSpec: compilePayload,
            error: {
              message: String(error?.message ?? "Unknown collection error"),
              status,
              responseBody,
            },
            summary: null,
            compact: null,
            motifs: [],
            warnings: [],
          };

          reports.push(failedEntry);
          console.warn(
            `[beta-flow-geometry] Collection failed for preset ${preset.id} (${preset.label}).`,
            failedEntry.error,
          );
        }
      }

      window.__betaFlowGeometryCollectedReports = reports;
      return reports;
    }

    window.__betaFlowGeometryCollectionPresets = GEOMETRY_COLLECTION_PRESETS;
    window.__collectBetaFlowGeometryReports = collectFlowGeometryReports;
    window.__downloadBetaFlowGeometryReports = (reports = window.__betaFlowGeometryCollectedReports) => {
      const payload = JSON.stringify(reports ?? [], null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "flow-geometry-reports.json";
      link.click();
      URL.revokeObjectURL(url);
    };

    return () => {
      disposed = true;
      delete window.__betaFlowGeometryCollectionPresets;
      delete window.__collectBetaFlowGeometryReports;
      delete window.__downloadBetaFlowGeometryReports;
    };
  }, []);

  return (
    <div className="compute-page beta-flow-page">
      <section className="public-tool-intro" aria-labelledby="beta-flow-title">
        <h1 id="beta-flow-title">Flow Diagram</h1>
      </section>

      <div className="public-tool-workspace page-stack">
        <section className="beta-flow-selector" aria-label="Function selector">
          <FunctionRunner
            initialFunctionSpec={DEFAULT_FUNCTION_SPEC}
            hideMachinePanel
            publicGenerateProgram
            onRunDataChange={handleRunDataChange}
            onFunctionStateChange={handleFunctionStateChange}
          />
        </section>

        {isCompiling ? <p role="status">Compiling flow diagram…</p> : null}
        {diagramMessage ? <p role="alert">{diagramMessage}</p> : null}
        {compiledResult ? (
          <section
            className="beta-flow-card beta-flow-placeholder-card"
            aria-labelledby="beta-flow-placeholder-title"
            data-selected-kind={compiledResult.functionSpec?.kind ?? "successor"}
          >
            <h3 id="beta-flow-placeholder-title" className="beta-flow-card-title">
              Generated flow diagram
            </h3>
            {import.meta.env.DEV && layoutMetadata?.hasTunedLayout ? (
              <label>
                <input
                  type="checkbox"
                  checked={showLayoutComparison}
                  onChange={(event) => setShowLayoutComparison(event.target.checked)}
                />
                {" "}
                Show layout comparison
              </label>
            ) : null}
            <BetaFlowDiagram
              program={compiledResult.program}
              selectedFunctionId={compiledResult.functionSpec?.kind}
              selectedExampleName={layoutMetadata?.exampleKey ?? compiledResult.functionSpec?.kind}
              layoutMetadata={layoutMetadata}
              showLayoutComparison={import.meta.env.DEV && showLayoutComparison}
              nativeViewControls
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}

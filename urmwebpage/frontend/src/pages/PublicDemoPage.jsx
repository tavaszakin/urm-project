import { useMemo, useState } from "react";
import AppHeader from "../components/AppHeader.jsx";
import DemoFlowVisualization from "../components/DemoFlowVisualization.jsx";
import FurtherReading from "../components/FurtherReading.jsx";
import FunctionRunner from "../components/FunctionRunner.jsx";
import {
  DEMO_FUNCTION_SPEC,
  DEMO_INPUTS,
  DEMO_SUBTITLE,
  DEMO_TITLE,
} from "../demoDefaults.js";

const ENABLE_DEMO_FLOW_VIEW = true;

export default function PublicDemoPage({ onNavigate, themeMode }) {
  if (ENABLE_DEMO_FLOW_VIEW) {
    return <PublicDemoPageWithFlow onNavigate={onNavigate} themeMode={themeMode} />;
  }

  return (
    <main className="app-shell app-shell-light">
      <AppHeader
        activePath="/demo"
        onNavigate={onNavigate}
        subtitle="Demo"
        light={themeMode === "light"}
      />

      <div className="page-stack compute-page">
        <section className="page-intro page-intro-compact">
          <div className="page-intro-copy">
            <h2 id="demo-title" className="page-title">{DEMO_TITLE}</h2>
            <p className="page-copy">{DEMO_SUBTITLE}</p>
          </div>
        </section>

        <FunctionRunner
          initialFunctionSpec={DEMO_FUNCTION_SPEC}
          fixedFunctionSpec={DEMO_FUNCTION_SPEC}
          initialInputs={DEMO_INPUTS}
          showFunctionModeSelector={false}
          autoRunOnMount
          machinePanelProgramCaption=""
        />

        <FurtherReading items={["Cutland, Computability, §1.2"]} />
      </div>
    </main>
  );
}

function PublicDemoPageWithFlow({ onNavigate, themeMode }) {
  const [runData, setRunData] = useState(null);
  const [playbackInfo, setPlaybackInfo] = useState({
    currentTraceIndex: 0,
    maxTraceIndex: 0,
    isPlaying: false,
    hasTrace: false,
  });

  const currentTraceRow = useMemo(() => {
    const trace = Array.isArray(runData?.trace) ? runData.trace : [];
    return trace[playbackInfo.currentTraceIndex] ?? null;
  }, [playbackInfo.currentTraceIndex, runData]);

  const currentInstruction = useMemo(() => {
    const instructionIndex = currentTraceRow?.instructionIndex;
    const program = Array.isArray(runData?.program) ? runData.program : [];

    return {
      index: Number.isInteger(instructionIndex) ? instructionIndex : null,
      instruction: Array.isArray(currentTraceRow?.instruction)
        ? currentTraceRow.instruction
        : null,
      programInstruction: Number.isInteger(instructionIndex)
        ? program[instructionIndex] ?? null
        : null,
      halted: currentTraceRow?.halted === true,
    };
  }, [currentTraceRow, runData]);

  const registers = Array.isArray(currentTraceRow?.registers)
    ? currentTraceRow.registers
    : runData?.initial_registers ?? DEMO_INPUTS;

  return (
    <main className="app-shell app-shell-light">
      <AppHeader
        activePath="/demo"
        onNavigate={onNavigate}
        subtitle="Demo"
        light={themeMode === "light"}
      />

      <div className="page-stack compute-page">
        <section className="page-intro page-intro-compact">
          <div className="page-intro-copy">
            <h2 id="demo-title" className="page-title">{DEMO_TITLE}</h2>
            <p className="page-copy">{DEMO_SUBTITLE}</p>
          </div>
        </section>

        <FunctionRunner
          initialFunctionSpec={DEMO_FUNCTION_SPEC}
          fixedFunctionSpec={DEMO_FUNCTION_SPEC}
          initialInputs={DEMO_INPUTS}
          showFunctionModeSelector={false}
          autoRunOnMount
          machinePanelProgramCaption=""
          onRunDataChange={setRunData}
          onPlaybackInfoChange={setPlaybackInfo}
        />

        {/*
          Later move DemoFlowVisualization into the right column as a toggle
          between the URM Program table and Flow view.
        */}
        <DemoFlowVisualization
          currentTraceStep={playbackInfo.currentTraceIndex}
          currentInstruction={currentInstruction}
          registers={registers}
        />

        <FurtherReading items={["Cutland, Computability, §1.2"]} />
      </div>
    </main>
  );
}

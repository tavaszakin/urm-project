import FunctionRunner from "../components/FunctionRunner.jsx";

export default function ComputePage() {
  const programTable = import.meta.env.DEV && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("program-table") : null;
  const contentSizedProgram = programTable !== "original";
  const refinedProgramTable = contentSizedProgram && programTable !== "content-200";
  const traceMathCap = !(import.meta.env.DEV && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("trace-math") === "uncapped");

  return (
    <div
      className={`compute-page${contentSizedProgram ? " compute-program-table-experiment" : ""}${refinedProgramTable ? " compute-program-table-refinement" : ""}${traceMathCap ? " compute-trace-math-cap" : ""}`}
      data-table-aesthetics-experiment=""
    >
      <section className="public-tool-intro">
        <h1>Simulator</h1>
      </section>

      <div className="public-tool-workspace">
        <FunctionRunner
          hideMachinePanelSectionCaptions
          publicSectionHeadings
          publicGenerateProgram
          publicDocumentPlayback
          contentSizedProgram={contentSizedProgram}
          showProgramHeader={contentSizedProgram}
        />
      </div>
    </div>
  );
}

import FunctionRunner from "../components/FunctionRunner.jsx";

export default function ComputePage() {
  return (
    <div className="compute-page">
      <section className="public-tool-intro">
        <h1>Simulator</h1>
      </section>

      <div className="public-tool-workspace">
        <FunctionRunner hideMachinePanelSectionCaptions />
      </div>
    </div>
  );
}

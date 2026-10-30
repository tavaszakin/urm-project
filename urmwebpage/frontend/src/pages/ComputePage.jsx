import FunctionRunner from "../components/FunctionRunner.jsx";

export default function ComputePage() {
  return (
    <div className="page-stack compute-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">Simulator</h2>
        </div>
      </section>

      <FunctionRunner hideMachinePanelSectionCaptions />
    </div>
  );
}

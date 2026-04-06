import FunctionRunner from "../components/FunctionRunner.jsx";

export default function ComputePage() {
  return (
    <div className="page-stack compute-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">Compute</h2>
          <p className="page-copy">
            Define a function, evaluate it, and inspect the resulting program and trace.
          </p>
        </div>
      </section>

      <FunctionRunner />
    </div>
  );
}

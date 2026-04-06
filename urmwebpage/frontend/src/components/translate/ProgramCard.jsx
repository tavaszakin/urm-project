import ProgramListing from "../ProgramListing.jsx";

export default function ProgramCard({ program, activeInstructionIndex }) {
  return (
    <section className="translate-card translate-card-program">
      <div className="translate-card-header">
        <div>
          <div className="translate-card-kicker">Section B</div>
          <h3 className="translate-card-title">URM Program</h3>
        </div>
      </div>

      <div className="translate-surface translate-program-surface">
        <ProgramListing
          program={program}
          activeInstructionIndex={activeInstructionIndex}
          maxHeight={260}
          compact
        />
      </div>
    </section>
  );
}

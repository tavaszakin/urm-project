export default function FiniteStructuresBetaPage() {
  return (
    <div className="page-stack compute-page">
      <section className="page-intro page-intro-compact" aria-labelledby="finite-structures-beta-title">
        <div className="page-intro-copy">
          <div style={titleRowStyle}>
            <h2 id="finite-structures-beta-title" className="page-title">
              Finite Structures Lab
            </h2>
            <span style={betaLabelStyle}>Experimental</span>
          </div>
        </div>
      </section>
    </div>
  );
}

const titleRowStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "8px",
};

const betaLabelStyle = {
  color: "var(--app-label-color)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--app-label-size)",
  fontWeight: "var(--app-label-weight)",
  letterSpacing: "var(--app-label-letter-spacing)",
  lineHeight: "var(--app-label-line)",
  textTransform: "uppercase",
};

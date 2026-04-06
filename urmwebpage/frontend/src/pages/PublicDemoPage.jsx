import AppHeader from "../components/AppHeader.jsx";
import FunctionRunner from "../components/FunctionRunner.jsx";
import {
  DEMO_FUNCTION_SPEC,
  DEMO_INPUTS,
  DEMO_SUBTITLE,
  DEMO_TITLE,
} from "../demoDefaults.js";

export default function PublicDemoPage({ onNavigate, themeMode }) {
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
        />
      </div>
    </main>
  );
}

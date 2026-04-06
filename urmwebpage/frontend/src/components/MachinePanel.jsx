import { Fragment, useEffect, useMemo, useRef } from "react";
import ProgramListing from "./ProgramListing.jsx";
import TraceTable from "./TraceTable.jsx";
import { TYPOGRAPHY } from "../theme.js";
import KatexMath from "./KatexMath.jsx";
import { formatInstructionLatex } from "../utils/urmFormatting.js";

const STATUS_CHANGED_BACKGROUND = "var(--machine-changed-bg)";
const STATUS_CHANGED_BORDER = "var(--machine-changed-bg)";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function scrollElementIntoContainerView(element) {
  const container = element?.closest(".machine-scroll-shell, .program-listing");
  if (!container || !element) return;

  const containerHeight = container.clientHeight;
  const maxScrollTop = Math.max(0, container.scrollHeight - containerHeight);
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + containerHeight;
  const elementTop = element.offsetTop;
  const elementBottom = elementTop + element.offsetHeight;
  const leadingPadding = Math.max(18, Math.round(containerHeight * 0.16));
  const trailingPadding = Math.max(22, Math.round(containerHeight * 0.24));

  let nextScrollTop = null;

  if (elementTop < viewTop + leadingPadding) {
    nextScrollTop = clamp(elementTop - leadingPadding, 0, maxScrollTop);
  } else if (elementBottom > viewBottom - trailingPadding) {
    nextScrollTop = clamp(elementBottom - containerHeight + trailingPadding, 0, maxScrollTop);
  }

  if (nextScrollTop !== null) {
    container.scrollTo({ top: nextScrollTop, behavior: "smooth" });
  }
}

function splitPanelTitle(title) {
  if (typeof title !== "string") {
    return { label: "", value: title };
  }

  const match = title.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    return { label: "", value: title };
  }

  return {
    label: match[1],
    value: match[2],
  };
}

function InlineInstructionMath({ value }) {
  return (
    <KatexMath
      expression={formatInstructionLatex(value)}
      style={{
        display: "inline-block",
        lineHeight: "inherit",
        fontSize: "0.95em",
        color: "inherit",
      }}
    />
  );
}

function InlineRegisterMath({ index }) {
  return (
    <KatexMath
      expression={`R_{${index}}`}
      style={{
        display: "inline-block",
        lineHeight: "inherit",
        fontSize: "1em",
        color: "inherit",
      }}
    />
  );
}

function CombinedProgramTable({ combinedProgramRows, row, programRefs }) {
  return (
    <div className="machine-program-shell machine-scroll-shell machine-program-scroll-shell">
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          ...TYPOGRAPHY.styles.code,
          fontSize: "1.06em",
          lineHeight: 1.1,
          color: "var(--machine-inner-text-primary)",
        }}
      >
        <thead>
          <tr style={{ background: "transparent" }}>
            {["#", "Instruction"].map((header) => (
              <th
                key={header}
                style={{
                  ...TYPOGRAPHY.styles.traceHeader,
                  padding: "4px 10px 10px",
                  borderBottom: "none",
                  textAlign: header === "Instruction" ? "left" : "center",
                  whiteSpace: "nowrap",
                  color:
                    header === "Instruction"
                      ? "var(--machine-inner-text-structural)"
                      : "var(--machine-inner-text-secondary)",
                  fontSize: "1em",
                  lineHeight: 1.08,
                  fontWeight:
                    header === "Instruction"
                      ? TYPOGRAPHY.weights.semibold
                      : TYPOGRAPHY.weights.regular,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {combinedProgramRows.map((programRow, rowIndex) => {
            const displayInstructionNumber = rowIndex + 1;
            const isCurrent =
              row?.stageKey === programRow.stageKey &&
              row?.instructionIndex === programRow.instructionIndex;
            const isStageBoundary = rowIndex > 0 && programRow.stage !== combinedProgramRows[rowIndex - 1].stage;
            const showStageLabel =
              rowIndex === 0 || programRow.stageKey !== combinedProgramRows[rowIndex - 1].stageKey;

            return (
              <Fragment key={programRow.key}>
                {showStageLabel && (
                  <tr>
                    <td
                      colSpan={2}
                      style={{
                        padding: rowIndex === 0 ? "8px 10px 6px" : "12px 10px 6px",
                        borderBottom: "none",
                        borderTop: rowIndex === 0 ? "none" : "1px solid var(--machine-inner-border)",
                        background: "transparent",
                        textAlign: "left",
                      }}
                    >
                      <span className="machine-program-group-label">
                        {programRow.stage}: {programRow.functionName}
                      </span>
                    </td>
                  </tr>
                )}

                <tr
                  ref={(el) => {
                    programRefs.current[programRow.key] = el;
                  }}
                  style={{ background: "transparent" }}
                >
                  <td
                    style={{
                      ...TYPOGRAPHY.styles.traceCell,
                      width: 44,
                      padding: "7px 8px",
                      fontSize: "1em",
                      lineHeight: 1.1,
                      borderTop: `1px solid ${isCurrent ? "color-mix(in srgb, var(--machine-active-border) 62%, transparent)" : isStageBoundary ? "var(--machine-inner-border-strong)" : "var(--machine-inner-border)"}`,
                      borderBottom: `1px solid ${isCurrent ? "color-mix(in srgb, var(--machine-active-border) 62%, transparent)" : isStageBoundary ? "var(--machine-inner-border-strong)" : "var(--machine-inner-border)"}`,
                      borderLeft: isCurrent ? "4px solid var(--machine-active-bg)" : "4px solid transparent",
                      textAlign: "center",
                      fontWeight: isCurrent ? TYPOGRAPHY.weights.semibold : TYPOGRAPHY.weights.regular,
                      whiteSpace: "nowrap",
                      color: isCurrent
                        ? "var(--machine-inner-text-structural)"
                        : "var(--machine-inner-text-secondary)",
                      background: isCurrent ? "var(--machine-active-link-bg)" : "transparent",
                      borderTopLeftRadius: 1,
                      borderBottomLeftRadius: 1,
                      boxShadow: isCurrent ? "inset 0 0 0 1px color-mix(in srgb, var(--machine-active-border) 28%, transparent)" : "inset 0 -1px 0 var(--machine-inner-border)",
                    }}
                  >
                    <span title={`I_${displayInstructionNumber}`}>
                      {isCurrent ? "▶ " : ""}
                      {displayInstructionNumber}
                    </span>
                  </td>
                  <td
                    style={{
                      ...TYPOGRAPHY.styles.traceCell,
                      padding: "7px 12px 7px 10px",
                      fontSize: "1em",
                      lineHeight: 1.1,
                      borderTop: `1px solid ${isCurrent ? "color-mix(in srgb, var(--machine-active-border) 62%, transparent)" : isStageBoundary ? "var(--machine-inner-border-strong)" : "var(--machine-inner-border)"}`,
                      borderBottom: `1px solid ${isCurrent ? "color-mix(in srgb, var(--machine-active-border) 62%, transparent)" : isStageBoundary ? "var(--machine-inner-border-strong)" : "var(--machine-inner-border)"}`,
                      textAlign: "left",
                      fontWeight: isCurrent ? TYPOGRAPHY.weights.semibold : TYPOGRAPHY.weights.regular,
                      whiteSpace: "nowrap",
                      color: "var(--machine-inner-text-primary)",
                      background: isCurrent ? "var(--machine-active-link-bg)" : "transparent",
                      borderTopRightRadius: 1,
                      borderBottomRightRadius: 1,
                      boxShadow: isCurrent ? "inset 0 0 0 1px color-mix(in srgb, var(--machine-active-border) 28%, transparent)" : "inset 0 -1px 0 var(--machine-inner-border)",
                    }}
                  >
                    <InlineInstructionMath value={programRow.instructionText} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionedProgramList({ sections, row, programRefs }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {sections.map((section) => (
        <div
          key={section.key}
          className="machine-program-shell machine-program-inline-section"
          style={{ overflow: "hidden" }}
        >
          {sections.length > 1 && (
            <div
              style={{
                padding: "8px 10px 7px",
                borderBottom: "1px solid var(--machine-inner-border)",
                background: "var(--machine-inner-surface-muted)",
                ...TYPOGRAPHY.styles.label,
                fontSize: TYPOGRAPHY.sizes.sm,
                fontWeight: TYPOGRAPHY.weights.semibold,
                color: "var(--machine-inner-text-structural)",
              }}
            >
              {section.title}
            </div>
          )}

          <ProgramListing
            program={section.program}
            activeInstructionIndex={
              (sections.length === 1 && !row?.stageKey) || row?.stageKey === section.key
                ? row?.instructionIndex ?? null
                : null
            }
            maxHeight={sections.length > 1 ? 164 : 420}
            rowRefs={programRefs}
            rowRefPrefix={sections.length > 1 ? `${section.key}-` : ""}
          />
        </div>
      ))}
    </div>
  );
}

export default function MachinePanel({
  title,
  program,
  row,
  finalRegisters,
  trace,
  currentTraceIndex,
  selectedStepIndex = null,
  isPlaying = false,
  playbackControls = null,
  programSections = null,
  combinedProgramRows = null,
  stageSummary = "",
  traceFooter = null,
  traceShowStepGroups = true,
}) {
  const programRefs = useRef([]);
  const halted = row === null;

  const registers = halted ? finalRegisters : row.registers;
  const activeStageLabel = row?.stageLabel ?? row?.stageKey ?? stageSummary;
  const panelTitleParts = splitPanelTitle(title);

  const sections = useMemo(
    () =>
      Array.isArray(programSections) && programSections.length > 0
        ? programSections
        : [{ key: "default", title: "URM Program", program }],
    [program, programSections],
  );
  const hasCombinedProgramRows =
    Array.isArray(combinedProgramRows) && combinedProgramRows.length > 0;

  useEffect(() => {
    if (!row) return;

    if (hasCombinedProgramRows) {
      const activeKey = combinedProgramRows.find(
        (programRow) =>
          programRow.stageKey === row.stageKey &&
          programRow.instructionIndex === row.instructionIndex,
      )?.key;
      scrollElementIntoContainerView(programRefs.current[activeKey]);
      return;
    }

    const activeKey =
      sections.length > 1 && row.stageKey
        ? `${row.stageKey}-${row.instructionIndex}`
        : row.instructionIndex;
    scrollElementIntoContainerView(programRefs.current[activeKey]);
  }, [combinedProgramRows, hasCombinedProgramRows, row, sections]);

  return (
    <div className="machine-panel">
      <div className="machine-panel-header">
        <div className="machine-panel-title-block">
          {panelTitleParts.label ? (
            <div className="machine-panel-title-label">{panelTitleParts.label}</div>
          ) : null}
          <h2 className="machine-panel-title">{panelTitleParts.value}</h2>
        </div>
      </div>

      {playbackControls ? (
        <div className="machine-panel-playback">
          {playbackControls}
        </div>
      ) : null}

      <div className="machine-workspace">
        <section className="machine-column machine-trace-column">
          <div className="machine-panel-section-header machine-trace-header">
            <div className="machine-panel-title">Computation Trace</div>
            <div className="machine-panel-caption">
              Current step in yellow. Changed registers in pink.
            </div>
          </div>

          <div className="machine-trace-shell">
            <div className="machine-trace-table-shell">
              <TraceTable
                trace={trace}
                currentTraceIndex={currentTraceIndex}
                selectedStepIndex={selectedStepIndex}
                isPlaying={isPlaying}
                maxHeight={524}
                showStepGroups={traceShowStepGroups}
              />
            </div>
          </div>
        </section>

        <aside className="machine-column machine-status-column machine-status-panel">
          <div className="machine-panel-section-header">
            <div className="machine-panel-title">
              {hasCombinedProgramRows ? "URM Program" : sections.length > 1 ? "URM Programs" : "URM Program"}
            </div>
            <div className="machine-panel-caption">
              The active instruction stays highlighted and in view during playback.
            </div>
          </div>

          <div className="machine-status-sidebar">
            <div className="machine-program-card machine-program-card-inline">
              {hasCombinedProgramRows ? (
                <CombinedProgramTable combinedProgramRows={combinedProgramRows} row={row} programRefs={programRefs} />
              ) : (
                <SectionedProgramList sections={sections} row={row} programRefs={programRefs} />
              )}
            </div>

            {activeStageLabel && (
              <div className="machine-status-row">
                <div className="machine-status-section-label">Stage</div>
                <div className="machine-stage-summary">{activeStageLabel}</div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {traceFooter ? (
        <div className="machine-trace-footer">
          {traceFooter}
        </div>
      ) : null}
    </div>
  );
}

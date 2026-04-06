import { Fragment, useEffect, useMemo, useRef } from "react";
import { TYPOGRAPHY } from "../theme.js";
import KatexMath from "./KatexMath.jsx";

const STEP_COLUMN_WIDTH = 38;
const META_COLUMN_WIDTH = 40;
const PC_COLUMN_WIDTH = 40;
const REGISTER_COLUMN_WIDTH = 56;
const HEADER_CELL_PADDING = "3px 8px 5px";
const BODY_CELL_PADDING = "5px 8px";
const MACHINE_TEXT_PRIMARY = "var(--machine-inner-text-primary)";
const MACHINE_TEXT_SECONDARY = "var(--machine-inner-text-secondary)";
const MACHINE_TEXT_STRUCTURAL = "var(--machine-inner-text-structural)";
const MACHINE_ACTIVE_BG = "var(--machine-active-bg)";
const MACHINE_ACTIVE_TEXT = "var(--machine-active-text)";
const MACHINE_ACTIVE_LINK_BG = "var(--machine-active-link-bg, rgba(244, 196, 48, 0.18))";
const MACHINE_CHANGED_BG = "var(--machine-changed-bg)";
const MACHINE_CHANGED_TEXT = "var(--machine-changed-text)";
const MACHINE_ACTIVE_BORDER = "var(--machine-active-border, rgba(250, 204, 21, 0.34))";
const MACHINE_ACTIVE_DIVIDER = "var(--machine-active-divider, rgba(250, 204, 21, 0.2))";
const MACHINE_ACTIVE_RULE = "var(--machine-active-rule, rgba(250, 204, 21, 0.72))";
const MACHINE_CHANGED_BORDER = "var(--machine-changed-border, rgba(201, 84, 114, 0.92))";
const MACHINE_BORDER = "var(--machine-inner-border)";
const MACHINE_BORDER_STRONG = "var(--machine-inner-border-strong)";
const MACHINE_SURFACE = "var(--machine-inner-surface)";
const MACHINE_SURFACE_ALT = "var(--machine-inner-surface-alt)";
const TRACE_HEADER_FONT_FAMILY = `var(--trace-header-font-family, ${TYPOGRAPHY.styles.traceHeader.fontFamily})`;
const TRACE_HEADER_FONT_SIZE = `var(--trace-header-font-size, ${TYPOGRAPHY.sizes.xs}px)`;
const TRACE_HEADER_FONT_WEIGHT = `var(--trace-header-font-weight, ${TYPOGRAPHY.weights.medium})`;
const TRACE_HEADER_LETTER_SPACING = `var(--trace-header-letter-spacing, ${TYPOGRAPHY.letterSpacing.label})`;
const TRACE_CELL_FONT_FAMILY = `var(--trace-cell-font-family, ${TYPOGRAPHY.styles.traceCell.fontFamily})`;
const TRACE_CELL_FONT_SIZE = `var(--trace-cell-font-size, ${TYPOGRAPHY.sizes.base}px)`;
const TRACE_CELL_FONT_WEIGHT = `var(--trace-cell-font-weight, ${TYPOGRAPHY.styles.traceCell.fontWeight})`;
const TRACE_CELL_LINE_HEIGHT = "1.1";
const TRACE_INDEX_FONT_SIZE = "var(--trace-index-font-size, 12px)";
const TRACE_INDEX_COLOR = "var(--trace-index-color, var(--machine-inner-text-secondary))";
const TRACE_INDEX_BORDER = "var(--trace-index-border, var(--machine-inner-border))";
const TRACE_INDEX_BACKGROUND = "var(--trace-index-background, var(--machine-inner-surface-alt))";
const TRACE_INDEX_PADDING = "var(--trace-index-padding, 7px 6px 7px 8px)";
const TRACE_UNIFIED_HEADER_FONT_SIZE = "var(--trace-header-register-size, 13px)";
const TRACE_UNIFIED_HEADER_COLOR = MACHINE_TEXT_PRIMARY;
const TRACE_UNIFIED_BODY_FONT_SIZE = TRACE_CELL_FONT_SIZE;
const TRACE_UNIFIED_BODY_COLOR = MACHINE_TEXT_PRIMARY;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getRowMetrics(container, row) {
  if (!container || !row) return null;

  const rowTop = row.offsetTop;
  const rowHeight = row.offsetHeight;
  const rowBottom = rowTop + rowHeight;
  const rowCenter = rowTop + rowHeight / 2;

  return { rowTop, rowBottom, rowCenter, rowHeight };
}

function getMaxScrollTop(container) {
  if (!container) return 0;
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function getFollowZone(container) {
  const height = container?.clientHeight ?? 0;

  return {
    upper: height * 0.24,
    lower: height * 0.62,
    anchor: height * 0.5,
  };
}

function getAutoplayTargetScrollTop(container, row) {
  const metrics = getRowMetrics(container, row);
  if (!metrics) return null;

  const { upper, lower, anchor } = getFollowZone(container);
  const viewTop = container.scrollTop;
  const rowTopInView = metrics.rowTop - viewTop;
  const rowBottomInView = metrics.rowBottom - viewTop;
  const rowCenterInView = metrics.rowCenter - viewTop;

  if (rowBottomInView > lower) {
    return clamp(metrics.rowCenter - anchor, 0, getMaxScrollTop(container));
  }

  if (rowTopInView < upper) {
    return clamp(metrics.rowCenter - anchor, 0, getMaxScrollTop(container));
  }

  if (rowCenterInView > anchor) {
    return clamp(metrics.rowCenter - anchor, 0, getMaxScrollTop(container));
  }

  return null;
}

function getManualScrollTop(container, row) {
  const metrics = getRowMetrics(container, row);
  if (!metrics) return null;

  const padding = Math.max(16, Math.round(container.clientHeight * 0.08));
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (metrics.rowTop < viewTop + padding) {
    return clamp(metrics.rowTop - padding, 0, getMaxScrollTop(container));
  }

  if (metrics.rowBottom > viewBottom - padding) {
    return clamp(metrics.rowBottom - container.clientHeight + padding, 0, getMaxScrollTop(container));
  }

  return null;
}

function formatStageCell(stageLabel) {
  if (!stageLabel) return "—";

  return String(stageLabel)
    .replace(/^Inner\b/i, "In")
    .replace(/^Outer\b/i, "Out");
}

function renderRegisterValue(row, registerIndex, isChanged) {
  const value = row.registers?.[registerIndex] ?? 0;
  return value;
}

function renderHeaderLabel(header) {
  const text = String(header);
  const registerMatch = text.match(/^R(\d+)$/);

  if (!registerMatch) {
    return text;
  }

  return (
      <KatexMath
      expression={`R_{${registerMatch[1]}}`}
      style={{
        display: "inline-block",
        lineHeight: "inherit",
        fontSize: "0.95em",
        color: "inherit",
      }}
    />
  );
}

function InlineTraceMath({ value, fontSize = "1em" }) {
  return (
    <KatexMath
      expression={String(value ?? "—")}
      style={{
        display: "inline-block",
        lineHeight: "inherit",
        fontSize,
        color: "inherit",
      }}
    />
  );
}

export default function TraceTable({
  trace,
  currentTraceIndex,
  selectedStepIndex = null,
  isPlaying = false,
  registerIndices = null,
  showPc = false,
  maxHeight = 420,
  compact = false,
  showStepGroups = true,
}) {
  const rowRefs = useRef([]);
  const containerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const targetScrollTopRef = useRef(null);
  const derivedRegisterIndices = useMemo(() => {
    if (!Array.isArray(trace) || trace.length === 0) {
      return Array.isArray(registerIndices) ? registerIndices : [];
    }

    if (Array.isArray(registerIndices) && registerIndices.length > 0) {
      return registerIndices;
    }

    const maxRegisterCount = trace.reduce(
      (max, row) => Math.max(max, row.registers?.length ?? 0),
      0
    );

    return Array.from({ length: maxRegisterCount }, (_, index) => index);
  }, [registerIndices, trace]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const row = rowRefs.current[currentTraceIndex];

    if (!container || !row) return;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying) {
      const manualScrollTop = getManualScrollTop(container, row);

      if (manualScrollTop !== null) {
        container.scrollTo({ top: manualScrollTop, behavior: "smooth" });
      }

      targetScrollTopRef.current = null;
      return;
    }

    const nextTargetScrollTop = getAutoplayTargetScrollTop(container, row);

    if (nextTargetScrollTop === null) {
      targetScrollTopRef.current = null;
      return;
    }

    targetScrollTopRef.current = nextTargetScrollTop;

    const tick = () => {
      const target = targetScrollTopRef.current;

      if (target === null) {
        animationFrameRef.current = null;
        return;
      }

      const current = container.scrollTop;
      const delta = target - current;

      if (Math.abs(delta) < 0.35) {
        container.scrollTop = target;
        animationFrameRef.current = null;
        return;
      }

      container.scrollTop = current + delta * 0.12;
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, [currentTraceIndex, isPlaying]);

  if (!trace || trace.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          ...TYPOGRAPHY.styles.uiText,
          fontSize: TYPOGRAPHY.sizes.lg,
          color: MACHINE_TEXT_SECONDARY,
        }}
      >
        No trace data.
      </div>
    );
  }

  const hasStages = trace.some((row) => row.stageLabel);
  const stepColumnWidth = compact ? 32 : STEP_COLUMN_WIDTH;
  const pcColumnWidth = compact ? 34 : PC_COLUMN_WIDTH;
  const metaColumnWidth = compact ? 34 : META_COLUMN_WIDTH;
  const registerColumnWidth = compact ? 48 : REGISTER_COLUMN_WIDTH;
  const tableMinWidth =
    stepColumnWidth +
    (showPc ? pcColumnWidth : 0) +
    (hasStages ? metaColumnWidth * 2 : 0) +
    registerColumnWidth * derivedRegisterIndices.length;
  const headers = [
    "#",
    ...(showPc ? ["pc"] : []),
    ...(hasStages ? ["S", "L"] : []),
    ...derivedRegisterIndices.map((registerIndex) => `R${registerIndex}`),
  ];
  const headerPadding = compact ? "3px 6px 4px" : HEADER_CELL_PADDING;
  const bodyPadding = compact ? "4px 6px" : BODY_CELL_PADDING;
  const traceIndexPadding = compact ? "4px 5px 4px 6px" : "5px 6px 5px 8px";
  const isNumericColumn = (header) =>
    header === "#" || header === "pc" || /^R\d+$/.test(String(header));
  const getCellRadius = (cellIndex, totalCellCount) => ({
    borderTopLeftRadius: cellIndex === 0 ? 1 : 0,
    borderBottomLeftRadius: cellIndex === 0 ? 1 : 0,
    borderTopRightRadius: cellIndex === totalCellCount - 1 ? 1 : 0,
    borderBottomRightRadius: cellIndex === totalCellCount - 1 ? 1 : 0,
  });

  return (
    <div
      ref={containerRef}
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight,
        width: "100%",
        fontSize: "1.06em",
        paddingRight: 8,
        boxSizing: "border-box",
        scrollbarGutter: "stable",
        background: MACHINE_SURFACE,
      }}
    >
      <table
        style={{
          width: "100%",
          minWidth: tableMinWidth,
          borderCollapse: "separate",
          borderSpacing: "0",
          tableLayout: "auto",
          ...TYPOGRAPHY.styles.traceCell,
          fontFamily: TRACE_CELL_FONT_FAMILY,
          fontSize: "1em",
          fontWeight: TRACE_CELL_FONT_WEIGHT,
          lineHeight: TRACE_CELL_LINE_HEIGHT,
          color: MACHINE_TEXT_PRIMARY,
          background: MACHINE_SURFACE,
        }}
      >
        <colgroup>
          <col style={{ width: stepColumnWidth }} />
          {showPc && <col style={{ width: pcColumnWidth }} />}
          {hasStages && <col style={{ width: metaColumnWidth }} />}
          {hasStages && <col style={{ width: metaColumnWidth }} />}
          {derivedRegisterIndices.map((registerIndex) => (
            <col key={registerIndex} style={{ width: registerColumnWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {headers.map((header, headerIndex) => (
              <th
                key={header}
                style={{
                  ...TYPOGRAPHY.styles.traceHeader,
                  fontFamily: TRACE_HEADER_FONT_FAMILY,
                  fontSize: "1em",
                  fontWeight: TRACE_HEADER_FONT_WEIGHT,
                  lineHeight: 1.08,
                  padding: headerPadding,
                  borderBottom: `1px solid ${MACHINE_BORDER_STRONG}`,
                  textAlign: isNumericColumn(header) ? "right" : "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  color: TRACE_UNIFIED_HEADER_COLOR,
                  fontWeight: TRACE_HEADER_FONT_WEIGHT,
                  background: MACHINE_SURFACE,
                  letterSpacing: TRACE_HEADER_LETTER_SPACING,
                }}
                title={header}
              >
                {renderHeaderLabel(header)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {trace.map((row, rowIndex) => {
            const isCurrentRow = rowIndex === currentTraceIndex;
            const isSelectedStep =
              selectedStepIndex !== null && row?.recursionStepIndex === selectedStepIndex;
            const changed = row.changedRegisters ?? [];
            const rowBorderTop = hasStages && row.stageBoundary ? MACHINE_BORDER_STRONG : MACHINE_BORDER;
            const rowBaseBackground =
              rowIndex % 2 === 0 ? MACHINE_SURFACE : MACHINE_SURFACE_ALT;
            const rowTextColor = isCurrentRow ? MACHINE_ACTIVE_TEXT : MACHINE_TEXT_PRIMARY;
            const cellCount =
              1 + (showPc ? 1 : 0) + (hasStages ? 2 : 0) + derivedRegisterIndices.length;
            let cellIndex = 0;

            return (
              <Fragment key={rowIndex}>
                {showStepGroups && row.stepBoundary && row.recursionStepIndex !== undefined ? (
                  <tr>
                    <td
                      colSpan={cellCount}
                      style={{
                        padding: "10px 8px 6px",
                        borderTop: rowIndex === 0 ? "none" : `1px solid ${MACHINE_BORDER_STRONG}`,
                        borderBottom: `1px solid ${MACHINE_BORDER}`,
                        background: isSelectedStep ? MACHINE_ACTIVE_LINK_BG : MACHINE_SURFACE,
                        color: MACHINE_TEXT_PRIMARY,
                        textAlign: "left",
                        ...TYPOGRAPHY.styles.uiStrong,
                      }}
                    >
                      {row.recursionStepLabel}
                      {row.recursionStepCallText ? ` — ${row.recursionStepCallText}` : ""}
                    </td>
                  </tr>
                ) : null}
                <tr
                  ref={(el) => {
                    rowRefs.current[rowIndex] = el;
                  }}
                  style={{
                    background: isCurrentRow
                      ? MACHINE_ACTIVE_BG
                      : isSelectedStep
                        ? MACHINE_ACTIVE_LINK_BG
                        : rowBaseBackground,
                    boxShadow: isCurrentRow
                      ? `inset 4px 0 0 ${MACHINE_ACTIVE_RULE}`
                      : isSelectedStep
                        ? `inset 2px 0 0 ${MACHINE_ACTIVE_RULE}`
                        : "none",
                    transition: "background 120ms ease",
                  }}
                >
                <td
                  style={{
                    ...TYPOGRAPHY.styles.traceCell,
                    fontFamily: TRACE_CELL_FONT_FAMILY,
                    fontSize: "1em",
                    lineHeight: TRACE_CELL_LINE_HEIGHT,
                    padding: traceIndexPadding,
                    borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                    borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                    borderRight: `1px solid ${TRACE_INDEX_BORDER}`,
                    textAlign: "right",
                    fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                    background: TRACE_INDEX_BACKGROUND,
                    letterSpacing: TYPOGRAPHY.letterSpacing.normal,
                    ...getCellRadius(cellIndex++, cellCount),
                  }}
                >
                  <InlineTraceMath value={row.globalStep ?? rowIndex} fontSize="0.95em" />
                </td>

                {showPc && (
                  <td
                  style={{
                      ...TYPOGRAPHY.styles.traceCell,
                      fontFamily: TRACE_CELL_FONT_FAMILY,
                      fontSize: "1em",
                      lineHeight: TRACE_CELL_LINE_HEIGHT,
                      padding: bodyPadding,
                      borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                      borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                      borderRight: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                      textAlign: "right",
                      fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                      fontSize: "1em",
                      ...getCellRadius(cellIndex++, cellCount),
                    }}
                  >
                    <InlineTraceMath value={row.pc ?? "—"} />
                  </td>
                )}

                {hasStages && (
                  <>
                    <td
                      style={{
                        ...TYPOGRAPHY.styles.traceCell,
                        fontFamily: TRACE_CELL_FONT_FAMILY,
                        fontSize: "1em",
                        lineHeight: TRACE_CELL_LINE_HEIGHT,
                        padding: bodyPadding,
                        borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                        borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                        borderRight: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                        textAlign: "center",
                        fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                        fontSize: "1em",
                        textTransform: "uppercase",
                        letterSpacing: TYPOGRAPHY.letterSpacing.label,
                        ...getCellRadius(cellIndex++, cellCount),
                      }}
                      title={row.stageLabel ?? "—"}
                    >
                      {formatStageCell(row.stageLabel)}
                    </td>

                    <td
                      style={{
                        ...TYPOGRAPHY.styles.traceCell,
                        fontFamily: TRACE_CELL_FONT_FAMILY,
                        fontSize: "1em",
                        lineHeight: TRACE_CELL_LINE_HEIGHT,
                        padding: bodyPadding,
                        borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                        borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                        borderRight: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                        textAlign: "center",
                        fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                        fontSize: "1em",
                        ...getCellRadius(cellIndex++, cellCount),
                      }}
                    >
                      <InlineTraceMath value={row.localStep ?? row.step ?? rowIndex} fontSize="0.95em" />
                    </td>
                  </>
                )}

                {derivedRegisterIndices.map((registerIndex) => {
                  const isChanged = changed.includes(registerIndex);
                  const cellRadius = getCellRadius(cellIndex++, cellCount);

                  return (
                    <td
                      key={registerIndex}
                      style={{
                        ...TYPOGRAPHY.styles.traceCell,
                        fontFamily: TRACE_CELL_FONT_FAMILY,
                        fontSize: "1em",
                        lineHeight: TRACE_CELL_LINE_HEIGHT,
                        padding: bodyPadding,
                        borderTop: rowIndex === 0 ? `1px solid ${isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                        borderBottom: `1px solid ${isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                        borderRight:
                          cellIndex === cellCount
                            ? "none"
                            : `1px solid ${isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                        textAlign: "right",
                        fontWeight:
                          isCurrentRow || isChanged
                            ? "var(--trace-cell-active-weight, 500)"
                            : TRACE_CELL_FONT_WEIGHT,
                        color: isChanged ? MACHINE_CHANGED_TEXT : isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                        background: isChanged
                          ? isCurrentRow
                            ? MACHINE_CHANGED_BG
                            : MACHINE_CHANGED_BG
                          : "transparent",
                        boxShadow: isChanged
                          ? `inset 0 0 0 1px ${MACHINE_CHANGED_BORDER}`
                          : "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        minWidth: 0,
                        ...cellRadius,
                      }}
                    >
                      <InlineTraceMath value={renderRegisterValue(row, registerIndex, isChanged)} />
                    </td>
                  );
                })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

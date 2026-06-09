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
const TRACE_FINAL_OUTPUT_BG = "var(--trace-final-output-bg, rgb(34, 136, 51))";
const TRACE_FINAL_OUTPUT_BORDER = "var(--trace-final-output-border, rgb(34, 136, 51))";
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
const TRACE_DENSITY_MIN_TRACE_LENGTH = 80;
const TRACE_DENSITY_MAX_TRACE_LENGTH = 600;
const TRACE_DENSITY_MIN_REGISTER_COLUMNS = 8;
const TRACE_DENSITY_MAX_REGISTER_COLUMNS = 20;
const TRACE_DENSITY_MIN_BODY_FONT_SIZE = 0.62;
const TRACE_DENSITY_MIN_LINE_HEIGHT = 0.9;
const TRACE_DENSITY_MIN_HEADER_FONT_SIZE = 0.76;
const TRACE_DENSITY_MIN_BODY_PADDING_Y = 0.25;
const TRACE_DENSITY_MIN_BODY_PADDING_X = 2;
const TRACE_DENSITY_MIN_HEADER_PADDING_Y = 0.5;
const TRACE_DENSITY_MIN_HEADER_PADDING_X = 2.5;
const TRACE_DENSITY_MIN_INDEX_PADDING_Y = 0.25;
const TRACE_DENSITY_MIN_INDEX_PADDING_X = 2.5;
const TRACE_DENSITY_MIN_STEP_COLUMN_WIDTH = 26;
const TRACE_DENSITY_MIN_PC_COLUMN_WIDTH = 24;
const TRACE_DENSITY_MIN_META_COLUMN_WIDTH = 24;
const TRACE_DENSITY_MIN_REGISTER_COLUMN_WIDTH = 26;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function formatPx(value) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}px`;
}

function formatEm(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded}em`;
}

function getTraceDensityScale(traceLength) {
  if (!Number.isFinite(traceLength) || traceLength <= TRACE_DENSITY_MIN_TRACE_LENGTH) {
    return 0;
  }

  if (traceLength >= TRACE_DENSITY_MAX_TRACE_LENGTH) {
    return 1;
  }

  return smoothstep(
    (traceLength - TRACE_DENSITY_MIN_TRACE_LENGTH) /
      (TRACE_DENSITY_MAX_TRACE_LENGTH - TRACE_DENSITY_MIN_TRACE_LENGTH),
  );
}

function getRegisterDensityScale(registerColumnCount) {
  if (!Number.isFinite(registerColumnCount) || registerColumnCount <= TRACE_DENSITY_MIN_REGISTER_COLUMNS) {
    return 0;
  }

  if (registerColumnCount >= TRACE_DENSITY_MAX_REGISTER_COLUMNS) {
    return 1;
  }

  return smoothstep(
    (registerColumnCount - TRACE_DENSITY_MIN_REGISTER_COLUMNS) /
      (TRACE_DENSITY_MAX_REGISTER_COLUMNS - TRACE_DENSITY_MIN_REGISTER_COLUMNS),
  );
}

export function getAdaptiveTracePresentation({ traceLength, registerColumnCount, compact = false }) {
  const traceLengthScale = getTraceDensityScale(traceLength);
  const registerDensityScale = getRegisterDensityScale(registerColumnCount);
  let densityScale = Math.max(traceLengthScale, registerDensityScale);

  if (compact && densityScale > 0) {
    densityScale = clamp(densityScale * 1.2, 0, 1);
  }

  const bodyPaddingBase = compact
    ? { y: 4, x: 6, value: "4px 6px" }
    : { y: 5, x: 8, value: BODY_CELL_PADDING };
  const headerPaddingBase = compact
    ? { top: 3, right: 6, bottom: 4, left: 6, value: "3px 6px 4px" }
    : { top: 3, right: 8, bottom: 5, left: 8, value: HEADER_CELL_PADDING };
  const indexPaddingBase = compact
    ? { top: 4, right: 5, bottom: 4, left: 6, value: "4px 5px 4px 6px" }
    : { top: 5, right: 6, bottom: 5, left: 8, value: "5px 6px 5px 8px" };

  if (densityScale === 0) {
    return {
      densityScale,
      bodyCellFontSize: "1em",
      bodyCellLineHeight: TRACE_CELL_LINE_HEIGHT,
      bodyPadding: bodyPaddingBase.value,
      headerPadding: headerPaddingBase.value,
      traceIndexPadding: indexPaddingBase.value,
    };
  }

  const bodyPaddingY = lerp(bodyPaddingBase.y, TRACE_DENSITY_MIN_BODY_PADDING_Y, densityScale);
  const bodyPaddingX = lerp(bodyPaddingBase.x, TRACE_DENSITY_MIN_BODY_PADDING_X, densityScale);
  const headerPaddingTop = lerp(headerPaddingBase.top, TRACE_DENSITY_MIN_HEADER_PADDING_Y, densityScale);
  const headerPaddingBottom = lerp(headerPaddingBase.bottom, TRACE_DENSITY_MIN_HEADER_PADDING_Y, densityScale);
  const headerPaddingRight = lerp(headerPaddingBase.right, TRACE_DENSITY_MIN_HEADER_PADDING_X, densityScale);
  const headerPaddingLeft = lerp(headerPaddingBase.left, TRACE_DENSITY_MIN_HEADER_PADDING_X, densityScale);
  const indexPaddingTop = lerp(indexPaddingBase.top, TRACE_DENSITY_MIN_INDEX_PADDING_Y, densityScale);
  const indexPaddingBottom = lerp(indexPaddingBase.bottom, TRACE_DENSITY_MIN_INDEX_PADDING_Y, densityScale);
  const indexPaddingRight = lerp(indexPaddingBase.right, TRACE_DENSITY_MIN_INDEX_PADDING_X, densityScale);
  const indexPaddingLeft = lerp(indexPaddingBase.left, TRACE_DENSITY_MIN_INDEX_PADDING_X, densityScale);

  return {
    densityScale,
    bodyCellFontSize: formatEm(lerp(1, TRACE_DENSITY_MIN_BODY_FONT_SIZE, densityScale)),
    headerCellFontSize: formatEm(lerp(1, TRACE_DENSITY_MIN_HEADER_FONT_SIZE, densityScale)),
    bodyCellLineHeight: Math.round(lerp(
      Number(TRACE_CELL_LINE_HEIGHT),
      TRACE_DENSITY_MIN_LINE_HEIGHT,
      densityScale,
    ) * 1000) / 1000,
    bodyPadding: `${formatPx(bodyPaddingY)} ${formatPx(bodyPaddingX)}`,
    headerPadding: `${formatPx(headerPaddingTop)} ${formatPx(headerPaddingRight)} ${formatPx(headerPaddingBottom)} ${formatPx(headerPaddingLeft)}`,
    traceIndexPadding: `${formatPx(indexPaddingTop)} ${formatPx(indexPaddingRight)} ${formatPx(indexPaddingBottom)} ${formatPx(indexPaddingLeft)}`,
    innerMathScale: formatEm(lerp(1, 0.9, densityScale)),
    headerMathScale: formatEm(lerp(0.95, 0.82, densityScale)),
    containerPaddingRight: formatPx(lerp(8, 1.5, densityScale)),
    useFixedLayout: densityScale >= 0.2,
  };
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
  const upper = height * 0.33;
  const lower = height * 0.72;
  const anchor = height * 0.66;

  return {
    upper,
    lower,
    anchor,
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

function renderRegisterValue(row, registerIndex) {
  const value = row.registers?.[registerIndex] ?? 0;
  return value;
}

function renderHeaderLabel(header, headerMathScale = "0.95em") {
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
        fontSize: headerMathScale,
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

function getSemanticTraceBlockMarker(rowIndex, semanticTraceBlocks) {
  if (!Array.isArray(semanticTraceBlocks) || semanticTraceBlocks.length === 0) {
    return { inBlock: false, isSelectedBlock: false, isActiveBlock: false, role: null };
  }

  const matchingBlock = semanticTraceBlocks.find(
    (block) =>
      Number.isInteger(block?.traceStart) &&
      Number.isInteger(block?.traceEnd) &&
      rowIndex >= block.traceStart &&
      rowIndex <= block.traceEnd,
  );

  if (!matchingBlock) {
    return { inBlock: false, isSelectedBlock: false, isActiveBlock: false, role: null };
  }

  return {
    inBlock: true,
    isSelectedBlock: Boolean(matchingBlock.selected),
    isActiveBlock: Boolean(matchingBlock.active),
    role: matchingBlock.role ?? null,
  };
}

export default function TraceTable({
  trace,
  currentTraceIndex,
  selectedStepIndex = null,
  semanticTraceBlocks = null,
  hideStageColumns = false,
  isPlaying = false,
  registerIndices = null,
  showPc = false,
  maxHeight = 420,
  compact = false,
  showStepGroups = true,
  progressiveReveal = false,
  outputIsFinal = false,
  traceIndexHeader = "Step",
  traceIndexValueFormatter = null,
  suppressActiveHighlight = false,
  columnWidths = null,
  bodyCellFontSize = null,
  sizingTraceLength = null,
  sizingRegisterColumnCount = null,
  tracePresentationOverride = null,
  fitToContent = false,
  tableWidthPercent = null,
  equalColumnWidths = false,
  tableBorder = false,
}) {
  const rowRefs = useRef([]);
  const containerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const targetScrollTopRef = useRef(null);
  const traceLength = Array.isArray(trace) ? trace.length : 0;
  const clampedVisibleThroughIndex = Math.max(
    0,
    Math.min(
      Number.isInteger(currentTraceIndex) ? currentTraceIndex : 0,
      Math.max(traceLength - 1, 0),
    ),
  );
  const effectiveCurrentTraceIndex = suppressActiveHighlight
    ? null
    : progressiveReveal
    ? clampedVisibleThroughIndex
    : currentTraceIndex;
  const visibleTrace = progressiveReveal && Array.isArray(trace) && !suppressActiveHighlight
    ? trace.slice(0, clampedVisibleThroughIndex + 1)
    : trace;
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
    const row = rowRefs.current[effectiveCurrentTraceIndex];

    if (effectiveCurrentTraceIndex === null || !container || !row) return;

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

      if (Math.abs(delta) < 0.5) {
        container.scrollTop = target;
        animationFrameRef.current = null;
        return;
      }

      container.scrollTop = current + delta * 0.22;
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, [effectiveCurrentTraceIndex, isPlaying]);

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

  const hasStages = !hideStageColumns && trace.some((row) => row.stageLabel);
  const tracePresentation = tracePresentationOverride ?? getAdaptiveTracePresentation({
    traceLength: Number.isFinite(sizingTraceLength) ? sizingTraceLength : traceLength,
    registerColumnCount: Number.isFinite(sizingRegisterColumnCount)
      ? sizingRegisterColumnCount
      : derivedRegisterIndices.length,
    compact,
  });
  const stepColumnBaseWidth = columnWidths?.step ?? (compact
    ? 32
    : Math.max(STEP_COLUMN_WIDTH, String(traceIndexHeader).length > 5 ? 72 : STEP_COLUMN_WIDTH));
  const pcColumnBaseWidth = columnWidths?.pc ?? (compact ? 34 : PC_COLUMN_WIDTH);
  const metaColumnBaseWidth = columnWidths?.meta ?? (compact ? 34 : META_COLUMN_WIDTH);
  const registerColumnBaseWidth = columnWidths?.register ?? (compact ? 48 : REGISTER_COLUMN_WIDTH);
  const densityScale = tracePresentation.densityScale;
  const stepColumnWidth = Math.round(lerp(
    stepColumnBaseWidth,
    TRACE_DENSITY_MIN_STEP_COLUMN_WIDTH,
    densityScale,
  ));
  const pcColumnWidth = Math.round(lerp(
    pcColumnBaseWidth,
    TRACE_DENSITY_MIN_PC_COLUMN_WIDTH,
    densityScale,
  ));
  const metaColumnWidth = Math.round(lerp(
    metaColumnBaseWidth,
    TRACE_DENSITY_MIN_META_COLUMN_WIDTH,
    densityScale,
  ));
  const registerColumnWidth = Math.round(lerp(
    registerColumnBaseWidth,
    TRACE_DENSITY_MIN_REGISTER_COLUMN_WIDTH,
    densityScale,
  ));
  const effectiveBodyCellFontSize = bodyCellFontSize ?? tracePresentation.bodyCellFontSize;
  const effectiveHeaderCellFontSize = tracePresentation.headerCellFontSize;
  const effectiveBodyCellLineHeight = tracePresentation.bodyCellLineHeight;
  const shouldRenderPlaybackScrollBuffer =
    Boolean(progressiveReveal) &&
    Boolean(isPlaying) &&
    !suppressActiveHighlight &&
    Array.isArray(trace) &&
    visibleTrace.length > 0 &&
    visibleTrace.length < trace.length &&
    visibleTrace.length >= (compact ? 8 : 10);
  const playbackScrollBufferHeight = shouldRenderPlaybackScrollBuffer
    ? Math.round(
      clamp(
        maxHeight * lerp(0.28, 0.42, tracePresentation.densityScale),
        96,
        240,
      ),
    )
    : 0;
  const tableMinWidth =
    stepColumnWidth +
    (showPc ? pcColumnWidth : 0) +
    (hasStages ? metaColumnWidth * 2 : 0) +
    registerColumnWidth * derivedRegisterIndices.length;
  const totalColumnCount =
    1 + (showPc ? 1 : 0) + (hasStages ? 2 : 0) + derivedRegisterIndices.length;
  const normalizedTableWidthPercent = Number.isFinite(tableWidthPercent)
    ? clamp(tableWidthPercent, 0, 100)
    : null;
  const tableWidthStyle = normalizedTableWidthPercent !== null
    ? {
        width: `${normalizedTableWidthPercent}%`,
        maxWidth: "100%",
      }
    : fitToContent
    ? {
        width: tableMinWidth,
        maxWidth: "100%",
      }
    : {
        width: "100%",
        minWidth: tableMinWidth,
      };
  const headers = [
    traceIndexHeader,
    ...(showPc ? ["pc"] : []),
    ...(hasStages ? ["S", "L"] : []),
    ...derivedRegisterIndices.map((registerIndex) => `R${registerIndex}`),
  ];
  const headerPadding = tracePresentation.headerPadding;
  const bodyPadding = tracePresentation.bodyPadding;
  const traceIndexPadding = tracePresentation.traceIndexPadding;
  const shouldUseEqualColumnWidths = equalColumnWidths && totalColumnCount > 0;
  const equalColumnWidth = shouldUseEqualColumnWidths ? `${100 / totalColumnCount}%` : null;
  const isNumericColumn = (header) =>
    header === traceIndexHeader || header === "pc" || /^R\d+$/.test(String(header));
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
        paddingRight: tracePresentation.containerPaddingRight,
        boxSizing: "border-box",
        scrollbarGutter: "stable",
        background: MACHINE_SURFACE,
      }}
    >
      <table
        style={{
          ...tableWidthStyle,
          border: tableBorder ? "var(--app-panel-border)" : undefined,
          borderRadius: tableBorder ? "var(--app-panel-radius)" : undefined,
          overflow: tableBorder ? "hidden" : undefined,
          borderCollapse: "separate",
          borderSpacing: "0",
          tableLayout: shouldUseEqualColumnWidths || tracePresentation.useFixedLayout ? "fixed" : "auto",
          ...TYPOGRAPHY.styles.traceCell,
          fontFamily: TRACE_CELL_FONT_FAMILY,
          fontSize: "1em",
          fontWeight: TRACE_CELL_FONT_WEIGHT,
          lineHeight: effectiveBodyCellLineHeight,
          color: MACHINE_TEXT_PRIMARY,
          background: MACHINE_SURFACE,
        }}
      >
        <colgroup>
          <col style={{ width: equalColumnWidth ?? stepColumnWidth }} />
          {showPc && <col style={{ width: equalColumnWidth ?? pcColumnWidth }} />}
          {hasStages && <col style={{ width: equalColumnWidth ?? metaColumnWidth }} />}
          {hasStages && <col style={{ width: equalColumnWidth ?? metaColumnWidth }} />}
          {derivedRegisterIndices.map((registerIndex) => (
            <col key={registerIndex} style={{ width: equalColumnWidth ?? registerColumnWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  ...TYPOGRAPHY.styles.traceHeader,
                  fontFamily: TRACE_HEADER_FONT_FAMILY,
                  fontSize: effectiveHeaderCellFontSize,
                  fontWeight: TRACE_HEADER_FONT_WEIGHT,
                  lineHeight: 1.08,
                  padding: headerPadding,
                  borderBottom: `1px solid ${MACHINE_BORDER_STRONG}`,
                  textAlign: isNumericColumn(header) ? "right" : "center",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  color: TRACE_UNIFIED_HEADER_COLOR,
                  background: MACHINE_SURFACE,
                  letterSpacing: TRACE_HEADER_LETTER_SPACING,
                }}
                title={header}
              >
                {renderHeaderLabel(header, tracePresentation.headerMathScale)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {visibleTrace.map((row, rowIndex) => {
            const isCurrentRow = effectiveCurrentTraceIndex !== null && rowIndex === effectiveCurrentTraceIndex;
            const isSelectedStep =
              selectedStepIndex !== null && row?.recursionStepIndex === selectedStepIndex;
            const { inBlock, isSelectedBlock, isActiveBlock, role } = getSemanticTraceBlockMarker(
              rowIndex,
              semanticTraceBlocks,
            );
            const changed = row.changedRegisters ?? [];
            const rowBorderTop = hasStages && row.stageBoundary ? MACHINE_BORDER_STRONG : MACHINE_BORDER;
            const rowBaseBackground =
              rowIndex % 2 === 0 ? MACHINE_SURFACE : MACHINE_SURFACE_ALT;
            const cellCount = totalColumnCount;
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
                    fontSize: effectiveBodyCellFontSize,
                    lineHeight: effectiveBodyCellLineHeight,
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
                    boxShadow: isActiveBlock
                      ? "inset 4px 0 0 var(--minimization-trace-marker-selected)"
                      : isSelectedBlock
                      ? "inset 3px 0 0 var(--minimization-trace-marker-selected)"
                      : role === "setup" || role === "finalization"
                        ? "inset 1px 0 0 var(--semantic-trace-marker-setup)"
                      : inBlock
                        ? "inset 2px 0 0 var(--minimization-trace-marker)"
                        : "none",
                    letterSpacing: TYPOGRAPHY.letterSpacing.normal,
                    ...getCellRadius(cellIndex++, cellCount),
                  }}
                >
                  <InlineTraceMath
                    value={
                      typeof traceIndexValueFormatter === "function"
                        ? traceIndexValueFormatter(row, rowIndex)
                        : row.globalStep ?? rowIndex
                    }
                    fontSize={tracePresentation.innerMathScale}
                  />
                </td>

                {showPc && (
                  <td
                  style={{
                      ...TYPOGRAPHY.styles.traceCell,
                      fontFamily: TRACE_CELL_FONT_FAMILY,
                      fontSize: effectiveBodyCellFontSize,
                      lineHeight: effectiveBodyCellLineHeight,
                      padding: bodyPadding,
                      borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                      borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                      borderRight: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                      textAlign: "right",
                      fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                      ...getCellRadius(cellIndex++, cellCount),
                    }}
                  >
                    <InlineTraceMath value={row.pc ?? "—"} fontSize={tracePresentation.innerMathScale} />
                  </td>
                )}

                {hasStages && (
                  <>
                    <td
                      style={{
                        ...TYPOGRAPHY.styles.traceCell,
                        fontFamily: TRACE_CELL_FONT_FAMILY,
                        fontSize: effectiveBodyCellFontSize,
                        lineHeight: effectiveBodyCellLineHeight,
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
                        fontSize: effectiveBodyCellFontSize,
                        lineHeight: effectiveBodyCellLineHeight,
                        padding: bodyPadding,
                        borderTop: rowIndex === 0 ? `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                        borderBottom: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                        borderRight: `1px solid ${isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                        textAlign: "center",
                        fontWeight: isCurrentRow ? "var(--trace-cell-active-weight, 500)" : TRACE_CELL_FONT_WEIGHT,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        color: isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                        ...getCellRadius(cellIndex++, cellCount),
                      }}
                    >
                      <InlineTraceMath
                        value={row.localStep ?? row.step ?? rowIndex}
                        fontSize={tracePresentation.innerMathScale}
                      />
                    </td>
                  </>
                )}

                {derivedRegisterIndices.map((registerIndex) => {
                  const isChanged = changed.includes(registerIndex);
                  const isFinalOutputCell =
                    outputIsFinal && rowIndex === trace.length - 1 && registerIndex === 0;
                  const cellRadius = getCellRadius(cellIndex++, cellCount);

                  return (
                    <td
                      key={registerIndex}
                      style={{
                        ...TYPOGRAPHY.styles.traceCell,
                        fontFamily: TRACE_CELL_FONT_FAMILY,
                        fontSize: effectiveBodyCellFontSize,
                        lineHeight: effectiveBodyCellLineHeight,
                        padding: bodyPadding,
                        borderTop: rowIndex === 0 ? `1px solid ${isFinalOutputCell ? TRACE_FINAL_OUTPUT_BORDER : isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_BORDER : rowBorderTop}` : "none",
                        borderBottom: `1px solid ${isFinalOutputCell ? TRACE_FINAL_OUTPUT_BORDER : isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_BORDER : MACHINE_BORDER}`,
                        borderRight:
                          cellIndex === cellCount
                            ? "none"
                            : `1px solid ${isFinalOutputCell ? TRACE_FINAL_OUTPUT_BORDER : isChanged ? MACHINE_CHANGED_BORDER : isCurrentRow ? MACHINE_ACTIVE_DIVIDER : MACHINE_BORDER}`,
                        textAlign: "right",
                        fontWeight:
                          isFinalOutputCell || isCurrentRow || isChanged
                            ? "var(--trace-cell-active-weight, 500)"
                            : TRACE_CELL_FONT_WEIGHT,
                        color: isChanged ? MACHINE_CHANGED_TEXT : isCurrentRow ? MACHINE_ACTIVE_TEXT : TRACE_UNIFIED_BODY_COLOR,
                        background: isFinalOutputCell
                          ? TRACE_FINAL_OUTPUT_BG
                          : isChanged
                          ? isCurrentRow
                            ? MACHINE_CHANGED_BG
                            : MACHINE_CHANGED_BG
                          : "transparent",
                        boxShadow: isFinalOutputCell
                          ? `inset 0 0 0 1px ${TRACE_FINAL_OUTPUT_BORDER}`
                          : isChanged
                          ? `inset 0 0 0 1px ${MACHINE_CHANGED_BORDER}`
                          : "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        minWidth: 0,
                        ...cellRadius,
                      }}
                    >
                      <InlineTraceMath
                        value={renderRegisterValue(row, registerIndex)}
                        fontSize={tracePresentation.innerMathScale}
                      />
                    </td>
                  );
                })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {playbackScrollBufferHeight > 0 ? (
        <div
          aria-hidden="true"
          style={{
            height: playbackScrollBufferHeight,
            width: "100%",
            pointerEvents: "none",
            visibility: "hidden",
          }}
        />
      ) : null}
    </div>
  );
}

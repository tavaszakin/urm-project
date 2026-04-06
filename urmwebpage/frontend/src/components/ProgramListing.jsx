import { TYPOGRAPHY } from "../theme.js";
import { formatInstructionLatex } from "../utils/urmFormatting.js";
import KatexMath from "./KatexMath.jsx";

export default function ProgramListing({
  program,
  activeInstructionIndex = null,
  maxHeight = 360,
  compact = false,
  rowRefs = null,
  rowRefPrefix = "",
}) {
  const codeFontFamily = `var(--program-font-family, ${TYPOGRAPHY.styles.code.fontFamily})`;
  const codeFontSize = `var(--program-font-size, ${TYPOGRAPHY.sizes.base}px)`;
  const codeFontWeight = `var(--program-font-weight, ${TYPOGRAPHY.styles.code.fontWeight})`;

  return (
    <div
      className="program-listing"
      style={{
        overflowY: "auto",
        maxHeight,
        scrollBehavior: "smooth",
        fontSize: "1.06em",
        lineHeight: 1.1,
      }}
    >
      {program.map((instruction, index) => {
        const isCurrent = activeInstructionIndex === index;

        return (
          <div
            key={index}
            className={`program-listing-row${isCurrent ? " is-current" : ""}`}
            ref={(element) => {
              if (rowRefs) {
                rowRefs.current[`${rowRefPrefix}${index}`] = element;
              }
            }}
            style={{
              ...TYPOGRAPHY.styles.code,
              fontFamily: codeFontFamily,
              fontSize: codeFontSize,
              fontWeight: codeFontWeight,
              lineHeight: 1.1,
              display: "grid",
              gridTemplateColumns: compact ? "32px minmax(0, 1fr)" : "36px minmax(0, 1fr)",
              alignItems: "center",
              gap: compact ? 7 : 10,
              padding: compact ? "6px 10px 6px 11px" : "7px 12px 7px 13px",
              marginBottom: 0,
              borderRadius: 0,
              background: isCurrent ? "var(--machine-active-link-bg)" : "transparent",
              borderLeft: isCurrent
                ? "4px solid var(--machine-active-bg)"
                : "4px solid transparent",
              boxShadow: isCurrent
                ? "inset 0 0 0 1px var(--machine-active-outline, rgba(250, 204, 21, 0.18))"
                : "inset 0 -1px 0 var(--machine-inner-border)",
              color: "var(--machine-inner-text-primary)",
              opacity: 1,
              fontWeight: isCurrent ? "var(--program-active-weight, 500)" : codeFontWeight,
              transition:
                "background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
            }}
          >
            <span
              className="program-listing-index"
              style={{
                textAlign: "right",
                color: isCurrent
                  ? "var(--machine-inner-text-structural)"
                  : "var(--machine-inner-text-secondary)",
                fontWeight: isCurrent ? "var(--program-active-weight, 500)" : codeFontWeight,
              }}
            >
              {index + 1}
            </span>
            <span
              className="program-listing-instruction"
              style={{
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: "0.01em",
              }}
            >
              {isCurrent ? "▶ " : ""}
              <KatexMath
                expression={formatInstructionLatex(instruction)}
                style={{
                  display: "inline-block",
                  lineHeight: "inherit",
                  fontSize: "0.95em",
                  color: "inherit",
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

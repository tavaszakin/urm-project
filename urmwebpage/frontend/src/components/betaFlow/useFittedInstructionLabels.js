import { useLayoutEffect } from "react";

const PADDING = 3;
const SCALE_PROPERTY = "--flow-instruction-label-scale";

function fitLabel(label) {
  const shape = label.parentElement.querySelector(".beta-flow-node-shape");
  const lines = [...label.querySelectorAll(".math-text")];
  if (!shape || !lines.length) return;

  const { width, height } = shape.getBBox();
  const bounds = shape.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const scaleX = bounds.width / width;
  const scaleY = bounds.height / height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const diamond = shape.tagName === "polygon";
  const diamondLimit = 1 - PADDING * Math.hypot(1 / halfWidth, 1 / halfHeight);

  function fits(scale) {
    label.style.setProperty(SCALE_PROPERTY, scale);
    return lines.every((line) => {
      const rect = line.getBoundingClientRect();
      const x = Math.max(Math.abs(rect.left - centerX), Math.abs(rect.right - centerX)) / scaleX;
      const y = Math.max(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY)) / scaleY;
      return diamond ? x / halfWidth + y / halfHeight <= diamondLimit
        : x <= halfWidth - PADDING && y <= halfHeight - PADDING;
    });
  }

  if (fits(1)) return;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 8; index += 1) {
    const next = (low + high) / 2;
    if (fits(next)) low = next;
    else high = next;
  }
  label.style.setProperty(SCALE_PROPERTY, low);
}

export default function useFittedInstructionLabels(svgRef, drawingGeometry, enabled, displayWidth) {
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const layer = svg?.querySelector(".beta-flow-nodes");
    if (!enabled || !layer) return undefined;

    function fitLabels() {
      layer.querySelectorAll(".beta-flow-node-label-object").forEach(fitLabel);
    }

    fitLabels();
    const observer = new MutationObserver(fitLabels);
    observer.observe(layer, { childList: true, subtree: true });
    document.fonts?.addEventListener("loadingdone", fitLabels);

    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fitLabels);
    };
  }, [svgRef, drawingGeometry, enabled, displayWidth]);
}

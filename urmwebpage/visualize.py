from __future__ import annotations

import os
import tempfile
from typing import Any, List, Optional, Tuple

# Keep Matplotlib away from unwritable home-directory config paths.
_MPLCONFIGDIR = os.path.join(tempfile.gettempdir(), "urm-matplotlib")
os.makedirs(_MPLCONFIGDIR, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", _MPLCONFIGDIR)

_PLOT_IMPORT_ERROR: Optional[ModuleNotFoundError] = None

try:
    import matplotlib.pyplot as _plt
    import numpy as _np
except ModuleNotFoundError as exc:
    plt = None
    np = None
    _PLOT_IMPORT_ERROR = exc
else:
    plt = _plt
    np = _np

from execution_models import TraceStep


def _require_plot_dependencies() -> None:
    if _PLOT_IMPORT_ERROR is not None:
        raise ModuleNotFoundError(
            "visualize.py requires `numpy` and `matplotlib` in the active Python "
            "environment. Install them before using the plotting helpers."
        ) from _PLOT_IMPORT_ERROR


def _show_or_close(fig) -> None:
    _require_plot_dependencies()

    backend = plt.get_backend().lower()
    noninteractive_backends = ("agg", "pdf", "ps", "svg", "cairo", "pgf")
    if any(name in backend for name in noninteractive_backends):
        plt.close(fig)
        return

    plt.show()


def _trace_to_matrix(trace: List[TraceStep]) -> Any:
    """
    Convert a trace into a 2D numpy array of register values.

    Rows = steps
    Columns = registers
    """
    _require_plot_dependencies()

    if not trace:
        return np.zeros((0, 0), dtype=int)

    max_regs = max(len(step.registers_after) for step in trace)
    matrix = []

    for step in trace:
        row = step.registers_after + [0] * (max_regs - len(step.registers_after))
        matrix.append(row)

    return np.array(matrix, dtype=int)


def _changed_registers(trace: List[TraceStep]) -> List[Optional[int]]:
    """
    For each step, return the register index that changed relative to the
    previous step, if exactly one register changed. Otherwise return None.
    """
    changed = [None]

    for i in range(1, len(trace)):
        prev = trace[i - 1].registers_after
        curr = trace[i].registers_after
        max_len = max(len(prev), len(curr))

        prev_pad = prev + [0] * (max_len - len(prev))
        curr_pad = curr + [0] * (max_len - len(curr))

        diffs = [j for j in range(max_len) if prev_pad[j] != curr_pad[j]]

        if len(diffs) == 1:
            changed.append(diffs[0])
        else:
            changed.append(None)

    return changed


def _jump_flow_suffix(trace: List[TraceStep], index: int) -> str:
    """
    Infer jump behavior for trace[index], assuming it is a J-instruction row.

    Returns:
    - "next" if the jump was not taken
    - "↺" if the jump was taken backward (or to the same instruction)
    - "→" if the jump was taken forward
    """
    if index <= 0 or index >= len(trace):
        return ""

    step = trace[index]
    if not step.instruction or step.instruction[0] != "J":
        return ""

    executed_pc = step.pc
    next_pc = step.jump_target if step.jump_taken and step.jump_target is not None else executed_pc + 1
    default_next_pc = executed_pc + 1

    if next_pc == default_next_pc:
        return "next"
    if next_pc <= executed_pc:
        return "↺"
    return "→"


def _row_labels(trace: List[TraceStep]) -> List[str]:
    """
    Build y-axis labels like:
    0: start
    1: J(0, 1, 5) →
    2: S(1)
    """
    labels = []

    for i, step in enumerate(trace):
        instr = step.instruction_text
        if step.instruction[0] == "J":
            suffix = _jump_flow_suffix(trace, i)
            labels.append(f"{step.step}: {instr} {suffix}".rstrip())
        else:
            labels.append(f"{step.step}: {instr}")

    return labels


def _format_trace_label_style(ax, y_tick_fontsize: float, x_tick_fontsize: float) -> None:
    for label in ax.get_yticklabels():
        label.set_fontsize(y_tick_fontsize * 0.92)
        label.set_color("#6f7a86")
    for label in ax.get_xticklabels():
        label.set_color("#4e5965")
    ax.tick_params(axis="x", labelsize=x_tick_fontsize, colors="#4e5965", pad=2)
    ax.tick_params(axis="y", colors="#6f7a86", pad=2)


def _draw_single_trace_heatmap(
    ax,
    trace: List[TraceStep],
    title: str,
    global_vmin: int,
    global_vmax: int,
    annotate: bool = True,
    highlight_changes: bool = True,
    cmap: str = "Blues",
    target_cols: Optional[int] = None,
    min_fontsize: float = 6.0,
):
    """
    Draw one trace heatmap onto a provided matplotlib axis.
    """
    _require_plot_dependencies()

    if not trace:
        raise ValueError("Trace is empty.")

    matrix = _trace_to_matrix(trace)
    display_matrix = matrix
    changed = _changed_registers(trace)
    if target_cols is not None:
        pad_cols = max(target_cols - matrix.shape[1], 0)
        if pad_cols > 0:
            display_matrix = np.pad(
                matrix,
                ((0, 0), (0, pad_cols)),
                mode="constant",
                constant_values=0,
            )

    rows, cols = display_matrix.shape

    im = ax.imshow(
        display_matrix,
        aspect="auto",
        cmap=cmap,
        interpolation="nearest",
        vmin=global_vmin,
        vmax=global_vmax,
    )

    ax.set_title(title)
    ax.set_xlabel("Register")
    ax.set_ylabel("Step / Instruction")

    ax.set_xticks(range(cols))
    ax.set_xticklabels([f"R{j}" for j in range(cols)])

    ax.set_yticks(range(matrix.shape[0]))
    ax.set_yticklabels(_row_labels(trace))

    # Scale text to current heatmap cell size so large traces remain readable.
    fig = ax.figure
    fig_w_in, fig_h_in = fig.get_size_inches()
    bbox = ax.get_position()
    ax_w_px = fig_w_in * fig.dpi * bbox.width
    ax_h_px = fig_h_in * fig.dpi * bbox.height

    cell_w_px = ax_w_px / max(cols, 1)
    cell_h_px = ax_h_px / max(rows, 1)
    cell_px = min(cell_w_px, cell_h_px)

    min_fs = float(min_fontsize)
    annotation_fontsize = float(np.clip(cell_px * 0.34, min_fs, 12))
    x_tick_fontsize = float(np.clip(cell_w_px * 0.30, min_fs, 11))
    y_tick_fontsize = float(np.clip(cell_h_px * 0.28, min_fs, 10))
    axis_label_fontsize = float(np.clip(min(x_tick_fontsize, y_tick_fontsize) + 1, 7, 12))
    title_fontsize = float(np.clip(axis_label_fontsize + 1, 8, 14))

    _format_trace_label_style(ax, y_tick_fontsize=y_tick_fontsize, x_tick_fontsize=x_tick_fontsize)
    ax.xaxis.label.set_size(axis_label_fontsize)
    ax.yaxis.label.set_size(axis_label_fontsize)
    ax.xaxis.label.set_color("#4e5965")
    ax.yaxis.label.set_color("#6f7a86")
    ax.title.set_fontsize(title_fontsize)
    ax.title.set_color("#243447")

    if annotate:
        min_val = global_vmin
        max_val = global_vmax

        for i in range(display_matrix.shape[0]):
            for j in range(display_matrix.shape[1]):
                value = display_matrix[i, j]
                normalized = (value - min_val) / (max_val - min_val + 1e-9)
                text_color = "white" if normalized > 0.5 else "black"

                ax.text(
                    j,
                    i,
                    str(value),
                    ha="center",
                    va="center",
                    color=text_color,
                    fontsize=annotation_fontsize,
                )

    if highlight_changes:
        for i, j in enumerate(changed):
            if j is not None:
                rect = plt.Rectangle(
                    (j - 0.5, i - 0.5),
                    1,
                    1,
                    fill=False,
                    edgecolor="orange",
                    linewidth=2,
                )
                ax.add_patch(rect)

    return im


def _highlight_row_band(
    ax,
    row_index: int,
    width: int,
    *,
    facecolor: str = "#e7eff8",
    edgecolor: str = "#5b7ea4",
    alpha: float = 0.28,
    linewidth: float = 1.1,
) -> None:
    band = plt.Rectangle(
        (-0.5, row_index - 0.5),
        width,
        1,
        facecolor=facecolor,
        edgecolor=edgecolor,
        linewidth=linewidth,
        alpha=alpha,
        zorder=5,
    )
    ax.add_patch(band)


def _style_trace_axes(ax) -> None:
    ax.grid(False)
    for spine in ax.spines.values():
        spine.set_linewidth(0.75)
        spine.set_edgecolor("#7d8792")


def _shade_setup_phase(
    ax,
    width: int,
    alignment_step: int,
    *,
    setup_alpha: float = 0.18,
    setup_tint: float = 0.06,
) -> None:
    if alignment_step <= 0:
        return

    ax.axhspan(
        -0.5,
        alignment_step - 0.5,
        facecolor="#8a94a0",
        alpha=setup_tint,
        zorder=3,
    )
    fade = plt.Rectangle(
        (-0.5, -0.5),
        width,
        alignment_step,
        facecolor="white",
        edgecolor="none",
        alpha=setup_alpha,
        zorder=4,
    )
    ax.add_patch(fade)


def _draw_alignment_marker(
    ax,
    width: int,
    alignment_step: int,
    *,
    label: str = "alignment",
) -> None:
    ax.text(
        width - 0.2,
        alignment_step - 0.62,
        label,
        ha="right",
        va="bottom",
        fontsize=8.2,
        color="#52606d",
        zorder=8,
    )


def _draw_simulation_note(ax, width: int, alignment_step: int, rows: int) -> None:
    if rows - alignment_step < 2:
        return

    y = alignment_step + max((rows - alignment_step) * 0.42, 1.2)
    ax.text(
        width - 0.2,
        y,
        r"matches $\varphi_e(a,y)$ below",
        ha="right",
        va="center",
        fontsize=8.1,
        color="#607080",
        zorder=8,
    )


def plot_trace_comparison(
    trace1: List[TraceStep],
    trace2: List[TraceStep],
    title1: str = "Program A",
    title2: str = "Program B",
    annotate: bool = True,
    highlight_changes: bool = True,
    figsize: Tuple[int, int] = (18, 6),
    cmap: str = "Blues",
    min_fontsize: float = 6.0,
) -> None:
    """
    Plot two URM traces side by side with a shared color scale.
    """
    _require_plot_dependencies()

    if not trace1:
        raise ValueError("trace1 is empty.")
    if not trace2:
        raise ValueError("trace2 is empty.")

    matrix1 = _trace_to_matrix(trace1)
    matrix2 = _trace_to_matrix(trace2)

    global_vmin = int(min(matrix1.min(), matrix2.min()))
    global_vmax = int(max(matrix1.max(), matrix2.max()))
    target_cols = max(matrix1.shape[1], matrix2.shape[1])
    rows1 = matrix1.shape[0]
    rows2 = matrix2.shape[0]
    max_rows = max(rows1, rows2)

    # If the requested font floor would be violated, make the figure taller.
    # This keeps dense traces readable (especially many-step runs).
    dpi = float(plt.rcParams.get("figure.dpi", 100))
    vertical_axis_fraction = 0.84
    target_cell_px = float(min_fontsize) / 0.34
    min_height_for_font = (max_rows * target_cell_px) / (dpi * vertical_axis_fraction)
    effective_figsize = (figsize[0], max(figsize[1], min_height_for_font))

    fig = plt.figure(figsize=effective_figsize)

    # Manual layout so each heatmap cell has identical size across both sides,
    # while allowing different trace lengths (different subplot heights).
    left = 0.06
    right = 0.94
    top = 0.93
    bottom = 0.08
    gap = 0.04
    cbar_width = 0.018
    cbar_pad = 0.012

    available_w = right - left - gap - cbar_width - cbar_pad
    axis_w = available_w / 2.0
    available_h = top - bottom
    row_height_frac = available_h / max_rows

    axis1_h = row_height_frac * rows1
    axis2_h = row_height_frac * rows2

    ax1_x = left
    ax2_x = left + axis_w + gap
    ax1_y = top - axis1_h
    ax2_y = top - axis2_h

    ax1 = fig.add_axes([ax1_x, ax1_y, axis_w, axis1_h])
    ax2 = fig.add_axes([ax2_x, ax2_y, axis_w, axis2_h])

    im1 = _draw_single_trace_heatmap(
        ax1,
        trace1,
        title1,
        global_vmin=global_vmin,
        global_vmax=global_vmax,
        annotate=annotate,
        highlight_changes=highlight_changes,
        cmap=cmap,
        target_cols=target_cols,
        min_fontsize=min_fontsize,
    )

    _draw_single_trace_heatmap(
        ax2,
        trace2,
        title2,
        global_vmin=global_vmin,
        global_vmax=global_vmax,
        annotate=annotate,
        highlight_changes=highlight_changes,
        cmap=cmap,
        target_cols=target_cols,
        min_fontsize=min_fontsize,
    )

    cbar_x = ax2_x + axis_w + cbar_pad
    cax = fig.add_axes([cbar_x, bottom, cbar_width, available_h])
    cbar = fig.colorbar(im1, cax=cax)
    cbar.set_label("Register value")

    _show_or_close(fig)


def plot_smn_trace_comparison(
    original_trace: List[TraceStep],
    specialized_trace: List[TraceStep],
    alignment_step: Optional[int],
    title1: str = r"$\varphi_e(a, y)$",
    title2: str = r"$\varphi_{s(e,a)}(y)$",
    annotate: bool = False,
    cmap: str = "Blues",
    figsize: Tuple[int, int] = (14, 6),
    min_fontsize: float = 6.0,
    fade_setup: bool = True,
    show_match_note: bool = True,
):
    """
    Plot a proof-style s-m-n trace comparison.

    Left:
    - execution of the original program on (a, y)

    Right:
    - execution of the specialized program on y
    - setup rows before ``alignment_step`` are visually subdued
    - the alignment row is marked as the state corresponding to row 0 on the left

    Returns:
        (fig, (ax_left, ax_right))
    """
    _require_plot_dependencies()

    if not original_trace:
        raise ValueError("original_trace is empty.")
    if not specialized_trace:
        raise ValueError("specialized_trace is empty.")
    if alignment_step is not None and not (0 <= alignment_step < len(specialized_trace)):
        raise ValueError("alignment_step is out of bounds for specialized_trace.")

    matrix1 = _trace_to_matrix(original_trace)
    matrix2 = _trace_to_matrix(specialized_trace)

    global_vmin = int(min(matrix1.min(), matrix2.min()))
    global_vmax = int(max(matrix1.max(), matrix2.max()))
    target_cols = max(matrix1.shape[1], matrix2.shape[1])
    rows1 = matrix1.shape[0]
    rows2 = matrix2.shape[0]
    max_rows = max(rows1, rows2)

    dpi = float(plt.rcParams.get("figure.dpi", 100))
    vertical_axis_fraction = 0.8
    target_cell_px = float(min_fontsize) / 0.34
    min_height_for_font = (max_rows * target_cell_px) / (dpi * vertical_axis_fraction)
    effective_figsize = (figsize[0], max(figsize[1], min_height_for_font))

    fig = plt.figure(figsize=effective_figsize)

    left = 0.075
    right = 0.935
    top = 0.9
    bottom = 0.115
    gap = 0.055
    cbar_width = 0.018
    cbar_pad = 0.018

    available_w = right - left - gap - cbar_width - cbar_pad
    axis_w = available_w / 2.0
    available_h = top - bottom
    row_height_frac = available_h / max_rows

    axis1_h = row_height_frac * rows1
    axis2_h = row_height_frac * rows2

    ax1_x = left
    ax2_x = left + axis_w + gap
    ax2_y = top - axis2_h
    if alignment_step is None:
        ax1_y = top - axis1_h
    else:
        # Vertically align the original initial row with the specialized
        # alignment row so the correspondence is visible at a glance.
        ax1_y = ax2_y + (rows2 - alignment_step - rows1) * row_height_frac

    ax1 = fig.add_axes([ax1_x, ax1_y, axis_w, axis1_h])
    ax2 = fig.add_axes([ax2_x, ax2_y, axis_w, axis2_h])

    im1 = _draw_single_trace_heatmap(
        ax1,
        original_trace,
        title1,
        global_vmin=global_vmin,
        global_vmax=global_vmax,
        annotate=annotate,
        highlight_changes=False,
        cmap=cmap,
        target_cols=target_cols,
        min_fontsize=min_fontsize,
    )
    _draw_single_trace_heatmap(
        ax2,
        specialized_trace,
        title2,
        global_vmin=global_vmin,
        global_vmax=global_vmax,
        annotate=annotate,
        highlight_changes=False,
        cmap=cmap,
        target_cols=target_cols,
        min_fontsize=min_fontsize,
    )

    ax1.set_ylabel("")
    ax2.set_ylabel("")

    for ax in (ax1, ax2):
        _style_trace_axes(ax)

    _highlight_row_band(ax1, 0, target_cols)

    if alignment_step is not None:
        _highlight_row_band(ax2, alignment_step, target_cols)

        if fade_setup:
            _shade_setup_phase(ax2, target_cols, alignment_step)

        ax2.axhline(
            alignment_step - 0.5,
            color="#8fa4bb",
            linewidth=0.9,
            zorder=7,
        )
        _draw_alignment_marker(ax2, target_cols, alignment_step)
        if show_match_note:
            _draw_simulation_note(ax2, target_cols, alignment_step, rows2)

    cbar_x = ax2_x + axis_w + cbar_pad
    cax = fig.add_axes([cbar_x, bottom, cbar_width, available_h])
    cbar = fig.colorbar(im1, cax=cax)
    cbar.outline.set_linewidth(0.7)
    cbar.outline.set_edgecolor("#7d8792")
    cbar.ax.tick_params(labelsize=float(np.clip(min_fontsize, 6, 10)))
    cbar.ax.tick_params(colors="#4e5965")
    cbar.set_label("Register value", color="#4e5965")

    return fig, (ax1, ax2)


def plot_trace_heatmap(
    trace: List[TraceStep],
    title: str = "URM Execution Trace",
    annotate: bool = True,
    highlight_changes: bool = True,
    figsize: tuple = (10, 6),
    cmap: str = "Blues",
) -> None:
    """Compatibility wrapper matching previous API: draw a single trace heatmap."""
    _require_plot_dependencies()

    if not trace:
        raise ValueError("Trace is empty.")

    matrix = _trace_to_matrix(trace)
    global_vmin = int(matrix.min())
    global_vmax = int(matrix.max())

    fig, ax = plt.subplots(figsize=figsize)
    im = _draw_single_trace_heatmap(
        ax,
        trace,
        title,
        global_vmin=global_vmin,
        global_vmax=global_vmax,
        annotate=annotate,
        highlight_changes=highlight_changes,
        cmap=cmap,
    )

    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Register value")

    plt.tight_layout()
    _show_or_close(fig)


def print_trace_table(trace: List[TraceStep]) -> None:
    """
    Print a readable text table version of the trace (compatibility API).
    """
    if not trace:
        print("(empty trace)")
        return

    max_regs = max(len(step.registers_after) for step in trace)

    header = ["step", "pc", "instruction"] + [f"R{j}" for j in range(max_regs)]
    rows = []

    for step in trace:
        row = [str(step.step), str(step.pc), step.instruction_text]
        row += [str(x) for x in step.registers_after + [0] * (max_regs - len(step.registers_after))]
        rows.append(row)

    widths = [len(h) for h in header]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def fmt_row(row: List[str]) -> str:
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(row))

    print(fmt_row(header))
    print("-+-".join("-" * w for w in widths))
    for row in rows:
        print(fmt_row(row))


def format_registers(regs: List[int], changed: List[str]) -> str:
    lines = []
    for i, val in enumerate(regs):
        if f"R{i}" in changed:
            lines.append(f"  R{i}: *{val}*")
        else:
            lines.append(f"  R{i}:  {val}")
    return "\n".join(lines)


def pretty_trace(trace: List[TraceStep]) -> None:
    """
    Print a visually grouped trace with changed registers highlighted.
    """
    if not trace:
        print("(empty trace)")
        return

    for step in trace:
        changes = [f"R{i}" for i in step.changed_registers]

        change_str = ", ".join(changes) if changes else "-"
        next_pc = step.jump_target if step.jump_taken and step.jump_target is not None else step.pc + 1
        note = f"executed {step.instruction_text}"
        if step.halted:
            note += "; next instruction does not exist, so computation halts"

        print(
            f"""
Step {step.step}
---------------------------------
PC -> {step.pc}
Next PC -> {next_pc}
Instr -> {step.instruction_text}

Registers:
{format_registers(step.registers_after, changes)}

Changed: {change_str}
Note: {note}
"""
        )

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import BoundaryNorm, ListedColormap
from matplotlib.patches import Patch, Rectangle

from urm import Instruction, TraceStep, execute
from visualize import _draw_single_trace_heatmap, _format_trace_label_style, _style_trace_axes


ProgramLike = Any
InputValue = Union[int, Sequence[int]]
RunnerResult = Any
BoundedRunner = Callable[[ProgramLike, InputValue, int], RunnerResult]


@dataclass(frozen=True)
class HaltingCellResult:
    """Bounded-simulation outcome for one program/input pair."""

    row_index: int
    col_index: int
    halted: bool
    steps_executed: int
    truncated: bool
    trace: Optional[List[TraceStep]]
    program_label: str
    input_label: str
    status_label: str
    program: ProgramLike
    input_value: InputValue
    raw_result: RunnerResult


@dataclass(frozen=True)
class HaltingGridData:
    """Computed data needed to render or update a halting heatmap."""

    programs: Sequence[ProgramLike]
    inputs: Sequence[InputValue]
    max_steps: int
    results: List[HaltingCellResult]
    matrix: np.ndarray
    cell_map: Dict[Tuple[int, int], HaltingCellResult]
    row_labels: List[str]
    col_labels: List[str]


def _default_program_label(program: ProgramLike, index: int) -> str:
    if isinstance(program, Mapping):
        label = program.get("label")
        if label is not None:
            return str(label)

    label = getattr(program, "label", None)
    if label is not None:
        return str(label)

    return f"P{index}"


def _default_input_label(value: InputValue, index: int) -> str:
    if isinstance(value, int):
        return str(value)
    if isinstance(value, tuple):
        return "(" + ", ".join(str(v) for v in value) + ")"
    if isinstance(value, list):
        return "[" + ", ".join(str(v) for v in value) + "]"
    return f"x{index}={value}"


def _normalize_trace(trace: Any) -> Optional[List[TraceStep]]:
    if trace is None:
        return None
    if isinstance(trace, list):
        return trace
    return list(trace)


def _coerce_runner_result(
    result: RunnerResult,
    *,
    max_steps: int,
) -> Tuple[bool, int, Optional[List[TraceStep]], RunnerResult]:
    """
    Normalize a runner result into (halted, steps_executed, trace, raw_result).

    The injected runner is expected to return either:
    - a mapping with keys like ``halted``, ``steps``, and optional ``trace``
    - an object with corresponding attributes
    """
    if isinstance(result, Mapping):
        halted = bool(result.get("halted", False))
        steps = int(result.get("steps", max_steps))
        trace = _normalize_trace(result.get("trace"))
        return halted, steps, trace, result

    halted = bool(getattr(result, "halted", False))
    steps = int(getattr(result, "steps", max_steps))
    trace = _normalize_trace(getattr(result, "trace", None))
    return halted, steps, trace, result


def build_halting_grid(
    programs: Sequence[ProgramLike],
    inputs: Sequence[InputValue],
    runner: BoundedRunner,
    max_steps: int,
    *,
    program_labels: Optional[Sequence[str]] = None,
    input_labels: Optional[Sequence[str]] = None,
) -> List[HaltingCellResult]:
    """
    Run bounded simulation for every program/input pair.

    A cell is marked halted only when halting is observed within ``max_steps``.
    Otherwise it remains unresolved within the current bound.
    """
    if max_steps < 0:
        raise ValueError("max_steps must be nonnegative.")

    resolved_program_labels = list(program_labels) if program_labels is not None else None
    resolved_input_labels = list(input_labels) if input_labels is not None else None

    if resolved_program_labels is not None and len(resolved_program_labels) != len(programs):
        raise ValueError("program_labels must match the number of programs.")
    if resolved_input_labels is not None and len(resolved_input_labels) != len(inputs):
        raise ValueError("input_labels must match the number of inputs.")

    results: List[HaltingCellResult] = []

    for row_index, program in enumerate(programs):
        program_label = (
            resolved_program_labels[row_index]
            if resolved_program_labels is not None
            else _default_program_label(program, row_index)
        )

        for col_index, input_value in enumerate(inputs):
            input_label = (
                resolved_input_labels[col_index]
                if resolved_input_labels is not None
                else _default_input_label(input_value, col_index)
            )

            raw_result = runner(program, input_value, max_steps)
            halted, steps_executed, trace, normalized_raw_result = _coerce_runner_result(
                raw_result,
                max_steps=max_steps,
            )
            truncated = not halted
            status_label = (
                f"halted in {steps_executed} steps"
                if halted
                else f"unresolved after {steps_executed} steps"
            )

            results.append(
                HaltingCellResult(
                    row_index=row_index,
                    col_index=col_index,
                    halted=halted,
                    steps_executed=steps_executed,
                    truncated=truncated,
                    trace=trace,
                    program_label=program_label,
                    input_label=input_label,
                    status_label=status_label,
                    program=program,
                    input_value=input_value,
                    raw_result=normalized_raw_result,
                )
            )

    return results


def halting_results_to_matrix(
    results: Sequence[HaltingCellResult],
    *,
    n_rows: int,
    n_cols: int,
) -> Tuple[np.ndarray, Dict[Tuple[int, int], HaltingCellResult]]:
    """
    Convert cell results into a plot-ready status matrix.

    Encoding:
    - 1 = halting observed within the current bound
    - 0 = unresolved within the current bound
    """
    matrix = np.zeros((n_rows, n_cols), dtype=int)
    cell_map: Dict[Tuple[int, int], HaltingCellResult] = {}

    for cell in results:
        matrix[cell.row_index, cell.col_index] = 1 if cell.halted else 0
        cell_map[(cell.row_index, cell.col_index)] = cell

    return matrix, cell_map


def compute_halting_grid_data(
    programs: Sequence[ProgramLike],
    inputs: Sequence[InputValue],
    runner: BoundedRunner,
    max_steps: int = 100,
    *,
    program_labels: Optional[Sequence[str]] = None,
    input_labels: Optional[Sequence[str]] = None,
) -> HaltingGridData:
    """Compute bounded halting-grid data without rendering it."""
    results = build_halting_grid(
        programs,
        inputs,
        runner,
        max_steps,
        program_labels=program_labels,
        input_labels=input_labels,
    )
    matrix, cell_map = halting_results_to_matrix(
        results,
        n_rows=len(programs),
        n_cols=len(inputs),
    )

    row_labels = (
        list(program_labels)
        if program_labels is not None
        else [_default_program_label(program, i) for i, program in enumerate(programs)]
    )
    col_labels = (
        list(input_labels)
        if input_labels is not None
        else [_default_input_label(value, i) for i, value in enumerate(inputs)]
    )

    return HaltingGridData(
        programs=programs,
        inputs=inputs,
        max_steps=max_steps,
        results=results,
        matrix=matrix,
        cell_map=cell_map,
        row_labels=row_labels,
        col_labels=col_labels,
    )


def _halting_colormap() -> Tuple[ListedColormap, BoundaryNorm]:
    cmap = ListedColormap(["#edf3f8", "#2f6f9f"])
    norm = BoundaryNorm(boundaries=[-0.5, 0.5, 1.5], ncolors=cmap.N)
    return cmap, norm


def _annotation_for_cell(
    cell: HaltingCellResult,
    *,
    max_steps: int,
    show_step_counts: bool,
) -> str:
    if cell.halted:
        return f"H\n{cell.steps_executed}" if show_step_counts else "H"
    if show_step_counts:
        return f"...\n<={max_steps}"
    return "..."


def _trace_figure_title(cell: HaltingCellResult) -> str:
    if cell.halted:
        suffix = f"halted in {cell.steps_executed} steps"
    else:
        suffix = f"unresolved after {cell.steps_executed} steps"
    return f"Trace for {cell.program_label} on input {cell.input_label} - {suffix}"


def _plot_cell_trace_heatmap(
    cell: HaltingCellResult,
    *,
    annotate: bool = True,
    highlight_changes: bool = True,
    cmap: str = "Blues",
) -> Optional[Tuple[plt.Figure, plt.Axes]]:
    if not cell.trace:
        return None

    max_value = 0
    for step in cell.trace:
        if step.registers:
            max_value = max(max_value, max(step.registers))

    rows = max(len(cell.trace), 1)
    fig_height = max(4.5, min(12.0, 1.5 + rows * 0.42))
    fig, ax = plt.subplots(figsize=(10, fig_height))
    im = _draw_single_trace_heatmap(
        ax,
        cell.trace,
        _trace_figure_title(cell),
        global_vmin=0,
        global_vmax=max(max_value, 1),
        annotate=annotate,
        highlight_changes=highlight_changes,
        cmap=cmap,
    )

    cbar = fig.colorbar(im, ax=ax)
    cbar.outline.set_linewidth(0.7)
    cbar.outline.set_edgecolor("#7d8792")
    cbar.ax.tick_params(colors="#4e5965")
    cbar.set_label("Register value", color="#4e5965")
    plt.tight_layout()
    return fig, ax


def plot_halting_heatmap(
    programs: Sequence[ProgramLike],
    inputs: Sequence[InputValue],
    runner: BoundedRunner,
    max_steps: int = 100,
    title: str = "Halting Heatmap",
    figsize: Tuple[int, int] = (12, 8),
    cmap: Optional[ListedColormap] = None,
    annotate: bool = True,
    show_step_counts: bool = True,
    open_trace_on_click: bool = True,
    *,
    program_labels: Optional[Sequence[str]] = None,
    input_labels: Optional[Sequence[str]] = None,
) -> Tuple[plt.Figure, plt.Axes, HaltingGridData]:
    """
    Render an interactive bounded-halting heatmap.

    Light cells are unresolved within the current bound; they are not claims of
    non-halting.
    """
    grid_data = compute_halting_grid_data(
        programs,
        inputs,
        runner,
        max_steps=max_steps,
        program_labels=program_labels,
        input_labels=input_labels,
    )

    status_cmap, norm = _halting_colormap()
    effective_cmap = cmap if cmap is not None else status_cmap

    rows, cols = grid_data.matrix.shape
    fig = plt.figure(figsize=figsize)

    left = 0.085
    right = 0.9
    top = 0.88
    bottom = 0.15
    cbar_width = 0.022
    cbar_pad = 0.02

    ax = fig.add_axes([left, bottom, right - left - cbar_width - cbar_pad, top - bottom])
    cax = fig.add_axes([right - cbar_width, bottom, cbar_width, top - bottom])

    im = ax.imshow(
        grid_data.matrix,
        aspect="auto",
        cmap=effective_cmap,
        norm=norm,
        interpolation="nearest",
    )

    ax.set_title(f"{title} (bounded simulation up to {max_steps} steps)")
    ax.set_xlabel("Input")
    ax.set_ylabel("Program")
    ax.set_xticks(range(cols))
    ax.set_xticklabels(grid_data.col_labels)
    ax.set_yticks(range(rows))
    ax.set_yticklabels(grid_data.row_labels)

    fig_w_in, fig_h_in = fig.get_size_inches()
    bbox = ax.get_position()
    ax_w_px = fig_w_in * fig.dpi * bbox.width
    ax_h_px = fig_h_in * fig.dpi * bbox.height
    cell_w_px = ax_w_px / max(cols, 1)
    cell_h_px = ax_h_px / max(rows, 1)
    cell_px = min(cell_w_px, cell_h_px)

    annotation_fontsize = float(np.clip(cell_px * 0.28, 6, 12))
    x_tick_fontsize = float(np.clip(cell_w_px * 0.26, 6, 11))
    y_tick_fontsize = float(np.clip(cell_h_px * 0.26, 6, 10))
    axis_label_fontsize = float(np.clip(min(x_tick_fontsize, y_tick_fontsize) + 1, 7, 12))
    title_fontsize = float(np.clip(axis_label_fontsize + 2, 9, 15))

    _format_trace_label_style(ax, y_tick_fontsize=y_tick_fontsize, x_tick_fontsize=x_tick_fontsize)
    ax.xaxis.label.set_size(axis_label_fontsize)
    ax.yaxis.label.set_size(axis_label_fontsize)
    ax.xaxis.label.set_color("#4e5965")
    ax.yaxis.label.set_color("#6f7a86")
    ax.title.set_fontsize(title_fontsize)
    ax.title.set_color("#243447")
    _style_trace_axes(ax)

    if annotate:
        for (row_index, col_index), cell in grid_data.cell_map.items():
            text = _annotation_for_cell(
                cell,
                max_steps=max_steps,
                show_step_counts=show_step_counts,
            )
            text_color = "white" if cell.halted else "#51606d"
            ax.text(
                col_index,
                row_index,
                text,
                ha="center",
                va="center",
                color=text_color,
                fontsize=annotation_fontsize,
            )

    cbar = fig.colorbar(im, cax=cax, ticks=[0, 1])
    cbar.outline.set_linewidth(0.7)
    cbar.outline.set_edgecolor("#7d8792")
    cbar.ax.tick_params(colors="#4e5965", labelsize=float(np.clip(axis_label_fontsize - 1, 6, 10)))
    cbar.ax.set_yticklabels(["Unresolved", "Halts"])
    cbar.set_label("Observed status", color="#4e5965")

    legend_handles = [
        Patch(facecolor="#2f6f9f", edgecolor="#2f6f9f", label="Observed to halt within bound"),
        Patch(facecolor="#edf3f8", edgecolor="#b5c2cf", label="Still running / unresolved within bound"),
    ]
    ax.legend(
        handles=legend_handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.12),
        ncol=2,
        frameon=False,
        fontsize=float(np.clip(axis_label_fontsize - 1, 7, 10)),
    )

    fig.text(
        left,
        0.055,
        "Cells mark observed halting within the current bound; light cells may still halt later.",
        ha="left",
        va="bottom",
        fontsize=float(np.clip(axis_label_fontsize - 1, 7, 10)),
        color="#6a7682",
    )

    row_band = Rectangle(
        (-0.5, -0.5),
        cols,
        1,
        facecolor="#dce8f2",
        edgecolor="#90a8bf",
        linewidth=0.8,
        alpha=0.18,
        visible=False,
        zorder=4,
    )
    col_band = Rectangle(
        (-0.5, -0.5),
        1,
        rows,
        facecolor="#dce8f2",
        edgecolor="#90a8bf",
        linewidth=0.8,
        alpha=0.14,
        visible=False,
        zorder=4,
    )
    selected_cell = Rectangle(
        (-0.5, -0.5),
        1,
        1,
        fill=False,
        edgecolor="#c46b15",
        linewidth=2.0,
        visible=False,
        zorder=7,
    )
    status_text = fig.text(
        right - cbar_width,
        0.92,
        "",
        ha="right",
        va="bottom",
        fontsize=float(np.clip(axis_label_fontsize - 0.5, 7, 10)),
        color="#4f5f6d",
    )

    ax.add_patch(row_band)
    ax.add_patch(col_band)
    ax.add_patch(selected_cell)

    def _select_cell(row_index: int, col_index: int) -> HaltingCellResult:
        cell = grid_data.cell_map[(row_index, col_index)]
        row_band.set_xy((-0.5, row_index - 0.5))
        col_band.set_xy((col_index - 0.5, -0.5))
        selected_cell.set_xy((col_index - 0.5, row_index - 0.5))
        row_band.set_visible(True)
        col_band.set_visible(True)
        selected_cell.set_visible(True)
        status_text.set_text(
            f"{cell.program_label} on input {cell.input_label}: {cell.status_label}"
        )
        fig.canvas.draw_idle()
        return cell

    def _on_click(event) -> None:
        if event.inaxes is not ax or event.xdata is None or event.ydata is None:
            return

        col_index = int(round(event.xdata))
        row_index = int(round(event.ydata))

        if not (0 <= row_index < rows and 0 <= col_index < cols):
            return

        cell = _select_cell(row_index, col_index)

        if open_trace_on_click and cell.trace:
            trace_figure = _plot_cell_trace_heatmap(cell)
            if trace_figure is not None:
                trace_figure[0].show()

    fig.canvas.mpl_connect("button_press_event", _on_click)

    plt.show()
    return fig, ax, grid_data


def _demo_runner(
    program: Sequence[Instruction],
    input_value: InputValue,
    max_steps: int,
) -> Mapping[str, Any]:
    """
    Simple runner matching the public contract.

    Replace this with the real URM execution function if you want different
    input conventions or richer program descriptors.
    """
    if isinstance(input_value, int):
        initial_registers = [input_value]
    else:
        initial_registers = list(input_value)

    return execute(
        list(program),
        initial_registers=initial_registers,
        max_steps=max_steps,
        record_trace=True,
    )


def _demo_programs() -> List[List[Instruction]]:
    return [
        [("S", 0)],
        [("J", 0, 0, 0)],
        [("J", 0, 1, 3), ("S", 1), ("J", 0, 0, 0)],
        [("J", 0, 1, 4), ("S", 1), ("S", 1), ("J", 0, 0, 0)],
    ]


if __name__ == "__main__":
    demo_programs = _demo_programs()
    demo_inputs = [0, 1, 2, 3]

    # To plug in a different simulator, replace `_demo_runner` with a function
    # of the form runner(program, input_value, max_steps) -> {halted, steps, trace}.
    plot_halting_heatmap(
        demo_programs,
        demo_inputs,
        _demo_runner,
        max_steps=25,
        program_labels=["P0", "Loop", "Eq1", "Eq2"],
    )

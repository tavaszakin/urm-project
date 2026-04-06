from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

from diagonal_pipeline_demo import DiagonalPipelineData, build_diagonal_pipeline
from program_transformer_demo import example_add_program
from urm import Instruction


# Stable color-role mapping for the fixed-point milestone.
# Preserve these roles in later recursion-theorem screens:
# - x / copies of x / input-index objects: blue family
# - specialization objects s(x,x), s(e,e): green family
# - transformer f and transformed outputs: gold family
# - distinguished fixed-point index e: red accent family
# - neutral structural boxes/backgrounds: gray-blue neutrals
COLOR_ROLES: Dict[str, str] = {
    "x_fill": "#eef4fb",
    "x_edge": "#4e79a7",
    "specialization_fill": "#edf7f1",
    "specialization_edge": "#4e8b6a",
    "transform_fill": "#fff4dc",
    "transform_edge": "#b07a00",
    "index_fill": "#fff1f0",
    "index_edge": "#c0392b",
    "neutral_fill": "#f8fafc",
    "neutral_edge": "#8aa1b1",
    "canvas": "#fcfdff",
    "title": "#102a43",
    "subtitle": "#486581",
    "body": "#243447",
    "muted": "#52606d",
}


@dataclass(frozen=True)
class FixedPointTheme:
    colors: Dict[str, str] = field(default_factory=lambda: dict(COLOR_ROLES))


@dataclass(frozen=True)
class FixedPointLayout:
    width: float = 15.0
    height: float = 8.6
    box_rounding: float = 0.14
    box_padding: float = 0.02
    box_linewidth: float = 1.8
    arrow_linewidth: float = 1.9
    title_y: float = 8.15
    subtitle_y: float = 7.72
    footer_y: float = 0.52
    module_gap: float = 0.22


@dataclass(frozen=True)
class FixedPointConstructionData:
    diagonal_pipeline: DiagonalPipelineData
    transformer_label: str
    g_label: str
    program_label: str
    derived_index_label: str
    substitution_label: str
    summary: Dict[str, object]
    screen_notes: Dict[int, str]


def build_fixed_point_construction_data(
    index_e_value: int = 3,
    *,
    index_variable: str = "x",
    derived_index_symbol: str = "e",
    program: Optional[Sequence[Instruction]] = None,
) -> FixedPointConstructionData:
    """
    Build the structural data for the first fixed-point construction sequence.

    The proof content here is intentionally limited to the mechanical setup:
    1. define g(x) = f(s(x,x))
    2. package that recipe as an ordinary program G
    3. name its index e = index(G)
    4. feed e back into G to obtain g(e) = f(s(e,e))
    """
    source_program = list(program) if program is not None else example_add_program()
    diagonal_pipeline = build_diagonal_pipeline(
        index_x=index_e_value,
        program=source_program,
        index_label=index_variable,
    )

    g_label = f"g({index_variable}) = f(s({index_variable},{index_variable}))"
    substitution_label = f"g({derived_index_symbol}) = f(s({derived_index_symbol},{derived_index_symbol}))"

    return FixedPointConstructionData(
        diagonal_pipeline=diagonal_pipeline,
        transformer_label="Transformer f",
        g_label=g_label,
        program_label="Program G computing g",
        derived_index_label=f"{derived_index_symbol} = index(G)",
        substitution_label=substitution_label,
        summary={
            "index_variable": index_variable,
            "derived_index_symbol": derived_index_symbol,
            "source_length": len(diagonal_pipeline.adapter.program),
            "specialized_length": diagonal_pipeline.summary["specialized_length"],
            "transformed_length": diagonal_pipeline.summary["transformed_length"],
            "prelude_length": diagonal_pipeline.summary["prelude_length"],
            "transformer_added_length": diagonal_pipeline.summary["transformer_added_length"],
        },
        screen_notes={
            1: "Build g as a left-to-right computable pipeline.",
            2: "Repackage the same recipe as a concrete program object G.",
            3: "Take the index of the already-built program G.",
            4: "Feed that derived index back into G to create self-application mechanically.",
        },
    )


def _setup_axis(ax, layout: FixedPointLayout) -> None:
    ax.set_facecolor(COLOR_ROLES["canvas"])
    ax.axis("off")
    ax.set_xlim(0, layout.width)
    ax.set_ylim(0, layout.height)


def _draw_box(
    ax,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    body: str = "",
    facecolor: str,
    edgecolor: str,
    title_color: Optional[str] = None,
    body_color: Optional[str] = None,
    title_fontsize: float = 12.0,
    body_fontsize: float = 9.7,
    linewidth: float = 1.8,
    align: str = "left",
) -> FancyBboxPatch:
    patch = FancyBboxPatch(
        (x, y),
        width,
        height,
        boxstyle="round,pad=0.02,rounding_size=0.14",
        linewidth=linewidth,
        facecolor=facecolor,
        edgecolor=edgecolor,
    )
    ax.add_patch(patch)

    text_x = x + 0.22 if align == "left" else x + width / 2.0
    ha = "left" if align == "left" else "center"
    ax.text(
        text_x,
        y + height - 0.2,
        title,
        ha=ha,
        va="top",
        fontsize=title_fontsize,
        fontweight="bold",
        color=title_color or COLOR_ROLES["title"],
    )
    if body:
        ax.text(
            text_x,
            y + height - 0.64,
            body,
            ha=ha,
            va="top",
            fontsize=body_fontsize,
            color=body_color or COLOR_ROLES["body"],
        )
    return patch


def _draw_arrow(
    ax,
    start,
    end,
    *,
    color: str,
    linewidth: float = 1.9,
    connectionstyle: str = "arc3",
    mutation_scale: float = 14.0,
) -> None:
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=mutation_scale,
            linewidth=linewidth,
            color=color,
            connectionstyle=connectionstyle,
        )
    )


def _draw_caption(ax, layout: FixedPointLayout, text: str) -> None:
    ax.text(
        layout.width / 2.0,
        layout.footer_y,
        text,
        ha="center",
        va="center",
        fontsize=9.5,
        color=COLOR_ROLES["muted"],
    )


def _draw_screen_header(
    ax,
    *,
    title: str,
    subtitle: str,
    layout: FixedPointLayout,
) -> None:
    ax.text(
        0.75,
        layout.title_y,
        title,
        ha="left",
        va="top",
        fontsize=17.0,
        fontweight="bold",
        color=COLOR_ROLES["title"],
    )
    ax.text(
        0.75,
        layout.subtitle_y,
        subtitle,
        ha="left",
        va="top",
        fontsize=10.3,
        color=COLOR_ROLES["subtitle"],
    )


def _draw_formula_strip(ax, *, x: float, y: float, width: float, text: str) -> None:
    _draw_box(
        ax,
        x=x,
        y=y,
        width=width,
        height=0.92,
        title=text,
        facecolor=COLOR_ROLES["neutral_fill"],
        edgecolor=COLOR_ROLES["neutral_edge"],
        title_fontsize=14.0,
        linewidth=1.4,
        align="center",
    )


def _draw_badge(
    ax,
    *,
    center_x: float,
    center_y: float,
    text: str,
    facecolor: str,
    edgecolor: str,
    fontsize: float = 13.0,
    width: float = 2.4,
    height: float = 0.86,
) -> None:
    _draw_box(
        ax,
        x=center_x - width / 2.0,
        y=center_y - height / 2.0,
        width=width,
        height=height,
        title=text,
        facecolor=facecolor,
        edgecolor=edgecolor,
        title_fontsize=fontsize,
        linewidth=1.6,
        align="center",
    )


def _draw_program_object(
    ax,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    data: FixedPointConstructionData,
    input_symbol: str,
    specialization_symbol: str,
    show_footer_metrics: bool = True,
) -> Dict[str, tuple]:
    """
    Draw Program G as a modular engineered object.

    Returns anchor points used by later screens for arrows and loopbacks.
    """
    _draw_box(
        ax,
        x=x,
        y=y,
        width=width,
        height=height,
        title=data.program_label,
        body="Built from ordinary effective subroutines, not from a mystical self-reference primitive.",
        facecolor=COLOR_ROLES["neutral_fill"],
        edgecolor=COLOR_ROLES["neutral_edge"],
        title_fontsize=13.0,
        body_fontsize=9.5,
    )

    formula_x = x + width - 1.4
    _draw_badge(
        ax,
        center_x=formula_x,
        center_y=y + height - 0.48,
        text=rf"$g({input_symbol})$",
        facecolor=COLOR_ROLES["x_fill"],
        edgecolor=COLOR_ROLES["x_edge"],
        fontsize=12.6,
        width=1.9,
        height=0.7,
    )

    module_y = y + 0.72
    module_h = 1.82
    module_gap = 0.25
    first_x = x + 0.32
    usable_width = width - 0.64
    module_w = (usable_width - 4 * module_gap) / 5.0
    module_specs = [
        (
            f"receive {input_symbol}",
            "accept an input index",
            COLOR_ROLES["x_fill"],
            COLOR_ROLES["x_edge"],
        ),
        (
            f"reuse {input_symbol}",
            "keep a second copy available",
            COLOR_ROLES["x_fill"],
            COLOR_ROLES["x_edge"],
        ),
        (
            f"compute {specialization_symbol}",
            "run the s-m-n constructor",
            COLOR_ROLES["specialization_fill"],
            COLOR_ROLES["specialization_edge"],
        ),
        (
            "apply f",
            "transform the specialized index",
            COLOR_ROLES["transform_fill"],
            COLOR_ROLES["transform_edge"],
        ),
        (
            "output index",
            "return the transformed code",
            COLOR_ROLES["transform_fill"],
            COLOR_ROLES["transform_edge"],
        ),
    ]

    chain_right = first_x + 5 * module_w + 4 * module_gap
    anchors: Dict[str, tuple] = {
        "input_port": (first_x - 0.34, module_y + module_h / 2.0),
        "output_port": (chain_right + 0.34, module_y + module_h / 2.0),
    }

    for idx, (title, body, fill, edge) in enumerate(module_specs):
        module_x = first_x + idx * (module_w + module_gap)
        _draw_box(
            ax,
            x=module_x,
            y=module_y,
            width=module_w,
            height=module_h,
            title=title,
            body=body,
            facecolor=fill,
            edgecolor=edge,
            title_fontsize=10.2,
            body_fontsize=8.65,
        )
        anchors[f"module_{idx}"] = (module_x + module_w / 2.0, module_y + module_h / 2.0)
        if idx < len(module_specs) - 1:
            next_x = first_x + (idx + 1) * (module_w + module_gap)
            _draw_arrow(
                ax,
                (module_x + module_w, module_y + module_h / 2.0),
                (next_x, module_y + module_h / 2.0),
                color=COLOR_ROLES["muted"],
                linewidth=1.4,
                mutation_scale=12,
            )

    ax.text(
        x + 0.34,
        module_y + module_h + 0.28,
        "modular computation of g",
        ha="left",
        va="bottom",
        fontsize=9.2,
        color=COLOR_ROLES["subtitle"],
    )
    if show_footer_metrics:
        ax.text(
            x + 0.34,
            y + 0.22,
            f"source length: {data.summary['source_length']}    "
            f"s-stage length: {data.summary['specialized_length']}    "
            f"f adds: {data.summary['transformer_added_length']}",
            ha="left",
            va="bottom",
            fontsize=8.8,
            color=COLOR_ROLES["muted"],
        )

    return anchors


def plot_fixed_point_screen1_pipeline(
    data: FixedPointConstructionData,
    *,
    ax=None,
    title: str = "Screen 1. Construction Pipeline",
) -> None:
    created_fig = False
    layout = FixedPointLayout()
    if ax is None:
        fig, ax = plt.subplots(figsize=(14.8, 5.8))
        created_fig = True
    else:
        fig = ax.figure

    _setup_axis(ax, layout)
    if created_fig:
        fig.patch.set_facecolor(COLOR_ROLES["canvas"])

    _draw_screen_header(
        ax,
        title=title,
        subtitle="Build g by composing the diagonal specialization step with the computable transformer f.",
        layout=layout,
    )
    _draw_formula_strip(ax, x=4.15, y=6.7, width=6.7, text=rf"$ {data.g_label} $")

    _draw_box(
        ax,
        x=1.0,
        y=2.7,
        width=2.5,
        height=2.0,
        title="input index x",
        body="start with an ordinary program index",
        facecolor=COLOR_ROLES["x_fill"],
        edgecolor=COLOR_ROLES["x_edge"],
    )
    _draw_box(
        ax,
        x=5.2,
        y=2.45,
        width=3.5,
        height=2.5,
        title="specialization object s(x,x)",
        body="specialize x using its own index\nthis defines the diagonal step",
        facecolor=COLOR_ROLES["specialization_fill"],
        edgecolor=COLOR_ROLES["specialization_edge"],
    )
    _draw_box(
        ax,
        x=10.5,
        y=2.7,
        width=3.2,
        height=2.0,
        title="transformed output f(s(x,x))",
        body="apply transformer f\nto the specialized index",
        facecolor=COLOR_ROLES["transform_fill"],
        edgecolor=COLOR_ROLES["transform_edge"],
    )

    _draw_arrow(ax, (3.55, 3.7), (5.12, 3.7), color=COLOR_ROLES["specialization_edge"])
    _draw_arrow(ax, (8.78, 3.7), (10.42, 3.7), color=COLOR_ROLES["transform_edge"])
    _draw_arrow(
        ax,
        (2.18, 4.78),
        (5.18, 4.8),
        color=COLOR_ROLES["x_edge"],
        linewidth=1.5,
        mutation_scale=12,
        connectionstyle="arc3,rad=-0.23",
    )
    _draw_arrow(
        ax,
        (2.18, 2.62),
        (5.18, 2.6),
        color=COLOR_ROLES["x_edge"],
        linewidth=1.5,
        mutation_scale=12,
        connectionstyle="arc3,rad=0.23",
    )

    ax.text(
        4.28,
        4.1,
        "specialize x using its own index",
        ha="center",
        va="bottom",
        fontsize=9.2,
        color=COLOR_ROLES["specialization_edge"],
        fontweight="bold",
    )
    ax.text(
        9.58,
        4.1,
        "apply transformer f",
        ha="center",
        va="bottom",
        fontsize=9.2,
        color=COLOR_ROLES["transform_edge"],
        fontweight="bold",
    )
    ax.text(
        7.45,
        1.55,
        "this defines g(x)",
        ha="center",
        va="center",
        fontsize=12.2,
        color=COLOR_ROLES["title"],
        fontweight="bold",
    )
    _draw_caption(
        ax,
        layout,
        "The key point is compositional: g is obtained by a visible effective pipeline x -> s(x,x) -> f(s(x,x)).",
    )

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def plot_fixed_point_screen2_program_G(
    data: FixedPointConstructionData,
    *,
    ax=None,
    title: str = "Screen 2. Program G As A Concrete Object",
) -> None:
    created_fig = False
    layout = FixedPointLayout()
    if ax is None:
        fig, ax = plt.subplots(figsize=(15.0, 6.2))
        created_fig = True
    else:
        fig = ax.figure

    _setup_axis(ax, layout)
    if created_fig:
        fig.patch.set_facecolor(COLOR_ROLES["canvas"])

    _draw_screen_header(
        ax,
        title=title,
        subtitle="Repackage the abstract pipeline as a normal engineered program object.",
        layout=layout,
    )
    _draw_formula_strip(ax, x=4.18, y=6.72, width=6.65, text=rf"$ {data.g_label} $")
    _draw_program_object(
        ax,
        x=1.05,
        y=1.65,
        width=12.9,
        height=4.35,
        data=data,
        input_symbol=str(data.summary["index_variable"]),
        specialization_symbol=f"s({data.summary['index_variable']},{data.summary['index_variable']})",
    )
    _draw_caption(
        ax,
        layout,
        "Program G is meant to feel ordinary: receive x, reuse x, compute s(x,x), apply f, then output the new index.",
    )

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def plot_fixed_point_screen3_index_assignment(
    data: FixedPointConstructionData,
    *,
    ax=None,
    title: str = "Screen 3. Define e = index(G)",
) -> None:
    created_fig = False
    layout = FixedPointLayout()
    if ax is None:
        fig, ax = plt.subplots(figsize=(15.0, 6.6))
        created_fig = True
    else:
        fig = ax.figure

    _setup_axis(ax, layout)
    if created_fig:
        fig.patch.set_facecolor(COLOR_ROLES["canvas"])

    _draw_screen_header(
        ax,
        title=title,
        subtitle="The proof index e is introduced only after Program G has been visibly constructed.",
        layout=layout,
    )

    anchors = _draw_program_object(
        ax,
        x=0.95,
        y=1.55,
        width=8.8,
        height=4.45,
        data=data,
        input_symbol=str(data.summary["index_variable"]),
        specialization_symbol=f"s({data.summary['index_variable']},{data.summary['index_variable']})",
        show_footer_metrics=False,
    )

    _draw_badge(
        ax,
        center_x=12.3,
        center_y=4.48,
        text=rf"$ {data.derived_index_label} $",
        facecolor=COLOR_ROLES["index_fill"],
        edgecolor=COLOR_ROLES["index_edge"],
        fontsize=14.0,
        width=4.2,
        height=0.95,
    )
    _draw_box(
        ax,
        x=10.3,
        y=2.55,
        width=4.05,
        height=1.28,
        title="take the index of this program",
        body="e is derived from the displayed object G",
        facecolor=COLOR_ROLES["index_fill"],
        edgecolor=COLOR_ROLES["index_edge"],
        title_fontsize=10.6,
        body_fontsize=8.9,
    )
    _draw_arrow(
        ax,
        (anchors["output_port"][0] - 0.15, anchors["output_port"][1] + 0.8),
        (10.24, 3.18),
        color=COLOR_ROLES["index_edge"],
        connectionstyle="arc3,rad=-0.08",
    )
    _draw_arrow(
        ax,
        (11.95, 3.82),
        (12.1, 4.0),
        color=COLOR_ROLES["index_edge"],
        linewidth=1.5,
        mutation_scale=12,
    )
    ax.text(
        10.25,
        5.52,
        "proof moment",
        ha="left",
        va="center",
        fontsize=10.1,
        color=COLOR_ROLES["index_edge"],
        fontweight="bold",
    )
    _draw_caption(
        ax,
        layout,
        "The accent color marks the derived fixed-point candidate: e is not assumed beforehand, it is obtained as index(G).",
    )

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def plot_fixed_point_screen4_self_application(
    data: FixedPointConstructionData,
    *,
    ax=None,
    title: str = "Screen 4. Feed e Back Into G",
) -> None:
    created_fig = False
    layout = FixedPointLayout()
    if ax is None:
        fig, ax = plt.subplots(figsize=(15.0, 6.8))
        created_fig = True
    else:
        fig = ax.figure

    _setup_axis(ax, layout)
    if created_fig:
        fig.patch.set_facecolor(COLOR_ROLES["canvas"])

    e_symbol = str(data.summary["derived_index_symbol"])
    _draw_screen_header(
        ax,
        title=title,
        subtitle="Self-reference now appears as a visible loop: feed the program its own index as input.",
        layout=layout,
    )

    anchors = _draw_program_object(
        ax,
        x=3.05,
        y=1.55,
        width=8.85,
        height=4.45,
        data=data,
        input_symbol=e_symbol,
        specialization_symbol=f"s({e_symbol},{e_symbol})",
        show_footer_metrics=False,
    )

    _draw_badge(
        ax,
        center_x=8.6,
        center_y=6.55,
        text=rf"$ {data.derived_index_label} $",
        facecolor=COLOR_ROLES["index_fill"],
        edgecolor=COLOR_ROLES["index_edge"],
        fontsize=14.0,
        width=3.3,
        height=0.92,
    )
    _draw_box(
        ax,
        x=11.95,
        y=2.7,
        width=2.55,
        height=1.95,
        title=rf"$ {data.substitution_label} $",
        body="output: f(s(e,e))",
        facecolor=COLOR_ROLES["transform_fill"],
        edgecolor=COLOR_ROLES["transform_edge"],
        title_fontsize=13.0,
        body_fontsize=10.0,
        align="center",
    )

    _draw_arrow(
        ax,
        (anchors["output_port"][0], anchors["output_port"][1]),
        (11.92, 3.68),
        color=COLOR_ROLES["transform_edge"],
        linewidth=1.8,
    )
    _draw_arrow(
        ax,
        (8.6, 6.06),
        (anchors["input_port"][0] + 0.15, anchors["input_port"][1] + 0.22),
        color=COLOR_ROLES["index_edge"],
        linewidth=2.1,
        connectionstyle="arc3,rad=0.58",
        mutation_scale=16,
    )
    ax.text(
        2.0,
        5.2,
        "feed the program its own index",
        ha="left",
        va="center",
        fontsize=9.9,
        color=COLOR_ROLES["index_edge"],
        fontweight="bold",
    )
    ax.text(
        1.95,
        4.66,
        "self-application is constructed mechanically",
        ha="left",
        va="center",
        fontsize=9.25,
        color=COLOR_ROLES["subtitle"],
    )
    ax.text(
        12.98,
        4.94,
        "resulting value",
        ha="center",
        va="bottom",
        fontsize=9.2,
        color=COLOR_ROLES["transform_edge"],
        fontweight="bold",
    )
    _draw_caption(
        ax,
        layout,
        "Nothing mystical happens here: once G has index e, supplying e to G yields the explicit expression g(e) = f(s(e,e)).",
    )

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def plot_fixed_point_stage(
    stage: int,
    data: FixedPointConstructionData,
    *,
    ax=None,
) -> None:
    if stage == 1:
        plot_fixed_point_screen1_pipeline(data, ax=ax)
        return
    if stage == 2:
        plot_fixed_point_screen2_program_G(data, ax=ax)
        return
    if stage == 3:
        plot_fixed_point_screen3_index_assignment(data, ax=ax)
        return
    if stage == 4:
        plot_fixed_point_screen4_self_application(data, ax=ax)
        return
    raise ValueError("stage must be one of {1, 2, 3, 4}.")


def plot_fixed_point_screen_sequence(
    data: FixedPointConstructionData,
    *,
    title: str = "Kleene Fixed-Point Construction: Screens 1-4",
) -> None:
    """
    Render the first fixed-point milestone as a four-screen sequence.

    This is the clean extension point for later milestones:
    additional screens can be added as new stage functions and included here.
    """
    fig, axes = plt.subplots(2, 2, figsize=(18.2, 13.0))
    fig.patch.set_facecolor(COLOR_ROLES["canvas"])
    fig.suptitle(title, fontsize=20, fontweight="bold", y=0.988)
    fig.text(
        0.5,
        0.963,
        "Flow-diagram sequence for the construction and self-reference stage only",
        ha="center",
        va="top",
        fontsize=11.0,
        color=COLOR_ROLES["subtitle"],
    )

    for stage, ax in enumerate(axes.flat, start=1):
        plot_fixed_point_stage(stage, data, ax=ax)

    fig.tight_layout(rect=[0.015, 0.02, 0.985, 0.955])

    if "agg" not in plt.get_backend().lower():
        plt.show()


def demo_fixed_point_construction_panel(
    index_e_value: int = 3,
    *,
    index_variable: str = "x",
    derived_index_symbol: str = "e",
    program: Optional[Sequence[Instruction]] = None,
    stage: Optional[int] = None,
    show_figure: bool = True,
) -> FixedPointConstructionData:
    data = build_fixed_point_construction_data(
        index_e_value=index_e_value,
        index_variable=index_variable,
        derived_index_symbol=derived_index_symbol,
        program=program,
    )

    print("fixed-point construction flow demo")
    print(f"  stage range:            {'1-4 sequence' if stage is None else f'stage {stage}'}")
    print(f"  g definition:           {data.g_label}")
    print(f"  program object:         {data.program_label}")
    print(f"  derived index:          {data.derived_index_label}")
    print(f"  self-application:       {data.substitution_label}")
    print(f"  specialization length:  {data.summary['specialized_length']}")
    print(f"  transformed length:     {data.summary['transformed_length']}")

    if show_figure:
        if stage is None:
            plot_fixed_point_screen_sequence(data)
        else:
            plot_fixed_point_stage(stage, data)

    return data


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="fixed-point construction flow-diagram demo")
    parser.add_argument("--index-value", type=int, default=3, help="concrete demo value paired with the symbolic index")
    parser.add_argument("--index-variable", default="x", help="symbol used in g(x)")
    parser.add_argument("--derived-index", default="e", help="symbol used for index(G)")
    parser.add_argument("--stage", type=int, default=None, help="render a single stage 1-4 instead of the whole sequence")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    demo_fixed_point_construction_panel(
        index_e_value=args.index_value,
        index_variable=args.index_variable,
        derived_index_symbol=args.derived_index,
        stage=args.stage,
    )

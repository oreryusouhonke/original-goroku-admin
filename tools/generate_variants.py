from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".deps"))
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


INK = (35, 23, 19, 255)
FONT = Path(__file__).resolve().parents[1] / "assets" / "KONSHIN.TTF"
TT_FONT = TTFont(str(FONT))
GLYPH_SET = TT_FONT.getGlyphSet()
CMAP = TT_FONT.getBestCmap()
UNITS_PER_EM = TT_FONT["head"].unitsPerEm
GLYF = TT_FONT["glyf"]


def char_metrics(text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    draw = ImageDraw.Draw(Image.new("L", (10, 10)))
    width = height = 0
    for char in text:
        box = draw.textbbox((0, 0), char, font=font)
        width = max(width, box[2] - box[0])
        height = max(height, box[3] - box[1])
    return width, height


def column_size(item: dict, base: int) -> tuple:
    font = ImageFont.truetype(str(FONT), max(40, int(base * item["scale"])))
    draw = ImageDraw.Draw(Image.new("L", (10, 10)))
    sizes = []
    width = 0
    for char in item["text"]:
        box = draw.textbbox((0, 0), char, font=font)
        glyph_w = box[2] - box[0]
        glyph_h = box[3] - box[1]
        width = max(width, glyph_w)
        sizes.append((glyph_w, glyph_h))
    gap = max(8, int(font.size * 0.045))
    height = sum(glyph_h for _, glyph_h in sizes) + gap * max(0, len(sizes) - 1)
    return font, width, gap, width, height


def column_x_positions(count: int, left: float = 0.28, right: float = 0.72) -> list[float]:
    if count <= 1:
        return [0.50]
    step = (right - left) / (count - 1)
    return [right - step * index for index in range(count)]


def make_spec(lines: list[str], variant: str) -> list[dict]:
    count = max(1, len(lines))
    positions = column_x_positions(count)
    center = (count - 1) / 2
    spec = []
    for index, text in enumerate(lines):
        distance = abs(index - center) / max(1, center)
        if variant == "A_center":
            scale = 1.46 - distance * 0.18
            y = 0.50 + ((index % 3) - 1) * 0.035
            sx = 1.02 + (0.04 if index % 2 == 0 else -0.02)
            sy = 1.03 - (0.04 if index % 2 == 0 else 0)
            angle = 0
        elif variant == "B_stagger":
            scale = 1.40 - distance * 0.12 + (0.06 if index % 2 else 0)
            y = 0.50 + ((index % 4) - 1.5) * 0.045
            sx = 0.98 + (index % 3) * 0.035
            sy = 1.08 - (index % 2) * 0.08
            angle = [3, -2, 2, -3][index % 4]
        else:
            scale = 1.50 - distance * 0.15 + (0.08 if index == round(center) else 0)
            y = 0.50 + ((index % 5) - 2) * 0.025
            sx = 1.08 - (index % 2) * 0.07
            sy = 0.98 + (index % 3) * 0.035
            angle = [-2, 2, -1, 3, -3][index % 5]
        spec.append(
            {
                "text": text,
                "scale": scale,
                "x": positions[index],
                "y": y,
                "sx": sx,
                "sy": sy,
                "angle": angle,
            }
        )
    return spec


def variant_specs(lines: list[str]) -> dict[str, list[dict]]:
    return {
        "A_center": make_spec(lines, "A_center"),
        "B_stagger": make_spec(lines, "B_stagger"),
        "C_dense": make_spec(lines, "C_dense"),
    }


def fit(canvas: tuple[int, int], spec: list[dict]) -> list[tuple]:
    for base in range(1050, 80, -5):
        data = []
        ok = True
        for item in spec:
            if not item["text"]:
                continue
            font, char_w, gap, width, height = column_size(item, base)
            cx = int(canvas[0] * item["x"])
            cy = int(canvas[1] * item["y"])
            padded_w = width * item["sx"] * 1.02
            padded_h = height * item["sy"] * 1.01
            if (
                cx - padded_w / 2 < canvas[0] * 0.02
                or cx + padded_w / 2 > canvas[0] * 0.98
                or cy - padded_h / 2 < canvas[1] * 0.02
                or cy + padded_h / 2 > canvas[1] * 0.98
            ):
                ok = False
                break
            data.append((item, font, char_w, gap, padded_w, padded_h, cx, cy))
        if ok:
            ordered = sorted(data, key=lambda entry: entry[6])
            min_gap = max(18, canvas[0] * 0.006)
            for left_entry, right_entry in zip(ordered, ordered[1:]):
                left_edge = left_entry[6] + left_entry[4] / 2
                right_edge = right_entry[6] - right_entry[4] / 2
                if left_edge + min_gap > right_edge:
                    ok = False
                    break
        if ok:
            return data
    raise RuntimeError("layout fit failed")


def placement_data(canvas: tuple[int, int], spec: list[dict]) -> list[dict]:
    placed = []
    scratch = ImageDraw.Draw(Image.new("L", (10, 10)))
    for ci, (item, font, char_w, gap, width, height, cx, cy) in enumerate(fit(canvas, spec)):
        y = cy - height // 2
        for idx, char in enumerate(item["text"]):
            box = scratch.textbbox((0, 0), char, font=font)
            glyph_w = box[2] - box[0]
            glyph_h = box[3] - box[1]
            ox = ((ci * 13 + idx * 29) % 5 - 2) * max(1, font.size // 220)
            oy = 0
            angle = item["angle"]
            placed.append(
                {
                    "char": char,
                    "font": font,
                    "left": cx - glyph_w / 2 - box[0] + ox,
                    "top": y - box[1] + oy,
                    "width": glyph_w,
                    "height": glyph_h,
                    "angle": angle,
                    "sx": item["sx"],
                    "sy": item["sy"],
                    "bbox": box,
                }
            )
            y += glyph_h + gap
    return placed


def draw_variant(canvas: tuple[int, int], spec: list[dict], path: Path) -> None:
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    for item in placement_data(canvas, spec):
        glyph_pad = int(item["font"].size * 0.45)
        glyph = Image.new(
            "RGBA",
            (int(item["width"] + glyph_pad * 2), int(item["height"] + glyph_pad * 2)),
            (0, 0, 0, 0),
        )
        glyph_draw = ImageDraw.Draw(glyph)
        box = item["bbox"]
        glyph_draw.text((glyph_pad - box[0], glyph_pad - box[1]), item["char"], font=item["font"], fill=INK)
        resized = (
            max(1, int(glyph.width * item["sx"])),
            max(1, int(glyph.height * item["sy"])),
        )
        glyph = glyph.resize(resized, Image.Resampling.BICUBIC)
        glyph = glyph.rotate(item["angle"], resample=Image.Resampling.BICUBIC, expand=True)
        cx = item["left"] + item["width"] / 2
        cy = item["top"] + item["height"] / 2
        image.alpha_composite(glyph, (int(cx - glyph.width / 2), int(cy - glyph.height / 2)))
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        ink = image.crop(bbox)
        target_w = int(canvas[0] * 0.96)
        target_h = int(canvas[1] * 0.96)
        uniform = min(target_w / ink.width, target_h / ink.height)
        if uniform > 1:
            resized = ink.resize((int(ink.width * uniform), int(ink.height * uniform)), Image.Resampling.BICUBIC)
            image = Image.new("RGBA", canvas, (0, 0, 0, 0))
            image.alpha_composite(resized, ((canvas[0] - resized.width) // 2, (canvas[1] - resized.height) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def glyph_path(char: str) -> tuple[str, str] | None:
    glyph_name = CMAP.get(ord(char))
    if not glyph_name or glyph_name not in GLYPH_SET:
        return None
    pen = SVGPathPen(GLYPH_SET)
    GLYPH_SET[glyph_name].draw(pen)
    return pen.getCommands(), glyph_name


def write_svg(canvas: tuple[int, int], spec: list[dict], path: Path) -> None:
    paths = []
    placed = placement_data(canvas, spec)
    if placed:
        min_x = min(item["left"] for item in placed)
        min_y = min(item["top"] for item in placed)
        max_x = max(item["left"] + item["width"] * item["sx"] for item in placed)
        max_y = max(item["top"] + item["height"] * item["sy"] for item in placed)
        raw_w = max(1, max_x - min_x)
        raw_h = max(1, max_y - min_y)
        target_w = int(canvas[0] * 0.96)
        target_h = int(canvas[1] * 0.96)
        uniform = min(target_w / raw_w, target_h / raw_h)
        group_sx = uniform
        group_sy = uniform
        group_tx = (canvas[0] - raw_w * group_sx) / 2 - min_x * group_sx
        group_ty = (canvas[1] - raw_h * group_sy) / 2 - min_y * group_sy
    else:
        group_sx = group_sy = 1
        group_tx = group_ty = 0

    for item in placed:
        result = glyph_path(item["char"])
        if not result:
            continue
        commands, glyph_name = result
        glyph = GLYF[glyph_name]
        if glyph.isComposite():
            glyph.recalcBounds(GLYF)
        x_min = getattr(glyph, "xMin", 0)
        x_max = getattr(glyph, "xMax", 0)
        y_min = getattr(glyph, "yMin", 0)
        y_max = getattr(glyph, "yMax", 0)
        scale = item["font"].size / UNITS_PER_EM
        sx = item["sx"]
        sy = item["sy"]
        width = (x_max - x_min) * scale
        height = (y_max - y_min) * scale
        tx = item["left"] + item["width"] / 2 - width / 2 - x_min * scale
        ty = item["top"] + item["height"] / 2 - height / 2 + y_max * scale
        cx = item["left"] + item["width"] / 2
        cy = item["top"] + item["height"] / 2
        paths.append(
            f'<path d="{commands}" transform="rotate({item["angle"]:.3f} {cx:.3f} {cy:.3f}) translate({tx:.3f} {ty:.3f}) scale({(scale * sx):.6f} {(-scale * sy):.6f})" />'
        )
    svg = "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas[0]}" height="{canvas[1]}" viewBox="0 0 {canvas[0]} {canvas[1]}">',
            f'<g fill="#231713" transform="translate({group_tx:.3f} {group_ty:.3f}) scale({group_sx:.6f} {group_sy:.6f})">',
            *paths,
            "</g>",
            "</svg>",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    lines = [line.strip() for line in request["lines"] if line.strip()]
    specs = variant_specs(lines)
    out = Path(args.out)
    for name, spec in specs.items():
        draw_variant((3600, 2700), spec, out / "\u6a2a" / f"{name}.png")
        write_svg((3600, 2700), spec, out / "\u6a2a" / f"{name}.svg")
        draw_variant((2700, 3600), spec, out / "\u7e26" / f"{name}.png")
        write_svg((2700, 3600), spec, out / "\u7e26" / f"{name}.svg")


if __name__ == "__main__":
    main()

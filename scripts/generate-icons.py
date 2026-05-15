#!/usr/bin/env python3
"""Quickstart Copilot icon generator.

Generates 16x16, 48x48, and 128x128 PNGs into icons/. The look is a calm
modern IDE accent: slightly desaturated cyan-violet gradient with a white
"QC" wordmark for >=48px and a single rounded "Q" glyph for 16px.

Re-runnable; overwrites the existing icons in place.
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ICONS_DIR = Path(__file__).resolve().parent.parent / "icons"


def grad(size: int) -> Image.Image:
    """A subtle two-stop diagonal gradient: top-left cyan -> bottom-right violet."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    c1 = (94, 234, 212)   # teal-300
    c2 = (139, 92, 246)   # violet-500
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b, 255)
    return img


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    radius = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def find_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            try:
                return ImageFont.truetype(c, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def render(size: int, label: str) -> Image.Image:
    base = grad(size)
    base.putalpha(rounded_mask(size))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(base)

    draw = ImageDraw.Draw(canvas)
    if size >= 48:
        font_size = int(size * 0.46)
        font = find_font(font_size)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2 - bbox[0]
        y = (size - th) // 2 - bbox[1]
        draw.text((x, y), label, font=font, fill=(255, 255, 255, 240))
    else:
        font_size = int(size * 0.78)
        font = find_font(font_size)
        bbox = draw.textbbox((0, 0), "Q", font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2 - bbox[0]
        y = (size - th) // 2 - bbox[1]
        draw.text((x, y), "Q", font=font, fill=(255, 255, 255, 240))

    return canvas


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for px in (16, 48, 128):
        img = render(px, "QC")
        out = ICONS_DIR / f"icon{px}.png"
        img.save(out, "PNG", optimize=True)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()

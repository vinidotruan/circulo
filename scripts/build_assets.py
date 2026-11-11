"""Gera os ícones do app e baixa as fontes (subset latin) pra funcionar offline.

Uso: python3 scripts/build_assets.py
"""
import math
import pathlib
import re
import subprocess
import sys

from PIL import Image, ImageDraw

APP = pathlib.Path(__file__).resolve().parent.parent / "app"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

FONTS = {
    "bricolage": "Bricolage+Grotesque:opsz,wght@12..96,400..800",
    "figtree": "Figtree:wght@400..700",
}

INK = (20, 30, 58)
TRACK = (39, 50, 90)
ARC = (115, 147, 255)
KNOB = (249, 250, 253)
DISK_STOPS = [(0.0, (76, 114, 240)), (0.55, (43, 82, 222)), (1.0, (28, 60, 180))]


def curl(url: str) -> bytes:
    return subprocess.run(["curl", "-sSfL", "-A", UA, url], check=True, capture_output=True).stdout


def fetch_fonts() -> None:
    (APP / "fonts").mkdir(parents=True, exist_ok=True)
    for name, family in FONTS.items():
        css = curl(f"https://fonts.googleapis.com/css2?family={family}&display=swap").decode()
        blocks = re.findall(r"/\*\s*latin\s*\*/\s*@font-face\s*\{([^}]*)\}", css)
        if not blocks:
            sys.exit(f"subset latin não encontrado pra {name}")
        url = re.search(r"url\((https://[^)]+\.woff2)\)", blocks[0]).group(1)
        data = curl(url)
        (APP / "fonts" / f"{name}.woff2").write_bytes(data)
        print(f"fonte {name}: {len(data) // 1024} KB")


def ramp(v: int):
    t = v / 255
    for (t0, c0), (t1, c1) in zip(DISK_STOPS, DISK_STOPS[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
    return DISK_STOPS[-1][1]


def gradient_disk(d: int) -> Image.Image:
    # gradiente radial com o ponto de luz no alto à esquerda, como o disco do app
    grad = Image.radial_gradient("L").resize((d * 2, d * 2))
    ox, oy = int(d - 0.32 * d), int(d - 0.28 * d)
    grad = grad.crop((ox, oy, ox + d, oy + d))
    lut = [ramp(v) for v in range(256)]
    rgb = [grad.point([lut[v][ch] for v in range(256)]) for ch in range(3)]
    return Image.merge("RGB", rgb)


def render(size: int, k: float) -> Image.Image:
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    c = size / 2
    r = k * size
    w = r * 0.2
    box = [c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2]
    d.ellipse(box, outline=TRACK, width=int(w))
    d.arc(box, start=-90, end=180, fill=ARC, width=int(w))
    for ang in (-90, 180):  # pontas arredondadas do arco
        x = c + r * math.cos(math.radians(ang))
        y = c + r * math.sin(math.radians(ang))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ARC)
    x = c + r * math.cos(math.radians(180))
    y = c + r * math.sin(math.radians(180))
    kr = w * 0.62
    d.ellipse([x - kr, y - kr, x + kr, y + kr], fill=KNOB)
    dd = int(r * 0.74 * 2)
    mask = Image.new("L", (dd, dd), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, dd - 1, dd - 1], fill=255)
    img.paste(gradient_disk(dd), (int(c - dd / 2), int(c - dd / 2)), mask)
    return img


def build_icons() -> None:
    out = APP / "icons"
    out.mkdir(parents=True, exist_ok=True)
    big = render(2048, 0.34)
    for name, px in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        big.resize((px, px), Image.LANCZOS).save(out / name, optimize=True)
    # maskable: conteúdo dentro da zona segura (círculo central de 80%)
    render(2048, 0.27).resize((512, 512), Image.LANCZOS).save(out / "icon-maskable-512.png", optimize=True)
    print("ícones:", ", ".join(sorted(p.name for p in out.iterdir())))


if __name__ == "__main__":
    fetch_fonts()
    build_icons()

"""App icons for the installable web app: an orange ring (a loop eating its own tail) on dark."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

def icon(size, maskable=False):
    s = size * 4
    im = Image.new('RGB', (s, s), (13, 13, 15))
    d = ImageDraw.Draw(im)
    r = s * (0.30 if maskable else 0.38); c = s / 2; w = s * (0.09 if maskable else 0.11)
    box = (c - r, c - r, c + r, c + r)
    d.arc(box, 300, 250, fill=(255, 145, 0), width=int(w))          # the ring, open at the top right
    # the head: a dot where the ring starts, the tail end tapering in front of it
    import math
    a = math.radians(300); hx, hy = c + r * math.cos(a), c + r * math.sin(a)
    d.ellipse((hx - w * 0.85, hy - w * 0.85, hx + w * 0.85, hy + w * 0.85), fill=(255, 145, 0))
    d.ellipse((hx - w * 0.22 + w * 0.15, hy - w * 0.22 - w * 0.2, hx + w * 0.22 + w * 0.15, hy + w * 0.22 - w * 0.2), fill=(13, 13, 15))
    # a red record dot in the middle
    rr = s * 0.07
    d.ellipse((c - rr, c - rr, c + rr, c + rr), fill=(255, 59, 48))
    return im.resize((size, size), Image.LANCZOS)

out = Path(sys.argv[1])
for n in (192, 512):
    icon(n).save(out / f'icon-{n}.png')
icon(512, True).save(out / 'icon-maskable.png')

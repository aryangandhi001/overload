"""Generate the PWA icon set. Re-run after changing the design.
   Palette is taken from the app's own CSS variables: the plate colours."""
from PIL import Image, ImageDraw
import os

BG    = (20, 23, 28)      # --bg   #14171C
BAR   = (139, 148, 163)   # --mute #8B94A3
BLUE  = (59, 125, 221)    # --blue #3B7DDD  (20 kg plate)
RED   = (216, 65, 63)     # --red  #D8413F  (25 kg plate)

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

def barbell(size, inset):
    """inset: fraction of the canvas kept clear at the edges.
       Maskable icons need 0.20 so nothing important is cropped by the circle mask."""
    S = size * 8                       # supersample, then downscale for clean edges
    im = Image.new('RGBA', (S, S), BG + (255,))
    d  = ImageDraw.Draw(im)
    cx = cy = S / 2
    half = (S / 2) * (1 - inset)       # usable half-width
    r  = lambda x, y, w, h, c, rad: d.rounded_rectangle(
            [cx + x - w/2, cy + y - h/2, cx + x + w/2, cy + y + h/2], rad, fill=c)

    barh = half * 0.115
    r(0, 0, half * 2.00, barh, BAR, barh / 2)               # the bar
    for sgn in (-1, 1):
        r(sgn * half * 0.80, 0, half * 0.26, half * 1.40, BLUE, half * 0.09)  # outer 20 kg
        r(sgn * half * 0.46, 0, half * 0.24, half * 1.00, RED,  half * 0.08)  # inner 25 kg
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
for name, size, inset in [
    ('icon-192.png',           192, 0.14),
    ('icon-512.png',           512, 0.14),
    ('icon-maskable-512.png',  512, 0.26),   # 20% safe zone + margin
    ('apple-touch-icon.png',   180, 0.14),
]:
    p = os.path.join(OUT, name)
    barbell(size, inset).save(p, optimize=True)
    print(f"{name:26s} {os.path.getsize(p):>6d} B")

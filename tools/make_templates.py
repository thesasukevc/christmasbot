#!/usr/bin/env python3
"""
Generates the blank New Year templates for EVERY language found in ./locales/*.json
  -> assets/template1_<lang>.jpg ... template4_<lang>.jpg

Run:  python tools/make_templates.py      (needs: pip install pillow numpy)
Card wording comes from the "card" section of each locales/<lang>.json file.
The name area is left EMPTY - the bot writes the name there.
"""
import glob, json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
K = 2  # supersampling factor (draw big, downscale = smooth edges)

HERE = os.path.dirname(os.path.abspath(__file__))
FD = os.path.join(HERE, "fonts")
FONTS = {
    "serif_b":  os.path.join(FD, "FreeSerifBold.ttf"),
    "serif_bi": os.path.join(FD, "FreeSerifBoldItalic.ttf"),
    "serif_i":  os.path.join(FD, "FreeSerifItalic.ttf"),
    "serif":    os.path.join(FD, "FreeSerif.ttf"),
}
LOCALES_DIR = os.path.join(HERE, "..", "locales")


def font(key, size):
    return ImageFont.truetype(FONTS[key], int(size * K))


def vgrad(w, h, stops):
    ys = np.linspace(0, 1, h * K)
    arr = np.zeros((h * K, w * K, 3), dtype=np.float32)
    for c in range(3):
        col = np.interp(ys, [s[0] for s in stops], [s[1][c] for s in stops])
        arr[:, :, c] = col[:, None]
    return Image.fromarray(arr.astype("uint8"), "RGB")


def rgrad(w, h, stops):
    ys, xs = np.mgrid[0:h * K, 0:w * K].astype(np.float32)
    d = np.sqrt(((xs - w * K / 2) / (w * K / 2)) ** 2 + ((ys - h * K / 2) / (h * K / 2)) ** 2) / 1.35
    arr = np.zeros((h * K, w * K, 3), dtype=np.float32)
    for c in range(3):
        arr[:, :, c] = np.interp(d, [s[0] for s in stops], [s[1][c] for s in stops])
    return Image.fromarray(arr.astype("uint8"), "RGB")


def A(rgb, a=255):
    return tuple(rgb) + (a,)


class Art:
    def __init__(self, w, h, bg):
        self.w, self.h, self.img = w, h, bg
        self.d = ImageDraw.Draw(self.img, "RGBA")

    def P(self, pts):
        return [(x * K, y * K) for x, y in pts]

    def ellipse(self, cx, cy, rx, ry=None, fill=None, outline=None, width=1):
        ry = rx if ry is None else ry
        self.d.ellipse([(cx - rx) * K, (cy - ry) * K, (cx + rx) * K, (cy + ry) * K],
                       fill=fill, outline=outline, width=max(1, int(width * K)))

    def poly(self, pts, fill=None, outline=None, width=1):
        self.d.polygon(self.P(pts), fill=fill, outline=outline, width=max(1, int(width * K)))

    def line(self, pts, fill, width=1):
        self.d.line(self.P(pts), fill=fill, width=max(1, int(width * K)), joint="curve")

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, width=1, radius=0):
        box = [x0 * K, y0 * K, x1 * K, y1 * K]
        if radius:
            self.d.rounded_rectangle(box, radius * K, fill=fill, outline=outline, width=max(1, int(width * K)))
        else:
            self.d.rectangle(box, fill=fill, outline=outline, width=max(1, int(width * K)))

    def text(self, x, y, s, fk, size, fill, spacing=0, shadow=None, maxw=None):
        if maxw:  # shrink the font until the text fits (long translations)
            while size > 14:
                f = font(fk, size)
                tw = (sum(f.getlength(ch) for ch in s) + spacing * K * (len(s) - 1)) if spacing else f.getlength(s)
                if tw <= maxw * K:
                    break
                size -= 2
        f = font(fk, size)
        if spacing == 0:
            if shadow:
                dx, dy, col = shadow
                self.d.text(((x + dx) * K, (y + dy) * K), s, font=f, fill=col, anchor="mm")
            self.d.text((x * K, y * K), s, font=f, fill=fill, anchor="mm")
            return
        widths = [f.getlength(ch) for ch in s]
        total = sum(widths) + spacing * K * (len(s) - 1)
        cx = x * K - total / 2
        for ch, wd in zip(s, widths):
            if shadow:
                dx, dy, col = shadow
                self.d.text((cx + dx * K, y * K + dy * K), ch, font=f, fill=col, anchor="lm")
            self.d.text((cx, y * K), ch, font=f, fill=fill, anchor="lm")
            cx += wd + spacing * K

    # ---------- decorative primitives ----------
    def snowflake(self, cx, cy, r, color, width=3):
        for k in range(6):
            ang = math.radians(60 * k)
            ux, uy = math.cos(ang), math.sin(ang)
            self.line([(cx, cy), (cx + ux * r, cy + uy * r)], color, width)
            for frac, bl in ((0.5, 0.32), (0.75, 0.22)):
                bx, by = cx + ux * r * frac, cy + uy * r * frac
                for s in (-1, 1):
                    a2 = ang + s * math.radians(50)
                    self.line([(bx, by), (bx + math.cos(a2) * r * bl, by + math.sin(a2) * r * bl)], color, width)

    def star(self, cx, cy, r, fill, rot=-90):
        pts = []
        for i in range(10):
            rr = r if i % 2 == 0 else r * 0.42
            a = math.radians(rot + i * 36)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.poly(pts, fill=fill)

    def sparkle(self, cx, cy, r, fill):
        pts = []
        for i in range(8):
            rr = r if i % 2 == 0 else r * 0.22
            a = math.radians(i * 45 - 90)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.poly(pts, fill=fill)

    def leaf(self, cx, cy, dx, dy, length, width, fill, vein):
        ang = math.atan2(dy, dx)
        pts_top, pts_bot = [], []
        n = 28
        for i in range(n + 1):
            t = math.pi * i / n
            u = length * i / n
            w = width * math.sin(t) * (1 + 0.18 * math.sin(7 * t))
            pts_top.append((u, w))
            pts_bot.append((u, -w))
        pts = pts_top + pts_bot[::-1]
        ca, sa = math.cos(ang), math.sin(ang)
        out = [(cx + u * ca - v * sa, cy + u * sa + v * ca) for u, v in pts]
        self.poly(out, fill=fill)
        self.line([(cx, cy), (cx + length * 0.9 * ca, cy + length * 0.9 * sa)], vein, 2)

    def holly(self, cx, cy, sx, sy, scale=1.0):
        green, vein = A((24, 100, 52)), A((10, 60, 30))
        for deg, ln in ((8, 130), (46, 150), (84, 130)):
            a = math.radians(deg)
            self.leaf(cx, cy, sx * math.cos(a), sy * math.sin(a), ln * scale, 28 * scale, green, vein)
        for ox, oy in ((0, 0), (16, -8), (-6, 16)):
            self.ellipse(cx + ox * scale, cy + oy * scale, 15 * scale, fill=A((178, 28, 36)),
                         outline=A((110, 10, 20)), width=2)
            self.ellipse(cx + (ox - 5) * scale, cy + (oy - 5) * scale, 4 * scale, fill=A((255, 255, 255), 200))

    def bauble(self, cx, cy, r, color, hang_from=0):
        dark = tuple(max(0, int(c * 0.65)) for c in color)
        self.line([(cx, hang_from), (cx, cy - r - 14)], A((190, 160, 60)), 3)
        self.rect(cx - 12, cy - r - 18, cx + 12, cy - r + 2, fill=A((215, 175, 55)), radius=4)
        self.ellipse(cx, cy, r, fill=A(color), outline=A(dark), width=3)
        self.ellipse(cx + r * 0.12, cy + r * 0.15, r * 0.78, fill=A(dark, 70))
        self.ellipse(cx - r * 0.18, cy - r * 0.2, r * 0.62, fill=A((255, 255, 255), 55))
        self.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.2, r * 0.13, fill=A((255, 255, 255), 215))
        self.line([(cx - r * 0.95, cy), (cx + r * 0.95, cy)], A((255, 230, 140), 150), 4)

    def fir(self, cx, base_y, h, w, body, snow=(245, 250, 255), topstar=False):
        trunk_h = h * 0.1
        self.rect(cx - w * 0.06, base_y - trunk_h, cx + w * 0.06, base_y, fill=A((90, 55, 30)))
        bh = h - trunk_h
        ytop = base_y - trunk_h - bh
        for i in range(3):
            top = ytop + i * bh * 0.27
            bot = ytop + bh * (0.46 + i * 0.27)
            hw = w / 2 * (0.55 + 0.225 * i)
            self.poly([(cx, top), (cx - hw, bot), (cx + hw, bot)], fill=A(body))
            mid = top + (bot - top) * 0.5
            self.poly([(cx, top), (cx - hw * 0.5, mid), (cx - hw * 0.22, mid - (bot - top) * 0.07),
                       (cx, mid + (bot - top) * 0.04), (cx + hw * 0.22, mid - (bot - top) * 0.07),
                       (cx + hw * 0.5, mid)], fill=A(snow))
        if topstar:
            self.star(cx, ytop - 6, w * 0.09, A((255, 214, 90)))

    def wave(self, base, amp, period, color, phase=0.0):
        pts = [(x, base + amp * math.sin(x / period * 2 * math.pi + phase)) for x in range(0, self.w + 20, 20)]
        pts += [(self.w, self.h), (0, self.h)]
        self.poly(pts, fill=color)

    def save(self, name):
        out = self.img.resize((self.w, self.h), Image.LANCZOS)
        os.makedirs(OUT, exist_ok=True)
        out.save(os.path.join(OUT, name), "JPEG", quality=93, subsampling=0)
        print("saved", name, out.size)


# =====================================================================
# 1) Certificate (A4 landscape)
# =====================================================================
def make_certificate(T, lang):
    W, H = 1754, 1240
    GREEN, GOLD, RED, INK = (20, 83, 45), (201, 162, 39), (155, 28, 28), (60, 40, 30)
    a = Art(W, H, vgrad(W, H, [(0, (255, 250, 236)), (1, (246, 230, 194))]))

    a.snowflake(W / 2, H / 2 + 10, 360, A(GREEN, 16), 7)           # faint watermark

    a.rect(40, 40, W - 40, H - 40, outline=A(GREEN), width=14)
    a.rect(70, 70, W - 70, H - 70, outline=A(GOLD), width=5)
    a.rect(88, 88, W - 88, H - 88, outline=A(RED), width=2)
    for (cx, cy, sx, sy) in ((118, 118, 1, 1), (W - 118, 118, -1, 1), (118, H - 118, 1, -1), (W - 118, H - 118, -1, -1)):
        a.holly(cx, cy, sx, sy)

    # top ornament
    a.star(W / 2, 168, 30, A(GOLD))
    for s in (-1, 1):
        a.sparkle(W / 2 + s * 85, 168, 15, A(GOLD))
        a.line([(W / 2 + s * 130, 168), (W / 2 + s * 360, 168)], A(GOLD), 3)
        a.ellipse(W / 2 + s * 372, 168, 7, fill=A(RED))

    a.text(W / 2, 285, T["cert_title"], "serif_b", 150, A(GREEN), spacing=16, shadow=(3, 4, A(GOLD, 90)), maxw=1250)
    a.text(W / 2, 395, T["cert_sub"], "serif_b", 46, A(RED), spacing=10, maxw=1100)
    a.text(W / 2, 508, T["cert_presented"], "serif_i", 54, A(INK), maxw=1250)

    # name line (name is written here by the bot, centered at y=640)
    a.line([(430, 735), (W - 430, 735)], A(GOLD), 4)
    a.poly([(W / 2, 721), (W / 2 + 14, 735), (W / 2, 749), (W / 2 - 14, 735)], fill=A(RED))

    a.text(W / 2, 835, T["cert_l1"], "serif_i", 48, A(INK), maxw=1250)
    a.text(W / 2, 895, T["cert_l2"], "serif_i", 48, A(INK), maxw=1250)

    # bottom: date / seal / signature
    for cx, txt, lab, fk, sz in ((450, T["cert_date"], T["cert_date_label"], "serif_i", 48),
                                 (W - 450, T["cert_sign"], T["cert_sign_label"], "serif_bi", 54)):
        a.text(cx, 1030, txt, fk, sz, A(INK), maxw=270)
        a.line([(cx - 140, 1066), (cx + 140, 1066)], A(INK, 200), 3)
        a.text(cx, 1098, lab, "serif", 34, A(INK, 190), maxw=270)

    sx, sy = W / 2, 1010
    a.poly([(sx - 50, sy + 40), (sx - 90, sy + 135), (sx - 50, sy + 118), (sx - 20, sy + 140), (sx - 6, sy + 50)], fill=A((170, 30, 40)))
    a.poly([(sx + 50, sy + 40), (sx + 90, sy + 135), (sx + 50, sy + 118), (sx + 20, sy + 140), (sx + 6, sy + 50)], fill=A((140, 20, 30)))
    scallop = [(sx + 92 * (1 + 0.055 * math.cos(24 * t)) * math.cos(t),
                sy + 92 * (1 + 0.055 * math.cos(24 * t)) * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 240)]
    a.poly(scallop, fill=A((212, 170, 48)), outline=A((150, 110, 20)), width=3)
    a.ellipse(sx, sy, 68, fill=A((236, 200, 90)), outline=A((150, 110, 20)), width=3)
    a.ellipse(sx, sy, 56, outline=A((150, 110, 20), 200), width=2)
    a.star(sx, sy, 40, A((165, 30, 38)))
    a.save(f"template1_{lang}.jpg")


# =====================================================================
# 2) Night sky greeting (portrait)
# =====================================================================
def make_night(T, lang):
    W, H = 1200, 1600
    rnd = random.Random(7)
    a = Art(W, H, vgrad(W, H, [(0, (8, 16, 62)), (0.5, (22, 60, 138)), (1, (98, 152, 222))]))
    for _ in range(170):
        a.ellipse(rnd.uniform(0, W), rnd.uniform(0, H * 0.62), rnd.uniform(0.8, 2.8), fill=A((255, 255, 255), rnd.randint(110, 230)))
    for _ in range(40):
        x, y = rnd.uniform(40, W - 40), rnd.uniform(30, H * 0.5)
        if 100 < x < 1100 and 230 < y < 1010:     # keep text areas clean
            continue
        a.sparkle(x, y, rnd.uniform(9, 22), A((255, 236, 170), 225))
    for i in range(9):                                            # moon + glow
        a.ellipse(1020, 105, 56 + i * 13, fill=A((255, 247, 214), max(4, 30 - i * 3)))
    a.ellipse(1020, 105, 56, fill=A((255, 248, 220)))
    for ox, oy, rr in ((-14, -10, 11), (16, 12, 15), (-6, 24, 8)):
        a.ellipse(1020 + ox, 105 + oy, rr, fill=A((225, 215, 180), 150))

    # far trees, ground, near trees
    for x, h in ((380, 230), (520, 270), (700, 250), (840, 220), (60, 260), (1140, 250)):
        a.fir(x, 1420, h, h * 0.62, (20, 70, 92), snow=(170, 200, 225))
    a.wave(1410, 14, 520, A((226, 238, 252)), 0.6)
    for x, h, w in ((110, 400, 270), (290, 310, 210), (900, 380, 250), (1080, 300, 200)):
        a.fir(x, 1465, h, w, (14, 84, 64), snow=(248, 252, 255), topstar=(h > 350))
    a.wave(1470, 12, 430, A((250, 252, 255)), 2.2)

    for _ in range(100):                                          # falling snow
        a.ellipse(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(2, 6), fill=A((255, 255, 255), rnd.randint(130, 230)))

    gold = A((255, 214, 100))
    a.text(W / 2, 300, T["night_title"], "serif_bi", 125, gold, shadow=(4, 5, A((0, 0, 40), 140)), maxw=1000)
    a.text(W / 2, 520, T["night_year"], "serif_b", 230, A((255, 255, 255)), shadow=(5, 6, A((0, 0, 40), 140)))
    a.text(W / 2, 640, T["night_label"], "serif_i", 46, A((235, 244, 255), 235), maxw=1000)
    a.rect(120, 700, 1080, 860, fill=A((6, 18, 70), 175), outline=A((238, 196, 84)), width=4, radius=40)   # name banner (name at y=780)
    a.rect(132, 712, 1068, 848, outline=A((238, 196, 84), 110), width=2, radius=30)
    a.text(W / 2, 935, T["night_l1"], "serif_i", 50, A((255, 255, 255)), maxw=1000)
    a.text(W / 2, 992, T["night_l2"], "serif_i", 50, A((255, 255, 255)), maxw=1000)
    a.save(f"template2_{lang}.jpg")


# =====================================================================
# 3) Icy-blue greeting with baubles (square)
# =====================================================================
def make_ice(T, lang):
    W, H = 1400, 1400
    rnd = random.Random(11)
    NAVY = (18, 52, 122)
    a = Art(W, H, vgrad(W, H, [(0, (234, 246, 255)), (1, (178, 212, 244))]))
    for x, y, r, al in ((110, 640, 72, 150), (1290, 560, 92, 150), (190, 1010, 60, 130), (1240, 1000, 72, 130),
                        (700, 140, 40, 90), (60, 330, 40, 110), (1340, 330, 44, 110)):
        a.snowflake(x, y, r, A((90, 150, 222), al), 4)
    for _ in range(80):
        a.ellipse(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(2, 6), fill=A((255, 255, 255), rnd.randint(150, 240)))

    for x, y, r, col in ((180, 175, 62, (200, 30, 50)), (420, 105, 48, (214, 170, 45)),
                         (980, 115, 50, (40, 90, 190)), (1220, 185, 64, (30, 130, 80))):
        a.bauble(x, y, r, col)

    for x, h, w in ((90, 300, 200), (260, 230, 160), (1140, 240, 170), (1310, 290, 200)):
        a.fir(x, 1380, h, w, (28, 110, 100), snow=(250, 253, 255))
    a.wave(1330, 14, 560, A((255, 255, 255)), 1.0)
    a.wave(1368, 10, 380, A((236, 246, 255)), 3.0)

    a.text(W / 2, 360, T["ice_title"], "serif_bi", 130, A(NAVY), shadow=(3, 4, A((255, 255, 255), 230)), maxw=1100)
    a.text(W / 2, 535, T["ice_year"], "serif_b", 170, A((205, 152, 30)), shadow=(4, 5, A((255, 255, 255), 200)))
    a.rect(150, 650, 1250, 870, fill=A((255, 255, 255), 205), outline=A((70, 125, 205)), width=5, radius=48)  # name panel (name at y=760)
    a.rect(164, 664, 1236, 856, outline=A((70, 125, 205), 120), width=2, radius=38)
    a.text(W / 2, 975, T["ice_l1"], "serif_i", 54, A(NAVY), maxw=1100)
    a.text(W / 2, 1040, T["ice_l2"], "serif_i", 54, A(NAVY), maxw=1100)
    a.save(f"template3_{lang}.jpg")


# =====================================================================
# 4) Festive red & gold greeting (landscape)
# =====================================================================
def make_red(T, lang):
    W, H = 1600, 1100
    rnd = random.Random(23)
    a = Art(W, H, rgrad(W, H, [(0, (176, 28, 38)), (0.7, (112, 12, 26)), (1, (58, 6, 16))]))
    for _ in range(70):
        col = rnd.choice([(255, 214, 110), (255, 255, 255), (255, 170, 120)])
        a.ellipse(rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(14, 70), fill=A(col, rnd.randint(14, 42)))
    for _ in range(60):
        x, y = rnd.uniform(30, W - 30), rnd.uniform(160, H - 30)
        if 200 < x < 1400 and 200 < y < 800:      # keep title / name / text clean
            continue
        a.sparkle(x, y, rnd.uniform(6, 16), A((255, 226, 150), rnd.randint(140, 230)))

    # light garland across the top
    pts = [(x, 62 + 52 * abs(math.sin(math.pi * x / (W / 4)))) for x in range(0, W + 1, 8)]
    a.line(pts, A((235, 190, 80)), 6)
    cols = [(255, 215, 90), (255, 255, 255), (130, 235, 150), (255, 130, 130)]
    for i, (x, y) in enumerate(pts[::10]):
        c = cols[i % 4]
        a.ellipse(x, y + 18, 30, fill=A(c, 50))
        a.ellipse(x, y + 18, 14, fill=A(c))
    a.bauble(110, 255, 50, (220, 190, 60), hang_from=100)
    a.bauble(1490, 275, 56, (240, 240, 240), hang_from=100)

    gold = A((255, 214, 102))
    a.text(W / 2, 285, T["red_title"], "serif_bi", 150, gold, shadow=(4, 6, A((40, 0, 8), 170)), maxw=1250)
    a.text(W / 2, 395, T["red_label"], "serif_i", 48, A((255, 238, 220), 235), maxw=1100)
    a.rect(230, 450, 1370, 670, fill=A((40, 0, 10), 120), outline=A((240, 198, 88)), width=4, radius=44)   # name panel (name at y=560)
    a.rect(244, 464, 1356, 656, outline=A((240, 198, 88), 120), width=2, radius=34)
    a.text(W / 2, 760, T["red_l1"], "serif_i", 54, A((255, 244, 230)), maxw=1350)
    a.text(W / 2, 910, T["red_year"], "serif_b", 190, gold, shadow=(5, 7, A((40, 0, 8), 170)))
    for s in (-1, 1):
        a.star(W / 2 + s * 330, 905, 46, gold)
        a.sparkle(W / 2 + s * 440, 870, 22, A((255, 226, 150)))
        a.sparkle(W / 2 + s * 250, 990, 16, A((255, 226, 150)))
    a.save(f"template4_{lang}.jpg")


def load_locales():
    langs = {}
    for path in sorted(glob.glob(os.path.join(LOCALES_DIR, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        langs[os.path.splitext(os.path.basename(path))[0]] = data["card"]
    return langs


if __name__ == "__main__":
    for lang, T in load_locales().items():
        print(f"== {lang} ==")
        make_certificate(T, lang)
        make_night(T, lang)
        make_ice(T, lang)
        make_red(T, lang)

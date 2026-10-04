# -*- coding: utf-8 -*-
"""產生網站上的觸手 SVG（web/public/art/tentacle-a.svg）。

不手描路徑：沿一條「曲率隨長度遞增」的脊線積分出中心線，再依寬度往兩側推出
輪廓，末端自然捲起來。吸盤沿著腹側按當地寬度排。改參數重跑即可：

  python web/art/tentacles.py
"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "public", "art")

BODY = "#1c2821"       # 背側
BELLY = "#4a5946"      # 腹側（比較淡）
SHEEN = "#3f5646"      # 背側的一道反光
SUCKER = "#76836a"
SUCKER_IN = "#2b3830"


def spine(length, n, theta0, curve):
    """curve(u) = 在長度比例 u 處的曲率（弧度/單位長）。回傳點與切線角。"""
    pts, ths = [(0.0, 0.0)], [theta0]
    x = y = 0.0
    th = theta0
    ds = length / n
    for i in range(n):
        u = (i + 0.5) / n
        th += curve(u) * ds
        x += math.cos(th) * ds
        y += math.sin(th) * ds
        pts.append((x, y))
        ths.append(th)
    return pts, ths


def offset(pts, ths, widths, f):
    """往法線方向推 f×寬度（f>0 背側、f<0 腹側）。"""
    out = []
    for (x, y), th, w in zip(pts, ths, widths):
        nx, ny = -math.sin(th), math.cos(th)
        out.append((x + nx * w * f, y + ny * w * f))
    return out


def smooth(poly, closed=False):
    """Catmull-Rom → 三次貝茲，讓折線變成順的曲線。"""
    p = poly
    n = len(p)
    d = f"M{p[0][0]:.1f},{p[0][1]:.1f}"
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = p[i - 1] if i > 0 or closed else p[i]
        p1, p2 = p[i], p[(i + 1) % n]
        p3 = p[(i + 2) % n] if (i + 2 < n or closed) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + (" Z" if closed else "")


def band(pts, ths, widths, f_out, f_in):
    """兩條偏移線圍成的一條帶（用來畫反光與腹側）。"""
    a = offset(pts, ths, widths, f_out)
    b = offset(pts, ths, widths, f_in)
    return smooth(a + b[::-1], closed=True)


def tentacle(name, length, n, w0, theta0, curve, taper=0.9, suck_from=0.06, suck_to=0.9, mirror=False):
    pts, ths = spine(length, n, theta0, curve)
    widths = [w0 * (1 - i / n) ** taper + 1.2 for i in range(n + 1)]
    left = offset(pts, ths, widths, 0.5)
    right = offset(pts, ths, widths, -0.5)
    outline = smooth(left + right[::-1], closed=True)

    # 吸盤：沿腹側，間距跟著寬度縮
    suckers = []
    s_acc, next_at = 0.0, 0.0
    for i in range(1, n):
        u = i / n
        seg = math.dist(pts[i - 1], pts[i])
        s_acc += seg
        if u < suck_from or u > suck_to or s_acc < next_at:
            continue
        w = widths[i]
        th = ths[i]
        nx, ny = -math.sin(th), math.cos(th)
        cx, cy = pts[i][0] - nx * w * 0.24, pts[i][1] - ny * w * 0.24
        r = w * 0.2
        deg = math.degrees(th)
        suckers.append(
            f'<g transform="translate({cx:.1f},{cy:.1f}) rotate({deg:.1f})">'
            f'<ellipse rx="{r:.1f}" ry="{r * 0.78:.1f}" fill="{SUCKER}" stroke="{SUCKER_IN}" '
            f'stroke-width="{max(0.6, r * 0.12):.1f}"/>'
            f'<ellipse rx="{r * 0.42:.1f}" ry="{r * 0.33:.1f}" fill="{SUCKER_IN}"/></g>')
        next_at = s_acc + w * 0.62

    xs = [p[0] for p in left + right]
    ys = [p[1] for p in left + right]
    pad = 22
    x0, y0 = min(xs) - pad, min(ys) - pad
    vw, vh = max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad
    # mirror：整張左右翻（根部在右邊）。在 SVG 裡翻，CSS 就不用 scale(-1)——
    # CSS 翻轉會跟旋轉共用 transform-origin，支點一偏整張圖就被甩走
    vx = -(x0 + vw) if mirror else x0
    flip_open, flip_close = ('<g transform="scale(-1 1)">', "</g>") if mirror else ("", "")

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.0f} {y0:.0f} {vw:.0f} {vh:.0f}" width="{vw:.0f}" height="{vh:.0f}">
<!-- 由 web/art/tentacles.py 產生，別手改 -->
<defs>
  <filter id="sh-{name}" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000" flood-opacity=".55"/>
  </filter>
  <filter id="soft-{name}"><feGaussianBlur stdDeviation="1.6"/></filter>
  <clipPath id="c-{name}"><path d="{outline}"/></clipPath>
  <!-- 根部淡出：切口看起來像從紙底下的陰影伸出來，不是被切斷的 -->
  <radialGradient id="fade-{name}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="{w0 * 1.9:.0f}">
    <stop offset=".25" stop-color="#000"/><stop offset="1" stop-color="#fff"/>
  </radialGradient>
  <mask id="m-{name}" maskUnits="userSpaceOnUse" x="{vx:.0f}" y="{y0:.0f}" width="{vw:.0f}" height="{vh:.0f}">
    <rect x="{vx:.0f}" y="{y0:.0f}" width="{vw:.0f}" height="{vh:.0f}" fill="url(#fade-{name})"/>
  </mask>
</defs>
<g mask="url(#m-{name})">
{flip_open}<g filter="url(#sh-{name})"><path d="{outline}" fill="{BODY}"/></g>
<g clip-path="url(#c-{name})">
  <path d="{band(pts, ths, widths, -0.6, -0.02)}" fill="{BELLY}" filter="url(#soft-{name})"/>
  <path d="{band(pts, ths, widths, 0.34, 0.14)}" fill="{SHEEN}" opacity=".75" filter="url(#soft-{name})"/>
  {"".join(suckers)}
</g>
<path d="{outline}" fill="none" stroke="#0e1511" stroke-width="1.2" opacity=".7"/>{flip_close}
</g>
</svg>
'''
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"tentacle-{name}.svg")
    open(path, "w", encoding="utf-8", newline="\n").write(svg)
    print(f"{path}  {vw:.0f}×{vh:.0f}  吸盤 {len(suckers)}")


# 大的：根部在右（藏在卡底下），往左爬，末端往上捲一圈多
tentacle("a", length=640, n=220, w0=66, theta0=math.radians(-6),
         curve=lambda u: -0.001 - 0.002 * u ** 2 - 0.080 * u ** 6, mirror=True)

#!/usr/bin/env python3
"""
BeeLingo · 蜂译 — 扩展图标生成器

设计概念：
  - 圆角方块底，蜂蜡黄 (#F5B700) 主色
  - 中间一只简笔小蜜蜂：黑色椭圆身体 + 两道黄色横纹 + 翅膀 + 触角
  - 高对比度，在 16px 缩略图也能识别

生成 16/32/48/96/128 PNG，覆盖浏览器扩展所有要求尺寸。
"""

from __future__ import annotations

import math
import os
import struct
import zlib
from pathlib import Path

# ---------- 调色板 ----------

BG_TOP = (245, 183, 0)       # #F5B700 主色
BG_BOTTOM = (212, 145, 0)    # 稍深用于渐变底部
BEE_BLACK = (28, 28, 32)     # 蜜蜂轮廓/身体
BEE_STRIPE = (245, 215, 70)  # 横纹黄（比底色亮一点保证对比）
WING = (255, 255, 255)       # 半透明白

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = [16, 32, 48, 96, 128]


# ---------- PNG 编码 ----------

def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    assert len(rgba) == width * height * 4
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter: none
        raw.extend(rgba[y * stride : (y + 1) * stride])
    compressed = zlib.compress(bytes(raw), level=9)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with path.open("wb") as f:
        f.write(sig)
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", compressed))
        f.write(png_chunk(b"IEND", b""))


# ---------- 像素合成 ----------

def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return (
        int(round(lerp(c1[0], c2[0], t))),
        int(round(lerp(c1[1], c2[1], t))),
        int(round(lerp(c1[2], c2[2], t))),
    )


def overlay(base, top, alpha):
    """alpha 0..1，把 top 用 alpha 合成到 base 上"""
    return tuple(int(round(base[i] * (1 - alpha) + top[i] * alpha)) for i in range(3))


def in_rounded_square(px: float, py: float, w: float, h: float, radius: float) -> bool:
    if px < 0 or py < 0 or px >= w or py >= h:
        return False
    # 4 个角的圆形裁剪
    cx_left, cy_top = radius, radius
    cx_right, cy_top2 = w - radius, radius
    cx_left2, cy_bot = radius, h - radius
    cx_right2, cy_bot2 = w - radius, h - radius
    if px < radius and py < radius:
        return math.hypot(px - cx_left, py - cy_top) <= radius
    if px >= w - radius and py < radius:
        return math.hypot(px - cx_right, py - cy_top2) <= radius
    if px < radius and py >= h - radius:
        return math.hypot(px - cx_left2, py - cy_bot) <= radius
    if px >= w - radius and py >= h - radius:
        return math.hypot(px - cx_right2, py - cy_bot2) <= radius
    return True


def in_ellipse(px: float, py: float, cx: float, cy: float, rx: float, ry: float) -> bool:
    if rx <= 0 or ry <= 0:
        return False
    dx = (px - cx) / rx
    dy = (py - cy) / ry
    return dx * dx + dy * dy <= 1.0


def antialias_edge(dist: float) -> float:
    """dist<=0 内, dist>=1 外; 返回 alpha 0..1 用于边缘 AA"""
    if dist <= 0:
        return 1.0
    if dist >= 1:
        return 0.0
    # smoothstep
    t = 1 - dist
    return t * t * (3 - 2 * t)


def render(size: int) -> bytes:
    w = h = size
    rgba = bytearray(w * h * 4)

    # 圆角半径（按尺寸缩放，保持 22% 视觉）
    r = max(1.0, size * 0.22)
    # 蜜蜂身体参数
    body_cx = w / 2
    body_cy = h * 0.58  # 偏下
    body_rx = w * 0.30
    body_ry = h * 0.36
    stripe_thickness = max(1.0, h * 0.06)
    head_radius = max(1.0, h * 0.12)
    head_cy = body_cy - body_ry * 0.92
    # 翅膀
    wing_rx = w * 0.20
    wing_ry = h * 0.16
    wing_offset_y = -body_ry * 0.55
    wing_offset_x = body_rx * 0.05
    # 触角
    antenna_len = h * 0.12

    bg_color_top = BG_TOP
    bg_color_bottom = BG_BOTTOM

    for y in range(h):
        for x in range(w):
            # 1. 圆角背景 + 垂直渐变
            inside = in_rounded_square(x + 0.5, y + 0.5, w, h, r)
            if not inside:
                r0 = 0
                g0 = 0
                b0 = 0
                a0 = 0
            else:
                t = y / max(1, h - 1)
                bg = lerp_rgb(bg_color_top, bg_color_bottom, t)
                cr, cg, cb = bg
                pa = 255

                # 2. 蜜蜂身体（黑色椭圆）
                in_body = in_ellipse(x + 0.5, y + 0.5, body_cx, body_cy, body_rx, body_ry)

                # 3. 黄色横纹（两条带子，靠在身体内的相对 y 比例）
                # 带子覆盖身体宽度的中间 60%，位于身体高度 60%~70% 和 35%~45%
                in_stripe_1 = False
                in_stripe_2 = False
                if in_body:
                    norm_y = (y + 0.5 - body_cy) / body_ry  # -1..1
                    if -0.55 <= norm_y <= -0.40:
                        in_stripe_1 = True
                    if 0.10 <= norm_y <= 0.25:
                        in_stripe_2 = True

                # 4. 头（小圆）
                head_dx = x + 0.5 - body_cx
                head_dy = y + 0.5 - head_cy
                in_head = head_dx * head_dx + head_dy * head_dy <= head_radius * head_radius

                # 5. 翅膀（左上和右上，半透明白）
                wing1_cx = body_cx - body_rx * 0.35
                wing1_cy = body_cy + wing_offset_y
                wing2_cx = body_cx + body_rx * 0.35
                wing2_cy = body_cy + wing_offset_y
                in_wing1 = in_ellipse(x + 0.5, y + 0.5, wing1_cx, wing1_cy, wing_rx, wing_ry)
                in_wing2 = in_ellipse(x + 0.5, y + 0.5, wing2_cx, wing2_cy, wing_rx, wing_ry)

                # 6. 触角（两条短直线 + 小圆点）
                antenna_alpha = 0
                # 触角起点：头部顶端的左右两侧
                antenna_origin_l = (body_cx - head_radius * 0.55, head_cy - head_radius * 0.85)
                antenna_origin_r = (body_cx + head_radius * 0.55, head_cy - head_radius * 0.85)
                # 触角终点：向上向外延伸
                antenna_end_l = (antenna_origin_l[0] - antenna_len * 0.35, antenna_origin_l[1] - antenna_len)
                antenna_end_r = (antenna_origin_r[0] + antenna_len * 0.35, antenna_origin_r[1] - antenna_len)
                antenna_thickness = max(1.0, h * 0.020)
                # 点到线段距离（线段宽度 antenna_thickness）
                px_pos = x + 0.5
                py_pos = y + 0.5
                d_l = _dist_to_segment(px_pos, py_pos, antenna_origin_l, antenna_end_l)
                d_r = _dist_to_segment(px_pos, py_pos, antenna_origin_r, antenna_end_r)
                antenna_l_hit = d_l <= antenna_thickness
                antenna_r_hit = d_r <= antenna_thickness

                # 触角顶端的小圆点
                tip_radius = max(1.0, h * 0.028)
                in_tip_l = math.hypot(px_pos - antenna_end_l[0], py_pos - antenna_end_l[1]) <= tip_radius
                in_tip_r = math.hypot(px_pos - antenna_end_r[0], py_pos - antenna_end_r[1]) <= tip_radius

                # 合成顺序（从底向上）：背景 → 翅膀 → 身体 → 横纹（覆盖身体）→ 头 → 触角
                if in_wing1 or in_wing2:
                    cr, cg, cb = overlay((cr, cg, cb), WING, 0.78)
                if in_body:
                    cr, cg, cb = BEE_BLACK
                if in_stripe_1 or in_stripe_2:
                    cr, cg, cb = BEE_STRIPE
                if in_head:
                    cr, cg, cb = BEE_BLACK
                if antenna_l_hit or antenna_r_hit or in_tip_l or in_tip_r:
                    cr, cg, cb = BEE_BLACK

                px_out = cr
                g_out = cg
                b_out = cb
                pa = 255

            idx = (y * w + x) * 4
            rgba[idx + 0] = r0 if not inside else px_out
            rgba[idx + 1] = g0 if not inside else g_out
            rgba[idx + 2] = b0 if not inside else b_out
            rgba[idx + 3] = a0 if not inside else pa

    return bytes(rgba)


def _dist_to_segment(px: float, py: float, a, b) -> float:
    ax, ay = a
    bx, by = b
    dx = bx - ax
    dy = by - ay
    len_sq = dx * dx + dy * dy
    if len_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    qx = ax + t * dx
    qy = ay + t * dy
    return math.hypot(px - qx, py - qy)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        pixels = render(size)
        path = OUT_DIR / f"icon-{size}.png"
        write_png(path, size, size, pixels)
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent)} ({size}x{size})")


if __name__ == "__main__":
    main()
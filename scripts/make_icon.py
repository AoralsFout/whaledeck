"""生成应用图标源图（assets/icon-source.png）。

开发期一次性脚本，不参与运行时；输出 1024×1024 PNG，供 Tauri 图标生成使用。
对应文档：docs/工程规范.md「环境与命令」。
"""
from PIL import Image, ImageDraw, ImageFilter

S = 1024
K = 2  # 先放大绘制再缩小，得到平滑边缘
W = S * K


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# 背景：深海渐变
bg = Image.new("RGB", (W, W))
bd = ImageDraw.Draw(bg)
for y in range(W):
    t = y / W
    bd.line([(0, y), (W, y)], fill=lerp((9, 15, 34), (17, 34, 66), t))

mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=232 * K, fill=255)
img.paste(bg, (0, 0), mask)

# 气泡装饰
bubbles = [(190, 200, 26, 70), (830, 250, 18, 55), (140, 800, 20, 60), (870, 790, 14, 45), (300, 130, 9, 40)]
for x, y, r, a in bubbles:
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [(x - r) * K, (y - r) * K, (x + r) * K, (y + r) * K], fill=(96, 205, 235, a)
    )
    img = Image.alpha_composite(img, layer)

whale = Image.new("RGBA", (W, W), (0, 0, 0, 0))
wd = ImageDraw.Draw(whale)

# 尾鳍（左侧）
wd.polygon(
    [(205 * K, 600 * K), (60 * K, 470 * K), (78 * K, 640 * K), (28 * K, 700 * K), (165 * K, 740 * K)],
    fill=(58, 186, 214, 255),
)
# 背鳍
wd.polygon(
    [(520 * K, 412 * K), (438 * K, 288 * K), (600 * K, 405 * K)],
    fill=(58, 186, 214, 255),
)
# 身体
wd.ellipse([180 * K, 400 * K, 820 * K, 770 * K], fill=(79, 214, 232, 255))
# 肚子
wd.ellipse([250 * K, 585 * K, 760 * K, 766 * K], fill=(216, 246, 252, 255))

# 腮红
blush = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(blush).ellipse(
    [615 * K, 590 * K, 715 * K, 650 * K], fill=(255, 158, 199, 165)
)
whale = Image.alpha_composite(whale, blush)

# 眼睛
wd = ImageDraw.Draw(whale)
wd.ellipse([690 * K, 495 * K, 755 * K, 560 * K], fill=(9, 28, 48, 255))
wd.ellipse([706 * K, 508 * K, 730 * K, 532 * K], fill=(255, 255, 255, 255))
wd.ellipse([714 * K, 516 * K, 724 * K, 526 * K], fill=(9, 28, 48, 255))

# 嘴
wd.arc([700 * K, 560 * K, 790 * K, 620 * K], start=15, end=95, fill=(9, 28, 48, 220), width=7 * K)

# 喷水
fw = 6 * K
for i, (x, y, r) in enumerate([(690, 350, 22), (720, 300, 16), (748, 250, 11)]):
    wd.ellipse([(x - r) * K, (y - r) * K, (x + r) * K, (y + r) * K], fill=(150, 230, 248, 220))
wd.line([(660 * K, 400 * K), (690 * K, 355 * K)], fill=(150, 230, 248, 220), width=fw)
wd.line([(690 * K, 355 * K), (722 * K, 302 * K)], fill=(150, 230, 248, 200), width=fw)
wd.line([(722 * K, 302 * K), (750 * K, 252 * K)], fill=(150, 230, 248, 180), width=fw)

img = Image.alpha_composite(img, whale)
img = img.resize((S, S), Image.LANCZOS)
img = img.filter(ImageFilter.SMOOTH)

img.save("assets/icon-source.png")
print("icon written: assets/icon-source.png")

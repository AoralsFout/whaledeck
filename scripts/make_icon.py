"""旧图标生成入口的兼容包装，不再绘制旧版鲸鱼。

调用统一的 Tauri 图标生成脚本；对应文档：docs/工程规范.md「品牌资源与图标生成」。
"""
import shutil
import subprocess
from pathlib import Path


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    node = shutil.which("node")
    if node is None:
        raise SystemExit("请先安装 Node.js，再运行 pnpm icons。")
    raise SystemExit(subprocess.call([node, str(root / "scripts/generate-icons.mjs")], cwd=root))

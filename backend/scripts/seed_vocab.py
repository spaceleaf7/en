"""导入示例词库：读取 shared/seed-roots.json（由前端 src/mock/roots.ts 导出）。

用法（在 backend 目录）：
    uv run python -m scripts.seed_vocab            # 词库为空时导入
    uv run python -m scripts.seed_vocab --force    # 已有词库也追加导入
"""

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import func, select

from app import models
from app.core.database import SessionLocal
from app.schemas import RootIn

SEED_FILE = Path(__file__).resolve().parents[2] / "shared" / "seed-roots.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="词库非空时仍追加导入")
    args = parser.parse_args()

    roots = [RootIn.model_validate(r) for r in json.loads(SEED_FILE.read_text(encoding="utf-8"))]

    with SessionLocal() as db:
        existing = db.scalar(select(func.count()).select_from(models.Root)) or 0
        if existing and not args.force:
            print(f"词库已有 {existing} 个词根，跳过。如需追加请加 --force")
            return 0
        for i, r in enumerate(roots):
            root = models.Root(root_text=r.root_text, meaning=r.meaning, sort_order=r.sort_order or i)
            root.words = [models.Word(**w.model_dump()) for w in r.words]
            db.add(root)
        db.commit()
    print(f"已导入 {len(roots)} 个词根、{sum(len(r.words) for r in roots)} 个单词")
    return 0


if __name__ == "__main__":
    sys.exit(main())

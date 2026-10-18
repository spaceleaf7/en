#!/bin/sh
set -e

# 每次启动先迁移到最新表结构；词库为空时导入示例词库（非空会自动跳过）
alembic upgrade head
python -m scripts.seed_vocab

exec "$@"

import sys

from sqlalchemy import func, select

from app import models
from scripts import seed_vocab


def test_seed_file_imports(monkeypatch, db):
    # 种子脚本使用的 SessionLocal 指向测试库
    from conftest import TestSession

    monkeypatch.setattr(seed_vocab, "SessionLocal", TestSession)
    monkeypatch.setattr(sys, "argv", ["seed_vocab"])
    assert seed_vocab.main() == 0
    assert db.scalar(select(func.count()).select_from(models.Root)) == 3
    assert db.scalar(select(func.count()).select_from(models.Word)) == 11

    # 再次执行：词库非空时跳过
    assert seed_vocab.main() == 0
    assert db.scalar(select(func.count()).select_from(models.Root)) == 3

    visible = db.scalar(select(models.Word).where(models.Word.word == "visible"))
    assert visible.phonetic == "/ˈvɪzəbl/"
    assert visible.chinese_meaning == "adj. 可见的；明显的"

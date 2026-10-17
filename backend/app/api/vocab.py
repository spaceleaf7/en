"""词库：所有登录用户可读，管理员可增删改与批量导入"""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from app import models, schemas
from app.api.deps import AdminUser, CurrentUser, DbSession

router = APIRouter(prefix="/vocab", tags=["词库"])


def _get_root(db: DbSession, root_id: int) -> models.Root:
    root = db.scalar(
        select(models.Root).where(models.Root.id == root_id).options(selectinload(models.Root.words))
    )
    if root is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="词根不存在")
    return root


def _new_words(items: list[schemas.WordIn]) -> list[models.Word]:
    return [models.Word(**w.model_dump()) for w in items]


# ───────────────────────── 读取 ─────────────────────────


@router.get("/roots", response_model=list[schemas.RootOut])
def list_roots_full(_: CurrentUser, db: DbSession) -> list[models.Root]:
    """全部词根及其单词（前端一次性加载导图数据）"""
    return list(
        db.scalars(
            select(models.Root).options(selectinload(models.Root.words)).order_by(models.Root.sort_order, models.Root.id)
        )
    )


@router.get("/roots/brief", response_model=list[schemas.RootBrief])
def list_roots_brief(_: CurrentUser, db: DbSession) -> list[dict]:
    rows = db.execute(
        select(models.Root, func.count(models.Word.id))
        .outerjoin(models.Word)
        .group_by(models.Root.id)
        .order_by(models.Root.sort_order, models.Root.id)
    )
    return [
        {"id": r.id, "root_text": r.root_text, "meaning": r.meaning, "sort_order": r.sort_order, "word_count": n}
        for r, n in rows
    ]


@router.get("/roots/{root_id}", response_model=schemas.RootOut)
def get_root(root_id: int, _: CurrentUser, db: DbSession) -> models.Root:
    return _get_root(db, root_id)


# ───────────────────────── 管理 ─────────────────────────


@router.post("/roots", response_model=schemas.RootOut, status_code=status.HTTP_201_CREATED)
def create_root(body: schemas.RootIn, _: AdminUser, db: DbSession) -> models.Root:
    root = models.Root(root_text=body.root_text, meaning=body.meaning, sort_order=body.sort_order)
    root.words = _new_words(body.words)
    db.add(root)
    db.commit()
    return _get_root(db, root.id)


@router.patch("/roots/{root_id}", response_model=schemas.RootOut)
def update_root(root_id: int, body: schemas.RootUpdate, _: AdminUser, db: DbSession) -> models.Root:
    root = _get_root(db, root_id)
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(root, k, v)
    db.commit()
    return _get_root(db, root_id)


@router.delete("/roots/{root_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_root(root_id: int, _: AdminUser, db: DbSession) -> Response:
    root = _get_root(db, root_id)
    db.delete(root)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/roots/{root_id}/words", response_model=schemas.WordOut, status_code=status.HTTP_201_CREATED)
def create_word(root_id: int, body: schemas.WordIn, _: AdminUser, db: DbSession) -> models.Word:
    _get_root(db, root_id)
    word = models.Word(root_id=root_id, **body.model_dump())
    db.add(word)
    db.commit()
    return word


@router.patch("/words/{word_id}", response_model=schemas.WordOut)
def update_word(word_id: int, body: schemas.WordUpdate, _: AdminUser, db: DbSession) -> models.Word:
    word = db.get(models.Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="单词不存在")
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "root_id" in data:
        _get_root(db, data["root_id"])
    for k, v in data.items():
        setattr(word, k, v)
    db.commit()
    return word


@router.delete("/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(word_id: int, _: AdminUser, db: DbSession) -> Response:
    word = db.get(models.Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="单词不存在")
    db.delete(word)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/import", response_model=list[schemas.RootBrief])
def import_roots(body: schemas.ImportIn, _: AdminUser, db: DbSession) -> list[dict]:
    """批量导入。replace 会删除现有全部词库（学习记录按 word_id 保留，但旧单词将不再显示）"""
    if body.mode == "replace":
        db.execute(delete(models.Word))
        db.execute(delete(models.Root))
    for item in body.roots:
        root = models.Root(root_text=item.root_text, meaning=item.meaning, sort_order=item.sort_order)
        root.words = _new_words(item.words)
        db.add(root)
    db.commit()
    return list_roots_brief(_, db)

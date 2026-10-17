"""认证：access token 放在响应体（前端存内存），refresh token 放在 httpOnly Cookie（JS 读不到，防 XSS 窃取）"""

from datetime import timedelta

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from sqlalchemy import select, update
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app import models, schemas
from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.ratelimit import login_limiter
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    verify_password,
)
from app.models import utcnow

router = APIRouter(prefix="/auth", tags=["认证"])

REFRESH_COOKIE = "etymomind_refresh"
REFRESH_COOKIE_PATH = "/api/auth"


def _issue_tokens(db: DbSession, response: Response, user: models.User) -> schemas.TokenOut:
    s = get_settings()
    refresh = new_refresh_token()
    db.add(
        models.RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh),
            expires_at=utcnow() + timedelta(days=s.refresh_token_days),
        )
    )
    db.commit()
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=s.refresh_token_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )
    access, expires_in = create_access_token(user.id)
    return schemas.TokenOut(access_token=access, expires_in=expires_in)


def _limit_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{username.lower()}"


@router.post("/register", response_model=schemas.TokenOut, status_code=status.HTTP_201_CREATED)
def register(body: schemas.RegisterIn, db: DbSession, response: Response) -> schemas.TokenOut:
    if not get_settings().allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="当前未开放注册")
    exists = db.scalar(select(models.User.id).where(models.User.username == body.username))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="用户名已被占用")

    # 第一个注册的用户自动成为管理员，用于维护词库
    is_first = db.scalar(select(models.User.id).limit(1)) is None
    user = models.User(
        username=body.username,
        password_hash=hash_password(body.password),
        nickname=body.nickname or body.username,
        is_admin=is_first,
        timezone=get_settings().default_timezone,
    )
    db.add(user)
    db.flush()
    return _issue_tokens(db, response, user)


@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, request: Request, db: DbSession, response: Response) -> schemas.TokenOut:
    key = _limit_key(request, body.username)
    retry = login_limiter.retry_after(key)
    if retry:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"登录失败次数过多，请 {retry // 60 + 1} 分钟后再试",
            headers={"Retry-After": str(retry)},
        )

    user = db.scalar(select(models.User).where(models.User.username == body.username.strip()))
    if not verify_password(body.password, user.password_hash if user else None) or not user or not user.is_active:
        login_limiter.record_failure(key)
        # 不区分"用户不存在"与"密码错误"，避免用户名枚举
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    login_limiter.reset(key)
    return _issue_tokens(db, response, user)


@router.post("/refresh", response_model=schemas.TokenOut)
def refresh(
    db: DbSession,
    response: Response,
    token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> schemas.TokenOut:
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")
    if not token:
        raise invalid
    row = db.scalar(select(models.RefreshToken).where(models.RefreshToken.token_hash == hash_token(token)))
    if row is None:
        raise invalid

    if row.revoked_at is not None:
        # 已作废的 token 被再次使用，说明可能被盗用：作废该用户全部 token，强制重新登录
        db.execute(
            update(models.RefreshToken)
            .where(models.RefreshToken.user_id == row.user_id, models.RefreshToken.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        db.commit()
        response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
        raise invalid
    if row.expires_at <= utcnow():
        raise invalid

    user = db.get(models.User, row.user_id)
    if user is None or not user.is_active:
        raise invalid

    row.revoked_at = utcnow()  # 轮换：旧 token 立即作废
    return _issue_tokens(db, response, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: DbSession,
    response: Response,
    token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> Response:
    if token:
        db.execute(
            update(models.RefreshToken)
            .where(models.RefreshToken.token_hash == hash_token(token), models.RefreshToken.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        db.commit()
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=schemas.UserOut)
def me(user: CurrentUser) -> models.User:
    return user


@router.patch("/me", response_model=schemas.UserOut)
def update_me(body: schemas.SettingsIn, user: CurrentUser, db: DbSession) -> models.User:
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "timezone" in data:
        check_timezone(data["timezone"])
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: schemas.ChangePasswordIn, user: CurrentUser, db: DbSession, response: Response) -> Response:
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="原密码不正确")
    user.password_hash = hash_password(body.new_password)
    # 改密码后作废所有设备的登录状态
    db.execute(
        update(models.RefreshToken)
        .where(models.RefreshToken.user_id == user.id, models.RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    db.commit()
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


def check_timezone(tz: str) -> None:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"无效的时区：{tz}") from None


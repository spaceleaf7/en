from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import models
from app.core.database import get_db
from app.core.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> models.User:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail="未登录或登录已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if cred is None:
        raise unauthorized
    user_id = decode_access_token(cred.credentials)
    if user_id is None:
        raise unauthorized
    user = db.get(models.User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_admin(user: Annotated[models.User, Depends(get_current_user)]) -> models.User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


CurrentUser = Annotated[models.User, Depends(get_current_user)]
AdminUser = Annotated[models.User, Depends(require_admin)]

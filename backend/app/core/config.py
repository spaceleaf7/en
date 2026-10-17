from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量或 backend/.env 读取"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "EtymoMind API"
    debug: bool = False

    # mysql+pymysql://user:password@host:3306/dbname?charset=utf8mb4
    database_url: str = Field(..., description="SQLAlchemy 数据库连接串")

    # JWT：必须通过环境变量设置为足够长的随机串
    jwt_secret: str = Field(..., min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    # refresh token 放在 httpOnly Cookie 中；生产环境（HTTPS）必须设为 true
    cookie_secure: bool = False

    allow_registration: bool = True

    # 允许跨域访问的前端地址，逗号分隔（开发时前端走 Vite 代理则无需跨域）
    # NoDecode：跳过 pydantic-settings 的 JSON 预解析，交给下面的 validator 按逗号拆分
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # 学习日默认时区与换日小时，需与前端 progressCore.ts 保持一致；用户可在同步时上报自己的时区
    default_timezone: str = "Asia/Shanghai"
    day_start_hour: int = 4

    # 单次同步最多接收的日志条数 / 单次最多返回的日志条数
    sync_max_logs: int = 2000
    sync_page_size: int = 2000

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

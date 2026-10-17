from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, progress, stats, vocab
from app.core.config import get_settings


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=s.app_name,
        # 接口文档仅在调试模式开放
        docs_url="/api/docs" if s.debug else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if s.debug else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,  # 需要携带 refresh token Cookie
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    for r in (auth.router, vocab.router, progress.router, stats.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health", tags=["系统"])
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()

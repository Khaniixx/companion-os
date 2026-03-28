"""Entry point for the agent runtime service.

This module creates the FastAPI application, including API routes and
sets up middleware.  When run via `uvicorn`, this module exposes the
`app` variable as the ASGI application.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        FastAPI: configured app instance.
    """
    app = FastAPI(title="Companion OS Agent Runtime", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:1420",
            "http://localhost:1420",
            "http://tauri.localhost",
            "tauri://localhost",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount API routes under /api
    app.include_router(api_router, prefix="/api")

    return app


app = create_app()

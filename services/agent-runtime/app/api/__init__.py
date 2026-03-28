"""API package for Companion OS agent runtime.

This package exposes REST endpoints used by the desktop app to
communicate with the agent runtime.  Endpoints include routes for
sending user messages, listing available skills, and requesting
permissions.  Additional endpoints can be added here as the project
evolves.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint.

    Returns a JSON payload confirming that the agent runtime is running.
    """
    return {"status": "ok"}
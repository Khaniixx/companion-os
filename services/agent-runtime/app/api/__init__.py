"""API package for Companion OS agent runtime.

This package exposes REST endpoints used by the desktop app to
communicate with the agent runtime. Endpoints include routes for
sending user messages, listing available skills, and requesting
permissions. Additional endpoints can be added here as the project
evolves.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from app.installer import (
    SUPPORTED_LOCAL_MODELS,
    check_environment,
    configure_ai,
    get_installer_status,
    install_openclaw,
    prepare_prerequisites,
    start_and_connect,
)
from app.preferences import get_permission, set_permission
from app.skills.app_launcher import launch_app_skill

router = APIRouter()


class ChatRequest(BaseModel):
    """User message payload sent from the desktop shell."""

    message: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class ChatResponse(BaseModel):
    """Echo response returned to the desktop shell."""

    message: str


class OpenAppRequest(BaseModel):
    """Request payload for opening a supported desktop app."""

    app: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True)] = (
        Field(..., min_length=1)
    )


class OpenAppResponse(BaseModel):
    """Response payload after attempting to launch a desktop app."""

    ok: bool
    app: str
    message: str


class PermissionResponse(BaseModel):
    """Response payload for persisted permission state."""

    permission: str
    granted: bool


class PermissionUpdateRequest(BaseModel):
    """Request payload for updating persisted permission state."""

    granted: bool


class InstallerStatusResponse(BaseModel):
    """Persisted installer state used to drive the desktop wizard."""

    environment: dict[str, object]
    openclaw: dict[str, object]
    ai: dict[str, str]
    connection: dict[str, bool]


class PreparePrerequisitesResponse(BaseModel):
    """Result of prerequisite preparation."""

    attempted: bool
    installed: list[str]
    remaining: list[str]
    message: str
    environment: dict[str, object]


class InstallOpenClawResponse(BaseModel):
    """Result of local OpenClaw installation."""

    install_path: str
    message: str


class ConfigureAIRequest(BaseModel):
    """Model selection for local AI configuration."""

    model: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True)] = (
        Field(..., min_length=1)
    )


class ConfigureAIResponse(BaseModel):
    """Result of local AI configuration."""

    provider: str
    model: str
    message: str


class StartConnectResponse(BaseModel):
    """Result of the final connection step."""

    connected: bool
    message: str


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint.

    Returns a JSON payload confirming that the agent runtime is running.
    """
    return {"status": "ok"}


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Echo the user's message for initial desktop integration."""

    return ChatResponse(message=f"Echo: {request.message}")


@router.get("/installer/status", response_model=InstallerStatusResponse)
async def installer_status() -> InstallerStatusResponse:
    """Return the current installer state for the desktop shell."""

    return InstallerStatusResponse(**get_installer_status())


@router.post(
    "/installer/environment-check",
    response_model=dict[str, object],
)
async def installer_environment_check() -> dict[str, object]:
    """Detect environment prerequisites for the local desktop shell."""

    return dict(check_environment())


@router.post(
    "/installer/prepare-prerequisites",
    response_model=PreparePrerequisitesResponse,
)
async def installer_prepare_prerequisites() -> PreparePrerequisitesResponse:
    """Attempt to install missing prerequisites silently where possible."""

    return PreparePrerequisitesResponse(**prepare_prerequisites())


@router.post("/installer/install-openclaw", response_model=InstallOpenClawResponse)
async def installer_install_openclaw() -> InstallOpenClawResponse:
    """Prepare a local OpenClaw installation directory."""

    return InstallOpenClawResponse(**install_openclaw())


@router.get("/installer/models", response_model=list[str])
async def installer_models() -> list[str]:
    """Return supported default local model choices."""

    return list(SUPPORTED_LOCAL_MODELS)


@router.post("/installer/configure-ai", response_model=ConfigureAIResponse)
async def installer_configure_ai(request: ConfigureAIRequest) -> ConfigureAIResponse:
    """Persist the selected default local model."""

    try:
        return ConfigureAIResponse(**configure_ai(request.model))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/installer/start-connect", response_model=StartConnectResponse)
async def installer_start_connect() -> StartConnectResponse:
    """Mark the local runtime as ready and connected."""

    try:
        return StartConnectResponse(**start_and_connect())
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get(
    "/preferences/permissions/open_app",
    response_model=PermissionResponse,
)
async def get_open_app_permission() -> PermissionResponse:
    """Return the persisted permission state for open_app."""

    granted = get_permission("open_app")
    return PermissionResponse(permission="open_app", granted=granted)


@router.put(
    "/preferences/permissions/open_app",
    response_model=PermissionResponse,
)
async def update_open_app_permission(
    request: PermissionUpdateRequest,
) -> PermissionResponse:
    """Persist the permission state for open_app."""

    granted = set_permission("open_app", request.granted)
    return PermissionResponse(permission="open_app", granted=granted)


@router.post("/skills/open-app", response_model=OpenAppResponse)
async def open_app(request: OpenAppRequest) -> OpenAppResponse:
    """Launch a supported desktop app after frontend confirmation."""

    if not get_permission("open_app"):
        raise HTTPException(
            status_code=403,
            detail="open_app permission has not been granted",
        )

    try:
        result = launch_app_skill(request.app)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return OpenAppResponse(**result)

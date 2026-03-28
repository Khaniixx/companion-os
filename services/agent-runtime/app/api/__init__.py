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

from app.core.command_router import route_user_message
from app.installer import (
    check_environment,
    configure_ai,
    get_installer_status,
    get_supported_models,
    install_openclaw,
    prepare_prerequisites,
    start_and_connect,
)
from app.preferences import get_permission, set_permission
from app.skills.app_launcher import launch_app_skill
from app.skills.browser_helper import run_browser_helper

router = APIRouter()


class ChatRequest(BaseModel):
    """User message payload sent from the desktop shell."""

    message: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class ChatResponse(BaseModel):
    """Structured routed response returned to the desktop shell."""

    ok: bool
    route: str
    user_message: str
    assistant_response: str
    action: dict[str, object] | None = None


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


class BrowserHelperRequest(BaseModel):
    """Natural-language browser-helper request payload."""

    request: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class BrowserHelperResponse(BaseModel):
    """Structured response returned by the browser-helper skill."""

    ok: bool
    action: str
    request: str
    url: str
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

    current_step: str
    completed: bool
    environment: dict[str, object]
    steps: dict[str, dict[str, object]]
    openclaw: dict[str, object]
    ai: dict[str, object]
    connection: dict[str, object]


class InstallerEnvironmentResponse(BaseModel):
    """Result of the environment check step."""

    environment: dict[str, object]
    step: dict[str, object]


class PreparePrerequisitesResponse(BaseModel):
    """Result of prerequisite preparation."""

    attempted: bool
    installed: list[str]
    remaining: list[str]
    message: str
    environment: dict[str, object]
    step: dict[str, object]


class InstallOpenClawResponse(BaseModel):
    """Result of local OpenClaw installation."""

    install_path: str
    message: str
    step: dict[str, object]


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
    step: dict[str, object]


class StartConnectResponse(BaseModel):
    """Result of the final connection step."""

    connected: bool
    message: str
    step: dict[str, object]


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint.

    Returns a JSON payload confirming that the agent runtime is running.
    """
    return {"status": "ok"}


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Route a message into MVP chat or a first-party action skill."""

    result = route_user_message(request.message)
    return ChatResponse(
        ok=result.ok,
        route=result.route,
        user_message=result.user_message,
        assistant_response=result.assistant_response,
        action=result.action,
    )


@router.get("/installer/status", response_model=InstallerStatusResponse)
async def installer_status() -> InstallerStatusResponse:
    """Return the current installer state for the desktop shell."""

    return InstallerStatusResponse(**get_installer_status())


@router.post(
    "/installer/environment-check",
    response_model=InstallerEnvironmentResponse,
)
async def installer_environment_check() -> InstallerEnvironmentResponse:
    """Detect environment prerequisites for the local desktop shell."""

    return InstallerEnvironmentResponse(**check_environment())


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

    try:
        return InstallOpenClawResponse(**install_openclaw())
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/installer/models", response_model=list[str])
async def installer_models() -> list[str]:
    """Return supported default local model choices."""

    return get_supported_models()


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


@router.get(
    "/preferences/permissions/open_url",
    response_model=PermissionResponse,
)
async def get_open_url_permission() -> PermissionResponse:
    """Return the persisted permission state for browser access."""

    granted = get_permission("open_url")
    return PermissionResponse(permission="open_url", granted=granted)


@router.put(
    "/preferences/permissions/open_url",
    response_model=PermissionResponse,
)
async def update_open_url_permission(
    request: PermissionUpdateRequest,
) -> PermissionResponse:
    """Persist the permission state for browser access."""

    granted = set_permission("open_url", request.granted)
    return PermissionResponse(permission="open_url", granted=granted)


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


@router.post("/skills/browser-helper", response_model=BrowserHelperResponse)
async def browser_helper(request: BrowserHelperRequest) -> BrowserHelperResponse:
    """Open a URL or search query in the default browser."""

    if not get_permission("open_url"):
        raise HTTPException(
            status_code=403,
            detail="open_url permission has not been granted",
        )

    try:
        result = run_browser_helper(request.request)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return BrowserHelperResponse(**result)

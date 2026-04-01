"""API package for Companion OS agent runtime."""

import base64
import binascii
import mimetypes
from typing import Any
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field, StringConstraints

from app.core.command_router import route_user_message
from app.installer import (
    check_environment,
    configure_ai,
    download_setup,
    get_installer_status,
    get_supported_models,
    install_openclaw,
    prepare_prerequisites,
    repair_installation,
    start_and_connect,
)
from app.micro_utilities import (
    capture_clipboard_entry,
    dismiss_utility_alert,
    list_micro_utility_state,
    update_note,
)
from app.memory_manager import (
    clear_memory_summaries,
    clear_pending_memory,
    delete_memory_summary,
    list_memory_state,
    record_chat_turn,
    update_memory_summary,
)
from app.marketplace import (
    get_marketplace_listing,
    install_marketplace_listing,
    list_marketplace_listings,
)
from app.personality_packs import (
    PACK_ID_PATTERN,
    get_active_pack_profile,
    get_pack_model_asset_path,
    get_pack_manifest_schema,
    get_pack_preview_image_path,
    import_tavern_card,
    install_pack_archive,
    list_installed_packs,
    select_active_pack,
)
from app.preferences import (
    get_memory_settings,
    get_presence_settings,
    get_permission,
    get_speech_input_settings,
    get_voice_settings,
    set_permission,
    update_presence_settings,
    update_speech_input_settings,
    update_voice_settings,
    update_memory_settings,
)
from app.skills.app_launcher import launch_app_skill
from app.skills.browser_helper import run_browser_helper
from app.skills.micro_utilities import run_micro_utility
from app.stream_integration import (
    clear_recent_stream_events,
    create_preview_stream_event,
    get_stream_state,
    ingest_youtube_event,
    list_recent_stream_events,
    process_twitch_webhook,
    update_stream_settings,
)

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
    loading: bool = False


class OpenAppRequest(BaseModel):
    """Request payload for opening a supported desktop app."""

    app: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True)] = (
        Field(..., min_length=1)
    )


class OpenAppResponse(BaseModel):
    """Response payload after attempting to launch a desktop app."""

    ok: bool
    app: str | None = None
    display_name: str | None = None
    suggestions: list[str] = Field(default_factory=list)
    reason: str | None = None
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


class MicroUtilityRequest(BaseModel):
    """Natural-language micro-utility request payload."""

    request: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class MicroUtilityResponse(BaseModel):
    """Structured response returned by the micro-utilities skill."""

    ok: bool
    action: str
    request: str
    message: str
    metadata: dict[str, object]


class UtilityItemResponse(BaseModel):
    """Stored timer, alarm, reminder, or to-do item."""

    id: int
    kind: str
    label: str
    due_at: str | None
    completed: bool
    created_at: str
    updated_at: str
    fired_at: str | None
    dismissed: bool


class ClipboardEntryResponse(BaseModel):
    """One local clipboard history entry."""

    id: int
    text: str
    created_at: str


class ShortcutResponse(BaseModel):
    """Saved quick-launch shortcut metadata."""

    id: str
    label: str
    kind: str
    target: str


class MicroUtilitiesStateResponse(BaseModel):
    """Stored non-intrusive utility state for the desktop shell."""

    timers: list[UtilityItemResponse]
    reminders: list[UtilityItemResponse]
    todos: list[UtilityItemResponse]
    notes: list[UtilityItemResponse]
    alerts: list[UtilityItemResponse]
    clipboard_history: list[ClipboardEntryResponse]
    shortcuts: list[ShortcutResponse]


class ClipboardCaptureRequest(BaseModel):
    """Clipboard text forwarded from the desktop shell."""

    text: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class ClipboardCaptureResponse(BaseModel):
    """Result of storing local clipboard text."""

    id: int
    text: str
    created_at: str
    message: str


class UtilityNoteUpdateRequest(BaseModel):
    """Editable fields for a stored reminder or to-do note."""

    label: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None
    completed: bool | None = None


class UtilityDismissResponse(BaseModel):
    """Result returned after dismissing a timer or alarm alert."""

    item: UtilityItemResponse
    message: str


class StreamReactionPreferencesResponse(BaseModel):
    """Per-event reaction toggles for stream integrations."""

    new_subscriber: bool
    donation: bool
    new_member: bool
    super_chat: bool


class StreamSettingsResponse(BaseModel):
    """Persisted stream integration and overlay settings."""

    enabled: bool
    provider: str
    overlay_enabled: bool
    click_through_enabled: bool
    twitch_channel_name: str
    twitch_webhook_secret: str
    has_twitch_webhook_secret: bool
    youtube_live_chat_id: str
    reaction_preferences: StreamReactionPreferencesResponse


class StreamEventResponse(BaseModel):
    """One recent stream event rendered by the companion."""

    id: int
    provider: str
    type: str
    actor_name: str
    amount_display: str | None
    message: str | None
    bubble_text: str
    created_at: str
    should_react: bool


class StreamStateResponse(BaseModel):
    """Settings and recent stream events for the desktop shell."""

    settings: StreamSettingsResponse
    recent_events: list[StreamEventResponse]


class StreamSettingsUpdateRequest(BaseModel):
    """Partial update for stream integration settings."""

    enabled: bool | None = None
    provider: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None
    overlay_enabled: bool | None = None
    click_through_enabled: bool | None = None
    twitch_channel_name: (
        Annotated[str, StringConstraints(strip_whitespace=True)] | None
    ) = None
    twitch_webhook_secret: (
        Annotated[str, StringConstraints(strip_whitespace=True)] | None
    ) = None
    youtube_live_chat_id: (
        Annotated[str, StringConstraints(strip_whitespace=True)] | None
    ) = None
    reaction_preferences: dict[str, bool] | None = None


class StreamPreviewEventRequest(BaseModel):
    """Preview one local stream reaction in the desktop shell."""

    type: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class StreamDeleteResponse(BaseModel):
    """Response returned after clearing recent stream events."""

    deleted: int


class YouTubeStreamEventRequest(BaseModel):
    """YouTube live message payload forwarded from a local relay."""

    event: dict[str, Any]


class PermissionResponse(BaseModel):
    """Response payload for persisted permission state."""

    permission: str
    granted: bool


class PermissionUpdateRequest(BaseModel):
    """Request payload for updating persisted permission state."""

    granted: bool


class VoiceSettingsResponse(BaseModel):
    """Persisted voice readiness and preference state for the active companion."""

    enabled: bool
    autoplay_enabled: bool
    available: bool
    state: str
    provider: str
    voice_id: str
    locale: str | None
    style: str | None
    display_name: str
    message: str


class VoiceSettingsUpdateRequest(BaseModel):
    """Partial update payload for persisted voice preferences."""

    enabled: bool | None = None
    autoplay_enabled: bool | None = None


class SpeechInputSettingsResponse(BaseModel):
    """Persisted speech-input readiness and preference state."""

    enabled: bool
    transcription_enabled: bool
    available: bool
    state: str
    provider: str
    locale: str | None
    display_name: str
    message: str


class SpeechInputSettingsUpdateRequest(BaseModel):
    """Partial update payload for persisted speech-input preferences."""

    enabled: bool | None = None
    transcription_enabled: bool | None = None


class PresenceSettingsResponse(BaseModel):
    """Persisted desktop presence preferences for the active companion."""

    enabled: bool
    click_through_enabled: bool
    anchor: str
    state: str
    message: str


class PresenceSettingsUpdateRequest(BaseModel):
    """Partial update payload for persisted desktop presence settings."""

    enabled: bool | None = None
    click_through_enabled: bool | None = None
    anchor: str | None = None


class MemorySettingsResponse(BaseModel):
    """Persisted local memory and privacy settings."""

    long_term_memory_enabled: bool
    summary_frequency_messages: int
    cloud_backup_enabled: bool
    storage_mode: str


class MemorySettingsUpdateRequest(BaseModel):
    """Partial update payload for local memory settings."""

    long_term_memory_enabled: bool | None = None
    summary_frequency_messages: int | None = Field(default=None, ge=1)
    cloud_backup_enabled: bool | None = None


class MemorySummaryResponse(BaseModel):
    """Stored local conversation summary."""

    id: int
    title: str
    summary: str
    message_count: int
    created_at: str
    updated_at: str
    source: str


class MemorySummaryListResponse(BaseModel):
    """Collection of stored summaries and pending local memory state."""

    summaries: list[MemorySummaryResponse]
    pending_message_count: int


class MemorySummaryUpdateRequest(BaseModel):
    """Editable summary fields for a stored memory summary."""

    title: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None
    summary: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None


class MemoryDeleteResponse(BaseModel):
    """Response returned after deleting memory summaries."""

    deleted: int


class PackContentRatingResponse(BaseModel):
    """Simplified content rating returned for an installed pack."""

    minimum_age: int
    maximum_age: int | None
    tags: list[str]


class PackCapabilityResponse(BaseModel):
    """Capability declaration surfaced to the desktop shell."""

    id: str
    justification: str


class InstalledPackResponse(BaseModel):
    """Installed pack metadata used by the settings UI."""

    id: str
    name: str
    version: str
    display_name: str
    author_name: str
    license_name: str
    content_rating: PackContentRatingResponse
    required_capabilities: list[PackCapabilityResponse]
    optional_capabilities: list[PackCapabilityResponse]
    active: bool
    icon_data_url: str | None
    installed_at: str | None
    system_prompt: str | None = None
    style_rules: list[str] = Field(default_factory=list)
    voice: dict[str, str | None] = Field(default_factory=dict)
    avatar: dict[str, object] = Field(default_factory=dict)
    model: dict[str, str | None] = Field(default_factory=dict)


class PackListResponse(BaseModel):
    """List of installed packs and the currently active selection."""

    active_pack_id: str | None
    packs: list[InstalledPackResponse]
    schema_version: str


class PackSchemaResponse(BaseModel):
    """JSON schema returned for pack.json."""

    pack_schema: dict[str, object] = Field(alias="schema")


class PackInstallRequest(BaseModel):
    """Base64-encoded zip payload used for pack import."""

    filename: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )
    archive_base64: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class PackInstallResponse(BaseModel):
    """Result of installing a new pack archive."""

    active_pack_id: str | None
    pack: InstalledPackResponse


class PackSelectionRequest(BaseModel):
    """Request payload for choosing the active pack."""

    pack_id: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            to_lower=True,
            pattern=PACK_ID_PATTERN.pattern,
        ),
    ] = Field(..., min_length=1)


class PackSelectionResponse(BaseModel):
    """Response returned after selecting an active pack."""

    active_pack_id: str
    pack: InstalledPackResponse


class TavernImportRequest(BaseModel):
    """Base64-encoded Tavern Card PNG payload."""

    filename: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )
    image_base64: Annotated[str, StringConstraints(strip_whitespace=True)] = Field(
        ..., min_length=1
    )


class MarketplacePublisherResponse(BaseModel):
    """Publisher information shown for one marketplace listing."""

    id: str
    name: str
    website: str | None
    signature_key_id: str


class MarketplacePriceResponse(BaseModel):
    """Price summary for a marketplace listing."""

    is_free: bool
    amount: float | None
    currency: str | None
    label: str


class MarketplaceRevenueShareResponse(BaseModel):
    """Revenue split shown for creator marketplace content."""

    creator_percent: int
    platform_percent: int
    payment_processor_percent: int


class MarketplaceAutomatedScanResponse(BaseModel):
    """Automated moderation or security scan status."""

    id: str
    label: str
    status: str
    summary: str


class MarketplaceManualReviewResponse(BaseModel):
    """Manual review status for a marketplace listing."""

    status: str
    reviewer: str
    reviewed_at: str
    notes: str


class MarketplaceModerationResponse(BaseModel):
    """Moderation workflow state returned to the desktop shell."""

    automated_scans: list[MarketplaceAutomatedScanResponse]
    manual_review: MarketplaceManualReviewResponse
    install_allowed: bool


class MarketplaceLicenseResponse(BaseModel):
    """License declaration shown in the marketplace."""

    name: str
    spdx_identifier: str | None
    url: str | None


class MarketplaceIPDeclarationResponse(BaseModel):
    """Rights declaration required for curated personality packs."""

    rights_confirmed: bool
    asset_sources: list[str]
    notes: str


class MarketplacePublisherSignatureResponse(BaseModel):
    """Signed publisher metadata surfaced for trust and review."""

    algorithm: str
    key_id: str
    public_key: dict[str, str]
    value: str


class MarketplaceListingResponse(BaseModel):
    """Marketplace listing metadata for packs and skills."""

    schema_version: str
    id: str
    kind: str
    name: str
    description: str
    version: str
    publisher: MarketplacePublisherResponse
    license: MarketplaceLicenseResponse
    required_capabilities: list[PackCapabilityResponse]
    optional_capabilities: list[PackCapabilityResponse]
    price: MarketplacePriceResponse
    revenue_share: MarketplaceRevenueShareResponse
    moderation: MarketplaceModerationResponse
    publisher_signature: MarketplacePublisherSignatureResponse
    content_rating: PackContentRatingResponse | None
    ip_declaration: MarketplaceIPDeclarationResponse | None
    install_supported: bool
    core_feature: bool
    icon_data_url: str | None


class MarketplaceListResponse(BaseModel):
    """Collection of curated marketplace listings."""

    schema_version: str
    listings: list[MarketplaceListingResponse]


class MarketplaceInstallResponse(BaseModel):
    """Result of installing a curated marketplace personality pack."""

    listing: MarketplaceListingResponse
    active_pack_id: str | None
    pack: InstalledPackResponse


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


class DownloadSetupResponse(BaseModel):
    """Result of the canonical Download step."""

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


class InstallerActionResponse(BaseModel):
    """Repair or resume result returned to the desktop installer wizard."""

    message: str
    resumed_step: str
    step: dict[str, object]
    status: dict[str, object]


def _decode_base64_payload(raw_payload: str, *, label: str) -> bytes:
    try:
        return base64.b64decode(raw_payload, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be valid base64 data.",
        ) from error


def _memory_settings_payload() -> MemorySettingsResponse:
    settings = get_memory_settings()
    return MemorySettingsResponse(
        long_term_memory_enabled=bool(settings["long_term_memory_enabled"]),
        summary_frequency_messages=int(settings["summary_frequency_messages"]),
        cloud_backup_enabled=bool(settings["cloud_backup_enabled"]),
        storage_mode="local-only",
    )


def _voice_settings_payload() -> VoiceSettingsResponse:
    settings = get_voice_settings()
    active_profile = get_active_pack_profile()
    voice_metadata = active_profile.get("voice", {})
    if not isinstance(voice_metadata, dict):
        voice_metadata = {}

    provider = str(voice_metadata.get("provider", "local")).strip() or "local"
    voice_id = str(voice_metadata.get("voice_id", "default")).strip() or "default"
    locale_value = voice_metadata.get("locale")
    locale = str(locale_value).strip() or None if locale_value is not None else None
    style_value = voice_metadata.get("style")
    style = str(style_value).strip() or None if style_value is not None else None
    display_name = str(
        active_profile.get("display_name", "Aster")
    ).strip() or "Aster"

    available = bool(provider and voice_id)
    enabled = bool(settings["enabled"])
    autoplay_enabled = bool(settings["autoplay_enabled"])

    if not enabled:
        state = "muted"
        message = f"{display_name}'s voice is resting until you want it."
    elif available:
        state = "ready"
        message = f"{display_name}'s voice is ready when you want it."
    else:
        state = "unavailable"
        message = f"{display_name} does not have a usable voice profile yet."

    return VoiceSettingsResponse(
        enabled=enabled,
        autoplay_enabled=autoplay_enabled,
        available=available,
        state=state,
        provider=provider,
        voice_id=voice_id,
        locale=locale,
        style=style,
        display_name=display_name,
        message=message,
    )


def _speech_input_settings_payload() -> SpeechInputSettingsResponse:
    settings = get_speech_input_settings()
    active_profile = get_active_pack_profile()
    voice_metadata = active_profile.get("voice", {})
    if not isinstance(voice_metadata, dict):
        voice_metadata = {}

    locale_value = voice_metadata.get("locale")
    locale = str(locale_value).strip() or None if locale_value is not None else None
    display_name = str(active_profile.get("display_name", "Aster")).strip() or "Aster"
    enabled = bool(settings["enabled"])
    transcription_enabled = bool(settings["transcription_enabled"])
    provider = str(settings["provider"]).strip() or "browser"
    available = provider == "browser"

    if enabled:
        state = "ready"
        message = (
            f"{display_name} is ready to listen through the browser mic when you start it."
        )
    else:
        state = "disabled"
        message = f"{display_name}'s ears are resting until you turn speech input on."

    return SpeechInputSettingsResponse(
        enabled=enabled,
        transcription_enabled=transcription_enabled,
        available=available,
        state=state,
        provider=provider,
        locale=locale,
        display_name=display_name,
        message=message,
    )


def _presence_settings_payload() -> PresenceSettingsResponse:
    settings = get_presence_settings()
    enabled = bool(settings["enabled"])
    anchor = str(settings["anchor"])
    pinned_enabled = enabled and anchor != "workspace"
    click_through_enabled = pinned_enabled and bool(settings["click_through_enabled"])
    anchor_label = (
        "the active app"
        if anchor
        in {
            "active-window-right",
            "active-window-left",
            "active-window-top-right",
            "active-window-top-left",
        }
        else "the desktop"
    )
    active_app_affinity = anchor_label == "the active app"
    perched_enabled = anchor in {"active-window-top-right", "active-window-top-left"}

    if pinned_enabled and click_through_enabled:
        state = "click-through"
        message = (
            "Aster is perched on the active app and following along while letting clicks pass through."
            if perched_enabled
            else (
                "Aster is following the active app and currently letting clicks pass through."
                if active_app_affinity
                else f"Aster is pinned near {anchor_label} and currently letting clicks pass through."
            )
        )
    elif pinned_enabled:
        state = "pinned"
        message = (
            "Aster is perched on the active app and ready to follow along."
            if perched_enabled
            else (
                "Aster is following the active app and ready to stay nearby."
                if active_app_affinity
                else f"Aster is pinned near {anchor_label} and ready to stay nearby."
            )
        )
    else:
        state = "workspace"
        message = "Aster is staying in the normal workspace until you pin the desktop presence."

    return PresenceSettingsResponse(
        enabled=enabled,
        click_through_enabled=click_through_enabled,
        anchor=anchor,
        state=state,
        message=message,
    )


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
    record_chat_turn(request.message, result.assistant_response)
    return ChatResponse(
        ok=result.ok,
        route=result.route,
        user_message=result.user_message,
        assistant_response=result.assistant_response,
        action=result.action,
        loading=result.loading,
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
    """Legacy environment inspection route for installer diagnostics."""

    return InstallerEnvironmentResponse(**check_environment())


@router.post(
    "/installer/download",
    response_model=DownloadSetupResponse,
)
async def installer_download() -> DownloadSetupResponse:
    """Run the canonical Download step for the local-first setup flow."""

    return DownloadSetupResponse(**download_setup())


@router.post(
    "/installer/prepare-prerequisites",
    response_model=DownloadSetupResponse,
)
async def installer_prepare_prerequisites() -> DownloadSetupResponse:
    """Legacy prerequisite route kept as a compatibility shim."""

    return DownloadSetupResponse(**prepare_prerequisites())


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


@router.post("/installer/repair", response_model=InstallerActionResponse)
async def installer_repair() -> InstallerActionResponse:
    """Repair the current incomplete installer step and resume from there."""

    try:
        return InstallerActionResponse(**repair_installation())
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/memory/settings", response_model=MemorySettingsResponse)
async def get_memory_preferences() -> MemorySettingsResponse:
    """Return persisted local memory and privacy settings."""

    return _memory_settings_payload()


@router.put("/memory/settings", response_model=MemorySettingsResponse)
async def update_memory_preferences(
    request: MemorySettingsUpdateRequest,
) -> MemorySettingsResponse:
    """Persist local memory and privacy settings."""

    try:
        settings = update_memory_settings(
            long_term_memory_enabled=request.long_term_memory_enabled,
            summary_frequency_messages=request.summary_frequency_messages,
            cloud_backup_enabled=request.cloud_backup_enabled,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if request.long_term_memory_enabled is False:
        clear_pending_memory()

    return MemorySettingsResponse(
        long_term_memory_enabled=bool(settings["long_term_memory_enabled"]),
        summary_frequency_messages=int(settings["summary_frequency_messages"]),
        cloud_backup_enabled=bool(settings["cloud_backup_enabled"]),
        storage_mode="local-only",
    )


@router.get("/memory/summaries", response_model=MemorySummaryListResponse)
async def get_memory_summaries() -> MemorySummaryListResponse:
    """Return stored long-term memory summaries."""

    return MemorySummaryListResponse(**list_memory_state())


@router.put(
    "/memory/summaries/{summary_id}",
    response_model=MemorySummaryResponse,
)
async def edit_memory_summary(
    summary_id: int,
    request: MemorySummaryUpdateRequest,
) -> MemorySummaryResponse:
    """Update one stored memory summary."""

    try:
        return MemorySummaryResponse(
            **update_memory_summary(
                summary_id,
                title=request.title,
                summary=request.summary,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete(
    "/memory/summaries/{summary_id}",
    response_model=MemoryDeleteResponse,
)
async def remove_memory_summary(summary_id: int) -> MemoryDeleteResponse:
    """Delete one stored memory summary."""

    try:
        return MemoryDeleteResponse(deleted=delete_memory_summary(summary_id))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/memory/summaries", response_model=MemoryDeleteResponse)
async def remove_all_memory_summaries() -> MemoryDeleteResponse:
    """Delete all stored memory summaries and pending local memory."""

    return MemoryDeleteResponse(deleted=clear_memory_summaries())


@router.get("/packs", response_model=PackListResponse)
async def get_packs() -> PackListResponse:
    """Return installed personality packs and the active selection."""

    return PackListResponse(**list_installed_packs())


@router.get("/packs/schema", response_model=PackSchemaResponse)
async def get_pack_schema() -> PackSchemaResponse:
    """Return the JSON schema for pack.json."""

    return PackSchemaResponse(schema=get_pack_manifest_schema())


@router.get("/packs/{pack_id}/preview-image")
async def get_pack_preview_image(pack_id: str) -> FileResponse:
    """Return the installed preview image declared by one pack manifest."""

    try:
        resolved_asset_path = get_pack_preview_image_path(pack_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    mime_type = mimetypes.guess_type(resolved_asset_path.name)[0]
    return FileResponse(
        path=resolved_asset_path,
        media_type=mime_type or "application/octet-stream",
        filename=resolved_asset_path.name,
    )


@router.get("/packs/{pack_id}/model-asset")
async def get_pack_model_asset(pack_id: str) -> FileResponse:
    """Return the installed model asset declared by one pack manifest."""

    try:
        resolved_asset_path = get_pack_model_asset_path(pack_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    mime_type = mimetypes.guess_type(resolved_asset_path.name)[0]
    return FileResponse(
        path=resolved_asset_path,
        media_type=mime_type or "application/octet-stream",
        filename=resolved_asset_path.name,
    )


@router.post("/packs/install", response_model=PackInstallResponse)
async def install_pack(request: PackInstallRequest) -> PackInstallResponse:
    """Install a zipped personality pack uploaded by the desktop shell."""

    archive_bytes = _decode_base64_payload(
        request.archive_base64,
        label="archive_base64",
    )

    try:
        return PackInstallResponse(
            **install_pack_archive(
                filename=request.filename,
                archive_bytes=archive_bytes,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/packs/active", response_model=PackSelectionResponse)
async def update_active_pack(
    request: PackSelectionRequest,
) -> PackSelectionResponse:
    """Persist the selected active personality pack."""

    try:
        return PackSelectionResponse(**select_active_pack(request.pack_id))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/packs/import-tavern-card", response_model=PackInstallResponse)
async def import_tavern_pack(
    request: TavernImportRequest,
) -> PackInstallResponse:
    """Convert a Tavern Card PNG into an installed pack."""

    image_bytes = _decode_base64_payload(
        request.image_base64,
        label="image_base64",
    )

    try:
        return PackInstallResponse(
            **import_tavern_card(
                filename=request.filename,
                image_bytes=image_bytes,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/marketplace/listings", response_model=MarketplaceListResponse)
async def get_marketplace_listings() -> MarketplaceListResponse:
    """Return the curated marketplace catalog for packs and skills."""

    return MarketplaceListResponse(**list_marketplace_listings())


@router.get(
    "/marketplace/listings/{listing_id}",
    response_model=MarketplaceListingResponse,
)
async def get_marketplace_listing_by_id(
    listing_id: str,
) -> MarketplaceListingResponse:
    """Return one curated marketplace listing."""

    try:
        return MarketplaceListingResponse(**get_marketplace_listing(listing_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/marketplace/listings/{listing_id}/install",
    response_model=MarketplaceInstallResponse,
)
async def install_marketplace_pack(listing_id: str) -> MarketplaceInstallResponse:
    """Install one approved free personality pack from the curated marketplace."""

    try:
        return MarketplaceInstallResponse(**install_marketplace_listing(listing_id))
    except ValueError as error:
        detail = str(error)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from error


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


@router.get("/preferences/voice", response_model=VoiceSettingsResponse)
async def get_voice_preferences() -> VoiceSettingsResponse:
    """Return persisted voice preferences and active pack voice readiness."""

    return _voice_settings_payload()


@router.put("/preferences/voice", response_model=VoiceSettingsResponse)
async def save_voice_preferences(
    request: VoiceSettingsUpdateRequest,
) -> VoiceSettingsResponse:
    """Persist active companion voice preferences."""

    update_voice_settings(
        enabled=request.enabled,
        autoplay_enabled=request.autoplay_enabled,
    )
    return _voice_settings_payload()


@router.get(
    "/preferences/speech-input",
    response_model=SpeechInputSettingsResponse,
)
async def get_speech_input_preferences() -> SpeechInputSettingsResponse:
    """Return persisted speech-input preferences for the active companion."""

    return _speech_input_settings_payload()


@router.put(
    "/preferences/speech-input",
    response_model=SpeechInputSettingsResponse,
)
async def save_speech_input_preferences(
    request: SpeechInputSettingsUpdateRequest,
) -> SpeechInputSettingsResponse:
    """Persist active companion speech-input preferences."""

    update_speech_input_settings(
        enabled=request.enabled,
        transcription_enabled=request.transcription_enabled,
    )
    return _speech_input_settings_payload()


@router.get("/preferences/presence", response_model=PresenceSettingsResponse)
async def get_presence_preferences() -> PresenceSettingsResponse:
    """Return persisted desktop presence preferences."""

    return _presence_settings_payload()


@router.put("/preferences/presence", response_model=PresenceSettingsResponse)
async def save_presence_preferences(
    request: PresenceSettingsUpdateRequest,
) -> PresenceSettingsResponse:
    """Persist desktop presence preferences for the active companion."""

    try:
        update_presence_settings(
            enabled=request.enabled,
            click_through_enabled=request.click_through_enabled,
            anchor=request.anchor,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return _presence_settings_payload()


@router.get("/utilities/state", response_model=MicroUtilitiesStateResponse)
async def get_micro_utilities_state() -> MicroUtilitiesStateResponse:
    """Return stored timers, reminders, notes, clipboard history, and shortcuts."""

    return MicroUtilitiesStateResponse(**list_micro_utility_state())


@router.patch("/utilities/items/{item_id}", response_model=UtilityItemResponse)
async def edit_micro_utility_note(
    item_id: int,
    request: UtilityNoteUpdateRequest,
) -> UtilityItemResponse:
    """Edit or complete a stored reminder or to-do note."""

    try:
        return UtilityItemResponse(
            **update_note(
                item_id,
                label=request.label,
                completed=request.completed,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post(
    "/utilities/items/{item_id}/dismiss",
    response_model=UtilityDismissResponse,
)
async def dismiss_micro_utility_item(item_id: int) -> UtilityDismissResponse:
    """Dismiss a fired timer or alarm alert."""

    try:
        item = dismiss_utility_alert(item_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return UtilityDismissResponse(
        item=UtilityItemResponse(**item),
        message="I tucked that alert away for you.",
    )


@router.post(
    "/utilities/clipboard/capture",
    response_model=ClipboardCaptureResponse,
)
async def capture_clipboard(
    request: ClipboardCaptureRequest,
) -> ClipboardCaptureResponse:
    """Store clipboard text locally after the desktop shell reads it."""

    try:
        entry = capture_clipboard_entry(request.text)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return ClipboardCaptureResponse(
        id=entry["id"],
        text=entry["text"],
        created_at=entry["created_at"],
        message="I saved that clipboard text into your local history.",
    )


@router.get("/stream/state", response_model=StreamStateResponse)
async def get_stream_integration_state() -> StreamStateResponse:
    """Return persisted stream settings and recent events."""

    return StreamStateResponse(**get_stream_state())


@router.get("/stream/events", response_model=list[StreamEventResponse])
async def get_recent_stream_events() -> list[StreamEventResponse]:
    """Return recent stream events for polling."""

    return [StreamEventResponse(**event) for event in list_recent_stream_events()]


@router.put("/stream/settings", response_model=StreamSettingsResponse)
async def save_stream_settings(
    request: StreamSettingsUpdateRequest,
) -> StreamSettingsResponse:
    """Persist stream integration settings and overlay preferences."""

    try:
        settings = update_stream_settings(
            enabled=request.enabled,
            provider=request.provider,
            overlay_enabled=request.overlay_enabled,
            click_through_enabled=request.click_through_enabled,
            twitch_channel_name=request.twitch_channel_name,
            twitch_webhook_secret=request.twitch_webhook_secret,
            youtube_live_chat_id=request.youtube_live_chat_id,
            reaction_preferences=request.reaction_preferences,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return StreamSettingsResponse(**settings)


@router.delete("/stream/events", response_model=StreamDeleteResponse)
async def delete_recent_stream_events() -> StreamDeleteResponse:
    """Clear the recent local stream event history."""

    return StreamDeleteResponse(deleted=clear_recent_stream_events())


@router.post("/stream/events/preview", response_model=StreamEventResponse)
async def preview_stream_event(
    request: StreamPreviewEventRequest,
) -> StreamEventResponse:
    """Create a preview event for tuning overlay reactions."""

    try:
        event = create_preview_stream_event(request.type)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return StreamEventResponse(**event)


@router.post("/stream/webhooks/twitch", response_model=None)
async def twitch_webhook(request: Request) -> PlainTextResponse | StreamEventResponse:
    """Handle Twitch EventSub webhook challenges and supported notifications."""

    raw_body = await request.body()
    headers = {key.lower(): value for key, value in request.headers.items()}

    try:
        result = process_twitch_webhook(headers=headers, raw_body=raw_body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if result["kind"] == "challenge":
        return PlainTextResponse(result["challenge"])
    if result["kind"] == "ignored":
        return PlainTextResponse(result.get("reason", "ignored"))

    return StreamEventResponse(**result["event"])


@router.post("/stream/events/youtube", response_model=StreamEventResponse)
async def youtube_stream_event(
    request: YouTubeStreamEventRequest,
) -> StreamEventResponse:
    """Ingest a YouTube live event from a local relay or polling worker."""

    try:
        event = ingest_youtube_event(request.event)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return StreamEventResponse(**event)


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


@router.post("/skills/micro-utilities", response_model=MicroUtilityResponse)
async def micro_utilities(request: MicroUtilityRequest) -> MicroUtilityResponse:
    """Run a first-party timer, reminder, to-do, clipboard, or shortcut action."""

    try:
        result = run_micro_utility(request.request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return MicroUtilityResponse(**result)

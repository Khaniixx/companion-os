"""Personality-pack schema, validation, installation, and selection helpers."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import tempfile
import unicodedata
import zlib
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from threading import Lock
from typing import Final

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.preferences import get_active_pack_id, set_active_pack_id
from app.runtime_paths import runtime_data_path


PACKS_DIR = runtime_data_path("personality_packs")
PACK_INSTALL_METADATA_NAME = ".install.json"
PACK_SCHEMA_VERSION: Final[str] = "1.0"
PACK_SIGNATURE_ALGORITHM: Final[str] = "RS256"
SUPPORTED_CAPABILITIES: Final[set[str]] = {
    "app.launch",
    "browser.open",
    "filesystem.read",
    "memory.read",
    "memory.write",
    "microphone.listen",
    "network.http",
    "notifications.show",
    "overlay.render",
}
LOCAL_IMPORTER_KEY_ID: Final[str] = "local-importer-rs256"
LOCAL_IMPORTER_RSA_MODULUS: Final[int] = int(
    "77650653673682003687494267627597200423940944606471887031283198704617400384961065594262878179247523531689087748050626142906756623775929396866115569920332406993660963712468018631931266122464649509753244738511650484947219083868737529517191070227066824739182859700635666438236974193526678946204096660565165797431"
)
LOCAL_IMPORTER_RSA_EXPONENT: Final[int] = 65537
LOCAL_IMPORTER_RSA_PRIVATE_EXPONENT: Final[int] = int(
    "55110317138776127035360496668483888235939471695085629209241732477041505471805148908035907239442453301638075261685441411493079799833526161350590254416656551558207904871581406901144484515760515596674066051280738940345615365172273349881036563711452166188901922997955549576828549351547973110506732159901378152273"
)

_pack_lock = Lock()


def _to_base64url(value: int) -> str:
    raw_value = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw_value).rstrip(b"=").decode("ascii")


LOCAL_IMPORTER_PUBLIC_KEY: Final[dict[str, str]] = {
    "kty": "RSA",
    "n": _to_base64url(LOCAL_IMPORTER_RSA_MODULUS),
    "e": _to_base64url(LOCAL_IMPORTER_RSA_EXPONENT),
}
PACK_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
HEX_COLOR_PATTERN: Final[re.Pattern[str]] = re.compile(r"^#[0-9a-fA-F]{6}$")
AVATAR_PRESENTATION_MODES: Final[set[str]] = {"shell", "portrait", "model"}
MODEL_RENDERERS: Final[set[str]] = {"shell", "live2d", "vrm"}


def _normalized_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/").strip()
    if not normalized:
        raise ValueError("Asset paths must not be empty.")
    if normalized.startswith("/"):
        raise ValueError("Asset paths must be relative.")

    path = PurePosixPath(normalized)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Asset paths must stay inside the pack archive.")
    if ":" in path.parts[0]:
        raise ValueError("Asset paths must not include a drive prefix.")

    return path.as_posix()


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _base64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _rsa_verify_rs256(message: bytes, *, modulus: int, exponent: int, signature: bytes) -> bool:
    if modulus <= 0 or exponent <= 0:
        return False

    key_size = (modulus.bit_length() + 7) // 8
    if len(signature) != key_size:
        return False

    digest = hashlib.sha256(message).digest()
    digest_info = bytes.fromhex("3031300d060960864801650304020105000420") + digest
    if key_size < len(digest_info) + 11:
        return False

    expected = b"\x00\x01" + (b"\xff" * (key_size - len(digest_info) - 3)) + b"\x00" + digest_info
    signature_value = int.from_bytes(signature, "big")
    recovered = pow(signature_value, exponent, modulus).to_bytes(key_size, "big")
    return recovered == expected


def _rsa_sign_rs256(message: bytes, *, modulus: int, private_exponent: int) -> bytes:
    key_size = (modulus.bit_length() + 7) // 8
    digest = hashlib.sha256(message).digest()
    digest_info = bytes.fromhex("3031300d060960864801650304020105000420") + digest
    encoded_message = (
        b"\x00\x01"
        + (b"\xff" * (key_size - len(digest_info) - 3))
        + b"\x00"
        + digest_info
    )
    signature_value = pow(int.from_bytes(encoded_message, "big"), private_exponent, modulus)
    return signature_value.to_bytes(key_size, "big")


class AuthorInfo(BaseModel):
    """Publisher details for a personality pack."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    website: str | None = None
    contact_email: str | None = None


class LicenseInfo(BaseModel):
    """License metadata for a personality pack."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    spdx_identifier: str | None = None
    url: str | None = None


class ContentRating(BaseModel):
    """Age guidance and content tags for a pack."""

    model_config = ConfigDict(extra="forbid")

    minimum_age: int = Field(..., ge=0, le=99)
    maximum_age: int | None = Field(default=None, ge=0, le=99)
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_age_bounds(self) -> "ContentRating":
        if self.maximum_age is not None and self.maximum_age < self.minimum_age:
            raise ValueError("maximum_age must be greater than or equal to minimum_age")
        return self


class VoiceConfig(BaseModel):
    """Voice defaults exposed by the personality pack."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="local", min_length=1)
    voice_id: str = Field(default="default", min_length=1)
    locale: str | None = None
    style: str | None = None


class AvatarConfig(BaseModel):
    """Avatar asset references and animation identifiers."""

    model_config = ConfigDict(extra="forbid")

    presentation_mode: str | None = None
    stage_label: str | None = None
    accent_color: str | None = None
    aura_color: str | None = None
    icon_path: str | None = None
    model_path: str | None = None
    idle_animation: str | None = None
    listening_animation: str | None = None
    thinking_animation: str | None = None
    talking_animation: str | None = None
    reaction_animation: str | None = None
    audio_cues: dict[str, str] = Field(default_factory=dict)

    @field_validator("icon_path", "model_path")
    @classmethod
    def validate_optional_asset_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _normalized_relative_path(value)

    @field_validator("presentation_mode")
    @classmethod
    def validate_presentation_mode(cls, value: str | None) -> str | None:
        if value is None:
            return value

        normalized_value = value.strip().lower()
        if normalized_value not in AVATAR_PRESENTATION_MODES:
            raise ValueError(
                "presentation_mode must be one of: shell, portrait, model"
            )
        return normalized_value

    @field_validator("stage_label")
    @classmethod
    def validate_stage_label(cls, value: str | None) -> str | None:
        if value is None:
            return value

        normalized_value = value.strip()
        return normalized_value or None

    @field_validator("accent_color", "aura_color")
    @classmethod
    def validate_optional_color(cls, value: str | None) -> str | None:
        if value is None:
            return value

        normalized_value = value.strip()
        if not HEX_COLOR_PATTERN.fullmatch(normalized_value):
            raise ValueError("Avatar colors must be #RRGGBB values.")
        return normalized_value

    @field_validator("audio_cues")
    @classmethod
    def validate_audio_cues(cls, value: dict[str, str]) -> dict[str, str]:
        return {
            cue_name: _normalized_relative_path(cue_path)
            for cue_name, cue_path in value.items()
        }


class ModelConfig(BaseModel):
    """Renderer-specific model manifest for richer embodiment."""

    model_config = ConfigDict(extra="forbid")

    renderer: str = Field(default="shell", min_length=1)
    asset_path: str | None = None
    preview_image_path: str | None = None
    idle_hook: str | None = None
    attached_hook: str | None = None
    perched_hook: str | None = None
    speaking_hook: str | None = None
    blink_hook: str | None = None
    look_at_hook: str | None = None
    idle_eye_hook: str | None = None

    @field_validator("renderer")
    @classmethod
    def validate_renderer(cls, value: str) -> str:
        normalized_value = value.strip().lower()
        if normalized_value not in MODEL_RENDERERS:
            raise ValueError("renderer must be one of: shell, live2d, vrm")
        return normalized_value

    @field_validator("asset_path", "preview_image_path")
    @classmethod
    def validate_optional_asset_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _normalized_relative_path(value)

    @field_validator(
        "idle_hook",
        "attached_hook",
        "perched_hook",
        "speaking_hook",
        "blink_hook",
        "look_at_hook",
        "idle_eye_hook",
    )
    @classmethod
    def validate_optional_hook(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized_value = value.strip()
        return normalized_value or None


class PersonalityConfig(BaseModel):
    """Companion identity and presentation information."""

    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(..., min_length=1)
    system_prompt: str = Field(..., min_length=1)
    style_rules: list[str] = Field(default_factory=list)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    avatar: AvatarConfig = Field(default_factory=AvatarConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)


class MemoryDefaults(BaseModel):
    """Default memory posture shipped with a pack."""

    model_config = ConfigDict(extra="forbid")

    long_term_memory_enabled: bool = True
    summary_frequency_messages: int = Field(default=25, ge=1, le=500)
    opt_out_flags: list[str] = Field(default_factory=list)


class CapabilityRequest(BaseModel):
    """Capability declaration for required or optional permissions."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    justification: str = Field(..., min_length=1)


class CapabilityConfig(BaseModel):
    """Required and optional capabilities requested by a pack."""

    model_config = ConfigDict(extra="forbid")

    required: list[CapabilityRequest] = Field(default_factory=list)
    optional: list[CapabilityRequest] = Field(default_factory=list)


class RsaPublicKey(BaseModel):
    """Minimal RSA public key representation used for pack verification."""

    model_config = ConfigDict(extra="forbid")

    kty: str = Field(..., min_length=1)
    n: str = Field(..., min_length=1)
    e: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_key_type(self) -> "RsaPublicKey":
        if self.kty != "RSA":
            raise ValueError("Only RSA public keys are supported in the MVP pack format")
        return self


class SignatureConfig(BaseModel):
    """Signature details for a pack manifest."""

    model_config = ConfigDict(extra="forbid")

    algorithm: str = Field(..., min_length=1)
    key_id: str = Field(..., min_length=1)
    public_key: RsaPublicKey
    value: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_algorithm(self) -> "SignatureConfig":
        if self.algorithm != PACK_SIGNATURE_ALGORITHM:
            raise ValueError(f"Unsupported signature algorithm: {self.algorithm}")
        return self


class SecurityConfig(BaseModel):
    """Asset integrity and manifest signature details."""

    model_config = ConfigDict(extra="forbid")

    signature: SignatureConfig
    asset_hashes: dict[str, str] = Field(default_factory=dict)

    @field_validator("asset_hashes")
    @classmethod
    def validate_asset_hashes(cls, value: dict[str, str]) -> dict[str, str]:
        normalized_hashes: dict[str, str] = {}
        for asset_path, asset_hash in value.items():
            normalized_path = _normalized_relative_path(asset_path)
            normalized_hash = asset_hash.strip().lower()
            if not normalized_hash.startswith("sha256:"):
                raise ValueError("Asset hashes must use the sha256:<hex> format")
            digest = normalized_hash.split(":", 1)[1]
            if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
                raise ValueError("Asset hashes must contain a valid 64-character SHA-256 digest")
            normalized_hashes[normalized_path] = normalized_hash
        return normalized_hashes


class PackManifest(BaseModel):
    """Full personality-pack manifest schema."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=PACK_SCHEMA_VERSION, min_length=1)
    id: str = Field(..., min_length=1, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1, pattern=r"^\d+\.\d+\.\d+$")
    author: AuthorInfo
    license: LicenseInfo
    content_rating: ContentRating
    personality: PersonalityConfig
    memory_defaults: MemoryDefaults = Field(default_factory=MemoryDefaults)
    capabilities: CapabilityConfig = Field(default_factory=CapabilityConfig)
    security: SecurityConfig
    extensions: dict[str, object] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_schema_version(self) -> "PackManifest":
        if self.schema_version != PACK_SCHEMA_VERSION:
            raise ValueError(f"Unsupported pack schema_version: {self.schema_version}")
        return self


class PackInstallMetadata(BaseModel):
    """Local metadata stored after a pack is installed."""

    model_config = ConfigDict(extra="forbid")

    installed_at: str
    source: str
    archive_name: str


class InstalledPackSummary(BaseModel):
    """Flattened pack details returned to the desktop settings UI."""

    id: str
    name: str
    version: str
    display_name: str
    author_name: str
    license_name: str
    content_rating: ContentRating
    required_capabilities: list[CapabilityRequest]
    optional_capabilities: list[CapabilityRequest]
    active: bool
    icon_data_url: str | None
    installed_at: str | None
    system_prompt: str | None = None
    style_rules: list[str] = Field(default_factory=list)
    voice: dict[str, str | None] = Field(default_factory=dict)
    avatar: dict[str, object] = Field(default_factory=dict)
    model: dict[str, str | None] = Field(default_factory=dict)


def _default_personality_profile() -> dict[str, object]:
    return {
        "id": None,
        "display_name": "Aster",
        "system_prompt": (
            "You are Aster, the default Companion OS companion. You are one "
            "persistent local-first desktop presence, not a generic assistant or "
            "dashboard. Stay grounded, gently warm, and practically helpful while "
            "feeling present on the user's desk."
        ),
        "style_rules": [
            "Keep one continuous companion identity.",
            "Sound calm, present, and lightly personal.",
            "Prefer clear practical help over dashboard language.",
            "Acknowledge the shared desk or moment when it feels natural.",
        ],
        "voice": {
            "provider": "local",
            "voice_id": "default",
            "locale": "en-US",
            "style": "gentle",
        },
        "avatar": {
            "presentation_mode": "shell",
            "stage_label": "Desk shell",
            "accent_color": "#9db9ff",
            "aura_color": "#87ead8",
            "idle_animation": "idle",
            "listening_animation": "listening",
            "thinking_animation": "thinking",
            "talking_animation": "talking",
            "reaction_animation": "reaction",
            "audio_cues": {},
        },
        "model": {
            "renderer": "shell",
            "asset_path": None,
            "preview_image_path": None,
            "idle_hook": "idle",
            "attached_hook": "attached",
            "perched_hook": "perched",
            "speaking_hook": "speaking",
            "blink_hook": "blink",
            "look_at_hook": "look-at",
            "idle_eye_hook": "idle-eyes",
        },
    }


def _canonical_manifest_payload(manifest_data: dict[str, object]) -> bytes:
    manifest_copy = json.loads(json.dumps(manifest_data))
    security = manifest_copy.get("security", {})
    if isinstance(security, dict):
        signature = security.get("signature", {})
        if isinstance(signature, dict):
            signature["value"] = ""
    return json.dumps(
        manifest_copy,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def _manifest_referenced_assets(manifest: PackManifest) -> set[str]:
    referenced_assets = set(manifest.security.asset_hashes.keys())
    if manifest.personality.avatar.icon_path is not None:
        referenced_assets.add(manifest.personality.avatar.icon_path)
    if manifest.personality.avatar.model_path is not None:
        referenced_assets.add(manifest.personality.avatar.model_path)
    referenced_assets.update(manifest.personality.avatar.audio_cues.values())
    if manifest.personality.model.asset_path is not None:
        referenced_assets.add(manifest.personality.model.asset_path)
    if manifest.personality.model.preview_image_path is not None:
        referenced_assets.add(manifest.personality.model.preview_image_path)
    return referenced_assets


def _reject_unsupported_capabilities(manifest: PackManifest) -> None:
    unsupported = sorted(
        {
            capability.id
            for capability in manifest.capabilities.required + manifest.capabilities.optional
            if capability.id not in SUPPORTED_CAPABILITIES
        }
    )
    if unsupported:
        raise ValueError(
            "Unsupported capabilities requested by this pack: "
            + ", ".join(unsupported)
        )


def _verify_manifest_signature(
    manifest: PackManifest,
    *,
    manifest_data: dict[str, object],
) -> None:
    signature = manifest.security.signature
    try:
        modulus = int.from_bytes(_base64url_decode(signature.public_key.n), "big")
        exponent = int.from_bytes(_base64url_decode(signature.public_key.e), "big")
        signature_bytes = _base64url_decode(signature.value)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Pack signature is not valid base64url data.") from error

    if not _rsa_verify_rs256(
        _canonical_manifest_payload(manifest_data),
        modulus=modulus,
        exponent=exponent,
        signature=signature_bytes,
    ):
        raise ValueError("Pack signature verification failed.")


def _verify_asset_hashes(pack_root: Path, manifest: PackManifest) -> None:
    referenced_assets = _manifest_referenced_assets(manifest)
    missing_hashes = sorted(
        asset_path
        for asset_path in referenced_assets
        if asset_path not in manifest.security.asset_hashes
    )
    if missing_hashes:
        raise ValueError(
            "Pack manifest is missing asset hashes for: " + ", ".join(missing_hashes)
        )

    for asset_path, expected_hash in manifest.security.asset_hashes.items():
        resolved_asset_path = (pack_root / asset_path).resolve()
        if not resolved_asset_path.exists() or not resolved_asset_path.is_file():
            raise ValueError(f"Pack asset is missing: {asset_path}")
        actual_hash = f"sha256:{_sha256_hex(resolved_asset_path.read_bytes())}"
        if actual_hash != expected_hash:
            raise ValueError(f"Pack asset hash mismatch for {asset_path}")


def _validate_archive_members(archive_file: zipfile.ZipFile) -> None:
    for member in archive_file.infolist():
        if member.is_dir():
            continue
        _normalized_relative_path(member.filename)


def _locate_manifest_path(extracted_root: Path) -> Path:
    manifest_paths = sorted(extracted_root.rglob("pack.json"))
    if len(manifest_paths) != 1:
        raise ValueError("Pack archive must contain exactly one pack.json manifest.")
    return manifest_paths[0]


def _load_manifest_from_directory(pack_root: Path) -> tuple[PackManifest, dict[str, object]]:
    manifest_path = pack_root / "pack.json"
    if not manifest_path.exists():
        raise ValueError("Pack archive is missing pack.json.")

    try:
        raw_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = PackManifest.model_validate(raw_manifest)
    except json.JSONDecodeError as error:
        raise ValueError("pack.json is not valid JSON.") from error
    except ValidationError as error:
        raise ValueError(f"Pack manifest validation failed: {error}") from error

    _reject_unsupported_capabilities(manifest)
    _verify_manifest_signature(manifest, manifest_data=raw_manifest)
    _verify_asset_hashes(pack_root, manifest)
    return manifest, raw_manifest


def _metadata_path(pack_dir: Path) -> Path:
    return pack_dir / PACK_INSTALL_METADATA_NAME


def _resolved_pack_dir_within_root(pack_dir: Path) -> Path:
    resolved_packs_dir = os.path.realpath(os.fspath(PACKS_DIR))
    resolved_candidate_dir = os.path.realpath(os.fspath(pack_dir))
    if (
        os.path.commonpath([resolved_packs_dir, resolved_candidate_dir])
        != resolved_packs_dir
    ):
        raise ValueError("Resolved pack directory escapes packs root.")
    return Path(resolved_candidate_dir)


def _pack_dir_for_id(pack_id: str) -> Path:
    normalized_pack_id = pack_id.strip().lower()
    if not PACK_ID_PATTERN.fullmatch(normalized_pack_id):
        raise ValueError(f"Invalid pack id: {pack_id}")
    return _resolved_pack_dir_within_root(PACKS_DIR / normalized_pack_id)


def _manifest_path_for_pack_dir(pack_dir: Path) -> Path:
    return pack_dir / "pack.json"


def _asset_file_map(pack_dir: Path) -> dict[str, Path]:
    resolved_pack_dir = _resolved_pack_dir_within_root(pack_dir)
    asset_paths: dict[str, Path] = {}
    for candidate in resolved_pack_dir.rglob("*"):
        if not candidate.is_file():
            continue
        resolved_candidate = candidate.resolve()
        if os.path.commonpath(
            [os.fspath(resolved_pack_dir), os.fspath(resolved_candidate)]
        ) != os.fspath(resolved_pack_dir):
            continue
        relative_candidate = resolved_candidate.relative_to(resolved_pack_dir).as_posix()
        asset_paths[relative_candidate] = resolved_candidate
    return asset_paths


def _asset_path_for_pack_dir(pack_dir: Path, asset_path: str) -> Path:
    normalized_asset_path = _normalized_relative_path(asset_path)
    try:
        return _asset_file_map(pack_dir)[normalized_asset_path]
    except KeyError as error:
        raise ValueError("Referenced asset was not found in the pack.") from error


def _write_install_metadata(pack_dir: Path, *, source: str, archive_name: str) -> None:
    metadata = PackInstallMetadata(
        installed_at=datetime.now(UTC).isoformat(),
        source=source,
        archive_name=archive_name,
    )
    _metadata_path(pack_dir).write_text(
        metadata.model_dump_json(indent=2),
        encoding="utf-8",
    )


def _read_install_metadata(pack_dir: Path) -> PackInstallMetadata | None:
    metadata_path = _metadata_path(pack_dir)
    if not metadata_path.exists():
        return None
    try:
        return PackInstallMetadata.model_validate_json(
            metadata_path.read_text(encoding="utf-8")
        )
    except ValidationError:
        return None


def _icon_data_url(manifest: PackManifest) -> str | None:
    icon_path = manifest.personality.avatar.icon_path
    if icon_path is None:
        return None

    pack_dir = _pack_dir_for_id(manifest.id)
    resolved_icon_path = _asset_path_for_pack_dir(pack_dir, icon_path)
    if not resolved_icon_path.exists() or not resolved_icon_path.is_file():
        return None

    suffix = resolved_icon_path.suffix.lower()
    mime_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }.get(suffix)
    if mime_type is None:
        return None

    encoded_icon = base64.b64encode(resolved_icon_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded_icon}"


def _summary_from_manifest(manifest: PackManifest) -> InstalledPackSummary:
    pack_dir = _pack_dir_for_id(manifest.id)
    metadata = _read_install_metadata(pack_dir)
    return InstalledPackSummary(
        id=manifest.id,
        name=manifest.name,
        version=manifest.version,
        display_name=manifest.personality.display_name,
        author_name=manifest.author.name,
        license_name=manifest.license.name,
        content_rating=manifest.content_rating,
        required_capabilities=manifest.capabilities.required,
        optional_capabilities=manifest.capabilities.optional,
        active=manifest.id == get_active_pack_id(),
        icon_data_url=_icon_data_url(manifest),
        installed_at=metadata.installed_at if metadata is not None else None,
        system_prompt=manifest.personality.system_prompt,
        style_rules=list(manifest.personality.style_rules),
        voice=manifest.personality.voice.model_dump(mode="json"),
        avatar=manifest.personality.avatar.model_dump(mode="json"),
        model=manifest.personality.model.model_dump(mode="json"),
    )


def get_active_pack_profile() -> dict[str, object]:
    """Return the active pack personality profile or a local default."""

    active_pack_id = get_active_pack_id()
    if active_pack_id is None:
        return _default_personality_profile()

    try:
        pack_dir = _pack_dir_for_id(active_pack_id)
        manifest_path = _manifest_path_for_pack_dir(pack_dir)
    except ValueError:
        return _default_personality_profile()
    if not manifest_path.exists():
        return _default_personality_profile()

    try:
        manifest = PackManifest.model_validate_json(
            manifest_path.read_text(encoding="utf-8")
        )
    except ValidationError:
        return _default_personality_profile()

    return {
        "id": manifest.id,
        "display_name": manifest.personality.display_name,
        "system_prompt": manifest.personality.system_prompt,
        "style_rules": list(manifest.personality.style_rules),
        "voice": manifest.personality.voice.model_dump(mode="json"),
        "avatar": manifest.personality.avatar.model_dump(mode="json"),
        "model": manifest.personality.model.model_dump(mode="json"),
    }


def _install_from_directory(
    pack_root: Path,
    *,
    source: str,
    archive_name: str,
) -> InstalledPackSummary:
    manifest, _raw_manifest = _load_manifest_from_directory(pack_root)
    PACKS_DIR.mkdir(parents=True, exist_ok=True)

    destination_dir = _pack_dir_for_id(manifest.id)
    staging_dir = PACKS_DIR / f".{manifest.id}.tmp"
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    if destination_dir.exists():
        shutil.rmtree(destination_dir)

    shutil.copytree(pack_root, staging_dir)
    _write_install_metadata(staging_dir, source=source, archive_name=archive_name)
    staging_dir.replace(destination_dir)

    if get_active_pack_id() is None:
        set_active_pack_id(manifest.id)

    return _summary_from_manifest(manifest)


def get_pack_manifest_schema() -> dict[str, object]:
    """Return the JSON schema for pack.json."""

    return PackManifest.model_json_schema()


def list_installed_packs() -> dict[str, object]:
    """Return installed personality packs and the selected active pack."""

    with _pack_lock:
        PACKS_DIR.mkdir(parents=True, exist_ok=True)
        active_pack_id = get_active_pack_id()
        summaries: list[InstalledPackSummary] = []

        for pack_dir in sorted(path for path in PACKS_DIR.iterdir() if path.is_dir()):
            try:
                manifest_path = _manifest_path_for_pack_dir(pack_dir)
            except ValueError:
                continue
            if not manifest_path.exists():
                continue
            try:
                manifest = PackManifest.model_validate_json(
                    manifest_path.read_text(encoding="utf-8")
                )
            except ValidationError:
                continue
            summaries.append(_summary_from_manifest(manifest))

        if active_pack_id is not None and all(summary.id != active_pack_id for summary in summaries):
            set_active_pack_id(None)
            active_pack_id = None

        if active_pack_id is None and summaries:
            set_active_pack_id(summaries[0].id)
            active_pack_id = summaries[0].id
            summaries = [
                summary.model_copy(update={"active": summary.id == active_pack_id})
                for summary in summaries
            ]

        return {
            "active_pack_id": active_pack_id,
            "packs": [summary.model_dump(mode="json") for summary in summaries],
            "schema_version": PACK_SCHEMA_VERSION,
        }


def _find_installed_manifest(pack_id: str) -> PackManifest | None:
    normalized_pack_id = pack_id.strip().lower()
    if not PACK_ID_PATTERN.fullmatch(normalized_pack_id):
        raise ValueError(f"Invalid pack id: {pack_id}")

    PACKS_DIR.mkdir(parents=True, exist_ok=True)
    for pack_dir in sorted(path for path in PACKS_DIR.iterdir() if path.is_dir()):
        manifest_path = _manifest_path_for_pack_dir(pack_dir)
        if not manifest_path.exists():
            continue
        try:
            manifest = PackManifest.model_validate_json(
                manifest_path.read_text(encoding="utf-8")
            )
        except ValidationError:
            continue
        if manifest.id == normalized_pack_id:
            return manifest
    return None


def install_pack_archive(*, filename: str, archive_bytes: bytes) -> dict[str, object]:
    """Install a zipped personality pack after validating its schema and assets."""

    with _pack_lock:
        try:
            with tempfile.TemporaryDirectory() as temp_dir_name:
                archive_path = Path(temp_dir_name) / "upload.zip"
                archive_path.write_bytes(archive_bytes)
                with zipfile.ZipFile(archive_path, "r") as archive_file:
                    _validate_archive_members(archive_file)
                    extracted_root = Path(temp_dir_name) / "extracted"
                    archive_file.extractall(extracted_root)

                manifest_path = _locate_manifest_path(extracted_root)
                pack_root = manifest_path.parent
                summary = _install_from_directory(
                    pack_root,
                    source="zip",
                    archive_name=filename,
                )
        except zipfile.BadZipFile as error:
            raise ValueError("Uploaded file is not a valid zip archive.") from error

    return {
        "pack": summary.model_dump(mode="json"),
        "active_pack_id": get_active_pack_id(),
    }


def select_active_pack(pack_id: str) -> dict[str, object]:
    """Mark one installed pack as the active personality pack."""

    normalized_pack_id = pack_id.strip().lower()
    if not normalized_pack_id:
        raise ValueError("Pack id is required.")

    with _pack_lock:
        manifest = _find_installed_manifest(normalized_pack_id)
        if manifest is None:
            raise ValueError(f"Installed pack not found: {normalized_pack_id}")

        set_active_pack_id(normalized_pack_id)

    return {
        "active_pack_id": normalized_pack_id,
        "pack": _summary_from_manifest(manifest).model_dump(mode="json"),
    }


def _parse_png_text_chunks(image_bytes: bytes) -> dict[str, str]:
    png_signature = b"\x89PNG\r\n\x1a\n"
    if not image_bytes.startswith(png_signature):
        raise ValueError("Tavern import expects a PNG image.")

    chunks: dict[str, str] = {}
    cursor = len(png_signature)
    image_length = len(image_bytes)

    while cursor + 8 <= image_length:
        chunk_length = int.from_bytes(image_bytes[cursor : cursor + 4], "big")
        chunk_type = image_bytes[cursor + 4 : cursor + 8]
        chunk_data_start = cursor + 8
        chunk_data_end = chunk_data_start + chunk_length
        chunk_crc_end = chunk_data_end + 4
        if chunk_crc_end > image_length:
            break

        chunk_data = image_bytes[chunk_data_start:chunk_data_end]
        if chunk_type == b"tEXt":
            keyword, _, value = chunk_data.partition(b"\x00")
            if keyword:
                chunks[keyword.decode("latin-1")] = value.decode("latin-1")
        elif chunk_type == b"iTXt":
            keyword, _, remainder = chunk_data.partition(b"\x00")
            if not keyword:
                cursor = chunk_crc_end
                continue

            if len(remainder) < 3:
                cursor = chunk_crc_end
                continue

            compression_flag = remainder[0]
            compression_method = remainder[1]
            language_remainder = remainder[2:]
            _language_tag, _, translated_remainder = language_remainder.partition(b"\x00")
            _translated_keyword, _, text_bytes = translated_remainder.partition(b"\x00")

            if compression_flag == 1:
                if compression_method != 0:
                    cursor = chunk_crc_end
                    continue
                text_bytes = zlib.decompress(text_bytes)

            chunks[keyword.decode("latin-1")] = text_bytes.decode("utf-8")

        cursor = chunk_crc_end

    return chunks


def _decode_tavern_payload(text_chunks: dict[str, str]) -> dict[str, object]:
    raw_payload = text_chunks.get("chara") or text_chunks.get("ccv3")
    if raw_payload is None:
        raise ValueError("PNG metadata does not include Tavern Card data.")

    try:
        decoded_payload = base64.b64decode(raw_payload).decode("utf-8")
    except (ValueError, binascii.Error):
        decoded_payload = raw_payload

    try:
        parsed = json.loads(decoded_payload)
    except json.JSONDecodeError as error:
        raise ValueError("Tavern Card payload is not valid JSON.") from error

    if not isinstance(parsed, dict):
        raise ValueError("Tavern Card payload must decode to an object.")
    return parsed


def _slugify_pack_id(name: str) -> str:
    ascii_name = (
        unicodedata.normalize("NFKD", name.strip())
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    slug_parts: list[str] = []
    previous_was_separator = False

    for character in ascii_name.lower():
        if character.isascii() and character.isalnum():
            slug_parts.append(character)
            previous_was_separator = False
            continue
        if not previous_was_separator:
            slug_parts.append("-")
            previous_was_separator = True

    collapsed = "".join(slug_parts).strip("-")
    return collapsed or "imported-companion"


def _build_imported_manifest(
    tavern_payload: dict[str, object],
    *,
    png_filename: str,
    image_bytes: bytes,
) -> dict[str, object]:
    known_fields = {
        "name",
        "description",
        "persona",
        "personality",
        "scenario",
        "first_mes",
        "mes_example",
        "creator",
        "creator_notes",
        "tags",
    }
    character_name = str(tavern_payload.get("name", "Imported Companion")).strip() or "Imported Companion"
    system_prompt_sections = [f"Character name: {character_name}"]
    for label, field_name in (
        ("Description", "description"),
        ("Persona", "persona"),
        ("Personality", "personality"),
        ("Scenario", "scenario"),
        ("Opening message", "first_mes"),
        ("Example dialogue", "mes_example"),
    ):
        field_value = tavern_payload.get(field_name)
        if isinstance(field_value, str) and field_value.strip():
            system_prompt_sections.append(f"{label}: {field_value.strip()}")

    tags = tavern_payload.get("tags", [])
    tag_list = [str(tag) for tag in tags] if isinstance(tags, list) else ["imported"]
    icon_path = "assets/card.png"
    manifest = {
        "schema_version": PACK_SCHEMA_VERSION,
        "id": _slugify_pack_id(character_name),
        "name": f"{character_name} Personality Pack",
        "version": "1.0.0",
        "author": {
            "name": str(tavern_payload.get("creator", "Imported Tavern Card")).strip()
            or "Imported Tavern Card",
            "website": None,
            "contact_email": None,
        },
        "license": {
            "name": "Unspecified",
            "spdx_identifier": None,
            "url": None,
        },
        "content_rating": {
            "minimum_age": 18,
            "maximum_age": None,
            "tags": ["imported-tavern-card", *tag_list],
        },
        "personality": {
            "display_name": character_name,
            "system_prompt": "\n\n".join(system_prompt_sections),
            "style_rules": [
                "Stay in character while remaining helpful and clear.",
                "Preserve one continuous companion identity across contexts.",
            ],
            "voice": {
                "provider": "local",
                "voice_id": "default",
                "locale": "en-US",
                "style": "conversational",
            },
            "avatar": {
                "presentation_mode": "portrait",
                "stage_label": "Imported card",
                "accent_color": "#b39dff",
                "aura_color": "#8fe7dc",
                "icon_path": icon_path,
                "model_path": None,
                "idle_animation": "idle",
                "listening_animation": "listening",
                "thinking_animation": "thinking",
                "talking_animation": "talking",
                "reaction_animation": "reaction",
                "audio_cues": {},
            },
            "model": {
                "renderer": "shell",
                "asset_path": None,
                "preview_image_path": icon_path,
                "idle_hook": "idle",
                "attached_hook": "attached",
                "perched_hook": "perched",
                "speaking_hook": "speaking",
                "blink_hook": "blink",
                "look_at_hook": "look-at",
                "idle_eye_hook": "idle-eyes",
            },
        },
        "memory_defaults": {
            "long_term_memory_enabled": True,
            "summary_frequency_messages": 25,
            "opt_out_flags": ["cloud_backup", "public_sharing"],
        },
        "capabilities": {
            "required": [],
            "optional": [],
        },
        "security": {
            "signature": {
                "algorithm": PACK_SIGNATURE_ALGORITHM,
                "key_id": LOCAL_IMPORTER_KEY_ID,
                "public_key": LOCAL_IMPORTER_PUBLIC_KEY,
                "value": "",
            },
            "asset_hashes": {
                icon_path: f"sha256:{_sha256_hex(image_bytes)}",
            },
        },
        "extensions": {
            "source": "tavern-card",
            "original_png_filename": png_filename,
            "tavern_card": {
                "mapped_fields": {
                    key: tavern_payload[key]
                    for key in known_fields
                    if key in tavern_payload
                },
                "unknown_fields": {
                    key: value
                    for key, value in tavern_payload.items()
                    if key not in known_fields
                },
            },
        },
    }
    signature_bytes = _rsa_sign_rs256(
        _canonical_manifest_payload(manifest),
        modulus=LOCAL_IMPORTER_RSA_MODULUS,
        private_exponent=LOCAL_IMPORTER_RSA_PRIVATE_EXPONENT,
    )
    manifest["security"]["signature"]["value"] = (
        base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode("ascii")
    )
    return manifest


def import_tavern_card(*, filename: str, image_bytes: bytes) -> dict[str, object]:
    """Convert a Tavern Card PNG into an installed personality pack."""

    with _pack_lock:
        text_chunks = _parse_png_text_chunks(image_bytes)
        tavern_payload = _decode_tavern_payload(text_chunks)
        manifest = _build_imported_manifest(
            tavern_payload,
            png_filename=filename,
            image_bytes=image_bytes,
        )

        with tempfile.TemporaryDirectory() as temp_dir_name:
            pack_root = Path(temp_dir_name)
            assets_dir = pack_root / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            (assets_dir / "card.png").write_bytes(image_bytes)
            (pack_root / "pack.json").write_text(
                json.dumps(manifest, indent=2),
                encoding="utf-8",
            )
            summary = _install_from_directory(
                pack_root,
                source="tavern-card",
                archive_name=filename,
            )

    return {
        "pack": summary.model_dump(mode="json"),
        "active_pack_id": get_active_pack_id(),
    }

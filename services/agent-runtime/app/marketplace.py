"""Curated marketplace foundations for personality packs and skills."""

from __future__ import annotations

import base64
import io
import json
import zipfile
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.personality_packs import (
    CapabilityRequest,
    ContentRating,
    LOCAL_IMPORTER_KEY_ID,
    LOCAL_IMPORTER_PUBLIC_KEY,
    LOCAL_IMPORTER_RSA_MODULUS,
    LOCAL_IMPORTER_RSA_PRIVATE_EXPONENT,
    PACK_SIGNATURE_ALGORITHM,
    SUPPORTED_CAPABILITIES,
    _base64url_decode,
    _canonical_manifest_payload,
    _rsa_sign_rs256,
    _rsa_verify_rs256,
    _sha256_hex,
)


MARKETPLACE_SCHEMA_VERSION: Final[str] = "1.0"
MARKETPLACE_SIGNATURE_KEY_ID: Final[str] = "curated-marketplace-rs256"
PACK_ICON_BASE64: Final[str] = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zk2QAAAAASUVORK5CYII="
)
PACK_ICON_BYTES: Final[bytes] = base64.b64decode(PACK_ICON_BASE64)
PACK_ICON_DATA_URL: Final[str] = f"data:image/png;base64,{PACK_ICON_BASE64}"


class MarketplacePublisher(BaseModel):
    """Publisher metadata for one marketplace listing."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    website: str | None = None
    signature_key_id: str = Field(..., min_length=1)


class MarketplacePrice(BaseModel):
    """Price label for a curated listing."""

    model_config = ConfigDict(extra="forbid")

    is_free: bool
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = None
    label: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_price(self) -> "MarketplacePrice":
        if self.is_free:
            if self.amount not in {None, 0, 0.0}:
                raise ValueError("Free listings must not set a paid amount.")
            return self

        if self.amount is None or self.currency is None:
            raise ValueError("Paid listings require amount and currency.")
        return self


class RevenueShare(BaseModel):
    """Revenue split shown for paid marketplace content."""

    model_config = ConfigDict(extra="forbid")

    creator_percent: int = Field(..., ge=0, le=100)
    platform_percent: int = Field(..., ge=0, le=100)
    payment_processor_percent: int = Field(..., ge=0, le=100)

    @model_validator(mode="after")
    def validate_total(self) -> "RevenueShare":
        total = (
            self.creator_percent
            + self.platform_percent
            + self.payment_processor_percent
        )
        if total != 100:
            raise ValueError("Revenue share percentages must add up to 100.")
        return self


class PublisherSignature(BaseModel):
    """Listing signature used for curated marketplace metadata."""

    model_config = ConfigDict(extra="forbid")

    algorithm: str = Field(..., min_length=1)
    key_id: str = Field(..., min_length=1)
    public_key: dict[str, str]
    value: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_algorithm(self) -> "PublisherSignature":
        if self.algorithm != PACK_SIGNATURE_ALGORITHM:
            raise ValueError(
                f"Unsupported marketplace signature algorithm: {self.algorithm}"
            )
        return self


class AutomatedScan(BaseModel):
    """Automated moderation or security scan result."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    status: Literal["passed", "flagged", "pending"]
    summary: str = Field(..., min_length=1)


class ManualReview(BaseModel):
    """Manual moderation review result."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["approved", "needs_changes", "rejected"]
    reviewer: str = Field(..., min_length=1)
    reviewed_at: str = Field(..., min_length=1)
    notes: str = Field(..., min_length=1)


class ModerationRecord(BaseModel):
    """Moderation workflow state for one listing."""

    model_config = ConfigDict(extra="forbid")

    automated_scans: list[AutomatedScan]
    manual_review: ManualReview
    install_allowed: bool


class IPDeclaration(BaseModel):
    """Rights declaration required for curated personality packs."""

    model_config = ConfigDict(extra="forbid")

    rights_confirmed: bool
    asset_sources: list[str] = Field(default_factory=list)
    notes: str = Field(..., min_length=1)


class LicenseDeclaration(BaseModel):
    """License metadata shown in the marketplace."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1)
    spdx_identifier: str | None = None
    url: str | None = None


class MarketplaceListing(BaseModel):
    """Curated marketplace listing metadata."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=MARKETPLACE_SCHEMA_VERSION, min_length=1)
    id: str = Field(..., min_length=1)
    kind: Literal["personality_pack", "skill"]
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    publisher: MarketplacePublisher
    license: LicenseDeclaration
    required_capabilities: list[CapabilityRequest] = Field(default_factory=list)
    optional_capabilities: list[CapabilityRequest] = Field(default_factory=list)
    price: MarketplacePrice
    revenue_share: RevenueShare
    moderation: ModerationRecord
    publisher_signature: PublisherSignature
    content_rating: ContentRating | None = None
    ip_declaration: IPDeclaration | None = None
    install_supported: bool = False
    core_feature: bool = False
    icon_data_url: str | None = None

    @model_validator(mode="after")
    def validate_listing(self) -> "MarketplaceListing":
        if self.schema_version != MARKETPLACE_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported marketplace schema_version: {self.schema_version}"
            )

        capability_ids = {
            capability.id
            for capability in self.required_capabilities + self.optional_capabilities
        }
        unsupported_capabilities = sorted(
            capability_id
            for capability_id in capability_ids
            if capability_id not in SUPPORTED_CAPABILITIES
        )
        if unsupported_capabilities:
            raise ValueError(
                "Marketplace listing requests unsupported capabilities: "
                + ", ".join(unsupported_capabilities)
            )

        if self.kind == "personality_pack":
            if self.content_rating is None:
                raise ValueError("Personality-pack listings require content_rating.")
            if self.ip_declaration is None:
                raise ValueError("Personality-pack listings require ip_declaration.")
            if not self.ip_declaration.rights_confirmed:
                raise ValueError(
                    "Personality-pack listings must confirm IP ownership or rights."
                )

        if self.install_supported:
            if self.kind != "personality_pack":
                raise ValueError(
                    "Only personality-pack listings can be installed in the MVP."
                )
            if not self.price.is_free:
                raise ValueError("Paid listings are not installable in the MVP.")
            if not self.moderation.install_allowed:
                raise ValueError("Installable listings must be moderation-approved.")
            if self.moderation.manual_review.status != "approved":
                raise ValueError("Installable listings require manual approval.")
            pending_or_flagged = [
                scan.label
                for scan in self.moderation.automated_scans
                if scan.status != "passed"
            ]
            if pending_or_flagged:
                raise ValueError(
                    "Installable listings require all automated scans to pass: "
                    + ", ".join(pending_or_flagged)
                )

        return self


def _canonical_listing_payload(listing_data: dict[str, object]) -> bytes:
    listing_copy = json.loads(json.dumps(listing_data))
    signature = listing_copy.get("publisher_signature", {})
    if isinstance(signature, dict):
        signature["value"] = ""
    return json.dumps(
        listing_copy,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def _sign_listing(listing_data: dict[str, object]) -> dict[str, object]:
    signature_bytes = _rsa_sign_rs256(
        _canonical_listing_payload(listing_data),
        modulus=LOCAL_IMPORTER_RSA_MODULUS,
        private_exponent=LOCAL_IMPORTER_RSA_PRIVATE_EXPONENT,
    )
    listing_data["publisher_signature"]["value"] = (
        base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode("ascii")
    )
    return listing_data


def _verify_listing_signature(listing: MarketplaceListing) -> None:
    signature = listing.publisher_signature
    signature_bytes = _base64url_decode(signature.value)
    modulus = int.from_bytes(_base64url_decode(signature.public_key["n"]), "big")
    exponent = int.from_bytes(_base64url_decode(signature.public_key["e"]), "big")

    if not _rsa_verify_rs256(
        _canonical_listing_payload(listing.model_dump(mode="json")),
        modulus=modulus,
        exponent=exponent,
        signature=signature_bytes,
    ):
        raise ValueError(f"Marketplace signature verification failed for {listing.id}.")


def _base_listing(
    *,
    listing_id: str,
    kind: Literal["personality_pack", "skill"],
    name: str,
    description: str,
    version: str,
    required_capabilities: list[dict[str, str]],
    optional_capabilities: list[dict[str, str]],
    price: dict[str, object],
    moderation: dict[str, object],
    license_name: str,
    content_rating: dict[str, object] | None = None,
    ip_declaration: dict[str, object] | None = None,
    install_supported: bool = False,
    core_feature: bool = False,
) -> dict[str, object]:
    return {
        "schema_version": MARKETPLACE_SCHEMA_VERSION,
        "id": listing_id,
        "kind": kind,
        "name": name,
        "description": description,
        "version": version,
        "publisher": {
            "id": "companion-labs",
            "name": "Companion Labs",
            "website": "https://companion-os.local",
            "signature_key_id": MARKETPLACE_SIGNATURE_KEY_ID,
        },
        "license": {
            "name": license_name,
            "spdx_identifier": license_name,
            "url": None,
        },
        "required_capabilities": required_capabilities,
        "optional_capabilities": optional_capabilities,
        "price": price,
        "revenue_share": {
            "creator_percent": 70,
            "platform_percent": 20,
            "payment_processor_percent": 10,
        },
        "moderation": moderation,
        "publisher_signature": {
            "algorithm": PACK_SIGNATURE_ALGORITHM,
            "key_id": MARKETPLACE_SIGNATURE_KEY_ID,
            "public_key": LOCAL_IMPORTER_PUBLIC_KEY,
            "value": "",
        },
        "content_rating": content_rating,
        "ip_declaration": ip_declaration,
        "install_supported": install_supported,
        "core_feature": core_feature,
        "icon_data_url": PACK_ICON_DATA_URL if kind == "personality_pack" else None,
    }


def _seed_listing_payloads() -> list[dict[str, object]]:
    approved_moderation = {
        "automated_scans": [
            {
                "id": "malware",
                "label": "Malware scan",
                "status": "passed",
                "summary": "Archive contents are clean and match the signed manifest.",
            },
            {
                "id": "capabilities",
                "label": "Capability audit",
                "status": "passed",
                "summary": "Requested capabilities stay within the supported allowlist.",
            },
            {
                "id": "content",
                "label": "Content classifier",
                "status": "passed",
                "summary": "Content labels align with the declared age guidance.",
            },
            {
                "id": "licensing",
                "label": "License compliance",
                "status": "passed",
                "summary": "Declared assets and licensing terms passed review.",
            },
        ],
        "manual_review": {
            "status": "approved",
            "reviewer": "Marketplace moderation",
            "reviewed_at": "2026-03-29T09:00:00+10:00",
            "notes": "Curated starter content approved for the MVP marketplace.",
        },
        "install_allowed": True,
    }

    bloom_pack = _base_listing(
        listing_id="bloom-starter-pack",
        kind="personality_pack",
        name="Bloom Starter Pack",
        description=(
            "A warm, low-drama starter identity for the local companion. "
            "It keeps replies steady, supportive, and practical."
        ),
        version="1.0.0",
        required_capabilities=[
            {
                "id": "overlay.render",
                "justification": "Render the active companion on the desktop overlay.",
            }
        ],
        optional_capabilities=[
            {
                "id": "browser.open",
                "justification": "Open links only when the user explicitly asks.",
            }
        ],
        price={"is_free": True, "amount": None, "currency": None, "label": "Free"},
        moderation=approved_moderation,
        license_name="CC-BY-4.0",
        content_rating={
            "minimum_age": 13,
            "maximum_age": None,
            "tags": ["friendly", "cozy", "starter"],
        },
        ip_declaration={
            "rights_confirmed": True,
            "asset_sources": [
                "Original prompt and art direction by Companion Labs",
                "Local icon asset licensed for redistribution",
            ],
            "notes": (
                "This curated pack includes only rights-cleared assets and may be "
                "installed locally without extra payment."
            ),
        },
        install_supported=True,
        core_feature=True,
    )

    paid_pack = _base_listing(
        listing_id="aurora-host-pack",
        kind="personality_pack",
        name="Aurora Host Pack",
        description=(
            "A higher-energy stream-facing identity with brighter reactions and "
            "a more performative tone for creators."
        ),
        version="1.2.0",
        required_capabilities=[
            {
                "id": "overlay.render",
                "justification": "Render the active host pack on stream overlays.",
            },
            {
                "id": "notifications.show",
                "justification": "Show local reaction bubbles for supported stream events.",
            },
        ],
        optional_capabilities=[
            {
                "id": "network.http",
                "justification": "Fetch optional creator update notes when allowed.",
            }
        ],
        price={
            "is_free": False,
            "amount": 12.0,
            "currency": "USD",
            "label": "Paid",
        },
        moderation={
            **approved_moderation,
            "install_allowed": False,
        },
        license_name="Commercial",
        content_rating={
            "minimum_age": 16,
            "maximum_age": None,
            "tags": ["streaming", "creator", "expressive"],
        },
        ip_declaration={
            "rights_confirmed": True,
            "asset_sources": [
                "Original prompts and avatar concept licensed by the publisher",
            ],
            "notes": "Paid creator content with curated IP declarations on file.",
        },
        install_supported=False,
        core_feature=False,
    )

    skill_listing = _base_listing(
        listing_id="creator-shortcuts-skill",
        kind="skill",
        name="Creator Shortcuts",
        description=(
            "A curated skill listing for creator-friendly shortcuts and upload "
            "helpers. Browsable today, install flow later."
        ),
        version="0.9.0",
        required_capabilities=[
            {
                "id": "filesystem.read",
                "justification": "Read local shortcut targets chosen by the user.",
            }
        ],
        optional_capabilities=[
            {
                "id": "network.http",
                "justification": "Reach creator endpoints when the user allows it.",
            }
        ],
        price={"is_free": True, "amount": None, "currency": None, "label": "Free"},
        moderation={
            "automated_scans": [
                {
                    "id": "malware",
                    "label": "Malware scan",
                    "status": "passed",
                    "summary": "Package metadata is clean.",
                },
                {
                    "id": "capabilities",
                    "label": "Capability audit",
                    "status": "passed",
                    "summary": "Requested skill capabilities match the allowlist.",
                },
            ],
            "manual_review": {
                "status": "approved",
                "reviewer": "Marketplace moderation",
                "reviewed_at": "2026-03-29T09:10:00+10:00",
                "notes": "Metadata approved. Installer path will ship in a later slice.",
            },
            "install_allowed": False,
        },
        license_name="MIT",
        install_supported=False,
        core_feature=False,
    )

    return [_sign_listing(bloom_pack), _sign_listing(paid_pack), _sign_listing(skill_listing)]


def _load_curated_listings() -> list[MarketplaceListing]:
    listings: list[MarketplaceListing] = []
    for raw_listing in _seed_listing_payloads():
        try:
            listing = MarketplaceListing.model_validate(raw_listing)
        except ValidationError as error:
            raise ValueError(
                f"Curated marketplace listing is invalid: {error}"
            ) from error
        _verify_listing_signature(listing)
        listings.append(listing)
    return listings


def _build_pack_archive_for_listing(listing: MarketplaceListing) -> bytes:
    if listing.kind != "personality_pack":
        raise ValueError("Only personality-pack listings can produce a pack archive.")
    if listing.content_rating is None:
        raise ValueError("Pack listings require content rating metadata.")

    manifest = {
        "schema_version": "1.0",
        "id": listing.id,
        "name": listing.name,
        "version": listing.version,
        "author": {
            "name": listing.publisher.name,
            "website": listing.publisher.website,
            "contact_email": None,
        },
        "license": {
            "name": listing.license.name,
            "spdx_identifier": listing.license.spdx_identifier,
            "url": listing.license.url,
        },
        "content_rating": listing.content_rating.model_dump(mode="json"),
        "personality": {
            "display_name": listing.name.replace(" Pack", ""),
            "system_prompt": (
                "You are one persistent desktop companion. Stay warm, clear, and "
                "practical. Keep the user oriented while preserving continuity."
            ),
            "style_rules": [
                "Speak like one continuous companion, not a mode switch.",
                "Keep the experience local-first and calm.",
            ],
            "voice": {
                "provider": "local",
                "voice_id": "default",
                "locale": "en-US",
                "style": "warm",
            },
            "avatar": {
                "icon_path": "assets/icon.png",
                "model_path": None,
                "idle_animation": "idle",
                "listening_animation": "listening",
                "thinking_animation": "thinking",
                "talking_animation": "talking",
                "reaction_animation": "reaction",
                "audio_cues": {},
            },
        },
        "memory_defaults": {
            "long_term_memory_enabled": True,
            "summary_frequency_messages": 25,
            "opt_out_flags": ["cloud_backup"],
        },
        "capabilities": {
            "required": [
                capability.model_dump(mode="json")
                for capability in listing.required_capabilities
            ],
            "optional": [
                capability.model_dump(mode="json")
                for capability in listing.optional_capabilities
            ],
        },
        "security": {
            "signature": {
                "algorithm": PACK_SIGNATURE_ALGORITHM,
                "key_id": LOCAL_IMPORTER_KEY_ID,
                "public_key": LOCAL_IMPORTER_PUBLIC_KEY,
                "value": "",
            },
            "asset_hashes": {
                "assets/icon.png": f"sha256:{_sha256_hex(PACK_ICON_BYTES)}",
            },
        },
        "extensions": {
            "marketplace": {
                "listing_id": listing.id,
                "publisher_id": listing.publisher.id,
                "price_label": listing.price.label,
            }
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

    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive_file:
        archive_file.writestr("pack.json", json.dumps(manifest, indent=2))
        archive_file.writestr("assets/icon.png", PACK_ICON_BYTES)
    return archive_buffer.getvalue()


def list_marketplace_listings() -> dict[str, object]:
    """Return curated marketplace listings for packs and skills."""

    listings = _load_curated_listings()
    return {
        "schema_version": MARKETPLACE_SCHEMA_VERSION,
        "listings": [listing.model_dump(mode="json") for listing in listings],
    }


def get_marketplace_listing(listing_id: str) -> dict[str, object]:
    """Return one curated marketplace listing by id."""

    normalized_listing_id = listing_id.strip().lower()
    for listing in _load_curated_listings():
        if listing.id == normalized_listing_id:
            return listing.model_dump(mode="json")
    raise ValueError(f"Marketplace listing not found: {normalized_listing_id}")


def install_marketplace_listing(listing_id: str) -> dict[str, object]:
    """Install one approved free marketplace personality pack."""

    normalized_listing_id = listing_id.strip().lower()
    listing: MarketplaceListing | None = None
    for candidate in _load_curated_listings():
        if candidate.id == normalized_listing_id:
            listing = candidate
            break

    if listing is None:
        raise ValueError(f"Marketplace listing not found: {normalized_listing_id}")
    if not listing.install_supported:
        if listing.price.is_free:
            raise ValueError(
                "This marketplace listing is browse-only in the MVP and cannot be "
                "installed yet."
            )
        raise ValueError(
            "Paid marketplace listings are shown for discovery only in the MVP."
        )

    archive_bytes = _build_pack_archive_for_listing(listing)
    from app.personality_packs import install_pack_archive

    install_result = install_pack_archive(
        filename=f"{listing.id}.zip",
        archive_bytes=archive_bytes,
    )
    return {
        "listing": listing.model_dump(mode="json"),
        **install_result,
    }

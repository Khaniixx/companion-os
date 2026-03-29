from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.installer as installer
import app.marketplace as marketplace
import app.personality_packs as personality_packs
import app.preferences as preferences
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def temp_state_files(tmp_path, monkeypatch) -> Path:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")
    monkeypatch.setattr(personality_packs, "PACKS_DIR", tmp_path / "personality_packs")
    return tmp_path


def test_list_marketplace_listings_returns_curated_catalog() -> None:
    response = client.get("/api/marketplace/listings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.0"
    assert [listing["id"] for listing in payload["listings"]] == [
        "bloom-starter-pack",
        "aurora-host-pack",
        "creator-shortcuts-skill",
    ]
    assert payload["listings"][0]["moderation"]["manual_review"]["status"] == "approved"
    assert payload["listings"][0]["content_rating"]["minimum_age"] == 13
    assert payload["listings"][1]["price"] == {
        "is_free": False,
        "amount": 12.0,
        "currency": "USD",
        "label": "Paid",
    }


def test_install_marketplace_listing_installs_approved_free_pack() -> None:
    response = client.post("/api/marketplace/listings/bloom-starter-pack/install")

    assert response.status_code == 200
    payload = response.json()
    assert payload["listing"]["id"] == "bloom-starter-pack"
    assert payload["pack"]["display_name"] == "Bloom Starter"
    assert payload["active_pack_id"] == "bloom-starter-pack"

    list_response = client.get("/api/packs")
    assert list_response.status_code == 200
    assert list_response.json()["active_pack_id"] == "bloom-starter-pack"


def test_install_marketplace_listing_rejects_paid_listing() -> None:
    response = client.post("/api/marketplace/listings/aurora-host-pack/install")

    assert response.status_code == 400
    assert "Paid marketplace listings are shown for discovery only" in response.json()[
        "detail"
    ]


def test_marketplace_listing_requires_pack_safety_metadata() -> None:
    raw_listing = marketplace._base_listing(
        listing_id="broken-pack",
        kind="personality_pack",
        name="Broken Pack",
        description="Missing age rating and IP declaration.",
        version="1.0.0",
        required_capabilities=[],
        optional_capabilities=[],
        price={"is_free": True, "amount": None, "currency": None, "label": "Free"},
        moderation={
            "automated_scans": [
                {
                    "id": "malware",
                    "label": "Malware scan",
                    "status": "passed",
                    "summary": "Clean.",
                }
            ],
            "manual_review": {
                "status": "approved",
                "reviewer": "Marketplace moderation",
                "reviewed_at": "2026-03-29T09:00:00+10:00",
                "notes": "Approved.",
            },
            "install_allowed": True,
        },
        license_name="MIT",
        install_supported=True,
    )
    marketplace._sign_listing(raw_listing)

    with pytest.raises(ValidationError):
        marketplace.MarketplaceListing.model_validate(raw_listing)


def test_marketplace_listing_rejects_unsupported_capabilities() -> None:
    raw_listing = marketplace._base_listing(
        listing_id="unsupported-pack",
        kind="personality_pack",
        name="Unsupported Pack",
        description="Requests a capability outside the MVP allowlist.",
        version="1.0.0",
        required_capabilities=[
            {
                "id": "dangerous.unsupported",
                "justification": "This should never pass validation.",
            }
        ],
        optional_capabilities=[],
        price={"is_free": True, "amount": None, "currency": None, "label": "Free"},
        moderation={
            "automated_scans": [
                {
                    "id": "malware",
                    "label": "Malware scan",
                    "status": "passed",
                    "summary": "Clean.",
                },
                {
                    "id": "content",
                    "label": "Content classifier",
                    "status": "passed",
                    "summary": "Aligned.",
                },
            ],
            "manual_review": {
                "status": "approved",
                "reviewer": "Marketplace moderation",
                "reviewed_at": "2026-03-29T09:00:00+10:00",
                "notes": "Approved.",
            },
            "install_allowed": True,
        },
        license_name="MIT",
        content_rating={
            "minimum_age": 13,
            "maximum_age": None,
            "tags": ["test"],
        },
        ip_declaration={
            "rights_confirmed": True,
            "asset_sources": ["Original asset"],
            "notes": "Rights cleared.",
        },
        install_supported=True,
    )
    marketplace._sign_listing(raw_listing)

    with pytest.raises(ValidationError):
        marketplace.MarketplaceListing.model_validate(raw_listing)

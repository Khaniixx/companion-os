import base64
import io
import json
import struct
import zlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.installer as installer
import app.personality_packs as personality_packs
import app.preferences as preferences
from app.main import app


client = TestClient(app)

PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zk2QAAAAASUVORK5CYII="
)


@pytest.fixture(autouse=True)
def temp_state_files(tmp_path, monkeypatch) -> Path:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer_state.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")
    monkeypatch.setattr(personality_packs, "PACKS_DIR", tmp_path / "personality_packs")
    return tmp_path


def _sign_manifest(manifest: dict[str, object]) -> dict[str, object]:
    signature_bytes = personality_packs._rsa_sign_rs256(
        personality_packs._canonical_manifest_payload(manifest),
        modulus=personality_packs.LOCAL_IMPORTER_RSA_MODULUS,
        private_exponent=personality_packs.LOCAL_IMPORTER_RSA_PRIVATE_EXPONENT,
    )
    manifest["security"]["signature"]["value"] = (
        base64.urlsafe_b64encode(signature_bytes).rstrip(b"=").decode("ascii")
    )
    return manifest


def make_pack_archive(
    *,
    pack_id: str = "sunrise-companion",
    display_name: str = "Sunrise",
    required_capabilities: list[dict[str, str]] | None = None,
) -> bytes:
    icon_bytes = base64.b64decode(PNG_1X1_BASE64)
    manifest = {
        "schema_version": "1.0",
        "id": pack_id,
        "name": f"{display_name} Pack",
        "version": "1.0.0",
        "author": {
            "name": "Companion Labs",
            "website": "https://example.com",
            "contact_email": "packs@example.com",
        },
        "license": {
            "name": "MIT",
            "spdx_identifier": "MIT",
            "url": "https://opensource.org/license/mit",
        },
        "content_rating": {
            "minimum_age": 13,
            "maximum_age": None,
            "tags": ["friendly", "local-first"],
        },
        "personality": {
            "display_name": display_name,
            "system_prompt": "Stay warm, grounded, and practical.",
            "style_rules": [
                "Speak clearly.",
                "Keep one persistent companion identity.",
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
            "required": required_capabilities or [
                {
                    "id": "overlay.render",
                    "justification": "Show the selected companion on screen.",
                }
            ],
            "optional": [
                {
                    "id": "network.http",
                    "justification": "Fetch optional remote assets when the user allows it.",
                }
            ],
        },
        "security": {
            "signature": {
                "algorithm": "RS256",
                "key_id": personality_packs.LOCAL_IMPORTER_KEY_ID,
                "public_key": personality_packs.LOCAL_IMPORTER_PUBLIC_KEY,
                "value": "",
            },
            "asset_hashes": {
                "assets/icon.png": f"sha256:{personality_packs._sha256_hex(icon_bytes)}",
            },
        },
        "extensions": {},
    }
    _sign_manifest(manifest)

    archive_buffer = io.BytesIO()
    with personality_packs.zipfile.ZipFile(archive_buffer, "w") as archive_file:
        archive_file.writestr("pack.json", json.dumps(manifest, indent=2))
        archive_file.writestr("assets/icon.png", icon_bytes)
    return archive_buffer.getvalue()


def make_tavern_card_png(*, character_name: str = "Imported Friend") -> bytes:
    png_bytes = bytearray(base64.b64decode(PNG_1X1_BASE64))
    tavern_payload = {
        "name": character_name,
        "description": "A calm local companion.",
        "persona": "Helpful and grounded.",
        "first_mes": "Hi. I am here and ready.",
        "creator": "Tavern Maker",
        "tags": ["cozy"],
        "unknown_custom_field": {"mood": "gentle"},
    }
    encoded_payload = base64.b64encode(json.dumps(tavern_payload).encode("utf-8"))
    text_data = b"chara\x00" + encoded_payload
    text_chunk = (
        struct.pack(">I", len(text_data))
        + b"tEXt"
        + text_data
        + struct.pack(">I", zlib.crc32(b"tEXt" + text_data) & 0xFFFFFFFF)
    )
    return bytes(png_bytes[:-12] + text_chunk + png_bytes[-12:])


def test_list_packs_starts_empty() -> None:
    response = client.get("/api/packs")

    assert response.status_code == 200
    assert response.json() == {
        "active_pack_id": None,
        "packs": [],
        "schema_version": "1.0",
    }


def test_default_active_pack_profile_is_intentional_when_no_pack_is_selected() -> None:
    profile = personality_packs.get_active_pack_profile()

    assert profile["display_name"] == "Aster"
    assert "default Companion OS companion" in profile["system_prompt"]
    assert "Sound calm, present, and lightly personal." in profile["style_rules"]
    assert profile["voice"]["style"] == "gentle"


def test_install_pack_archive_persists_and_auto_selects() -> None:
    archive_bytes = make_pack_archive()

    response = client.post(
        "/api/packs/install",
        json={
            "filename": "sunrise-pack.zip",
            "archive_base64": base64.b64encode(archive_bytes).decode("ascii"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_pack_id"] == "sunrise-companion"
    assert payload["pack"]["display_name"] == "Sunrise"
    assert payload["pack"]["active"] is True

    list_response = client.get("/api/packs")
    assert list_response.status_code == 200
    assert list_response.json()["packs"][0]["required_capabilities"] == [
        {
            "id": "overlay.render",
            "justification": "Show the selected companion on screen.",
        }
    ]
    assert preferences.get_active_pack_id() == "sunrise-companion"


def test_select_active_pack_switches_between_installed_packs() -> None:
    first_archive = make_pack_archive(pack_id="sunrise-companion", display_name="Sunrise")
    second_archive = make_pack_archive(pack_id="evening-companion", display_name="Evening")

    first_response = client.post(
        "/api/packs/install",
        json={
            "filename": "sunrise-pack.zip",
            "archive_base64": base64.b64encode(first_archive).decode("ascii"),
        },
    )
    second_response = client.post(
        "/api/packs/install",
        json={
            "filename": "evening-pack.zip",
            "archive_base64": base64.b64encode(second_archive).decode("ascii"),
        },
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert client.get("/api/packs").json()["active_pack_id"] == "sunrise-companion"

    select_response = client.put(
        "/api/packs/active",
        json={"pack_id": "evening-companion"},
    )

    assert select_response.status_code == 200
    assert select_response.json()["active_pack_id"] == "evening-companion"
    assert select_response.json()["pack"]["active"] is True


def test_install_pack_rejects_unsupported_capability() -> None:
    archive_bytes = make_pack_archive(
        required_capabilities=[
            {
                "id": "dangerous.unsupported",
                "justification": "This should be rejected.",
            }
        ]
    )

    response = client.post(
        "/api/packs/install",
        json={
            "filename": "bad-pack.zip",
            "archive_base64": base64.b64encode(archive_bytes).decode("ascii"),
        },
    )

    assert response.status_code == 400
    assert "Unsupported capabilities requested by this pack" in response.json()["detail"]


def test_install_pack_rejects_invalid_signature() -> None:
    archive_bytes = make_pack_archive()
    archive_buffer = io.BytesIO(archive_bytes)

    updated_buffer = io.BytesIO()
    with personality_packs.zipfile.ZipFile(archive_buffer, "r") as source_archive:
        with personality_packs.zipfile.ZipFile(updated_buffer, "w") as target_archive:
            for member in source_archive.infolist():
                member_bytes = source_archive.read(member.filename)
                if member.filename == "pack.json":
                    manifest = json.loads(member_bytes.decode("utf-8"))
                    manifest["personality"]["display_name"] = "Tampered"
                    member_bytes = json.dumps(manifest, indent=2).encode("utf-8")
                target_archive.writestr(member.filename, member_bytes)

    response = client.post(
        "/api/packs/install",
        json={
            "filename": "tampered-pack.zip",
            "archive_base64": base64.b64encode(updated_buffer.getvalue()).decode("ascii"),
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Pack signature verification failed."


def test_import_tavern_card_creates_pack_with_local_signature(tmp_path: Path) -> None:
    response = client.post(
        "/api/packs/import-tavern-card",
        json={
            "filename": "imported-friend.png",
            "image_base64": base64.b64encode(make_tavern_card_png()).decode("ascii"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pack"]["display_name"] == "Imported Friend"
    assert payload["pack"]["active"] is True

    installed_manifest = (
        personality_packs.PACKS_DIR / "imported-friend" / "pack.json"
    )
    assert installed_manifest.exists()
    manifest_payload = json.loads(installed_manifest.read_text(encoding="utf-8"))
    assert (
        manifest_payload["extensions"]["tavern_card"]["unknown_fields"]["unknown_custom_field"]
        == {"mood": "gentle"}
    )


def test_import_tavern_card_normalizes_non_ascii_pack_id() -> None:
    response = client.post(
        "/api/packs/import-tavern-card",
        json={
            "filename": "eva-card.png",
            "image_base64": base64.b64encode(
                make_tavern_card_png(character_name="Éva Čaj")
            ).decode("ascii"),
        },
    )

    assert response.status_code == 200
    assert response.json()["pack"]["id"] == "eva-caj"
    assert (personality_packs.PACKS_DIR / "eva-caj" / "pack.json").exists()


def test_pack_schema_endpoint_returns_schema() -> None:
    response = client.get("/api/packs/schema")

    assert response.status_code == 200
    assert "properties" in response.json()["schema"]

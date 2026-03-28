from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.installer as installer
import app.preferences as preferences
from app.main import app
from app.tools.open_app import OpenAppResult


client = TestClient(app)


@pytest.fixture(autouse=True)
def temp_preferences_file(tmp_path, monkeypatch) -> Path:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer_state.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")
    return preferences_file


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_echoes_message() -> None:
    response = client.post("/api/chat", json={"message": "hello companion"})

    assert response.status_code == 200
    assert response.json() == {"message": "Echo: hello companion"}


def test_installer_status_returns_default_state() -> None:
    response = client.get("/api/installer/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["environment"]["all_ready"] is False
    assert payload["openclaw"]["installed"] is False
    assert payload["ai"]["provider"] == "local"
    assert payload["connection"]["connected"] is False


def test_installer_environment_check(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.check_environment",
        lambda: {
            "node_installed": True,
            "rust_installed": True,
            "cpp_toolchain_installed": False,
            "missing_prerequisites": ["C++ Toolchain"],
            "all_ready": False,
        },
    )

    response = client.post("/api/installer/environment-check")

    assert response.status_code == 200
    assert response.json() == {
        "node_installed": True,
        "rust_installed": True,
        "cpp_toolchain_installed": False,
        "missing_prerequisites": ["C++ Toolchain"],
        "all_ready": False,
    }


def test_prepare_prerequisites_returns_result(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.prepare_prerequisites",
        lambda: {
            "attempted": True,
            "installed": ["Node.js"],
            "remaining": [],
            "message": "Prerequisite preparation finished.",
            "environment": {
                "node_installed": True,
                "rust_installed": True,
                "cpp_toolchain_installed": True,
                "missing_prerequisites": [],
                "all_ready": True,
            },
        },
    )

    response = client.post("/api/installer/prepare-prerequisites")

    assert response.status_code == 200
    assert response.json()["attempted"] is True
    assert response.json()["environment"]["all_ready"] is True


def test_install_openclaw_creates_local_install_dir() -> None:
    response = client.post("/api/installer/install-openclaw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["install_path"].endswith("openclaw")
    assert "OpenClaw prepared locally" in payload["message"]


def test_configure_ai_persists_local_model() -> None:
    response = client.post(
        "/api/installer/configure-ai",
        json={"model": "mistral-small:24b-instruct"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "local",
        "model": "mistral-small:24b-instruct",
        "message": "Configured local model mistral-small:24b-instruct.",
    }


def test_start_connect_requires_openclaw_install() -> None:
    response = client.post("/api/installer/start-connect")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "OpenClaw must be installed before starting."
    }


def test_start_connect_completes_after_install_and_configure() -> None:
    client.post("/api/installer/install-openclaw")
    client.post(
        "/api/installer/configure-ai",
        json={"model": "llama3.1:8b-instruct"},
    )

    response = client.post("/api/installer/start-connect")

    assert response.status_code == 200
    assert response.json() == {
        "connected": True,
        "message": "Companion runtime is ready. Start & Connect completed.",
    }


def test_get_open_app_permission_defaults_to_not_granted() -> None:
    response = client.get("/api/preferences/permissions/open_app")

    assert response.status_code == 200
    assert response.json() == {"permission": "open_app", "granted": False}


def test_update_open_app_permission_persists_value(
    temp_preferences_file: Path,
) -> None:
    update_response = client.put(
        "/api/preferences/permissions/open_app",
        json={"granted": True},
    )
    read_response = client.get("/api/preferences/permissions/open_app")

    assert update_response.status_code == 200
    assert update_response.json() == {"permission": "open_app", "granted": True}
    assert read_response.status_code == 200
    assert read_response.json() == {"permission": "open_app", "granted": True}
    assert '"open_app": true' in temp_preferences_file.read_text(encoding="utf-8")


def test_open_app_launches_supported_app(monkeypatch) -> None:
    def fake_launch_app_skill(app_name: str) -> OpenAppResult:
        return {
            "ok": True,
            "app": app_name,
            "message": f"Requested launch for {app_name}.",
        }

    preferences.set_permission("open_app", True)
    monkeypatch.setattr("app.api.launch_app_skill", fake_launch_app_skill)

    response = client.post("/api/skills/open-app", json={"app": "spotify"})

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "app": "spotify",
        "message": "Requested launch for spotify.",
    }


def test_open_app_returns_backend_error(monkeypatch) -> None:
    def fake_launch_app_skill(_app_name: str) -> OpenAppResult:
        raise RuntimeError("Failed to launch spotify")

    preferences.set_permission("open_app", True)
    monkeypatch.setattr("app.api.launch_app_skill", fake_launch_app_skill)

    response = client.post("/api/skills/open-app", json={"app": "spotify"})

    assert response.status_code == 500
    assert response.json() == {"detail": "Failed to launch spotify"}


def test_open_app_rejects_unsupported_app() -> None:
    preferences.set_permission("open_app", True)
    response = client.post("/api/skills/open-app", json={"app": "zoom"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Unsupported app: zoom"}


def test_open_app_requires_permission() -> None:
    response = client.post("/api/skills/open-app", json={"app": "spotify"})

    assert response.status_code == 403
    assert response.json() == {"detail": "open_app permission has not been granted"}

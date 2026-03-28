from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.installer as installer
import app.preferences as preferences
import app.skills.browser_helper as browser_helper_skill
from app.main import app
from app.tools.open_app import OpenAppResult
from app.tools.open_url import OpenUrlResult


client = TestClient(app)


@pytest.fixture(autouse=True)
def temp_state_files(tmp_path, monkeypatch) -> Path:
    preferences_file = tmp_path / "preferences.json"
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", preferences_file)
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer_state.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")
    return preferences_file


def make_dependency(
    *,
    dependency_id: str,
    label: str,
    category: str,
    installed: bool,
    version: str | None = None,
) -> installer.DependencyStatus:
    return {
        "id": dependency_id,
        "label": label,
        "category": category,
        "installed": installed,
        "version": version,
        "guidance": [f"Guidance for {label}"],
    }


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_returns_structured_companion_reply(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.route_user_message",
        lambda _message: SimpleNamespace(
            ok=True,
            route="companion-chat",
            user_message="hello companion",
            assistant_response="Local companion reply.",
            action={
                "type": "chat_reply",
                "provider": "ollama",
                "model": "llama3.1:8b-instruct",
            },
        ),
    )

    response = client.post("/api/chat", json={"message": "hello companion"})

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "route": "companion-chat",
        "user_message": "hello companion",
        "assistant_response": "Local companion reply.",
        "action": {
            "type": "chat_reply",
            "provider": "ollama",
            "model": "llama3.1:8b-instruct",
        },
    }


def test_chat_returns_structured_app_route(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.route_user_message",
        lambda _message: SimpleNamespace(
            ok=True,
            route="app-launcher",
            user_message="open Spotify",
            assistant_response="I am opening Spotify for you.",
            action={"type": "open_app", "app": "spotify"},
        ),
    )

    response = client.post("/api/chat", json={"message": "open Spotify"})

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "route": "app-launcher",
        "user_message": "open Spotify",
        "assistant_response": "I am opening Spotify for you.",
        "action": {"type": "open_app", "app": "spotify"},
    }


def test_installer_status_returns_default_state() -> None:
    response = client.get("/api/installer/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_step"] == "environment-check"
    assert payload["completed"] is False
    assert payload["steps"]["environment-check"]["status"] == "pending"
    assert payload["openclaw"]["installed"] is False
    assert payload["ai"]["provider"] == "local"
    assert payload["connection"]["connected"] is False


def test_installer_environment_check_returns_structured_dependency_state(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        installer,
        "_environment_checks",
        lambda: [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=True,
                version="v22.0.0",
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=True,
                version="Build Tools detected",
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=False,
            ),
        ],
    )

    response = client.post("/api/installer/environment-check")

    assert response.status_code == 200
    payload = response.json()
    assert payload["environment"]["missing_prerequisites"] == ["Rust"]
    assert payload["environment"]["missing_runtime_dependencies"] == ["Ollama"]
    assert payload["step"]["status"] == "complete"
    assert "Rust" in payload["step"]["message"]


def test_prepare_prerequisites_completes_and_persists_state(monkeypatch) -> None:
    state = {"ready": False}

    def fake_environment_checks() -> list[installer.DependencyStatus]:
        if state["ready"]:
            return [
                make_dependency(
                    dependency_id="nodejs",
                    label="Node.js",
                    category="prerequisite",
                    installed=True,
                    version="v22.0.0",
                ),
                make_dependency(
                    dependency_id="rust",
                    label="Rust",
                    category="prerequisite",
                    installed=True,
                    version="rustc 1.85.0",
                ),
                make_dependency(
                    dependency_id="msvc",
                    label="Windows C++ / MSVC Toolchain",
                    category="prerequisite",
                    installed=True,
                    version="Build Tools detected",
                ),
                make_dependency(
                    dependency_id="ollama",
                    label="Ollama",
                    category="runtime",
                    installed=True,
                    version="ollama 0.6.0",
                ),
            ]

        return [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=True,
                version="v22.0.0",
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=True,
                version="Build Tools detected",
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=False,
            ),
        ]

    def fake_command_exists(command_name: str) -> bool:
        return command_name == "winget"

    def fake_run_install_command(_command: list[str]) -> bool:
        state["ready"] = True
        return True

    monkeypatch.setattr(installer, "_environment_checks", fake_environment_checks)
    monkeypatch.setattr(installer, "_command_exists", fake_command_exists)
    monkeypatch.setattr(installer, "_run_install_command", fake_run_install_command)

    response = client.post("/api/installer/prepare-prerequisites")

    assert response.status_code == 200
    payload = response.json()
    assert payload["attempted"] is True
    assert payload["remaining"] == []
    assert payload["environment"]["all_ready"] is True
    assert payload["step"]["status"] == "complete"

    status_response = client.get("/api/installer/status")
    assert status_response.json()["steps"]["prepare-prerequisites"]["status"] == "complete"


def test_prepare_prerequisites_returns_guided_repair_when_winget_is_missing(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        installer,
        "_environment_checks",
        lambda: [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=False,
            ),
        ],
    )
    monkeypatch.setattr(installer, "_command_exists", lambda _name: False)

    response = client.post("/api/installer/prepare-prerequisites")

    assert response.status_code == 200
    payload = response.json()
    assert payload["step"]["status"] == "needs_action"
    assert payload["step"]["can_retry"] is True
    assert payload["step"]["can_repair"] is True
    assert any(
        "App Installer" in instruction
        for instruction in payload["step"]["recovery_instructions"]
    )


def test_install_openclaw_requires_ready_environment_and_sets_repair_state(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        installer,
        "_environment_checks",
        lambda: [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=False,
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=False,
            ),
        ],
    )
    monkeypatch.setattr(installer, "_command_exists", lambda name: name == "winget")

    response = client.post("/api/installer/install-openclaw")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "OpenClaw cannot install until prerequisites are ready."
    }

    status_response = client.get("/api/installer/status")
    assert status_response.json()["steps"]["install-openclaw"]["status"] == "needs_action"


def test_install_openclaw_creates_local_install_dir(monkeypatch) -> None:
    monkeypatch.setattr(
        installer,
        "_environment_checks",
        lambda: [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=True,
                version="v22.0.0",
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=True,
                version="rustc 1.85.0",
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=True,
                version="Build Tools detected",
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=True,
                version="ollama 0.6.0",
            ),
        ],
    )

    response = client.post("/api/installer/install-openclaw")

    assert response.status_code == 200
    payload = response.json()
    assert payload["install_path"].endswith("openclaw")
    assert payload["step"]["status"] == "complete"
    assert "OpenClaw prepared locally" in payload["message"]


def test_configure_ai_persists_local_model() -> None:
    response = client.post(
        "/api/installer/configure-ai",
        json={"model": "mistral-small:24b-instruct"},
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "local"
    assert response.json()["model"] == "mistral-small:24b-instruct"
    assert response.json()["step"]["status"] == "complete"
    assert preferences.get_selected_model() == "mistral-small:24b-instruct"


def test_start_connect_requires_openclaw_install() -> None:
    response = client.post("/api/installer/start-connect")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "OpenClaw must be installed before starting."
    }


def test_start_connect_completes_after_install_and_configure(monkeypatch) -> None:
    monkeypatch.setattr(
        installer,
        "_environment_checks",
        lambda: [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=True,
                version="v22.0.0",
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=True,
                version="rustc 1.85.0",
            ),
            make_dependency(
                dependency_id="msvc",
                label="Windows C++ / MSVC Toolchain",
                category="prerequisite",
                installed=True,
                version="Build Tools detected",
            ),
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=True,
                version="ollama 0.6.0",
            ),
        ],
    )
    client.post("/api/installer/install-openclaw")
    client.post(
        "/api/installer/configure-ai",
        json={"model": "llama3.1:8b-instruct"},
    )

    response = client.post("/api/installer/start-connect")

    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["step"]["status"] == "complete"

    status_response = client.get("/api/installer/status")
    status_payload = status_response.json()
    assert status_payload["connection"]["connected"] is True
    assert status_payload["completed"] is True


def test_get_open_app_permission_defaults_to_not_granted() -> None:
    response = client.get("/api/preferences/permissions/open_app")

    assert response.status_code == 200
    assert response.json() == {"permission": "open_app", "granted": False}


def test_update_open_app_permission_persists_value(
    temp_state_files: Path,
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
    assert '"open_app": true' in temp_state_files.read_text(encoding="utf-8")


def test_get_open_url_permission_defaults_to_not_granted() -> None:
    response = client.get("/api/preferences/permissions/open_url")

    assert response.status_code == 200
    assert response.json() == {"permission": "open_url", "granted": False}


def test_update_open_url_permission_persists_value(
    temp_state_files: Path,
) -> None:
    update_response = client.put(
        "/api/preferences/permissions/open_url",
        json={"granted": True},
    )
    read_response = client.get("/api/preferences/permissions/open_url")

    assert update_response.status_code == 200
    assert update_response.json() == {"permission": "open_url", "granted": True}
    assert read_response.status_code == 200
    assert read_response.json() == {"permission": "open_url", "granted": True}
    assert '"open_url": true' in temp_state_files.read_text(encoding="utf-8")


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


def test_browser_helper_searches_query(monkeypatch) -> None:
    def fake_open_url(url: str) -> OpenUrlResult:
        return {
            "ok": True,
            "url": url,
            "message": f"Opened {url} in the default browser.",
        }

    preferences.set_permission("open_url", True)
    monkeypatch.setattr(browser_helper_skill, "open_url", fake_open_url)

    response = client.post(
        "/api/skills/browser-helper",
        json={"request": "search for best local llm setup"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "action": "search_query",
        "request": "search for best local llm setup",
        "url": "https://duckduckgo.com/?q=best+local+llm+setup",
        "message": 'I opened a browser search for "best local llm setup".',
    }


def test_browser_helper_opens_url(monkeypatch) -> None:
    def fake_open_url(url: str) -> OpenUrlResult:
        return {
            "ok": True,
            "url": url,
            "message": f"Opened {url} in the default browser.",
        }

    preferences.set_permission("open_url", True)
    monkeypatch.setattr(browser_helper_skill, "open_url", fake_open_url)

    response = client.post(
        "/api/skills/browser-helper",
        json={"request": "open openai.com"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "action": "open_url",
        "request": "open openai.com",
        "url": "https://openai.com",
        "message": "I opened https://openai.com in your browser.",
    }


def test_browser_helper_rejects_invalid_request() -> None:
    preferences.set_permission("open_url", True)

    response = client.post(
        "/api/skills/browser-helper",
        json={"request": "browse openai"},
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": 'Unsupported browser request. Use "search for <query>" or "open <url>".'
    }


def test_browser_helper_requires_permission() -> None:
    response = client.post(
        "/api/skills/browser-helper",
        json={"request": "search for companion os"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "open_url permission has not been granted"}

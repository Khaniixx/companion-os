from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.installer as installer
import app.memory_manager as memory_manager
import app.micro_utilities as micro_utilities
import app.personality_packs as personality_packs
import app.preferences as preferences
import app.skills.app_launcher as app_launcher_skill
import app.skills.browser_helper as browser_helper_skill
import app.stream_integration as stream_integration
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
    monkeypatch.setattr(personality_packs, "PACKS_DIR", tmp_path / "personality_packs")
    monkeypatch.setattr(memory_manager, "MEMORY_STATE_FILE", tmp_path / "memory_state.json")
    monkeypatch.setattr(
        micro_utilities,
        "MICRO_UTILITIES_FILE",
        tmp_path / "micro_utilities.json",
    )
    monkeypatch.setattr(
        stream_integration,
        "STREAM_INTEGRATION_STATE_FILE",
        tmp_path / "stream_integration.json",
    )
    monkeypatch.setattr(
        stream_integration,
        "STREAM_INTEGRATION_SECRET_FILE",
        tmp_path / "stream_integration.secret",
    )
    monkeypatch.setattr(
        stream_integration,
        "STREAM_INTEGRATION_SECRET_KEY_FILE",
        tmp_path / "stream_integration.key",
    )
    monkeypatch.setattr(
        app_launcher_skill,
        "APP_LAUNCHER_STATE_FILE",
        tmp_path / "app_launcher_state.json",
    )
    return preferences_file


def make_dependency(
    *,
    dependency_id: str,
    label: str,
    category: str,
    installed: bool,
    version: str | None = None,
    can_auto_install: bool = True,
    approx_size_mb: int | None = None,
) -> installer.DependencyStatus:
    return {
        "id": dependency_id,
        "label": label,
        "category": category,
        "installed": installed,
        "version": version,
        "guidance": [f"Guidance for {label}"],
        "approx_size_mb": approx_size_mb,
        "can_auto_install": can_auto_install,
    }


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_returns_structured_companion_reply(monkeypatch) -> None:
    preferences.update_memory_settings(summary_frequency_messages=2)
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
            loading=False,
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
        "loading": False,
    }

    memory_response = client.get("/api/memory/summaries")
    assert memory_response.status_code == 200
    payload = memory_response.json()
    assert payload["pending_message_count"] == 0
    assert payload["summaries"][0]["title"] == "Recent: hello companion"


def test_chat_returns_structured_app_route(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.route_user_message",
        lambda _message: SimpleNamespace(
            ok=True,
            route="app-launcher",
            user_message="open Spotify",
            assistant_response="I am opening Spotify for you.",
            action={"type": "open_app", "app": "spotify"},
            loading=False,
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
        "loading": False,
    }


def test_installer_status_returns_default_state(monkeypatch) -> None:
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
    response = client.get("/api/installer/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_step"] == "download"
    assert payload["completed"] is False
    assert payload["steps"]["download"]["status"] == "pending"
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
    assert payload["step"]["id"] == "download"
    assert payload["step"]["status"] == "needs_action"
    assert "Rust" in payload["step"]["message"]


def test_download_step_completes_and_persists_state(monkeypatch) -> None:
    state = {"ready": False}
    monkeypatch.setattr(installer.sys, "platform", "win32")

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

    def fake_run_install_command(
        _command: list[str], *, timeout_seconds: int
    ) -> installer.CommandExecutionResult:
        assert timeout_seconds == installer.INSTALL_COMMAND_TIMEOUT_SECONDS
        state["ready"] = True
        return {
            "ok": True,
            "timed_out": False,
            "returncode": 0,
            "output": "",
        }

    monkeypatch.setattr(installer, "_environment_checks", fake_environment_checks)
    monkeypatch.setattr(installer, "_command_exists", fake_command_exists)
    monkeypatch.setattr(installer, "_run_install_command", fake_run_install_command)

    response = client.post("/api/installer/download")

    assert response.status_code == 200
    payload = response.json()
    assert payload["attempted"] is True
    assert payload["remaining"] == []
    assert payload["environment"]["all_ready"] is True
    assert payload["step"]["status"] == "complete"

    status_response = client.get("/api/installer/status")
    assert status_response.json()["steps"]["download"]["status"] == "complete"


def test_download_step_returns_guided_repair_when_winget_is_missing(
    monkeypatch,
) -> None:
    monkeypatch.setattr(installer.sys, "platform", "win32")
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

    response = client.post("/api/installer/download")

    assert response.status_code == 200
    payload = response.json()
    assert payload["step"]["status"] == "needs_action"
    assert payload["step"]["can_retry"] is True
    assert payload["step"]["can_repair"] is True
    assert any(
        "App Installer" in instruction
        for instruction in payload["step"]["recovery_instructions"]
    )
    assert any(
        "Node.js" in instruction for instruction in payload["step"]["recovery_instructions"]
    )
    assert not any(
        "Rust" in instruction for instruction in payload["step"]["recovery_instructions"]
    )


def test_packaged_windows_download_auto_installs_ollama_without_winget(
    monkeypatch,
) -> None:
    monkeypatch.setattr(installer.sys, "platform", "win32")
    monkeypatch.setattr(installer.sys, "frozen", True, raising=False)
    state = {"ready": False}

    def fake_environment_checks() -> list[installer.DependencyStatus]:
        if state["ready"]:
            return [
                make_dependency(
                    dependency_id="ollama",
                    label="Ollama",
                    category="runtime",
                    installed=True,
                    version="ollama 0.6.0",
                )
            ]

        return [
            make_dependency(
                dependency_id="ollama",
                label="Ollama",
                category="runtime",
                installed=False,
            )
        ]

    def fake_run_install_command(
        command: list[str], *, timeout_seconds: int
    ) -> installer.CommandExecutionResult:
        assert timeout_seconds == installer.INSTALL_COMMAND_TIMEOUT_SECONDS
        assert "install.ps1" in command[-1]
        state["ready"] = True
        return {
            "ok": True,
            "timed_out": False,
            "returncode": 0,
            "output": "",
        }

    monkeypatch.setattr(installer, "_command_exists", lambda _name: False)
    monkeypatch.setattr(installer, "_environment_checks", fake_environment_checks)
    monkeypatch.setattr(installer, "_run_install_command", fake_run_install_command)

    response = client.post("/api/installer/download")

    assert response.status_code == 200
    payload = response.json()
    assert payload["attempted"] is True
    assert payload["installed"] == ["Ollama"]
    assert payload["remaining"] == []
    assert payload["environment"]["missing_prerequisites"] == []
    assert payload["environment"]["missing_runtime_dependencies"] == []
    assert payload["step"]["status"] == "complete"


def test_download_step_explains_ollama_windows_handoff(monkeypatch) -> None:
    monkeypatch.setattr(installer.sys, "platform", "win32")

    initial_environment = [
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
            installed=False,
        ),
    ]

    monkeypatch.setattr(installer, "_environment_checks", lambda: initial_environment)
    monkeypatch.setattr(installer, "_command_exists", lambda name: name == "winget")
    monkeypatch.setattr(
        installer,
        "_run_install_command",
        lambda _command, *, timeout_seconds: {
            "ok": True,
            "timed_out": False,
            "returncode": 0,
            "output": "",
        },
    )
    monkeypatch.setattr(
        installer,
        "_wait_for_dependency_ready",
        lambda _label: installer.EnvironmentCheckResult(
            platform="windows",
            checks=initial_environment,
            node_installed=True,
            rust_installed=True,
            cpp_toolchain_installed=True,
            runtime_dependencies_ready=False,
            missing_prerequisites=[],
            missing_runtime_dependencies=["Ollama"],
            all_ready=False,
        ),
    )

    response = client.post("/api/installer/download")

    assert response.status_code == 200
    payload = response.json()
    assert payload["step"]["status"] == "needs_action"
    assert payload["remaining"] == ["Ollama"]
    assert payload["step"]["can_retry"] is True
    assert payload["message"] == (
        "Ollama may have opened to finish setup on Windows. Leave it open for a moment, then choose Retry here and we will continue from the same place."
    )
    assert any(
        "Windows may open Ollama after installation" in instruction
        for instruction in payload["step"]["recovery_instructions"]
    )


def test_download_step_returns_retryable_failure_on_timeout(monkeypatch) -> None:
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
                installed=True,
                version="ollama 0.6.0",
            ),
        ],
    )
    monkeypatch.setattr(
        installer,
        "_dependency_install_command",
        lambda _label: ["fake-installer"],
    )
    def fake_run_install_command(
        _command: list[str], *, timeout_seconds: int
    ) -> installer.CommandExecutionResult:
        assert timeout_seconds == installer.INSTALL_COMMAND_TIMEOUT_SECONDS
        return {
            "ok": False,
            "timed_out": True,
            "returncode": None,
            "output": "",
        }

    monkeypatch.setattr(installer, "_run_install_command", fake_run_install_command)

    response = client.post("/api/installer/download")

    assert response.status_code == 200
    payload = response.json()
    assert payload["step"]["status"] == "failed"
    assert payload["step"]["can_retry"] is True
    assert payload["step"]["can_repair"] is True
    assert "Rust" in payload["message"]


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
    assert status_response.json()["steps"]["download"]["status"] == "needs_action"
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


def test_installer_repair_endpoint_resumes_from_corrupted_install(monkeypatch) -> None:
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

    state = installer.create_default_installer_state()
    state["steps"]["download"]["status"] = "complete"
    state["steps"]["install-openclaw"]["status"] = "needs_action"
    state["steps"]["install-openclaw"]["can_repair"] = True
    installer.INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    installer.INSTALLER_STATE_FILE.write_text(
        installer.json.dumps(state, indent=2),
        encoding="utf-8",
    )

    response = client.post("/api/installer/repair")

    assert response.status_code == 200
    payload = response.json()
    assert payload["resumed_step"] == "install-openclaw"
    assert payload["status"]["steps"]["install-openclaw"]["status"] == "complete"


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


def test_memory_settings_default_to_local_first() -> None:
    response = client.get("/api/memory/settings")

    assert response.status_code == 200
    assert response.json() == {
        "long_term_memory_enabled": True,
        "summary_frequency_messages": 25,
        "cloud_backup_enabled": False,
        "storage_mode": "local-only",
    }


def test_memory_settings_update_and_summary_edit_delete(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.route_user_message",
        lambda message: SimpleNamespace(
            ok=True,
            route="companion-chat",
            user_message=message,
            assistant_response="A calm local reply.",
            action={
                "type": "chat_reply",
                "provider": "ollama",
                "model": "llama3.1:8b-instruct",
            },
            loading=False,
        ),
    )
    update_response = client.put(
        "/api/memory/settings",
        json={
            "long_term_memory_enabled": True,
            "summary_frequency_messages": 2,
            "cloud_backup_enabled": True,
        },
    )

    assert update_response.status_code == 200
    assert update_response.json()["summary_frequency_messages"] == 2
    assert update_response.json()["cloud_backup_enabled"] is True

    client.post("/api/chat", json={"message": "hello there"})

    summaries_response = client.get("/api/memory/summaries")
    assert summaries_response.status_code == 200
    summary_id = summaries_response.json()["summaries"][0]["id"]

    edit_response = client.put(
        f"/api/memory/summaries/{summary_id}",
        json={"title": "Updated memory", "summary": "A clearer local summary."},
    )

    assert edit_response.status_code == 200
    assert edit_response.json()["title"] == "Updated memory"
    assert edit_response.json()["summary"] == "A clearer local summary."

    delete_response = client.delete(f"/api/memory/summaries/{summary_id}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": summary_id}

    clear_response = client.delete("/api/memory/summaries")
    assert clear_response.status_code == 200
    assert clear_response.json() == {"deleted": 0}


def test_disabling_memory_clears_pending_messages(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.route_user_message",
        lambda message: SimpleNamespace(
            ok=True,
            route="companion-chat",
            user_message=message,
            assistant_response="Pending reply.",
            action={
                "type": "chat_reply",
                "provider": "ollama",
                "model": "llama3.1:8b-instruct",
            },
            loading=False,
        ),
    )
    preferences.update_memory_settings(summary_frequency_messages=10)
    client.post("/api/chat", json={"message": "keep this pending"})

    before_response = client.get("/api/memory/summaries")
    assert before_response.json()["pending_message_count"] == 2

    update_response = client.put(
        "/api/memory/settings",
        json={"long_term_memory_enabled": False},
    )

    assert update_response.status_code == 200
    assert update_response.json()["long_term_memory_enabled"] is False

    after_response = client.get("/api/memory/summaries")
    assert after_response.json()["pending_message_count"] == 0


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


def test_voice_preferences_default_to_ready_with_active_profile() -> None:
    response = client.get("/api/preferences/voice")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "available": True,
        "state": "ready",
        "provider": "local",
        "voice_id": "default",
        "locale": "en-US",
        "style": "gentle",
        "display_name": "Aster",
        "message": "Aster's voice is ready when you want it.",
    }


def test_voice_preferences_can_be_muted(temp_state_files: Path) -> None:
    update_response = client.put("/api/preferences/voice", json={"enabled": False})
    read_response = client.get("/api/preferences/voice")

    assert update_response.status_code == 200
    assert update_response.json()["state"] == "muted"
    assert update_response.json()["enabled"] is False
    assert read_response.status_code == 200
    assert read_response.json()["state"] == "muted"
    assert read_response.json()["enabled"] is False
    assert '"enabled": false' in temp_state_files.read_text(encoding="utf-8")


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
            "display_name": "Spotify",
            "suggestions": ["Spotify"],
            "reason": "resolved",
            "message": f"Requested launch for {app_name}.",
        }

    preferences.set_permission("open_app", True)
    monkeypatch.setattr("app.api.launch_app_skill", fake_launch_app_skill)

    response = client.post("/api/skills/open-app", json={"app": "spotify"})

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "app": "spotify",
        "display_name": "Spotify",
        "suggestions": ["Spotify"],
        "reason": "resolved",
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


def test_open_app_returns_suggestions_for_unmatched_app() -> None:
    preferences.set_permission("open_app", True)
    response = client.post("/api/skills/open-app", json={"app": "zoom"})

    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["app"] is None
    assert response.json()["reason"] == "not_found"
    assert response.json()["suggestions"] == ["Spotify", "Discord"]


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
        "message": 'Sure, searching the web for "best local llm setup".',
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
        "message": "Opening openai.com.",
    }


def test_browser_helper_supports_quoted_search_query(monkeypatch) -> None:
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
        json={"request": 'search for "best local llm setup"'},
    )

    assert response.status_code == 200
    assert response.json()["url"] == "https://duckduckgo.com/?q=best+local+llm+setup"
    assert response.json()["message"] == 'Sure, searching the web for "best local llm setup".'


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


def test_get_micro_utilities_state_returns_defaults() -> None:
    response = client.get("/api/utilities/state")

    assert response.status_code == 200
    assert response.json() == {
        "timers": [],
        "reminders": [],
        "todos": [],
        "notes": [],
        "alerts": [],
        "clipboard_history": [],
        "shortcuts": [
            {
                "id": "spotify",
                "label": "Spotify",
                "kind": "app",
                "target": "spotify",
            },
            {
                "id": "discord",
                "label": "Discord",
                "kind": "app",
                "target": "discord",
            },
            {
                "id": "local-setup",
                "label": "Local Setup Search",
                "kind": "browser",
                "target": "search for Companion OS local setup",
            },
        ],
    }


def test_micro_utility_route_creates_timer() -> None:
    response = client.post(
        "/api/skills/micro-utilities",
        json={"request": "set a 5 minute timer"},
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["action"] == "created_timer"
    assert response.json()["metadata"]["utility"]["label"] == "5-minute timer"

    state_response = client.get("/api/utilities/state")
    assert state_response.status_code == 200
    assert state_response.json()["timers"][0]["label"] == "5-minute timer"
    assert state_response.json()["timers"][0]["updated_at"] is not None
    assert state_response.json()["timers"][0]["fired_at"] is None
    assert state_response.json()["alerts"] == []


def test_micro_utility_route_rejects_invalid_request() -> None:
    response = client.post(
        "/api/skills/micro-utilities",
        json={"request": "do a dance"},
    )

    assert response.status_code == 400
    assert response.json() == {
        "detail": (
            "Unsupported utility request. Try a timer, reminder, to-do, "
            "clipboard save, or shortcut."
        )
    }


def test_capture_clipboard_route_stores_local_entry() -> None:
    response = client.post(
        "/api/utilities/clipboard/capture",
        json={"text": "Remember this local note."},
    )

    assert response.status_code == 200
    assert response.json()["message"] == (
        "I saved that clipboard text into your local history."
    )

    state_response = client.get("/api/utilities/state")
    assert state_response.status_code == 200
    assert state_response.json()["clipboard_history"][0]["text"] == (
        "Remember this local note."
    )


def test_update_note_and_dismiss_timer_alert_routes(monkeypatch) -> None:
    monkeypatch.setattr(
        micro_utilities,
        "_now",
        lambda: datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
    )
    timer = micro_utilities.create_timer(duration_minutes=1)
    reminder = micro_utilities.create_reminder(
        text="stretch",
        due_at=datetime(2026, 3, 29, 0, 10, tzinfo=UTC),
    )
    monkeypatch.setattr(
        micro_utilities,
        "_now",
        lambda: datetime(2026, 3, 29, 0, 2, tzinfo=UTC),
    )

    update_response = client.patch(
        f"/api/utilities/items/{reminder['id']}",
        json={"label": "stretch gently", "completed": True},
    )

    assert update_response.status_code == 200
    assert update_response.json()["label"] == "stretch gently"
    assert update_response.json()["completed"] is True

    state_response = client.get("/api/utilities/state")
    assert state_response.status_code == 200
    assert state_response.json()["alerts"][0]["id"] == timer["id"]

    dismiss_response = client.post(f"/api/utilities/items/{timer['id']}/dismiss")

    assert dismiss_response.status_code == 200
    assert dismiss_response.json()["item"]["dismissed"] is True
    assert dismiss_response.json()["message"] == "I tucked that alert away for you."


def test_stream_state_returns_defaults() -> None:
    response = client.get("/api/stream/state")

    assert response.status_code == 200
    assert response.json() == {
        "settings": {
            "enabled": False,
            "provider": "twitch",
            "overlay_enabled": False,
            "click_through_enabled": False,
            "twitch_channel_name": "",
            "twitch_webhook_secret": "",
            "has_twitch_webhook_secret": False,
            "youtube_live_chat_id": "",
            "reaction_preferences": {
                "new_subscriber": True,
                "donation": True,
                "new_member": True,
                "super_chat": True,
            },
        },
        "recent_events": [],
    }


def test_stream_settings_update_persists_overlay_and_reactions() -> None:
    response = client.put(
        "/api/stream/settings",
        json={
            "enabled": True,
            "provider": "youtube",
            "overlay_enabled": True,
            "click_through_enabled": True,
            "youtube_live_chat_id": "abc123",
            "reaction_preferences": {
                "new_member": True,
                "super_chat": False,
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert response.json()["provider"] == "youtube"
    assert response.json()["overlay_enabled"] is True
    assert response.json()["click_through_enabled"] is True
    assert response.json()["youtube_live_chat_id"] == "abc123"
    assert response.json()["has_twitch_webhook_secret"] is False
    assert response.json()["reaction_preferences"]["super_chat"] is False

    state_response = client.get("/api/stream/state")
    assert state_response.status_code == 200
    assert state_response.json()["settings"]["provider"] == "youtube"


def test_stream_settings_update_masks_saved_twitch_secret() -> None:
    response = client.put(
        "/api/stream/settings",
        json={
            "enabled": True,
            "provider": "twitch",
            "twitch_webhook_secret": "topsecret",
        },
    )

    assert response.status_code == 200
    assert response.json()["twitch_webhook_secret"] == ""
    assert response.json()["has_twitch_webhook_secret"] is True

    state_response = client.get("/api/stream/state")
    assert state_response.status_code == 200
    assert state_response.json()["settings"]["twitch_webhook_secret"] == ""
    assert state_response.json()["settings"]["has_twitch_webhook_secret"] is True


def test_preview_stream_event_returns_structured_event() -> None:
    response = client.post(
        "/api/stream/events/preview",
        json={"type": "donation"},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "donation"
    assert response.json()["bubble_text"] == "Mika just sent $5.00."


def test_twitch_webhook_verification_returns_challenge() -> None:
    response = client.post(
        "/api/stream/webhooks/twitch",
        headers={"Twitch-EventSub-Message-Type": "webhook_callback_verification"},
        json={"challenge": "verify-me"},
    )

    assert response.status_code == 200
    assert response.text == "verify-me"


def test_twitch_webhook_notification_stores_event() -> None:
    client.put("/api/stream/settings", json={"enabled": True})

    response = client.post(
        "/api/stream/webhooks/twitch",
        headers={"Twitch-EventSub-Message-Type": "notification"},
        json={
            "subscription": {"type": "channel.subscribe"},
            "event": {"user_name": "Ari"},
        },
    )

    assert response.status_code == 200
    assert response.json()["type"] == "new_subscriber"
    assert response.json()["bubble_text"] == "Ari just subscribed on Twitch."

    events_response = client.get("/api/stream/events")
    assert events_response.status_code == 200
    assert events_response.json()[0]["actor_name"] == "Ari"


def test_youtube_event_route_accepts_super_chat() -> None:
    client.put(
        "/api/stream/settings",
        json={"enabled": True, "provider": "youtube"},
    )

    response = client.post(
        "/api/stream/events/youtube",
        json={
            "event": {
                "snippet": {
                    "type": "superChatEvent",
                    "superChatDetails": {
                        "amountDisplayString": "$10.00",
                        "userComment": "Love the stream.",
                    },
                },
                "authorDetails": {"displayName": "Jordan"},
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["type"] == "super_chat"
    assert response.json()["amount_display"] == "$10.00"
    assert response.json()["actor_name"] == "Jordan"


def test_pack_selection_rejects_invalid_pack_id_shape() -> None:
    response = client.put(
        "/api/packs/active",
        json={"pack_id": "../outside"},
    )

    assert response.status_code == 422

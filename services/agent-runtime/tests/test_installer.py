from pathlib import Path

import pytest

import app.installer as installer
import app.preferences as preferences


@pytest.fixture(autouse=True)
def temp_installer_files(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer_state.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")


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


def test_environment_checks_skip_msvc_on_macos(monkeypatch) -> None:
    monkeypatch.setattr(installer.sys, "platform", "darwin")
    monkeypatch.setattr(installer, "_command_exists", lambda name: name in {"node", "rustc"})

    checks = installer._environment_checks()

    labels = [item["label"] for item in checks]
    assert "Windows C++ / MSVC Toolchain" not in labels


def test_environment_checks_include_msvc_on_windows(monkeypatch) -> None:
    monkeypatch.setattr(installer.sys, "platform", "win32")
    monkeypatch.setattr(installer, "_command_exists", lambda name: name == "node")
    monkeypatch.setattr(installer, "_cpp_toolchain_installed", lambda: False)

    checks = installer._environment_checks()

    labels = [item["label"] for item in checks]
    assert "Windows C++ / MSVC Toolchain" in labels


def test_environment_checks_on_linux_show_local_runtime_dependencies(monkeypatch) -> None:
    monkeypatch.setattr(installer.sys, "platform", "linux")
    monkeypatch.setattr(installer, "_command_exists", lambda _name: False)

    environment = installer._collect_environment_result()

    assert environment["platform"] == "linux"
    assert environment["missing_prerequisites"] == ["Node.js", "Rust"]
    assert environment["missing_runtime_dependencies"] == ["Ollama"]


def test_download_setup_marks_timeout_as_retryable_failure(monkeypatch) -> None:
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
        lambda label: ["fake-installer", label],
    )
    monkeypatch.setattr(
        installer,
        "_run_install_command",
        lambda _command, timeout_seconds: {
            "ok": False,
            "timed_out": True,
            "returncode": None,
            "output": "",
        },
    )

    result = installer.download_setup()

    assert result["step"]["status"] == "failed"
    assert result["step"]["can_retry"] is True
    assert result["step"]["can_repair"] is True
    assert "Rust" in result["message"]


def test_get_installer_status_recovers_interrupted_active_step(monkeypatch) -> None:
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
    state = installer.create_default_installer_state()
    state["steps"]["download"]["status"] = "active"
    state["steps"]["download"]["message"] = "Installing Rust for this device."
    installer.INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    installer.INSTALLER_STATE_FILE.write_text(
        installer.json.dumps(state, indent=2),
        encoding="utf-8",
    )

    recovered = installer.get_installer_status()

    assert recovered["steps"]["download"]["status"] == "needs_action"
    assert recovered["steps"]["download"]["can_retry"] is True
    assert recovered["steps"]["download"]["can_repair"] is True


def test_get_installer_status_marks_corrupted_install_for_repair(monkeypatch) -> None:
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
    state["steps"]["install-openclaw"]["status"] = "complete"
    state["openclaw"]["installed"] = True
    installer.OPENCLAW_INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    installer.INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    installer.INSTALLER_STATE_FILE.write_text(
        installer.json.dumps(state, indent=2),
        encoding="utf-8",
    )

    recovered = installer.get_installer_status()

    assert recovered["steps"]["install-openclaw"]["status"] == "needs_action"
    assert recovered["steps"]["install-openclaw"]["can_repair"] is True


def test_repair_installation_resumes_from_incomplete_openclaw_step(monkeypatch) -> None:
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
    state["steps"]["install-openclaw"]["message"] = (
        "OpenClaw needs a quick repair before setup can continue."
    )
    installer.INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    installer.INSTALLER_STATE_FILE.write_text(
        installer.json.dumps(state, indent=2),
        encoding="utf-8",
    )

    result = installer.repair_installation()

    assert result["resumed_step"] == "install-openclaw"
    assert result["status"]["steps"]["install-openclaw"]["status"] == "complete"
    assert Path(result["status"]["openclaw"]["manifest_path"]).exists()

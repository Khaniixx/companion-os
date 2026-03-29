import app.installer as installer
import app.preferences as preferences


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


def test_download_setup_passes_timeout_keyword_argument(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences, "PREFERENCES_FILE", tmp_path / "preferences.json")
    monkeypatch.setattr(installer, "INSTALLER_STATE_FILE", tmp_path / "installer_state.json")
    monkeypatch.setattr(installer, "OPENCLAW_INSTALL_DIR", tmp_path / "openclaw")
    state = {"ollama_installed": False}

    def fake_environment_checks() -> list[installer.DependencyStatus]:
        return [
            make_dependency(
                dependency_id="nodejs",
                label="Node.js",
                category="prerequisite",
                installed=True,
                version="v24.14.0",
            ),
            make_dependency(
                dependency_id="rust",
                label="Rust",
                category="prerequisite",
                installed=True,
                version="rustc 1.94.1",
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
                installed=state["ollama_installed"],
                version="ollama version is 0.18.3" if state["ollama_installed"] else None,
            ),
        ]

    monkeypatch.setattr(installer, "_environment_checks", fake_environment_checks)
    monkeypatch.setattr(
        installer,
        "_dependency_install_command",
        lambda label: ["fake-installer", label],
    )

    calls: list[int] = []

    def fake_run_install_command(
        _command: list[str], *, timeout_seconds: int
    ) -> installer.CommandExecutionResult:
        calls.append(timeout_seconds)
        state["ollama_installed"] = True
        return {
            "ok": True,
            "timed_out": False,
            "returncode": 0,
            "output": "",
        }

    monkeypatch.setattr(installer, "_run_install_command", fake_run_install_command)

    result = installer.download_setup()

    assert calls == [installer.INSTALL_COMMAND_TIMEOUT_SECONDS]
    assert result["step"]["status"] == "complete"
    assert result["remaining"] == []

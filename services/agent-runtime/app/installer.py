"""OpenClaw installer state and orchestration helpers."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Final, Literal, TypedDict

from app.model_catalog import RECOMMENDED_LOCAL_MODEL, SUPPORTED_LOCAL_MODELS
from app.preferences import get_selected_model, set_selected_model
from app.runtime_paths import runtime_data_path

INSTALLER_STATE_FILE = runtime_data_path("installer_state.json")
OPENCLAW_INSTALL_DIR = runtime_data_path("openclaw")
INSTALL_COMMAND_TIMEOUT_SECONDS: Final[int] = 900
POST_INSTALL_SETTLE_SECONDS: Final[int] = 20
POST_INSTALL_POLL_SECONDS: Final[float] = 2.0
STEP_ORDER: Final[tuple[str, ...]] = (
    "download",
    "install-openclaw",
    "configure-ai",
    "start-connect",
)
STEP_TITLES: Final[dict[str, str]] = {
    "download": "Download",
    "install-openclaw": "Install OpenClaw",
    "configure-ai": "Configure AI",
    "start-connect": "Start & Connect",
}
StepStatus = Literal["pending", "active", "complete", "failed", "needs_action"]

_installer_lock = Lock()


class DependencyStatus(TypedDict):
    id: str
    label: str
    category: str
    installed: bool
    version: str | None
    guidance: list[str]
    approx_size_mb: int | None
    can_auto_install: bool


class EnvironmentCheckResult(TypedDict):
    platform: str
    checks: list[DependencyStatus]
    node_installed: bool
    rust_installed: bool
    cpp_toolchain_installed: bool
    runtime_dependencies_ready: bool
    missing_prerequisites: list[str]
    missing_runtime_dependencies: list[str]
    all_ready: bool


class InstallerStepState(TypedDict):
    id: str
    title: str
    description: str
    status: StepStatus
    message: str
    error: str | None
    recovery_instructions: list[str]
    can_retry: bool
    can_repair: bool
    updated_at: str
    attempt_count: int


class InstallerStatus(TypedDict):
    current_step: str
    completed: bool
    environment: EnvironmentCheckResult
    steps: dict[str, InstallerStepState]
    openclaw: dict[str, object]
    ai: dict[str, object]
    connection: dict[str, object]


class InstallerActionResult(TypedDict):
    message: str
    resumed_step: str
    step: InstallerStepState
    status: InstallerStatus


class CommandExecutionResult(TypedDict):
    ok: bool
    timed_out: bool
    returncode: int | None
    output: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _platform_key() -> str:
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    return "other"


def _uses_bundled_desktop_runtime() -> bool:
    return bool(getattr(sys, "frozen", False))


def _requires_desktop_shell_prerequisites() -> bool:
    return not (_platform_key() == "windows" and _uses_bundled_desktop_runtime())


def _requires_msvc_toolchain() -> bool:
    return _platform_key() == "windows" and _requires_desktop_shell_prerequisites()


def _state_version() -> str:
    return "installer-state-v2"


def _default_manifest_path() -> str:
    return str(OPENCLAW_INSTALL_DIR / "openclaw.json")


def _approx_size_for_dependency(label: str) -> int | None:
    return {
        "Node.js": 120,
        "Rust": 500,
        "Windows C++ / MSVC Toolchain": 6000,
        "Ollama": 1500,
    }.get(label)


def _empty_environment() -> EnvironmentCheckResult:
    missing_prerequisites: list[str] = []
    if _requires_desktop_shell_prerequisites():
        missing_prerequisites = ["Node.js", "Rust"]
        if _requires_msvc_toolchain():
            missing_prerequisites.append("Windows C++ / MSVC Toolchain")

    return EnvironmentCheckResult(
        platform=_platform_key(),
        checks=[],
        node_installed=not _requires_desktop_shell_prerequisites(),
        rust_installed=not _requires_desktop_shell_prerequisites(),
        cpp_toolchain_installed=not _requires_msvc_toolchain(),
        runtime_dependencies_ready=False,
        missing_prerequisites=missing_prerequisites,
        missing_runtime_dependencies=["Ollama"],
        all_ready=False,
    )


def _make_step(step_id: str, title: str, description: str, message: str) -> InstallerStepState:
    return InstallerStepState(
        id=step_id,
        title=title,
        description=description,
        status="pending",
        message=message,
        error=None,
        recovery_instructions=[],
        can_retry=False,
        can_repair=False,
        updated_at=_now_iso(),
        attempt_count=0,
    )


def _default_steps() -> dict[str, InstallerStepState]:
    return {
        "download": _make_step(
            "download",
            "Download",
            "Prepare the local setup package and any prerequisites needed on this device.",
            "Checking your system before setup begins.",
        ),
        "install-openclaw": _make_step(
            "install-openclaw",
            "Install OpenClaw",
            "Prepare the local OpenClaw runtime files used by the desktop companion.",
            "OpenClaw will install after your system is ready.",
        ),
        "configure-ai": _make_step(
            "configure-ai",
            "Configure AI",
            "Choose the default local, open-source model for the first run.",
            "The recommended local model is ready to confirm.",
        ),
        "start-connect": _make_step(
            "start-connect",
            "Start & Connect",
            "Bring the local runtime online and connect the companion shell.",
            "Almost ready. The companion will connect after AI setup.",
        ),
    }


def create_default_installer_state() -> InstallerStatus:
    return InstallerStatus(
        current_step="download",
        completed=False,
        environment=_empty_environment(),
        steps=_default_steps(),
        openclaw={
            "installed": False,
            "install_path": str(OPENCLAW_INSTALL_DIR),
            "manifest_path": _default_manifest_path(),
        },
        ai={"provider": "local", "model": get_selected_model()},
        connection={"connected": False, "message": "Setup has not completed yet."},
    )


def _atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _ensure_installer_state_file() -> None:
    if INSTALLER_STATE_FILE.exists():
        return
    _atomic_write_json(INSTALLER_STATE_FILE, create_default_installer_state())


def _normalize_step(raw_step: object, default_step: InstallerStepState) -> InstallerStepState:
    if not isinstance(raw_step, dict):
        return default_step
    raw_status = str(raw_step.get("status", default_step["status"]))
    if raw_status not in {"pending", "active", "complete", "failed", "needs_action"}:
        raw_status = default_step["status"]
    return InstallerStepState(
        id=str(raw_step.get("id", default_step["id"])),
        title=str(raw_step.get("title", default_step["title"])),
        description=str(raw_step.get("description", default_step["description"])),
        status=raw_status,  # type: ignore[assignment]
        message=str(raw_step.get("message", default_step["message"])),
        error=str(raw_step["error"]) if raw_step.get("error") is not None else None,
        recovery_instructions=[str(item) for item in raw_step.get("recovery_instructions", [])],
        can_retry=bool(raw_step.get("can_retry", default_step["can_retry"])),
        can_repair=bool(raw_step.get("can_repair", default_step["can_repair"])),
        updated_at=str(raw_step.get("updated_at", default_step["updated_at"])),
        attempt_count=max(0, int(raw_step.get("attempt_count", default_step["attempt_count"]))),
    )


def _normalize_environment(raw_environment: object) -> EnvironmentCheckResult:
    if not isinstance(raw_environment, dict):
        return _empty_environment()

    checks = [
        DependencyStatus(
            id=str(item.get("id", "")),
            label=str(item.get("label", "")),
            category=str(item.get("category", "prerequisite")),
            installed=bool(item.get("installed", False)),
            version=str(item["version"]) if item.get("version") is not None else None,
            guidance=[str(entry) for entry in item.get("guidance", [])],
            approx_size_mb=(
                int(item["approx_size_mb"])
                if item.get("approx_size_mb") is not None
                else None
            ),
            can_auto_install=bool(item.get("can_auto_install", False)),
        )
        for item in raw_environment.get("checks", [])
        if isinstance(item, dict)
    ]

    if not checks:
        return _empty_environment()

    return EnvironmentCheckResult(
        platform=str(raw_environment.get("platform", _platform_key())),
        checks=checks,
        node_installed=bool(raw_environment.get("node_installed", False)),
        rust_installed=bool(raw_environment.get("rust_installed", False)),
        cpp_toolchain_installed=bool(
            raw_environment.get("cpp_toolchain_installed", not _requires_msvc_toolchain())
        ),
        runtime_dependencies_ready=bool(
            raw_environment.get("runtime_dependencies_ready", False)
        ),
        missing_prerequisites=[str(item) for item in raw_environment.get("missing_prerequisites", [])],
        missing_runtime_dependencies=[
            str(item) for item in raw_environment.get("missing_runtime_dependencies", [])
        ],
        all_ready=bool(raw_environment.get("all_ready", False)),
    )


def _sync_progress(state: InstallerStatus) -> None:
    for step_id in STEP_ORDER:
        if state["steps"][step_id]["status"] != "complete":
            state["current_step"] = step_id
            state["completed"] = False
            return

    state["completed"] = bool(state["connection"].get("connected", False))
    state["current_step"] = "complete" if state["completed"] else "start-connect"


def _resolve_command_path(command_name: str) -> str | None:
    resolved = shutil.which(command_name)
    if resolved:
        return resolved

    if _platform_key() != "windows":
        return None

    known_locations = {
        "node": [Path(r"C:\Program Files\nodejs\node.exe")],
        "rustc": [Path.home() / ".cargo" / "bin" / "rustc.exe"],
        "ollama": [Path.home() / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe"],
        "winget": [Path(r"C:\Users\Default\AppData\Local\Microsoft\WindowsApps\winget.exe")],
    }

    for path in known_locations.get(command_name, []):
        if path.exists():
            return str(path)
    return None


def _command_exists(command_name: str) -> bool:
    return _resolve_command_path(command_name) is not None


def _run_command_for_output(command: list[str]) -> str | None:
    resolved_command = command[:]
    binary_path = _resolve_command_path(command[0])
    if binary_path is not None:
        resolved_command[0] = binary_path

    try:
        completed_process = subprocess.run(
            resolved_command,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None
    output = (completed_process.stdout or completed_process.stderr).strip()
    if completed_process.returncode != 0 or not output:
        return None
    return output.splitlines()[0].strip()


def _run_install_command(command: list[str], *, timeout_seconds: int) -> CommandExecutionResult:
    resolved_command = command[:]
    binary_path = _resolve_command_path(command[0])
    if binary_path is not None:
        resolved_command[0] = binary_path

    try:
        completed_process = subprocess.run(
            resolved_command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        output = "\n".join(
            part.strip()
            for part in (completed_process.stdout or "", completed_process.stderr or "")
            if part.strip()
        )
        return {
            "ok": completed_process.returncode == 0,
            "timed_out": False,
            "returncode": completed_process.returncode,
            "output": output,
        }
    except subprocess.TimeoutExpired as error:
        output = "\n".join(
            str(part).strip()
            for part in (error.stdout or "", error.stderr or "")
            if str(part).strip()
        )
        return {
            "ok": False,
            "timed_out": True,
            "returncode": None,
            "output": output,
        }
    except (FileNotFoundError, subprocess.SubprocessError, OSError) as error:
        return {
            "ok": False,
            "timed_out": False,
            "returncode": None,
            "output": str(error),
        }


def _cpp_toolchain_installed() -> bool:
    if not _requires_msvc_toolchain():
        return True
    if _command_exists("cl") or _command_exists("link"):
        return True
    search_paths = (
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
    )
    return any(path.exists() and any(path.iterdir()) for path in search_paths)


def _dependency_definitions() -> list[dict[str, object]]:
    definitions: list[dict[str, object]] = []

    if _requires_desktop_shell_prerequisites():
        definitions.extend(
            [
                {
                    "id": "nodejs",
                    "label": "Node.js",
                    "category": "prerequisite",
                    "installed": lambda: _command_exists("node"),
                    "version_command": ["node", "--version"],
                },
                {
                    "id": "rust",
                    "label": "Rust",
                    "category": "prerequisite",
                    "installed": lambda: _command_exists("rustc"),
                    "version_command": ["rustc", "--version"],
                },
            ]
        )

        if _requires_msvc_toolchain():
            definitions.append(
                {
                    "id": "msvc",
                    "label": "Windows C++ / MSVC Toolchain",
                    "category": "prerequisite",
                    "installed": _cpp_toolchain_installed,
                    "version_command": None,
                }
            )

    definitions.append(
        {
            "id": "ollama",
            "label": "Ollama",
            "category": "runtime",
            "installed": lambda: _command_exists("ollama"),
            "version_command": ["ollama", "--version"],
        }
    )

    return definitions


def _dependency_guidance(label: str) -> list[str]:
    platform = _platform_key()

    if label == "Node.js":
        if platform == "windows":
            return [
                "We need Node.js to run the desktop shell.",
                "Companion OS can try a silent install with App Installer.",
                "If that does not work, install the latest Node.js LTS manually, reopen Companion OS, and choose Retry.",
            ]
        if platform == "macos":
            return [
                "We need Node.js to run the desktop shell.",
                "If Homebrew is available, Companion OS can install it for you.",
                "If not, install Node.js LTS manually or with Homebrew, reopen Companion OS, and choose Retry.",
            ]
        return [
            "We need Node.js to run the desktop shell.",
            "Linux setup varies by distribution, so we may need your help for this step.",
            "Install Node.js LTS with your distro package manager, reopen Companion OS, and choose Retry.",
        ]

    if label == "Rust":
        if platform == "windows":
            return [
                "We need Rust to build the local desktop runtime.",
                "Companion OS can try a silent install with App Installer.",
                "If that does not work, install Rust with rustup, reopen Companion OS, and choose Retry.",
            ]
        if platform == "macos":
            return [
                "We need Rust to build the local desktop runtime.",
                "If Homebrew is available, Companion OS can install it for you.",
                "If not, install Rust manually, reopen Companion OS, and choose Retry.",
            ]
        return [
            "We need Rust to build the local desktop runtime.",
            "Linux setup varies by distribution, so we may need your help for this step.",
            "Install Rust with rustup or your distro package manager, reopen Companion OS, and choose Retry.",
        ]

    if label == "Windows C++ / MSVC Toolchain":
        return [
            "We need the Windows C++ build tools for the desktop shell.",
            "Companion OS can try a quiet Build Tools install when App Installer is available.",
            "If that does not work, install Visual Studio Build Tools with the Desktop development with C++ workload, then choose Retry.",
        ]

    if platform == "windows":
        return [
            "We need Ollama so the companion can use a local open-source model.",
            "Companion OS can use the official Ollama Windows installer automatically.",
            "If that does not work, install Ollama manually from ollama.com, reopen Companion OS, and choose Retry.",
        ]
    if platform == "macos":
        return [
            "We need Ollama so the companion can use a local open-source model.",
            "If Homebrew is available, Companion OS can install it for you.",
            "If not, install Ollama manually, reopen Companion OS, and choose Retry.",
        ]
    return [
        "We need Ollama so the companion can use a local open-source model.",
        "Linux setup varies by distribution, so we may need your help for this step.",
        "Install Ollama manually, reopen Companion OS, and choose Retry.",
    ]


def _dependency_install_command(label: str) -> list[str] | None:
    platform = _platform_key()

    if platform == "windows":
        powershell_path = Path(
            os.environ.get("SystemRoot", r"C:\Windows")
        ) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        commands = {
            "Node.js": [
                "winget",
                "install",
                "OpenJS.NodeJS.LTS",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--disable-interactivity",
            ],
            "Rust": [
                "winget",
                "install",
                "Rustlang.Rustup",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--disable-interactivity",
            ],
            "Windows C++ / MSVC Toolchain": [
                "winget",
                "install",
                "Microsoft.VisualStudio.2022.BuildTools",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--disable-interactivity",
                "--override",
                (
                    "--quiet --norestart --wait --installWhileDownloading "
                    + "--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 "
                    + "--add Microsoft.VisualStudio.Component.Windows11SDK.22621"
                ),
            ],
            "Ollama": [
                str(powershell_path) if powershell_path.exists() else "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "Invoke-RestMethod https://ollama.com/install.ps1 | Invoke-Expression",
            ],
        }
        if not _command_exists("winget"):
            if label == "Ollama":
                return commands["Ollama"]
            return None
        return commands.get(label)

    if platform == "macos":
        if not _command_exists("brew"):
            return None
        commands = {
            "Node.js": ["brew", "install", "node"],
            "Rust": ["brew", "install", "rust"],
            "Ollama": ["brew", "install", "--cask", "ollama"],
        }
        return commands.get(label)

    return None


def _normalize_dependency_version(label: str, version: str | None) -> str | None:
    if label != "Ollama":
        return version

    if version is None:
        return "Installed on this PC"

    normalized_version = version.lower()
    if "could not connect to a running ollama instance" in normalized_version:
        return "Installed on this PC"

    return version


def _environment_checks() -> list[DependencyStatus]:
    checks: list[DependencyStatus] = []

    for definition in _dependency_definitions():
        installed = bool(definition["installed"]())
        label = str(definition["label"])
        version_command = definition["version_command"]
        version = None
        if installed and isinstance(version_command, list):
            version = _run_command_for_output(version_command)
        elif installed and label == "Windows C++ / MSVC Toolchain":
            version = "Build Tools detected"

        if installed:
            version = _normalize_dependency_version(label, version)

        checks.append(
            {
                "id": str(definition["id"]),
                "label": label,
                "category": str(definition["category"]),
                "installed": installed,
                "version": version,
                "guidance": _dependency_guidance(label),
                "approx_size_mb": _approx_size_for_dependency(label),
                "can_auto_install": _dependency_install_command(label) is not None,
            }
        )

    return checks


def _set_step(
    state: InstallerStatus,
    step_id: str,
    status: StepStatus,
    message: str,
    *,
    error: str | None = None,
    recovery_instructions: list[str] | None = None,
    can_retry: bool = False,
    can_repair: bool = False,
    increment_attempt: bool = False,
) -> InstallerStepState:
    step = state["steps"][step_id]
    step["status"] = status
    step["message"] = message
    step["error"] = error
    step["recovery_instructions"] = recovery_instructions or []
    step["can_retry"] = can_retry
    step["can_repair"] = can_repair
    step["updated_at"] = _now_iso()
    if increment_attempt:
        step["attempt_count"] = int(step["attempt_count"]) + 1
    return step


def _reset_step(step_id: str) -> InstallerStepState:
    return _default_steps()[step_id]


def _reset_steps_from(state: InstallerStatus, step_id: str) -> None:
    start_index = STEP_ORDER.index(step_id)
    for current_step_id in STEP_ORDER[start_index:]:
        state["steps"][current_step_id] = _reset_step(current_step_id)


def _promote_default_messages(state: InstallerStatus) -> None:
    if state["steps"]["download"]["status"] == "complete":
        state["steps"]["install-openclaw"]["message"] = (
            "Your system is ready. OpenClaw can be installed locally."
        )

    if bool(state["openclaw"].get("installed")):
        state["steps"]["configure-ai"]["message"] = (
            "Choose your default local model to finish setup."
        )


def _collect_environment_result() -> EnvironmentCheckResult:
    checks = _environment_checks()
    missing_prerequisites = [
        item["label"]
        for item in checks
        if item["category"] == "prerequisite" and not item["installed"]
    ]
    missing_runtime_dependencies = [
        item["label"]
        for item in checks
        if item["category"] == "runtime" and not item["installed"]
    ]

    node_installed = next(
        (item["installed"] for item in checks if item["label"] == "Node.js"),
        not _requires_desktop_shell_prerequisites(),
    )
    rust_installed = next(
        (item["installed"] for item in checks if item["label"] == "Rust"),
        not _requires_desktop_shell_prerequisites(),
    )
    cpp_installed = next(
        (
            item["installed"]
            for item in checks
            if item["label"] == "Windows C++ / MSVC Toolchain"
        ),
        not _requires_msvc_toolchain(),
    )

    return EnvironmentCheckResult(
        platform=_platform_key(),
        checks=checks,
        node_installed=node_installed,
        rust_installed=rust_installed,
        cpp_toolchain_installed=cpp_installed,
        runtime_dependencies_ready=len(missing_runtime_dependencies) == 0,
        missing_prerequisites=missing_prerequisites,
        missing_runtime_dependencies=missing_runtime_dependencies,
        all_ready=not missing_prerequisites and not missing_runtime_dependencies,
    )


def _openclaw_manifest_path(state: InstallerStatus) -> Path:
    return Path(str(state["openclaw"].get("manifest_path", _default_manifest_path())))


def _openclaw_install_health(state: InstallerStatus) -> tuple[bool, str | None]:
    manifest_path = _openclaw_manifest_path(state)
    install_path = Path(str(state["openclaw"].get("install_path", OPENCLAW_INSTALL_DIR)))

    if not install_path.exists():
        return False, "OpenClaw is not installed yet."
    if not manifest_path.exists():
        return False, "The OpenClaw install looks incomplete."

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False, "The OpenClaw install files need repair."

    if manifest.get("runtime") != "openclaw" or not manifest.get("installed", False):
        return False, "The OpenClaw install files need repair."

    return True, None


def _download_recovery_plan(missing_labels: list[str], *, package_manager_ready: bool) -> list[str]:
    instructions: list[str] = []
    platform = _platform_key()

    if not package_manager_ready:
        if platform == "windows":
            instructions.append(
                "We could not start the automatic installer because App Installer (winget) is not available."
            )
        elif platform == "macos":
            instructions.append(
                "We could not start the automatic installer because Homebrew is not available."
            )
        else:
            instructions.append(
                "Automatic installation is not available on this Linux setup yet."
            )

    for label in missing_labels:
        instructions.extend(_dependency_guidance(label))

    instructions.append(
        "When you are ready, choose Retry to re-check your system and continue from the same point."
    )
    return instructions


def _single_dependency_recovery_plan(
    dependency_label: str,
    *,
    package_manager_ready: bool,
) -> list[str]:
    return _download_recovery_plan(
        [dependency_label],
        package_manager_ready=package_manager_ready,
    )


def _interrupted_recovery_plan(step_id: str) -> list[str]:
    step_title = STEP_TITLES[step_id]
    return [
        f"The app was interrupted during {step_title}. Your progress was saved.",
        "Choose Retry to try the same step again.",
        "Choose Repair if you want Companion OS to clean up and resume from the last incomplete step.",
    ]


def _apply_state_recovery(state: InstallerStatus) -> InstallerStatus:
    state["environment"] = _collect_environment_result()

    for step_id in STEP_ORDER:
        if state["steps"][step_id]["status"] == "active":
            _set_step(
                state,
                step_id,
                "needs_action",
                f"{STEP_TITLES[step_id]} was interrupted. Your progress is saved.",
                error="Setup was interrupted before this step could finish.",
                recovery_instructions=_interrupted_recovery_plan(step_id),
                can_retry=True,
                can_repair=True,
            )

    if state["environment"]["all_ready"]:
        if state["steps"]["download"]["status"] in {"pending", "active", "failed", "needs_action"}:
            _set_step(
                state,
                "download",
                "complete",
                "Your system already has everything needed for the local install.",
            )
    elif state["steps"]["download"]["status"] == "complete":
        _set_step(
            state,
            "download",
            "needs_action",
            "We still need to finish a few essentials before OpenClaw can install.",
            error="Some required dependencies are still missing.",
            recovery_instructions=_download_recovery_plan(
                state["environment"]["missing_prerequisites"]
                + state["environment"]["missing_runtime_dependencies"],
                package_manager_ready=any(
                    item.get("can_auto_install", False) and not item["installed"]
                    for item in state["environment"]["checks"]
                ),
            ),
            can_retry=True,
            can_repair=True,
        )

    install_healthy, install_issue = _openclaw_install_health(state)
    if install_healthy:
        state["openclaw"]["installed"] = True
        state["openclaw"]["install_path"] = str(OPENCLAW_INSTALL_DIR)
        state["openclaw"]["manifest_path"] = _default_manifest_path()
        if state["steps"]["download"]["status"] == "complete" and state["steps"][
            "install-openclaw"
        ]["status"] in {"pending", "active", "failed", "needs_action"}:
            _set_step(
                state,
                "install-openclaw",
                "complete",
                "OpenClaw is already installed locally.",
            )
    elif state["steps"]["install-openclaw"]["status"] == "complete":
        state["openclaw"]["installed"] = False
        _set_step(
            state,
            "install-openclaw",
            "needs_action",
            "OpenClaw needs a quick repair before setup can continue.",
            error=install_issue,
            recovery_instructions=[
                "Choose Repair and Companion OS will rebuild the local OpenClaw files.",
            ],
            can_retry=True,
            can_repair=True,
        )
        _reset_steps_from(state, "configure-ai")

    selected_model = str(state["ai"].get("model", get_selected_model())).strip().lower()
    if selected_model not in SUPPORTED_LOCAL_MODELS:
        state["ai"] = {"provider": "local", "model": RECOMMENDED_LOCAL_MODEL}
        _set_step(
            state,
            "configure-ai",
            "needs_action",
            "We need to reselect the local model before the companion can start.",
            error="The saved model is no longer supported.",
            recovery_instructions=[
                "Choose the recommended local model to continue.",
                "If you are unsure, keep the default selection and continue.",
            ],
            can_retry=True,
            can_repair=True,
        )
        state["steps"]["start-connect"] = _reset_step("start-connect")

    if state["steps"]["start-connect"]["status"] == "complete" and not bool(
        state["connection"].get("connected", False)
    ):
        _set_step(
            state,
            "start-connect",
            "needs_action",
            "We need to reconnect the companion runtime.",
            error="The runtime did not finish connecting.",
            recovery_instructions=[
                "Choose Retry to reconnect the local runtime.",
                "Choose Repair if you want Companion OS to verify the local install first.",
            ],
            can_retry=True,
            can_repair=True,
        )

    _promote_default_messages(state)
    _sync_progress(state)
    return state


def _normalize_state(raw_state: object) -> InstallerStatus:
    defaults = create_default_installer_state()
    if not isinstance(raw_state, dict):
        return _apply_state_recovery(defaults)

    state = create_default_installer_state()
    state["environment"] = _normalize_environment(raw_state.get("environment"))

    raw_steps = raw_state.get("steps")
    if isinstance(raw_steps, dict):
        state["steps"] = {
            step_id: _normalize_step(raw_steps.get(step_id), defaults["steps"][step_id])
            for step_id in STEP_ORDER
        }

    raw_openclaw = raw_state.get("openclaw")
    if isinstance(raw_openclaw, dict):
        state["openclaw"] = {
            "installed": bool(raw_openclaw.get("installed", False)),
            "install_path": str(raw_openclaw.get("install_path", str(OPENCLAW_INSTALL_DIR))),
            "manifest_path": str(
                raw_openclaw.get("manifest_path", _default_manifest_path())
            ),
        }

    raw_ai = raw_state.get("ai")
    if isinstance(raw_ai, dict):
        state["ai"] = {
            "provider": str(raw_ai.get("provider", "local")),
            "model": str(raw_ai.get("model", get_selected_model())).strip().lower(),
        }

    raw_connection = raw_state.get("connection")
    if isinstance(raw_connection, dict):
        state["connection"] = {
            "connected": bool(raw_connection.get("connected", False)),
            "message": str(raw_connection.get("message", "Setup has not completed yet.")),
        }

    return _apply_state_recovery(state)


def _read_installer_state() -> InstallerStatus:
    _ensure_installer_state_file()
    with INSTALLER_STATE_FILE.open("r", encoding="utf-8") as file_handle:
        return _normalize_state(json.load(file_handle))


def _write_installer_state(state: InstallerStatus) -> None:
    normalized_state = _apply_state_recovery(state)
    _atomic_write_json(INSTALLER_STATE_FILE, normalized_state)


def _installer_step_result(
    message: str,
    resumed_step: str,
    *,
    state: InstallerStatus | None = None,
) -> InstallerActionResult:
    current_state = state if state is not None else get_installer_status()
    return {
        "message": message,
        "resumed_step": resumed_step,
        "step": current_state["steps"][resumed_step],
        "status": current_state,
    }


def check_environment() -> dict[str, object]:
    """Detect local prerequisites required for the desktop shell."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "download",
            "active",
            "Checking your system for the local OpenClaw setup.",
            increment_attempt=True,
        )
        _write_installer_state(state)

        environment = _collect_environment_result()
        state = _read_installer_state()
        state["environment"] = environment
        summary = (
            "Everything needed for the local-first install is already available."
            if environment["all_ready"]
            else (
                "We still need a few essentials before setup can continue: "
                + ", ".join(
                    environment["missing_prerequisites"]
                    + environment["missing_runtime_dependencies"]
                )
                + "."
            )
        )
        next_status: StepStatus = "complete" if environment["all_ready"] else "needs_action"
        step = _set_step(
            state,
            "download",
            next_status,
            summary,
            recovery_instructions=(
                []
                if environment["all_ready"]
                else _download_recovery_plan(
                    environment["missing_prerequisites"]
                    + environment["missing_runtime_dependencies"],
                    package_manager_ready=any(
                        item.get("can_auto_install", False) and not item["installed"]
                        for item in environment["checks"]
                    ),
                )
            ),
            can_retry=not environment["all_ready"],
            can_repair=not environment["all_ready"],
        )
        _promote_default_messages(state)
        _write_installer_state(state)

    return {"environment": environment, "step": step}


def _current_missing_dependency_statuses(
    environment: EnvironmentCheckResult,
) -> list[DependencyStatus]:
    return [
        item
        for item in environment["checks"]
        if (
            item["label"] in environment["missing_prerequisites"]
            or item["label"] in environment["missing_runtime_dependencies"]
        )
    ]


def _is_dependency_ready(
    environment: EnvironmentCheckResult,
    dependency_label: str,
) -> bool:
    return all(item["label"] != dependency_label for item in _current_missing_dependency_statuses(environment))


def _wait_for_dependency_ready(
    dependency_label: str,
    *,
    timeout_seconds: int = POST_INSTALL_SETTLE_SECONDS,
    poll_seconds: float = POST_INSTALL_POLL_SECONDS,
) -> EnvironmentCheckResult:
    environment = _collect_environment_result()
    if _is_dependency_ready(environment, dependency_label):
        return environment

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        time.sleep(poll_seconds)
        environment = _collect_environment_result()
        if _is_dependency_ready(environment, dependency_label):
            return environment

    return environment


def _download_follow_up_message(
    dependency_label: str,
    *,
    remaining: list[str],
) -> tuple[str, str, list[str]]:
    recovery = _single_dependency_recovery_plan(
        dependency_label,
        package_manager_ready=any(
            item.get("can_auto_install", False) and not item["installed"]
            for item in _collect_environment_result()["checks"]
        ),
    )

    if _platform_key() == "windows" and dependency_label == "Ollama":
        return (
            "Ollama is finishing setup",
            "Ollama may have opened to finish setup on Windows. Leave it open for a moment, then choose Retry here and we will continue from the same place.",
            [
                "Windows may open Ollama after installation so it can finish preparing the local runtime.",
                "Leave Ollama open for a moment, then return here and choose Retry.",
                *recovery,
            ],
        )

    return (
        f"We need to finish setting up {dependency_label} before we can continue.",
        f"Download paused while {dependency_label} waits for setup to finish.",
        recovery,
    )


def _download_failure_response(
    state: InstallerStatus,
    *,
    dependency_label: str,
    timeout: bool = False,
    output: str = "",
) -> dict[str, object]:
    state["environment"] = _collect_environment_result()
    remaining = (
        state["environment"]["missing_prerequisites"]
        + state["environment"]["missing_runtime_dependencies"]
    )
    issue_message = (
        f"{dependency_label} is taking longer than expected."
        if timeout
        else f"We could not finish installing {dependency_label}."
    )
    recovery = _download_recovery_plan(
        [dependency_label],
        package_manager_ready=any(
            item.get("can_auto_install", False) and not item["installed"]
            for item in state["environment"]["checks"]
        ),
    )
    if timeout:
        recovery.insert(
            0,
            "The automatic installer stopped because this step took too long. Your progress was saved.",
        )
    elif output:
        recovery.insert(
            0,
            "The automatic installer stopped after an error. Your progress was saved so you can retry safely.",
        )
    step = _set_step(
        state,
        "download",
        "failed",
        issue_message,
        error=issue_message,
        recovery_instructions=recovery,
        can_retry=True,
        can_repair=True,
    )
    _write_installer_state(state)
    return {
        "attempted": True,
        "installed": [],
        "remaining": remaining or [dependency_label],
        "message": issue_message,
        "environment": state["environment"],
        "step": step,
    }


def download_setup() -> dict[str, object]:
    """Run the canonical Download step, including prerequisite detection and setup."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "download",
            "active",
            "Checking your system and preparing the local setup essentials.",
            increment_attempt=True,
        )
        _write_installer_state(state)

        environment = _collect_environment_result()
        state = _read_installer_state()
        state["environment"] = environment

        if environment["all_ready"]:
            step = _set_step(
                state,
                "download",
                "complete",
                "Your system is ready for OpenClaw.",
            )
            _promote_default_messages(state)
            _write_installer_state(state)
            return {
                "attempted": False,
                "installed": [],
                "remaining": [],
                "message": "Download finished. All prerequisites are already available.",
                "environment": environment,
                "step": step,
            }

        installed: list[str] = []
        missing_statuses = _current_missing_dependency_statuses(environment)

        for dependency in missing_statuses:
            if dependency["installed"]:
                continue

            command = _dependency_install_command(dependency["label"])
            if command is None:
                recovery = _single_dependency_recovery_plan(
                    dependency["label"],
                    package_manager_ready=False,
                )
                step = _set_step(
                    state,
                    "download",
                    "needs_action",
                    f"We need to finish setting up {dependency['label']} before we can continue.",
                    error=f"{dependency['label']} still needs to be installed.",
                    recovery_instructions=recovery,
                    can_retry=True,
                    can_repair=True,
                )
                _write_installer_state(state)
                return {
                    "attempted": bool(installed),
                    "installed": installed,
                    "remaining": environment["missing_prerequisites"]
                    + environment["missing_runtime_dependencies"],
                    "message": f"Download paused while {dependency['label']} waits for manual setup.",
                    "environment": environment,
                    "step": step,
                }

            _set_step(
                state,
                "download",
                "active",
                f"Installing {dependency['label']} for this device.",
            )
            _write_installer_state(state)
            result = _run_install_command(
                command,
                timeout_seconds=INSTALL_COMMAND_TIMEOUT_SECONDS,
            )
            state = _read_installer_state()
            if result["timed_out"]:
                return _download_failure_response(
                    state,
                    dependency_label=dependency["label"],
                    timeout=True,
                    output=result["output"],
                )
            if not result["ok"]:
                return _download_failure_response(
                    state,
                    dependency_label=dependency["label"],
                    timeout=False,
                    output=result["output"],
                )

            settled_environment = _wait_for_dependency_ready(dependency["label"])
            state = _read_installer_state()
            state["environment"] = settled_environment
            if not _is_dependency_ready(settled_environment, dependency["label"]):
                remaining = (
                    settled_environment["missing_prerequisites"]
                    + settled_environment["missing_runtime_dependencies"]
                )
                step_message, response_message, recovery = _download_follow_up_message(
                    dependency["label"],
                    remaining=remaining,
                )
                step = _set_step(
                    state,
                    "download",
                    "needs_action",
                    step_message,
                    error=f"{dependency['label']} still needs to finish setting up.",
                    recovery_instructions=recovery,
                    can_retry=True,
                    can_repair=True,
                )
                _write_installer_state(state)
                return {
                    "attempted": True,
                    "installed": installed,
                    "remaining": remaining or [dependency["label"]],
                    "message": response_message,
                    "environment": settled_environment,
                    "step": step,
                }

            installed.append(dependency["label"])

        refreshed_environment = _collect_environment_result()
        state = _read_installer_state()
        state["environment"] = refreshed_environment
        remaining = (
            refreshed_environment["missing_prerequisites"]
            + refreshed_environment["missing_runtime_dependencies"]
        )

        if remaining:
            step = _set_step(
                state,
                "download",
                "needs_action",
                "We finished part of setup, but a few items still need attention.",
                error="Some required items are still missing.",
                recovery_instructions=_download_recovery_plan(
                    remaining,
                    package_manager_ready=any(
                        item.get("can_auto_install", False) and not item["installed"]
                        for item in refreshed_environment["checks"]
                    ),
                ),
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
            return {
                "attempted": True,
                "installed": installed,
                "remaining": remaining,
                "message": "Download paused with follow-up actions required.",
                "environment": refreshed_environment,
                "step": step,
            }

        step = _set_step(
            state,
            "download",
            "complete",
            "Your system is ready for OpenClaw.",
        )
        _promote_default_messages(state)
        _write_installer_state(state)
        return {
            "attempted": True,
            "installed": installed,
            "remaining": [],
            "message": "Download finished.",
            "environment": refreshed_environment,
            "step": step,
        }


def prepare_prerequisites() -> dict[str, object]:
    """Compatibility wrapper for the legacy prerequisite route."""

    return download_setup()


def get_installer_status() -> InstallerStatus:
    """Return the persisted installer state."""

    with _installer_lock:
        state = _read_installer_state()
        _write_installer_state(state)
        return state


def install_openclaw() -> dict[str, object]:
    """Prepare a local OpenClaw workspace on disk."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "install-openclaw",
            "active",
            "Installing OpenClaw locally.",
            increment_attempt=True,
        )
        _write_installer_state(state)

        environment = _collect_environment_result()
        state = _read_installer_state()
        state["environment"] = environment
        if not environment["all_ready"]:
            instructions = _download_recovery_plan(
                environment["missing_prerequisites"]
                + environment["missing_runtime_dependencies"],
                package_manager_ready=any(
                    item.get("can_auto_install", False) and not item["installed"]
                    for item in environment["checks"]
                ),
            )
            _set_step(
                state,
                "download",
                "needs_action",
                "We still need to finish setting up this device before OpenClaw can install.",
                error="Some required dependencies are still missing.",
                recovery_instructions=instructions,
                can_retry=True,
                can_repair=True,
            )
            _set_step(
                state,
                "install-openclaw",
                "needs_action",
                "OpenClaw is waiting for the remaining setup items.",
                error="The local runtime environment is not ready yet.",
                recovery_instructions=instructions,
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
            raise RuntimeError("OpenClaw cannot install until prerequisites are ready.")

        OPENCLAW_INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        manifest_path = OPENCLAW_INSTALL_DIR / "openclaw.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "runtime": "openclaw",
                    "source": "local-install-wizard",
                    "installed": True,
                    "provider": "local",
                    "default_model_runtime": "ollama",
                    "state_version": _state_version(),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        state = _read_installer_state()
        state["environment"] = environment
        if state["steps"]["download"]["status"] != "complete":
            _set_step(
                state,
                "download",
                "complete",
                "Your system is ready for OpenClaw.",
            )
        state["openclaw"] = {
            "installed": True,
            "install_path": str(OPENCLAW_INSTALL_DIR),
            "manifest_path": str(manifest_path),
        }
        step = _set_step(
            state,
            "install-openclaw",
            "complete",
            "OpenClaw is installed locally and ready for AI setup.",
        )
        _promote_default_messages(state)
        _write_installer_state(state)

    return {
        "install_path": str(OPENCLAW_INSTALL_DIR),
        "message": f"OpenClaw prepared locally at {OPENCLAW_INSTALL_DIR}.",
        "step": step,
    }


def get_supported_models() -> list[str]:
    """Return the supported local-first model names."""

    return list(SUPPORTED_LOCAL_MODELS)


def configure_ai(model_name: str) -> dict[str, object]:
    """Persist the selected default local model."""

    normalized_model_name = model_name.strip().lower()

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "configure-ai",
            "active",
            "Saving your default local model.",
            increment_attempt=True,
        )
        _write_installer_state(state)

        if normalized_model_name not in SUPPORTED_LOCAL_MODELS:
            _set_step(
                state,
                "configure-ai",
                "failed",
                "That model is not available in this setup yet.",
                error="The selected model is not supported in the MVP installer.",
                recovery_instructions=[
                    "Choose one of the supported local models listed in the installer.",
                ],
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
            raise ValueError(f"Unsupported local model: {normalized_model_name}")

        persisted_model = set_selected_model(normalized_model_name)
        state["ai"] = {"provider": "local", "model": persisted_model}
        step = _set_step(
            state,
            "configure-ai",
            "complete",
            f"{persisted_model} is ready as your default local model.",
        )
        _write_installer_state(state)

    return {
        "provider": "local",
        "model": persisted_model,
        "message": f"Configured local model {persisted_model}.",
        "step": step,
    }


def start_and_connect() -> dict[str, object]:
    """Mark the local companion runtime as ready to start and connect."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "start-connect",
            "active",
            "Starting the local runtime and connecting the companion.",
            increment_attempt=True,
        )
        _write_installer_state(state)

        state = _read_installer_state()
        install_healthy, install_issue = _openclaw_install_health(state)
        if not install_healthy:
            _set_step(
                state,
                "start-connect",
                "failed",
                "We need to repair the local OpenClaw install before the companion can connect.",
                error=install_issue,
                recovery_instructions=[
                    "Choose Repair and Companion OS will rebuild the local OpenClaw files.",
                ],
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
            raise RuntimeError("OpenClaw must be installed before starting.")

        selected_model = str(state["ai"]["model"])
        if selected_model not in SUPPORTED_LOCAL_MODELS:
            _set_step(
                state,
                "start-connect",
                "failed",
                "Choose a supported local model before the companion can connect.",
                error="A supported local model must be configured before starting.",
                recovery_instructions=[
                    "Finish Configure AI with one of the supported local models, then choose Retry.",
                ],
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
            raise RuntimeError(
                "A supported local model must be configured before starting."
            )

        environment = _collect_environment_result()
        if not environment["all_ready"]:
            _set_step(
                state,
                "start-connect",
                "needs_action",
                "We still need to finish setting up this device before the companion can start.",
                error="Some required dependencies are still missing.",
                recovery_instructions=_download_recovery_plan(
                    environment["missing_prerequisites"]
                    + environment["missing_runtime_dependencies"],
                    package_manager_ready=any(
                        item.get("can_auto_install", False) and not item["installed"]
                        for item in environment["checks"]
                    ),
                ),
                can_retry=True,
                can_repair=True,
            )
            state["environment"] = environment
            _write_installer_state(state)
            raise RuntimeError("OpenClaw must be installed before starting.")

        state["environment"] = environment
        state["connection"] = {
            "connected": True,
            "message": "Companion OS is running on the local OpenClaw runtime.",
        }
        step = _set_step(
            state,
            "start-connect",
            "complete",
            "The companion is connected and ready.",
        )
        _write_installer_state(state)

    return {
        "connected": True,
        "message": "Companion runtime is ready. Start & Connect completed.",
        "step": step,
    }


def repair_installation() -> InstallerActionResult:
    """Repair the current incomplete installer step and resume from there."""

    with _installer_lock:
        state = _read_installer_state()
        target_step_id = next(
            (
                step_id
                for step_id in STEP_ORDER
                if state["steps"][step_id]["status"] in {"failed", "needs_action"}
            ),
            None,
        )
        if target_step_id is None:
            target_step_id = next(
                (step_id for step_id in STEP_ORDER if state["steps"][step_id]["status"] != "complete"),
                "start-connect",
            )

    if target_step_id == "download":
        result = download_setup()
        status = get_installer_status()
        return _installer_step_result(
            result["message"],
            "download",
            state=status,
        )

    if target_step_id == "install-openclaw":
        shutil.rmtree(OPENCLAW_INSTALL_DIR, ignore_errors=True)
        with _installer_lock:
            state = _read_installer_state()
            state["openclaw"] = {
                "installed": False,
                "install_path": str(OPENCLAW_INSTALL_DIR),
                "manifest_path": _default_manifest_path(),
            }
            _reset_steps_from(state, "install-openclaw")
            if state["steps"]["download"]["status"] != "complete":
                _set_step(
                    state,
                    "download",
                    "needs_action",
                    "We still need to finish preparing this device before OpenClaw can install.",
                    error="Some required dependencies are still missing.",
                    recovery_instructions=_download_recovery_plan(
                        state["environment"]["missing_prerequisites"]
                        + state["environment"]["missing_runtime_dependencies"],
                        package_manager_ready=any(
                            item.get("can_auto_install", False) and not item["installed"]
                            for item in state["environment"]["checks"]
                        ),
                    ),
                    can_retry=True,
                    can_repair=True,
                )
            _write_installer_state(state)
        result = install_openclaw()
        status = get_installer_status()
        return _installer_step_result(
            result["message"],
            "install-openclaw",
            state=status,
        )

    if target_step_id == "configure-ai":
        selected_model = str(get_installer_status()["ai"]["model"]).strip().lower()
        if selected_model not in SUPPORTED_LOCAL_MODELS:
            selected_model = RECOMMENDED_LOCAL_MODEL
        result = configure_ai(selected_model)
        status = get_installer_status()
        return _installer_step_result(
            result["message"],
            "configure-ai",
            state=status,
        )

    result = start_and_connect()
    status = get_installer_status()
    return _installer_step_result(
        result["message"],
        "start-connect",
        state=status,
    )

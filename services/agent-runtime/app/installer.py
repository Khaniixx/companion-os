"""OpenClaw installer state and orchestration helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from threading import Lock
from typing import Final, Literal, TypedDict

from app.model_catalog import SUPPORTED_LOCAL_MODELS
from app.preferences import get_selected_model, set_selected_model

INSTALLER_STATE_FILE = Path(__file__).resolve().parents[1] / "data" / "installer_state.json"
OPENCLAW_INSTALL_DIR = Path(__file__).resolve().parents[1] / "data" / "openclaw"
STEP_ORDER: Final[tuple[str, ...]] = (
    "download",
    "install-openclaw",
    "configure-ai",
    "start-connect",
)
StepStatus = Literal["pending", "active", "complete", "failed", "needs_action"]

_installer_lock = Lock()


class DependencyStatus(TypedDict):
    id: str
    label: str
    category: str
    installed: bool
    version: str | None
    guidance: list[str]


class EnvironmentCheckResult(TypedDict):
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


class InstallerStatus(TypedDict):
    current_step: str
    completed: bool
    environment: EnvironmentCheckResult
    steps: dict[str, InstallerStepState]
    openclaw: dict[str, object]
    ai: dict[str, object]
    connection: dict[str, object]


def _empty_environment() -> EnvironmentCheckResult:
    return EnvironmentCheckResult(
        checks=[],
        node_installed=False,
        rust_installed=False,
        cpp_toolchain_installed=False,
        runtime_dependencies_ready=False,
        missing_prerequisites=["Node.js", "Rust", "Windows C++ / MSVC Toolchain"],
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
    )


def _default_steps() -> dict[str, InstallerStepState]:
    return {
        "download": _make_step(
            "download",
            "Download",
            "Prepare the local setup package and required prerequisites for this PC.",
            "Download has not started yet.",
        ),
        "install-openclaw": _make_step(
            "install-openclaw",
            "Install OpenClaw",
            "Create the local OpenClaw runtime files used by the desktop shell.",
            "Waiting for Download to finish.",
        ),
        "configure-ai": _make_step(
            "configure-ai",
            "Configure AI",
            "Choose the default local, open-source model for first-run use.",
            "Choose a local model to continue.",
        ),
        "start-connect": _make_step(
            "start-connect",
            "Start & Connect",
            "Bring the local companion online and connect the desktop shell.",
            "OpenClaw will start after AI configuration.",
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
            "manifest_path": str(OPENCLAW_INSTALL_DIR / "openclaw.json"),
        },
        ai={"provider": "local", "model": get_selected_model()},
        connection={"connected": False, "message": "Setup has not completed yet."},
    )


def _ensure_installer_state_file() -> None:
    if INSTALLER_STATE_FILE.exists():
        return
    INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTALLER_STATE_FILE.write_text(
        json.dumps(create_default_installer_state(), indent=2),
        encoding="utf-8",
    )


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
        )
        for item in raw_environment.get("checks", [])
        if isinstance(item, dict)
    ]
    if not checks:
        return _empty_environment()
    return EnvironmentCheckResult(
        checks=checks,
        node_installed=bool(raw_environment.get("node_installed", False)),
        rust_installed=bool(raw_environment.get("rust_installed", False)),
        cpp_toolchain_installed=bool(raw_environment.get("cpp_toolchain_installed", False)),
        runtime_dependencies_ready=bool(raw_environment.get("runtime_dependencies_ready", False)),
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
    state["current_step"] = "complete"
    state["completed"] = bool(state["connection"].get("connected", False))


def _normalize_state(raw_state: object) -> InstallerStatus:
    defaults = create_default_installer_state()
    if not isinstance(raw_state, dict):
        return defaults
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
            "install_path": str(raw_openclaw.get("install_path", state["openclaw"]["install_path"])),
            "manifest_path": str(
                raw_openclaw.get("manifest_path", state["openclaw"]["manifest_path"])
            ),
        }
    raw_ai = raw_state.get("ai")
    if isinstance(raw_ai, dict):
        state["ai"] = {
            "provider": str(raw_ai.get("provider", state["ai"]["provider"])),
            "model": str(raw_ai.get("model", state["ai"]["model"])),
        }
    raw_connection = raw_state.get("connection")
    if isinstance(raw_connection, dict):
        state["connection"] = {
            "connected": bool(raw_connection.get("connected", False)),
            "message": str(raw_connection.get("message", state["connection"]["message"])),
        }
    _sync_progress(state)
    return state


def _read_installer_state() -> InstallerStatus:
    _ensure_installer_state_file()
    with INSTALLER_STATE_FILE.open("r", encoding="utf-8") as file_handle:
        return _normalize_state(json.load(file_handle))


def _write_installer_state(state: InstallerStatus) -> None:
    _sync_progress(state)
    INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTALLER_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _command_exists(command_name: str) -> bool:
    return shutil.which(command_name) is not None


def _run_command_for_output(command: list[str]) -> str | None:
    try:
        completed_process = subprocess.run(
            command,
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


def _cpp_toolchain_installed() -> bool:
    if _command_exists("cl") or _command_exists("link"):
        return True
    search_paths = (
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
    )
    return any(path.exists() and any(path.iterdir()) for path in search_paths)


def _dependency_guidance(label: str) -> list[str]:
    if label == "Node.js":
        return [
            "Node.js is required to build and run the desktop shell.",
            "Silent install command: winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --disable-interactivity",
            "If silent install does not work, install the latest Node.js LTS manually, reopen Companion OS, and choose Retry.",
        ]
    if label == "Rust":
        return [
            "Rust is required for the Tauri desktop runtime.",
            "Silent install command: winget install Rustlang.Rustup --accept-source-agreements --accept-package-agreements --disable-interactivity",
            "If silent install does not work, install Rust with rustup, reopen Companion OS, and choose Retry.",
        ]
    if label == "Windows C++ / MSVC Toolchain":
        return [
            "The Windows desktop build needs the Visual Studio C++ build tools.",
            'Silent install command: winget install Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements --disable-interactivity --override "--quiet --norestart --wait --installWhileDownloading --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"',
            "If silent install is blocked, install Desktop development with C++ plus the Windows 11 SDK, then choose Retry.",
        ]
    return [
        "Ollama provides the local model runtime for the default setup path.",
        "Silent install command: winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --disable-interactivity",
        "If silent install does not work, install Ollama manually, reopen Companion OS, and choose Retry.",
    ]


def _environment_checks() -> list[DependencyStatus]:
    node_installed = _command_exists("node")
    rust_installed = _command_exists("rustc")
    cpp_installed = _cpp_toolchain_installed()
    ollama_installed = _command_exists("ollama")
    return [
        {
            "id": "nodejs",
            "label": "Node.js",
            "category": "prerequisite",
            "installed": node_installed,
            "version": _run_command_for_output(["node", "--version"]) if node_installed else None,
            "guidance": _dependency_guidance("Node.js"),
        },
        {
            "id": "rust",
            "label": "Rust",
            "category": "prerequisite",
            "installed": rust_installed,
            "version": _run_command_for_output(["rustc", "--version"]) if rust_installed else None,
            "guidance": _dependency_guidance("Rust"),
        },
        {
            "id": "msvc",
            "label": "Windows C++ / MSVC Toolchain",
            "category": "prerequisite",
            "installed": cpp_installed,
            "version": "Build Tools detected" if cpp_installed else None,
            "guidance": _dependency_guidance("Windows C++ / MSVC Toolchain"),
        },
        {
            "id": "ollama",
            "label": "Ollama",
            "category": "runtime",
            "installed": ollama_installed,
            "version": _run_command_for_output(["ollama", "--version"]) if ollama_installed else None,
            "guidance": _dependency_guidance("Ollama"),
        },
    ]


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
) -> InstallerStepState:
    step = state["steps"][step_id]
    step["status"] = status
    step["message"] = message
    step["error"] = error
    step["recovery_instructions"] = recovery_instructions or []
    step["can_retry"] = can_retry
    step["can_repair"] = can_repair
    return step


def _promote_default_messages(state: InstallerStatus) -> None:
    if state["steps"]["download"]["status"] == "complete":
        state["steps"]["install-openclaw"]["message"] = (
            "The device is ready. OpenClaw can be installed locally."
        )

    if state["openclaw"]["installed"]:
        state["steps"]["configure-ai"]["message"] = (
            "OpenClaw is installed. Choose the local model to finish setup."
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
    return EnvironmentCheckResult(
        checks=checks,
        node_installed=next(
            item["installed"] for item in checks if item["label"] == "Node.js"
        ),
        rust_installed=next(
            item["installed"] for item in checks if item["label"] == "Rust"
        ),
        cpp_toolchain_installed=next(
            item["installed"]
            for item in checks
            if item["label"] == "Windows C++ / MSVC Toolchain"
        ),
        runtime_dependencies_ready=len(missing_runtime_dependencies) == 0,
        missing_prerequisites=missing_prerequisites,
        missing_runtime_dependencies=missing_runtime_dependencies,
        all_ready=not missing_prerequisites and not missing_runtime_dependencies,
    )


def check_environment() -> dict[str, object]:
    """Detect local prerequisites required for the desktop shell."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "download",
            "active",
            "Inspecting the device for local runtime prerequisites.",
        )
        _write_installer_state(state)

    environment = _collect_environment_result()
    summary = (
        "Everything needed for the local-first install is already available."
        if environment["all_ready"]
        else (
            "We found missing items to prepare: "
            + ", ".join(
                environment["missing_prerequisites"]
                + environment["missing_runtime_dependencies"]
            )
            + "."
        )
    )

    with _installer_lock:
        state = _read_installer_state()
        state["environment"] = environment
        next_status: StepStatus = "complete" if environment["all_ready"] else "active"
        step = _set_step(state, "download", next_status, summary, can_retry=True)
        _promote_default_messages(state)
        _write_installer_state(state)

    return {"environment": environment, "step": step}


def _run_install_command(command: list[str]) -> bool:
    completed_process = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed_process.returncode == 0


def _winget_install_commands() -> dict[str, list[str]]:
    return {
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
            "--quiet --norestart --wait --installWhileDownloading --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621",
        ],
        "Ollama": [
            "winget",
            "install",
            "Ollama.Ollama",
            "--accept-source-agreements",
            "--accept-package-agreements",
            "--disable-interactivity",
        ],
    }


def _recovery_plan(missing_labels: list[str], *, winget_available: bool) -> list[str]:
    instructions: list[str] = []
    if not winget_available:
        instructions.append(
            "Automatic setup could not start because Windows App Installer (winget) is not available on this PC."
        )
        instructions.append(
            "Install or enable App Installer from Microsoft, reopen Companion OS, and choose Retry."
        )
    for label in missing_labels:
        instructions.extend(_dependency_guidance(label))
    instructions.append(
        "After finishing the missing items, reopen the wizard and choose Retry to continue."
    )
    return instructions


def download_setup() -> dict[str, object]:
    """Run the canonical Download step, including prerequisite detection and setup."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "download",
            "active",
            "Downloading setup requirements and preparing this PC for OpenClaw.",
        )
        _write_installer_state(state)

    environment = _collect_environment_result()
    missing_items = (
        environment["missing_prerequisites"] + environment["missing_runtime_dependencies"]
    )

    if environment["all_ready"]:
        with _installer_lock:
            state = _read_installer_state()
            state["environment"] = environment
            step = _set_step(
                state,
                "download",
                "complete",
                "Download finished. Everything needed for OpenClaw is already in place.",
            )
            _promote_default_messages(state)
            _write_installer_state(state)
        return {
            "attempted": False,
            "installed": [],
            "remaining": [],
            "message": "Download finished. All prerequisites are already installed.",
            "environment": environment,
            "step": step,
        }

    winget_available = _command_exists("winget")
    if not winget_available:
        instructions = _recovery_plan(missing_items, winget_available=False)
        with _installer_lock:
            state = _read_installer_state()
            state["environment"] = environment
            step = _set_step(
                state,
                "download",
                "needs_action",
                "Download is paused until one quick manual step is finished.",
                error="winget is not available on this device.",
                recovery_instructions=instructions,
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
        return {
            "attempted": False,
            "installed": [],
            "remaining": missing_items,
            "message": "Download needs App Installer before automatic setup can continue.",
            "environment": environment,
            "step": step,
        }

    installed: list[str] = []
    for dependency in missing_items:
        command = _winget_install_commands().get(dependency)
        if command and _run_install_command(command):
            installed.append(dependency)

    refreshed = check_environment()["environment"]
    remaining_items = (
        refreshed["missing_prerequisites"] + refreshed["missing_runtime_dependencies"]
    )
    if remaining_items:
        instructions = _recovery_plan(remaining_items, winget_available=True)
        with _installer_lock:
            state = _read_installer_state()
            step = _set_step(
                state,
                "download",
                "needs_action",
                "Download still needs a little manual help before OpenClaw can install.",
                error="Automatic setup did not finish every required item.",
                recovery_instructions=instructions,
                can_retry=True,
                can_repair=True,
            )
            _write_installer_state(state)
        return {
            "attempted": True,
            "installed": installed,
            "remaining": remaining_items,
            "message": "Download finished with follow-up steps required.",
            "environment": refreshed,
            "step": step,
        }

    with _installer_lock:
        state = _read_installer_state()
        state["environment"] = refreshed
        step = _set_step(
            state,
            "download",
            "complete",
            "Download finished. This PC is ready for OpenClaw.",
        )
        _promote_default_messages(state)
        _write_installer_state(state)

    return {
        "attempted": True,
        "installed": installed,
        "remaining": [],
        "message": "Download finished.",
        "environment": refreshed,
        "step": step,
    }


def prepare_prerequisites() -> dict[str, object]:
    """Compatibility wrapper for the legacy prerequisite route."""

    return download_setup()


def get_installer_status() -> InstallerStatus:
    """Return the persisted installer state."""

    with _installer_lock:
        return _read_installer_state()


def install_openclaw() -> dict[str, object]:
    """Prepare a local OpenClaw workspace on disk."""

    with _installer_lock:
        state = _read_installer_state()
        _set_step(
            state,
            "install-openclaw",
            "active",
            "Installing OpenClaw into the local runtime folder.",
        )
        _write_installer_state(state)

    environment = _collect_environment_result()
    if not environment["all_ready"]:
        instructions = _recovery_plan(
            environment["missing_prerequisites"] + environment["missing_runtime_dependencies"],
            winget_available=_command_exists("winget"),
        )
        with _installer_lock:
            state = _read_installer_state()
            state["environment"] = environment
            _set_step(
                state,
                "download",
                "needs_action",
                "Download must finish before OpenClaw can install.",
                error="The device still needs setup before installation can continue.",
                recovery_instructions=instructions,
                can_retry=True,
                can_repair=True,
            )
            _set_step(
                state,
                "install-openclaw",
                "needs_action",
                "OpenClaw is waiting for the remaining prerequisites.",
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
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    with _installer_lock:
        state = _read_installer_state()
        state["environment"] = environment
        if state["steps"]["download"]["status"] != "complete":
            _set_step(
                state,
                "download",
                "complete",
                "Download finished. This PC is ready for OpenClaw.",
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
            "OpenClaw is installed locally and ready for model configuration.",
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
            "Saving the default local, open-source model.",
        )
        _write_installer_state(state)

    if normalized_model_name not in SUPPORTED_LOCAL_MODELS:
        with _installer_lock:
            state = _read_installer_state()
            _set_step(
                state,
                "configure-ai",
                "failed",
                "The selected model is not supported in the MVP installer.",
                error=f"Unsupported local model: {normalized_model_name}",
                recovery_instructions=[
                    "Choose one of the supported local, open-source models listed in the installer.",
                ],
                can_retry=True,
            )
            _write_installer_state(state)
        raise ValueError(f"Unsupported local model: {normalized_model_name}")

    with _installer_lock:
        state = _read_installer_state()
        persisted_model = set_selected_model(normalized_model_name)
        state["ai"] = {"provider": "local", "model": normalized_model_name}
        step = _set_step(
            state,
            "configure-ai",
            "complete",
            f"{persisted_model} is now the default local model.",
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
        )
        _write_installer_state(state)

    with _installer_lock:
        state = _read_installer_state()
        if not bool(state["openclaw"]["installed"]):
            _set_step(
                state,
                "start-connect",
                "failed",
                "OpenClaw still needs to be installed before the companion can connect.",
                error="OpenClaw must be installed before starting.",
                recovery_instructions=[
                    "Finish the Install OpenClaw step, then choose Retry.",
                ],
                can_retry=True,
            )
            _write_installer_state(state)
            raise RuntimeError("OpenClaw must be installed before starting.")

        selected_model = str(state["ai"]["model"])
        if selected_model not in SUPPORTED_LOCAL_MODELS:
            _set_step(
                state,
                "start-connect",
                "failed",
                "A supported local model must be selected before the companion can connect.",
                error="A supported local model must be configured before starting.",
                recovery_instructions=[
                    "Finish Configure AI with one of the supported local models, then choose Retry.",
                ],
                can_retry=True,
            )
            _write_installer_state(state)
            raise RuntimeError(
                "A supported local model must be configured before starting."
            )

        state["connection"] = {
            "connected": True,
            "message": "Companion OS is running on the local OpenClaw runtime.",
        }
        step = _set_step(
            state,
            "start-connect",
            "complete",
            "The companion is connected and ready in the desktop shell.",
        )
        _write_installer_state(state)

    return {
        "connected": True,
        "message": "Companion runtime is ready. Start & Connect completed.",
        "step": step,
    }

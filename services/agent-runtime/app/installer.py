"""OpenClaw installer state and orchestration helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from threading import Lock
from typing import Final, TypedDict


INSTALLER_STATE_FILE = Path(__file__).resolve().parents[1] / "data" / "installer_state.json"
OPENCLAW_INSTALL_DIR = Path(__file__).resolve().parents[1] / "data" / "openclaw"
SUPPORTED_LOCAL_MODELS: Final[tuple[str, ...]] = (
    "llama3.1:8b-instruct",
    "mistral-small:24b-instruct",
    "qwen2.5-coder:7b-instruct",
)

DEFAULT_INSTALLER_STATE: Final[dict[str, object]] = {
    "environment": {
        "node_installed": False,
        "rust_installed": False,
        "cpp_toolchain_installed": False,
        "missing_prerequisites": ["Node.js", "Rust", "C++ Toolchain"],
        "all_ready": False,
    },
    "openclaw": {
        "installed": False,
        "install_path": str(OPENCLAW_INSTALL_DIR),
    },
    "ai": {
        "provider": "local",
        "model": "llama3.1:8b-instruct",
    },
    "connection": {
        "connected": False,
    },
}

_installer_lock = Lock()


class EnvironmentCheckResult(TypedDict):
    """Serializable environment status."""

    node_installed: bool
    rust_installed: bool
    cpp_toolchain_installed: bool
    missing_prerequisites: list[str]
    all_ready: bool


class InstallerStatus(TypedDict):
    """Serializable installer state."""

    environment: EnvironmentCheckResult
    openclaw: dict[str, object]
    ai: dict[str, str]
    connection: dict[str, bool]


def _ensure_installer_state_file() -> None:
    if INSTALLER_STATE_FILE.exists():
        return

    INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTALLER_STATE_FILE.write_text(
        json.dumps(DEFAULT_INSTALLER_STATE, indent=2),
        encoding="utf-8",
    )


def _read_installer_state() -> InstallerStatus:
    _ensure_installer_state_file()

    with INSTALLER_STATE_FILE.open("r", encoding="utf-8") as file_handle:
        loaded_state = json.load(file_handle)

    return InstallerStatus(
        environment=EnvironmentCheckResult(
            node_installed=bool(
                loaded_state.get("environment", {}).get("node_installed", False)
            ),
            rust_installed=bool(
                loaded_state.get("environment", {}).get("rust_installed", False)
            ),
            cpp_toolchain_installed=bool(
                loaded_state.get("environment", {}).get("cpp_toolchain_installed", False)
            ),
            missing_prerequisites=list(
                loaded_state.get("environment", {}).get(
                    "missing_prerequisites", DEFAULT_INSTALLER_STATE["environment"]["missing_prerequisites"]
                )
            ),
            all_ready=bool(
                loaded_state.get("environment", {}).get("all_ready", False)
            ),
        ),
        openclaw={
            "installed": bool(loaded_state.get("openclaw", {}).get("installed", False)),
            "install_path": str(
                loaded_state.get("openclaw", {}).get(
                    "install_path", str(OPENCLAW_INSTALL_DIR)
                )
            ),
        },
        ai={
            "provider": str(loaded_state.get("ai", {}).get("provider", "local")),
            "model": str(
                loaded_state.get("ai", {}).get(
                    "model", DEFAULT_INSTALLER_STATE["ai"]["model"]
                )
            ),
        },
        connection={
            "connected": bool(
                loaded_state.get("connection", {}).get("connected", False)
            )
        },
    )


def _write_installer_state(state: InstallerStatus) -> None:
    INSTALLER_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTALLER_STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _command_exists(command_name: str) -> bool:
    return shutil.which(command_name) is not None


def _cpp_toolchain_installed() -> bool:
    if _command_exists("cl") or _command_exists("link"):
        return True

    visual_studio_paths = (
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
        Path(r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"),
    )

    return any(path.exists() and any(path.iterdir()) for path in visual_studio_paths)


def check_environment() -> EnvironmentCheckResult:
    """Detect local prerequisites required for the desktop shell."""

    node_installed = _command_exists("node")
    rust_installed = _command_exists("rustc")
    cpp_installed = _cpp_toolchain_installed()

    missing_prerequisites: list[str] = []
    if not node_installed:
        missing_prerequisites.append("Node.js")
    if not rust_installed:
        missing_prerequisites.append("Rust")
    if not cpp_installed:
        missing_prerequisites.append("C++ Toolchain")

    environment = EnvironmentCheckResult(
        node_installed=node_installed,
        rust_installed=rust_installed,
        cpp_toolchain_installed=cpp_installed,
        missing_prerequisites=missing_prerequisites,
        all_ready=len(missing_prerequisites) == 0,
    )

    with _installer_lock:
        state = _read_installer_state()
        state["environment"] = environment
        _write_installer_state(state)

    return environment


def _run_install_command(command: list[str]) -> bool:
    completed_process = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed_process.returncode == 0


def prepare_prerequisites() -> dict[str, object]:
    """Attempt silent prerequisite installation where the platform allows it."""

    environment = check_environment()
    if environment["all_ready"]:
        return {
            "attempted": False,
            "installed": [],
            "remaining": [],
            "message": "All prerequisites are already installed.",
            "environment": environment,
        }

    if not _command_exists("winget"):
        return {
            "attempted": False,
            "installed": [],
            "remaining": environment["missing_prerequisites"],
            "message": "Automatic prerequisite installation requires winget on Windows.",
            "environment": environment,
        }

    installation_commands = {
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
        "C++ Toolchain": [
            "winget",
            "install",
            "Microsoft.VisualStudio.2022.BuildTools",
            "--accept-source-agreements",
            "--accept-package-agreements",
            "--disable-interactivity",
            "--override",
            "--quiet --norestart --installWhileDownloading --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621",
        ],
    }

    installed: list[str] = []
    for prerequisite in environment["missing_prerequisites"]:
        command = installation_commands.get(prerequisite)
        if command is None:
            continue
        if _run_install_command(command):
            installed.append(prerequisite)

    refreshed_environment = check_environment()
    return {
        "attempted": True,
        "installed": installed,
        "remaining": refreshed_environment["missing_prerequisites"],
        "message": "Prerequisite preparation finished.",
        "environment": refreshed_environment,
    }


def get_installer_status() -> InstallerStatus:
    """Return the persisted installer state."""

    with _installer_lock:
        state = _read_installer_state()
        return state


def install_openclaw() -> dict[str, str]:
    """Prepare a local OpenClaw workspace on disk."""

    OPENCLAW_INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = OPENCLAW_INSTALL_DIR / "openclaw.json"
    manifest_path.write_text(
        json.dumps(
            {
                "runtime": "openclaw",
                "source": "local-install-wizard",
                "installed": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    with _installer_lock:
        state = _read_installer_state()
        state["openclaw"] = {
            "installed": True,
            "install_path": str(OPENCLAW_INSTALL_DIR),
        }
        _write_installer_state(state)

    return {
        "install_path": str(OPENCLAW_INSTALL_DIR),
        "message": f"OpenClaw prepared locally at {OPENCLAW_INSTALL_DIR}.",
    }


def configure_ai(model_name: str) -> dict[str, str]:
    """Persist the selected default local model."""

    normalized_model_name = model_name.strip().lower()
    if normalized_model_name not in SUPPORTED_LOCAL_MODELS:
        raise ValueError(f"Unsupported local model: {normalized_model_name}")

    with _installer_lock:
        state = _read_installer_state()
        state["ai"] = {
            "provider": "local",
            "model": normalized_model_name,
        }
        _write_installer_state(state)

    return {
        "provider": "local",
        "model": normalized_model_name,
        "message": f"Configured local model {normalized_model_name}.",
    }


def start_and_connect() -> dict[str, object]:
    """Mark the local companion runtime as ready to start and connect."""

    with _installer_lock:
        state = _read_installer_state()

        if not bool(state["openclaw"]["installed"]):
            raise RuntimeError("OpenClaw must be installed before starting.")

        selected_model = str(state["ai"]["model"])
        if selected_model not in SUPPORTED_LOCAL_MODELS:
            raise RuntimeError("A supported local model must be configured before starting.")

        state["connection"] = {"connected": True}
        _write_installer_state(state)

    return {
        "connected": True,
        "message": "Companion runtime is ready. Start & Connect completed.",
    }

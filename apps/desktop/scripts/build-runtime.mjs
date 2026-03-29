import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const runtimeDir = path.join(repoRoot, "services", "agent-runtime");
const binariesDir = path.join(repoRoot, "apps", "desktop", "src-tauri", "binaries");
const pyinstallerWorkDir = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "pyinstaller-work",
);
const pyinstallerSpecDir = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "pyinstaller-spec",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: runtimeDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function resolvePoetryPython() {
  const result = spawnSync("poetry", ["env", "info", "--path"], {
    cwd: runtimeDir,
    encoding: "utf-8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    return null;
  }

  const envPath = result.stdout.trim();
  if (!envPath) {
    return null;
  }

  const poetryPython = path.join(envPath, "Scripts", "python.exe");
  return existsSync(poetryPython) ? poetryPython : null;
}

function resolveRuntimePython() {
  const inProjectPython = path.join(runtimeDir, ".venv", "Scripts", "python.exe");
  if (existsSync(inProjectPython)) {
    return inProjectPython;
  }

  return resolvePoetryPython();
}

if (process.platform !== "win32") {
  console.log("Skipping bundled runtime build outside Windows.");
  process.exit(0);
}

const runtimePython = resolveRuntimePython();

if (!runtimePython) {
  throw new Error(
    "Could not find a Python interpreter for the agent runtime. " +
      "Create the runtime Poetry environment with dev dependencies before building the desktop package.",
  );
}

mkdirSync(binariesDir, { recursive: true });
mkdirSync(pyinstallerWorkDir, { recursive: true });
mkdirSync(pyinstallerSpecDir, { recursive: true });
rmSync(path.join(binariesDir, "companion-runtime.exe"), { force: true });

run(runtimePython, [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name",
  "companion-runtime",
  "--distpath",
  binariesDir,
  "--workpath",
  pyinstallerWorkDir,
  "--specpath",
  pyinstallerSpecDir,
  "--paths",
  runtimeDir,
  path.join(runtimeDir, "run_runtime.py"),
], {
  shell: false,
});

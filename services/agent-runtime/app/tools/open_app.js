const { spawn } = require("node:child_process");

const SUPPORTED_APPS = {
  spotify: {
    windows: { command: "cmd", args: ["/c", "start", "", "spotify:"] },
    darwin: { command: "open", args: ["-a", "Spotify"] },
    linux: { command: "xdg-open", args: ["spotify:"] },
  },
  discord: {
    windows: { command: "cmd", args: ["/c", "start", "", "discord:"] },
    darwin: { command: "open", args: ["-a", "Discord"] },
    linux: { command: "xdg-open", args: ["discord:"] },
  },
};

function resolveTarget(appName) {
  const normalizedAppName = `${appName ?? ""}`.trim().toLowerCase();
  const target = SUPPORTED_APPS[normalizedAppName];

  if (!target) {
    throw new Error(`Unsupported app: ${appName}`);
  }

  const platformTarget = target[process.platform];
  if (!platformTarget) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return {
    normalizedAppName,
    ...platformTarget,
  };
}

function openApp(appName) {
  const target = resolveTarget(appName);

  return new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("spawn", () => {
      child.unref();
      resolve({
        ok: true,
        app: target.normalizedAppName,
        message: `Requested launch for ${target.normalizedAppName}.`,
      });
    });
  });
}

async function main() {
  const appName = process.argv[2];

  try {
    const result = await openApp(appName);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();

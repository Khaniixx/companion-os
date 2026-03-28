const { spawn } = require("node:child_process");

function resolveTarget(url) {
  const normalizedUrl = `${url ?? ""}`.trim();

  if (!normalizedUrl) {
    throw new Error("A URL is required.");
  }

  if (process.platform === "win32") {
    return {
      normalizedUrl,
      command: "cmd",
      args: ["/c", "start", "", normalizedUrl],
    };
  }

  if (process.platform === "darwin") {
    return {
      normalizedUrl,
      command: "open",
      args: [normalizedUrl],
    };
  }

  if (process.platform === "linux") {
    return {
      normalizedUrl,
      command: "xdg-open",
      args: [normalizedUrl],
    };
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function openUrl(url) {
  const target = resolveTarget(url);

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
        url: target.normalizedUrl,
        message: `Opened ${target.normalizedUrl} in the default browser.`,
      });
    });
  });
}

async function main() {
  const url = process.argv[2];

  try {
    const result = await openUrl(url);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();

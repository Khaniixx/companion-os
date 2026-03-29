import { afterEach, describe, expect, it, vi } from "vitest";

import { installerApi } from "./installerApi";

describe("installerApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries while the local runtime is still starting", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("runtime offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current_step: "download",
          completed: false,
          environment: {
            platform: "windows",
            checks: [],
            node_installed: false,
            rust_installed: false,
            cpp_toolchain_installed: false,
            runtime_dependencies_ready: false,
            missing_prerequisites: ["Node.js"],
            missing_runtime_dependencies: ["Ollama"],
            all_ready: false,
          },
          steps: {
            download: {
              id: "download",
              title: "Download",
              description: "",
              status: "pending",
              message: "Checking your system.",
              error: null,
              recovery_instructions: [],
              can_retry: false,
              can_repair: false,
              updated_at: "2026-03-30T00:00:00Z",
              attempt_count: 0,
            },
            "install-openclaw": {
              id: "install-openclaw",
              title: "Install OpenClaw",
              description: "",
              status: "pending",
              message: "Waiting.",
              error: null,
              recovery_instructions: [],
              can_retry: false,
              can_repair: false,
              updated_at: "2026-03-30T00:00:00Z",
              attempt_count: 0,
            },
            "configure-ai": {
              id: "configure-ai",
              title: "Configure AI",
              description: "",
              status: "pending",
              message: "Waiting.",
              error: null,
              recovery_instructions: [],
              can_retry: false,
              can_repair: false,
              updated_at: "2026-03-30T00:00:00Z",
              attempt_count: 0,
            },
            "start-connect": {
              id: "start-connect",
              title: "Start & Connect",
              description: "",
              status: "pending",
              message: "Waiting.",
              error: null,
              recovery_instructions: [],
              can_retry: false,
              can_repair: false,
              updated_at: "2026-03-30T00:00:00Z",
              attempt_count: 0,
            },
          },
          openclaw: {
            installed: false,
            install_path: "C:/openclaw",
            manifest_path: "C:/openclaw/openclaw.json",
          },
          ai: {
            provider: "local",
            model: "llama3.1:8b-instruct",
          },
          connection: {
            connected: false,
            message: "Not connected yet.",
          },
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = installerApi.getInstallerStatus();
    await vi.advanceTimersByTimeAsync(500);
    const response = await responsePromise;

    expect(response.current_step).toBe("download");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces backend errors immediately once the runtime responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        detail: "Runtime returned 500",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(installerApi.getInstallerStatus()).rejects.toThrow(
      "Runtime returned 500",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

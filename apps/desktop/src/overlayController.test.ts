import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentMonitorMock = vi.fn();
const invokeMock = vi.fn();
const currentWindowMock = {
  setAlwaysOnTop: vi.fn(),
  setDecorations: vi.fn(),
  setShadow: vi.fn(),
  setIgnoreCursorEvents: vi.fn(),
  setResizable: vi.fn(),
  setSize: vi.fn(),
  setPosition: vi.fn(),
  center: vi.fn(),
  outerSize: vi.fn(),
  outerPosition: vi.fn(),
};

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: currentMonitorMock,
  getCurrentWindow: () => currentWindowMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

class MockPhysicalSize {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

class MockPhysicalPosition {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: MockPhysicalPosition,
  PhysicalSize: MockPhysicalSize,
}));

describe("applyOverlayWindowState", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    currentMonitorMock.mockResolvedValue({
      name: "Primary",
      size: { width: 1920, height: 1080 },
      position: { x: 0, y: 0 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
      },
      scaleFactor: 1,
    });
    currentWindowMock.outerSize.mockResolvedValue({ width: 1240, height: 820 });
    currentWindowMock.outerPosition.mockResolvedValue({ x: 160, y: 120 });
    invokeMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pins the window to the desktop right edge", async () => {
    const { applyOverlayWindowState } = await import("./overlayController");

    await applyOverlayWindowState({
      enabled: true,
      clickThroughEnabled: false,
      anchor: "desktop-right",
    });

    expect(currentWindowMock.setResizable).toHaveBeenCalledWith(false);
    expect(currentWindowMock.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 440, height: 760 }),
    );
    expect(currentWindowMock.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 1456, y: 296 }),
    );
    expect(currentWindowMock.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(currentWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(false);
  });

  it("pins the window to the desktop left edge and keeps click-through", async () => {
    const { applyOverlayWindowState } = await import("./overlayController");

    await applyOverlayWindowState({
      enabled: true,
      clickThroughEnabled: true,
      anchor: "desktop-left",
    });

    expect(currentWindowMock.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 24, y: 296 }),
    );
    expect(currentWindowMock.setIgnoreCursorEvents).toHaveBeenCalledWith(true);
  });

  it("restores the previous workspace placement when desktop presence is turned off", async () => {
    const { applyOverlayWindowState } = await import("./overlayController");

    await applyOverlayWindowState({
      enabled: true,
      clickThroughEnabled: false,
      anchor: "desktop-right",
    });
    await applyOverlayWindowState({
      enabled: false,
      clickThroughEnabled: false,
    });

    expect(currentWindowMock.setResizable).toHaveBeenCalledWith(true);
    expect(currentWindowMock.setSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1240, height: 820 }),
    );
    expect(currentWindowMock.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 160, y: 120 }),
    );
    expect(currentWindowMock.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it("pins beside the active window when an active-app anchor is selected", async () => {
    const { applyOverlayWindowState } = await import("./overlayController");
    invokeMock.mockResolvedValue({
      x: 600,
      y: 120,
      width: 900,
      height: 820,
      title: "Editor",
    });

    await applyOverlayWindowState({
      enabled: true,
      clickThroughEnabled: false,
      anchor: "active-window-right",
    });

    expect(invokeMock).toHaveBeenCalledWith("active_window_bounds");
    expect(currentWindowMock.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 1456, y: 150 }),
    );
  });

  it("keeps stream overlays from triggering desktop affinity placement", async () => {
    const { applyOverlayWindowState } = await import("./overlayController");

    await applyOverlayWindowState({
      enabled: true,
      clickThroughEnabled: false,
    });

    expect(currentWindowMock.setPosition).not.toHaveBeenCalled();
    expect(currentWindowMock.setSize).not.toHaveBeenCalled();
    expect(currentWindowMock.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});

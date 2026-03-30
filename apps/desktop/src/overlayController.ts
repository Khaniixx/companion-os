export type CompanionWindowPresence = {
  enabled: boolean;
  clickThroughEnabled: boolean;
  anchor?:
    | "desktop-right"
    | "desktop-left"
    | "active-window-right"
    | "active-window-left"
    | "workspace";
};

const DEFAULT_WORKSPACE_WIDTH = 1240;
const DEFAULT_WORKSPACE_HEIGHT = 820;
const PINNED_WIDTH = 440;
const PINNED_HEIGHT = 760;
const PINNED_MARGIN = 24;

type SavedWindowPlacement = {
  width: number;
  height: number;
  x: number;
  y: number;
};

let savedWorkspacePlacement: SavedWindowPlacement | null = null;
let affinityWasApplied = false;

type ActiveWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
};

async function loadActiveWindowBounds(): Promise<ActiveWindowBounds | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ActiveWindowBounds | null>("active_window_bounds");
  } catch {
    return null;
  }
}

export async function applyOverlayWindowState(
  settings: CompanionWindowPresence,
): Promise<void> {
  try {
    const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
    const { currentMonitor, getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    const shouldApplyAffinity =
      settings.enabled &&
      settings.anchor !== undefined &&
      settings.anchor !== "workspace";

    if (shouldApplyAffinity) {
      if (savedWorkspacePlacement === null) {
        const [outerSize, outerPosition] = await Promise.all([
          currentWindow.outerSize(),
          currentWindow.outerPosition(),
        ]);
        savedWorkspacePlacement = {
          width: outerSize.width,
          height: outerSize.height,
          x: outerPosition.x,
          y: outerPosition.y,
        };
      }

      const monitor = await currentMonitor();
      if (monitor !== null) {
        const workArea = monitor.workArea;
        const width = Math.min(PINNED_WIDTH, Math.max(360, workArea.size.width - PINNED_MARGIN * 2));
        const height = Math.min(
          PINNED_HEIGHT,
          Math.max(420, workArea.size.height - PINNED_MARGIN * 2),
        );
        const activeWindowBounds =
          settings.anchor === "active-window-left" ||
          settings.anchor === "active-window-right"
            ? await loadActiveWindowBounds()
            : null;
        const resolvedAnchor =
          settings.anchor === "active-window-left"
            ? "desktop-left"
            : settings.anchor === "active-window-right"
              ? "desktop-right"
              : settings.anchor;
        const targetX =
          activeWindowBounds !== null
            ? resolvedAnchor === "desktop-left"
              ? activeWindowBounds.x - width - PINNED_MARGIN
              : activeWindowBounds.x + activeWindowBounds.width + PINNED_MARGIN
            : null;
        const targetY =
          activeWindowBounds !== null
            ? activeWindowBounds.y +
              Math.max(0, Math.round((activeWindowBounds.height - height) / 2))
            : null;
        const minX = workArea.position.x + PINNED_MARGIN;
        const maxX = workArea.position.x + workArea.size.width - width - PINNED_MARGIN;
        const minY = workArea.position.y + PINNED_MARGIN;
        const maxY = workArea.position.y + workArea.size.height - height - PINNED_MARGIN;
        const x =
          targetX !== null
            ? Math.max(minX, Math.min(maxX, targetX))
            : resolvedAnchor === "desktop-left"
              ? minX
              : maxX;
        const y =
          targetY !== null
            ? Math.max(minY, Math.min(maxY, targetY))
            : workArea.position.y + Math.max(PINNED_MARGIN, workArea.size.height - height - PINNED_MARGIN);

        await currentWindow.setResizable(false);
        await currentWindow.setSize(new PhysicalSize(width, height));
        await currentWindow.setPosition(new PhysicalPosition(x, y));
        affinityWasApplied = true;
      }
    } else if (affinityWasApplied) {
      await currentWindow.setResizable(true);
      if (savedWorkspacePlacement !== null) {
        await currentWindow.setSize(
          new PhysicalSize(
            savedWorkspacePlacement.width,
            savedWorkspacePlacement.height,
          ),
        );
        await currentWindow.setPosition(
          new PhysicalPosition(savedWorkspacePlacement.x, savedWorkspacePlacement.y),
        );
      } else {
        await currentWindow.setSize(
          new PhysicalSize(DEFAULT_WORKSPACE_WIDTH, DEFAULT_WORKSPACE_HEIGHT),
        );
        await currentWindow.center();
      }
      savedWorkspacePlacement = null;
      affinityWasApplied = false;
    }

    await currentWindow.setAlwaysOnTop(settings.enabled);
    await currentWindow.setDecorations(!settings.enabled);
    await currentWindow.setShadow(!settings.enabled);
    await currentWindow.setIgnoreCursorEvents(
      settings.enabled && settings.clickThroughEnabled,
    );
  } catch {
    // Browser tests and non-Tauri runs should stay functional without native window control.
  }
}

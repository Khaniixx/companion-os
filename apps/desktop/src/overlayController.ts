import type { StreamSettings } from "./streamApi";

export async function applyOverlayWindowState(
  settings: Pick<StreamSettings, "overlay_enabled" | "click_through_enabled">,
): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();

    await currentWindow.setAlwaysOnTop(settings.overlay_enabled);
    await currentWindow.setDecorations(!settings.overlay_enabled);
    await currentWindow.setShadow(!settings.overlay_enabled);
    await currentWindow.setIgnoreCursorEvents(
      settings.overlay_enabled && settings.click_through_enabled,
    );
  } catch {
    // Browser tests and non-Tauri runs should stay functional without native window control.
  }
}

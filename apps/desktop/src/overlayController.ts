export type CompanionWindowPresence = {
  enabled: boolean;
  clickThroughEnabled: boolean;
};

export async function applyOverlayWindowState(
  settings: CompanionWindowPresence,
): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();

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

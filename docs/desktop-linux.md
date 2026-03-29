# Desktop Linux Notes

Companion OS desktop packaging is being validated for Linux, with Ubuntu 24.04
as the preferred first release target.

## Current Status

- Linux frontend build is working with `npm ci` and `npm run build` in
  `apps/desktop`.
- Tauri desktop bundling is partially validated:
  - native release binary builds successfully
  - `.deb` bundling succeeds
  - `.rpm` bundling succeeds
  - AppImage bundling is not yet reliable on all Linux environments
- The current Rust dependency graph still includes `glib 0.18.x` through the
  Tauri/Wry GTK/WebKit stack. Treat the known RustSec advisory as unresolved
  until the dependency chain moves to `glib >= 0.20` upstream.

## Ubuntu 24.04 Build Dependencies

Install the Linux desktop prerequisites before running `npm run tauri build`:

- `build-essential`
- `curl`
- `file`
- `libayatana-appindicator3-dev`
- `libgtk-3-dev`
- `libwebkit2gtk-4.1-dev`
- `libxdo-dev`
- `librsvg2-dev`
- `patchelf`

## Arch-Based Equivalents

On Arch-derived systems, the closest package names are typically:

- `base-devel`
- `curl`
- `file`
- `gtk3`
- `webkit2gtk-4.1`
- `librsvg`
- `libayatana-appindicator-gtk3`
- `xdotool`
- `patchelf`

Rust is also required. A user-local `rustup` install is sufficient for local
validation work.

## Known Linux Packaging Caveat

On an Arch-derived rolling system, Tauri's AppImage bundling can fail inside
`linuxdeploy` because the bundled `strip` binary does not understand newer ELF
`.relr.dyn` sections from current system libraries. When this happens:

- do not mark Linux release-ready based on that machine
- do not patch around it by disabling audits or manually altering lockfiles
- treat it as a machine-level packaging-tool mismatch unless the same failure is
  reproduced on Ubuntu 24.04

## Runtime Validation Limits

Transparent overlay behavior depends on the active compositor and window
manager. Validate all of the following on the actual target desktop session:

- window launch
- transparency
- always-on-top behavior
- click-through behavior

Wayland compositors may differ from X11 in how reliably they honor overlay and
input-pass-through behavior.

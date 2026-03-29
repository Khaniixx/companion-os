# Changelog

## Unreleased

### Security

- Added desktop dependency audit coverage in CI with `npm audit` and a locked `cargo audit` check for the Tauri shell.
- Documented the current upstream `glib` advisory blocker (`RUSTSEC-2024-0429`) and the exact Tauri/Wry dependency chain that still resolves `glib 0.18.5`.
- Added a dedicated Rust audit policy file at [apps/desktop/src-tauri/audit.toml](./apps/desktop/src-tauri/audit.toml) so the tracked upstream blocker is explicit instead of hidden.

### Packaging

- Added a Windows packaging workflow to build the current desktop release target with Tauri bundle artifacts.
- Updated the documentation to state explicitly that the current MVP release scope is Windows-first while macOS and Linux remain experimental targets rather than supported release platforms.
- Expanded installation and troubleshooting guidance in [README.md](./README.md) with supported platform baselines, hardware guidance, and common packaging failures.

# Changelog

All notable changes to `dsh-cua-driver` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-11-10

### Added

- Initial release.
- DSH profile plugin that bridges **cua-driver 0.46.1** (trycua/cua, Windows x86_64 kit)
  into DSH as `cua_*` MCP tools (~63 tools: UIA observation, background PostMessage input,
  CDP browser tools, batching/scripting, agent-cursor overlay, recording, diagnostics).
- Self-contained: the driver binaries are vendored in `vendor/` — nothing to install on the
  machine besides the plugin itself.
- Lazy exposure: only `cua_activate` is registered at startup; the full tool surface unlocks on
  call (set `eager: true` to register everything at startup).
- Bundled `/cua-driver` skill (Chinese description and usage manual), registered with the host's
  skill registry in code.
- CDP pre-authorization: the driver is spawned with `--grant existing-profile`, so attaching to
  the user's running Edge/Chrome profile needs no consent flow.
- Documentation in English and Chinese (`README.md`, `README.zh.md`).

### Notes

- This plugin's own code is MIT (`LICENSE`). The vendored driver binaries are MIT,
  Copyright (c) 2025 Cua AI, Inc. — keep `vendor/.../LICENSE` and
  `vendor/.../THIRD_PARTY_NOTICES.md` when redistributing.
- Upgrading the driver: replace `vendor/cua-driver-rs-*` with a newer release kit from
  trycua/cua and bump the version; the tool surface is read dynamically, no code change needed.

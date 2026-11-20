# Changelog

All notable changes to `dsh-cua-driver` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/).

## [0.1.2] - 2026-11-21

### Changed

- Vendored driver updated **cua-driver 0.46.1 → 0.55.0** (trycua/cua, `vendor/cua-driver-rs-0.55.0-windows-x86_64/`), spanning 52 upstream releases:
  - tool surface 63 → 62: deprecated `escalate_session` / `get_session_state` removed upstream; new `cua_browser_motion_policy` tool
  - Windows fixes relevant to this plugin: right-click modifiers preserved, agent-cursor hook updates emitted, clicks on windows that close/hide an unowned target no longer misreported, embedded SDK keeps physical pixels (HiDPI), `background_unavailable` refusals recorded as refused
  - browser: policy-forced extensions kept in isolated launches; Chromium screen extents rebased only from a frame matching the target window; refused `browser ref` clicks whose point misses the ref
- `index.js`: known vendor path now points at the 0.55.0 kit (version-folder fallback still applies); `CLIENT_VERSION` bumped to 0.1.2; stale `get_session_state` dropped from the read-only set
- `engines.node` raised `>=22` → `>=24.9` to match DSH's Node requirement (Node 22 support dropped in DSH v0.2.1-rc.2; packaged Desktop bundles its own runtime, so this only affects npm-install-from-source layouts)
- README / patch comments: driver version and tool-count references updated

## [0.1.1] - 2026-11-11

### Added

- New skill file `exam-chaoxing.md` (scene-specific playthrough) plus a dedicated "场景子文件" section in `SKILL.md`: the skill is structured as one main skill with per-scene subfiles, catalogued in a table so the right file is read before working on a matching task.
    - when the CDP route is refused (e.g. vertical-tab browser) and the exam page must be driven over the UIA fallback, how to locate windows, read questions, click options and advance through a 学习通 (chaoxing / mooc) online exam session.
    - "preview the whole paper first, then backfill answers" workflow — more robust than question-by-question reads, with `cua_run_steps` `expect` assertions per jump.
    - Known UIA pitfalls: watermark-line flooding of the text tree, option labels that splice the letter prefix into the label, `javascript:;` values on 下一题/上一题 hyperlinks, multi-blank question types.
    - Submission default: stop on the page, do not auto-submit; the user decides.

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

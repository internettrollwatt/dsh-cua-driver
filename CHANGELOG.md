# Changelog

All notable changes to `dsh-cua-driver` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/).

## [0.1.1] - 2026-11-11

### Added

- New skill file `exam-chaoxing.md` (scene-specific playthrough) plus a dedicated "Âú∫ÊôØÂ≠êÊñá‰ª?
  section in `SKILL.md`: the skill is structured as one main skill with per-scene subfiles,
  catalogued in a table so the right file is read before working on a matching task.
    - when the CDP route is refused (e.g. vertical-tab browser) and the exam page must be driven over the UIA
      fallback, how to locate windows, read questions, click options and advance through a Â≠¶‰π†ÈÄ?(chaoxing /
      mooc) online exam session.
    - "preview the whole paper first, then backfill answers" workflow ‚Ä?more robust than question-by-question
    reads, with `cua_run_steps` `expect` assertions per jump.
    - Known UIA pitfalls: watermark-line flooding of the text tree, option labels that splice the letter prefix
    into the label, `javascript:;` values on ‰∏ã‰∏ÄÈ¢?‰∏ä‰∏ÄÈ¢?hyperlinks, multi-blank question types.
    - Submission default: stop on the page, do not auto-submit; the user decides.

## [0.1.0] - 2026-11-10

### Added

- Initial release.
- DSH profile plugin that bridges **cua-driver 0.46.1** (trycua/cua, Windows x86_64 kit)
  into DSH as `cua_*` MCP tools (~63 tools: UIA observation, background PostMessage input,
  CDP browser tools, batching/scripting, agent-cursor overlay, recording, diagnostics).
- Self-contained: the driver binaries are vendored in `vendor/` ‚Ä?nothing to install on the
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
  Copyright (c) 2025 Cua AI, Inc. ‚Ä?keep `vendor/.../LICENSE` and
  `vendor/.../THIRD_PARTY_NOTICES.md` when redistributing.
- Upgrading the driver: replace `vendor/cua-driver-rs-*` with a newer release kit from
  trycua/cua and bump the version; the tool surface is read dynamically, no code change needed.

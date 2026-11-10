# dsh-cua-driver

[English](./README.md) · [中文](./README.zh.md)

A self-contained **DeepSeek Harness (DSH) profile plugin** that adds **background Windows desktop and browser control** to DSH, powered by the [cua-driver](https://github.com/trycua/cua) MCP server (trycua/cua, v0.46.1, MIT).

Everything the plugin needs ships inside this repository — the driver binaries are vendored in `vendor/`, so there is **nothing to install on the machine** besides the plugin itself.

## What it does

- **Spawns the vendored driver**: `vendor/.../cua-driver.exe mcp --direct --grant existing-profile`, spoken over MCP (newline-delimited JSON-RPC 2.0). No external installation, no daemon, no extra processes beyond the one the plugin manages.
- **Exposes the driver's ~63 tools as DSH tools** with a `cua_` prefix:
  - observation: `cua_list_windows`, `cua_get_window_state` (UIA tree + screenshot), `cua_get_desktop_state`, `cua_zoom`, `cua_get_accessibility_tree`
  - background input: `cua_click`, `cua_double_click`, `cua_right_click`, `cua_drag`, `cua_type_text`, `cua_press_key`, `cua_hotkey`, `cua_set_value`, `cua_scroll`, `cua_clipboard_read/write`, `cua_invoke_menu` — delivered via UIA/`PostMessage`, **without stealing focus or moving your pointer**
  - CDP browser tools: `cua_browser_prepare`, `cua_get_browser_state`, `cua_browser_click/type/select/navigate/pointer/dialog/set_input_files/download`
  - batching & scripting: `cua_run_steps`, `cua_run_script`, `cua_start_session`/`cua_end_session`
  - verification & diagnostics: `cua_verify_state`, `cua_check_permissions`, `cua_health_report`, `cua_get_guide`
  - agent-cursor overlay: `cua_move_cursor`, `cua_set_agent_cursor_motion/theme`, `cua_get_agent_cursor_state`
  - recording: `cua_start_recording` / `cua_stop_recording` / `cua_replay_trajectory`
- **Lazy exposure**: at startup only `cua_activate` is registered. Calling it registers the full tool surface for the profile and returns a short usage manual (keeps prompt size small). Set `eager: true` to register everything at startup.
- **Bundled `/cua-driver` skill**: a short Chinese usage manual registered with the host's skill registry. Load it with the `/cua-driver` slash command.
- **CDP pre-authorization**: the bundle patch starts the driver with `--grant existing-profile`, so attaching to your already-running Edge/Chrome profile does not need a consent flow.

## Repository layout

```
dsh-cua-driver/
├── index.js                  # host-side plugin: MCP stdio client + tool/skill registration
├── cordis.patch.yml          # bundle patch (inserts the `cua-driver` row into a DSH profile)
├── package.json
├── LICENSE                   # MIT (this plugin's own code)
├── README.md / README.zh.md  # English / Chinese documentation
├── skills/
│   └── cua-driver/SKILL.md   # the `/cua-driver` skill (Chinese usage manual)
└── vendor/
    └── cua-driver-rs-0.46.1-windows-x86_64/
        ├── cua-driver.exe             # MCP stdio server (`mcp --direct`)
        ├── cua-driver-uia.exe
        ├── cua-cursor-theme.exe
        ├── cua_driver_sdk.dll
        ├── cua_driver_node_runtime.node
        ├── cua_driver_abi.h
        ├── LICENSE                    # MIT — Cua AI, Inc. (upstream)
        └── THIRD_PARTY_NOTICES.md    # MIT third-party components embedded in the driver
```

## Requirements

- DSH Desktop on **Windows x86_64** (the vendored driver kit is the Windows build; the plugin's host code is platform-neutral JS).
- Nothing else — the driver, its SDK DLL and its embedded Node runtime are all in `vendor/`.

## Install

1. Get the code anywhere stable:
   ```powershell
   git clone https://github.com/internettrollwatt/dsh-cua-driver C:\tools\dsh-cua-driver
   ```
2. In your DSH profile (default: `C:\Users\<you>\.dsh\profiles\desktop\package.json`) add the
   dependency and the bundle:
   ```json
   "dependencies": { "dsh-cua-driver": "file:C:/tools/dsh-cua-driver" },
   "dsh": { "profile": { "bundles": [ "…existing…", "dsh-cua-driver" ] } }
   ```
   A `git+https://github.com/internettrollwatt/dsh-cua-driver.git` dependency works too.
   Then install the profile's dependencies (`pnpm install` in the profile directory, or let DSH do it).
3. **Restart DSH Desktop** (bundles load at startup).
4. In a new session: load the skill with `/cua-driver`, then call `cua_activate` (or call
   `cua_activate` directly; it returns the tool list and a short manual).

## Configuration (bundle row, `cordis.patch.yml`)

| key | default | meaning |
|-----|---------|---------|
| `exe` | auto: first `vendor/cua-driver-rs-*/cua-driver.exe` | explicit path to `cua-driver.exe` |
| `toolPrefix` | `cua_` | tool-name prefix |
| `toolTimeoutMs` | `120000` | per-call MCP timeout |
| `eager` | `false` | register all tools at startup instead of lazy activation |
| `mcpArgs` | `['--grant','existing-profile']` (set in the bundle patch) | extra args after `mcp --direct`; the grant pre-authorizes CDP attachment to the user's running Chromium profile |

## Usage in one paragraph

Find the target with `cua_list_windows` → read it with `cua_get_window_state` (UIA tree +
screenshot; `query` narrows the tree, `element_token` = `<snapshot_id>:N` references an element,
and every new snapshot invalidates old tokens) → act (`cua_click` / `cua_type_text` /
`cua_set_value` / …, all defaulting to background delivery) → verify with `cua_verify_state` or a
fresh read. If a tool reports `background_unavailable` for the target toolkit, retry the same call
with `delivery_mode:"foreground"` (brief focus swap, auto-restored). For web page content use the
CDP route: `cua_browser_prepare` → `cua_get_browser_state` (bind + `semantic_v2` snapshot) →
`cua_browser_*` mutations; browser objects are session-scoped, so reuse one short `session` label
across the workflow. If a browser call is refused, the refusal carries a `next_call` with the exact
retry arguments; if the CDP route stays unavailable, fall back to the UIA route for web content.

## Notes

- **Agent-cursor overlay**: `cua_*` actions are visualized by a *fake* cursor overlay — the real
  pointer never moves. AX actions pulse, pixel actions glide, and the cursor hides after 15 s of
  inactivity. Tunable at runtime via `cua_set_agent_cursor_motion` / `cua_set_agent_cursor_theme` /
  `cua_set_config` (no restart needed).
- **Per-user driver store**: the driver keeps `%USERPROFILE%\.cua-driver\` (config.json,
  `.telemetry_id` — a stable anonymous id, and `version_check.json` — update checks), shared across
  all cua-driver versions on the machine. Inspect/tune via `cua_get_config` / `cua_set_config`.
- **Destructive tools** (`cua_browser_download`, …) require host-side destructive approval; on
  DSH sessions with approval prompts disabled they will be refused — this is by design.
- **Driver upgrade**: replace `vendor/cua-driver-rs-*` with a newer release kit from
  [trycua/cua releases](https://github.com/trycua/cua/releases) (keep its `LICENSE` and
  `THIRD_PARTY_NOTICES.md`) and restart DSH. The tool surface is read dynamically from
  `tools/list`, so no code change is needed.

## Licensing

- This plugin's own code (JS, patch, skill, docs): **MIT** — see `LICENSE`.
- The vendored `cua-driver` binaries: **MIT, Copyright (c) 2025 Cua AI, Inc.** — see
  `vendor/.../LICENSE`. Embedded third-party components are all MIT as well; see
  `vendor/.../THIRD_PARTY_NOTICES.md` (trope-cua, Interface-Agent, yabai, QuickJS-ng,
  rquickjs, T3 Code). Keep those files when redistributing.
- This plugin only uses DSH's public plugin seams (`ctx.tools`, `ctx.inject`, `defineTool`); it
  ships no DSH host code.

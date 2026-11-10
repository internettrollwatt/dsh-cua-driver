# dsh-cua-driver

[English](./README.md) · [中文](./README.zh.md)

一个自包含的 **DeepSeek Harness（DSH）profile 插件**，为 DSH 增加 **Windows 桌面与浏览器的后台控制**能力，由 [cua-driver](https://github.com/trycua/cua) MCP 服务器驱动（trycua/cua，v0.46.1，MIT）。

插件运行所需的一切都随仓库提供——驱动二进制放在 `vendor/` 里，**除了插件本身，机器上不需要装任何东西**。

## 它做什么

- **拉起 vendor 内的驱动**：`vendor/.../cua-driver.exe mcp --direct --grant existing-profile`，走 MCP 协议（换行分隔的 JSON-RPC 2.0）。不依赖外部安装、不依赖常驻守护进程，插件只管这一个进程。
- **把驱动的约 63 个工具以 `cua_` 前缀暴露为 DSH 工具**：
  - 观察：`cua_list_windows`、`cua_get_window_state`（UIA 树 + 截图）、`cua_get_desktop_state`、`cua_zoom`、`cua_get_accessibility_tree`
  - 后台输入：`cua_click`、`cua_double_click`、`cua_right_click`、`cua_drag`、`cua_type_text`、`cua_press_key`、`cua_hotkey`、`cua_set_value`、`cua_scroll`、`cua_clipboard_read/write`、`cua_invoke_menu`——走 UIA/`PostMessage`，**不抢焦点、不移动用户指针**
  - CDP 浏览器工具：`cua_browser_prepare`、`cua_get_browser_state`、`cua_browser_click/type/select/navigate/pointer/dialog/set_input_files/download`
  - 批处理与脚本：`cua_run_steps`、`cua_run_script`、`cua_start_session` / `cua_end_session`
  - 验证与诊断：`cua_verify_state`、`cua_check_permissions`、`cua_health_report`、`cua_get_guide`
  - 代理光标叠加层：`cua_move_cursor`、`cua_set_agent_cursor_motion/theme`、`cua_get_agent_cursor_state`
  - 录制：`cua_start_recording` / `cua_stop_recording` / `cua_replay_trajectory`
- **懒暴露**：启动时只注册 `cua_activate` 一个入口；调用它才会为 profile 注册完整工具面并返回简短手册（省 prompt 开销）。`eager: true` 可改为启动即全量注册。
- **内置 `/cua-driver` skill**：一份简短的中文使用说明，通过代码注册进宿主 skill 注册表。斜杠指令 `/cua-driver` 加载。
- **CDP 预授权**：bundle patch 让驱动带 `--grant existing-profile` 启动，附着到你正在运行的 Edge/Chrome 配置无需再走同意流程。

## 目录结构

```
dsh-cua-driver/
├── index.js                  # 宿主侧插件：MCP stdio 客户端 + 工具/skill 注册
├── cordis.patch.yml          # bundle patch（把 `cua-driver` 行插入 DSH profile）
├── package.json
├── LICENSE                   # MIT（本插件自身代码）
├── README.md / README.zh.md  # 英文 / 中文文档
├── skills/
│   └── cua-driver/SKILL.md   # `/cua-driver` skill（中文使用说明）
└── vendor/
    └── cua-driver-rs-0.46.1-windows-x86_64/
        ├── cua-driver.exe             # MCP stdio 服务器（`mcp --direct`）
        ├── cua-driver-uia.exe
        ├── cua-cursor-theme.exe
        ├── cua_driver_sdk.dll
        ├── cua_driver_node_runtime.node
        ├── cua_driver_abi.h
        ├── LICENSE                    # MIT — Cua AI, Inc.（上游）
        └── THIRD_PARTY_NOTICES.md    # 驱动内嵌的 MIT 三方组件清单
```

## 运行要求

- DSH Desktop，**Windows x86_64**（vendor 里是 Windows 版驱动套件；插件宿主侧代码是平台无关的 JS）。
- 无需其他任何东西——驱动、SDK DLL、内嵌 Node 运行时都在 `vendor/` 里。

## 安装

**方式 A —— 从 npm（最简单）**：把已发布的包加进你的 DSH profile（默认
`C:\Users\<you>\.dsh\profiles\desktop\package.json`），加上 bundle，然后重启 DSH：

```json
"dependencies": { "dsh-cua-driver": "^0.1.0" },
"dsh": { "profile": { "bundles": [ "…现有的…", "dsh-cua-driver" ] } }
```

然后安装 profile 依赖（在 profile 目录跑 `pnpm install`，或交给 DSH），重启 DSH Desktop。
新会话里：用 `/cua-driver` 加载 skill，然后调用 `cua_activate`（返回工具列表和简短手册）。

**方式 B —— 从 git（尝鲜）**：

1. 把代码放到任意稳定路径：
   ```powershell
   git clone https://github.com/internettrollwatt/dsh-cua-driver C:\tools\dsh-cua-driver
   ```
2. 同样的 profile 编辑，依赖指向本地/git：
   ```json
   "dependencies": { "dsh-cua-driver": "file:C:/tools/dsh-cua-driver" }
   ```
   也可以直接用 `git+https://github.com/internettrollwatt/dsh-cua-driver.git` 依赖。
   然后安装 profile 依赖（在 profile 目录跑 `pnpm install`，或交给 DSH）。
3. **重启 DSH Desktop**（bundle 在启动时加载）。
4. 新会话里：用 `/cua-driver` 加载 skill，然后调用 `cua_activate`（或直接调 `cua_activate`，它会返回工具列表和简短手册）。

## 配置（bundle 行，`cordis.patch.yml`）

| 键 | 默认 | 含义 |
|----|------|------|
| `exe` | 自动：第一个 `vendor/cua-driver-rs-*/cua-driver.exe` | 显式指定 `cua-driver.exe` 路径 |
| `toolPrefix` | `cua_` | 工具名前缀 |
| `toolTimeoutMs` | `120000` | 单次 MCP 调用超时 |
| `eager` | `false` | 启动即全量注册，而非懒激活 |
| `mcpArgs` | `['--grant','existing-profile']`（bundle patch 中设置） | `mcp --direct` 之后的追加参数；grant 预授权 CDP 附着到用户正在运行的 Chromium 配置 |

## 一段话用法

`cua_list_windows` 定位目标 → `cua_get_window_state` 读状态（UIA 树 + 截图；`query` 子串裁剪树，`element_token` = `<snapshot_id>:N` 引用元素，每次新快照会使旧 token 全部失效）→ 动作（`cua_click` / `cua_type_text` / `cua_set_value` / …，默认全部后台投递）→ `cua_verify_state` 或新读验证。某工具对目标工具栈报 `background_unavailable` 时，把同一个调用改 `delivery_mode:"foreground"` 重试（短暂前置、自动恢复原前台）。网页内容走 CDP 路由：`cua_browser_prepare` → `cua_get_browser_state`（bind + `semantic_v2` 快照）→ `cua_browser_*` 变更；浏览器对象是会话域的，整个流程复用同一个短 `session` 标签。浏览器调用被拒时，拒绝结果里带 `next_call` 精确重试参数；CDP 路由持续不可用时，网页内容回退 UIA 路由。

## 说明

- **代理光标叠加层**：`cua_*` 动作的可视化是一个*假光标*叠加层——真实指针绝不动。AX 动作脉冲、像素动作弧线滑行，闲置 15 秒自动隐藏。`cua_set_agent_cursor_motion` / `cua_set_agent_cursor_theme` / `cua_set_config` 可运行时调整，无需重启。
- **per-user 驱动存储**：驱动在 `%USERPROFILE%\.cua-driver\` 保存配置（config.json、`.telemetry_id` 稳定匿名 ID、`version_check.json` 版本检查），同机所有 cua-driver 版本共享。`cua_get_config` / `cua_set_config` 可查可改。
- **破坏性工具**（`cua_browser_download` 等）需要宿主侧 destructive 批准；在关闭了批准提示的 DSH 会话里会被拒绝——这是设计行为。
- **升级驱动**：用 [trycua/cua releases](https://github.com/trycua/cua/releases) 的新版 kit 替换 `vendor/cua-driver-rs-*`（保留其中的 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`），重启 DSH。工具面是从 `tools/list` 动态读的，无需改代码。

## 授权

- 本插件自身代码（JS、patch、skill、文档）：**MIT**——见 `LICENSE`。
- vendor 内的 `cua-driver` 二进制：**MIT，Copyright (c) 2025 Cua AI, Inc.**——见 `vendor/.../LICENSE`。内嵌的三方组件也全是 MIT，见 `vendor/.../THIRD_PARTY_NOTICES.md`（trope-cua、Interface-Agent、yabai、QuickJS-ng、rquickjs、T3 Code）。再分发时请保留这些文件。
- 本插件只使用 DSH 的公开插件接缝（`ctx.tools`、`ctx.inject`、`defineTool`），不包含任何 DSH 宿主代码。

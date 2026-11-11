---
name: cua-driver
description: 使用 cua-driver（cua_* 工具族）在后台控制 Windows GUI 与浏览器：UIA 读树/截图、PostMessage/UIA 后台输入（不抢焦点、不移动用户键鼠）、CDP 浏览器控制、代理光标叠加层。用于"要操作应用但不想打扰用户"的任务；同一目标不要与 computer_*（前台通道）混用。
---

# cua-driver 后台桌面控制

## 开局

1. 先调用 `cua_activate`。本插件是懒暴露设计：会话里只注册了这一个入口，调用后才会解锁全部 `cua_*` 工具（数量随驱动版本的 `tools/list` 动态变化，以实际返回为准）。无需回执（receipt），调用成功即可开干。
2. 找不到 `cua_activate` = 插件没加载：检查 profile 是否包含本 bundle 且 DSH 已重启。
3. `cua_activate` 的返回里带一份简短 manual；本 skill 是它的扩展版（浏览器路由、光标行为、限制边界），两者取信于驱动的实际返回。

## 标准循环（桌面 GUI）

`cua_list_windows`（定位 pid + window_id）→ `cua_get_window_state`（UIA 树 + 截图；用 `query` 子串投影，`element_token` = `<snapshot_id>:N` 引用元素）→ 动作（`cua_click` / `cua_type_text` / `cua_set_value` / `cua_press_key` / `cua_hotkey` / `cua_scroll` / `cua_drag`）→ 验证（`cua_verify_state` 或新读）。

- 每次新快照会使旧的 element_token 全部失效；UI 变了就重读，别拿旧 token 打。
- `since:"latest"` 可只做增量读；`include_accessibility_tree:false` 只取截图。
- 固定序列用 `cua_run_steps`（支持 `wait_for`/`expect`，末尾一次 observe）；需要分支/循环用 `cua_run_script`。

## 后台输入规则（核心差异）

- 所有输入动作默认 `delivery_mode:"background"`：走 PostMessage/UIA，窗口永不置顶、光标不动。
- 若工具返回 `background_unavailable`（Chromium/Electron 渲染内容、GTK、VCL 加速键等会丢 PostMessage 的栈），**把同一个调用原样改成 `delivery_mode:"foreground"` 重试**（短暂前置 + 自动恢复原前台）。不要凭猜测提前用 foreground。
- 通道纪律：同一目标、同一任务内，`cua_*`（后台）与 `computer_*`（前台 SendInput）二选一，不混用。

## 浏览器（CDP 路由）

1. `cua_browser_prepare`：`strategy {"kind":"existing_profile"}` + pid/window_id + session。本 bundle 默认带 `--grant existing-profile` 启动驱动（见 `cordis.patch.yml`），可附着用户正在运行的 Chromium 配置；报 `browser_consent_required` 说明 grant 没生效，查驱动进程参数。
2. `cua_get_browser_state`：先 bind（pid+window_id），再取 `snapshot_format:"semantic_v2"` 快照；ref 形如 `p<snapshot>:<index>`，导航或新快照后作废。
3. 动作：`cua_browser_click` / `cua_browser_type`（`replace:true` 整段替换/清空）/ `cua_browser_select`（原生 <select>）/ `cua_browser_navigate`（仅 http/https/about）/ `cua_browser_pointer`（hover/右键/双击/滚动/拖拽）/ `cua_browser_dialog`（页内 JS 对话框）/ `cua_browser_set_input_files`。
4. 浏览器调用被拒时，读拒绝结果里的 `next_call`（精确重试参数，常含会话标签与 pid/window_id）先照着重试；CDP 路由持续不可用时，网页内容回退 UIA 路由：`cua_set_value`（element_token，走 ValuePattern）+ 合成点击提交按钮，全程后台。
   - 学习通 / chaoxing 在线考试的完整实战经验（逐题 vs 整卷预览、水印行刷屏、选项匹配陷阱、多空格题型）见 `exam-chaoxing.md`，遇同类任务先读它。
5. 浏览器对象（target/tab/ref）都是**会话域**的：多步浏览器工作请带同一个短 `session` 标签（如 `browser-run-1`），所有调用都传它。

## 光标与外观

- `cua_*` 的可视反馈是**代理光标叠加层**（假光标，永不移动用户真实指针）：AX 动作脉冲、像素动作沿弧线滑行；闲置 15 秒自动隐藏（`idle_hide_ms:15000`），所以连续操作时能看见滑行、停顿就消失——这是设计行为，不是丢了光标。
- 运行时可调，不用重启驱动：`cua_move_cursor`（移到某点）、`cua_set_agent_cursor_motion`（轨迹/计时/特效）、`cua_set_agent_cursor_theme`、`cua_set_config` / `cua_get_config`（持久配置）。

## 限制与边界

- `cua_browser_download` 等破坏性工具需要宿主侧"destructive 批准"；如果 DSH 会话的批准提示是关闭的（自动拒绝模式），预期会遇到 refusal——遇到就如实报告，不要绕过。
- 驱动使用 per-user 存储目录（Windows 下 `%USERPROFILE%\.cua-driver\`）保存配置与遥测 ID；与其他已安装的 cua-driver 版本共享，升级驱动 = 替换本包内 `vendor/` 目录并重启 DSH。
- 驱动会在该目录写入 `.telemetry_id`（稳定匿名 ID）并做版本检查（`version_check.json`）；介意可用 `cua_get_config` / `cua_set_config` 查看可配项。
- DSH 宿主窗口（DeepSeek Harness 主窗口）不作为操作目标。

## 诊断

- `cua_get_guide`：topic = overview / drag / browser / permissions / batching / menus（驱动自带的完整指南，比本文件权威，拿不准就查它）。
- `cua_health_report` / `cua_check_permissions`：环境体检。
- 输入路由疑难：`cua_debug_window_info`（看窗口类与 UIA 能力）。

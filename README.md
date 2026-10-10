# Prism Panel — Rokid Glasses AIUI

**English** / [中文](#中文)

The official Prism client for Rokid AI glasses. Your coding agents keep
running on the desktop; you follow conversations, dictate messages, handle
approvals and check quotas from your glasses.

Chain: **glasses (this panel) → Prism Cloud → Prism Hub (desktop) → plugin →
agent** (Codex, Claude Code, Hermes, OpenClaw, ...). The panel signs in with
a host-issued device credential — no token is embedded, logged or stored.

## Features

- Live conversations: NDJSON stream, Markdown, tool calls
- Voice input: tap to stop, long-press for the menu
- Approvals; switch model, reasoning effort and permissions; stop anytime
- Two home widgets: usage quotas, latest conversations
- 简体中文 · 繁體中文 · English · 日本語

## Build your own

- **Connect a new agent to Prism** — write a plugin with the
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk).
  No changes needed here; the panel lists it automatically.
- **Build your own connector & terminal** — use this repo as a reference
  implementation and **detach from Prism entirely**: replace the API client
  (`lib/prism-api.js`) with one for your own backend and reuse what is
  backend-agnostic — device-credential flow, NDJSON stream client, touchpad
  gesture layer, widget runtime, i18n core.

> ⚠️ **Do not point your own app at the Prism relay servers.** See
> [Restrictions](#restrictions).

## Restrictions

- The cloud relays configured in this repo (`ai-cloud.rokid.com`,
  `ai-cloud-test.rokid.com`) are Rokid infrastructure, not part of the
  open-source grant. AIUI apps built from this code must not use them, and
  must not be published to the Rokid Agent Store while configured to use
  them, without written authorization from Rokid.
- The code is for **non-commercial use only** — [LICENSE](./LICENSE).
  Commercial licensing: contact Rokid.

## Develop

```bash
npm install
npm test          # 160+ node:test cases, no device needed
npm run pack
```

Import into [Craft](https://js.rokid.com) and preview `pages/index/index`
(480×352 viewport). Packaged builds target production; for the test gateway
add a gitignored `env.json` in the repo root:

```json
{ "baseUrl": "https://ai-cloud-test.rokid.com/prism/api" }
```

Start reading: `pages/index/index.js` → `lib/prism-api.js` →
`lib/prism-widget-runtime.js`. Full guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — © 2026 Rokid. Vendored markdown
libraries keep their own notices in [`lib/vendor/`](./lib/vendor/).

---

# 中文

Rokid AI 眼镜上的官方 Prism 客户端。编程 Agent 留在桌面干活，你在眼镜上跟进
会话、语音输入、处理审批、查看额度。

链路：**眼镜（本面板）→ Prism 云端 → 桌面 Prism Hub → 插件 → Agent**（Codex、
Claude Code、Hermes、OpenClaw……）。面板用宿主签发的设备凭据登录，源码、日志、
磁盘里都不会出现 token。

## 功能

- 会话实时流：NDJSON 推送、Markdown 渲染、工具调用
- 语音输入：单击停止，长按呼出菜单
- 审批处理；切换模型、推理强度、权限；随时打断
- 两个桌面小组件：用量额度、最新会话
- 简体中文 · 繁體中文 · English · 日本語

## 做你自己的

- **给 Prism 接新 Agent**：用
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk) 写插件，
  本面板零改动自动展示。
- **做自己的连接器和终端**：把本仓库当作参考实现，**完全脱离 Prism 体系**——
  换掉 API 客户端（`lib/prism-api.js`）接你自己的后端，复用与后端无关的部分：
  设备凭据流程、NDJSON 流客户端、触控手势层、小组件运行时、多语言核心。

> ⚠️ **不要让你自己的应用连接 Prism 中继服务器**，见下方限制。

## 限制

- 仓库里配置的中继服务器（`ai-cloud.rokid.com`、`ai-cloud-test.rokid.com`）
  是 Rokid 的基础设施，**不在开源授权范围内**。基于本仓库开发的 AIUI 应用不得
  使用这些服务器；未经 Rokid 书面授权，不得将连接这些服务器的应用上架到智能体
  商店。
- 本仓库代码**仅限非商业使用**，见 [LICENSE](./LICENSE)。商用授权请联系 Rokid。

## 开发

```bash
npm install
npm test          # 160+ 条测试，无需真机
npm run pack
```

用 [Craft](https://js.rokid.com) 导入并预览 `pages/index/index`（480×352 视口）。
打包默认连正式环境；本地连测试网关在根目录放 gitignored 的 `env.json`
（`{ "baseUrl": "https://ai-cloud-test.rokid.com/prism/api" }`）。

入门阅读：`pages/index/index.js` → `lib/prism-api.js` →
`lib/prism-widget-runtime.js`。完整指南见
[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可

[PolyForm Noncommercial 1.0.0](./LICENSE) — © 2026 Rokid。内嵌的 markdown 库在
[`lib/vendor/`](./lib/vendor/) 保留各自许可。

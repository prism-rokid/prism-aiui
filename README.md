# Prism Panel — Rokid Glasses AIUI

**English** / [中文](#中文)

The official Prism client for Rokid AI glasses. Your coding agents keep
running on the desktop; you follow conversations, dictate messages, handle
approvals and check quotas from your glasses.

Chain: **glasses (this panel) → Prism Cloud → Prism Hub (desktop) → plugin →
agent** (Codex, Claude Code, Hermes, OpenClaw, ...). The panel signs in with
a host-issued device credential — no token is embedded, logged or stored.

## Features

- Live conversations: NDJSON stream, tool calls
- Voice input: tap to stop, long-press for the menu
- Approvals; switch model, reasoning effort and permissions; stop anytime
- Two home widgets: usage quotas, latest conversations
- 简体中文 · 繁體中文 · English · 日本語

## Install & use

1. **Desktop** — download and sign in to
   [Prism Hub](https://prism.rokid.com/?download=1), then connect your
   coding agents through their plugins.
2. **Glasses — CLI install over a data cable (currently recommended)** —
   the panel is not yet on the agent store. You need the glasses' USB
   data cable and a desktop already signed in to Prism Hub (step 1).
   Connect the glasses to this computer (authorize ADB debugging when
   prompted), then run in this repo:

   ```bash
   npm install -g @yodaos-pkg/aix-cli   # once
   aix device set-dev                   # once per device
   npm run debug
   ```

   `npm run debug` binds your Rokid account to the glasses, installs the
   panel and opens it.
3. **Agent store (coming soon)** — once published, install Prism Panel
   (棱镜面板) from the agent store on the glasses instead; no cable
   needed.

Open the panel from the launcher to follow conversations, dictate
messages and handle approvals; add the two home widgets (usage quotas,
latest conversations) from the widget picker.

## Restrictions

- The cloud relays configured in this repo are Rokid infrastructure, not
  part of the open-source grant. AIUI apps built from this code must not
  use them, and must not be published to the Rokid Agent Store while
  configured to use them, without written authorization from Rokid.
- The relay addresses are for personal use only, installed via the local
  debug flow. Packages uploaded to AIUI Studio cannot use them.
- The code is for **non-commercial use only** — [LICENSE](./LICENSE).
  Commercial licensing: contact Rokid.

## Contribute & extend

- **Issues & pull requests welcome** — bug reports, ideas and fixes. One
  concern per PR; `npm test` must pass. Guide: [CONTRIBUTING.md](./CONTRIBUTING.md).
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

### Dev loop

```bash
npm install
npm test          # node:test cases, no device needed
```

The real-device install loop lives in
[Install & use](#install--use) above (`npm run debug`; `npm run pack`
builds the clean production package). Start reading: `pages/index/index.js` →
`lib/prism-api.js` → `lib/prism-widget-runtime.js`. Full guide:
[CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — © 2026 Rokid.

---

# 中文

Rokid AI 眼镜上的官方 Prism 客户端。编程 Agent 留在桌面干活，你在眼镜上跟进
会话、语音输入、处理审批、查看额度。

链路：**眼镜（本面板）→ Prism 云端 → 桌面 Prism Hub → 插件 → Agent**（Codex、
Claude Code、Hermes、OpenClaw……）。面板用宿主签发的设备凭据登录，源码、日志、
磁盘里都不会出现 token。

## 功能

- 会话实时流：NDJSON 推送、工具调用
- 语音输入：单击停止，长按呼出菜单
- 审批处理；切换模型、推理强度、权限；随时打断
- 两个桌面小组件：用量额度、最新会话
- 简体中文 · 繁體中文 · English · 日本語

## 安装使用

1. **桌面端**：下载并登录 [Prism Hub](https://prism.rokid.com/?download=1)，
   通过插件连接你的编程 Agent。
2. **眼镜端——数据线 CLI 安装（当前推荐）**：面板尚未上架智能体商店。
   你需要：眼镜配套数据线、已在桌面端登录 Prism Hub 的电脑（见第 1 步）。
   用数据线将眼镜连接到电脑（提示时授权 ADB 调试），然后在仓库目录执行：

   ```bash
   npm install -g @yodaos-pkg/aix-cli   # 一次性
   aix device set-dev                   # 每台设备一次
   npm run debug
   ```

   `npm run debug` 会把你的 Rokid 账号绑定到眼镜，安装棱镜面板并打开。
3. **智能体商店（待上架）**：上架后可直接在眼镜的智能体商店安装
   棱镜面板，无需数据线。

从桌面启动器打开面板，跟进会话、语音输入、处理审批；在小组件挑选器里
添加两个桌面小组件（用量额度、最新会话）。

## 限制

- 仓库里配置的中继服务器是 Rokid 的基础设施，**不在开源授权范围内**。
  基于本仓库开发的 AIUI 应用不得使用这些服务器；未经 Rokid 书面授权，
  不得将连接这些服务器的应用上架到智能体商店。
- 中继服务器地址仅限个人使用，通过本地调试方式安装。如上传到
  AIUI Studio，则无法使用。
- 本仓库代码**仅限非商业使用**，见 [LICENSE](./LICENSE)。商用授权请联系 Rokid。

## 贡献与二次开发

- **欢迎提交 issue 或 PR**：bug 反馈、功能建议与修复。一个 PR 一件事，
  `npm test` 需全绿。指南见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- **给 Prism 接新 Agent**：用
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk) 写插件，
  本面板零改动自动展示。
- **做自己的连接器和终端**：把本仓库当作参考实现，**完全脱离 Prism 体系**——
  换掉 API 客户端（`lib/prism-api.js`）接你自己的后端，复用与后端无关的部分：
  设备凭据流程、NDJSON 流客户端、触控手势层、小组件运行时、多语言核心。

> ⚠️ **不要让你自己的应用连接 Prism 中继服务器**，见上方限制。

### 开发流程

```bash
npm install
npm test          # node:test 测试，无需真机
```

真机安装调试链路见上方[安装使用](#安装使用)（`npm run debug`；
`npm run pack` 打干净的生产包）。入门阅读：`pages/index/index.js` →
`lib/prism-api.js` → `lib/prism-widget-runtime.js`。完整指南见
[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可

[PolyForm Noncommercial 1.0.0](./LICENSE) — © 2026 Rokid。

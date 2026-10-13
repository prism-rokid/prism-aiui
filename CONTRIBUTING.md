# Contributing / 贡献指南

**English** / [中文](#中文)

## English

### Ways to help

- **Bug reports** — open an issue with glasses model + firmware, the panel
  `build.tag` from diagnostics logs, and what happened.
- **Fixes & features** — one concern per PR; `npm test` must pass.
- **Locales** — add a pack in `lib/i18n/` (key set must match the other
  packs), register it in `lib/prism-i18n.js`, and add `app.<locale>.json`
  for widget names.
- **New agents** — usually no change here: write a
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk) plugin
  and the panel picks it up.

### Dev loop

```bash
npm install
npm test          # 170+ node:test cases, no device needed
```

1. Real-device debug: `npm run debug` (needs the
   [@yodaos-pkg/aix-cli](https://www.npmjs.com/package/@yodaos-pkg/aix-cli)
   and an ADB-connected device with developer mode on). It injects the
   account token from your Prism Hub login (`~/.prism/config.yaml`) into a
   debug package, installs and launches it, then restores the sources.
2. Browser-only preview: `aix preview .`; `dev/cors-proxy.mjs` plus a
   gitignored `env.json` (`{ "baseUrl": "http://localhost:9100/prism/api",
   "token": "<access_token>" }`) when the preview needs live data.

### Code expectations

- `pages/index/index.js` is a thin composition root; behavior belongs in
  `lib/prism-page-*.js` method groups or pure lib modules.
- Never log or persist credentials — device tokens live in memory only
  (`lib/prism-device-auth.js`); the debug-injection slot
  (`lib/prism-local-token.js`) stays empty in the repository. Tests
  enforce both.
- Widgets share `lib/prism-widget-runtime.js`; don't duplicate polling/auth
  per widget.
- Tests for anything observable; the pure builders in `lib/*-model.js` and
  `lib/widget-data.js` are the easy wins.
- Comments in Chinese or English, written for the next maintainer.

By submitting a PR you license your contribution under this repository's
[license](./LICENSE) (PolyForm Noncommercial).

---

## 中文

### 贡献方式

- **反馈 bug**：issue 附眼镜型号与固件版本、诊断日志里的 `build.tag`、问题表现。
- **修复与功能**：一个 PR 一件事；`npm test` 全绿。
- **新增语言**：在 `lib/i18n/` 加语言包（key 集合与其他包一致）、在
  `lib/prism-i18n.js` 注册、补 `app.<locale>.json`。
- **接入新 Agent**：通常无需改本仓库，用
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk) 写插件即可。

### 开发流程

```bash
npm install
npm test
```

1. 真机调试：`npm run debug`（需要
   [@yodaos-pkg/aix-cli](https://www.npmjs.com/package/@yodaos-pkg/aix-cli)
   和已开开发者模式的 ADB 设备）。脚本会把 Prism Hub 登录的账号 token
   （`~/.prism/config.yaml`）注入调试包、安装启动，然后还原源码。
2. 仅浏览器预览：`aix preview .`；预览要连真实数据时配
   `dev/cors-proxy.mjs` 和 gitignored 的 `env.json`
   （`{ "baseUrl": "http://localhost:9100/prism/api", "token": "<access_token>" }`）。

### 代码要求

- `pages/index/index.js` 只是组合根；行为写进 `lib/prism-page-*.js` 或纯 lib
  模块。
- 绝不记录或持久化凭据——设备 token 仅存内存
  （`lib/prism-device-auth.js`）；调试注入槽位（`lib/prism-local-token.js`）
  在仓库里恒为空。测试会校验这两条。
- 小组件共享 `lib/prism-widget-runtime.js`，轮询/鉴权不要重复实现。
- 可观察的行为都要有测试；`lib/*-model.js`、`lib/widget-data.js` 是纯函数，
  最好下手。
- 注释中英文均可，写给下一位维护者。

提交 PR 即表示你接受本仓库[许可](./LICENSE)（PolyForm Noncommercial）约束。

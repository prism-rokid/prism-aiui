# Contributing to Prism AIUI / 贡献指南

**English** / [中文](#中文)

## English

Thanks for considering a contribution! This panel is the glasses-side face of
Prism — every fix here lands on real Rokid glasses, so a few ground rules keep
it shippable.

### Ways to help

- **Bug reports** — open an issue with: glasses model + firmware, panel
  version (visible in diagnostics logs as the `build.tag` marker), what you
  expected, and what happened. Screenshots of the glasses view help a lot.
- **Bug fixes & features** — open a PR. Keep it focused: one concern per PR.
- **New locales** — the i18n packs live in `lib/i18n/`. All four packs must
  keep an identical key set (`npm test` enforces this), so add your locale's
  file plus a `PACKS` entry in `lib/prism-i18n.js` and matching
  `app.<locale>.json` for widget names.
- **New agents to control** — if you want Prism to drive a new coding agent,
  you usually do **not** need to change this repo: write a Prism plugin with
  the [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk)
  instead. This panel renders whatever plugins the user has connected.

### Development loop

```bash
npm install       # dev dependency: @yodaos-pkg/ink (widget/view engine types)
npm test          # 160+ node:test cases, no device needed
npm run pack      # build package.aix via the official aix CLI
```

1. Import the repo into [Craft](https://js.rokid.com) (the AIUI studio) and
   preview `pages/index/index` for quick iteration; the page targets the
   480×352 logical viewport of Rokid glasses.
2. For browser preview against a Prism gateway, run `node dev/cors-proxy.mjs`
   (NDJSON streams are piped unbuffered; `PROXY_TARGET` overrides the relay
   target).
3. The panel ships against the **production** gateway by default. To develop
   against the test environment, create a gitignored `env.json` in the repo
   root: `{ "baseUrl": "https://ai-cloud-test.rokid.com/prism/api" }`.

### Code expectations

- `npm test` must pass; add or extend tests for anything observable
  (model builders in `lib/*-model.js` and `lib/widget-data.js` are pure and
  fully unit-testable).
- The page (`pages/index/index.js`) is a thin composition root over
  `lib/prism-page-*.js` method groups — new page behavior belongs in a method
  group or a pure lib module, not inline in the page.
- Never log or persist credentials. Device tokens are requested through
  `navigator.requestDeviceToken()` and live only in memory
  (`lib/prism-device-auth.js`); tests assert this.
- Widgets share `lib/prism-widget-runtime.js` — keep polling/auth logic there
  rather than duplicating it per widget.
- Comments may be Chinese or English; write them for the next contributor,
  not for a code review.

---

## 中文

欢迎为棱镜面板贡献代码！这个仓库是 Prism 在 Rokid 眼镜上的门面，任何改动都可能直接
上线到真实眼镜上，所以请遵守以下约定。

### 贡献方式

- **反馈 bug**：提 issue 时附上眼镜型号与固件版本、面板版本（诊断日志里的
  `build.tag` 标记）、预期与实际表现，最好附眼镜截图。
- **修复与功能**：提交 PR，一个 PR 只做一件事。
- **新增语言**：语言包在 `lib/i18n/`，四个语言包的 key 集合必须一致（`npm test`
  会校验）；同时要在 `lib/prism-i18n.js` 的 `PACKS` 注册，并为小组件名称新增
  `app.<locale>.json`。
- **接入新的 Agent**：想让 Prism 控制新的编程 Agent，通常不需要改本仓库——用
  [PluginBridge SDK](https://github.com/prism-rokid/prism-plugin-sdk) 编写插件即可，
  面板会自动展示用户已连接的插件。

### 开发流程

```bash
npm install       # 开发依赖：@yodaos-pkg/ink
npm test          # 160+ 条 node:test 用例，无需真机
npm run pack      # 通过官方 aix CLI 打出 package.aix
```

1. 用 [Craft](https://js.rokid.com) 导入仓库并预览 `pages/index/index`；页面按
   Rokid 眼镜 480×352 逻辑视口开发。
2. 浏览器预览需要联调网关时运行 `node dev/cors-proxy.mjs`（NDJSON 流式透传，
   `PROXY_TARGET` 可切换目标网关）。
3. 面板默认连接**正式环境**。本地开发连测试环境时，在仓库根目录放置 gitignore
   的 `env.json`：`{ "baseUrl": "https://ai-cloud-test.rokid.com/prism/api" }`。

### 代码要求

- `npm test` 全绿；可观察的行为变化都要带测试（`lib/*-model.js` 与
  `lib/widget-data.js` 是纯函数，易于单测）。
- 页面（`pages/index/index.js`）只是组合根，具体行为放进 `lib/prism-page-*.js`
  方法组或纯 lib 模块。
- 绝不把凭据写进日志或持久化。设备 token 只通过
  `navigator.requestDeviceToken()` 获取并仅存内存
  （`lib/prism-device-auth.js`），测试会强制校验。
- 两个小组件共享 `lib/prism-widget-runtime.js`，轮询与鉴权逻辑不要在各组件里
  重复实现。
- 注释中英文均可，但请写给下一位维护者，而不是写给 code review。

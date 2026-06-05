# 🌱 KimiCodeTokenTracker

一个运行在 **macOS 状态栏**的轻量小工具，实时统计并展示 [Kimi Code CLI](https://github.com/moonshotai/kimi-code) 的 Token 用量。

> 不只是数据面板，还是你和 AI 并肩作战的情绪记录员。

---

## ✨ 功能特性

- **实时统计**：自动监听 Kimi Code 会话日志，增量解析 Token 用量数据
- **趣味状态栏**：菜单栏标题随用量动态变化，从 `🌱` 到 `👑 传说级`，陪你见证每一点进步
- **每日心情**：详情面板顶部的心情语录 + 趣味换算，把冰冷的数字变成会心一笑
- **里程碑通知**：突破 100万 / 1000万 / 5000万 / 1亿 / 3亿 时自动弹窗庆祝 🎉
- **今日活跃时段热力图**：24 小时用量分布，一眼看出你最卷的时段
- **分享卡片**：一键生成精美用量报告图，保存到桌面发朋友圈
- **详情面板**：点击状态栏图标展开可视化面板，包含：
  - 今日 Token 概览（Input / Output 比例条）
  - 当前活跃会话详情
  - 最近 7 日用量趋势图
  - 各模型 Token 分布
  - 今日会话列表
- **开机自启**：支持设置为登录时自动启动
- **轻量无侵入**：只读取本地日志文件，不影响 Kimi Code 正常运行

---

## 🖼️ 效果展示

```
状态栏: 🔥 60.0M              ← 随用量变化的趣味 emoji

┌─────────────────────────────┐
│         🔥                  │  ← 每日心情 emoji
│  今日高产，键盘在燃烧 🔥    │  ← 心情语录
│  ≈ 6 分钟播客文稿           │  ← 趣味换算
│                             │
│      今日 Token 用量        │
│        60,000,000           │
│    [Input ████ Output ██]   │
│                             │
│  ┌─────────────────────┐    │
│  │ 当前会话              │    │
│  │ 📁 my-project         │    │
│  │ Input 36M | Output 24M│    │
│  └─────────────────────┘    │
│                             │
│  [7 日趋势柱状图]            │
│                             │
│  [24小时活跃时段热力图]      │
│                             │
│  ┌─────────────────────┐    │
│  │ 📸 生成今日分享卡片  │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

### 📸 分享卡片效果

点击「生成今日分享卡片」按钮，会生成一张 400×720 像素的精美图片，包含：
- 用量级别 emoji + 标签
- 今日 Token 总量
- 心情语录 + 趣味换算
- 7 日迷你趋势图
- 底部项目链接

图片自动保存到桌面，文件名如 `KimiToken_2026-06-05_1234567890.png`。

---

## 📦 安装

### 前置要求

- macOS 10.15 或更高版本
- [Node.js](https://nodejs.org/) 18+

### 方式一：直接下载 .app（推荐）

前往 [Releases](https://github.com/smartweb/KimiCodeTokenTracker/releases) 页面下载最新版 `.dmg`，安装后拖入 `/Applications` 即可。

### 方式二：从源码运行

```bash
# 1. 克隆项目
git clone https://github.com/smartweb/KimiCodeTokenTracker.git
cd KimiCodeTokenTracker

# 2. 安装依赖
npm install

# 3. 启动
npm start
```

启动后，状态栏会出现一个图标：
- **左键点击** → 打开详情面板
- **右键点击** → 打开菜单

### 打包

```bash
npm run build
```

打包后的应用位于 `dist/` 目录下。

---

## 🔬 原理

Kimi Code CLI 在 `~/.kimi-code/sessions/{session_id}/agents/main/wire.jsonl` 中以 JSON Lines 格式记录所有事件。其中 `type === "usage.record"` 的条目包含：

```json
{
  "type": "usage.record",
  "model": "kimi-code/kimi-for-coding",
  "usage": {
    "inputOther": 1821,
    "output": 210,
    "inputCacheRead": 13312,
    "inputCacheCreation": 0
  },
  "time": 1780667425509
}
```

本应用通过监听这些文件的增量变化，实时累计并展示 Token 用量。

---

## 📊 用量等级体系

等级按真实用量规模校准，参考：5000万≈60分，1亿≈80分，3亿≈跑赢99%

| 用量 | 等级 | emoji |
|------|------|-------|
| 0 | 萌芽中 | 🌱 |
| < 100万 | 新手村 | 🐣 |
| < 1000万 | 小有成就 | 🚀 |
| < 5000万 | 进阶选手 | 💪 |
| < 1亿 | 高产达人 | 🔥 |
| < 3亿 | 肝帝模式 | 🤯 |
| ≥ 3亿 | 传说级 | 👑 |

---

## 📁 项目结构

```
KimiCodeTokenTracker/
├── src/
│   ├── main.js          # Electron 主进程（Tray、窗口管理、里程碑通知、分享保存）
│   ├── tracker.js       # Token 统计引擎（日志扫描、趣味文案、小时级统计）
│   └── ui/
│       ├── index.html   # 详情面板
│       ├── style.css    # 面板样式
│       ├── renderer.js  # 渲染逻辑 + Canvas 分享卡片生成
│       └── preload.js   # Electron preload 脚本
├── src/assets/
│   └── iconTemplate.png # 状态栏图标
├── package.json
├── README.md
└── LICENSE
```

---

## 🛠️ 技术栈

- **Electron** — 跨平台桌面应用框架（Tray + 无边框窗口）
- **chokidar** — 高效的文件系统监听
- **原生 Canvas API** — 分享卡片绘制，零额外依赖
- **纯 HTML/CSS/JS** — 详情面板 UI，无额外前端框架依赖

---

## ❓ 常见问题

**Q: 状态栏显示 `🌱 0` 但没有数据？**

A: 请确保你已经使用 Kimi Code CLI 进行过至少一次对话。应用只统计已有会话的 `wire.jsonl` 中的 `usage.record` 事件。

**Q: Input 为什么比 Output 大很多？**

A: 这是正常的。Input 包含了你发送的消息 + 历史上下文缓存读取（`inputCacheRead`），而 Output 只是模型本次返回的内容。每次请求都会带上历史对话，所以 Input 远大于 Output。

**Q: 如何更新统计？**

A: 统计是实时自动更新的。应用每 3 秒刷新一次 UI，同时监听文件变化事件进行增量更新。你也可以在右键菜单中手动点击「刷新」。

**Q: 支持多个同时运行的 Kimi Code 会话吗？**

A: 支持。应用会监听所有会话的日志，并在「今日会话」列表中分别展示各会话用量。

**Q: 分享卡片生成失败？**

A: 请确保今日有 Token 用量数据（总量 > 0），否则按钮会提示"先去跟 Kimi 聊几句吧"。如果保存到桌面失败，请检查桌面目录是否有写入权限。

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

- 发现 bug？请开 Issue 描述复现步骤
- 有新想法？直接开 Issue 聊聊
- 想改代码？Fork 后提 PR 即可

---

## ☕ 关于作者

**Smartweb** — 人在深圳

- 💬 微信：`smartweb`
- 🌍 欢迎请我喝咖啡，也欢迎来深圳面基聊天

如果你用了这个小工具觉得不错，可以点个 ⭐，或者告诉我你一天最高消耗了多少 Token 😄

---

## License

[MIT](LICENSE) © Smartweb

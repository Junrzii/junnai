# JunNAI

一个针对手机界面优化的 NovelAI Vibe 生图前端。

## 功能

- `pst-` Key 与负面提示词长期保存在当前设备浏览器，不写入代码或仓库
- 上传最多 4 个图片或 JSON Vibe，并调整强度
- 建立多组画师串预设，保存、切换、更新或删除
- 顶部名称、副标题、图标图片、图标文字与颜色可在本地自定义
- Opus 不限额小图、标准图与自定义宽高；小图一次最多生成 6 张
- 修复 iPhone 点击输入框时 Safari 自动放大页面的问题
- 使用 IndexedDB 在当前设备保存最近 100 张图片
- GitHub Pages 自动部署

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

生成结果位于 `dist` 目录。

## 隐私

本项目为纯前端页面。NovelAI Key 不会进入 GitHub 仓库；它仅保存在当前设备浏览器的 `localStorage`，请求会由浏览器直接发送给 NovelAI。在公共设备上使用后，请点击 Key 输入框旁边的“清除”。

# JunNAI

一个针对手机界面优化的 NovelAI Vibe 生图前端。

## 功能

- 官方 `pst-` Key、第三方 Key 与负面提示词长期保存在当前设备浏览器，不写入代码或仓库
- 支持官方 NovelAI 与自定义兼容接口，可设置 API 地址、请求路径、模型和鉴权方式
- 上传最多 4 个图片或 JSON Vibe，并调整强度；支持单个 `.naiv4vibe.json`、`.naiv4vibebundle` 合集和带 `vibeData` 的分组备份
- 建立本地 Vibe 库，可保存图片 Vibe 与 JSON encoding，之后直接选择用于生图
- 建立带例图的画师串库，保存、切换、更新或删除
- 建立带例图的角色提示词库，可复制提示词或直接选为当前生图角色
- 顶部名称、副标题、图标图片、图标文字与颜色可在本地自定义
- 内置柔紫、黑白简约、iOS 26 液态玻璃、薄荷、樱粉和雾蓝六套整站主题，选择会保存在当前设备
- Opus 不限额小图、标准图与自定义宽高；小图一次最多生成 6 张
- 修复 iPhone 点击输入框时 Safari 自动放大页面的问题
- 使用 IndexedDB 在当前设备保存 Vibe 库与最近 100 张图片
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

本项目为纯前端页面。Key 不会进入 GitHub 仓库；它仅保存在当前设备浏览器的 `localStorage`，请求会由浏览器直接发送给你选择的 API。在公共设备上使用后，请点击 Key 输入框旁边的“清除”。第三方接口必须允许浏览器跨域访问，并兼容 NovelAI 的请求结构。

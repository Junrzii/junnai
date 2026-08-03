# JunNAI

一个针对手机界面优化的 NovelAI Vibe 生图前端。

## 功能

- `pst-` Key 仅保存在当前浏览器会话，不写入代码或仓库
- 上传最多 4 张 Vibe 参考图并调整强度
- 保存画师串，并自动添加到每次提示词前
- 7 种常用生图尺寸，一次生成 1–4 张
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

本项目为纯前端页面。NovelAI Key 不会进入 GitHub 仓库；它仅保存在浏览器的 `sessionStorage`，请求会由浏览器直接发送给 NovelAI。

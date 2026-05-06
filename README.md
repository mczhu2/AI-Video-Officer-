# AI Video Officer

基于 `Qwen-Omni-Realtime` 的视频面试 Demo。前端和后端都在这个仓库里。

## 功能

- 固定流程：举左手、举右手、自我介绍
- 动作题固定 8 秒观察窗口，超时自动进入下一题
- 自我介绍固定 10 秒
- 切题时会清空旧语音队列，避免上一题提示音串到下一题
- 结果页展示动作结果、转写、点评和总评

## 代码位置

- `server.js`：Node.js 后端，负责静态资源、浏览器 WebSocket、Omni Realtime 代理
- `public/index.html`：单页前端
- `package.json`：启动脚本和依赖定义
- `DEPLOYMENT.md`：给其他 AI 或工程师使用的部署文档，包含服务器落点、Nginx、systemd、发布步骤

## 环境变量

- `DASHSCOPE_API_KEY`：必填，阿里云 DashScope Key
- `DASHSCOPE_REALTIME_MODEL`：可选，默认 `qwen3.5-omni-plus-realtime`
- `DASHSCOPE_REALTIME_URL`：可选，默认 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
- `DASHSCOPE_REALTIME_VOICE`：可选，默认 `Tina`
- `PORT`：可选，默认 `3000`

## 本地启动

```bash
npm install
npm run check
npm start
```

浏览器访问：

```text
http://127.0.0.1:3000
```

健康检查：

```text
http://127.0.0.1:3000/api/health
```

## 部署入口

完整部署说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 说明

仓库里不包含任何真实密钥。部署时请通过环境变量注入 `DASHSCOPE_API_KEY`。

## 快速体验

整个面试流程约 30 秒：
1. 举左手（8 秒）
2. 举右手（8 秒）
3. 自我介绍（10 秒）

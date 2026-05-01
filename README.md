# AI Video Officer

基于 `Qwen-Omni-Realtime` 的单体视频面试 Demo。前端和后端都在这个仓库里，动作观察、实时引导、工作经历转写、发言点评、最终总结全部依赖 Omni 实时能力完成。

## 功能

- 固定流程：举左手、举右手、左转、右转、工作经历介绍、总结
- 动作题固定 8 秒观察窗口，超时自动进入下一题
- 工作经历介绍固定 35 秒，自动转写并在结果页展示
- 切题时会清空旧语音队列，避免上一题提示音串到下一题
- 结果页展示动作结果、候选人转写、发言点评和总评

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

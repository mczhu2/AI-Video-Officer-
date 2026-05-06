# Deployment Guide

这个文档给其他 AI 或工程师使用，目标是让接手人能快速定位代码、理解 `8443` 当前部署结构，并把最新代码发布上去。

## 1. 仓库内代码位置

- `server.js`
  - Node.js 后端入口
  - 提供静态资源
  - 暴露 `/api/health`
  - 暴露 `/api/realtime` WebSocket
  - 负责把浏览器会话桥接到 `Qwen-Omni-Realtime`
- `public/index.html`
  - 前端单页
  - 负责摄像头、麦克风、动作采样、语音播放、结果页展示
- `package.json`
  - 启动脚本与依赖
- `README.md`
  - 项目概览

## 2. 当前线上部署结构

当前 `8443` 口径是：

- 外部入口：`https://<host>:8443`
- Nginx：
  - `/` 提供静态页面
  - `/api/` 反向代理到 `127.0.0.1:3000`
  - `/api/realtime` 需要支持 WebSocket Upgrade
- Node 服务：
  - 默认监听 `0.0.0.0:3000`
  - systemd 用户服务名：`trtc-interview.service`

## 3. 当前服务器落点

当前线上机器上的代码和服务路径如下：

- 后端工作目录：`/home/admin/.openclaw/workspace/trtc-interview`
- 后端入口文件：`/home/admin/.openclaw/workspace/trtc-interview/server.js`
- 前端页面文件：`/home/admin/.openclaw/workspace/trtc-interview/public/index.html`
- Nginx 对外静态页：`/usr/share/nginx/html/index.html`
- 用户级 systemd 服务文件：`/home/admin/.config/systemd/user/trtc-interview.service`

代码发布时，至少要同步这 3 个文件：

```text
server.js -> /home/admin/.openclaw/workspace/trtc-interview/server.js
public/index.html -> /home/admin/.openclaw/workspace/trtc-interview/public/index.html
public/index.html -> /usr/share/nginx/html/index.html
```

## 4. 环境变量

生产环境至少需要：

- `DASHSCOPE_API_KEY`

可选：

- `DASHSCOPE_REALTIME_MODEL`
- `DASHSCOPE_REALTIME_URL`
- `DASHSCOPE_REALTIME_VOICE`
- `PORT`

不要把真实密钥写进仓库。密钥必须通过环境变量或服务文件注入。

## 5. 本地运行

```bash
npm install
npm run check
npm start
```

默认地址：

```text
http://127.0.0.1:3000
http://127.0.0.1:3000/api/health
```

## 6. Nginx 反向代理要求

`8443` 这套服务的关键不是复杂静态资源，而是 `/api/realtime` 的 WebSocket 反代必须正确。

最小配置要点：

- `/` 指向页面
- `/api/` 代理到 `http://127.0.0.1:3000/`
- 对 `/api/realtime` 或整个 `/api/` 打开：
  - `proxy_http_version 1.1`
  - `Upgrade`
  - `Connection: upgrade`

可参考下面的片段：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## 7. systemd 启动方式

当前是用户级服务，不是系统级服务。

常用命令：

```bash
sudo -u admin XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user restart trtc-interview.service
```

查看状态：

```bash
sudo -u admin XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user --no-pager --full status trtc-interview.service
```

如果需要查看日志：

```bash
sudo -u admin XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus journalctl --user -u trtc-interview.service -n 200 --no-pager
```

## 8. 发布步骤

推荐发布流程：

1. 在本地修改并校验代码。
2. 同步 `server.js` 到服务器工作目录。
3. 同步 `public/index.html` 到服务器工作目录。
4. 同步 `public/index.html` 到 Nginx 对外目录 `/usr/share/nginx/html/index.html`。
5. 在服务器上执行 `node --check server.js`。
6. 重启 `trtc-interview.service`。
7. 检查 `/api/health`。
8. 做一次 WebSocket 冒烟，确认首题文案和时长正确。

## 9. 服务器端校验命令

后端语法检查：

```bash
cd /home/admin/.openclaw/workspace/trtc-interview && /usr/bin/node --check server.js
```

健康检查：

```bash
curl -sk https://127.0.0.1:8443/api/health
```

## 10. 建议的冒烟验证

至少验证以下几点：

- 首题是否播报：`你好，请举起左手并保持八秒。`
- `action.capture.start.durationMs` 是否为 `8000`
- 自我介绍是否为 `10` 秒
- 切到第二题时，是否仍然播放上一题语音
- 结果页是否能看到：
  - 动作结果
  - 自我介绍转写
  - 点评
  - 总结

## 11. 当前行为约束

当前实现包含这些产品约束：

- 不调用外部单独 CV 服务
- 动作判断、引导、总结全部依赖 Omni
- 口令格式不叫姓名，只说"你好，请……"
- 每个动作题固定观察时长后再判断
- 超时自动进入下一题
- 自我介绍需要展示用户转写内容
- 结果页需要展示简单点评

## 12. 不要做的事

- 不要把真实 `DASHSCOPE_API_KEY` 提交到 Git
- 不要把 `.omx` 运行态目录当成产品代码发布
- 不要漏掉 `/usr/share/nginx/html/index.html` 的同步
- 不要忘记给 `/api/realtime` 开 WebSocket Upgrade

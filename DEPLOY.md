# 部署 PQM CNC

## GitHub 与 Docker Hub

部署仓库的根目录需要包含 `.github/workflows/`、`compose.yaml`、`backend/`、`pqm-cnc-frontend/` 和 `copilot-kit/`。目前三个源码目录分别是 Git 工作区。创建或选定一个集成仓库，将三份源码导入为普通目录，保留其原有本地仓库。导入时排除嵌套的 `.git`、本地环境文件、依赖、构建产物和现场数据。确认 checkout 后能直接看到三个目录中的源码和锁文件。

在 Docker Hub 创建 `pqm-cnc-frontend` 和 `pqm-cnc-backend` 两个仓库，并创建有推送权限的访问令牌。在集成仓库的 Settings → Secrets and variables → Actions 添加 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`。Docker Hub 命名空间使用该用户名。

推送到 GitHub 默认分支后，Actions 在 Linux amd64 上构建两个镜像，用 Compose 检查首页和经前端转发的层级 API，再将两个镜像发布为 `latest`。等两个镜像都推送成功后再部署。

## 服务器

安装 Docker 和支持可选 `env_file` 的 Compose（2.24.0 或更新）。复制 `compose.yaml`，同目录新建 `.env`，填入 Docker Hub 用户名。

```dotenv
DOCKERHUB_USERNAME=your-dockerhub-user
# WEB_PORT=3001
# WEB_BIND=127.0.0.1
# LLM_BASE_URL=http://ollama-host:11434
# STT_URL=http://whisper-host:8765
```

默认在所有接口发布 3001。若已有同机 HTTPS 反向代理，设置 `WEB_BIND=127.0.0.1`，将代理指向该端口，并为 SSE 关闭代理缓冲。浏览器麦克风需要 HTTPS。Ollama 和 Whisper 地址应能从前端容器访问。

如需现场数据，将 `backend/.env.example` 作为参考，在服务器的 Compose 目录新建 `backend.env`，填写实际的上游 HTTP、WebSocket、数据库和 Kafka 配置。确认后端容器能连到这些地址。私有 Docker Hub 镜像需要先在服务器运行 `docker login`，使用有拉取权限的凭证。

```sh
docker compose pull
docker compose up -d --wait
curl -fsS http://127.0.0.1:3001/backend/api/hierarchy
```

每次发布完成后重新执行以上命令，拉取并启动最新镜像。已有部署切换到 `latest` 时，先上传新版 `compose.yaml`，再删除旧 `.env` 里的 `IMAGE_TAG`。Compose 的命名卷保留图纸和上传、标注布局以及显微镜图片。首次上线若要导入已有现场文件，可在启动后执行以下命令，并将源路径替换为服务器上的实际目录。

```sh
docker compose cp ./MachiningData/. frontend:/app/pqm-cnc-frontend/data/MachiningData/
docker compose cp ./pqm/. frontend:/app/pqm-cnc-frontend/data/pqm/
docker compose exec -u root frontend chown -R node:node data/MachiningData data/pqm
```

## Machine CCTV

Tool Wear 页的 CCTV 块有两条通路：

- **实时视频：** `compose.yaml` 里的 `go2rtc` 服务拉取 NVR 子码流（H.264，不转码），浏览器通过前端同域路径 `/cctv/ws`（WebSocket，MSE 播放）观看。go2rtc 不发布端口，只在 Compose 内部网络里可达；前端只转发固定的 `v61` 流。
- **静态画面（兜底）：** 后端 `GET /api/cctv/snapshot` 用 Digest 认证取 NVR 的 JPEG，视频没有出画面时页面每 1.5 秒刷新一次。

服务器配置（账号密码不要提交到仓库）：

1. 根目录 `.env`（和 `DOCKERHUB_USERNAME` 同一个文件），密码里的 `@` 写成 `%40`：

   ```
   CCTV_RTSP_URL=rtsp://<user>:<password>@172.20.115.109:554/Streaming/Channels/102
   ```

2. `backend.env`（只给静态画面兜底用，不加则兜底不可用，视频不受影响）：

   ```
   CCTV_NVR_HOST=172.20.115.109
   CCTV_HTTP_PORT=80
   CCTV_CHANNEL=102
   CCTV_USER=<user>
   CCTV_PASSWORD=<password>
   ```

3. 服务器要能访问 NVR 的 554 端口（视频）和 80 端口（静态画面）。
4. 前端和后端镜像都要重新构建（前端的流地址在构建时写入）。然后 `docker compose pull && docker compose up -d`。

检查：`docker compose logs go2rtc` 能看到拉流；页面 CCTV 块状态显示 "Live video"。视频不出画面但静态画面正常，多半是 554 端口不通或 `/cctv/ws` 的 WebSocket 没有被前端转发。

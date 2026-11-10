# PQM CNC Backend

Tool Wear 两张历史图当前默认通过 HTTP History API 读取，见文末“Wear history HTTP 接入”。数据库直连保留为可选备用；frontend 已移除 mock 历史曲线。

独立 FastAPI 服务。结构为 API → DataSource 接口 → mock / HTTP / database adapter，数据源变化时前端沿用相同 JSON contract。

## 启动（PowerShell）

```powershell
cd C:\Users\zhangly1\Projects\pqm-cnc\backend
uv sync --group dev
Copy-Item .env.example .env
uv run python -m app
# 开发热更新：uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

默认地址 http://127.0.0.1:8000，交互式 API 文档 http://127.0.0.1:8000/docs。

| Method | Path | 返回 |
| --- | --- | --- |
| GET | `/health` | `{ "status": "ok", "dataSource": "mock" }`，仅检查进程存活 |
| GET | `/api/hierarchy` | `{ "assets": [...] }`，与现有 frontend 的层级 API 格式一致 |

mock 只有一条示例机床链，不是完整生产数据。当前 frontend 继续使用原有 seed 和 Next.js API；此框架没有迁移 drawing、copilot、inference 等功能，也没有自动切换 dashboard 数据。

## Frontend 调用

前端运行在 3001，backend 运行在 8000。浏览器调用示例：

```typescript
const response = await fetch('http://127.0.0.1:8000/api/hierarchy');
if (!response.ok) throw new Error(`Data API failed: ${response.status}`);
const { assets } = await response.json();
```

默认允许 localhost / 127.0.0.1:3001 跨域。部署时通过 `CORS_ORIGINS` 配置实际前端地址；当前未实现鉴权，默认只监听本机。

## 数据源

- `DATA_SOURCE=mock`：默认，立即可运行。
- `DATA_SOURCE=http`：配置 `UPSTREAM_BASE_URL`，请求其 `/api/hierarchy`；可选 `UPSTREAM_API_TOKEN`，以 Bearer token 发送。配置 URL 如包含路径，该路径作为前缀保留。上游必须返回上述 JSON 格式；否则在 `app/sources.py` 的 `HttpSource` 中完成字段映射。
- `DATA_SOURCE=database`：预留，接口明确返回 503 `database_not_configured`。确定数据库类型、连接方式、表结构后实现 `DatabaseSource.hierarchy()`，使用只读连接与参数化查询。

上游超时返回 504，HTTP/JSON/数据格式错误返回 502；响应只包含错误代码，不回传上游内部内容。HTTP client 随服务启动创建、关闭时释放，超时可配置。

新增业务数据：在 `models.py` 定义稳定 contract → 在 `DataSource` 添加方法 → 各 adapter 实现 → 在 `main.py` 暴露 route。不要把外部 API 或 SQL 调用写入 route。

## 检查

```powershell
uv run pytest
```

## 实时信号 SSE

`GET /api/signals/stream?machine_id=Makino_01` 持续返回 SSE。省略机床时使用 `SIGNALS_MACHINE_ID`。

backend 连接 `SIGNALS_WS_URL`（默认 `ws://172.20.114.237:4000/ws`），每轮查询最近 10 秒的 vibration XYZ 和 AE RMS，收到 `done` 后等待约 1 秒再发下一轮。`include_process=true`，同时读取 controller snapshots。设置独立于 hierarchy 的 `DATA_SOURCE`。

- `signals` 事件：`machine_id / start / end / t_max / channels`。每个 channel 为 `channel / method=m4 / bucket_ms / points`，point 为 `t / min / max / first / last`。
- `status` 事件：`state=connecting|live|stale|empty|unavailable`。有数据时包含 `dataTime / ageSeconds`。默认距当前时间超过 10 秒或超过 10 秒未变化标记 stale。
- 每 15 秒无事件时发 SSE heartbeat；上游异常保留上次图表并持续重试。相同数据不重复推送。
- 同一进程内同一机床共用采集任务，最后一个订阅断开后取消任务。demo 使用单 worker；多 worker 不共享采集任务。

frontend 的 dashboard Process context 信号区已使用 SSE。HMI 页面原有模拟信号未迁移。信号是整台机床的窗口，尚未映射到 balloon；Process context 的 feed/spindle 以及 Tool Wear 的 wear/geometry/offset 使用 controller 数据；Tool Wear 趋势图当前使用文末 HTTP history 数据源。图表显示 M4 包络，单位待上游确认，不假定为 V 或 dB。

本机启动 backend 后运行 frontend `npm run dev` 即可。可将 frontend `.env.example` 复制为 `.env.local` 自定义 backend URL 和机床；修改后重启 Next.js。其他电脑访问时必须把 `NEXT_PUBLIC_DATA_API_URL` 改为浏览器可达的 backend 地址，并配置 backend `CORS_ORIGINS`；HTTPS 前端需 HTTPS backend。反向代理需关闭 SSE buffering。

当前接入 latest 模式，不会自动用模拟数据替换真实信号，也未实现历史 Replay。上游只有历史数据时会明确显示 stale。

Controller snapshots 随 signals 事件的 `process` 数组传递。Tool Wear 映射 diameter=xWearMm、length=zWearMm（兼容 tool_wear_x_mm/tool_wear_z_mm），geometry 读取 xGeometryMm/zGeometryMm；offset=geometry+wear，任一缺失显示 —。原 API 文档未定义 geometry，须上游实际返回这些字段才有值。

## 数据库 Tool Wear History

实现位于 `app/tool_wear.py`，独立于 signals WS 和 hierarchy 数据源。只执行 SELECT；必须使用数据库端限制为只读权限的账号。数据库未配置/不可达时 history API 返回 503，不影响服务启动及现有信号接口。frontend 当前使用文末 HTTP history 数据源。

### 你需要填写的配置

将 `.env.example` 复制为 `.env`（已有 `.env` 时只追加 `TOOL_WEAR_*` 部分），填写：

| 配置 | 内容 |
| --- | --- |
| `TOOL_WEAR_DB_URL` | 数据库类型、server、端口、database、只读账号密码组成的连接 URL |
| `TOOL_WEAR_DB_OPTIONS` | driver 的连接/查询超时配置，JSON |
| `TOOL_WEAR_TABLE` / `TOOL_WEAR_SCHEMA` | 表或只读 view，以及可选 schema |
| `TOOL_WEAR_TIME_COLUMN` | 时间列，必须存 UTC，建议数据库原生 timestamp 类型 |
| `TOOL_WEAR_MACHINE_COLUMN` / `TOOL_WEAR_TOOL_COLUMN` | 机床和刀具编号列 |
| `TOOL_WEAR_TOOL_TYPE` | `integer` 对应 6，`string` 对应 T06 等原始字符串 |
| `TOOL_WEAR_X_COLUMN` / `TOOL_WEAR_Z_COLUMN` | diameter/length wear 列，单位 mm |
| `TOOL_WEAR_X_GEOMETRY_COLUMN` / `TOOL_WEAR_Z_GEOMETRY_COLUMN` | 可选 geometry 列，单位 mm；没有则留空 |
| `TOOL_WEAR_INSTANCE_COLUMN` | 可选刀具实例/换刀批次列，避免同一刀位换刀后串连趋势 |
| `TOOL_WEAR_MAX_RANGE_HOURS` / `TOOL_WEAR_MAX_POINTS` | 最大时间跨度和点数，默认 168 小时/2000 点 |

列名只支持字母、数字、下划线；表和 schema 分开填写。不支持自定义 SQL。若原库结构复杂，可建立一个只读 view 将字段平铺。密码中的 `@ : / #` 等字符必须 URL 编码；不要将 `.env` 提交到代码库。

按数据库安装对应 driver：

```powershell
uv sync --extra postgres
# 或 uv sync --extra mysql
# 或 uv sync --extra clickhouse
```

URL 示例已在 `.env.example` 中。按 driver 配置超时，例如 PostgreSQL：

```dotenv
TOOL_WEAR_DB_OPTIONS={"connect_timeout":10,"options":"-c statement_timeout=10000"}
```

MySQL 示例 `{"connect_timeout":10,"read_timeout":10,"write_timeout":10}`；ClickHouse 示例 `{"connect_timeout":10,"send_receive_timeout":10}`。数据库类型未确定，所以没有强加某一种 driver 的参数；连接/执行超时需根据实际 driver 填写。连接池最多 5 个连接，当前串行处理 history 查询。建议在机床、刀具、时间列上配置合适的索引/排序键。

### API

`GET /api/tool-wear/history?machine_id=Makino_01&tool_no=6&start=2026-10-29T00:00:00Z&end=2026-10-29T01:00:00Z&limit=1000`

可选 `tool_instance_id`。start/end 必须有时区，范围为 `[start,end)`，返回按时间升序排列。机器/刀具/时间均使用绑定参数。

```json
{
  "machine_id": "Makino_01",
  "tool_no": "6",
  "start": "2026-10-29T00:00:00Z",
  "end": "2026-10-29T01:00:00Z",
  "unit": "mm",
  "truncated": false,
  "instanceFilterAvailable": true,
  "data": [
    {
      "timestamp": "2026-10-29T00:10:00+00:00",
      "toolInstanceId": "change-001",
      "xWearMm": 0.01,
      "zWearMm": 0.02,
      "xGeometryMm": 2.0,
      "zGeometryMm": null,
      "xOffsetMm": 2.01,
      "zOffsetMm": null
    }
  ]
}
```

空查询返回 `data: []`，不生成 mock 数据。geometry 不可用时 offset 为 null。NaN/Infinity 转 null。数据超过 limit 时仅返回窗口内最早 limit 条，`truncated: true`；frontend 应缩小范围重查，不应把截断结果标为完整窗口。尚未做降采样或分页。需确认数据代表 controller 补偿值还是模型预测磨损值，再确定图表标签及阈值。

SQLite 真实查询测试已覆盖机床/刀具/实例/时间过滤、空值、offset 和截断；其他数据库需填写配置后联调。数据库不可达或字段映射错误统一返回 `tool_wear_database_query_failed`，不把连接凭据或 SQL 错误详情返回给浏览器。

## Kafka microscope 图片 → Tool Wear 照片区

backend 独立消费 `172.20.114.237:9094` 的 `makino_microscope_image`，无需 frontend 打开。frontend 图片区已接入 latest + SSE，收到任意有效图片就显示，不按所选刀具/机床筛选；显示消息实际 machineId、toolNo、拍摄时间、inspectionResult，支持点击放大。按接收顺序替换图片，不按拍摄时间排序。demo 工作流未改变。

安装新增依赖并启动（已有 `.env` 时仅追加配置，不要覆盖其他配置）：

```powershell
cd C:\Users\zhangly1\Projects\pqm-cnc\backend
uv sync --group dev
# 在 .env 设置 MICROSCOPE_KAFKA_ENABLED=true
uv run python -m app
```

完整 `MICROSCOPE_*` 配置位于 `.env.example`。代码默认关闭接收，示例配置启用；本机 `.env` 已启用。默认 PLAINTEXT、独立 group `pqm-cnc-microscope`，首次从 `latest` 开始。若希望获取 broker 里已有图片，设置 `MICROSCOPE_KAFKA_AUTO_OFFSET_RESET=earliest` 并使用新的 group id（已有 group 优先从 committed offset 恢复）。不要让其他不同用途的 consumer 复用此 group。单 backend worker 运行；多副本需要共享图片存储与事件广播，目前未实现。

API：

| 接口 | 内容 |
| --- | --- |
| `GET /api/tool-images/latest` | `{image: null或元数据, status: {state: ...}}` |
| `GET /api/tool-images/{capture_id}/image` | PNG/JPEG 文件，找不到时 404 |
| `GET /api/tool-images/events` | SSE `image` 元数据事件、`status` 状态事件、15 秒空闲 heartbeat |

状态为 `disabled / connecting / connected / unavailable`；frontend 的 SSE 断线显示 reconnecting。元数据含 captureId、machineId、toolNo、timestampUtc、receivedAt、receivedSequence、imageUrl，以及消息里的检测结果；不含 Base64。latest/SSE 都返回 backend 自己的图片 URL。新订阅立即收到已保存的最新图；frontend 重连会重取 latest。

图片及 SQLite 元数据保存在 `MICROSCOPE_IMAGE_DIR`（默认 `backend/data/microscope`，相对于 backend 工作目录）。重启可恢复；目录已 gitignore。captureId 相同且 hash 相同不会重复更新；不同 hash 的相同 captureId 记录为冲突。图片文件原子写入，元数据保存后才提交消息 offset；损坏消息持久记录在 captures.sqlite3 的 rejected 表后提交并继续消费，文件/存储错误不提交，重连重试。仅接收 schemaVersion=1.0.0、base64 PNG/JPEG；验证 hash、byte count、图片尺寸/格式，不读取消息中的 localPath，也不请求 NUC 相对 imageUrl。`payloadEncoding=none` 记录为 image_payload_not_provided。

Kafka JSON 大小上限与解码后的图片上限分别配置。50,000,000 字节 JSON 消息能携带的原始图片小于此值（Base64 约增加 1/3）；consumer fetch 上限留有协议开销余量。大图应同步确认 broker/topic 允许的消息大小。日志不输出 Base64。当前保存所有有效图片及拒绝记录，未自动清理。

检查：打开 `/api/tool-images/latest` 查看接收状态。若 unavailable，检查 backend 到 broker 的网络、Kafka advertised listeners 和 topic 是否存在；仅端口可达不等于所有 broker 地址都可达。前端仍使用 `NEXT_PUBLIC_DATA_API_URL` 指向本 backend。真实 broker 联调需要所在网络可访问 172.20.114.237:9094。

## Wear history HTTP 接入（当前默认）

```dotenv
TOOL_WEAR_HISTORY_SOURCE=http
HISTORY_BASE_URL=http://172.20.114.237:4000
HISTORY_ENVIRONMENT=real
HISTORY_TIMEOUT_SECONDS=20
```

backend `/api/tool-wear/history` 转发至上游 `/api/history/fanuc_tool_wear`，指定 `format=json_record`、`downsampling=raw`，映射 `process_values.tool_wear_x_mm → xWearMm → Diameter wear` 和 `tool_wear_z_mm → zWearMm → Length wear`。仅表示 controller 补偿历史；未使用模型、mock 值或 demo 阈值。

默认单刀具，不传 tool_no，不筛掉 tool_no=null 的记录。机床默认 `SIGNALS_MACHINE_ID`，frontend 可用 `NEXT_PUBLIC_SIGNALS_MACHINE_ID` 指定。上方当前 wear/geometry/offset 仍读实时 controller 最新行，包括空刀具号行。图片 block 独立保持最新 Kafka 图片。

```http
GET /api/tool-wear/history?window_minutes=60&limit=2000
GET /api/tool-wear/history?machine_id=Makino_01&start=2026-11-04T00:00:00Z&end=2026-11-04T01:00:00Z&limit=2000
```

- 不传 start/end 时，以服务端当前 UTC 时间为终点，向前查询 window_minutes 分钟（默认 60）。直接查询历史 API。
- 显式时间使用带时区的 ISO 时间；范围 `[start,end)`。保留空 wear 值为 null（图表断线），保留负数和零。空刀具号不会丢掉或补成 T06。若 API 显式带 tool_no，只过滤其他非空刀具号，空号仍包含。
- frontend 两张图共享一个请求，默认最近 1 小时，可选 15 分钟/8 小时或自定义本地时间范围。每轮完成 5 秒后刷新，隐藏页面暂停，重新显示即刷新；不重叠请求。异常保留最后成功结果并提示，切换范围后不沿用旧图。
- backend 4 秒短缓存与并发查询锁减少重复请求；历史时间跨度仍受 TOOL_WEAR_MAX_RANGE_HOURS 限制。
- HTTP limit 最少 6、最多 TOOL_WEAR_MAX_POINTS。超过点数时覆盖整个窗口按桶保留首尾及 X/Z 极值，返回 downsampled=true 和 totalPoints，绝不只截取窗口最早一段。保留分段编号，使抽点后仍在缺失值和已知刀具号变化处断线；未知刀具号按单工具处理。未配置换刀实例，不推断同刀位换刀。
- 返回 data 点含 timestamp、timestampEpoch（毫秒）、toolNo（可为 null）、xWearMm、zWearMm、xSegment、zSegment，外层含 start/end、machine_id、environment、unit、totalPoints、downsampled、truncated=false。

`TOOL_WEAR_HISTORY_SOURCE=database` 可切回原 SQL adapter，此时仍需 tool_no、start、end 和 TOOL_WEAR_DB_* 配置；不自动在 HTTP 故障时切源。HTTP 方式不需要数据库账号。修改 backend 配置后重启，frontend 仍只访问自己的 backend。

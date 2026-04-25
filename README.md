# AgentSphere 桌面端

桌面版是 **壳 + 业务 UI + 本机能力** 的组合：界面在系统内置的 WebView 中运行，通过原生桥接访问本机资源；业务数据与对话能力全部来自你自行部署的 **AgentSphere 服务端**。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  桌面应用（安装包）                                            │
│  ┌──────────────┐    ┌─────────────────────────────────────┐ │
│  │  界面层       │    │  本机能力（仅客户端）                   │ │
│  │  会话 / Agent │    │  文件选择、浏览器自动化、Docker 等       │ │
│  │  技能 / 登录  │◄──►│  与对话流程中的「客户端工具」配合         │ │
│  └──────┬───────┘    └─────────────────────────────────────┘ │
│         │ HTTPS / HTTP（你配置的服务地址）                        │
│         ▼                                                      │
└─────────┼──────────────────────────────────────────────────────┘
          │
          ▼
   ┌──────────────┐
   │ AgentSphere  │  同一套后端 API 与网页端一致：Agent、聊天流、
   │ 服务端        │  技能、审批、通道等
   └──────────────┘
```

- **界面层**：负责登录、选 Agent、聊天、技能与审批等；不内置业务数据库，依赖远端服务。
- **本机能力**：在需要时执行仅能在用户电脑上完成的操作（例如打开本地文件、调用本机浏览器或容器），结果再回传给服务端继续编排。
- **服务端**：必须单独部署并保持可访问；桌面端只保存「连哪台服务器」，不替代后端。

### Tauri 构建报错：`failed to read plugin permissions` 且路径指向别的目录（如 `.../AgentSphere/.../target/...`）

**原因**：`tauri-build` 会读取依赖 `tauri` 在 **`target/debug/build/tauri-*/out/`** 里生成的权限文件列表，里面是**绝对路径**。若环境变量 **`CARGO_TARGET_DIR`** 指到了旧工程目录、或你曾在**同一套 `target/`** 下编过另一个路径下的工程，Cargo 可能复用那份产物，路径仍指向旧仓库（例如 `AgentSphere`）。

**处理**（在 `src-tauri` 目录执行）：

```bash
unset CARGO_TARGET_DIR
rm -rf target
cargo build
```

若 shell 或 IDE（含 rust-analyzer）里配置了 `CARGO_TARGET_DIR`，请删掉或改成不要指向其它项目的 `target`。本仓库已在 `src-tauri/.cargo/config.toml` 写明默认使用本目录下的 `target/`。

---

## 如何设置服务地址

### 含义

- 你填写的是 **站点根地址**（与浏览器里打开 Web 控制台时的 **协议 + 主机 + 端口**，一般 **不要** 带末尾路径如 `/api/v1`）。
- 应用会在其后面自动拼接 API 前缀：`{你填的地址}/api/v1/...`（例如鉴权、聊天流、Agent 列表等）。

**示例**

| 场景 | 应填写的「服务器地址」 |
|------|------------------------|
| 本机默认后端 | `http://localhost:8080` |
| 局域网或域名 | `https://sya.example.com` |
| 带端口 | `http://192.168.1.10:8080` |

### 公网试用与私有化部署

- **公网测试地址**（便于联调桌面端与网页端；**勿存放敏感数据或当作生产环境**）：  
  `http://101.132.184.142:8080`  
  在「服务器设置」中填入该根地址即可（与上表规则相同，不带 `/api/v1`）。

- **私有化部署**：可自行拉取容器镜像部署服务端，例如：  
  `ghcr.nju.edu.cn/fisker086/sya:latest`  

#### 本机用 Docker Compose 启动服务端（联调桌面端）

在 **仓库根目录**（与 `docker-compose.yml`、`.env.example` 同级，不是 `AgentSphere/` 子目录）操作。

1. **准备 `.env`**：将 **`.env.example` 复制一份并命名为 `.env`**（保留 `.env.example` 作为模板，不要只做重命名以免丢失示例）。用编辑器打开 `.env`，填写至少 **`JWT_SECRET_KEY`**、**`OPENAI_API_KEY`**、**`ADMIN_DEFAULT_PASSWORD`** 等（见下表与根目录 `README.md`）。
2. **启动**（默认自带 PostgreSQL + pgvector）：

```bash
docker compose pull
docker compose up -d
```

3. 桌面端「服务器地址」填 **`http://localhost:8080`**（与 `.env` 里 `SERVER_PORT` 一致）。

更完整的步骤见仓库根目录 **`README.md`**。

以下为服务端进程会读取的环境变量（与仓库根目录 `.env.example`、`docker-compose.yml` 一致；`docker run`/编排时传入等价配置即可）。

#### 私有化部署：环境变量一览

**建议生产至少配置**

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串（需支持 pgvector 时选带扩展的实例/镜像）。空则不落库，不适合生产。 |
| `JWT_SECRET_KEY` | JWT 签名密钥，**务必**改为强随机串（如 `openssl rand -hex 32`）。 |
| `ADMIN_DEFAULT_PASSWORD` | **仅当用户表为空**时用于种子管理员密码；生产必须改为强密码。 |
| `OPENAI_API_KEY` | `MODEL_TYPE=openai` 时对话模型 API Key（或兼容 OpenAI 的网关）。 |

**对话模型（`MODEL_TYPE=openai` 时）**

| 变量 | 默认 | 说明 |
|------|------|------|
| `MODEL_TYPE` | `openai` | 设为 `ark` 时改用下方 `ARK_*`。 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 模型名。 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 兼容网关基地址。 |
| `OPENAI_BY_AZURE` | `false` | Azure OpenAI 时置 `true`。 |

**火山方舟（`MODEL_TYPE=ark` 时）**

| 变量 | 说明 |
|------|------|
| `ARK_API_KEY` | 方舟 API Key。 |
| `ARK_MODEL` | 模型名。 |
| `ARK_BASE_URL` | API 基地址。 |

**嵌入与长期记忆**

| 变量 | 默认 | 说明 |
|------|------|------|
| `MEMORY_PROVIDER` | `pgvector` | 长期记忆；可 `none` 等关闭语义以代码为准。 |
| `MEMORY_RETRIEVE_TOP_K` | `8` | 检索条数。 |
| `EMBEDDING_API_KEY` | 空 | 与嵌入服务一致；空时部分能力降级。 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 嵌入模型名。 |
| `EMBEDDING_BASE_URL` | `https://api.openai.com/v1` | 嵌入 API 基地址。 |
| `EMBEDDING_DIMENSION` | `1536` | 向量维度，需与库表一致。 |

**服务与路径**

| 变量 | 默认 | 说明 |
|------|------|------|
| `SERVER_PORT` | `8080` | HTTP 端口。 |
| `SKILLS_DIR` | `./skills` | 技能目录；官方镜像内一般为 `/app/skills`。 |
| `UPLOAD_DIR` | `uploads` | 上传目录；Compose 常为 `/app/data/uploads` 并挂卷。 |

**鉴权与管理员**

| 变量 | 说明 |
|------|------|
| `ADMIN_WHITELIST` | 逗号分隔用户名；空库种子时与默认管理员相关；非空库启动时可将名单用户提升为管理员。 |

**可观测性（可选）**

| 变量 | 说明 |
|------|------|
| `LANGFUSE_PUBLIC_KEY` | Langfuse 公钥。 |
| `LANGFUSE_SECRET_KEY` | Langfuse 密钥。 |
| `LANGFUSE_HOST` | 默认 `https://cloud.langfuse.com`。 |


**使用 Docker Compose 时（默认带内置 Postgres）**

| 变量 | 说明 |
|------|------|
| `POSTGRES_USER` | 内置库用户名（默认 `postgres`）。 |
| `POSTGRES_PASSWORD` | 内置库密码。 |
| `POSTGRES_DB` | 库名（默认 `sya`）。 |

未在 `.env` 中设置 `DATABASE_URL` 时，应用使用默认连接串指向服务名 `postgres`；若使用**外部数据库**，在 `.env` 中设置 `DATABASE_URL` 覆盖即可（高级场景若需不启动内置 Postgres，可用 compose override）。

**示例（shell 中 export，再启动容器/进程）**

```bash
export DATABASE_URL='postgres://user:pass@host:5432/sya?sslmode=disable'
export JWT_SECRET_KEY="$(openssl rand -hex 32)"
export OPENAI_API_KEY='sk-...'
export ADMIN_DEFAULT_PASSWORD='your-strong-password'
export ADMIN_WHITELIST='admin'
# 按需：OPENAI_BASE_URL、MEMORY_PROVIDER、EMBEDDING_* 等
```

更细的默认值与行为说明见仓库根目录 `README.md`。

### 在哪里改

1. **登录界面**：使用「服务器设置」入口，输入根地址并保存后再登录（与网页端使用同一后端时，地址应一致）。
2. **持久化位置**：保存后会写入本机配置文件（JSON），并同步到应用内本地存储；下次启动会优先读取配置文件中的地址。

**配置文件路径**（应用内若提供「查看配置路径」可核对）：
- **Windows**：一般在 `%APPDATA%\sya\config.json`（即「用户\AppData\Roaming\sya\config.json」）。

- **macOS**：一般在 `~/Library/Application Support/sya/config.json`。

文件中的 `server_url` 字段即为当前保存的根地址。

### 默认值

未配置时使用：`http://localhost:8080`（需本机已启动 AgentSphere 服务端且端口一致）。


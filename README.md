# YouTube2Podcast

把正在看的 YouTube 视频加入私人播客，用播客 App 随时收听。

个人自用：Chrome 插件提交链接，本机（或一台 Docker）上的服务用 yt-dlp 拉音轨，通过带密钥的 RSS 订阅。

## 它做什么

- 在 YouTube 页面打开侧边栏，点「添加到播客」。
- 服务端排队下载（优先 `.m4a` 音轨），写入本地 SQLite 和文件。
- 插件会把当前 Chrome 的 YouTube 登录态同步到服务端，减少机器人检测。
- 服务端下载失败时，可在插件里「本地提取」再上传。
- 播客 App 订阅 RSS 收听。

不经过 Vercel、Supabase 或第三方音频 API。管理全部在插件里完成。

## 组成

| 部分 | 位置 | 作用 |
| --- | --- | --- |
| 服务端 | `apps/server` | HTTP API、yt-dlp 任务队列、SQLite、RSS、媒体文件 |
| Chrome 插件 | `apps/extension` | 侧边栏提交、同步登录态、看任务、本地提取 |

数据默认在服务进程工作目录下的 `data/`（SQLite `y2p.db`、音频、封面、`cookies.txt`）。

## 环境要求

- Node.js **22.5+**，[pnpm](https://pnpm.io) 9
- [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) 在 `PATH` 上，或用 `YTDLP_PATH` 指向可执行文件
- 建议用 **官方独立二进制**，不要用缺 ejs 求解器的 pip 包，否则容易 `n challenge solving failed`、下不到 `.m4a`

## 本地运行

仓库根目录：

```bash
pnpm install
cp .env.example .env
```

编辑 `.env`：

```txt
RSS_TOKEN=请换成足够长的随机串
PUBLIC_BASE_URL=http://localhost:8080
PORT=8080
```

`RSS_TOKEN` 同时用于两件事：插件请求管理接口（`Authorization: Bearer`），以及 RSS / 音频地址里的密钥。订阅地址是 `http://localhost:8080/rss/<RSS_TOKEN>.xml`，拿到它的人就能听你的节目。若 `.env` 里还留着旧的 `ADMIN_TOKEN`、且未设 `RSS_TOKEN`，会暂时沿用 `ADMIN_TOKEN`。

服务端会从当前目录或仓库根读取 `.env`。`pnpm dev` 的工作目录是 `apps/server`，数据默认写到 `apps/server/data/`。

启动服务（默认 `:8080`）：

```bash
pnpm dev
```

### 安装插件

```bash
pnpm build:extension
```

Chrome 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `apps/extension/dist`。

侧边栏设置里填写：

- 服务端：`http://localhost:8080`（未保存过时会预填）
- RSS Token：与 `.env` 里相同

点「连接」。成功后会显示「已连接」和订阅地址。首次进入若尚未连接，设置会保持展开，「添加到播客」不可用。

开发时改插件源码后重新 `pnpm build:extension`（或 `pnpm --filter @youtube2podcast/extension dev` 监听构建），再在扩展页点刷新。

## 用 Cloudflare Tunnel 暴露外网（推荐）

插件连服务端可以一直用本机 `http://localhost:8080`。手机上的播客 App 访问不到 `localhost`，RSS 和音频必须是外网 HTTPS。本地部署推荐 [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)，不用公网 IP、不用开端口。

前提：有一个域名，且已接入 Cloudflare（Nameserver 指向 Cloudflare）。没有域名时可用文末的临时地址试听，不能当长期订阅。

macOS：

```bash
brew install cloudflared
```

其他系统见 [cloudflared 安装](https://developers.cloudflare.com/tunnel/downloads/)。然后：

```bash
cloudflared tunnel login
cloudflared tunnel create y2p
cloudflared tunnel route dns y2p podcast.example.com
cloudflared tunnel run --url http://localhost:8080 y2p
```

`login` 会打开浏览器，选中要用来解析的那个域名。把 `podcast.example.com` 换成你的子域名。隧道进程要一直开着，本机 `8080` 也要在跑。

`.env` 里改成隧道域名（`https`、不要末尾斜杠），然后重启服务端：

```txt
PUBLIC_BASE_URL=https://podcast.example.com
```

插件里「服务端」仍填 `http://localhost:8080`。订阅地址用外网：

```txt
https://podcast.example.com/rss/<RSS_TOKEN>.xml
```

只想先通一下、没有域名时：

```bash
cloudflared tunnel --url http://localhost:8080
```

会打印一个 `https://xxxx.trycloudflare.com`。把它写进 `PUBLIC_BASE_URL` 并重启服务。这个地址每次启动都会变，只适合临时试。

## Docker

仓库根目录：

```bash
docker compose -f apps/server/docker-compose.example.yml up --build
```

镜像内已带官方 yt-dlp 与 ffmpeg，数据挂在 compose 文件旁的 `apps/server/data`。请改掉示例里的 `RSS_TOKEN`，`PUBLIC_BASE_URL` 填隧道 HTTPS 域名（同上）。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `RSS_TOKEN` | 是 | 插件管理接口鉴权，也是 RSS 与媒体 URL 中的密钥 |
| `PUBLIC_BASE_URL` | 是 | 写入 RSS 的根地址；本地部署填隧道 HTTPS 域名 |
| `PORT` | 否 | 默认 `8080` |
| `DATA_DIR` | 否 | 默认进程 cwd 下的 `data/`；容器内为 `/data` |
| `YTDLP_PATH` | 否 | 默认 `yt-dlp`（走 PATH）；容器内为 `/opt/ytdlp/yt-dlp` |
| `YTDLP_COOKIES_FILE` | 否 | 不配则用 `DATA_DIR/cookies.txt`（由插件 `PUT /api/cookies` 写入） |

## 使用注意

- 不要把 `RSS_TOKEN` 写进截图或公开仓库。
- RSS 地址等于订阅口令，泄露后应轮换 `RSS_TOKEN`（旧链接里的媒体路径仍可能被直接打开）。
- YouTube 常要求登录态；公开视频也可能触发机器人检测，需要插件同步 cookie。
- 本项目仅供个人存档自己有权收听的内容。

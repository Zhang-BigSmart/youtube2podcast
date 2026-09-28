# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @youtube2podcast/server build

FROM node:24-slim AS runtime
WORKDIR /app

# 从 GitHub 拉取静态 ffmpeg/ffprobe 与 yt-dlp，避开 Debian apt 与 Docker Hub
COPY <<'EOF' /tmp/fetch-bins.mjs
import { writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const ffmpegTag = 'b6.1.1'

/**
 * 用途：下载 gzip 包装的二进制并解压落到 dest。
 * 入参：url 为 GitHub release 资源；dest 为容器内可执行路径。
 * 返回值：无。
 * 异常：HTTP 非 2xx 时抛错。
 */
async function saveGunzip(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  writeFileSync(dest, gunzipSync(Buffer.from(await res.arrayBuffer())), { mode: 0o755 })
}

await saveGunzip(
  `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegTag}/ffmpeg-linux-${arch}.gz`,
  '/usr/local/bin/ffmpeg'
)
await saveGunzip(
  `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegTag}/ffprobe-linux-${arch}.gz`,
  '/usr/local/bin/ffprobe'
)

const ytdlpFile = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
const ytdlp = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpFile}`)
if (!ytdlp.ok) throw new Error(`yt-dlp download ${ytdlp.status} ${ytdlpFile}`)
writeFileSync('/opt/ytdlp/yt-dlp', Buffer.from(await ytdlp.arrayBuffer()), { mode: 0o755 })
EOF
RUN mkdir -p /opt/ytdlp /data && node /tmp/fetch-bins.mjs && rm /tmp/fetch-bins.mjs

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --filter @youtube2podcast/server --prod

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/public ./apps/server/public

RUN chown -R node:node /app /data /opt/ytdlp
USER node
WORKDIR /app/apps/server
ENV DATA_DIR=/data
ENV YTDLP_PATH=/opt/ytdlp/yt-dlp
ENV PORT=8080
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]

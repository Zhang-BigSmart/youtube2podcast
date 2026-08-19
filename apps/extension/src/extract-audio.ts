import { Innertube, UniversalCache } from 'youtubei.js/web'
import type { Types } from 'youtubei.js/web'
import { boundFetch } from './eval-bridge'
import { parseVideoId } from './youtube-id'

type InnerTubeClient = Types.InnerTubeClient
type VideoInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>
type Format = NonNullable<NonNullable<VideoInfo['streaming_data']>['formats']>[number]

const CLIENTS: InnerTubeClient[] = ['ANDROID', 'WEB', 'MWEB', 'IOS', 'TV']
const AUDIO_ITAGS = [140, 139, 251, 250, 249]
const MUXED_ITAGS = [18]

export type ExtractedMetadata = {
  videoId: string
  youtubeUrl: string
  title: string
  description: string
  channelTitle: string
  durationSeconds: number
  thumbnailUrl: string | null
}

export type ExtractedAudio = {
  blob: Blob
  mimeType: string
  fileName: string
  itag: number
  client: InnerTubeClient
  hasVideo: boolean
  byteLength: number
}

export type ExtractProgress = (message: string, receivedBytes?: number, totalBytes?: number) => void

type DownloadedPick = {
  client: InnerTubeClient
  info: VideoInfo
  format: Format
  blob: Blob
}

/**
 * 按客户端和 itag 顺序尝试下载，140 这类纯音频 403 时降级到 itag 18。
 * 拿到可播的 basic_info 后立刻回调元数据，便于先渲染封面。
 * @param yt Innertube 实例
 * @param videoId 视频 ID
 * @param youtubeUrl 原始链接
 * @param onProgress 探测与下载进度
 * @param onMetadata 首次拿到标题/封面时回调
 * @returns 成功的客户端、VideoInfo、format 与音频 Blob
 * @throws 全部失败时抛出汇总错误
 */
async function pickAndDownload(
  yt: Innertube,
  videoId: string,
  youtubeUrl: string,
  onProgress: ExtractProgress,
  onMetadata?: (metadata: ExtractedMetadata) => void
): Promise<DownloadedPick> {
  const errors: string[] = []
  let metadataSent = false
  for (const client of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client })
      const status = info.playability_status?.status
      if (status && status !== 'OK') {
        errors.push(`${client}: playability ${status}`)
        onProgress(`${client} 不可播：${status}`)
        continue
      }
      if (!metadataSent) {
        onMetadata?.(toMetadata(videoId, youtubeUrl, info))
        metadataSent = true
      }
      const candidates = listDownloadableFormats(info)
      if (!candidates.length) {
        errors.push(`${client}: 没有可解密的音轨 URL`)
        onProgress(`${client} 没有可下载音轨（可能是 SABR）`)
        continue
      }
      for (const format of candidates) {
        try {
          onProgress(
            `尝试 ${client} itag ${format.itag}（${format.mime_type}）`,
            0,
            format.content_length
          )
          const blob = await downloadFormat(yt, info, format, onProgress)
          return { client, info, format, blob }
        } catch (error) {
          const message = formatUnknownError(error)
          errors.push(`${client} itag ${format.itag}: ${message}`)
          onProgress(`${client} itag ${format.itag} 失败：${message}`)
        }
      }
    } catch (error) {
      const message = formatUnknownError(error)
      errors.push(`${client}: ${message}`)
      onProgress(`${client} 失败：${message}`)
    }
  }
  throw new Error(`没有可用音轨：${errors.join('；')}`)
}

/**
 * 按优先顺序列出带直链或 cipher 的音轨。
 * @param info getBasicInfo 结果
 * @returns 可尝试下载的 format 列表
 */
function listDownloadableFormats(info: VideoInfo): Format[] {
  const adaptive = info.streaming_data?.adaptive_formats ?? []
  const muxed = info.streaming_data?.formats ?? []
  const all = [...adaptive, ...muxed]
  const picked: Format[] = []
  for (const itag of [...AUDIO_ITAGS, ...MUXED_ITAGS]) {
    const format = all.find((item) => item.itag === itag && item.has_audio && hasDownloadSource(item))
    if (format) {
      picked.push(format)
    }
  }
  return picked
}

/**
 * decipher 后直下 googlevideo，不带 cookie（credentials: omit）。
 * @param yt 用于取 player 做 nsig
 * @param info 提供 cpn
 * @param format 选中的音轨
 * @param onProgress 字节进度
 * @returns 音频/muxed Blob
 * @throws googlevideo 非 2xx 或无法 decipher
 */
async function downloadFormat(
  yt: Innertube,
  info: VideoInfo,
  format: Format,
  onProgress: ExtractProgress
): Promise<Blob> {
  const player = yt.session.player
  if (!player) {
    throw new Error('Innertube player 未就绪，无法 decipher')
  }
  const deciphered = await format.decipher(player)
  const url = info.cpn ? `${deciphered}&cpn=${info.cpn}` : deciphered
  const response = await globalThis.fetch(url, {
    credentials: 'omit',
    redirect: 'follow',
    headers: {
      accept: '*/*',
      referer: 'https://www.youtube.com/'
    }
  })
  if (!response.ok) {
    throw new Error(`googlevideo ${response.status} host=${new URL(url).host}`)
  }
  const stream = response.body
  if (!stream) {
    throw new Error('googlevideo 没有响应体')
  }
  return streamToBlob(stream, format.mime_type, (received) => {
    onProgress('正在下载', received, format.content_length)
  })
}

/**
 * 把 youtubei.js / fetch 错误收成短文本，尽量带上 HTTP 状态。
 * @param error 捕获的异常
 */
function formatUnknownError(error: unknown): string {
  if (error && typeof error === 'object' && 'info' in error) {
    const response = (error as { info?: { response?: Response } }).info?.response
    if (response) {
      const message = error instanceof Error ? error.message : '请求失败'
      return `${message} (${response.status})`
    }
  }
  return error instanceof Error ? error.message : String(error)
}

let innertubePromise: Promise<Innertube> | null = null

/**
 * 懒创建 Innertube 会话。必须先 installYoutubeiEval。
 * cookie 来自浏览器 youtube.com 真实登录态，供 SAPISIDHASH；Cookie 头由 DNR 注入。
 * @returns 可复用的 Innertube 实例
 */
function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = createInnertube()
  }
  return innertubePromise
}

/**
 * 读取本机 YouTube cookie 并创建 Innertube。
 * @returns Innertube 实例
 */
async function createInnertube(): Promise<Innertube> {
  const cookie = await readYoutubeCookieString()
  return Innertube.create({
    generate_session_locally: true,
    cache: new UniversalCache(false),
    fetch: boundFetch,
    cookie: cookie || undefined
  })
}

/**
 * 读取浏览器里 youtube.com 的真实 cookie。
 * @returns Cookie 头格式字符串；没有 cookie 时为空串
 */
async function readYoutubeCookieString(): Promise<string> {
  const cookies = await chrome.cookies.getAll({ domain: 'youtube.com' })
  return cookies.map((item) => `${item.name}=${item.value}`).join('; ')
}

/** 提取过程回调：进度文本/字节，以及首次拿到的元数据。 */
export type ExtractHooks = {
  onProgress: ExtractProgress
  onMetadata?: (metadata: ExtractedMetadata) => void
}

/**
 * 用 youtubei.js 拉取元数据并下载可用音轨。
 * 优先纯音频 itag（140 等），否则降级 muxed itag 18。
 * @param youtubeUrl 用户输入的 YouTube 链接或视频 ID
 * @param hooks 进度与元数据回调
 * @returns 元数据 + 音频 Blob
 * @throws 无法解析 ID、所有客户端都拿不到可下载地址、或 googlevideo 非 2xx
 */
export async function extractFromYoutube(
  youtubeUrl: string,
  hooks: ExtractHooks
): Promise<{ metadata: ExtractedMetadata; audio: ExtractedAudio }> {
  const videoId = parseVideoId(youtubeUrl)
  hooks.onProgress('使用本机 YouTube cookie 请求 InnerTube')
  const yt = await getInnertube()
  hooks.onProgress(`已解析视频 ID ${videoId}，开始探测客户端`)

  const picked = await pickAndDownload(yt, videoId, youtubeUrl, hooks.onProgress, hooks.onMetadata)
  const metadata = toMetadata(videoId, youtubeUrl, picked.info)
  const hasVideo = Boolean(picked.format.has_video)
  const ext = hasVideo ? 'mp4' : mimeToExt(picked.format.mime_type)
  return {
    metadata,
    audio: {
      blob: picked.blob,
      mimeType: picked.format.mime_type.split(';')[0] || 'application/octet-stream',
      fileName: `${sanitizeFileName(metadata.title || videoId)}.${ext}`,
      itag: picked.format.itag,
      client: picked.client,
      hasVideo,
      byteLength: picked.blob.size
    }
  }
}

/**
 * 判断 format 是否带 URL 或 cipher（SABR 只有标识、没有这两种字段）。
 * @param format youtubei.js Format
 */
function hasDownloadSource(format: Format): boolean {
  return Boolean(format.url || format.signature_cipher || format.cipher)
}

/**
 * 把 VideoInfo.basic_info 收成服务端 import 将使用的字段。
 * @param videoId 视频 ID
 * @param youtubeUrl 原始输入
 * @param info youtubei.js VideoInfo
 */
function toMetadata(videoId: string, youtubeUrl: string, info: VideoInfo): ExtractedMetadata {
  const basic = info.basic_info
  const thumbnails = basic.thumbnail ?? []
  const bestThumb = [...thumbnails].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  return {
    videoId,
    youtubeUrl,
    title: basic.title || videoId,
    description: basic.short_description || '',
    channelTitle: basic.author || basic.channel?.name || '',
    durationSeconds: basic.duration || 0,
    thumbnailUrl: bestThumb?.url ?? null
  }
}

/**
 * 把 ReadableStream 收成 Blob，并回报已收字节。
 * @param stream googlevideo 响应流
 * @param mimeType format.mime_type
 * @param onBytes 已下载字节数
 */
async function streamToBlob(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onBytes: (received: number) => void
): Promise<Blob> {
  const reader = stream.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value as BlobPart)
    received += value.byteLength
    onBytes(received)
  }
  const type = mimeType.split(';')[0] || 'application/octet-stream'
  return new Blob(chunks, { type })
}

/**
 * 按 MIME 选文件后缀。
 * @param mimeType format.mime_type
 */
function mimeToExt(mimeType: string): string {
  if (mimeType.includes('webm')) {
    return 'webm'
  }
  if (mimeType.includes('mp4')) {
    return 'm4a'
  }
  if (mimeType.includes('mpeg')) {
    return 'mp3'
  }
  return 'bin'
}

/**
 * 去掉文件名非法字符。
 * @param name 标题
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'audio'
}

import type { AudioProvider, AudioProviderResult } from './types.js'

const YT15_HOST = 'youtube-to-mp315.p.rapidapi.com'
const DOWNLOAD_INFO_HOST = 'youtube-download-info-api.p.rapidapi.com'
const YT15_POLL_INTERVAL_MS = 2000
const YT15_POLL_MAX_ATTEMPTS = 15
const DOWNLOAD_INFO_POLL_INTERVAL_MS = 3000
const DOWNLOAD_INFO_POLL_MAX_ATTEMPTS = 40

type JsonObject = Record<string, unknown>

type Yt15StatusResponse = {
  id?: string
  downloadUrl?: string
  status?: string
  format?: string
  title?: string
}

/**
 * 用途：组装 RapidAPI 公共请求头。
 * 入参：账号级 API Key，以及目标 API 的 Host。
 * 返回值：含 X-RapidAPI-Key / X-RapidAPI-Host 的 HeadersInit。
 */
function rapidApiHeaders(apiKey: string, host: string): HeadersInit {
  return {
    'X-RapidAPI-Key': apiKey,
    'X-RapidAPI-Host': host
  }
}

/**
 * 用途：Worker 内短等待，供主供应商状态轮询。
 * 入参：毫秒。
 * 返回值：无。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 用途：把供应商声明的格式映射为 RSS / Blob 使用的 MIME。
 * 入参：format 字符串，如 m4a、MP3。
 * 返回值：audio/mp4 或 audio/mpeg。
 */
function mimeFromFormat(format: string | undefined): string {
  const normalized = (format ?? '').toLowerCase()
  if (normalized === 'm4a' || normalized === 'mp4' || normalized === 'aac') {
    return 'audio/mp4'
  }
  return 'audio/mpeg'
}

/**
 * 用途：从松散 JSON 里取出第一个 http(s) 下载地址。
 * 入参：任意 JSON 值。
 * 返回值：URL 或 null。
 * 边界：备用 API 未公开稳定字段名，因此按常见键名和一层嵌套探测。
 */
function pickDownloadUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as JsonObject
  const keys = ['downloadUrl', 'download_url', 'file', 'file_url', 'audioUrl', 'audio_url', 'link', 'url']
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  }
  for (const nestedKey of ['data', 'result', 'payload']) {
    const nested = pickDownloadUrl(obj[nestedKey])
    if (nested) return nested
  }
  return null
}

function asObject(data: unknown): JsonObject {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : {}
}

function pickString(obj: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
}

function pickNumber(obj: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
}

/**
 * 用途：把非 2xx 响应转成带正文摘要的错误。
 * 入参：fetch Response、供应商名。
 * 返回值：永不正常返回，总是 throw。
 */
async function throwHttpError(response: Response, provider: string): Promise<never> {
  const body = await response.text()
  throw new Error(`${provider} failed with HTTP ${response.status}: ${body.slice(0, 300)}`)
}

/**
 * 主供应商：RapidAPI youtube-to-mp315。
 * 用途：请求 m4a；若返回 CONVERTING 则轮询 /status/:id。
 * 入参：RapidAPI Key。extract 入参为 YouTube URL。
 * 返回值：含临时 downloadUrl 的 AudioProviderResult。
 * 异常：HTTP 失败、CONVERSION_ERROR、轮询超时或缺少 downloadUrl 时抛错。
 * 边界：链接约 1 小时过期；最长轮询约 30 秒后放弃，交由备用供应商。
 */
export class YoutubeToMp315Provider implements AudioProvider {
  constructor(private readonly apiKey: string) {}

  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    // 供应商后端已改为从查询参数取值（JSON body 会报 400 缺 url），文档未更新。
    const endpoint = new URL(`https://${YT15_HOST}/download`)
    endpoint.searchParams.set('url', youtubeUrl)
    endpoint.searchParams.set('format', 'm4a')
    endpoint.searchParams.set('quality', '0')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: rapidApiHeaders(this.apiKey, YT15_HOST)
    })

    if (!response.ok) {
      await throwHttpError(response, 'rapidapi-yt15')
    }

    const data = await response.json() as Yt15StatusResponse
    const resolved = await this.resolveAvailable(data)
    if (!resolved.downloadUrl) {
      throw new Error('rapidapi-yt15 response missing downloadUrl')
    }

    return {
      provider: 'rapidapi-yt15',
      title: resolved.title,
      audioDownloadUrl: resolved.downloadUrl,
      audioMimeType: mimeFromFormat(resolved.format ?? 'm4a')
    }
  }

  /**
   * 用途：把 CONVERTING 状态轮询到 AVAILABLE。
   * 入参：首次 /download 的 JSON。
   * 返回值：带 downloadUrl 的最终状态。
   * 异常：CONVERSION_ERROR、缺少 id、超过轮询次数时抛错。
   */
  private async resolveAvailable(initial: Yt15StatusResponse): Promise<Yt15StatusResponse> {
    let current = initial
    for (let attempt = 0; attempt < YT15_POLL_MAX_ATTEMPTS; attempt += 1) {
      const status = (current.status ?? '').toUpperCase()
      if (status === 'AVAILABLE' && current.downloadUrl) return current
      if (status === 'CONVERSION_ERROR') {
        throw new Error('rapidapi-yt15 conversion error')
      }
      if (status === 'EXPIRED') {
        throw new Error('rapidapi-yt15 download link expired')
      }
      if (!current.id) {
        throw new Error('rapidapi-yt15 converting without job id')
      }

      await sleep(YT15_POLL_INTERVAL_MS)
      const statusResponse = await fetch(`https://${YT15_HOST}/status/${current.id}`, {
        headers: rapidApiHeaders(this.apiKey, YT15_HOST)
      })
      if (!statusResponse.ok) {
        await throwHttpError(statusResponse, 'rapidapi-yt15')
      }
      current = await statusResponse.json() as Yt15StatusResponse
    }

    throw new Error('rapidapi-yt15 conversion timed out')
  }
}

/**
 * 备用供应商：RapidAPI YouTube Download & Info。
 * 用途：主供应商失败后请求 m4a。实际契约为异步任务：首次返回
 *       { success, id, image, progress_url }，需轮询 progress_url 直到出现下载地址。
 * 入参：RapidAPI Key。extract 入参为 YouTube URL。
 * 返回值：轮询拿到直链的 AudioProviderResult；兼容直接返回直链或音频正文的旧行为。
 * 异常：HTTP 失败、任务报错（success=0，如 text=download_error）、轮询超时时抛错。
 * 边界：progress_url 是供应商外部地址，无需 RapidAPI 头；最长轮询约 120 秒。
 */
export class YoutubeDownloadInfoProvider implements AudioProvider {
  constructor(private readonly apiKey: string) {}

  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    const endpoint = new URL(`https://${DOWNLOAD_INFO_HOST}/api/download`)
    endpoint.searchParams.set('format', 'm4a')
    endpoint.searchParams.set('url', youtubeUrl)

    const response = await fetch(endpoint, {
      headers: rapidApiHeaders(this.apiKey, DOWNLOAD_INFO_HOST)
    })

    if (!response.ok) {
      await throwHttpError(response, 'rapidapi-download-info')
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json') || contentType.includes('text/json')) {
      const data: unknown = await response.json()
      const obj = asObject(data)

      let url = pickDownloadUrl(data)
      if (!url) {
        const progressUrl = pickString(obj, ['progress_url', 'progressUrl'])
        if (!progressUrl) {
          throw new Error(`rapidapi-download-info JSON missing download url: ${JSON.stringify(data).slice(0, 300)}`)
        }
        url = await this.pollProgress(progressUrl)
      }

      return {
        provider: 'rapidapi-download-info',
        title: pickString(obj, ['title', 'name']),
        channelTitle: pickString(obj, ['channelTitle', 'channel', 'uploader']),
        thumbnailUrl: pickString(obj, ['thumbnail', 'thumbnailUrl', 'thumbnail_url', 'image']),
        durationSeconds: pickNumber(obj, ['durationSeconds', 'duration_seconds', 'duration', 'lengthSeconds']),
        audioDownloadUrl: url,
        audioMimeType: mimeFromFormat(pickString(obj, ['format', 'ext']) ?? 'm4a'),
        audioFileSize: pickNumber(obj, ['fileSize', 'file_size', 'filesize', 'contentLength'])
      }
    }

    if (contentType.startsWith('audio/') || contentType.includes('octet-stream')) {
      const audioBytes = await response.arrayBuffer()
      if (audioBytes.byteLength === 0) {
        throw new Error('rapidapi-download-info returned empty audio body')
      }
      return {
        provider: 'rapidapi-download-info',
        audioBytes,
        audioMimeType: contentType.startsWith('audio/') ? contentType.split(';')[0] : 'audio/mp4',
        audioFileSize: audioBytes.byteLength
      }
    }

    throw new Error(`rapidapi-download-info unexpected content-type: ${contentType || 'empty'}`)
  }

  /**
   * 用途：轮询 progress_url 直到转换完成并返回下载地址。
   * 入参：首次响应里的 progress_url（供应商外部地址，直接 GET，无需鉴权头）。
   * 返回值：可下载的音频直链。
   * 异常：HTTP 失败、任务失败（success 为 0/false，如 text=download_error）、超过轮询次数时抛错。
   */
  private async pollProgress(progressUrl: string): Promise<string> {
    for (let attempt = 0; attempt < DOWNLOAD_INFO_POLL_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetch(progressUrl)
      if (!response.ok) {
        await throwHttpError(response, 'rapidapi-download-info progress')
      }

      const data: unknown = await response.json()
      const url = pickDownloadUrl(data)
      if (url) return url

      const obj = asObject(data)
      if (obj.success === 0 || obj.success === false) {
        const text = pickString(obj, ['text', 'message', 'error']) ?? 'unknown error'
        throw new Error(`rapidapi-download-info progress failed: ${text}`)
      }

      await sleep(DOWNLOAD_INFO_POLL_INTERVAL_MS)
    }

    throw new Error('rapidapi-download-info progress timed out')
  }
}

/**
 * 用途：主供应商失败后自动改走备用，避免单点失效。
 * 入参：primary 为主、fallback 为备。
 * 返回值：先成功的那一家结果。
 * 异常：两家都失败时抛出聚合错误，包含双方原因。
 * 边界：只在 extract 阶段切换；Blob 转存失败不会再试另一家。
 */
export class FailoverAudioProvider implements AudioProvider {
  constructor(
    private readonly primary: AudioProvider,
    private readonly fallback: AudioProvider
  ) {}

  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    try {
      return await this.primary.extract(youtubeUrl)
    } catch (primaryError) {
      try {
        return await this.fallback.extract(youtubeUrl)
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        throw new Error(`primary failed: ${primaryMessage}; fallback failed: ${fallbackMessage}`)
      }
    }
  }
}

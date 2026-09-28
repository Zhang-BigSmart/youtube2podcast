import { deleteTempAudio, getTempAudio, updateTempCover, type TempAudioRecord } from './temp-store'

const SETTINGS_KEY = 'y2p.server'
const DEFAULT_SERVER_URL = 'http://localhost:8080'
const CHUNK_RETRY_DELAYS_MS = [1000, 4000, 16000]

export type ServerSettings = {
  baseUrl: string
  adminToken: string
}

export type SyncProgress = (message: string, received?: number, total?: number) => void

export type RemoteJob = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: string
  error_kind: string | null
  error_message: string | null
  source: string
  episode_id: string | null
  progress_downloaded?: number | null
  progress_total?: number | null
}

type InitResponse = {
  uploadId?: string
  chunkSize?: number
  totalChunks?: number
  received?: number[]
  alreadyExists?: boolean
  episodeId?: string
}

type CompleteResponse = {
  path?: string
  size?: number
}

type ImportResponse = {
  episodeId?: string
  alreadyExists?: boolean
}

type MetaResponse = {
  version?: string
  rssUrl?: string
}

/**
 * 用途：读取侧边栏保存的服务端地址与 RSS Token。
 * 入参：无。
 * 返回值：已保存的配置；未保存过地址时默认 http://localhost:8080。
 * 异常：无。
 */
export async function loadServerSettings(): Promise<ServerSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  const value = stored[SETTINGS_KEY] as ServerSettings | undefined
  return {
    baseUrl: value?.baseUrl?.trim() || DEFAULT_SERVER_URL,
    adminToken: value?.adminToken ?? ''
  }
}

/**
 * 用途：把服务端地址与 Token 写入 chrome.storage.local。
 * 入参：baseUrl、adminToken。
 * 返回值：无。
 * 异常：无。
 */
export async function saveServerSettings(settings: ServerSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

/**
 * 用途：校验配置并立刻申请主机权限（须在点击的同步栈里尽早调用，避免丢失 user gesture）。
 * 入参：用户填写的地址和 Token。
 * 返回值：规范化后的根 URL。
 * 异常：缺配置、地址非法、或用户拒绝授权。
 */
export async function assertServerAccess(settings: ServerSettings): Promise<string> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  if (!baseUrl || !adminToken) {
    throw new Error('请填写服务端地址和 RSS Token')
  }
  await ensureHostAccess(baseUrl)
  return baseUrl
}

/**
 * 用途：提交 URL 让服务端 yt-dlp 下载。
 * 入参：YouTube URL、当前服务端配置。
 * 返回值：jobId 或已存在的 episodeId。
 * 异常：缺配置、鉴权失败或 URL 非法时抛错。
 */
export async function submitConversion(
  youtubeUrl: string,
  settings: ServerSettings
): Promise<{ jobId?: string; episodeId?: string; alreadyExists: boolean; status: string }> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await assertServerAccess(settings)
  const data = await requestJson<{ jobId?: string; episodeId?: string; alreadyExists?: boolean; status?: string }>(
    `${baseUrl}/api/jobs`,
    adminToken,
    { method: 'POST', json: { youtubeUrl } }
  )
  return {
    jobId: data.jobId,
    episodeId: data.episodeId,
    alreadyExists: Boolean(data.alreadyExists),
    status: data.status ?? 'pending'
  }
}

/**
 * 用途：拉取最近任务供侧边栏展示。
 * 入参：服务端配置。
 * 返回值：任务数组；尚未授权时为空数组。
 * 异常：HTTP 失败时抛错。
 */
export async function fetchJobs(settings: ServerSettings): Promise<RemoteJob[]> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await peekAuthorizedBaseUrl(settings)
  if (!baseUrl) {
    return []
  }
  const data = await requestJson<{ jobs?: RemoteJob[] }>(
    `${baseUrl}/api/jobs`,
    adminToken,
    { method: 'GET' }
  )
  return data.jobs ?? []
}

/** 侧边栏列表用的单集摘要。 */
export type RemoteEpisode = {
  youtube_video_id: string
  title: string
  duration_seconds: number
}

/** 服务端 cookie 文件概况，不含明文。 */
export type RemoteCookieStatus = {
  present: boolean
  count: number
  updatedAt: string | null
}

/**
 * 用途：拉取单集列表，供侧边栏用标题代替 videoId。
 * 入参：服务端配置。
 * 返回值：单集数组；尚未授权时为空数组。
 * 异常：HTTP 失败时抛错。
 */
export async function fetchEpisodes(settings: ServerSettings): Promise<RemoteEpisode[]> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await peekAuthorizedBaseUrl(settings)
  if (!baseUrl) {
    return []
  }
  const data = await requestJson<{ episodes?: RemoteEpisode[] }>(
    `${baseUrl}/api/episodes`,
    adminToken,
    { method: 'GET' }
  )
  return data.episodes ?? []
}

/**
 * 用途：读取服务端 cookie 文件概况，不包含 cookie 内容。
 * 入参：服务端配置。
 * 返回值：状态；尚未授权或失败时 null。
 * 异常：无。
 */
export async function fetchCookieStatus(settings: ServerSettings): Promise<RemoteCookieStatus | null> {
  try {
    const adminToken = settings.adminToken.trim()
    const baseUrl = await peekAuthorizedBaseUrl(settings)
    if (!baseUrl) {
      return null
    }
    return await requestJson<RemoteCookieStatus>(`${baseUrl}/api/cookies`, adminToken, { method: 'GET' })
  } catch {
    return null
  }
}

/**
 * 用途：重试失败的服务端下载任务。
 * 入参：jobId、服务端配置。
 * 返回值：无。
 * 异常：任务不存在或非 failed 时抛错。
 */
export async function retryRemoteJob(jobId: string, settings: ServerSettings): Promise<void> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await assertServerAccess(settings)
  await requestJson(`${baseUrl}/api/jobs/${jobId}/retry`, adminToken, { method: 'POST' })
}

/**
 * 用途：把本机 youtube.com 登录态转成 Netscape 格式推给服务端，供 yt-dlp 使用。
 * 入参：服务端配置。
 * 返回值：服务端记录的 cookie 条数。
 * 异常：未登录、缺配置、权限被拒或服务端拒收时抛错。
 * 边界：每次都读取当前最新 cookie，覆盖服务端旧文件。
 */
export async function pushCookies(settings: ServerSettings): Promise<number> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await assertServerAccess(settings)
  const cookies = await chrome.cookies.getAll({ domain: 'youtube.com' })
  if (cookies.length === 0) {
    throw new Error('浏览器里没有 youtube.com 的 cookie，请先在 Chrome 登录 YouTube')
  }
  const response = await fetch(`${baseUrl}/api/cookies`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'text/plain; charset=utf-8'
    },
    body: toNetscapeCookies(cookies)
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(explainApiError(parseErrorBody(text, response.status)))
  }
  const data = JSON.parse(text) as { count?: number }
  return data.count ?? cookies.length
}

/**
 * 用途：把 chrome.cookies 结果转成 yt-dlp 可读的 Netscape cookie 文件。
 * 入参：Chrome cookie 数组。
 * 返回值：含头部注释的完整文本。
 * 异常：无。
 * 边界：httpOnly 用 `#HttpOnly_` 前缀；会话 cookie 过期时间写 0。
 */
function toNetscapeCookies(cookies: chrome.cookies.Cookie[]): string {
  const lines = ['# Netscape HTTP Cookie File']
  for (const cookie of cookies) {
    const domain = `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`
    const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    const expiry = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0
    lines.push([
      domain,
      includeSubdomains,
      cookie.path,
      secure,
      String(expiry),
      cookie.name,
      cookie.value
    ].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

/**
 * 用途：在已授权时读取 /api/meta。
 * 入参：服务端配置。
 * 返回值：meta；未授权或失败时 null。
 * 异常：无。
 */
export async function fetchServerMeta(settings: ServerSettings): Promise<MetaResponse | null> {
  try {
    const adminToken = settings.adminToken.trim()
    const baseUrl = await peekAuthorizedBaseUrl(settings)
    if (!baseUrl) {
      return null
    }
    return await requestJson<MetaResponse>(`${baseUrl}/api/meta`, adminToken, { method: 'GET' })
  } catch {
    return null
  }
}

/**
 * 用途：读取服务端版本，供插件提示是否过旧。
 * 入参：服务端配置。
 * 返回值：version；失败时 null。
 * 异常：无；网络失败返回 null。
 */
export async function fetchServerVersion(settings: ServerSettings): Promise<string | null> {
  const meta = await fetchServerMeta(settings)
  return meta?.version ?? null
}

export type ServerProbe = {
  version: string | null
  rssUrl: string | null
}

/**
 * 用途：在用户点击时申请主机权限并探测服务端是否可用。
 * 入参：服务端配置。
 * 返回值：版本与 RSS 订阅地址。
 * 异常：缺配置、拒绝授权或接口失败时抛错。
 */
export async function probeServer(settings: ServerSettings): Promise<ServerProbe> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await assertServerAccess(settings)
  const data = await requestJson<MetaResponse>(`${baseUrl}/api/meta`, adminToken, { method: 'GET' })
  return {
    version: data.version ?? null,
    rssUrl: data.rssUrl ?? null
  }
}

/**
 * 用途：把插件暂存的音频和裁切封面分片上传并 import。
 * 入参：videoId、可选封面 JPEG、进度回调、当前服务端配置。
 * 返回值：episodeId；alreadyExists 表示库中已有该视频。
 * 异常：缺配置、权限被拒、上传或 import 失败时抛错。
 */
export async function syncToServer(
  videoId: string,
  coverBlob: Blob | null,
  onProgress: SyncProgress,
  settings: ServerSettings
): Promise<{ episodeId: string; alreadyExists: boolean }> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = await assertServerAccess(settings)
  const record = await getTempAudio(videoId)
  if (!record) {
    throw new Error('没有对应的暂存音频，请先提取')
  }
  if (coverBlob) {
    await updateTempCover(videoId, coverBlob)
  }

  onProgress('正在申请上传')
  const audioInit = await initUpload(baseUrl, adminToken, {
    kind: 'audio',
    videoId,
    contentType: record.mimeType.split(';')[0]?.trim() || record.mimeType,
    totalSize: record.blob.size
  })
  if (audioInit.alreadyExists && audioInit.episodeId) {
    await deleteTempAudio(videoId)
    return { episodeId: audioInit.episodeId, alreadyExists: true }
  }

  onProgress('正在上传音频', 0, record.blob.size)
  const audioPath = await uploadBlob(baseUrl, adminToken, audioInit, record.blob, (loaded, total) => {
    onProgress('正在上传音频', loaded, total)
  })

  let imagePath: string | undefined
  if (coverBlob) {
    const coverInit = await initUpload(baseUrl, adminToken, {
      kind: 'cover',
      videoId,
      contentType: 'image/jpeg',
      totalSize: coverBlob.size
    })
    if (coverInit.alreadyExists && coverInit.episodeId) {
      await deleteTempAudio(videoId)
      return { episodeId: coverInit.episodeId, alreadyExists: true }
    }
    onProgress('正在上传封面', 0, coverBlob.size)
    imagePath = await uploadBlob(baseUrl, adminToken, coverInit, coverBlob, (loaded, total) => {
      onProgress('正在上传封面', loaded, total)
    })
  }

  onProgress('正在写入节目')
  const imported = await importEpisode(baseUrl, adminToken, record, audioPath, imagePath)
  await deleteTempAudio(videoId)
  return imported
}

/**
 * 用途：初始化分片会话，或发现该视频已入库。
 * 入参：站点根地址、Token、kind/videoId/contentType/totalSize。
 * 返回值：uploadId 与分片参数，或 alreadyExists。
 * 异常：HTTP 失败。
 */
async function initUpload(
  baseUrl: string,
  adminToken: string,
  body: { kind: 'audio' | 'cover'; videoId: string; contentType: string; totalSize: number }
): Promise<InitResponse> {
  return requestJson<InitResponse>(`${baseUrl}/api/upload/init`, adminToken, {
    method: 'POST',
    json: body
  })
}

/**
 * 用途：按 init 结果把 Blob 分片上传并 complete。
 * 入参：站点根地址、Token、init 响应、文件、进度回调。
 * 返回值：服务端媒体相对路径。
 * 异常：init 无效、分片失败或 complete 失败。
 */
async function uploadBlob(
  baseUrl: string,
  adminToken: string,
  init: InitResponse,
  blob: Blob,
  onProgress: (loaded: number, total: number) => void
): Promise<string> {
  const uploadId = init.uploadId
  const chunkSize = init.chunkSize
  const totalChunks = init.totalChunks
  if (!uploadId || !chunkSize || !totalChunks) {
    throw new Error('上传会话无效')
  }
  const received = new Set(init.received ?? [])
  let uploaded = 0
  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize
    const end = Math.min(start + chunkSize, blob.size)
    const pieceSize = end - start
    if (received.has(index)) {
      uploaded += pieceSize
      onProgress(uploaded, blob.size)
      continue
    }
    const piece = blob.slice(start, end)
    await putChunkWithRetry(
      `${baseUrl}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
      adminToken,
      piece,
      (loaded) => {
        onProgress(uploaded + loaded, blob.size)
      }
    )
    uploaded += pieceSize
    onProgress(uploaded, blob.size)
  }
  const done = await requestJson<CompleteResponse>(`${baseUrl}/api/upload/complete`, adminToken, {
    method: 'POST',
    json: { uploadId }
  })
  if (!done.path) {
    throw new Error('服务端未返回媒体路径')
  }
  return done.path
}

/**
 * 用途：PUT 单个分片，失败后按 1s/4s/16s 再试 3 次。
 * 入参：完整 URL、Token、分片 Blob、片内进度。
 * 返回值：无。
 * 异常：四次都失败时抛错。
 */
async function putChunkWithRetry(
  url: string,
  adminToken: string,
  body: Blob,
  onProgress: (loaded: number) => void
): Promise<void> {
  let lastError: Error = new Error('分片上传失败')
  for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await putChunk(url, adminToken, body, onProgress)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const delay = CHUNK_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        break
      }
      await sleep(delay)
    }
  }
  throw lastError
}

/**
 * 用途：用 XHR PUT 分片以便拿到上传进度。
 * 入参：完整 URL、Token、分片、进度回调。
 * 返回值：无。
 * 异常：HTTP 非 2xx 时抛错。
 */
function putChunk(
  url: string,
  adminToken: string,
  body: Blob,
  onProgress: (loaded: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('authorization', `Bearer ${adminToken}`)
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      reject(new Error(parseErrorBody(xhr.responseText, xhr.status)))
    }
    xhr.onerror = () => reject(new Error('分片上传网络失败'))
    xhr.send(body)
  })
}

/**
 * 用途：把元数据与媒体相对路径交给 /api/jobs/import。
 * 入参：站点根地址、Token、暂存记录、音频/封面路径。
 * 返回值：episodeId 与是否已存在。
 * 异常：HTTP 失败。
 */
async function importEpisode(
  baseUrl: string,
  adminToken: string,
  record: TempAudioRecord,
  audioPath: string,
  imagePath: string | undefined
): Promise<{ episodeId: string; alreadyExists: boolean }> {
  const data = await requestJson<ImportResponse>(`${baseUrl}/api/jobs/import`, adminToken, {
    method: 'POST',
    json: {
      youtubeUrl: record.youtubeUrl,
      youtubeVideoId: record.videoId,
      title: record.title,
      description: record.description,
      channelTitle: record.channelTitle,
      durationSeconds: record.durationSeconds,
      thumbnailUrl: record.thumbnailUrl,
      audioMimeType: record.mimeType.split(';')[0]?.trim() || record.mimeType,
      audioFileSize: record.blob.size,
      audioPath,
      imagePath: imagePath ?? null
    }
  })
  if (!data.episodeId) {
    throw new Error('服务端未返回 episodeId')
  }
  return { episodeId: data.episodeId, alreadyExists: Boolean(data.alreadyExists) }
}

/**
 * 用途：带 RSS Token 的 JSON 请求。
 * 入参：URL、Token、method 与可选 JSON 体。
 * 返回值：解析后的对象。
 * 异常：非 2xx 或正文不是 JSON。
 */
async function requestJson<T>(
  url: string,
  adminToken: string,
  options: { method: string; json?: unknown }
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${adminToken}` }
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) as unknown : null
  } catch {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : `HTTP ${response.status}`
    throw new Error(explainApiError(code))
  }
  return data as T
}

/**
 * 用途：解析 XHR 失败正文中的 error 字段。
 * 入参：responseText、HTTP 状态。
 * 返回值：中文说明。
 * 异常：无。
 */
function parseErrorBody(text: string, status: number): string {
  try {
    const data = JSON.parse(text) as { error?: string }
    if (data.error) {
      return explainApiError(data.error)
    }
  } catch {
    // 非 JSON 时走状态码
  }
  return explainApiError(`HTTP ${status}`)
}

/**
 * 用途：把服务端错误码翻成侧边栏可读文案。
 * 入参：error 字段或 HTTP 状态文本。
 * 返回值：中文说明；未知码原样返回。
 * 异常：无。
 */
export function explainApiError(code: string): string {
  const messages: Record<string, string> = {
    unauthorized: 'RSS Token 无效',
    invalid_kind: '上传类型无效',
    invalid_video_id: '视频 ID 无效',
    invalid_content_type: '文件类型不被接受',
    invalid_youtube_url: 'YouTube 链接无效',
    invalid_audio: '缺少音频地址或大小',
    invalid_image: '封面路径无效',
    invalid_size: '文件过大或不合法',
    invalid_chunk: '分片大小不正确',
    upload_incomplete: '分片未传完',
    upload_not_found: '上传会话不存在',
    job_not_failed: '只能重试失败的任务',
    invalid_cookies: '登录态格式无效，请重新同步',
    not_found: '资源不存在'
  }
  return messages[code] ?? code
}

/**
 * 用途：比较主版本号，判断插件是否落后于服务端。
 * 入参：插件 version、服务端 version。
 * 返回值：插件主版本更小则为 true。
 * 异常：无。
 */
export function isPluginBehind(pluginVersion: string, serverVersion: string): boolean {
  const pluginMajor = Number(pluginVersion.split('.')[0])
  const serverMajor = Number(serverVersion.split('.')[0])
  return Number.isFinite(pluginMajor) && Number.isFinite(serverMajor) && pluginMajor < serverMajor
}

/**
 * 用途：去掉末尾斜杠，并要求带协议。
 * 入参：用户填写的服务端地址。
 * 返回值：规范化根 URL。
 * 异常：空字符串或无法解析为 http(s) URL。
 */
function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('服务端地址必须是 http 或 https')
  }
  return `${url.protocol}//${url.host}`
}

/**
 * 用途：在已授权前提下拿到规范化根 URL，供轮询使用（不弹权限窗）。
 * 入参：用户填写的地址和 Token。
 * 返回值：已授权则为根 URL，否则 null。
 * 异常：无。
 */
async function peekAuthorizedBaseUrl(settings: ServerSettings): Promise<string | null> {
  const adminToken = settings.adminToken.trim()
  let baseUrl: string
  try {
    baseUrl = normalizeBaseUrl(settings.baseUrl)
  } catch {
    return null
  }
  if (!baseUrl || !adminToken) {
    return null
  }
  const origins = [`${new URL(baseUrl).origin}/*`]
  const already = await chrome.permissions.contains({ origins })
  return already ? baseUrl : null
}

/**
 * 用途：立刻申请扩展主机权限（须作为点击栈里的第一个 await，避免丢失 user gesture）。
 * 入参：规范化后的服务端根 URL。
 * 返回值：无。
 * 异常：用户拒绝授权。
 */
async function ensureHostAccess(baseUrl: string): Promise<void> {
  const origins = [`${new URL(baseUrl).origin}/*`]
  const granted = await chrome.permissions.request({ origins })
  if (!granted) {
    throw new Error('需要允许访问服务端')
  }
}

/**
 * 用途：等待指定毫秒。
 * 入参：毫秒。
 * 返回值：无。
 * 异常：无。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

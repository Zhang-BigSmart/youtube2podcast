import { put } from '@vercel/blob/client'
import { deleteTempAudio, getTempAudio, updateTempCover, type TempAudioRecord } from './temp-store'

const SETTINGS_KEY = 'y2p.server'

export type ServerSettings = {
  baseUrl: string
  adminToken: string
}

export type SyncProgress = (message: string, received?: number, total?: number) => void

const BLOB_ORIGINS = [
  'https://vercel.com/*',
  'https://*.blob.vercel-storage.com/*'
]

/**
 * 用途：读取侧边栏保存的服务端地址与 Admin Token。
 * 入参：无。
 * 返回值：可能为空字符串的配置。
 */
export async function loadServerSettings(): Promise<ServerSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  const value = stored[SETTINGS_KEY] as ServerSettings | undefined
  return {
    baseUrl: value?.baseUrl ?? '',
    adminToken: value?.adminToken ?? ''
  }
}

/**
 * 用途：把服务端地址与 Token 写入 chrome.storage.local。
 * 入参：baseUrl、adminToken。
 * 返回值：无。
 */
export async function saveServerSettings(settings: ServerSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

/**
 * 用途：校验配置并立刻申请主机权限（须在点击同步的同步栈里尽早调用，避免丢失 user gesture）。
 * 入参：用户填写的地址和 Token。
 * 返回值：规范化后的根 URL。
 * 异常：缺配置、地址非法、或用户拒绝授权。
 */
export async function assertServerAccess(settings: ServerSettings): Promise<string> {
  const adminToken = settings.adminToken.trim()
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  if (!baseUrl || !adminToken) {
    throw new Error('请填写服务端地址和 Admin Token')
  }
  await ensureHostAccess(baseUrl)
  return baseUrl
}

/**
 * 用途：把插件暂存的音频和裁切封面同步到服务端。
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

  onProgress('正在申请上传凭证')
  const audioGrant = await requestUploadToken(baseUrl, adminToken, {
    kind: 'audio',
    videoId,
    contentType: record.mimeType
  })
  if (audioGrant.alreadyExists && audioGrant.episodeId) {
    await deleteTempAudio(videoId)
    return { episodeId: audioGrant.episodeId, alreadyExists: true }
  }

  let imageBlobUrl: string | undefined
  if (coverBlob) {
    const coverGrant = await requestUploadToken(baseUrl, adminToken, {
      kind: 'cover',
      videoId,
      contentType: 'image/jpeg'
    })
    if (coverGrant.alreadyExists && coverGrant.episodeId) {
      await deleteTempAudio(videoId)
      return { episodeId: coverGrant.episodeId, alreadyExists: true }
    }
    if (!coverGrant.token || !coverGrant.pathname) {
      throw new Error('封面上传凭证无效')
    }
    onProgress('正在上传封面', 0, coverBlob.size)
    const uploadedCover = await put(coverGrant.pathname, coverBlob, {
      access: 'public',
      token: coverGrant.token,
      contentType: 'image/jpeg',
      onUploadProgress: ({ loaded, total }) => {
        onProgress('正在上传封面', loaded, total)
      }
    })
    imageBlobUrl = uploadedCover.url
  }

  if (!audioGrant.token || !audioGrant.pathname) {
    throw new Error('音频上传凭证无效')
  }
  onProgress('正在上传音频', 0, record.blob.size)
  const uploadedAudio = await put(audioGrant.pathname, record.blob, {
    access: 'public',
    token: audioGrant.token,
    contentType: record.mimeType,
    multipart: record.blob.size > 4 * 1024 * 1024,
    onUploadProgress: ({ loaded, total }) => {
      onProgress('正在上传音频', loaded, total)
    }
  })

  onProgress('正在写入节目')
  const imported = await importEpisode(baseUrl, adminToken, record, uploadedAudio.url, imageBlobUrl)
  await deleteTempAudio(videoId)
  return imported
}

type UploadTokenResponse = {
  token?: string
  pathname?: string
  alreadyExists?: boolean
  episodeId?: string
  error?: string
}

type ImportResponse = {
  episodeId?: string
  alreadyExists?: boolean
  error?: string
}

/**
 * 用途：向本站申请 Blob 直传凭证。
 * 入参：站点根地址、Admin Token、kind/videoId/contentType。
 * 返回值：token+pathname，或 alreadyExists。
 * 异常：HTTP 失败或响应不是 JSON。
 */
async function requestUploadToken(
  baseUrl: string,
  adminToken: string,
  body: { kind: 'audio' | 'cover'; videoId: string; contentType: string }
): Promise<UploadTokenResponse> {
  return postJson<UploadTokenResponse>(`${baseUrl}/api/uploads`, adminToken, body)
}

/**
 * 用途：把元数据与 Blob URL 交给 /api/jobs/import。
 * 入参：站点根地址、Token、暂存记录、音频/封面公开 URL。
 * 返回值：episodeId 与是否已存在。
 * 异常：HTTP 失败。
 */
async function importEpisode(
  baseUrl: string,
  adminToken: string,
  record: TempAudioRecord,
  audioBlobUrl: string,
  imageBlobUrl: string | undefined
): Promise<{ episodeId: string; alreadyExists: boolean }> {
  const data = await postJson<ImportResponse>(`${baseUrl}/api/jobs/import`, adminToken, {
    youtubeUrl: record.youtubeUrl,
    youtubeVideoId: record.videoId,
    title: record.title,
    description: record.description,
    channelTitle: record.channelTitle,
    durationSeconds: record.durationSeconds,
    thumbnailUrl: record.thumbnailUrl,
    audioMimeType: record.mimeType,
    audioFileSize: record.blob.size,
    audioBlobUrl,
    imageBlobUrl: imageBlobUrl ?? null
  })
  if (!data.episodeId) {
    throw new Error('服务端未返回 episodeId')
  }
  return { episodeId: data.episodeId, alreadyExists: Boolean(data.alreadyExists) }
}

/**
 * 用途：带 Admin Token 的 JSON POST，并解析错误码。
 * 入参：完整 URL、Token、JSON 体。
 * 返回值：解析后的对象。
 * 异常：非 2xx 或正文不是 JSON。
 */
async function postJson<T>(url: string, adminToken: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
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
 * 用途：把服务端错误码翻成侧边栏可读文案。
 * 入参：error 字段或 HTTP 状态文本。
 * 返回值：中文说明；未知码原样返回。
 */
function explainApiError(code: string): string {
  const messages: Record<string, string> = {
    unauthorized: 'Admin Token 无效',
    invalid_kind: '上传类型无效',
    invalid_video_id: '视频 ID 无效',
    invalid_content_type: '文件类型不被接受',
    invalid_youtube_url: 'YouTube 链接无效',
    invalid_audio: '缺少音频地址或大小',
    invalid_audio_blob: '音频 Blob 地址不属于本服务',
    invalid_image_blob: '封面 Blob 地址不属于本服务'
  }
  return messages[code] ?? code
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
 * 用途：为用户填写的源站和 Vercel Blob 申请扩展主机权限。
 * 入参：规范化后的服务端根 URL。
 * 返回值：无。
 * 异常：用户拒绝授权。
 */
async function ensureHostAccess(baseUrl: string): Promise<void> {
  const origin = `${new URL(baseUrl).origin}/*`
  const origins = [origin, ...BLOB_ORIGINS]
  const already = await chrome.permissions.contains({ origins })
  if (already) {
    return
  }
  const granted = await chrome.permissions.request({ origins })
  if (!granted) {
    throw new Error('需要允许访问服务端和 Vercel Blob')
  }
}

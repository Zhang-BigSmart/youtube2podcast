import type { Env } from '../env.js'
import { getEpisodeByVideoId, insertEpisode } from '../db/episodes.js'
import { insertJob } from '../db/jobs.js'
import { createId } from '../ids.js'
import { parseYouTubeVideoId } from '../youtube.js'
import { storeEpisodeCover } from './cover.js'
import { buildUploadPathname } from './uploads.js'

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export type ImportEpisodeInput = {
  youtubeUrl?: string
  youtubeVideoId?: string
  title?: string
  description?: string
  channelTitle?: string
  durationSeconds?: number
  thumbnailUrl?: string | null
  audioMimeType?: string
  audioFileSize?: number
  audioBlobUrl?: string
  imageBlobUrl?: string | null
}

export type ImportEpisodeResult =
  | { ok: true; status: 200; episodeId: string; alreadyExists: true }
  | { ok: true; status: 201; episodeId: string; jobId: string }
  | { ok: false; status: 400; error: string }

/**
 * 用途：把插件已上传的音频/封面登记为 episode，不走 RapidAPI。
 * 入参：env、插件提交的元数据与 Blob URL。
 * 返回值：新建、已存在或校验错误。
 * 异常：写库失败时向上抛。
 * 边界：封面 URL 缺省时回退用缩略图自动铺方图；已有方图 URL 不再 blur。
 */
export async function importEpisode(
  env: Env,
  input: ImportEpisodeInput
): Promise<ImportEpisodeResult> {
  const youtubeUrl = input.youtubeUrl?.trim() ?? ''
  const videoId = resolveVideoId(youtubeUrl, input.youtubeVideoId)
  if (!videoId) {
    return { ok: false, status: 400, error: 'invalid_youtube_url' }
  }

  const audioBlobUrl = input.audioBlobUrl?.trim() ?? ''
  const audioMimeType = input.audioMimeType?.split(';')[0]?.trim() ?? ''
  const audioFileSize = Number(input.audioFileSize)
  if (!audioBlobUrl || !audioMimeType || !Number.isFinite(audioFileSize) || audioFileSize <= 0) {
    return { ok: false, status: 400, error: 'invalid_audio' }
  }

  const expectedAudioPath = buildUploadPathname(env.RSS_TOKEN, 'audio', videoId, audioMimeType)
  if (!blobUrlMatchesPathname(audioBlobUrl, expectedAudioPath)) {
    return { ok: false, status: 400, error: 'invalid_audio_blob' }
  }

  const imageBlobUrl = input.imageBlobUrl?.trim() || null
  if (imageBlobUrl) {
    const expectedCoverPath = buildUploadPathname(env.RSS_TOKEN, 'cover', videoId, 'image/jpeg')
    if (!blobUrlMatchesPathname(imageBlobUrl, expectedCoverPath)) {
      return { ok: false, status: 400, error: 'invalid_image_blob' }
    }
  }

  const existing = await getEpisodeByVideoId(env, videoId)
  if (existing) {
    return { ok: true, status: 200, episodeId: existing.id, alreadyExists: true }
  }

  const canonicalUrl = canonicalYoutubeUrl(youtubeUrl, videoId)
  const episodeId = createId('ep')
  const now = new Date().toISOString()
  const thumbnailUrl = input.thumbnailUrl?.trim() || null
  const blobImageUrl = imageBlobUrl
    ?? await storeEpisodeCover(`images/${env.RSS_TOKEN}/${episodeId}.jpg`, thumbnailUrl)

  await insertEpisode(env, {
    id: episodeId,
    youtube_video_id: videoId,
    youtube_url: canonicalUrl,
    title: input.title?.trim() || `YouTube ${videoId}`,
    description: input.description?.trim() || canonicalUrl,
    channel_title: input.channelTitle?.trim() || 'YouTube',
    thumbnail_url: thumbnailUrl,
    blob_audio_url: audioBlobUrl,
    blob_image_url: blobImageUrl,
    audio_mime_type: audioMimeType,
    audio_file_size: Math.trunc(audioFileSize),
    duration_seconds: Number.isFinite(input.durationSeconds) ? Math.max(0, Math.trunc(input.durationSeconds ?? 0)) : 0,
    guid: `youtube:${videoId}`,
    published_at: now,
    created_at: now
  })

  const jobId = createId('job')
  await insertJob(env, {
    id: jobId,
    youtube_url: canonicalUrl,
    youtube_video_id: videoId,
    status: 'completed',
    error_message: null,
    provider: 'extension',
    attempt_count: 1,
    episode_id: episodeId,
    created_at: now,
    updated_at: now,
    completed_at: now
  })

  return { ok: true, status: 201, episodeId, jobId }
}

/**
 * 用途：从链接或显式 ID 解析 11 位视频 ID。
 * 入参：用户/插件提供的 URL、可选 youtubeVideoId。
 * 返回值：视频 ID；无法识别时 null。
 */
function resolveVideoId(youtubeUrl: string, youtubeVideoId?: string): string | null {
  if (youtubeVideoId && VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return youtubeVideoId
  }
  const parsed = parseYouTubeVideoId(youtubeUrl)
  if (parsed) return parsed
  if (VIDEO_ID_PATTERN.test(youtubeUrl)) return youtubeUrl
  try {
    const url = new URL(youtubeUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') && parts[1] && VIDEO_ID_PATTERN.test(parts[1])) {
      return parts[1]
    }
  } catch {
    return null
  }
  return null
}

/**
 * 用途：入库用的规范观看链接。
 * 入参：原始输入、已解析 videoId。
 * 返回值：可打开的 watch URL；原始已是 URL 则尽量保留。
 */
function canonicalYoutubeUrl(youtubeUrl: string, videoId: string): string {
  try {
    new URL(youtubeUrl)
    return youtubeUrl
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`
  }
}

/**
 * 用途：确认 Blob URL 属于本店且路径与签发的 pathname 一致。
 * 入参：公开 Blob URL、期望 pathname。
 * 返回值：是否匹配。
 * 边界：只认 *.blob.vercel-storage.com，避免把任意 URL 写进 RSS。
 */
function blobUrlMatchesPathname(blobUrl: string, pathname: string): boolean {
  try {
    const parsed = new URL(blobUrl)
    if (!parsed.hostname.endsWith('.blob.vercel-storage.com') && parsed.hostname !== 'blob.vercel-storage.com') {
      return false
    }
    const stored = decodeURIComponent(parsed.pathname).replace(/^\//, '')
    return stored === pathname || stored.endsWith(`/${pathname}`)
  } catch {
    return false
  }
}

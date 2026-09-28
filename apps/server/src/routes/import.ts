import { statSync } from 'node:fs'
import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { jpegFromThumbnailUrl } from '../core/cover.js'
import { createId } from '../core/ids.js'
import {
  canonicalAudioPath,
  canonicalCoverPath,
  existingMediaFile,
  putCoverBytes
} from '../core/media-store.js'
import { canonicalYoutubeUrl, parseYouTubeVideoId, VIDEO_ID_PATTERN } from '../core/youtube-url.js'

/**
 * 用途：读取 JSON 请求体；非法时返回空对象。
 * 入参：Hono context。
 * 返回值：对象。
 * 异常：无。
 */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * 用途：从 URL 或显式 ID 得到 11 位 videoId。
 * 入参：youtubeUrl、youtubeVideoId。
 * 返回值：videoId 或 null。
 * 异常：无。
 */
function resolveVideoId(youtubeUrl: string, youtubeVideoId: unknown): string | null {
  if (typeof youtubeVideoId === 'string' && VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return youtubeVideoId
  }
  return parseYouTubeVideoId(youtubeUrl)
}

/**
 * 用途：登记插件保底链路的 episode。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountImportRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.post('/api/jobs/import', async (c) => {
    const { config, db } = c.get('ctx')
    const body = await readJson(c)
    const youtubeUrl = typeof body.youtubeUrl === 'string' ? body.youtubeUrl.trim() : ''
    const videoId = resolveVideoId(youtubeUrl, body.youtubeVideoId)
    if (!videoId) {
      return c.json({ error: 'invalid_youtube_url' }, 400)
    }

    const existing = db.getEpisodeByVideoId(videoId)
    if (existing) {
      return c.json({ episodeId: existing.id, status: 'completed', alreadyExists: true }, 200)
    }

    const audioMimeType = typeof body.audioMimeType === 'string'
      ? body.audioMimeType.split(';')[0].trim()
      : ''
    const audioPath = typeof body.audioPath === 'string' ? body.audioPath : ''
    let expectedPath: string
    try {
      expectedPath = canonicalAudioPath(videoId, audioMimeType)
    } catch {
      return c.json({ error: 'invalid_audio' }, 400)
    }
    if (!audioPath || audioPath !== expectedPath) {
      return c.json({ error: 'invalid_audio' }, 400)
    }
    const audioAbs = existingMediaFile(config.DATA_DIR, audioPath)
    if (!audioAbs) {
      return c.json({ error: 'invalid_audio' }, 400)
    }
    const fileSize = statSync(audioAbs).size
    const declaredSize = Number(body.audioFileSize)
    if (!Number.isFinite(declaredSize) || declaredSize !== fileSize || fileSize <= 0) {
      return c.json({ error: 'invalid_audio' }, 400)
    }

    let imagePath: string | null = typeof body.imagePath === 'string' && body.imagePath
      ? body.imagePath
      : null
    if (imagePath) {
      if (imagePath !== canonicalCoverPath(videoId) || !existingMediaFile(config.DATA_DIR, imagePath)) {
        return c.json({ error: 'invalid_image' }, 400)
      }
    } else {
      const thumbnailUrl = typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl : null
      const jpeg = await jpegFromThumbnailUrl(thumbnailUrl)
      if (jpeg) {
        imagePath = putCoverBytes(config.DATA_DIR, videoId, jpeg).path
      }
    }

    const now = new Date().toISOString()
    const episodeId = createId('ep')
    const canonicalUrl = canonicalYoutubeUrl(youtubeUrl, videoId)
    db.insertEpisode({
      id: episodeId,
      youtube_video_id: videoId,
      youtube_url: canonicalUrl,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : `YouTube ${videoId}`,
      description: typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : canonicalUrl,
      channel_title: typeof body.channelTitle === 'string' && body.channelTitle.trim()
        ? body.channelTitle.trim()
        : 'YouTube',
      audio_path: audioPath,
      image_path: imagePath,
      audio_mime_type: audioMimeType,
      audio_file_size: fileSize,
      duration_seconds: Number.isFinite(Number(body.durationSeconds))
        ? Math.max(0, Math.trunc(Number(body.durationSeconds)))
        : 0,
      guid: `youtube:${videoId}`,
      published_at: now,
      created_at: now
    })

    const jobId = createId('job')
    db.insertJob({
      id: jobId,
      youtube_url: canonicalUrl,
      youtube_video_id: videoId,
      status: 'completed',
      error_kind: null,
      error_message: null,
      source: 'extension',
      attempt_count: 1,
      episode_id: episodeId,
      created_at: now,
      updated_at: now,
      completed_at: now
    })

    return c.json({ episodeId, jobId, status: 'completed' }, 201)
  })
}

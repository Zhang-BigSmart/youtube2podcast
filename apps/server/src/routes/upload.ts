import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { VIDEO_ID_PATTERN } from '../core/youtube-url.js'
import {
  AUDIO_CONTENT_TYPES,
  AUDIO_MAX_BYTES,
  COVER_MAX_BYTES,
  DEFAULT_CHUNK_SIZE,
  completeUpload,
  expectedChunkSize,
  initUpload,
  listReceived,
  readUploadMeta,
  writeChunk,
  type UploadKind
} from '../core/chunk-store.js'

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
 * 用途：注册分片上传三端点。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountUploadRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.post('/api/upload/init', async (c) => {
    const { db, chunkSize } = c.get('ctx')
    const body = await readJson(c)
    const kind = body.kind
    const videoId = typeof body.videoId === 'string' ? body.videoId : ''
    const contentType = typeof body.contentType === 'string' ? body.contentType.split(';')[0].trim() : ''
    const totalSize = Number(body.totalSize)

    if (kind !== 'audio' && kind !== 'cover') {
      return c.json({ error: 'invalid_kind' }, 400)
    }
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      return c.json({ error: 'invalid_video_id' }, 400)
    }
    if (kind === 'audio' && !AUDIO_CONTENT_TYPES.has(contentType)) {
      return c.json({ error: 'invalid_content_type' }, 400)
    }
    if (kind === 'cover' && contentType !== 'image/jpeg') {
      return c.json({ error: 'invalid_content_type' }, 400)
    }
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
      return c.json({ error: 'invalid_size' }, 400)
    }
    const max = kind === 'cover' ? COVER_MAX_BYTES : AUDIO_MAX_BYTES
    if (totalSize > max) {
      return c.json({ error: 'invalid_size' }, 400)
    }

    const existing = db.getEpisodeByVideoId(videoId)
    if (existing) {
      return c.json({ alreadyExists: true, episodeId: existing.id }, 200)
    }

    const size = chunkSize ?? DEFAULT_CHUNK_SIZE
    const meta = initUpload(
      c.get('ctx').config.DATA_DIR,
      { kind: kind as UploadKind, videoId, contentType, totalSize },
      size
    )
    return c.json({
      uploadId: meta.uploadId,
      chunkSize: meta.chunkSize,
      totalChunks: meta.totalChunks,
      received: listReceived(c.get('ctx').config.DATA_DIR, meta.uploadId)
    })
  })

  app.put('/api/upload/chunk', async (c) => {
    const { config } = c.get('ctx')
    const uploadId = c.req.query('uploadId') ?? ''
    const index = Number(c.req.query('index'))
    const meta = readUploadMeta(config.DATA_DIR, uploadId)
    if (!meta) {
      return c.json({ error: 'upload_not_found' }, 404)
    }
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
      return c.json({ error: 'invalid_chunk' }, 400)
    }
    const body = c.req.raw.body
    if (!body) {
      return c.json({ error: 'invalid_chunk' }, 400)
    }
    const written = await writeChunk(config.DATA_DIR, uploadId, index, body)
    if (written !== expectedChunkSize(meta, index)) {
      return c.json({ error: 'invalid_chunk' }, 400)
    }
    return c.json({ received: listReceived(config.DATA_DIR, uploadId) })
  })

  app.post('/api/upload/complete', async (c) => {
    const body = await readJson(c)
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : ''
    try {
      const stored = completeUpload(c.get('ctx').config.DATA_DIR, uploadId)
      return c.json({ path: stored.path, size: stored.size })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'upload_incomplete'
      const status = code === 'upload_not_found' ? 404 : 400
      return c.json({ error: code }, status)
    }
  })
}

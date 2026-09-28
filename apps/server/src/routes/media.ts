import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import type { AppContext } from '../context.js'
import { isValidToken } from '../auth.js'
import { existingMediaFile } from '../core/media-store.js'
import { parseRangeHeader } from '../core/range.js'

type MediaEnv = { Variables: { ctx: AppContext } }

/**
 * 用途：把 Node 文件流转成 Web ReadableStream。
 * 入参：路径与可选字节区间。
 * 返回值：ReadableStream。
 * 异常：文件不存在时由 createReadStream 报错。
 */
function fileStream(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(path, range)
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}

/**
 * 用途：按 RSS token 与 episodeId 返回封面 JPEG。
 * 入参：Hono context（路由参数 token、episodeId）。
 * 返回值：200 图片流；token/单集/文件无效时 404。
 * 异常：无。
 */
function serveCover(c: Context<MediaEnv>): Response {
  const { config, db } = c.get('ctx')
  if (!isValidToken(c.req.param('token') ?? '', config.RSS_TOKEN)) {
    return c.json({ error: 'not_found' }, 404)
  }
  const episode = db.getEpisode(c.req.param('episodeId') ?? '')
  if (!episode?.image_path) {
    return c.json({ error: 'not_found' }, 404)
  }
  const abs = existingMediaFile(config.DATA_DIR, episode.image_path)
  if (!abs) {
    return c.json({ error: 'not_found' }, 404)
  }
  const size = statSync(abs).size
  return new Response(fileStream(abs), {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(size)
    }
  })
}

/**
 * 用途：注册音频/封面媒体流（音频支持 Range）。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 * 边界：token 或 episode 不合法统一 404。
 */
export function mountMediaRoutes(app: Hono<MediaEnv>): void {
  app.get('/media/:token/:episodeId/audio', (c) => {
    const { config, db } = c.get('ctx')
    if (!isValidToken(c.req.param('token'), config.RSS_TOKEN)) {
      return c.json({ error: 'not_found' }, 404)
    }
    const episode = db.getEpisode(c.req.param('episodeId'))
    if (!episode) {
      return c.json({ error: 'not_found' }, 404)
    }
    const abs = existingMediaFile(config.DATA_DIR, episode.audio_path)
    if (!abs || !existsSync(abs)) {
      return c.json({ error: 'not_found' }, 404)
    }

    const size = statSync(abs).size
    const range = parseRangeHeader(c.req.header('range') ?? null, size)
    if (c.req.header('range') && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          'content-range': `bytes */${size}`,
          'accept-ranges': 'bytes'
        }
      })
    }

    if (!range) {
      return new Response(fileStream(abs), {
        status: 200,
        headers: {
          'content-type': episode.audio_mime_type,
          'content-length': String(size),
          'accept-ranges': 'bytes'
        }
      })
    }

    const length = range.end - range.start + 1
    return new Response(fileStream(abs, range), {
      status: 206,
      headers: {
        'content-type': episode.audio_mime_type,
        'content-length': String(length),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'accept-ranges': 'bytes'
      }
    })
  })

  app.get('/media/:token/:episodeId/cover.jpg', (c) => serveCover(c))
  app.get('/media/:token/:episodeId/cover', (c) => serveCover(c))
}

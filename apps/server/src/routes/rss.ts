import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { isValidToken } from '../auth.js'
import { renderRss } from '../core/rss-render.js'

/**
 * 用途：注册私人 RSS。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 * 边界：token 错误统一 404。
 */
export function mountRssRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.get('/rss/:file', (c) => {
    const { config, db } = c.get('ctx')
    const token = c.req.param('file').replace(/\.xml$/, '')
    if (!isValidToken(token, config.RSS_TOKEN)) {
      return c.json({ error: 'not_found' }, 404)
    }
    const origin = config.PUBLIC_BASE_URL
    const rssToken = config.RSS_TOKEN
    const items = db.listEpisodes(100).map((episode) => ({
      title: episode.title,
      description: episode.description,
      channel_title: episode.channel_title,
      audio_url: `${origin}/media/${rssToken}/${episode.id}/audio`,
      image_url: episode.image_path
        ? `${origin}/media/${rssToken}/${episode.id}/cover.jpg`
        : null,
      audio_mime_type: episode.audio_mime_type,
      audio_file_size: episode.audio_file_size,
      duration_seconds: episode.duration_seconds,
      guid: episode.guid,
      published_at: episode.published_at
    }))
    const xml = renderRss(items, `${origin}/podcast-cover.png`)
    return new Response(xml, {
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'no-cache'
      }
    })
  })
}

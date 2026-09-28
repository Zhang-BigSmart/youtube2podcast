import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { isAuthorizedAdmin } from './auth.js'
import type { AppContext } from './context.js'
import { mountCookieRoutes } from './routes/cookies.js'
import { mountEpisodeRoutes } from './routes/episodes.js'
import { mountImportRoutes } from './routes/import.js'
import { mountJobRoutes } from './routes/jobs.js'
import { mountMediaRoutes } from './routes/media.js'
import { mountHealthz, mountMetaRoutes } from './routes/meta.js'
import { mountRssRoutes } from './routes/rss.js'
import { mountUploadRoutes } from './routes/upload.js'

/**
 * 用途：定位 RSS 节目封面 podcast-cover.png。
 * 入参：无。
 * 返回值：存在的绝对路径；都没有时 null。
 * 异常：无。
 * 边界：tsx 下相对 src/，打包后相对 dist/，再回退到进程 cwd。
 */
function channelCoverFile(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../public/podcast-cover.png'),
    resolve(process.cwd(), 'public/podcast-cover.png')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

/**
 * 用途：组装 Hono 应用（注入 AppContext、鉴权、全部路由）。
 * 入参：运行时上下文。
 * 返回值：Hono app。
 * 异常：无。
 */
export function createApp(ctx: AppContext) {
  const app = new Hono<{ Variables: { ctx: AppContext } }>()

  app.use('*', async (c, next) => {
    c.set('ctx', ctx)
    await next()
  })

  mountHealthz(app)
  mountRssRoutes(app)
  mountMediaRoutes(app)

  app.use('/api/*', async (c, next) => {
    if (!isAuthorizedAdmin(c.req.raw, ctx.config.RSS_TOKEN)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  mountMetaRoutes(app)
  mountJobRoutes(app)
  mountEpisodeRoutes(app)
  mountUploadRoutes(app)
  mountImportRoutes(app)
  mountCookieRoutes(app)

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  app.get('/podcast-cover.png', (c) => {
    const file = channelCoverFile()
    if (!file) {
      return c.text('Not Found', 404)
    }
    return new Response(readFileSync(file), {
      headers: { 'content-type': 'image/png' }
    })
  })

  app.get('/', (c) => c.text('YouTube2Podcast'))

  return app
}

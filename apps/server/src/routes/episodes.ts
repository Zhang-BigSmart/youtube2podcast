import { Hono } from 'hono'
import type { AppContext } from '../context.js'

/**
 * 用途：注册单集列表接口。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountEpisodeRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.get('/api/episodes', (c) => {
    return c.json({ episodes: c.get('ctx').db.listEpisodes() })
  })
}

import type { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { readCookieStatus, writeCookies } from '../core/cookie-store.js'

const MAX_COOKIE_BYTES = 512 * 1024

/**
 * 用途：注册 cookie 推送与状态查询（已在 /api/* 中间件内受 RSS Token 保护）。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 * 边界：状态接口只返回条数与时间，绝不回显 cookie 内容。
 */
export function mountCookieRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.put('/api/cookies', async (c) => {
    const ctx = c.get('ctx')
    const text = await c.req.text()
    if (!text || text.length > MAX_COOKIE_BYTES) {
      return c.json({ error: 'invalid_cookies' }, 400)
    }
    try {
      const count = writeCookies(ctx.config.DATA_DIR, text)
      return c.json({ count })
    } catch {
      return c.json({ error: 'invalid_cookies' }, 400)
    }
  })

  app.get('/api/cookies', (c) => {
    const ctx = c.get('ctx')
    return c.json(readCookieStatus(ctx.config.DATA_DIR))
  })
}

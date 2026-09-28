import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import type { AppContext } from '../context.js'

const VERSION = readPackageVersion()

/**
 * 用途：读取本包 version，供 /api/meta。
 * 入参：无。
 * 返回值：package.json 的 version；失败时 0.0.0。
 * 异常：无。
 */
function readPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '1.0.0'
  } catch {
    return '1.0.0'
  }
}

/**
 * 用途：注册健康检查。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountHealthz(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.get('/healthz', (c) => c.json({ ok: true }))
}

/**
 * 用途：注册 /api/meta（需 RSS Token）。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountMetaRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.get('/api/meta', (c) => {
    const { config, ytdlpVersion } = c.get('ctx')
    return c.json({
      version: VERSION,
      ytdlpVersion: ytdlpVersion ?? null,
      rssUrl: `${config.PUBLIC_BASE_URL}/rss/${config.RSS_TOKEN}.xml`
    })
  })
}

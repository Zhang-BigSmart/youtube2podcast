import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type Config = {
  RSS_TOKEN: string
  PUBLIC_BASE_URL: string
  PORT: number
  DATA_DIR: string
  YTDLP_PATH: string
  YTDLP_COOKIES_FILE?: string
  YOUTUBE_API_KEY?: string
}

/**
 * 用途：若存在 .env 则把其中未设置的键写入 process.env。
 * 入参：candidateFiles，按顺序尝试。
 * 返回值：无。
 * 异常：无；文件不存在时跳过。
 */
function tryLoadEnvFiles(candidateFiles: string[]): void {
  for (const file of candidateFiles) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}

/**
 * 用途：读取必填环境变量。
 * 入参：name。
 * 返回值：非空字符串。
 * 异常：缺失时抛 `Missing env: NAME`。
 */
function requiredFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`Missing env: ${name}`)
  }
  return value
}

/**
 * 用途：去掉 URL 末尾斜杠。
 * 入参：baseUrl。
 * 返回值：规范化后的绝对前缀。
 * 异常：无。
 */
function stripSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 用途：读取 RSS_TOKEN；未设时回退旧的 ADMIN_TOKEN，方便已有 .env。
 * 入参：env。
 * 返回值：非空 token。
 * 异常：两者都缺时抛 Missing env: RSS_TOKEN。
 */
function rssTokenFrom(env: NodeJS.ProcessEnv): string {
  const value = env.RSS_TOKEN || env.ADMIN_TOKEN
  if (!value) {
    throw new Error('Missing env: RSS_TOKEN')
  }
  return value
}

/**
 * 用途：从给定 env 组装服务配置（不读 .env 文件）。
 * 入参：env、可选覆盖。
 * 返回值：完整 Config。
 * 异常：缺少 RSS_TOKEN / PUBLIC_BASE_URL 时抛错。
 */
export function parseConfig(env: NodeJS.ProcessEnv, overrides: Partial<Config> = {}): Config {
  const config: Config = {
    RSS_TOKEN: overrides.RSS_TOKEN ?? rssTokenFrom(env),
    PUBLIC_BASE_URL: stripSlash(overrides.PUBLIC_BASE_URL ?? requiredFrom(env, 'PUBLIC_BASE_URL')),
    PORT: overrides.PORT ?? Number(env.PORT ?? 8080),
    DATA_DIR: overrides.DATA_DIR ?? env.DATA_DIR ?? resolve(process.cwd(), 'data'),
    YTDLP_PATH: overrides.YTDLP_PATH ?? env.YTDLP_PATH ?? 'yt-dlp',
    YTDLP_COOKIES_FILE: overrides.YTDLP_COOKIES_FILE ?? env.YTDLP_COOKIES_FILE,
    YOUTUBE_API_KEY: overrides.YOUTUBE_API_KEY ?? env.YOUTUBE_API_KEY
  }

  if (!Number.isInteger(config.PORT) || config.PORT <= 0) {
    throw new Error('Invalid env: PORT')
  }
  if (config.RSS_TOKEN.length < 16) {
    console.warn('RSS_TOKEN 长度不足 16，建议使用更强的随机串')
  }

  mkdirSync(config.DATA_DIR, { recursive: true })
  return config
}

/**
 * 用途：读取 .env 后组装服务配置。
 * 入参：可选覆盖。
 * 返回值：完整 Config。
 * 异常：缺少必填项时抛 `Missing env: NAME`。
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  tryLoadEnvFiles([
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env')
  ])
  return parseConfig(process.env, overrides)
}

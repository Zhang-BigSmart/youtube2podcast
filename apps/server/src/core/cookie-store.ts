import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dataPaths } from './paths.js'

const NETSCAPE_HEADERS = ['# netscape http cookie file', '# http cookie file']

export type CookieStatus = {
  /** 是否已有可用的 cookie 文件。 */
  present: boolean
  /** 文件内的 cookie 条数；无文件时为 0。 */
  count: number
  /** 最早过期时间（ISO 字符串）；全部为会话 cookie 或无文件时为 null。 */
  earliestExpiresAt: string | null
  /** 文件最后写入时间（ISO 字符串）；无文件时为 null。 */
  updatedAt: string | null
}

/**
 * 用途：校验文本是否为 yt-dlp 可用的 Netscape cookie 文件。
 * 入参：待校验文本。
 * 返回值：有效记录条数。
 * 异常：首行不是 Netscape 头、或没有任何有效记录时抛错。
 */
export function assertNetscapeCookies(text: string): number {
  const lines = text.split('\n')
  const firstLine = lines[0]?.trim().toLowerCase() ?? ''
  if (!NETSCAPE_HEADERS.includes(firstLine)) {
    throw new Error('cookie 文件首行必须是 # Netscape HTTP Cookie File')
  }
  const count = countCookieLines(lines)
  if (count === 0) {
    throw new Error('cookie 文件没有任何有效记录')
  }
  return count
}

/**
 * 用途：统计 Netscape 文本里的有效 cookie 行。
 * 入参：按行拆分的文本。
 * 返回值：满足 7 列的记录条数。
 * 异常：无。
 */
function countCookieLines(lines: string[]): number {
  let count = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    // yt-dlp 用 #HttpOnly_ 前缀表示 httpOnly，它是有效记录而非注释。
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) {
      continue
    }
    if (rawLine.split('\t').length >= 7) {
      count += 1
    }
  }
  return count
}

/**
 * 用途：把 cookie 文本原子写入 DATA_DIR/cookies.txt，权限 0600。
 * 入参：dataDir、Netscape 格式文本。
 * 返回值：写入的记录条数。
 * 异常：文本非法时抛错；写盘失败时由 fs 抛出。
 * 边界：先写同目录临时文件再 rename，避免 yt-dlp 读到半截内容。
 */
export function writeCookies(dataDir: string, text: string): number {
  const count = assertNetscapeCookies(text)
  const target = dataPaths(dataDir).cookiesFile
  const temp = `${target}.tmp`
  const normalized = text.endsWith('\n') ? text : `${text}\n`
  try {
    writeFileSync(temp, normalized, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, target)
  } catch (error) {
    if (existsSync(temp)) {
      unlinkSync(temp)
    }
    throw error
  }
  return count
}

/**
 * 用途：读取 cookie 文件的概况，供插件展示，不回显内容。
 * 入参：dataDir。
 * 返回值：CookieStatus。
 * 异常：无；读失败按不存在处理。
 */
export function readCookieStatus(dataDir: string): CookieStatus {
  const target = dataPaths(dataDir).cookiesFile
  const empty: CookieStatus = { present: false, count: 0, earliestExpiresAt: null, updatedAt: null }
  if (!existsSync(target)) {
    return empty
  }
  try {
    const text = readFileSync(target, 'utf8')
    const lines = text.split('\n')
    const count = countCookieLines(lines)
    if (count === 0) {
      return empty
    }
    return {
      present: true,
      count,
      earliestExpiresAt: earliestExpiry(lines),
      updatedAt: statSync(target).mtime.toISOString()
    }
  } catch {
    return empty
  }
}

/**
 * 用途：找出最早的非零过期时间。
 * 入参：按行拆分的文本。
 * 返回值：ISO 字符串；没有带过期时间的记录时为 null。
 * 异常：无。
 */
function earliestExpiry(lines: string[]): string | null {
  let earliest = Number.POSITIVE_INFINITY
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) {
      continue
    }
    const fields = rawLine.split('\t')
    if (fields.length < 7) {
      continue
    }
    const expiry = Number(fields[4])
    if (Number.isFinite(expiry) && expiry > 0 && expiry < earliest) {
      earliest = expiry
    }
  }
  return Number.isFinite(earliest) ? new Date(earliest * 1000).toISOString() : null
}

/**
 * 用途：决定本次下载使用哪个 cookie 文件。
 * 入参：显式配置的 YTDLP_COOKIES_FILE（可为空）、dataDir。
 * 返回值：cookie 文件路径；都不可用时 undefined。
 * 异常：无。
 * 边界：显式配置优先并原样返回（不存在时由下载器报错）；否则仅在推送文件存在时使用。
 */
export function resolveCookiesFile(configured: string | undefined, dataDir: string): string | undefined {
  if (configured) {
    return configured
  }
  const pushed = dataPaths(dataDir).cookiesFile
  return existsSync(pushed) ? pushed : undefined
}

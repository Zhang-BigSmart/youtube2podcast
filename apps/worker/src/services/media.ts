import { isValidToken } from '../auth'
import { getEpisode } from '../db/episodes'
import type { Env } from '../env'
import { notFound } from '../responses'

export type ParsedRange = { start: number; end: number }

/**
 * 用途：解析 Range 头（测试与兼容保留；RSS 已改 Blob 直链）。
 * 入参：header、文件总大小。
 * 返回值：闭区间字节范围或 null。
 * 异常：无。非法或越界返回 null。
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange | null {
  if (!header) return null
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null

  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || end < start || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

/**
 * 用途：校验 RSS token 后 302 到 Blob 公开 URL。
 * 入参：request、env。
 * 返回值：302 或 404。
 * 异常：查库失败时向上抛。
 * 边界：无对应 episode 或 token 错误时统一 404，不暴露是否存在。
 */
export async function serveAudio(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const match = url.pathname.match(/\/media\/([^/]+)\/([^/]+)\/audio$/)
  if (!match) return notFound()

  const [, token, episodeId] = match
  if (!isValidToken(token, env.RSS_TOKEN)) return notFound()

  const episode = await getEpisode(env, episodeId)
  if (!episode) return notFound()

  return Response.redirect(episode.blob_audio_url, 302)
}

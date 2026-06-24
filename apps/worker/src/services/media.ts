import { isValidToken } from '../auth'
import { getEpisode } from '../db/episodes'
import type { Env } from '../env'
import { notFound } from '../responses'

export type ParsedRange = { start: number; end: number }

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

export async function serveAudio(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/media\/([^/]+)\/([^/]+)\/audio$/)
  if (!match) return notFound()

  const [, token, episodeId] = match
  if (!isValidToken(token, env.RSS_TOKEN)) return notFound()

  const episode = await getEpisode(env.DB, episodeId)
  if (!episode) return notFound()

  const head = await env.AUDIO_BUCKET.head(episode.r2_audio_key)
  if (!head) return notFound()

  const size = head.size
  const range = parseRangeHeader(request.headers.get('range'), size)
  const object = await env.AUDIO_BUCKET.get(
    episode.r2_audio_key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined
  )
  if (!object) return notFound()

  const headers = new Headers()
  headers.set('accept-ranges', 'bytes')
  headers.set('content-type', episode.audio_mime_type)
  headers.set('cache-control', 'private, max-age=3600')

  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
    headers.set('content-length', String(range.end - range.start + 1))
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
  }

  headers.set('content-length', String(size))
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

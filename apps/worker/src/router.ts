import type { Env, RuntimeContext } from './env.js'
import { isAuthorizedAdmin, isValidToken } from './auth.js'
import { json, notFound, text } from './responses.js'
import { parseYouTubeVideoId } from './youtube.js'
import { createId } from './ids.js'
import { getEpisodeByVideoId, listEpisodes } from './db/episodes.js'
import { getJob, incrementAttempt, insertJob, listJobs } from './db/jobs.js'
import { convertJob } from './services/converter.js'
import { importEpisode, type ImportEpisodeInput } from './services/import-episode.js'
import { renderRss } from './services/rss.js'
import { serveAudio } from './services/media.js'
import { createUploadToken } from './services/uploads.js'

/**
 * 用途：把 Vercel 重写后的 /api/rss、/api/media 还原成业务路径。
 * 入参：原始 pathname。
 * 返回值：供路由匹配的 pathname。
 * 异常：无。
 */
function normalizePath(pathname: string): string {
  if (pathname.startsWith('/api/rss/') || pathname.startsWith('/api/media/')) {
    return pathname.slice(4)
  }
  return pathname
}

/**
 * 用途：处理 RSS、媒体跳转和管理 API。
 * 入参：request、env、ctx（提交/重试后 waitUntil 继续转换）。
 * 返回值：HTTP Response。
 * 异常：不向外抛；校验失败以 4xx JSON 返回。
 * 边界：转换不阻塞 202；waitUntil 被掐断时 job 可能停在 pending，可走重试。
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: RuntimeContext
): Promise<Response> {
  const url = new URL(request.url)
  const pathname = normalizePath(url.pathname)

  if (pathname.startsWith('/rss/')) {
    const token = pathname.replace('/rss/', '').replace(/\.xml$/, '')
    if (!isValidToken(token, env.RSS_TOKEN)) return notFound()
    const episodes = await listEpisodes(env, 100)
    const origin = (env.PUBLIC_BASE_URL || url.origin).replace(/\/$/, '')
    return new Response(renderRss(episodes, `${origin}/youtube-icon.png`), {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  }

  if (pathname.startsWith('/media/')) {
    return serveAudio(request, env)
  }

  if (pathname.startsWith('/api/') && !isAuthorizedAdmin(request, env.ADMIN_TOKEN)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  if (request.method === 'POST' && pathname === '/api/uploads') {
    const body = await readJsonBody(request) as { kind?: string; videoId?: string; contentType?: string }
    const result = await createUploadToken(env, {
      kind: body.kind ?? '',
      videoId: body.videoId ?? '',
      contentType: body.contentType ?? ''
    })
    if (!result.ok) {
      return json({ error: result.error }, { status: result.status })
    }
    if ('alreadyExists' in result) {
      return json({ alreadyExists: true, episodeId: result.episodeId }, { status: 200 })
    }
    return json({ token: result.token, pathname: result.pathname }, { status: 200 })
  }

  if (request.method === 'POST' && pathname === '/api/jobs/import') {
    const body = await readJsonBody(request)
    const result = await importEpisode(env, body as ImportEpisodeInput)
    if (!result.ok) {
      return json({ error: result.error }, { status: result.status })
    }
    if ('alreadyExists' in result) {
      return json({ episodeId: result.episodeId, status: 'completed', alreadyExists: true }, { status: 200 })
    }
    return json({ episodeId: result.episodeId, jobId: result.jobId, status: 'completed' }, { status: 201 })
  }

  if (request.method === 'POST' && pathname === '/api/jobs') {
    const body = await request.json() as { youtubeUrl?: string }
    const youtubeUrl = body.youtubeUrl ?? ''
    const youtubeVideoId = parseYouTubeVideoId(youtubeUrl)
    if (!youtubeVideoId) return json({ error: 'invalid_youtube_url' }, { status: 400 })

    const existingEpisode = await getEpisodeByVideoId(env, youtubeVideoId)
    if (existingEpisode) {
      return json({ episodeId: existingEpisode.id, status: 'completed', alreadyExists: true }, { status: 200 })
    }

    const now = new Date().toISOString()
    const jobId = createId('job')
    await insertJob(env, {
      id: jobId,
      youtube_url: youtubeUrl,
      youtube_video_id: youtubeVideoId,
      status: 'pending',
      error_message: null,
      provider: null,
      attempt_count: 0,
      episode_id: null,
      created_at: now,
      updated_at: now,
      completed_at: null
    })
    ctx.waitUntil(convertJob(jobId, env))
    return json({ jobId, status: 'pending' }, { status: 202 })
  }

  if (request.method === 'GET' && pathname === '/api/jobs') {
    return json({ jobs: await listJobs(env) })
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/)
  if (request.method === 'GET' && jobMatch) {
    const job = await getJob(env, jobMatch[1])
    return job ? json(job) : notFound()
  }

  const retryMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/)
  if (request.method === 'POST' && retryMatch) {
    const job = await getJob(env, retryMatch[1])
    if (!job) return notFound()
    if (job.status !== 'failed') return json({ error: 'job_not_failed' }, { status: 409 })
    await incrementAttempt(env, job.id)
    ctx.waitUntil(convertJob(job.id, env))
    return json({ jobId: job.id, status: 'pending' })
  }

  if (request.method === 'GET' && pathname === '/api/episodes') {
    return json({ episodes: await listEpisodes(env) })
  }

  return text('YouTube2Podcast', { status: 200 })
}

/**
 * 用途：读取 JSON 请求体；空或非法时返回空对象。
 * 入参：Fetch Request。
 * 返回值：解析后的对象。
 * 异常：无；解析失败当空对象，由后续字段校验返回 400。
 */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json() as unknown
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

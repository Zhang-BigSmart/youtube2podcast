import type { Env } from './env'
import { isAuthorizedAdmin, isValidToken } from './auth'
import { json, notFound, text } from './responses'
import { parseYouTubeVideoId } from './youtube'
import { createId } from './ids'
import { getEpisodeByVideoId, listEpisodes } from './db/episodes'
import { getJob, incrementAttempt, insertJob, listJobs } from './db/jobs'
import { renderRss } from './services/rss'
import { serveAudio } from './services/media'

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/rss/')) {
    const token = url.pathname.replace('/rss/', '').replace(/\.xml$/, '')
    if (!isValidToken(token, env.RSS_TOKEN)) return notFound()
    const episodes = await listEpisodes(env.DB, 100)
    return new Response(renderRss(episodes, env), {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  }

  if (url.pathname.startsWith('/media/')) {
    return serveAudio(request, env)
  }

  if (url.pathname.startsWith('/api/') && !isAuthorizedAdmin(request, env.ADMIN_TOKEN)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  if (request.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await request.json<{ youtubeUrl?: string }>()
    const youtubeUrl = body.youtubeUrl ?? ''
    const youtubeVideoId = parseYouTubeVideoId(youtubeUrl)
    if (!youtubeVideoId) return json({ error: 'invalid_youtube_url' }, { status: 400 })

    const existingEpisode = await getEpisodeByVideoId(env.DB, youtubeVideoId)
    if (existingEpisode) {
      return json({ episodeId: existingEpisode.id, status: 'completed', alreadyExists: true }, { status: 200 })
    }

    const now = new Date().toISOString()
    const jobId = createId('job')
    await insertJob(env.DB, {
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
    await env.CONVERSION_QUEUE.send({ jobId })
    return json({ jobId, status: 'pending' }, { status: 202 })
  }

  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    return json({ jobs: await listJobs(env.DB) })
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
  if (request.method === 'GET' && jobMatch) {
    const job = await getJob(env.DB, jobMatch[1])
    return job ? json(job) : notFound()
  }

  const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/)
  if (request.method === 'POST' && retryMatch) {
    const job = await getJob(env.DB, retryMatch[1])
    if (!job) return notFound()
    if (job.status !== 'failed') return json({ error: 'job_not_failed' }, { status: 409 })
    await incrementAttempt(env.DB, job.id)
    await env.CONVERSION_QUEUE.send({ jobId: job.id })
    return json({ jobId: job.id, status: 'pending' })
  }

  if (request.method === 'GET' && url.pathname === '/api/episodes') {
    return json({ episodes: await listEpisodes(env.DB) })
  }

  return text('YouTube2Podcast worker', { status: 200 })
}

import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { createId } from '../core/ids.js'
import { parseYouTubeVideoId } from '../core/youtube-url.js'

/**
 * 用途：注册任务提交、查询与重试接口。
 * 入参：Hono app。
 * 返回值：无。
 * 异常：无。
 */
export function mountJobRoutes(app: Hono<{ Variables: { ctx: AppContext } }>): void {
  app.post('/api/jobs', async (c) => {
    const { db, enqueue } = c.get('ctx')
    const body = await c.req.json().catch(() => ({})) as { youtubeUrl?: string }
    const youtubeUrl = body.youtubeUrl?.trim() ?? ''
    const youtubeVideoId = parseYouTubeVideoId(youtubeUrl)
    if (!youtubeVideoId) {
      return c.json({ error: 'invalid_youtube_url' }, 400)
    }

    const existingEpisode = db.getEpisodeByVideoId(youtubeVideoId)
    if (existingEpisode) {
      return c.json({ episodeId: existingEpisode.id, status: 'completed', alreadyExists: true }, 200)
    }

    const active = db.getActiveJobByVideoId(youtubeVideoId)
    if (active) {
      return c.json({ jobId: active.id, status: active.status }, 202)
    }

    const now = new Date().toISOString()
    const jobId = createId('job')
    db.insertJob({
      id: jobId,
      youtube_url: youtubeUrl,
      youtube_video_id: youtubeVideoId,
      status: 'pending',
      error_kind: null,
      error_message: null,
      source: 'ytdlp',
      attempt_count: 0,
      episode_id: null,
      created_at: now,
      updated_at: now,
      completed_at: null
    })
    enqueue(jobId)
    return c.json({ jobId, status: 'pending' }, 202)
  })

  app.get('/api/jobs', (c) => {
    const { db } = c.get('ctx')
    return c.json({ jobs: db.listJobs() })
  })

  app.get('/api/jobs/:id', (c) => {
    const job = c.get('ctx').db.getJob(c.req.param('id'))
    if (!job) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.json(job)
  })

  app.post('/api/jobs/:id/retry', (c) => {
    const { db, enqueue } = c.get('ctx')
    const job = db.getJob(c.req.param('id'))
    if (!job) {
      return c.json({ error: 'not_found' }, 404)
    }
    if (job.status !== 'failed') {
      return c.json({ error: 'job_not_failed' }, 409)
    }
    db.incrementAttempt(job.id)
    enqueue(job.id)
    return c.json({ jobId: job.id, status: 'pending' })
  })
}

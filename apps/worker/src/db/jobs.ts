export type JobStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed'

export type JobRecord = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: JobStatus
  error_message: string | null
  provider: string | null
  attempt_count: number
  episode_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export async function insertJob(db: D1Database, job: JobRecord): Promise<void> {
  await db.prepare(
    `INSERT INTO jobs
     (id, youtube_url, youtube_video_id, status, error_message, provider, attempt_count, episode_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    job.id,
    job.youtube_url,
    job.youtube_video_id,
    job.status,
    job.error_message,
    job.provider,
    job.attempt_count,
    job.episode_id,
    job.created_at,
    job.updated_at,
    job.completed_at
  ).run()
}

export async function getJob(db: D1Database, id: string): Promise<JobRecord | null> {
  return await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRecord>()
}

export async function listJobs(db: D1Database, limit = 50): Promise<JobRecord[]> {
  const result = await db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').bind(limit).all<JobRecord>()
  return result.results ?? []
}

export async function updateJobStatus(
  db: D1Database,
  id: string,
  status: JobStatus,
  fields: { errorMessage?: string | null; episodeId?: string | null; provider?: string | null; completedAt?: string | null } = {}
): Promise<void> {
  const assignments = ['status = ?', 'updated_at = ?']
  const values: Array<string | null> = [status, new Date().toISOString()]

  if ('errorMessage' in fields) {
    assignments.push('error_message = ?')
    values.push(fields.errorMessage ?? null)
  }

  if ('episodeId' in fields) {
    assignments.push('episode_id = ?')
    values.push(fields.episodeId ?? null)
  }

  if ('provider' in fields) {
    assignments.push('provider = ?')
    values.push(fields.provider ?? null)
  }

  if ('completedAt' in fields) {
    assignments.push('completed_at = ?')
    values.push(fields.completedAt ?? null)
  }

  await db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`).bind(...values, id).run()
}

export async function incrementAttempt(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs
     SET attempt_count = attempt_count + 1, status = 'pending', error_message = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(new Date().toISOString(), id).run()
}

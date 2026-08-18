import type { Env } from '../env.js'
import { getSupabase } from '../env.js'

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

/**
 * 用途：把 PostgREST 错误转成异常。
 * 入参：Supabase error 或 null。
 * 返回值：无。
 * 异常：error 非空时抛出 message。
 */
function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/**
 * 用途：插入一条转换任务。
 * 入参：env、job 记录。
 * 返回值：无。
 * 异常：唯一约束冲突或网络失败时抛错。
 */
export async function insertJob(env: Env, job: JobRecord): Promise<void> {
  const { error } = await getSupabase(env).from('jobs').insert(job)
  throwIfError(error)
}

/**
 * 用途：按 id 读取任务。
 * 入参：env、任务 id。
 * 返回值：记录或 null。
 * 异常：查询失败时抛错。
 */
export async function getJob(env: Env, id: string): Promise<JobRecord | null> {
  const { data, error } = await getSupabase(env).from('jobs').select('*').eq('id', id).maybeSingle()
  throwIfError(error)
  return data as JobRecord | null
}

/**
 * 用途：列出最近任务。
 * 入参：env、条数上限（默认 50）。
 * 返回值：按 created_at 倒序的任务数组。
 * 异常：查询失败时抛错。
 */
export async function listJobs(env: Env, limit = 50): Promise<JobRecord[]> {
  const { data, error } = await getSupabase(env)
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  throwIfError(error)
  return (data ?? []) as JobRecord[]
}

/**
 * 用途：更新任务状态及可选字段。
 * 入参：env、id、status、可选 error/episode/provider/completedAt。
 * 返回值：无。
 * 异常：更新失败时抛错。
 * 边界：只写入传入的可选字段，未出现的键保持原值。
 */
export async function updateJobStatus(
  env: Env,
  id: string,
  status: JobStatus,
  fields: { errorMessage?: string | null; episodeId?: string | null; provider?: string | null; completedAt?: string | null } = {}
): Promise<void> {
  const patch: Record<string, string | null> = {
    status,
    updated_at: new Date().toISOString()
  }
  if ('errorMessage' in fields) patch.error_message = fields.errorMessage ?? null
  if ('episodeId' in fields) patch.episode_id = fields.episodeId ?? null
  if ('provider' in fields) patch.provider = fields.provider ?? null
  if ('completedAt' in fields) patch.completed_at = fields.completedAt ?? null

  const { error } = await getSupabase(env).from('jobs').update(patch).eq('id', id)
  throwIfError(error)
}

/**
 * 用途：失败重试时增加尝试次数并回到 pending。
 * 入参：env、任务 id。
 * 返回值：无。
 * 异常：任务不存在或更新失败时抛错。
 */
export async function incrementAttempt(env: Env, id: string): Promise<void> {
  const job = await getJob(env, id)
  if (!job) throw new Error(`Job not found: ${id}`)

  const { error } = await getSupabase(env).from('jobs').update({
    attempt_count: job.attempt_count + 1,
    status: 'pending',
    error_message: null,
    updated_at: new Date().toISOString()
  }).eq('id', id)
  throwIfError(error)
}

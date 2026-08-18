import type { Env } from '../env.js'
import { getSupabase } from '../env.js'

export type EpisodeRecord = {
  id: string
  youtube_video_id: string
  youtube_url: string
  title: string
  description: string
  channel_title: string
  thumbnail_url: string | null
  blob_audio_url: string
  blob_image_url: string | null
  audio_mime_type: string
  audio_file_size: number
  duration_seconds: number
  guid: string
  published_at: string
  created_at: string
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
 * 用途：写入一条可出现在 RSS 中的 episode。
 * 入参：env、episode 记录（含 Blob 音频 URL）。
 * 返回值：无。
 * 异常：youtube_video_id / guid 冲突或网络失败时抛错。
 */
export async function insertEpisode(env: Env, episode: EpisodeRecord): Promise<void> {
  const { error } = await getSupabase(env).from('episodes').insert(episode)
  throwIfError(error)
}

/**
 * 用途：按 episode id 读取。
 * 入参：env、episode id。
 * 返回值：记录或 null。
 * 异常：查询失败时抛错。
 */
export async function getEpisode(env: Env, id: string): Promise<EpisodeRecord | null> {
  const { data, error } = await getSupabase(env).from('episodes').select('*').eq('id', id).maybeSingle()
  throwIfError(error)
  return data as EpisodeRecord | null
}

/**
 * 用途：按 YouTube 视频 id 查重。
 * 入参：env、youtube_video_id。
 * 返回值：已存在的 episode 或 null。
 * 异常：查询失败时抛错。
 */
export async function getEpisodeByVideoId(env: Env, videoId: string): Promise<EpisodeRecord | null> {
  const { data, error } = await getSupabase(env)
    .from('episodes')
    .select('*')
    .eq('youtube_video_id', videoId)
    .maybeSingle()
  throwIfError(error)
  return data as EpisodeRecord | null
}

/**
 * 用途：列出最近 episode，供 RSS 与 H5。
 * 入参：env、条数上限（默认 100）。
 * 返回值：按 created_at 倒序的数组。
 * 异常：查询失败时抛错。
 */
export async function listEpisodes(env: Env, limit = 100): Promise<EpisodeRecord[]> {
  const { data, error } = await getSupabase(env)
    .from('episodes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  throwIfError(error)
  return (data ?? []) as EpisodeRecord[]
}

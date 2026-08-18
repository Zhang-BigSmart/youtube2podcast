import { put } from '@vercel/blob'
import type { Env } from '../env'
import { getJob, updateJobStatus } from '../db/jobs'
import { insertEpisode } from '../db/episodes'
import { createId } from '../ids'
import { createAudioProvider } from '../providers'
import type { AudioProviderResult } from '../providers/types'

type StoredAudio = { size: number; contentType: string; url: string }

/**
 * 用途：从临时 URL 拉取音频并写入 Vercel Blob。
 * 入参：pathname、下载 URL、缺省 Content-Type。
 * 返回值：Blob 公开 URL、字节数、Content-Type。
 * 异常：下载非 2xx 或没有 body、Blob 上传失败时抛错。
 */
async function uploadFromUrl(
  pathname: string,
  url: string,
  fallbackType: string
): Promise<StoredAudio> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download provider audio: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? fallbackType
  const bytes = Buffer.from(await response.arrayBuffer())
  const blob = await put(pathname, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: false
  })

  return {
    url: blob.url,
    size: bytes.byteLength,
    contentType
  }
}

/**
 * 用途：把供应商结果落到 Blob。优先用已拿到的字节，否则再 fetch 临时 URL。
 * 入参：pathname、供应商结果。
 * 返回值：公开 URL、文件大小、Content-Type。
 * 异常：既没有 audioBytes 也没有 audioDownloadUrl，或上传失败时抛错。
 */
async function storeAudio(pathname: string, result: AudioProviderResult): Promise<StoredAudio> {
  const fallbackType = result.audioMimeType ?? 'audio/mp4'
  if (result.audioBytes) {
    const blob = await put(pathname, Buffer.from(result.audioBytes), {
      access: 'public',
      contentType: fallbackType,
      addRandomSuffix: false
    })
    return {
      url: blob.url,
      size: result.audioFileSize ?? result.audioBytes.byteLength,
      contentType: fallbackType
    }
  }
  if (!result.audioDownloadUrl) {
    throw new Error('Audio provider result missing audioDownloadUrl and audioBytes')
  }
  return uploadFromUrl(pathname, result.audioDownloadUrl, fallbackType)
}

/**
 * 用途：执行一条转换任务：提取音频、转存 Blob、写入 episode。
 * 入参：jobId、Env。
 * 返回值：无。成功或失败都写回 Supabase 状态。
 * 异常：不向外抛；捕获后把 job 标为 failed。
 * 边界：已完成任务直接跳过；AUDIO_PROVIDER=rapidapi 时主失败会在供应商内部切备用。
 */
export async function convertJob(jobId: string, env: Env): Promise<void> {
  const job = await getJob(env, jobId)
  if (!job) return
  if (job.status === 'completed') return

  await updateJobStatus(env, job.id, 'processing', { errorMessage: null })

  try {
    const provider = createAudioProvider(env)
    const result = await provider.extract(job.youtube_url)
    await updateJobStatus(env, job.id, 'uploading', {
      provider: result.provider
    })

    const episodeId = createId('ep')
    const extension = result.audioMimeType === 'audio/mp4' ? 'm4a' : 'mp3'
    const pathname = `audio/${env.RSS_TOKEN}/${episodeId}.${extension}`
    const uploaded = await storeAudio(pathname, result)

    const now = new Date().toISOString()
    await insertEpisode(env, {
      id: episodeId,
      youtube_video_id: job.youtube_video_id,
      youtube_url: job.youtube_url,
      title: result.title ?? `YouTube ${job.youtube_video_id}`,
      description: result.description ?? job.youtube_url,
      channel_title: result.channelTitle ?? 'YouTube',
      thumbnail_url: result.thumbnailUrl ?? null,
      blob_audio_url: uploaded.url,
      blob_image_url: null,
      audio_mime_type: result.audioMimeType ?? uploaded.contentType,
      audio_file_size: result.audioFileSize ?? uploaded.size,
      duration_seconds: result.durationSeconds ?? 0,
      guid: `youtube:${job.youtube_video_id}`,
      published_at: now,
      created_at: now
    })

    await updateJobStatus(env, job.id, 'completed', {
      episodeId,
      completedAt: now,
      errorMessage: null
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversion error'
    await updateJobStatus(env, job.id, 'failed', { errorMessage: message })
  }
}

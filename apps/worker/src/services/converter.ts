import type { Env } from '../env'
import { getJob, updateJobStatus } from '../db/jobs'
import { insertEpisode } from '../db/episodes'
import { createId } from '../ids'
import { createAudioProvider } from '../providers'

async function uploadFromUrl(
  bucket: R2Bucket,
  key: string,
  url: string,
  fallbackType: string
): Promise<{ size: number; contentType: string }> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download provider audio: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? fallbackType
  const sizeHeader = response.headers.get('content-length')
  await bucket.put(key, response.body, {
    httpMetadata: { contentType }
  })

  return {
    size: sizeHeader ? Number(sizeHeader) : 0,
    contentType
  }
}

export async function convertJob(jobId: string, env: Env): Promise<void> {
  const job = await getJob(env.DB, jobId)
  if (!job) return
  if (job.status === 'completed') return

  const providerName = env.AUDIO_PROVIDER
  await updateJobStatus(env.DB, job.id, 'processing', { provider: providerName, errorMessage: null })

  try {
    const provider = createAudioProvider(env)
    const result = await provider.extract(job.youtube_url)
    await updateJobStatus(env.DB, job.id, 'uploading')

    const episodeId = createId('ep')
    const extension = result.audioMimeType === 'audio/mp4' ? 'm4a' : 'mp3'
    const audioKey = `audio/${episodeId}.${extension}`
    const uploaded = await uploadFromUrl(
      env.AUDIO_BUCKET,
      audioKey,
      result.audioDownloadUrl,
      result.audioMimeType ?? 'audio/mpeg'
    )

    const now = new Date().toISOString()
    await insertEpisode(env.DB, {
      id: episodeId,
      youtube_video_id: job.youtube_video_id,
      youtube_url: job.youtube_url,
      title: result.title ?? `YouTube ${job.youtube_video_id}`,
      description: result.description ?? job.youtube_url,
      channel_title: result.channelTitle ?? 'YouTube',
      thumbnail_url: result.thumbnailUrl ?? null,
      r2_audio_key: audioKey,
      r2_image_key: null,
      audio_mime_type: result.audioMimeType ?? uploaded.contentType,
      audio_file_size: result.audioFileSize ?? uploaded.size,
      duration_seconds: result.durationSeconds ?? 0,
      guid: `youtube:${job.youtube_video_id}`,
      published_at: now,
      created_at: now
    })

    await updateJobStatus(env.DB, job.id, 'completed', {
      episodeId,
      completedAt: now,
      errorMessage: null
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversion error'
    await updateJobStatus(env.DB, job.id, 'failed', { errorMessage: message })
  }
}

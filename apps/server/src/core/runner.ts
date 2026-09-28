import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../context.js'
import { resolveCookiesFile } from './cookie-store.js'
import { jpegFromThumbnailUrl } from './cover.js'
import { createId } from './ids.js'
import { putAudioFromFile, putCoverBytes } from './media-store.js'
import { dataPaths } from './paths.js'
import { DownloadError, downloadWithYtdlp } from './ytdlp.js'

/**
 * 用途：删除单个任务的临时目录。
 * 入参：dataDir、jobId。
 * 返回值：无。
 * 异常：无。
 */
function cleanupJobDir(dataDir: string, jobId: string): void {
  const dir = join(dataPaths(dataDir).tmpJobs, jobId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 用途：执行一条下载任务：yt-dlp 取音频、生成封面、入库。
 * 入参：jobId、AppContext。
 * 返回值：无。成功或失败都写回 jobs 状态。
 * 异常：不向外抛。
 * 边界：已完成或已有 episode 则直接标 completed；封面失败不阻断音频。
 */
export async function runJob(jobId: string, ctx: AppContext): Promise<void> {
  const job = ctx.db.getJob(jobId)
  if (!job) {
    return
  }
  if (job.status === 'completed') {
    return
  }

  const existing = ctx.db.getEpisodeByVideoId(job.youtube_video_id)
  if (existing) {
    ctx.db.updateJobStatus(jobId, 'completed', {
      episodeId: existing.id,
      completedAt: new Date().toISOString(),
      errorKind: null,
      errorMessage: null
    })
    return
  }

  ctx.db.updateJobStatus(jobId, 'processing', { errorKind: null, errorMessage: null, source: 'ytdlp' })
  ctx.db.updateJobProgress(jobId, 0, null)

  try {
    const download = ctx.downloadAudio ?? ((input) => downloadWithYtdlp({
      dataDir: ctx.config.DATA_DIR,
      ytdlpPath: ctx.config.YTDLP_PATH,
      cookiesFile: resolveCookiesFile(ctx.config.YTDLP_COOKIES_FILE, ctx.config.DATA_DIR),
      youtubeUrl: input.youtubeUrl,
      jobId: input.jobId,
      onProgress: input.onProgress
    }))
    const result = await download({
      youtubeUrl: job.youtube_url,
      jobId,
      onProgress: (downloaded, total) => {
        ctx.db.updateJobProgress(jobId, downloaded, total)
      }
    })
    const stored = putAudioFromFile(
      ctx.config.DATA_DIR,
      job.youtube_video_id,
      result.audioFilePath,
      result.audioMimeType
    )

    let imagePath: string | null = null
    const jpeg = await jpegFromThumbnailUrl(result.thumbnailUrl)
    if (jpeg) {
      imagePath = putCoverBytes(ctx.config.DATA_DIR, job.youtube_video_id, jpeg).path
    }

    const now = new Date().toISOString()
    const episodeId = createId('ep')
    ctx.db.insertEpisode({
      id: episodeId,
      youtube_video_id: job.youtube_video_id,
      youtube_url: job.youtube_url,
      title: result.title,
      description: result.description.trim() || job.youtube_url,
      channel_title: result.channelTitle,
      audio_path: stored.path,
      image_path: imagePath,
      audio_mime_type: result.audioMimeType,
      audio_file_size: stored.size,
      duration_seconds: result.durationSeconds,
      guid: `youtube:${job.youtube_video_id}`,
      published_at: now,
      created_at: now
    })
    ctx.db.updateJobStatus(jobId, 'completed', {
      episodeId,
      completedAt: now,
      errorKind: null,
      errorMessage: null,
      source: 'ytdlp'
    })
  } catch (error) {
    const kind = error instanceof DownloadError ? error.kind : 'retryable'
    const message = error instanceof Error ? error.message : 'Unknown conversion error'
    ctx.db.updateJobStatus(jobId, 'failed', {
      errorKind: kind,
      errorMessage: message.slice(0, 500)
    })
  } finally {
    cleanupJobDir(ctx.config.DATA_DIR, jobId)
  }
}

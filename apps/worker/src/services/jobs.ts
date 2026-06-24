import { createId } from '../ids'
import { parseYouTubeVideoId } from '../youtube'
import type { EpisodeRecord } from '../db/episodes'

export type CreateJobResult =
  | { ok: true; status: 202; jobId: string; youtubeVideoId: string }
  | { ok: true; status: 200; episodeId: string; youtubeVideoId: string; alreadyExists: true }
  | { ok: false; status: 400; error: 'invalid_youtube_url' }

export async function createJobResponse(input: {
  youtubeUrl: string
  existingEpisode: EpisodeRecord | null
  enqueue: (jobId: string) => Promise<void>
}): Promise<CreateJobResult> {
  const youtubeVideoId = parseYouTubeVideoId(input.youtubeUrl)
  if (!youtubeVideoId) {
    return { ok: false, status: 400, error: 'invalid_youtube_url' }
  }

  if (input.existingEpisode) {
    return {
      ok: true,
      status: 200,
      episodeId: input.existingEpisode.id,
      youtubeVideoId,
      alreadyExists: true
    }
  }

  const jobId = createId('job')
  await input.enqueue(jobId)
  return { ok: true, status: 202, jobId, youtubeVideoId }
}

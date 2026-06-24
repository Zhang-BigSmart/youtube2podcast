export type EpisodeRecord = {
  id: string
  youtube_video_id: string
  youtube_url: string
  title: string
  description: string
  channel_title: string
  thumbnail_url: string | null
  r2_audio_key: string
  r2_image_key: string | null
  audio_mime_type: string
  audio_file_size: number
  duration_seconds: number
  guid: string
  published_at: string
  created_at: string
}

export async function insertEpisode(db: D1Database, episode: EpisodeRecord): Promise<void> {
  await db.prepare(
    `INSERT INTO episodes
     (id, youtube_video_id, youtube_url, title, description, channel_title, thumbnail_url, r2_audio_key, r2_image_key,
      audio_mime_type, audio_file_size, duration_seconds, guid, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    episode.id,
    episode.youtube_video_id,
    episode.youtube_url,
    episode.title,
    episode.description,
    episode.channel_title,
    episode.thumbnail_url,
    episode.r2_audio_key,
    episode.r2_image_key,
    episode.audio_mime_type,
    episode.audio_file_size,
    episode.duration_seconds,
    episode.guid,
    episode.published_at,
    episode.created_at
  ).run()
}

export async function getEpisode(db: D1Database, id: string): Promise<EpisodeRecord | null> {
  return await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<EpisodeRecord>()
}

export async function getEpisodeByVideoId(db: D1Database, videoId: string): Promise<EpisodeRecord | null> {
  return await db.prepare('SELECT * FROM episodes WHERE youtube_video_id = ?').bind(videoId).first<EpisodeRecord>()
}

export async function listEpisodes(db: D1Database, limit = 100): Promise<EpisodeRecord[]> {
  const result = await db.prepare('SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?').bind(limit).all<EpisodeRecord>()
  return result.results ?? []
}

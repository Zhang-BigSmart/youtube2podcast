-- 在 Supabase SQL Editor 中执行。service_role 绕过 RLS，anon 无策略即不可访问。

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  youtube_url TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  provider TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  episode_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_youtube_video_id ON jobs (youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  thumbnail_url TEXT,
  blob_audio_url TEXT NOT NULL,
  blob_image_url TEXT,
  audio_mime_type TEXT NOT NULL,
  audio_file_size BIGINT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  guid TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON episodes (created_at);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

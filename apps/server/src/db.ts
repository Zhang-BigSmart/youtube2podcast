import { truncateEpisodeDescription } from './core/description.js'
import { ensureDataDirs, dataPaths } from './core/paths.js'

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown
  }
  close(): void
}

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { timeout?: number }) => SqliteDatabase
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ErrorKind = 'retryable' | 'login_required'
export type JobSource = 'ytdlp' | 'extension'

export type JobRecord = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: JobStatus
  error_kind: ErrorKind | null
  error_message: string | null
  source: JobSource
  attempt_count: number
  episode_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  progress_downloaded?: number | null
  progress_total?: number | null
}

export type EpisodeRecord = {
  id: string
  youtube_video_id: string
  youtube_url: string
  title: string
  description: string
  channel_title: string
  audio_path: string
  image_path: string | null
  audio_mime_type: string
  audio_file_size: number
  duration_seconds: number
  guid: string
  published_at: string
  created_at: string
}

export type UpdateJobFields = {
  errorKind?: ErrorKind | null
  errorMessage?: string | null
  episodeId?: string | null
  source?: JobSource
  completedAt?: string | null
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  youtube_url TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_kind TEXT,
  error_message TEXT,
  source TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  episode_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_video ON jobs (youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  image_path TEXT,
  audio_mime_type TEXT NOT NULL,
  audio_file_size INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  guid TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes (created_at);
`

/**
 * 用途：SQLite jobs / episodes 访问层。
 */
export class Db {
  constructor(private readonly database: SqliteDatabase) {}

  /**
   * 用途：插入一条转换任务。
   * 入参：job 记录。
   * 返回值：无。
   * 异常：主键冲突时抛错。
   */
  insertJob(job: JobRecord): void {
    this.database.prepare(`
      INSERT INTO jobs (
        id, youtube_url, youtube_video_id, status, error_kind, error_message,
        source, attempt_count, episode_id, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.youtube_url,
      job.youtube_video_id,
      job.status,
      job.error_kind,
      job.error_message,
      job.source,
      job.attempt_count,
      job.episode_id,
      job.created_at,
      job.updated_at,
      job.completed_at
    )
  }

  /**
   * 用途：按 id 读取任务。
   * 入参：任务 id。
   * 返回值：记录或 null。
   * 异常：无。
   */
  getJob(id: string): JobRecord | null {
    const row = this.database.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRecord | undefined
    return row ?? null
  }

  /**
   * 用途：列出最近任务。
   * 入参：条数上限（默认 50）。
   * 返回值：按 created_at 倒序的任务数组。
   * 异常：无。
   */
  listJobs(limit = 50): JobRecord[] {
    return this.database.prepare(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as JobRecord[]
  }

  /**
   * 用途：更新任务状态及可选字段。
   * 入参：id、status、可选 error/episode/source/completedAt。
   * 返回值：无。
   * 异常：无。
   * 边界：只写入传入的可选字段。
   */
  updateJobStatus(id: string, status: JobStatus, fields: UpdateJobFields = {}): void {
    const job = this.getJob(id)
    if (!job) {
      throw new Error(`Job not found: ${id}`)
    }
    this.database.prepare(`
      UPDATE jobs SET
        status = ?,
        error_kind = ?,
        error_message = ?,
        episode_id = ?,
        source = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      status,
      'errorKind' in fields ? fields.errorKind ?? null : job.error_kind,
      'errorMessage' in fields ? fields.errorMessage ?? null : job.error_message,
      'episodeId' in fields ? fields.episodeId ?? null : job.episode_id,
      fields.source ?? job.source,
      'completedAt' in fields ? fields.completedAt ?? null : job.completed_at,
      new Date().toISOString(),
      id
    )
  }

  /**
   * 用途：失败重试时增加尝试次数并回到 pending。
   * 入参：任务 id。
   * 返回值：无。
   * 异常：任务不存在时抛错。
   */
  incrementAttempt(id: string): void {
    const job = this.getJob(id)
    if (!job) {
      throw new Error(`Job not found: ${id}`)
    }
    this.database.prepare(`
      UPDATE jobs SET
        attempt_count = ?,
        status = 'pending',
        error_kind = NULL,
        error_message = NULL,
        progress_downloaded = NULL,
        progress_total = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(job.attempt_count + 1, new Date().toISOString(), id)
  }

  /**
   * 用途：写入 yt-dlp 下载进度，不改变任务状态。
   * 入参：任务 id、已下载字节、总字节（未知时为 null）。
   * 返回值：无。
   * 异常：任务不存在时抛错。
   */
  updateJobProgress(id: string, downloaded: number, total: number | null): void {
    const job = this.getJob(id)
    if (!job) {
      throw new Error(`Job not found: ${id}`)
    }
    this.database.prepare(`
      UPDATE jobs SET
        progress_downloaded = ?,
        progress_total = ?,
        updated_at = ?
      WHERE id = ?
    `).run(downloaded, total, new Date().toISOString(), id)
  }

  /**
   * 用途：列出未完成任务，供启动恢复。
   * 入参：无。
   * 返回值：pending / processing 的任务。
   * 异常：无。
   */
  listUnfinishedJobs(): JobRecord[] {
    return this.database.prepare(
      `SELECT * FROM jobs WHERE status IN ('pending', 'processing') ORDER BY created_at ASC`
    ).all() as JobRecord[]
  }

  /**
   * 用途：写入一条 RSS 单集。
   * 入参：episode 记录。
   * 返回值：无。
   * 异常：youtube_video_id / guid 冲突时抛错。
   * 边界：description 超过 4000 码点时截断后再入库。
   */
  insertEpisode(episode: EpisodeRecord): void {
    this.database.prepare(`
      INSERT INTO episodes (
        id, youtube_video_id, youtube_url, title, description, channel_title,
        audio_path, image_path, audio_mime_type, audio_file_size, duration_seconds,
        guid, published_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      episode.id,
      episode.youtube_video_id,
      episode.youtube_url,
      episode.title,
      truncateEpisodeDescription(episode.description),
      episode.channel_title,
      episode.audio_path,
      episode.image_path,
      episode.audio_mime_type,
      episode.audio_file_size,
      episode.duration_seconds,
      episode.guid,
      episode.published_at,
      episode.created_at
    )
  }

  /**
   * 用途：按 episode id 读取。
   * 入参：episode id。
   * 返回值：记录或 null。
   * 异常：无。
   */
  getEpisode(id: string): EpisodeRecord | null {
    const row = this.database.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as EpisodeRecord | undefined
    return row ?? null
  }

  /**
   * 用途：按 YouTube 视频 id 查重。
   * 入参：youtube_video_id。
   * 返回值：已存在的 episode 或 null。
   * 异常：无。
   */
  getEpisodeByVideoId(videoId: string): EpisodeRecord | null {
    const row = this.database.prepare(
      'SELECT * FROM episodes WHERE youtube_video_id = ?'
    ).get(videoId) as EpisodeRecord | undefined
    return row ?? null
  }

  /**
   * 用途：查找同一视频尚未结束的任务，避免重复入队。
   * 入参：youtube_video_id。
   * 返回值：pending/processing 的任务或 null。
   * 异常：无。
   */
  getActiveJobByVideoId(videoId: string): JobRecord | null {
    const row = this.database.prepare(
      `SELECT * FROM jobs WHERE youtube_video_id = ? AND status IN ('pending', 'processing') ORDER BY created_at DESC LIMIT 1`
    ).get(videoId) as JobRecord | undefined
    return row ?? null
  }

  /**
   * 用途：列出最近 episode，供 RSS 与管理页。
   * 入参：条数上限（默认 100）。
   * 返回值：按 created_at 倒序的数组。
   * 异常：无。
   */
  listEpisodes(limit = 100): EpisodeRecord[] {
    return this.database.prepare(
      'SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as EpisodeRecord[]
  }

  /**
   * 用途：关闭数据库连接。
   * 入参：无。
   * 返回值：无。
   * 异常：无。
   */
  close(): void {
    this.database.close()
  }
}

/**
 * 用途：执行 schema 迁移。
 * 入参：DatabaseSync。
 * 返回值：无。
 * 异常：SQL 失败时抛错。
 */
function migrate(database: SqliteDatabase): void {
  database.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = database.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined
  const current = row?.v ?? 0
  if (current < 1) {
    database.exec(SCHEMA_V1)
    database.prepare('INSERT INTO schema_version (version) VALUES (1)').run()
  }
  if (current < 2) {
    database.exec('ALTER TABLE jobs ADD COLUMN progress_downloaded INTEGER')
    database.exec('ALTER TABLE jobs ADD COLUMN progress_total INTEGER')
    database.prepare('INSERT INTO schema_version (version) VALUES (2)').run()
  }
}

/**
 * 用途：打开 DATA_DIR 下的 SQLite 并完成迁移。
 * 入参：dataDir。
 * 返回值：Db 实例。
 * 异常：无法写盘时抛错。
 */
export function openDb(dataDir: string): Db {
  ensureDataDirs(dataDir)
  const database = new DatabaseSync(dataPaths(dataDir).dbFile, { timeout: 5000 })
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA busy_timeout = 5000')
  migrate(database)
  return new Db(database)
}

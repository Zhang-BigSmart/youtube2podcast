import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../app.js'
import type { Config } from '../config.js'
import type { AppContext } from '../context.js'
import { JobQueue } from '../core/queue.js'
import { runJob } from '../core/runner.js'
import type { DownloadAudio, YtdlpResult } from '../core/ytdlp.js'
import { openDb, type Db } from '../db.js'

export const RSS_TOKEN = 'test-rss-token-12'
export const ADMIN_TOKEN = RSS_TOKEN
export const VIDEO_ID = 'v1wZwxY3CMg'

export type TestApp = {
  dataDir: string
  db: Db
  app: ReturnType<typeof createApp>
  config: Config
  queue: JobQueue
}

/**
 * 用途：在临时目录组装可请求的 Hono 应用，并接上串行队列。
 * 入参：可选 chunkSize、可选假下载器。
 * 返回值：app、db、dataDir、queue。
 * 异常：无。
 */
export function makeTestApp(chunkSize = 4, createDownload?: (dataDir: string) => DownloadAudio): TestApp {
  const dataDir = mkdtempSync(join(tmpdir(), 'y2p-'))
  const config: Config = {
    RSS_TOKEN,
    PUBLIC_BASE_URL: 'http://localhost:8080',
    PORT: 8080,
    DATA_DIR: dataDir,
    YTDLP_PATH: '/opt/ytdlp/yt-dlp'
  }
  const db = openDb(dataDir)
  const ctx: AppContext = {
    config,
    db,
    chunkSize,
    downloadAudio: createDownload?.(dataDir),
    enqueue: () => undefined,
    ytdlpVersion: 'test'
  }
  const queue = new JobQueue((jobId) => runJob(jobId, ctx))
  ctx.enqueue = (jobId) => queue.enqueue(jobId)
  return { dataDir, db, app: createApp(ctx), config, queue }
}

/**
 * 用途：测试用假下载器，写入一小段音频文件。
 * 入参：dataDir、可选覆盖字段、可选抛错。
 * 返回值：DownloadAudio。
 * 异常：failWith 存在时抛该错误。
 */
export function fakeDownload(
  dataDir: string,
  overrides: Partial<YtdlpResult> = {},
  failWith?: Error
): DownloadAudio {
  return async ({ jobId }) => {
    if (failWith) {
      throw failWith
    }
    const dir = join(dataDir, 'tmp', 'jobs', jobId)
    mkdirSync(dir, { recursive: true })
    const audioFilePath = join(dir, 'audio.m4a')
    writeFileSync(audioFilePath, 'fake-audio-bytes')
    return {
      audioFilePath,
      title: 'Fake Title',
      description: 'Fake description',
      channelTitle: 'Fake Channel',
      durationSeconds: 12,
      thumbnailUrl: null,
      audioMimeType: 'audio/mp4',
      ...overrides
    }
  }
}

/**
 * 用途：关闭库并删除临时目录。
 * 入参：TestApp。
 * 返回值：无。
 * 异常：无。
 */
export function destroyTestApp(testApp: TestApp): void {
  testApp.db.close()
  rmSync(testApp.dataDir, { recursive: true, force: true })
}

/**
 * 用途：带 RSS Token 的 fetch 初始化。
 * 入参：method、JSON body 或 raw body。
 * 返回值：RequestInit。
 * 异常：无。
 */
export function adminInit(method: string, body?: unknown, contentType = 'application/json'): RequestInit {
  const headers: Record<string, string> = { authorization: `Bearer ${ADMIN_TOKEN}` }
  if (body instanceof Uint8Array) {
    headers['content-type'] = contentType
    return { method, headers, body }
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    return { method, headers, body: JSON.stringify(body) }
  }
  return { method, headers }
}

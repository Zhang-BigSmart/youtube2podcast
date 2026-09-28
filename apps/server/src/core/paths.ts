import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 用途：返回 DATA_DIR 下的约定路径。
 * 入参：dataDir。
 * 返回值：数据库、媒体、临时目录路径。
 * 异常：无。
 */
export function dataPaths(dataDir: string) {
  return {
    dbFile: join(dataDir, 'y2p.db'),
    cookiesFile: join(dataDir, 'cookies.txt'),
    media: join(dataDir, 'media'),
    audio: join(dataDir, 'media', 'audio'),
    images: join(dataDir, 'media', 'images'),
    tmpJobs: join(dataDir, 'tmp', 'jobs'),
    tmpUploads: join(dataDir, 'tmp', 'uploads')
  }
}

/**
 * 用途：创建 DATA_DIR 布局（媒体与临时目录）。
 * 入参：dataDir。
 * 返回值：无。
 * 异常：无写权限时由 mkdirSync 抛错。
 */
export function ensureDataDirs(dataDir: string): void {
  const paths = dataPaths(dataDir)
  mkdirSync(paths.audio, { recursive: true })
  mkdirSync(paths.images, { recursive: true })
  mkdirSync(paths.tmpJobs, { recursive: true })
  mkdirSync(paths.tmpUploads, { recursive: true })
}

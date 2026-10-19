import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataPaths } from './paths.js'
import { cleanupExpiredUploads } from './chunk-store.js'

/**
 * 用途：启动时清空 yt-dlp 任务临时目录（残留下载）。
 * 入参：dataDir。
 * 返回值：无。
 * 异常：无。
 * 边界：仅在启动恢复队列前调用；运行期间由任务自己清理下载目录。
 */
export function cleanupJobTmp(dataDir: string): void {
  const root = dataPaths(dataDir).tmpJobs
  if (!existsSync(root)) return
  for (const name of readdirSync(root)) {
    rmSync(join(root, name), { recursive: true, force: true })
  }
}

/**
 * 用途：启动与定时清理过期分片会话。
 * 入参：dataDir。
 * 返回值：删掉的上传目录数。
 * 异常：无。
 * 边界：不清理下载任务目录，避免删除正在下载或等待入库的文件。
 */
export function cleanupTmp(dataDir: string): number {
  return cleanupExpiredUploads(dataDir)
}

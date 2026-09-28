import type { Config } from './config.js'
import type { DownloadAudio } from './core/ytdlp.js'
import type { Db } from './db.js'

export type AppContext = {
  config: Config
  db: Db
  enqueue: (jobId: string) => void
  /** 测试可注入更小分片；生产默认 64MB。 */
  chunkSize?: number
  /** 测试可注入假下载器；缺省走 yt-dlp。 */
  downloadAudio?: DownloadAudio
  /** 供 /api/meta 展示；启动后异步填入。 */
  ytdlpVersion?: string | null
}

export type AppVariables = {
  ctx: AppContext
}

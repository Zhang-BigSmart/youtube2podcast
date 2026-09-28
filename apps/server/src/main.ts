import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { cleanupTmp } from './core/cleanup.js'
import { ensureDataDirs } from './core/paths.js'
import { JobQueue } from './core/queue.js'
import { runJob } from './core/runner.js'
import { getYtdlpVersion, updateYtdlp } from './core/ytdlp.js'
import { openDb } from './db.js'

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * 用途：进程入口：读配置、建库、恢复队列、定时更新 yt-dlp、监听端口。
 * 入参：无。
 * 返回值：无。
 * 异常：缺环境变量时抛错退出。
 */
function main(): void {
  const config = loadConfig()
  ensureDataDirs(config.DATA_DIR)
  const db = openDb(config.DATA_DIR)
  cleanupTmp(config.DATA_DIR)

  const ctx: AppContext = {
    config,
    db,
    enqueue: () => undefined,
    ytdlpVersion: null
  }
  const queue = new JobQueue((jobId) => runJob(jobId, ctx))
  ctx.enqueue = (jobId) => queue.enqueue(jobId)
  queue.recover(db.listUnfinishedJobs().map((job) => job.id))

  const app = createApp(ctx)
  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`YouTube2Podcast listening on :${info.port}`)
  })

  setInterval(() => {
    cleanupTmp(config.DATA_DIR)
  }, 60 * 60 * 1000).unref()

  const maybeUpdate = (): void => {
    if (queue.isBusy()) {
      return
    }
    void updateYtdlp(config.YTDLP_PATH)
      .then(async () => {
        ctx.ytdlpVersion = await getYtdlpVersion(config.YTDLP_PATH)
      })
      .catch((error) => {
        console.warn('yt-dlp 更新失败', error instanceof Error ? error.message : error)
      })
  }
  void getYtdlpVersion(config.YTDLP_PATH).then((version) => {
    ctx.ytdlpVersion = version
  })
  maybeUpdate()
  setInterval(maybeUpdate, UPDATE_INTERVAL_MS).unref()
}

main()

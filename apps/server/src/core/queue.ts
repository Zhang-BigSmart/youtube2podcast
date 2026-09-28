/**
 * 用途：内存 FIFO 串行队列，并发固定为 1。
 * 入参：execute 为实际跑任务的函数。
 * 返回值：enqueue / recover / idle / isBusy。
 * 异常：execute 抛错时记录日志，不中断后续任务。
 */
export class JobQueue {
  private readonly pending: string[] = []
  private readonly waiters: Array<() => void> = []
  private running = false

  constructor(private readonly execute: (jobId: string) => Promise<void>) {}

  /**
   * 用途：当前是否有任务在跑或等待。
   * 入参：无。
   * 返回值：忙碌则为 true。
   * 异常：无。
   */
  isBusy(): boolean {
    return this.running || this.pending.length > 0
  }

  /**
   * 用途：把 jobId 追加到队列尾部并触发执行。
   * 入参：jobId。
   * 返回值：无。
   * 异常：无。
   */
  enqueue(jobId: string): void {
    this.pending.push(jobId)
    void this.pump()
  }

  /**
   * 用途：启动恢复，把未完成任务重新入队。
   * 入参：jobId 列表。
   * 返回值：无。
   * 异常：无。
   */
  recover(jobIds: string[]): void {
    for (const id of jobIds) {
      this.enqueue(id)
    }
  }

  /**
   * 用途：等待队列排空（测试用）。
   * 入参：无。
   * 返回值：排空后的 Promise。
   * 异常：无。
   */
  idle(): Promise<void> {
    if (!this.isBusy()) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  /**
   * 用途：串行消费队列。
   * 入参：无。
   * 返回值：无。
   * 异常：单任务失败不影响后续。
   */
  private async pump(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    while (this.pending.length > 0) {
      const jobId = this.pending.shift()
      if (!jobId) {
        continue
      }
      try {
        await this.execute(jobId)
      } catch (error) {
        console.error(`job ${jobId} crashed`, error)
      }
    }
    this.running = false
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter()
    }
  }
}

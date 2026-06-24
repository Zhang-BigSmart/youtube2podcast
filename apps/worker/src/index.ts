import type { ConversionMessage, Env } from './env'
import { handleRequest } from './router'
import { convertJob } from './services/converter'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },

  async queue(batch: MessageBatch<ConversionMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await convertJob(message.body.jobId, env)
      message.ack()
    }
  }
}

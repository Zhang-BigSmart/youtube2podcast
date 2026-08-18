import { vercelHandler } from '../apps/worker/src/vercel-handler.js'

export const config = { maxDuration: 300 }

/** 用途：GET/POST /api/jobs。入参/返回值/异常见 vercelHandler。 */
export default vercelHandler

import { vercelHandler } from '../apps/worker/src/vercel-handler.js'

export const config = { maxDuration: 60 }

/** 用途：POST /api/uploads，签发 Blob 客户端凭证。入参/返回值见 handleRequest。 */
export default vercelHandler

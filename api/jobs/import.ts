import { vercelHandler } from '../../apps/worker/src/vercel-handler.js'

export const config = { maxDuration: 60 }

/** 用途：POST /api/jobs/import，登记插件已上传的音频。入参/返回值见 handleRequest。 */
export default vercelHandler

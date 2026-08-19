/**
 * sandbox 页与 extract 页之间的 postMessage 协议。
 * sandbox 没有 chrome.*，只能执行 youtubei.js 抽出的 nsig 脚本。
 */
export const SANDBOX_READY = 'y2p-sandbox-ready'
export const SANDBOX_PING = 'y2p-sandbox-ping'
export const EVAL_REQUEST = 'y2p-eval-request'
export const EVAL_RESULT = 'y2p-eval-result'

export type SandboxReadyMessage = {
  type: typeof SANDBOX_READY
}

export type SandboxPingMessage = {
  type: typeof SANDBOX_PING
}

export type EvalRequestMessage = {
  type: typeof EVAL_REQUEST
  id: string
  output: string
}

export type EvalResultMessage = {
  type: typeof EVAL_RESULT
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

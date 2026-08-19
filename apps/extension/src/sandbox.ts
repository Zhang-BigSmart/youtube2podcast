const SANDBOX_READY = 'y2p-sandbox-ready'
const SANDBOX_PING = 'y2p-sandbox-ping'
const EVAL_REQUEST = 'y2p-eval-request'
const EVAL_RESULT = 'y2p-eval-result'

/**
 * 向父页报告 sandbox 已可执行 nsig。
 */
function announceReady(): void {
  window.parent.postMessage({ type: SANDBOX_READY }, '*')
}

/**
 * sandbox 页入口：用 Function 执行 youtubei.js 抽出的 nsig 脚本。
 * MV3 扩展页禁止 unsafe-eval，所以这段只能跑在 manifest.sandbox 页面里。
 * @param event 来自 extract 页的 ping 或 eval 请求
 */
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') {
    return
  }
  if (data.type === SANDBOX_PING) {
    announceReady()
    return
  }
  if (data.type !== EVAL_REQUEST || typeof data.id !== 'string') {
    return
  }
  const source = event.source as Window | null
  if (!source) {
    return
  }
  if (typeof data.output !== 'string') {
    source.postMessage(
      { type: EVAL_RESULT, id: data.id, ok: false, error: 'eval output 不是字符串' },
      '*'
    )
    return
  }
  try {
    const value = new Function(data.output)()
    source.postMessage({ type: EVAL_RESULT, id: data.id, ok: true, value }, '*')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    source.postMessage({ type: EVAL_RESULT, id: data.id, ok: false, error: message }, '*')
  }
})

announceReady()

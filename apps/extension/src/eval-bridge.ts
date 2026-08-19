import { Platform } from 'youtubei.js/web'
import type { Types } from 'youtubei.js/web'
import { EVAL_REQUEST, EVAL_RESULT, SANDBOX_PING, SANDBOX_READY } from './protocol'

const EVAL_TIMEOUT_MS = 15_000
const SANDBOX_READY_TIMEOUT_MS = 10_000

let sandboxWindow: Window | null = null
let sandboxReady = false
const pending = new Map<string, (result: { ok: boolean; value?: unknown; error?: string }) => void>()
let requestSeq = 0
let readyWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null

window.addEventListener('message', onSandboxMessage)

/**
 * 绑定 extract 页里的 sandbox iframe，并等待它发出就绪信号。
 * @param iframe 指向 sandbox.html 的 iframe
 * @returns 就绪后的 Promise
 * @throws 在超时时间内未收到就绪消息时抛错
 */
export function connectSandbox(iframe: HTMLIFrameElement): Promise<void> {
  const win = iframe.contentWindow
  if (!win) {
    return Promise.reject(new Error('sandbox iframe 没有 contentWindow'))
  }
  sandboxWindow = win
  if (sandboxReady) {
    return Promise.resolve()
  }
  win.postMessage({ type: SANDBOX_PING }, '*')
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      readyWaiter = null
      reject(new Error('sandbox 页就绪超时'))
    }, SANDBOX_READY_TIMEOUT_MS)
    readyWaiter = {
      resolve: () => {
        window.clearTimeout(timer)
        resolve()
      },
      reject
    }
  })
}

/**
 * youtubei.js 用的 fetch：必须绑在 window 上，否则会 Illegal invocation。
 * Origin / Cookie 由 background 的 DNR 规则改写，不经过 YouTube 标签页。
 * @param input 请求 URL 或 Request
 * @param init fetch 选项
 * @returns 网络响应
 */
export async function boundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(new Request(input, init))
}

/**
 * 安装浏览器里 youtubei.js 必需的 shim：绑定 fetch，并把 nsig 交给 sandbox。
 * 必须在 Innertube.create 之前调用。
 */
export function installYoutubeiEval(): void {
  Platform.shim.fetch = boundFetch
  Platform.shim.eval = async (data: Types.BuildScriptResult) => {
    return (await evalInSandbox(data.output)) as Types.EvalResult
  }
}

/**
 * 在 sandbox 中执行一段由 youtubei.js 生成的脚本。
 * @param output BuildScriptResult.output，末尾含 return process(...)
 * @returns 解密结果，通常含 n / sig
 * @throws sandbox 未连接、超时或脚本抛错
 */
function evalInSandbox(output: string): Promise<unknown> {
  if (!sandboxWindow) {
    throw new Error('sandbox 尚未连接')
  }
  const id = `eval-${++requestSeq}`
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('sandbox eval 超时'))
    }, EVAL_TIMEOUT_MS)
    pending.set(id, (result) => {
      window.clearTimeout(timer)
      if (result.ok) {
        resolve(result.value)
        return
      }
      reject(new Error(result.error || 'sandbox eval 失败'))
    })
    const target = sandboxWindow
    if (!target) {
      pending.delete(id)
      window.clearTimeout(timer)
      reject(new Error('sandbox 尚未连接'))
      return
    }
    target.postMessage({ type: EVAL_REQUEST, id, output }, '*')
  })
}

/**
 * 处理 sandbox 的就绪信号与 eval 回传。
 * @param event 来自 iframe 的 message
 */
function onSandboxMessage(event: MessageEvent): void {
  if (sandboxWindow && event.source !== sandboxWindow) {
    return
  }
  const data = event.data
  if (!data || typeof data !== 'object') {
    return
  }
  if (data.type === SANDBOX_READY) {
    sandboxReady = true
    if (!sandboxWindow && event.source) {
      sandboxWindow = event.source as Window
    }
    readyWaiter?.resolve()
    readyWaiter = null
    return
  }
  if (data.type !== EVAL_RESULT || typeof data.id !== 'string') {
    return
  }
  const settle = pending.get(data.id)
  if (!settle) {
    return
  }
  pending.delete(data.id)
  settle({ ok: Boolean(data.ok), value: data.value, error: data.error })
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { getEnv } from './env.js'
import { handleRequest } from './router.js'

/**
 * 用途：把 Vercel Node 的 req 转成 Fetch Request。
 * 入参：VercelRequest。
 * 返回值：带完整 URL 与 body 的 Request。
 * 异常：无。
 * 边界：GET/HEAD 不带 body；已解析的 JSON 会再 stringify。
 */
function toFetchRequest(req: VercelRequest): Request {
  const proto = headerValue(req.headers['x-forwarded-proto']) ?? 'https'
  const host = headerValue(req.headers['x-forwarded-host']) ?? headerValue(req.headers.host) ?? 'localhost'
  const url = `${proto}://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }

  const method = req.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }

  let body: BodyInit | undefined
  if (Buffer.isBuffer(req.body)) {
    body = new Uint8Array(req.body)
  } else if (typeof req.body === 'string') {
    body = req.body
  } else if (req.body != null) {
    body = JSON.stringify(req.body)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  }

  return new Request(url, { method, headers, body })
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * 用途：把 Fetch Response 写回 Vercel Node res。
 * 入参：VercelResponse、Fetch Response。
 * 返回值：无。
 * 异常：读 body 失败时抛错。
 */
async function writeFetchResponse(res: VercelResponse, response: Response): Promise<void> {
  res.status(response.status)
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

/**
 * 用途：Vercel Serverless 入口，转发到 handleRequest，并用 waitUntil 跑转换。
 * 入参：VercelRequest / VercelResponse。
 * 返回值：无（写入 res）。
 * 异常：缺环境变量或未捕获错误时由平台记 500。
 */
export async function vercelHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const request = toFetchRequest(req)
  const response = await handleRequest(request, getEnv(), {
    waitUntil: (promise) => {
      waitUntil(promise)
    }
  })
  await writeFetchResponse(res, response)
}

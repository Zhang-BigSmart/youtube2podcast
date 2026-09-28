import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * 用途：常量时间比较两个字符串（先哈希再比较，避免长度短路）。
 * 入参：actual、expected。
 * 返回值：是否相等。
 * 异常：无。
 */
export function isValidToken(actual: string, expected: string): boolean {
  if (!actual || !expected) {
    return false
  }
  const left = createHash('sha256').update(actual).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

/**
 * 用途：校验 Authorization: Bearer <RSS_TOKEN>。
 * 入参：request、rssToken。
 * 返回值：是否通过。
 * 异常：无。
 */
export function isAuthorizedAdmin(request: Request, rssToken: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) {
    return false
  }
  return isValidToken(header.slice(prefix.length), rssToken)
}

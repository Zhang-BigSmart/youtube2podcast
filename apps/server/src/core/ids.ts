/**
 * 用途：生成带前缀的随机 ID。
 * 入参：prefix，如 job / ep / up。
 * 返回值：`${prefix}_${uuid}`。
 * 异常：无。
 */
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

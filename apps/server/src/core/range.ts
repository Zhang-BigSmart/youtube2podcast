export type ParsedRange = { start: number; end: number }

/**
 * 用途：解析 HTTP Range 头中的单段字节区间。
 * 入参：header、文件总大小。
 * 返回值：闭区间字节范围；非法或越界返回 null。
 * 异常：无。
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange | null {
  if (!header) return null
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null

  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || end < start || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

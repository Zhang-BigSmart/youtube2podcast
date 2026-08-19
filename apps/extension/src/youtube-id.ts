const WATCH_ID = /(?:v=|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/
const SHORT_ID = /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/

/**
 * 从常见 YouTube URL 中解析 11 位视频 ID。
 * @param input 完整链接或纯视频 ID
 * @returns 视频 ID
 * @throws 无法识别时抛错
 */
export function parseVideoId(input: string): string {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed
  }
  const shortMatch = trimmed.match(SHORT_ID)
  if (shortMatch?.[1]) {
    return shortMatch[1]
  }
  try {
    const url = new URL(trimmed)
    const queryId = url.searchParams.get('v')
    if (queryId && /^[a-zA-Z0-9_-]{11}$/.test(queryId)) {
      return queryId
    }
  } catch {
    // 继续用路径正则
  }
  const pathMatch = trimmed.match(WATCH_ID)
  if (pathMatch?.[1]) {
    return pathMatch[1]
  }
  throw new Error('无法从输入解析 YouTube 视频 ID')
}

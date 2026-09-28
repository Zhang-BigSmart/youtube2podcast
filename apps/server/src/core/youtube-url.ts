export const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

/**
 * 用途：从 YouTube 链接或 11 位 ID 解析 videoId。
 * 入参：用户输入的 URL 或裸 ID。
 * 返回值：11 位 ID；无法识别时 null。
 * 异常：无。
 * 边界：支持 watch、youtu.be、shorts、live、embed。
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (
    host === 'youtube.com'
    || host === 'm.youtube.com'
    || host === 'music.youtube.com'
    || host === 'youtube-nocookie.com'
  ) {
    const fromQuery = url.searchParams.get('v')
    if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) {
      return fromQuery
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if (
      (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed')
      && parts[1]
      && VIDEO_ID_PATTERN.test(parts[1])
    ) {
      return parts[1]
    }
    return null
  }

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  return null
}

/**
 * 用途：生成入库用的规范观看链接。
 * 入参：原始输入、已解析 videoId。
 * 返回值：可打开的 watch URL；原始已是 URL 则保留。
 * 异常：无。
 */
export function canonicalYoutubeUrl(youtubeUrl: string, videoId: string): string {
  try {
    new URL(youtubeUrl)
    return youtubeUrl
  } catch {
    return `https://www.youtube.com/watch?v=${videoId}`
  }
}

const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'

/**
 * YouTube 官方元数据。
 * 用途：videos.list 返回的 episode 展示字段，供转换器优先于供应商结果使用。
 */
export type YouTubeVideoMetadata = {
  title: string
  description: string
  channelTitle: string
  /** 可用的最高分辨率封面 URL；视频无封面时为 null。 */
  thumbnailUrl: string | null
  durationSeconds: number
  /** 视频真实发布时间，ISO 8601 字符串。 */
  publishedAt: string
}

type ThumbnailEntry = { url?: string }

type VideosListResponse = {
  items?: Array<{
    snippet?: {
      title?: string
      description?: string
      channelTitle?: string
      publishedAt?: string
      thumbnails?: Record<string, ThumbnailEntry | undefined>
    }
    contentDetails?: {
      duration?: string
    }
  }>
}

/**
 * 用途：把 ISO 8601 时长（如 PT1H2M3S、P1DT2H）解析为秒。
 * 入参：contentDetails.duration 字符串。
 * 返回值：总秒数；无法解析时返回 0。
 */
export function parseIsoDuration(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (!match) return 0
  const [, days, hours, minutes, seconds] = match
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  )
}

/**
 * 用途：按分辨率从高到低挑选封面。
 * 入参：snippet.thumbnails 映射。
 * 返回值：封面 URL 或 null。
 */
function pickThumbnailUrl(thumbnails: Record<string, ThumbnailEntry | undefined> | undefined): string | null {
  if (!thumbnails) return null
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbnails[key]?.url
    if (url) return url
  }
  return null
}

/**
 * 用途：调 YouTube Data API v3 videos.list 获取单个视频的元数据。
 * 入参：11 位 videoId、YouTube Data API Key。
 * 返回值：标题、简介、频道名、封面、时长、发布时间。
 * 异常：HTTP 非 2xx，或视频不存在/不可见（items 为空）时抛错。
 * 边界：仅公开视频可用；消耗 1 配额单位（每日免费 10,000）。
 */
export async function fetchYouTubeVideoMetadata(videoId: string, apiKey: string): Promise<YouTubeVideoMetadata> {
  const endpoint = new URL(YOUTUBE_VIDEOS_ENDPOINT)
  endpoint.searchParams.set('part', 'snippet,contentDetails')
  endpoint.searchParams.set('id', videoId)
  endpoint.searchParams.set('key', apiKey)

  const response = await fetch(endpoint)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`youtube-data-api failed with HTTP ${response.status}: ${body.slice(0, 300)}`)
  }

  const data = await response.json() as VideosListResponse
  const item = data.items?.[0]
  if (!item?.snippet) {
    throw new Error(`youtube-data-api returned no video for id ${videoId}`)
  }

  return {
    title: item.snippet.title ?? '',
    description: item.snippet.description ?? '',
    channelTitle: item.snippet.channelTitle ?? '',
    thumbnailUrl: pickThumbnailUrl(item.snippet.thumbnails),
    durationSeconds: parseIsoDuration(item.contentDetails?.duration ?? ''),
    publishedAt: item.snippet.publishedAt ?? ''
  }
}

import { truncateEpisodeDescription } from './description.js'

export type RssEpisode = {
  title: string
  description: string
  channel_title: string
  audio_url: string
  image_url: string | null
  audio_mime_type: string
  audio_file_size: number
  duration_seconds: number
  guid: string
  published_at: string
}

/**
 * 用途：把特殊字符转成 XML 实体。
 * 入参：原始字符串。
 * 返回值：可放入 XML 文本/属性的字符串。
 * 异常：无。
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 用途：把秒数格式化为 itunes:duration 的 HH:MM:SS。
 * 入参：秒数。
 * 返回值：补零后的时分秒。
 * 异常：无。
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * 用途：把 episode 列表渲染成 Apple Podcasts 可用的 RSS 2.0。
 * 入参：episodes（已解析绝对 URL）；channelImageUrl 为节目总封面。
 * 返回值：RSS XML 字符串。
 * 异常：无。
 * 边界：无封面时省略 itunes:image；未传 channelImageUrl 时不输出频道封面；
 * 单集 description 超过 4000 码点时截断后再写入。
 */
export function renderRss(episodes: RssEpisode[], channelImageUrl?: string): string {
  const items = episodes.map((episode) => {
    const episodeImage = episode.image_url
      ? `<itunes:image href="${escapeXml(episode.image_url)}" />`
      : ''

    return `
      <item>
        <title>${escapeXml(episode.title)}</title>
        <description>${escapeXml(truncateEpisodeDescription(episode.description))}</description>
        <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
        <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>
        <itunes:duration>${formatDuration(episode.duration_seconds)}</itunes:duration>
        <itunes:author>${escapeXml(episode.channel_title)}</itunes:author>
        ${episodeImage}
        <enclosure url="${escapeXml(episode.audio_url)}" length="${episode.audio_file_size}" type="${escapeXml(episode.audio_mime_type)}" />
      </item>`
  }).join('')

  const channelImage = channelImageUrl
    ? `<itunes:image href="${escapeXml(channelImageUrl)}" />
    <image>
      <url>${escapeXml(channelImageUrl)}</url>
      <title>YouTube2Podcast</title>
      <link>https://www.youtube.com/</link>
    </image>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>YouTube2Podcast</title>
    <description>Private YouTube audio feed</description>
    <language>zh-cn</language>
    <itunes:author>YouTube2Podcast</itunes:author>
    ${channelImage}
    ${items}
  </channel>
</rss>`
}

import type { EpisodeRecord } from '../db/episodes.js'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * 用途：把 episode 列表渲染成 Apple Podcasts 可用的 RSS 2.0。
 * 入参：episodes（enclosure 使用 Blob 公开 URL）。
 * 返回值：RSS XML 字符串。
 * 异常：无。
 * 边界：音频不经本服务代理，播放器直连 Blob。
 */
export function renderRss(episodes: EpisodeRecord[]): string {
  const items = episodes.map((episode) => {
    const episodeImage = episode.thumbnail_url
      ? `<itunes:image href="${escapeXml(episode.thumbnail_url)}" />`
      : ''

    return `
      <item>
        <title>${escapeXml(episode.title)}</title>
        <description>${escapeXml(episode.description)}</description>
        <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
        <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>
        <itunes:duration>${formatDuration(episode.duration_seconds)}</itunes:duration>
        <itunes:author>${escapeXml(episode.channel_title)}</itunes:author>
        ${episodeImage}
        <enclosure url="${escapeXml(episode.blob_audio_url)}" length="${episode.audio_file_size}" type="${escapeXml(episode.audio_mime_type)}" />
      </item>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>YouTube2Podcast</title>
    <description>Private YouTube audio feed</description>
    <language>zh-cn</language>
    <itunes:author>YouTube2Podcast</itunes:author>
    ${items}
  </channel>
</rss>`
}

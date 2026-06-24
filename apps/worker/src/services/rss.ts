import type { Env } from '../env'
import type { EpisodeRecord } from '../db/episodes'

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

export function renderRss(episodes: EpisodeRecord[], env: Pick<Env, 'PUBLIC_BASE_URL' | 'RSS_TOKEN'>): string {
  const items = episodes.map((episode) => {
    const audioUrl = `${env.PUBLIC_BASE_URL}/media/${env.RSS_TOKEN}/${episode.id}/audio`
    return `
      <item>
        <title>${escapeXml(episode.title)}</title>
        <description>${escapeXml(episode.description)}</description>
        <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
        <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>
        <itunes:duration>${formatDuration(episode.duration_seconds)}</itunes:duration>
        <itunes:author>${escapeXml(episode.channel_title)}</itunes:author>
        <enclosure url="${escapeXml(audioUrl)}" length="${episode.audio_file_size}" type="${escapeXml(episode.audio_mime_type)}" />
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

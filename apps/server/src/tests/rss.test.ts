import { describe, expect, it } from 'vitest'
import { renderRss } from '../core/rss-render.js'

describe('renderRss', () => {
  it('renders podcast rss with enclosure', () => {
    const rss = renderRss([
      {
        title: 'Test Episode',
        description: 'A test episode',
        channel_title: 'Test Channel',
        audio_url: 'http://localhost:8080/media/rss-secret/ep_1/audio',
        image_url: null,
        audio_mime_type: 'audio/mp4',
        audio_file_size: 1234,
        duration_seconds: 60,
        guid: 'youtube:v1wZwxY3CMg',
        published_at: '2026-06-24T00:00:00.000Z'
      }
    ])

    expect(rss).toContain('<rss version="2.0"')
    expect(rss).toContain('<title>Test Episode</title>')
    expect(rss).toContain('url="http://localhost:8080/media/rss-secret/ep_1/audio"')
    expect(rss).toContain('type="audio/mp4"')
    expect(rss).toContain('length="1234"')
  })
})

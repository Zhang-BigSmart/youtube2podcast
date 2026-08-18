import { describe, expect, it } from 'vitest'
import { renderRss } from '../services/rss'

describe('renderRss', () => {
  it('renders podcast rss with enclosure', () => {
    const rss = renderRss([
      {
        id: 'ep_1',
        youtube_video_id: 'v1wZwxY3CMg',
        youtube_url: 'https://www.youtube.com/watch?v=v1wZwxY3CMg',
        title: 'Test Episode',
        description: 'A test episode',
        channel_title: 'Test Channel',
        thumbnail_url: null,
        blob_audio_url: 'https://blob.example/audio/rss-secret/ep_1.mp3',
        blob_image_url: null,
        audio_mime_type: 'audio/mpeg',
        audio_file_size: 1234,
        duration_seconds: 60,
        guid: 'youtube:v1wZwxY3CMg',
        published_at: '2026-06-24T00:00:00.000Z',
        created_at: '2026-06-24T00:00:00.000Z'
      }
    ])

    expect(rss).toContain('<rss version="2.0"')
    expect(rss).toContain('<title>Test Episode</title>')
    expect(rss).toContain('url="https://blob.example/audio/rss-secret/ep_1.mp3"')
    expect(rss).toContain('type="audio/mpeg"')
    expect(rss).toContain('length="1234"')
  })
})

import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
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
        r2_audio_key: 'audio/ep_1.mp3',
        r2_image_key: null,
        audio_mime_type: 'audio/mpeg',
        audio_file_size: 1234,
        duration_seconds: 60,
        guid: 'youtube:v1wZwxY3CMg',
        published_at: '2026-06-24T00:00:00.000Z',
        created_at: '2026-06-24T00:00:00.000Z'
      }
    ], {
      PUBLIC_BASE_URL: 'https://pod.example.com',
      RSS_TOKEN: 'rss-secret'
    } as Env)

    expect(rss).toContain('<rss version="2.0"')
    expect(rss).toContain('<title>Test Episode</title>')
    expect(rss).toContain('url="https://pod.example.com/media/rss-secret/ep_1/audio"')
    expect(rss).toContain('type="audio/mpeg"')
    expect(rss).toContain('length="1234"')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createJobResponse } from '../services/jobs'

describe('createJobResponse', () => {
  it('returns invalid_youtube_url for bad URLs', async () => {
    const result = await createJobResponse({
      youtubeUrl: 'https://example.com/nope',
      existingEpisode: null,
      enqueue: vi.fn()
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected invalid YouTube URL result')
    }

    expect(result.status).toBe(400)
    expect(result.error).toBe('invalid_youtube_url')
  })
})

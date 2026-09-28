import { describe, expect, it } from 'vitest'
import { parseYouTubeVideoId } from '../core/youtube-url.js'

describe('parseYouTubeVideoId', () => {
  it('parses watch URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('parses short youtu.be URLs', () => {
    expect(parseYouTubeVideoId('https://youtu.be/v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('parses shorts URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('parses bare video ids', () => {
    expect(parseYouTubeVideoId('v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('rejects playlist-only URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/playlist?list=abc')).toBeNull()
  })

  it('rejects non-youtube URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=v1wZwxY3CMg')).toBeNull()
  })
})

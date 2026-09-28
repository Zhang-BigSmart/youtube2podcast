import { afterEach, describe, expect, it } from 'vitest'
import { destroyTestApp, makeTestApp, type TestApp } from './helpers.js'

describe('Db', () => {
  let testApp: TestApp

  afterEach(() => {
    if (testApp) destroyTestApp(testApp)
  })

  it('inserts and reads jobs and episodes', () => {
    testApp = makeTestApp()
    const now = new Date().toISOString()
    testApp.db.insertJob({
      id: 'job_1',
      youtube_url: 'https://www.youtube.com/watch?v=v1wZwxY3CMg',
      youtube_video_id: 'v1wZwxY3CMg',
      status: 'completed',
      error_kind: null,
      error_message: null,
      source: 'extension',
      attempt_count: 1,
      episode_id: 'ep_1',
      created_at: now,
      updated_at: now,
      completed_at: now
    })
    testApp.db.insertEpisode({
      id: 'ep_1',
      youtube_video_id: 'v1wZwxY3CMg',
      youtube_url: 'https://www.youtube.com/watch?v=v1wZwxY3CMg',
      title: 'Hello',
      description: 'Desc',
      channel_title: 'Ch',
      audio_path: 'media/audio/v1wZwxY3CMg.m4a',
      image_path: null,
      audio_mime_type: 'audio/mp4',
      audio_file_size: 10,
      duration_seconds: 1,
      guid: 'youtube:v1wZwxY3CMg',
      published_at: now,
      created_at: now
    })

    expect(testApp.db.getJob('job_1')?.status).toBe('completed')
    expect(testApp.db.getEpisodeByVideoId('v1wZwxY3CMg')?.title).toBe('Hello')
    expect(testApp.db.listEpisodes()).toHaveLength(1)
  })
})

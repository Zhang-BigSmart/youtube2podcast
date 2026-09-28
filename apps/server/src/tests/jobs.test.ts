import { afterEach, describe, expect, it } from 'vitest'
import { DownloadError } from '../core/ytdlp.js'
import { adminInit, destroyTestApp, fakeDownload, makeTestApp, VIDEO_ID, type TestApp } from './helpers.js'

describe('jobs download pipeline', () => {
  let testApp: TestApp

  afterEach(() => {
    if (testApp) destroyTestApp(testApp)
  })

  it('rejects invalid youtube urls', async () => {
    testApp = makeTestApp()
    const res = await testApp.app.request('/api/jobs', adminInit('POST', {
      youtubeUrl: 'https://example.com/nope'
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_youtube_url' })
  })

  it('downloads via fake downloader and completes the job', async () => {
    testApp = makeTestApp(4, (dir) => fakeDownload(dir))
    const res = await testApp.app.request('/api/jobs', adminInit('POST', {
      youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`
    }))
    expect(res.status).toBe(202)
    const body = await res.json() as { jobId: string; status: string }
    expect(body.status).toBe('pending')
    await testApp.queue.idle()

    const job = testApp.db.getJob(body.jobId)
    expect(job?.status).toBe('completed')
    expect(job?.source).toBe('ytdlp')
    const episode = testApp.db.getEpisodeByVideoId(VIDEO_ID)
    expect(episode?.title).toBe('Fake Title')
    expect(episode?.audio_file_size).toBeGreaterThan(0)

    const again = await testApp.app.request('/api/jobs', adminInit('POST', {
      youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`
    }))
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ alreadyExists: true, episodeId: episode?.id })
  })

  it('records login_required and succeeds on retry', async () => {
    let shouldFail = true
    testApp = makeTestApp(4, (dir) => {
      return async (input) => {
        if (shouldFail) {
          throw new DownloadError('login_required', 'Sign in to confirm your age')
        }
        return fakeDownload(dir)(input)
      }
    })

    const res = await testApp.app.request('/api/jobs', adminInit('POST', {
      youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`
    }))
    const body = await res.json() as { jobId: string }
    await testApp.queue.idle()
    expect(testApp.db.getJob(body.jobId)?.error_kind).toBe('login_required')
    expect(testApp.db.getJob(body.jobId)?.status).toBe('failed')

    shouldFail = false
    const retry = await testApp.app.request(`/api/jobs/${body.jobId}/retry`, adminInit('POST'))
    expect(retry.status).toBe(200)
    await testApp.queue.idle()
    expect(testApp.db.getJob(body.jobId)?.status).toBe('completed')
  })
})

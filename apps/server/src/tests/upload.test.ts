import { afterEach, describe, expect, it } from 'vitest'
import { adminInit, destroyTestApp, makeTestApp, RSS_TOKEN, VIDEO_ID, type TestApp } from './helpers.js'

describe('upload import rss media', () => {
  let testApp: TestApp

  afterEach(() => {
    if (testApp) destroyTestApp(testApp)
  })

  it('rejects api without token', async () => {
    testApp = makeTestApp()
    const res = await testApp.app.request('/api/episodes')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('uploads three chunks out of order then imports and serves range', async () => {
    testApp = makeTestApp(4)
    const payload = Buffer.from('abcdefghij')

    const init = await testApp.app.request('/api/upload/init', adminInit('POST', {
      kind: 'audio',
      videoId: VIDEO_ID,
      contentType: 'audio/mp4',
      totalSize: payload.length
    }))
    expect(init.status).toBe(200)
    const initBody = await init.json() as { uploadId: string; totalChunks: number }
    expect(initBody.totalChunks).toBe(3)

    const missing = await testApp.app.request('/api/upload/complete', adminInit('POST', {
      uploadId: initBody.uploadId
    }))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'upload_incomplete' })

    for (const index of [2, 0, 1]) {
      const start = index * 4
      const part = payload.subarray(start, Math.min(start + 4, payload.length))
      const chunkRes = await testApp.app.request(
        `/api/upload/chunk?uploadId=${initBody.uploadId}&index=${index}`,
        adminInit('PUT', part, 'application/octet-stream')
      )
      expect(chunkRes.status).toBe(200)
    }

    const complete = await testApp.app.request('/api/upload/complete', adminInit('POST', {
      uploadId: initBody.uploadId
    }))
    expect(complete.status).toBe(200)
    const completeBody = await complete.json() as { path: string }
    expect(completeBody.path).toBe(`media/audio/${VIDEO_ID}.m4a`)

    const imported = await testApp.app.request('/api/jobs/import', adminInit('POST', {
      youtubeUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      youtubeVideoId: VIDEO_ID,
      title: 'Test Episode',
      description: 'A test episode',
      channelTitle: 'Test Channel',
      durationSeconds: 60,
      audioPath: completeBody.path,
      audioMimeType: 'audio/mp4',
      audioFileSize: payload.length
    }))
    expect(imported.status).toBe(201)
    const importedBody = await imported.json() as { episodeId: string }

    const again = await testApp.app.request('/api/upload/init', adminInit('POST', {
      kind: 'audio',
      videoId: VIDEO_ID,
      contentType: 'audio/mp4',
      totalSize: payload.length
    }))
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ alreadyExists: true, episodeId: importedBody.episodeId })

    const dup = await testApp.app.request('/api/jobs/import', adminInit('POST', {
      youtubeVideoId: VIDEO_ID,
      audioPath: completeBody.path,
      audioMimeType: 'audio/mp4',
      audioFileSize: payload.length
    }))
    expect(dup.status).toBe(200)
    expect(await dup.json()).toMatchObject({ alreadyExists: true, episodeId: importedBody.episodeId })

    const rss = await testApp.app.request(`/rss/${RSS_TOKEN}.xml`)
    expect(rss.status).toBe(200)
    const xml = await rss.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain(`http://localhost:8080/media/${RSS_TOKEN}/${importedBody.episodeId}/audio`)
    expect(xml).toContain('http://localhost:8080/podcast-cover.png')

    const badRss = await testApp.app.request('/rss/wrong-token.xml')
    expect(badRss.status).toBe(404)

    const ranged = await testApp.app.request(`/media/${RSS_TOKEN}/${importedBody.episodeId}/audio`, {
      headers: { Range: 'bytes=0-3' }
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe('bytes 0-3/10')
    expect(Buffer.from(await ranged.arrayBuffer()).toString()).toBe('abcd')

    const full = await testApp.app.request(`/media/${RSS_TOKEN}/${importedBody.episodeId}/audio`)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await full.arrayBuffer()).equals(payload)).toBe(true)

    const over = await testApp.app.request(`/media/${RSS_TOKEN}/${importedBody.episodeId}/audio`, {
      headers: { Range: 'bytes=200-300' }
    })
    expect(over.status).toBe(416)

    const health = await testApp.app.request('/healthz')
    expect(health.status).toBe(200)
  })
})

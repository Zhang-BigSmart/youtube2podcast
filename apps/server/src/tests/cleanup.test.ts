import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupJobTmp, cleanupTmp } from '../core/cleanup.js'
import { initUpload, uploadDir, writeUploadMeta } from '../core/chunk-store.js'
import { dataPaths, ensureDataDirs } from '../core/paths.js'

describe('temporary file cleanup', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'y2p-cleanup-'))
    ensureDataDirs(dataDir)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('removes expired uploads while keeping resumable uploads', () => {
    const expired = initUpload(dataDir, {
      kind: 'audio', videoId: 'v1wZwxY3CMg', contentType: 'audio/mp4', totalSize: 4
    })
    writeUploadMeta(dataDir, { ...expired, createdAt: Date.now() - 25 * 60 * 60 * 1000 })
    const fresh = initUpload(dataDir, {
      kind: 'audio', videoId: 'dQw4w9WgXcQ', contentType: 'audio/mp4', totalSize: 4
    })
    const freshPart = join(uploadDir(dataDir, fresh.uploadId), '0.part')
    writeFileSync(freshPart, 'abcd')

    expect(cleanupTmp(dataDir)).toBe(1)
    expect(existsSync(uploadDir(dataDir, expired.uploadId))).toBe(false)
    expect(readFileSync(freshPart, 'utf8')).toBe('abcd')
  })

  it('clears abandoned downloads at startup without removing saved media or uploads', () => {
    const paths = dataPaths(dataDir)
    const abandonedJob = join(paths.tmpJobs, 'job_abandoned')
    mkdirSync(abandonedJob)
    writeFileSync(join(abandonedJob, 'audio.m4a.part'), 'partial')
    const savedAudio = join(paths.audio, 'saved.m4a')
    writeFileSync(savedAudio, 'saved-audio')
    const upload = initUpload(dataDir, {
      kind: 'audio', videoId: 'v1wZwxY3CMg', contentType: 'audio/mp4', totalSize: 4
    })
    const uploadPart = join(uploadDir(dataDir, upload.uploadId), '0.part')
    writeFileSync(uploadPart, 'abcd')

    cleanupJobTmp(dataDir)

    expect(existsSync(abandonedJob)).toBe(false)
    expect(readFileSync(savedAudio, 'utf8')).toBe('saved-audio')
    expect(readFileSync(uploadPart, 'utf8')).toBe('abcd')
  })
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupExpiredUploads,
  completeUpload,
  initUpload,
  listReceived,
  writeChunk
} from '../core/chunk-store.js'
import { ensureDataDirs } from '../core/paths.js'

const VIDEO_ID = 'v1wZwxY3CMg'

/**
 * 用途：把 Buffer 转成 Web ReadableStream。
 * 入参：字节。
 * 返回值：ReadableStream。
 * 异常：无。
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>
}

describe('chunk-store', () => {
  let dataDir: string

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('assembles out-of-order chunks', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'y2p-chunk-'))
    ensureDataDirs(dataDir)
    const payload = Buffer.from('abcdefghij')
    const meta = initUpload(
      dataDir,
      { kind: 'audio', videoId: VIDEO_ID, contentType: 'audio/mp4', totalSize: payload.length },
      4
    )
    expect(meta.totalChunks).toBe(3)

    await writeChunk(dataDir, meta.uploadId, 2, streamOf(payload.subarray(8)))
    await writeChunk(dataDir, meta.uploadId, 0, streamOf(payload.subarray(0, 4)))
    await writeChunk(dataDir, meta.uploadId, 1, streamOf(payload.subarray(4, 8)))
    expect(listReceived(dataDir, meta.uploadId)).toEqual([0, 1, 2])

    const stored = completeUpload(dataDir, meta.uploadId)
    expect(stored.path).toBe(`media/audio/${VIDEO_ID}.m4a`)
    expect(stored.size).toBe(10)
  })

  it('rejects complete when a chunk is missing', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'y2p-chunk-'))
    ensureDataDirs(dataDir)
    const meta = initUpload(
      dataDir,
      { kind: 'audio', videoId: VIDEO_ID, contentType: 'audio/mp4', totalSize: 10 },
      4
    )
    writeFileSync(join(dataDir, 'tmp', 'uploads', meta.uploadId, '0.part'), 'abcd')
    expect(() => completeUpload(dataDir, meta.uploadId)).toThrow('upload_incomplete')
  })

  it('deletes expired upload dirs', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'y2p-chunk-'))
    ensureDataDirs(dataDir)
    const meta = initUpload(
      dataDir,
      { kind: 'audio', videoId: VIDEO_ID, contentType: 'audio/mp4', totalSize: 4 },
      4
    )
    const deleted = cleanupExpiredUploads(dataDir, meta.createdAt + 25 * 60 * 60 * 1000)
    expect(deleted).toBe(1)
  })
})

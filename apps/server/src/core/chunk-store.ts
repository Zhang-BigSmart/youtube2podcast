import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dataPaths } from './paths.js'
import { canonicalAudioPath, canonicalCoverPath, putAudioFromFile, putCoverBytes } from './media-store.js'

export const DEFAULT_CHUNK_SIZE = 64 * 1024 * 1024
export const AUDIO_MAX_BYTES = 500 * 1024 * 1024
export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export const AUDIO_CONTENT_TYPES = new Set([
  'audio/mp4',
  'audio/webm',
  'audio/mpeg',
  'video/mp4'
])

export type UploadKind = 'audio' | 'cover'

export type UploadMeta = {
  uploadId: string
  kind: UploadKind
  videoId: string
  contentType: string
  totalSize: number
  chunkSize: number
  totalChunks: number
  createdAt: number
}

/**
 * 用途：按 kind + videoId 生成幂等 uploadId，便于断点续传。
 * 入参：kind、videoId。
 * 返回值：up_<kind>_<videoId>。
 * 异常：无。
 */
export function uploadIdFor(kind: UploadKind, videoId: string): string {
  return `up_${kind}_${videoId}`
}

/**
 * 用途：计算分片数。
 * 入参：totalSize、chunkSize。
 * 返回值：至少 1。
 * 异常：无。
 */
export function totalChunksOf(totalSize: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(totalSize / chunkSize))
}

/**
 * 用途：某分片的期望字节数。
 * 入参：meta、index。
 * 返回值：非末片为 chunkSize，末片为余数。
 * 异常：无。
 */
export function expectedChunkSize(meta: UploadMeta, index: number): number {
  if (index < meta.totalChunks - 1) {
    return meta.chunkSize
  }
  return meta.totalSize - meta.chunkSize * (meta.totalChunks - 1)
}

/**
 * 用途：返回上传会话目录。
 * 入参：dataDir、uploadId。
 * 返回值：绝对路径。
 * 异常：无。
 */
export function uploadDir(dataDir: string, uploadId: string): string {
  return join(dataPaths(dataDir).tmpUploads, uploadId)
}

/**
 * 用途：读取上传会话元数据。
 * 入参：dataDir、uploadId。
 * 返回值：meta；不存在时 null。
 * 异常：JSON 损坏时抛错。
 */
export function readUploadMeta(dataDir: string, uploadId: string): UploadMeta | null {
  const file = join(uploadDir(dataDir, uploadId), 'meta.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as UploadMeta
}

/**
 * 用途：写入上传会话元数据。
 * 入参：dataDir、meta。
 * 返回值：无。
 * 异常：写盘失败时抛错。
 */
export function writeUploadMeta(dataDir: string, meta: UploadMeta): void {
  const dir = uploadDir(dataDir, meta.uploadId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
}

/**
 * 用途：创建或复用未完成的上传会话。
 * 入参：dataDir、会话字段、chunkSize。
 * 返回值：meta（已存在且参数一致则复用）。
 * 异常：无。
 * 边界：已有会话但 totalSize/contentType 不一致时覆盖重建。
 */
export function initUpload(
  dataDir: string,
  input: { kind: UploadKind; videoId: string; contentType: string; totalSize: number },
  chunkSize = DEFAULT_CHUNK_SIZE
): UploadMeta {
  const uploadId = uploadIdFor(input.kind, input.videoId)
  const existing = readUploadMeta(dataDir, uploadId)
  if (
    existing
    && existing.kind === input.kind
    && existing.videoId === input.videoId
    && existing.contentType === input.contentType
    && existing.totalSize === input.totalSize
    && existing.chunkSize === chunkSize
  ) {
    return existing
  }
  if (existing) {
    rmSync(uploadDir(dataDir, uploadId), { recursive: true, force: true })
  }
  const meta: UploadMeta = {
    uploadId,
    kind: input.kind,
    videoId: input.videoId,
    contentType: input.contentType,
    totalSize: input.totalSize,
    chunkSize,
    totalChunks: totalChunksOf(input.totalSize, chunkSize),
    createdAt: Date.now()
  }
  writeUploadMeta(dataDir, meta)
  return meta
}

/**
 * 用途：列出已收到的分片下标。
 * 入参：dataDir、uploadId。
 * 返回值：升序 index 数组。
 * 异常：无。
 */
export function listReceived(dataDir: string, uploadId: string): number[] {
  const dir = uploadDir(dataDir, uploadId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.part'))
    .map((name) => Number(name.replace(/\.part$/, '')))
    .filter((index) => Number.isInteger(index))
    .sort((a, b) => a - b)
}

/**
 * 用途：把请求体流式写入指定分片。
 * 入参：dataDir、uploadId、index、Web ReadableStream。
 * 返回值：写入后的字节数。
 * 异常：目录不存在或写盘失败时抛错。
 */
export async function writeChunk(
  dataDir: string,
  uploadId: string,
  index: number,
  body: ReadableStream<Uint8Array>
): Promise<number> {
  const dir = uploadDir(dataDir, uploadId)
  mkdirSync(dir, { recursive: true })
  const partPath = join(dir, `${index}.part`)
  await pipeline(Readable.fromWeb(body), createWriteStream(partPath))
  return statSync(partPath).size
}

/**
 * 用途：校验分片齐全后按序拼成媒体文件。
 * 入参：dataDir、uploadId。
 * 返回值：落盘后的相对路径。
 * 异常：缺片、尺寸不符时抛带 code 的 Error。
 */
export function completeUpload(dataDir: string, uploadId: string): { path: string; size: number } {
  const meta = readUploadMeta(dataDir, uploadId)
  if (!meta) {
    throw Object.assign(new Error('upload_not_found'), { code: 'upload_not_found' })
  }
  const received = listReceived(dataDir, uploadId)
  if (received.length !== meta.totalChunks) {
    throw Object.assign(new Error('upload_incomplete'), { code: 'upload_incomplete' })
  }
  for (let i = 0; i < meta.totalChunks; i++) {
    if (!received.includes(i)) {
      throw Object.assign(new Error('upload_incomplete'), { code: 'upload_incomplete' })
    }
    const partPath = join(uploadDir(dataDir, uploadId), `${i}.part`)
    const size = statSync(partPath).size
    if (size !== expectedChunkSize(meta, i)) {
      throw Object.assign(new Error('invalid_chunk'), { code: 'invalid_chunk' })
    }
  }

  const assembled = join(uploadDir(dataDir, uploadId), 'assembled.bin')
  writeFileSync(assembled, Buffer.alloc(0))
  for (let i = 0; i < meta.totalChunks; i++) {
    const part = readFileSync(join(uploadDir(dataDir, uploadId), `${i}.part`))
    writeFileSync(assembled, part, { flag: 'a' })
  }
  const size = statSync(assembled).size
  if (size !== meta.totalSize) {
    throw Object.assign(new Error('invalid_chunk'), { code: 'invalid_chunk' })
  }

  let stored: { path: string; size: number }
  if (meta.kind === 'cover') {
    stored = putCoverBytes(dataDir, meta.videoId, readFileSync(assembled))
  } else {
    stored = putAudioFromFile(dataDir, meta.videoId, assembled, meta.contentType)
  }
  rmSync(uploadDir(dataDir, uploadId), { recursive: true, force: true })
  return stored
}

/**
 * 用途：删除超过 TTL 的未完成上传目录。
 * 入参：dataDir、now、ttlMs。
 * 返回值：删掉的目录数。
 * 异常：无。
 */
export function cleanupExpiredUploads(
  dataDir: string,
  now = Date.now(),
  ttlMs = UPLOAD_TTL_MS
): number {
  const root = dataPaths(dataDir).tmpUploads
  if (!existsSync(root)) return 0
  let deleted = 0
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    const metaFile = join(dir, 'meta.json')
    let createdAt = 0
    if (existsSync(metaFile)) {
      try {
        createdAt = (JSON.parse(readFileSync(metaFile, 'utf8')) as UploadMeta).createdAt
      } catch {
        createdAt = 0
      }
    } else {
      createdAt = statSync(dir).mtimeMs
    }
    if (createdAt < now - ttlMs) {
      rmSync(dir, { recursive: true, force: true })
      deleted += 1
    }
  }
  return deleted
}

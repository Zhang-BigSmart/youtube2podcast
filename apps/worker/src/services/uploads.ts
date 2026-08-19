import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import type { Env } from '../env.js'
import { getEpisodeByVideoId } from '../db/episodes.js'

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/
const AUDIO_MAX_BYTES = 500 * 1024 * 1024
const COVER_MAX_BYTES = 5 * 1024 * 1024

export type UploadKind = 'audio' | 'cover'

export type CreateUploadTokenInput = {
  kind: string
  videoId: string
  contentType: string
}

export type CreateUploadTokenResult =
  | { ok: true; status: 200; alreadyExists: true; episodeId: string }
  | { ok: true; status: 200; token: string; pathname: string }
  | { ok: false; status: 400; error: string }

/**
 * 用途：按视频 ID 生成插件可直传的 Blob pathname。
 * 入参：RSS token、音频或封面、视频 ID、Content-Type。
 * 返回值：store 内路径。
 * 异常：无。
 */
export function buildUploadPathname(
  rssToken: string,
  kind: UploadKind,
  videoId: string,
  contentType: string
): string {
  if (kind === 'cover') {
    return `images/${rssToken}/${videoId}.jpg`
  }
  return `audio/${rssToken}/${videoId}.${audioExtension(contentType)}`
}

/**
 * 用途：签发插件直传 Vercel Blob 的客户端凭证。
 * 入参：env、kind / videoId / contentType。
 * 返回值：token+pathname，或已存在 episode，或校验错误。
 * 异常：缺少 BLOB_READ_WRITE_TOKEN 或签发失败时向上抛。
 * 边界：pathname 含 RSS_TOKEN，插件不能指定任意路径；同 videoId 已入库则不再签发。
 */
export async function createUploadToken(
  env: Env,
  input: CreateUploadTokenInput
): Promise<CreateUploadTokenResult> {
  if (input.kind !== 'audio' && input.kind !== 'cover') {
    return { ok: false, status: 400, error: 'invalid_kind' }
  }
  if (!VIDEO_ID_PATTERN.test(input.videoId)) {
    return { ok: false, status: 400, error: 'invalid_video_id' }
  }
  const contentType = input.contentType.split(';')[0]?.trim() ?? ''
  if (!contentType) {
    return { ok: false, status: 400, error: 'invalid_content_type' }
  }
  if (input.kind === 'cover' && contentType !== 'image/jpeg') {
    return { ok: false, status: 400, error: 'invalid_content_type' }
  }

  const existing = await getEpisodeByVideoId(env, input.videoId)
  if (existing) {
    return { ok: true, status: 200, alreadyExists: true, episodeId: existing.id }
  }

  const pathname = buildUploadPathname(env.RSS_TOKEN, input.kind, input.videoId, contentType)
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: input.kind === 'cover' ? COVER_MAX_BYTES : AUDIO_MAX_BYTES,
    addRandomSuffix: false,
    allowOverwrite: true,
    validUntil: Date.now() + 60 * 60 * 1000
  })
  return { ok: true, status: 200, token, pathname }
}

/**
 * 用途：按 MIME 选音频文件后缀。
 * 入参：Content-Type。
 * 返回值：m4a / mp3 / webm / mp4 / bin。
 */
function audioExtension(contentType: string): string {
  if (contentType.includes('mpeg')) return 'mp3'
  if (contentType.includes('webm')) return 'webm'
  if (contentType === 'video/mp4') return 'mp4'
  if (contentType.includes('mp4')) return 'm4a'
  return 'bin'
}

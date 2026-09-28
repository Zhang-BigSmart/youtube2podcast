import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { dataPaths } from './paths.js'

/**
 * 用途：按音频 MIME 选文件后缀。
 * 入参：Content-Type。
 * 返回值：m4a / webm / mp3 / mp4。
 * 异常：未知类型时抛 invalid_content_type。
 */
export function audioExtension(contentType: string): string {
  if (contentType.includes('mpeg')) return 'mp3'
  if (contentType.includes('webm')) return 'webm'
  if (contentType === 'video/mp4') return 'mp4'
  if (contentType.includes('mp4')) return 'm4a'
  throw new Error('invalid_content_type')
}

/**
 * 用途：生成音频相对 DATA_DIR 的规范路径。
 * 入参：videoId、contentType。
 * 返回值：如 media/audio/<videoId>.m4a。
 * 异常：未知 MIME 时抛错。
 */
export function canonicalAudioPath(videoId: string, contentType: string): string {
  return `media/audio/${videoId}.${audioExtension(contentType)}`
}

/**
 * 用途：生成封面相对路径。
 * 入参：videoId。
 * 返回值：media/images/<videoId>.jpg。
 * 异常：无。
 */
export function canonicalCoverPath(videoId: string): string {
  return `media/images/${videoId}.jpg`
}

/**
 * 用途：把相对路径解析到 DATA_DIR 内，拒绝目录穿越。
 * 入参：dataDir、relativePath。
 * 返回值：绝对路径。
 * 异常：路径逃出 DATA_DIR 时抛错。
 */
export function resolveUnderData(dataDir: string, relativePath: string): string {
  const root = resolve(dataDir)
  const abs = resolve(dataDir, relativePath)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error('path_escape')
  }
  return abs
}

/**
 * 用途：把已落盘的音频文件移到规范媒体路径（同卷优先 rename）。
 * 入参：dataDir、videoId、源文件绝对路径、contentType。
 * 返回值：相对路径与字节数。
 * 异常：源文件不存在或 MIME 非法时抛错。
 */
export function putAudioFromFile(
  dataDir: string,
  videoId: string,
  srcPath: string,
  contentType: string
): { path: string; size: number } {
  const relativePath = canonicalAudioPath(videoId, contentType)
  const dest = resolveUnderData(dataDir, relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  try {
    renameSync(srcPath, dest)
  } catch {
    copyFileSync(srcPath, dest)
  }
  return { path: relativePath, size: statSync(dest).size }
}

/**
 * 用途：把封面 JPEG 写入规范路径。
 * 入参：dataDir、videoId、JPEG 字节。
 * 返回值：相对路径与字节数。
 * 异常：无写权限时抛错。
 */
export function putCoverBytes(
  dataDir: string,
  videoId: string,
  jpeg: Buffer
): { path: string; size: number } {
  const relativePath = canonicalCoverPath(videoId)
  const dest = resolveUnderData(dataDir, relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, jpeg)
  return { path: relativePath, size: jpeg.byteLength }
}

/**
 * 用途：确认相对路径对应的文件存在。
 * 入参：dataDir、relativePath。
 * 返回值：绝对路径；不存在返回 null。
 * 异常：路径逃逸时抛错。
 */
export function existingMediaFile(dataDir: string, relativePath: string): string | null {
  const abs = resolveUnderData(dataDir, relativePath)
  if (!existsSync(abs)) return null
  return abs
}

/**
 * 用途：把绝对路径转成 POSIX 风格的 DATA_DIR 相对路径（测试辅助）。
 * 入参：dataDir、absPath。
 * 返回值：相对路径。
 * 异常：无。
 */
export function toRelative(dataDir: string, absPath: string): string {
  return relative(dataDir, absPath).split(sep).join('/')
}

/**
 * 用途：确保媒体目录存在。
 * 入参：dataDir。
 * 返回值：无。
 * 异常：无。
 */
export function ensureMediaDirs(dataDir: string): void {
  const paths = dataPaths(dataDir)
  mkdirSync(paths.audio, { recursive: true })
  mkdirSync(paths.images, { recursive: true })
}

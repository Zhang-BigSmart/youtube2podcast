import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ErrorKind } from '../db.js'
import { dataPaths } from './paths.js'

const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const SHORT_TIMEOUT_MS = 120 * 1000
const PROGRESS_THROTTLE_MS = 400
const PROGRESS_TEMPLATE = 'download:Y2PPROG:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s'

export type YtdlpResult = {
  audioFilePath: string
  title: string
  description: string
  channelTitle: string
  durationSeconds: number
  thumbnailUrl: string | null
  audioMimeType: string
}

export class DownloadError extends Error {
  readonly kind: ErrorKind

  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.name = 'DownloadError'
    this.kind = kind
  }
}

/** 下载进度回调：已下载字节、总字节（未知为 null）。 */
export type DownloadProgress = (downloaded: number, total: number | null) => void

export type DownloadAudioInput = {
  youtubeUrl: string
  jobId: string
  onProgress?: DownloadProgress
}

export type DownloadAudio = (input: DownloadAudioInput) => Promise<YtdlpResult>

const LOGIN_PATTERNS = [
  /sign in to confirm/i,
  /please (sign|log) in/i,
  /age.?restrict/i,
  /members.?only/i,
  /private video/i,
  /this video is private/i,
  /join this channel/i,
  /login required/i,
  /use --cookies/i,
  /--cookies-from-browser/i
]

/**
 * 用途：根据 yt-dlp stderr 判断失败类型。
 * 入参：stderr 文本。
 * 返回值：login_required 或 retryable。
 * 异常：无。
 */
export function classifyYtdlpError(stderr: string): ErrorKind {
  return LOGIN_PATTERNS.some((pattern) => pattern.test(stderr)) ? 'login_required' : 'retryable'
}

/**
 * 用途：按文件后缀推断音频 MIME。
 * 入参：扩展名（可带点）。
 * 返回值：audio/mp4、audio/webm、audio/mpeg 或 video/mp4。
 * 异常：无。
 */
export function mimeFromExt(ext: string): string {
  const value = ext.replace(/^\./, '').toLowerCase()
  if (value === 'mp3' || value === 'mpeg') return 'audio/mpeg'
  if (value === 'webm' || value === 'opus') return 'audio/webm'
  if (value === 'mp4') return 'video/mp4'
  return 'audio/mp4'
}

type ProcessResult = {
  stdout: string
  stderr: string
  code: number | null
}

/**
 * 用途：spawn 子进程并收集输出，超时则 SIGKILL。
 * 入参：可执行文件、参数、超时、工作目录、可选进度行回调（stdout/stderr 都会扫）。
 * 返回值：stdout/stderr/退出码。
 * 异常：启动失败时抛 retryable DownloadError。
 */
function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string; onProgressLine?: (line: string) => void }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reject(new DownloadError('retryable', message))
      return
    }

    let stdout = ''
    let stderr = ''
    let stdoutBuf = ''
    let stderrBuf = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    /**
     * 用途：把一块输出拆成行并交给进度回调。
     * 入参：新到的文本、当前行缓冲。
     * 返回值：尚未成行的剩余文本。
     * 异常：无。
     */
    const feedLines = (chunk: string, buffer: string): string => {
      if (!options.onProgressLine) {
        return ''
      }
      const merged = buffer + chunk
      const lines = merged.split(/\r|\n/)
      const rest = lines.pop() ?? ''
      for (const line of lines) {
        if (line) {
          options.onProgressLine(line)
        }
      }
      return rest
    }

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      stdoutBuf = feedLines(chunk, stdoutBuf)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      stderrBuf = feedLines(chunk, stderrBuf)
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new DownloadError('retryable', error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (options.onProgressLine) {
        if (stdoutBuf) {
          options.onProgressLine(stdoutBuf)
        }
        if (stderrBuf) {
          options.onProgressLine(stderrBuf)
        }
      }
      resolve({ stdout, stderr, code })
    })
  })
}

/**
 * 用途：从 yt-dlp 进度行解析已下载/总字节。
 * 入参：一行 stderr。
 * 返回值：字节数；无法解析时 null。
 * 异常：无。
 */
function parseProgressLine(line: string): { downloaded: number; total: number | null } | null {
  const tagged = /^Y2PPROG:([^:]*):([^:]*):([^:]*)$/.exec(line.trim())
  if (tagged) {
    const downloaded = parseByteCount(tagged[1])
    if (downloaded === null) {
      return null
    }
    return {
      downloaded,
      total: parseByteCount(tagged[2]) ?? parseByteCount(tagged[3])
    }
  }
  const classic = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|B)\b/i.exec(line)
  if (!classic) {
    return null
  }
  const percent = Number(classic[1])
  const total = sizeToBytes(Number(classic[2]), classic[3])
  if (!Number.isFinite(percent) || total === null) {
    return null
  }
  return {
    downloaded: Math.round((percent / 100) * total),
    total
  }
}

/**
 * 用途：把模板里的字节字段收成整数。
 * 入参：yt-dlp 输出的字段。
 * 返回值：字节数；NA/空则 null。
 * 异常：无。
 */
function parseByteCount(raw: string): number | null {
  const value = raw.trim()
  if (!value || value === 'NA' || value === 'None' || value === 'null') {
    return null
  }
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) {
    return null
  }
  return Math.trunc(bytes)
}

/**
 * 用途：把 yt-dlp 经典进度里的大小换成字节。
 * 入参：数值与单位。
 * 返回值：字节；无法识别时 null。
 * 异常：无。
 */
function sizeToBytes(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  const factor: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4
  }
  const mul = factor[unit]
  if (!mul) {
    return null
  }
  return Math.round(value * mul)
}

/**
 * 用途：从 yt-dlp 输出里取出 JSON 对象。
 * 入参：stdout。
 * 返回值：解析后的对象。
 * 异常：解析失败时抛 retryable。
 */
function parseYtdlpJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  const candidates = [trimmed, ...trimmed.split('\n').reverse()]
  for (const line of candidates) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
  }
  throw new DownloadError('retryable', 'yt-dlp 未返回元数据 JSON')
}

/**
 * 用途：在任务临时目录调用 yt-dlp 下载音轨。
 * 入参：dataDir、ytdlpPath、可选 cookies、YouTube URL、jobId、可选进度回调。
 * 返回值：音频路径与元数据。
 * 异常：失败时抛 DownloadError（含 error kind）。
 */
export async function downloadWithYtdlp(input: {
  dataDir: string
  ytdlpPath: string
  cookiesFile?: string
  youtubeUrl: string
  jobId: string
  onProgress?: DownloadProgress
}): Promise<YtdlpResult> {
  if (input.cookiesFile && !existsSync(input.cookiesFile)) {
    throw new DownloadError('retryable', `cookies 文件不存在: ${input.cookiesFile}`)
  }

  const workdir = join(dataPaths(input.dataDir).tmpJobs, input.jobId)
  mkdirSync(workdir, { recursive: true })

  const args = [
    '--no-playlist',
    '--progress',
    '--newline',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '-f',
    'bestaudio[ext=m4a]/bestaudio/best',
    '-o',
    'audio.%(ext)s',
    '--print-json',
    // 新版 yt-dlp 的 YouTube 提取需要 JS runtime，默认只启用 deno；复用本进程的 node 可执行文件。
    '--js-runtimes',
    `node:${process.execPath}`
  ]
  if (input.cookiesFile) {
    args.push('--cookies', input.cookiesFile)
  }
  args.push('--', input.youtubeUrl)

  let lastWrite = 0
  let lastProgress: { downloaded: number; total: number | null } | null = null
  const emitProgress = (progress: { downloaded: number; total: number | null }, force: boolean): void => {
    lastProgress = progress
    const now = Date.now()
    if (!force && now - lastWrite < PROGRESS_THROTTLE_MS) {
      return
    }
    lastWrite = now
    input.onProgress?.(progress.downloaded, progress.total)
  }

  const result = await runProcess(input.ytdlpPath, args, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    cwd: workdir,
    onProgressLine: (line) => {
      const progress = parseProgressLine(line)
      if (progress) {
        emitProgress(progress, false)
      }
    }
  })
  if (lastProgress) {
    emitProgress(lastProgress, true)
  }
  if (result.code !== 0) {
    const combined = `${result.stderr}\n${result.stdout}`
    throw new DownloadError(classifyYtdlpError(combined), combined.trim().slice(-500) || 'yt-dlp 失败')
  }

  const info = parseYtdlpJson(result.stdout)
  const ext = typeof info.ext === 'string' ? info.ext : 'm4a'
  const files = readdirSync(workdir).filter((name) => name.startsWith('audio.'))
  const audioName = files.find((name) => name === `audio.${ext}`) ?? files[0]
  if (!audioName) {
    throw new DownloadError('retryable', 'yt-dlp 未产出音频文件')
  }

  const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'YouTube'
  const description = typeof info.description === 'string' ? info.description : ''
  const channelTitle = typeof info.channel === 'string' && info.channel.trim()
    ? info.channel.trim()
    : typeof info.uploader === 'string' && info.uploader.trim()
      ? info.uploader.trim()
      : 'YouTube'
  const durationSeconds = Number.isFinite(Number(info.duration))
    ? Math.max(0, Math.trunc(Number(info.duration)))
    : 0
  const thumbnailUrl = typeof info.thumbnail === 'string' ? info.thumbnail : null

  return {
    audioFilePath: join(workdir, audioName),
    title,
    description,
    channelTitle,
    durationSeconds,
    thumbnailUrl,
    audioMimeType: mimeFromExt(ext)
  }
}

/**
 * 用途：读取 yt-dlp 版本号。
 * 入参：可执行文件路径。
 * 返回值：版本字符串；失败时 null。
 * 异常：无。
 */
export async function getYtdlpVersion(ytdlpPath: string): Promise<string | null> {
  try {
    const result = await runProcess(ytdlpPath, ['--version'], { timeoutMs: 15_000 })
    const version = result.stdout.trim().split('\n')[0]?.trim()
    return version || null
  } catch {
    return null
  }
}

/**
 * 用途：执行 yt-dlp -U 原地更新。
 * 入参：可执行文件路径。
 * 返回值：无。
 * 异常：失败时抛 retryable DownloadError。
 */
export async function updateYtdlp(ytdlpPath: string): Promise<void> {
  const result = await runProcess(ytdlpPath, ['-U'], { timeoutMs: SHORT_TIMEOUT_MS })
  if (result.code !== 0) {
    throw new DownloadError('retryable', result.stderr.trim().slice(-300) || 'yt-dlp 更新失败')
  }
}

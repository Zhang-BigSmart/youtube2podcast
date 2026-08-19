import { CoverCropper } from './cover-crop'
import { connectSandbox, installYoutubeiEval } from './eval-bridge'
import { extractFromYoutube, type ExtractedAudio, type ExtractedMetadata } from './extract-audio'
import { assertServerAccess, loadServerSettings, saveServerSettings, syncToServer } from './sync'
import { purgeExpiredTempAudio, saveTempAudio } from './temp-store'
import './extract.css'

const form = requireElement('#extract-form', HTMLFormElement)
const urlInput = requireElement('#url', HTMLInputElement)
const extractButton = requireElement('#extract', HTMLButtonElement)
const progressEl = requireElement('#progress', HTMLElement)
const progressFill = requireElement('#progress-fill', HTMLElement)
const progressText = requireElement('#progress-text', HTMLElement)
const resultEl = requireElement('#result', HTMLElement)
const coverStage = requireElement('#cover-stage', HTMLElement)
const coverImage = requireElement('#cover-image', HTMLImageElement)
const coverCrop = requireElement('#cover-crop', HTMLElement)
const titleEl = requireElement('#title', HTMLElement)
const channelEl = requireElement('#channel', HTMLElement)
const descriptionEl = requireElement('#description', HTMLElement)
const durationEl = requireElement('#duration', HTMLElement)
const audioTypeEl = requireElement('#audio-type', HTMLElement)
const audioSizeEl = requireElement('#audio-size', HTMLElement)
const videoIdEl = requireElement('#video-id', HTMLElement)
const audioSourceEl = requireElement('#audio-source', HTMLElement)
const previewEl = requireElement('#preview', HTMLAudioElement)
const statusEl = requireElement('#status', HTMLElement)
const serverUrlInput = requireElement('#server-url', HTMLInputElement)
const adminTokenInput = requireElement('#admin-token', HTMLInputElement)
const syncButton = requireElement('#sync', HTMLButtonElement)
const sandboxFrame = requireElement('#yt-eval', HTMLIFrameElement)

const cropper = new CoverCropper(coverStage, coverImage, coverCrop)
cropper.attach()

let previewUrl: string | null = null
let coverObjectUrl: string | null = null
let currentVideoId: string | null = null
let audioReady = false
let coverReady = false
let coverLoadPromise: Promise<void> = Promise.resolve()

/**
 * 按选择器取页面节点，缺失则立即失败。
 * @param selector CSS 选择器
 * @param Constructor 期望的 DOM 类型
 * @returns 对应节点
 * @throws 节点不存在或类型不符
 */
function requireElement<T extends Element>(
  selector: string,
  Constructor: { new (): T; prototype: T }
): T {
  const element = document.querySelector(selector)
  if (!(element instanceof Constructor)) {
    throw new Error(`提取页缺少节点 ${selector}`)
  }
  return element
}

setStatus('正在连接 sandbox…')
connectSandbox(sandboxFrame)
  .then(() => {
    installYoutubeiEval()
    setStatus('')
    extractButton.disabled = false
    void purgeExpiredTempAudio()
  })
  .catch((error) => {
    setStatus(`sandbox 初始化失败：${error instanceof Error ? error.message : String(error)}`)
  })

extractButton.disabled = true
void restoreServerSettings()
form.addEventListener('submit', (event) => {
  event.preventDefault()
  void runExtract()
})
syncButton.addEventListener('click', () => {
  void runSync()
})
serverUrlInput.addEventListener('change', () => {
  void persistServerSettings()
})
adminTokenInput.addEventListener('change', () => {
  void persistServerSettings()
})

void syncUrlFromActiveTab()
chrome.tabs.onActivated.addListener(() => {
  void syncUrlFromActiveTab()
})
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    void syncUrlFromActiveTab()
  }
})

/**
 * 用当前窗口左边活动标签的 YouTube 地址填充输入框。
 * @returns 无返回值；非 YouTube 页时不改输入框
 */
async function syncUrlFromActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url && /youtu(\.be|be\.com)/.test(tab.url)) {
    urlInput.value = tab.url
  }
}

/**
 * 触发提取：先展示元数据与封面裁剪，再下载音频写入临时库。
 */
async function runExtract(): Promise<void> {
  const url = urlInput.value.trim()
  if (!url) {
    setStatus('请填写 YouTube 链接')
    return
  }
  resetResult()
  extractButton.disabled = true
  extractButton.textContent = '提取中'
  try {
    setProgress('正在连接 YouTube…')
    const result = await extractFromYoutube(url, {
      onProgress: (message, received, total) => {
        setProgress(message, received, total)
      },
      onMetadata: (metadata) => {
        coverLoadPromise = showMetadata(metadata)
      }
    })
    currentVideoId = result.metadata.videoId
    await saveTempAudio({
      videoId: result.metadata.videoId,
      youtubeUrl: result.metadata.youtubeUrl,
      title: result.metadata.title,
      description: result.metadata.description,
      channelTitle: result.metadata.channelTitle,
      durationSeconds: result.metadata.durationSeconds,
      thumbnailUrl: result.metadata.thumbnailUrl,
      mimeType: result.audio.mimeType,
      fileName: result.audio.fileName,
      client: result.audio.client,
      itag: result.audio.itag,
      hasVideo: result.audio.hasVideo,
      blob: result.audio.blob,
      createdAt: Date.now()
    })
    await coverLoadPromise
    showAudio(result.audio)
    audioReady = true
    syncButton.disabled = false
    setProgress(`已暂存 ${formatBytes(result.audio.byteLength)}`, result.audio.byteLength, result.audio.byteLength)
  } catch (error) {
    setStatus(`失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    extractButton.disabled = false
    extractButton.textContent = '提取'
  }
}

/**
 * 读取已保存的服务端地址和 Token 填进表单。
 * @returns 无
 */
async function restoreServerSettings(): Promise<void> {
  const settings = await loadServerSettings()
  serverUrlInput.value = settings.baseUrl
  adminTokenInput.value = settings.adminToken
}

/**
 * 把当前输入的服务端配置写入本地。
 * @returns 无
 */
async function persistServerSettings(): Promise<void> {
  await saveServerSettings({
    baseUrl: serverUrlInput.value.trim(),
    adminToken: adminTokenInput.value
  })
}

/**
 * 裁切封面、直传 Blob、调用 import，成功后清掉本地暂存。
 * @returns 无
 * @throws 缺配置、用户拒绝权限、上传或 import 失败时在内部转成状态文案
 */
async function runSync(): Promise<void> {
  if (!currentVideoId || !audioReady) {
    setStatus('请先完成提取')
    return
  }
  syncButton.disabled = true
  try {
    const settings = {
      baseUrl: serverUrlInput.value,
      adminToken: adminTokenInput.value
    }
    await assertServerAccess(settings)
    await persistServerSettings()
    await coverLoadPromise
    const coverBlob = coverReady ? await cropper.exportJpeg() : null
    const result = await syncToServer(
      currentVideoId,
      coverBlob,
      (message, received, total) => {
        setProgress(message, received, total)
      },
      settings
    )
    audioReady = false
    if (result.alreadyExists) {
      setStatus(`该视频已在节目中 ${result.episodeId}`, 'ok')
    } else {
      setStatus(`已同步 ${result.episodeId}`, 'ok')
    }
  } catch (error) {
    setStatus(`同步失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    syncButton.disabled = !audioReady
  }
}

/**
 * 元数据到达后立刻展示封面与文案，不等音频下完。
 * @param metadata youtubei.js 解析出的单集字段
 */
async function showMetadata(metadata: ExtractedMetadata): Promise<void> {
  currentVideoId = metadata.videoId
  resultEl.hidden = false
  titleEl.textContent = metadata.title
  channelEl.textContent = metadata.channelTitle || '未知频道'
  descriptionEl.textContent = metadata.description || '（无描述）'
  durationEl.textContent = formatDuration(metadata.durationSeconds)
  videoIdEl.textContent = metadata.videoId
  if (!metadata.thumbnailUrl) {
    return
  }
  try {
    await cropper.setSource(await fetchCoverObjectUrl(metadata.thumbnailUrl))
    coverReady = true
  } catch {
    coverImage.src = metadata.thumbnailUrl
    coverReady = false
  }
}

/**
 * 音频下完后补类型、大小、来源和试听。
 * @param audio 已暂存的音轨
 */
function showAudio(audio: ExtractedAudio): void {
  audioTypeEl.textContent = formatAudioType(audio)
  audioSizeEl.textContent = formatBytes(audio.byteLength)
  audioSourceEl.textContent = `${audio.client} / itag ${audio.itag}`
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
  }
  previewUrl = URL.createObjectURL(audio.blob)
  previewEl.hidden = false
  previewEl.src = previewUrl
}

/**
 * 把缩略图拉成本地 blob URL，避免 canvas 被跨域污染导致无法导出封面。
 * @param url YouTube 缩略图地址
 * @returns blob: URL
 * @throws 下载失败或空响应
 */
async function fetchCoverObjectUrl(url: string): Promise<string> {
  const absolute = url.startsWith('//') ? `https:${url}` : url
  const response = await fetch(absolute, { credentials: 'omit' })
  if (!response.ok) {
    throw new Error(`封面 ${response.status}`)
  }
  const blob = await response.blob()
  if (coverObjectUrl) {
    URL.revokeObjectURL(coverObjectUrl)
  }
  coverObjectUrl = URL.createObjectURL(blob)
  return coverObjectUrl
}

/**
 * 清空上一轮结果，避免串数据。
 */
function resetResult(): void {
  currentVideoId = null
  audioReady = false
  coverReady = false
  coverLoadPromise = Promise.resolve()
  syncButton.disabled = true
  resultEl.hidden = true
  previewEl.hidden = true
  previewEl.removeAttribute('src')
  titleEl.textContent = ''
  channelEl.textContent = ''
  descriptionEl.textContent = ''
  durationEl.textContent = '—'
  audioTypeEl.textContent = '—'
  audioSizeEl.textContent = '—'
  videoIdEl.textContent = '—'
  audioSourceEl.textContent = '—'
  statusEl.hidden = true
  statusEl.textContent = ''
  statusEl.removeAttribute('data-tone')
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl)
    previewUrl = null
  }
}

/**
 * 更新下载进度条与说明文字。
 * @param message 当前步骤
 * @param received 已收字节
 * @param total 预估总字节；未知时只更新文案
 */
function setProgress(message: string, received?: number, total?: number): void {
  progressEl.hidden = false
  if (typeof received === 'number' && total && total > 0) {
    const ratio = Math.max(0, Math.min(1, received / total))
    progressFill.style.width = `${Math.round(ratio * 100)}%`
    progressText.textContent = `${message} ${formatBytes(received)} / ${formatBytes(total)}`
    return
  }
  if (typeof received === 'number') {
    progressFill.style.width = '12%'
    progressText.textContent = `${message} ${formatBytes(received)}`
    return
  }
  progressFill.style.width = '8%'
  progressText.textContent = message
}

/**
 * 展示错误或同步结果。空字符串时隐藏。
 * @param text 文案
 * @param tone 成功时传 ok
 */
function setStatus(text: string, tone?: 'ok'): void {
  if (!text) {
    statusEl.hidden = true
    statusEl.textContent = ''
    statusEl.removeAttribute('data-tone')
    return
  }
  statusEl.hidden = false
  statusEl.textContent = text
  if (tone) {
    statusEl.dataset.tone = tone
  } else {
    statusEl.removeAttribute('data-tone')
  }
}

/**
 * 把秒数格式化成 h:mm:ss 或 m:ss。
 * @param seconds 时长秒
 */
function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) {
    return '—'
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * 把 MIME 与是否含画面收成短标签。
 * @param audio 已下载音轨
 */
function formatAudioType(audio: ExtractedAudio): string {
  const mime = audio.mimeType.replace(/^audio\//, '').replace(/^video\//, '')
  return audio.hasVideo ? `${mime}（含画面）` : mime
}

/**
 * 把字节数格式化成可读大小。
 * @param bytes 已下载或总大小
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

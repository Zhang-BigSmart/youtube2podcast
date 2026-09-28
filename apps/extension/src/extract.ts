import { CoverCropper } from './cover-crop'
import type { ExtractedMetadata } from './extract-audio'
import {
  assertServerAccess,
  fetchJobs,
  fetchServerVersion,
  isPluginBehind,
  loadServerSettings,
  probeServer,
  pushCookies,
  retryRemoteJob,
  saveServerSettings,
  submitConversion,
  syncToServer,
  fetchCookieStatus,
  fetchEpisodes,
  fetchServerMeta,
  type RemoteEpisode,
  type RemoteJob,
  type ServerSettings
} from './sync'
import {
  getValidTempAudio,
  patchTempAudio,
  purgeExpiredTempAudio,
  saveTempAudio,
  type TempAudioRecord
} from './temp-store'
import { parseVideoId } from './youtube-id'
import './extract.css'

const REPO_URL = 'https://github.com/Zhang-BigSmart/youtube2podcast'
const JOBS_POLL_MS = 1000
const JOBS_VISIBLE = 5

const form = requireElement('#extract-form', HTMLFormElement)
const urlInput = requireElement('#url', HTMLInputElement)
const submitJobButton = requireElement('#submit-job', HTMLButtonElement)
const extractButton = requireElement('#extract', HTMLButtonElement)
const reextractButton = requireElement('#reextract', HTMLButtonElement)
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
const jobsEmpty = requireElement('#jobs-empty', HTMLElement)
const jobsList = requireElement('#jobs-list', HTMLElement)
const settingsToggle = requireElement('#settings-toggle', HTMLButtonElement)
const settingsBody = requireElement('#settings-body', HTMLElement)
const versionHint = requireElement('#version-hint', HTMLElement)
const pushCookiesButton = requireElement('#push-cookies', HTMLButtonElement)
const cookieStatusEl = requireElement('#cookie-status', HTMLElement)
const connectButton = requireElement('#connect-server', HTMLButtonElement)
const connectionStatusEl = requireElement('#connection-status', HTMLElement)
const rssUrlEl = requireElement('#rss-url', HTMLElement)
const rssField = requireElement('#rss-field', HTMLElement)
const connectedExtras = requireElement('#connected-extras', HTMLElement)

const cropper = new CoverCropper(coverStage, coverImage, coverCrop, (crop) => {
  if (!currentVideoId || !audioReady) {
    return
  }
  void patchTempAudio(currentVideoId, { crop }).catch(() => {
    // 拖动时记录可能尚未写入，忽略
  })
})
cropper.attach()

let previewUrl: string | null = null
let coverObjectUrl: string | null = null
let coverSourceBlob: Blob | null = null
let currentVideoId: string | null = null
let audioReady = false
let coverReady = false
let coverLoadPromise: Promise<void> = Promise.resolve()
let sandboxReady = false
let extractFromYoutubeFn: typeof import('./extract-audio').extractFromYoutube | null = null
let lastSyncFailed = false
let jobsPollTimer = 0
let lastJobs: RemoteJob[] = []
let lastEpisodes: RemoteEpisode[] = []
let serverConnected = false

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

void purgeExpiredTempAudio()
bindFold(settingsToggle, settingsBody)
submitJobButton.disabled = true
void restoreServerSettings()
form.addEventListener('submit', (event) => {
  event.preventDefault()
  void runSubmit()
})
extractButton.addEventListener('click', () => {
  void runExtract(false)
})
reextractButton.addEventListener('click', () => {
  void runExtract(true)
})
syncButton.addEventListener('click', () => {
  void runSync()
})
pushCookiesButton.addEventListener('click', () => {
  void runPushCookies()
})
connectButton.addEventListener('click', () => {
  void runConnect()
})
serverUrlInput.addEventListener('input', () => {
  if (serverConnected) {
    markDisconnected('配置已改，请重新连接')
  }
})
adminTokenInput.addEventListener('input', () => {
  if (serverConnected) {
    markDisconnected('配置已改，请重新连接')
  }
})
serverUrlInput.addEventListener('change', () => {
  void persistServerSettings()
})
adminTokenInput.addEventListener('change', () => {
  void persistServerSettings()
})
jobsList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) {
    return
  }
  if (target.dataset.action === 'retry' && target.dataset.jobId) {
    void runRetryJob(target.dataset.jobId)
  }
  if (target.dataset.action === 'extract' && target.dataset.youtubeUrl) {
    urlInput.value = target.dataset.youtubeUrl
    void runExtract(false)
  }
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
 * 用途：把折叠按钮与内容区绑定。
 * 入参：按钮、被折叠的节点。
 * 返回值：无。
 * 异常：无。
 */
function bindFold(toggle: HTMLButtonElement, body: HTMLElement): void {
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    setFold(toggle, body, !expanded)
  })
}

/**
 * 用途：展开或收起一块面板。
 * 入参：按钮、内容节点、是否展开。
 * 返回值：无。
 * 异常：无。
 */
function setFold(toggle: HTMLButtonElement, body: HTMLElement, expanded: boolean): void {
  toggle.setAttribute('aria-expanded', String(expanded))
  body.hidden = !expanded
}

/**
 * 用途：读取当前表单里的服务端配置。
 * 入参：无。
 * 返回值：baseUrl 与 adminToken。
 * 异常：无。
 */
function currentSettings(): ServerSettings {
  return {
    baseUrl: serverUrlInput.value,
    adminToken: adminTokenInput.value
  }
}

/**
 * 用当前窗口左边活动标签的 YouTube 地址填充输入框。
 * @param 无
 * @returns 无返回值；非 YouTube 页时不改输入框
 */
async function syncUrlFromActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url && /youtu(\.be|be\.com)/.test(tab.url)) {
    urlInput.value = tab.url
    await tryRestoreFromUrl(tab.url)
  }
}

/**
 * 若本地有该视频的未过期音频，直接还原，不点提取也可用。
 * @param url 链接或视频 ID
 * @returns 是否命中缓存
 */
async function tryRestoreFromUrl(url: string): Promise<boolean> {
  let videoId: string
  try {
    videoId = parseVideoId(url)
  } catch {
    return false
  }
  const cached = await getValidTempAudio(videoId)
  if (!cached) {
    return false
  }
  if (currentVideoId === videoId && audioReady) {
    return true
  }
  await restoreFromCache(cached)
  return true
}

/**
 * 用途：先把当前 YouTube 登录态推到服务端，再把 URL 交给 yt-dlp 排队下载。
 * 入参：无（读表单）。
 * 返回值：无。
 * 异常：未登录、缺配置、权限被拒或接口失败时写成状态文案。
 */
async function runSubmit(): Promise<void> {
  if (!serverConnected) {
    setStatus('请先在设置里连接服务端')
    setFold(settingsToggle, settingsBody, true)
    return
  }
  const youtubeUrl = urlInput.value.trim()
  if (!youtubeUrl) {
    setStatus('请填写 YouTube 链接')
    return
  }
  const settings = currentSettings()
  submitJobButton.disabled = true
  try {
    await assertServerAccess(settings)
    await persistServerSettings()
    setStatus('正在同步 YouTube 登录态…')
    await pushCookies(settings)
    const result = await submitConversion(youtubeUrl, settings)
    if (result.alreadyExists) {
      setStatus('已在播客中', 'ok')
    } else {
      setStatus('')
    }
    resultEl.hidden = true
    progressEl.hidden = true
    await refreshJobs(false)
    await checkPluginVersion()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  } finally {
    submitJobButton.disabled = !serverConnected
  }
}

/**
 * 用途：重试一条失败的服务端任务。
 * 入参：jobId。
 * 返回值：无。
 * 异常：未登录或接口失败时写成状态文案。
 * 边界：重试前再次推送登录态，避免用过期会话硬下。
 */
async function runRetryJob(jobId: string): Promise<void> {
  const settings = currentSettings()
  try {
    await assertServerAccess(settings)
    await persistServerSettings()
    setStatus('正在同步 YouTube 登录态…')
    await pushCookies(settings)
    await retryRemoteJob(jobId, settings)
    setStatus('')
    await refreshJobs(false)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 用途：仅把当前 Chrome 的 YouTube cookie 推到服务端，不创建下载任务。
 * 入参：无（读设置）。
 * 返回值：无。
 * 异常：未登录、缺配置或接口失败时写成状态文案。
 */
async function runPushCookies(): Promise<void> {
  const settings = currentSettings()
  pushCookiesButton.disabled = true
  try {
    await assertServerAccess(settings)
    await persistServerSettings()
    setStatus('正在同步 YouTube 登录态…')
    const count = await pushCookies(settings)
    setStatus(`已同步 ${count} 条登录态`, 'ok')
    await refreshCookieStatus()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  } finally {
    pushCookiesButton.disabled = false
  }
}

/**
 * 触发提取：有未过期本地缓存则直接还原，否则拉 YouTube。
 * @param force 为 true 时忽略缓存，重新走 InnerTube
 */
async function runExtract(force: boolean): Promise<void> {
  const url = urlInput.value.trim()
  if (!url) {
    setStatus('请填写 YouTube 链接')
    return
  }
  let videoId: string
  try {
    videoId = parseVideoId(url)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
    return
  }
  extractButton.disabled = true
  reextractButton.disabled = true
  extractButton.textContent = '提取中'
  try {
    if (!force) {
      const cached = await getValidTempAudio(videoId)
      if (cached) {
        await restoreFromCache(cached)
        return
      }
      setProgress('未命中本地缓存，正在从 YouTube 提取')
    } else {
      setProgress('忽略本地缓存，正在重新提取')
    }
    await ensureLocalExtractRuntime()
    await extractFromNetwork(url)
  } catch (error) {
    setStatus(formatExtractError(error))
  } finally {
    extractButton.disabled = false
    extractButton.textContent = '本地提取'
    reextractButton.disabled = false
  }
}

/**
 * 用途：首次真正走 YouTube 提取时再加载 youtubei 并连接 sandbox。
 * 入参：无。
 * 返回值：无。
 * 异常：sandbox 超时或模块加载失败时抛错。
 * 边界：命中本地缓存时不会调用；打开侧边栏时也不调用。
 */
async function ensureLocalExtractRuntime(): Promise<void> {
  const audioPromise = extractFromYoutubeFn
    ? Promise.resolve({ extractFromYoutube: extractFromYoutubeFn })
    : import('./extract-audio')
  if (!sandboxReady) {
    const { connectSandbox, installYoutubeiEval } = await import('./eval-bridge')
    await connectSandbox(sandboxFrame)
    installYoutubeiEval()
    sandboxReady = true
  }
  extractFromYoutubeFn = (await audioPromise).extractFromYoutube
}

/**
 * 用途：把提取失败翻成侧边栏文案。
 * 入参：捕获到的错误。
 * 返回值：中文说明；全客户端失败时提示更新插件。
 * 异常：无。
 */
function formatExtractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('没有可用音轨')) {
    return `YouTube 接口可能已变更，请检查插件是否为最新版本：${REPO_URL}`
  }
  return `失败：${message}`
}

/**
 * 用 IndexedDB 中的记录铺满侧边栏，不请求 InnerTube。
 * @param record 未过期暂存
 */
async function restoreFromCache(record: TempAudioRecord): Promise<void> {
  resetResult()
  currentVideoId = record.videoId
  resultEl.hidden = false
  titleEl.textContent = record.title
  channelEl.textContent = record.channelTitle || '未知频道'
  descriptionEl.textContent = record.description || '（无描述）'
  durationEl.textContent = formatDuration(record.durationSeconds)
  videoIdEl.textContent = record.videoId
  showAudio({
    blob: record.blob,
    mimeType: record.mimeType,
    fileName: record.fileName,
    itag: record.itag,
    client: record.client,
    hasVideo: record.hasVideo,
    byteLength: record.blob.size
  })
  await restoreCover(record)
  audioReady = true
  lastSyncFailed = false
  syncButton.disabled = false
  syncButton.textContent = '上传到播客'
  reextractButton.hidden = false
  setProgress(`来自本地缓存 ${formatBytes(record.blob.size)}`, record.blob.size, record.blob.size)
}

/**
 * 还原裁剪封面；没有本地原图时只补拉缩略图。
 * @param record 暂存记录
 */
async function restoreCover(record: TempAudioRecord): Promise<void> {
  if (record.thumbBlob) {
    coverSourceBlob = record.thumbBlob
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl)
    }
    coverObjectUrl = URL.createObjectURL(record.thumbBlob)
    await cropper.setSource(coverObjectUrl)
    if (record.crop) {
      cropper.applySourceCrop(record.crop)
    }
    coverReady = true
    return
  }
  if (!record.thumbnailUrl) {
    return
  }
  try {
    await cropper.setSource(await fetchCoverObjectUrl(record.thumbnailUrl))
    coverReady = true
    if (coverSourceBlob) {
      await patchTempAudio(record.videoId, { thumbBlob: coverSourceBlob })
    }
    if (record.crop) {
      cropper.applySourceCrop(record.crop)
    }
  } catch {
    coverImage.src = record.thumbnailUrl
    coverReady = false
  }
}

/**
 * 走 youtubei.js 下载并写入暂存。
 * @param url 用户输入的链接或视频 ID
 */
async function extractFromNetwork(url: string): Promise<void> {
  resetResult()
  setProgress('正在连接 YouTube…')
  if (!extractFromYoutubeFn) {
    throw new Error('本地提取尚未就绪')
  }
  const result = await extractFromYoutubeFn(url, {
    onProgress: (message, received, total) => {
      setProgress(message, received, total)
    },
    onMetadata: (metadata) => {
      coverLoadPromise = showMetadata(metadata)
    }
  })
  currentVideoId = result.metadata.videoId
  await coverLoadPromise
  let crop: TempAudioRecord['crop']
  try {
    if (coverReady) {
      crop = cropper.getSourceCrop()
    }
  } catch {
    crop = undefined
  }
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
    thumbBlob: coverSourceBlob ?? undefined,
    crop,
    createdAt: Date.now()
  })
  showAudio(result.audio)
  audioReady = true
  lastSyncFailed = false
  syncButton.disabled = false
  syncButton.textContent = '上传到播客'
  reextractButton.hidden = false
  setProgress(`已暂存 ${formatBytes(result.audio.byteLength)}`, result.audio.byteLength, result.audio.byteLength)
}

/**
 * 读取已保存的服务端地址和 Token 填进表单。
 * @returns 无
 */
async function restoreServerSettings(): Promise<void> {
  const settings = await loadServerSettings()
  serverUrlInput.value = settings.baseUrl
  adminTokenInput.value = settings.adminToken
  markDisconnected()
  setFold(settingsToggle, settingsBody, true)
  const meta = await fetchServerMeta(currentSettings())
  if (!meta) {
    return
  }
  applyConnected(meta.version ?? null, meta.rssUrl ?? null)
  const hasToken = Boolean(settings.adminToken.trim())
  setFold(settingsToggle, settingsBody, !hasToken)
  await refreshJobs(true)
  await checkPluginVersion()
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
 * 用途：把侧边栏标成未连接，并收起登录态相关项。
 * 入参：可选说明。
 * 返回值：无。
 * 异常：无。
 */
function markDisconnected(message = '未连接'): void {
  serverConnected = false
  submitJobButton.disabled = true
  connectedExtras.hidden = true
  rssField.hidden = true
  rssUrlEl.textContent = ''
  connectButton.textContent = '连接'
  setConnectionStatus(message)
}

/**
 * 用途：连接成功后展开登录态项，并允许提交。
 * 入参：服务端版本、RSS 订阅地址。
 * 返回值：无。
 * 异常：无。
 */
function applyConnected(version: string | null, rssUrl: string | null): void {
  serverConnected = true
  submitJobButton.disabled = false
  connectedExtras.hidden = false
  connectButton.textContent = '重新连接'
  const suffix = version ? ` · v${version}` : ''
  setConnectionStatus(`已连接${suffix}`, 'ok')
  if (rssUrl) {
    rssField.hidden = false
    rssUrlEl.textContent = rssUrl
  }
}

/**
 * 用途：更新设置里的连接状态文案。
 * 入参：文案；成功传 ok，失败传 err。
 * 返回值：无。
 * 异常：无。
 */
function setConnectionStatus(text: string, tone?: 'ok' | 'err'): void {
  connectionStatusEl.textContent = text
  if (tone) {
    connectionStatusEl.dataset.tone = tone
  } else {
    connectionStatusEl.removeAttribute('data-tone')
  }
}

/**
 * 用途：点击连接：申请主机权限并探测 /api/meta。
 * 入参：无（读表单）。
 * 返回值：无。
 * 异常：写成连接状态；不抛出。
 */
async function runConnect(): Promise<void> {
  connectButton.disabled = true
  setConnectionStatus('正在连接…')
  try {
    await persistServerSettings()
    const probe = await probeServer(currentSettings())
    applyConnected(probe.version, probe.rssUrl)
    await refreshJobs(false)
    await checkPluginVersion()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markDisconnected(message)
    setConnectionStatus(message, 'err')
  } finally {
    connectButton.disabled = false
  }
}

/**
 * 用途：拉取最近任务并按活跃与否决定是否轮询。
 * 入参：silent 为 true 时网络失败不覆盖状态条。
 * 返回值：无。
 * 异常：无；失败时保留上一份列表。
 */
async function refreshJobs(silent: boolean): Promise<void> {
  try {
    const settings = currentSettings()
    lastJobs = await fetchJobs(settings)
    try {
      lastEpisodes = await fetchEpisodes(settings)
    } catch {
      lastEpisodes = []
    }
    await refreshCookieStatus()
    renderJobs(lastJobs)
    scheduleJobsPoll(lastJobs)
  } catch (error) {
    if (!silent) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
    scheduleJobsPoll(lastJobs)
  }
}

/**
 * 用途：把服务端 cookie 概况写到设置区。
 * 入参：无。
 * 返回值：无。
 * 异常：无；失败时显示尚未同步。
 */
async function refreshCookieStatus(): Promise<void> {
  const status = await fetchCookieStatus(currentSettings())
  if (!status?.present) {
    cookieStatusEl.textContent = '尚未同步登录态'
    return
  }
  if (!status.updatedAt) {
    cookieStatusEl.textContent = '登录态已同步'
    return
  }
  const at = new Date(status.updatedAt)
  if (Number.isNaN(at.getTime())) {
    cookieStatusEl.textContent = '登录态已同步'
    return
  }
  cookieStatusEl.textContent = `登录态已同步 · ${at.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

/**
 * 用途：有 pending/processing 时 1 秒后再拉一次，空闲则停。
 * 入参：当前任务列表。
 * 返回值：无。
 * 异常：无。
 */
function scheduleJobsPoll(jobs: RemoteJob[]): void {
  window.clearTimeout(jobsPollTimer)
  const active = jobs.some((job) => job.status === 'pending' || job.status === 'processing')
  if (!active) {
    return
  }
  jobsPollTimer = window.setTimeout(() => {
    void refreshJobs(true)
  }, JOBS_POLL_MS)
}

/**
 * 用途：把最近 5 条任务画进列表。
 * 入参：服务端返回的任务。
 * 返回值：无。
 * 异常：无。
 */
function renderJobs(jobs: RemoteJob[]): void {
  const visible = mergeJobsByVideo(jobs).slice(0, JOBS_VISIBLE)
  jobsEmpty.hidden = visible.length > 0
  jobsList.replaceChildren()
  for (const job of visible) {
    jobsList.append(buildJobRow(job))
  }
}

/**
 * 用途：同一视频只保留最新一条任务。
 * 入参：按创建时间倒序的任务列表。
 * 返回值：去重后的任务。
 * 异常：无。
 */
function mergeJobsByVideo(jobs: RemoteJob[]): RemoteJob[] {
  const seen = new Set<string>()
  const merged: RemoteJob[] = []
  for (const job of jobs) {
    if (seen.has(job.youtube_video_id)) {
      continue
    }
    seen.add(job.youtube_video_id)
    merged.push(job)
  }
  return merged
}

/**
 * 用途：生成一条节目行，失败时带重试或本地提取。
 * 入参：该视频的最新任务。
 * 返回值：DOM 节点。
 * 异常：无。
 */
function buildJobRow(job: RemoteJob): HTMLElement {
  const row = document.createElement('div')
  row.className = `job-row ${jobRowTone(job.status)}`
  const art = document.createElement('div')
  art.className = 'ep-art'
  const thumb = document.createElement('img')
  thumb.alt = ''
  thumb.src = `https://i.ytimg.com/vi/${job.youtube_video_id}/mqdefault.jpg`
  thumb.addEventListener('load', () => {
    art.classList.add('has-thumb')
  })
  thumb.addEventListener('error', () => {
    thumb.remove()
  })
  const play = document.createElement('span')
  play.className = 'play-mini'
  art.append(thumb, play)

  const main = document.createElement('div')
  main.className = 'job-main'
  const title = document.createElement('strong')
  title.textContent = episodeTitle(job.youtube_video_id)
  const meta = document.createElement('p')
  meta.className = 'job-meta'
  meta.textContent = jobMetaText(job)
  main.append(title, meta)
  const progress = buildJobProgress(job)
  if (progress) {
    main.append(progress)
  }
  row.append(art, main)
  if (job.status !== 'failed') {
    return row
  }
  const err = document.createElement('div')
  err.className = 'job-error'
  const summary = document.createElement('p')
  summary.textContent = jobErrorText(job)
  err.append(summary)
  if (job.error_message) {
    const details = document.createElement('details')
    const caption = document.createElement('summary')
    caption.textContent = '详情'
    const pre = document.createElement('p')
    pre.textContent = job.error_message
    details.append(caption, pre)
    err.append(details)
  }
  main.append(err)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'row-action'
  if (job.error_kind === 'login_required') {
    button.textContent = '本地提取'
    button.dataset.action = 'extract'
    button.dataset.youtubeUrl = job.youtube_url
  } else {
    button.textContent = '重试'
    button.dataset.action = 'retry'
    button.dataset.jobId = job.id
  }
  main.append(button)
  return row
}

/**
 * 用途：按任务状态给节目行加色。
 * 入参：status。
 * 返回值：class 名。
 * 异常：无。
 */
function jobRowTone(status: string): string {
  if (status === 'pending' || status === 'processing') {
    return 'is-active'
  }
  if (status === 'completed') {
    return 'is-done'
  }
  if (status === 'failed') {
    return 'is-failed'
  }
  return ''
}

/**
 * 用途：用已入库标题展示节目；没有则用 videoId。
 * 入参：youtube_video_id。
 * 返回值：标题或 id。
 * 异常：无。
 */
function episodeTitle(videoId: string): string {
  return lastEpisodes.find((item) => item.youtube_video_id === videoId)?.title ?? videoId
}

/**
 * 用途：节目行第二行，有时长则写成「12:04 · 下载中」。
 * 入参：该视频的最新任务。
 * 返回值：展示文案。
 * 异常：无。
 */
function jobMetaText(job: RemoteJob): string {
  if (job.status === 'processing') {
    const progress = jobProgressLabel(job)
    return progress || '下载中'
  }
  const status = jobStatusLabel(job.status)
  const episode = lastEpisodes.find((item) => item.youtube_video_id === job.youtube_video_id)
  const duration = episode ? formatDuration(episode.duration_seconds) : '—'
  if (duration === '—') {
    return status
  }
  return `${duration} · ${status}`
}

/**
 * 用途：下载中进度文案，例如「12% · 1.2MB / 8.4MB」。
 * 入参：任务。
 * 返回值：有字节时返回文案，否则空串。
 * 异常：无。
 */
function jobProgressLabel(job: RemoteJob): string {
  const downloaded = Number(job.progress_downloaded)
  const total = Number(job.progress_total)
  if (Number.isFinite(total) && total > 0 && Number.isFinite(downloaded) && downloaded >= 0) {
    const percent = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
    return `${percent}% · ${formatBytes(downloaded)} / ${formatBytes(total)}`
  }
  if (Number.isFinite(downloaded) && downloaded > 0) {
    return `${formatBytes(downloaded)} · 下载中`
  }
  return ''
}

/**
 * 用途：给下载中的任务画一条进度条。
 * 入参：任务。
 * 返回值：进度条节点；非下载中则 null。
 * 异常：无。
 */
function buildJobProgress(job: RemoteJob): HTMLElement | null {
  if (job.status !== 'processing') {
    return null
  }
  const track = document.createElement('div')
  const fill = document.createElement('i')
  const downloaded = Number(job.progress_downloaded)
  const total = Number(job.progress_total)
  if (Number.isFinite(total) && total > 0 && Number.isFinite(downloaded)) {
    const percent = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
    track.className = 'job-progress'
    fill.style.width = `${percent}%`
  } else {
    track.className = 'job-progress is-unknown'
    fill.style.width = '30%'
  }
  track.append(fill)
  return track
}

/**
 * 用途：任务状态短标签。
 * 入参：status 字段。
 * 返回值：中文状态；未知码原样返回。
 * 异常：无。
 */
function jobStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '排队中',
    processing: '下载中',
    completed: '已加入播客',
    failed: '失败'
  }
  return labels[status] ?? status
}

/**
 * 用途：失败任务的引导文案。
 * 入参：任务。
 * 返回值：中文说明。
 * 异常：无。
 */
function jobErrorText(job: RemoteJob): string {
  if (job.error_kind === 'login_required') {
    return '登录态无效，请在 Chrome 登录 YouTube 后重试'
  }
  const message = job.error_message ?? ''
  if (/n challenge|page needs to be reloaded/i.test(message)) {
    return '下载组件未就绪，请升级 yt-dlp 后重试'
  }
  return '下载失败'
}

/**
 * 用途：主版本落后时在设置区顶部提示。
 * 入参：无（读配置与 manifest）。
 * 返回值：无。
 * 异常：无。
 */
async function checkPluginVersion(): Promise<void> {
  const serverVersion = await fetchServerVersion(currentSettings())
  if (!serverVersion) {
    versionHint.hidden = true
    return
  }
  const pluginVersion = chrome.runtime.getManifest().version
  if (!isPluginBehind(pluginVersion, serverVersion)) {
    versionHint.hidden = true
    return
  }
  versionHint.hidden = false
  versionHint.textContent = `插件 v${pluginVersion} 落后于服务端 v${serverVersion}，请更新插件`
  setFold(settingsToggle, settingsBody, true)
}

/**
 * 裁切封面、分片上传、调用 import，成功后清掉本地暂存。
 * @returns 无
 * @throws 缺配置、用户拒绝权限、上传或 import 失败时在内部转成状态文案
 */
async function runSync(): Promise<void> {
  if (!currentVideoId || !audioReady) {
    setStatus('请先完成提取')
    return
  }
  const settings = currentSettings()
  syncButton.disabled = true
  try {
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
    lastSyncFailed = false
    syncButton.textContent = '上传到播客'
    resultEl.hidden = true
    progressEl.hidden = true
    if (result.alreadyExists) {
      setStatus('已在播客中', 'ok')
    } else {
      setStatus('')
    }
    await refreshJobs(true)
  } catch (error) {
    lastSyncFailed = true
    syncButton.textContent = '重试上传'
    setStatus(`上传失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    syncButton.disabled = lastSyncFailed ? false : !audioReady
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
function showAudio(audio: {
  blob: Blob
  mimeType: string
  fileName: string
  itag: number
  client: string
  hasVideo: boolean
  byteLength: number
}): void {
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
  coverSourceBlob = blob
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
  coverSourceBlob = null
  coverLoadPromise = Promise.resolve()
  lastSyncFailed = false
  syncButton.disabled = true
  syncButton.textContent = '上传到播客'
  reextractButton.hidden = true
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
function formatAudioType(audio: { mimeType: string; hasVideo: boolean }): string {
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

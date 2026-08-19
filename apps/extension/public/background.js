const RULE_IDS = [1, 2, 3]
const YOUTUBE_ORIGIN = 'https://www.youtube.com'
const RESOURCE_TYPES = ['xmlhttprequest', 'other']
const YOUTUBE_INITIATORS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']

setupSidePanel()
void syncHeaderRules()

chrome.runtime.onInstalled.addListener(() => {
  setupSidePanel()
  void syncHeaderRules()
})

chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = changeInfo.cookie.domain || ''
  if (domain.includes('youtube.com')) {
    scheduleSync()
  }
})

let syncTimer = 0

/**
 * 点击工具栏图标时在当前窗口打开右侧边栏，不再新开标签页。
 */
function setupSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return
  }
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // 旧版 Chrome 无此 API 时忽略
  })
}

/**
 * cookie 变更较密，合并成一次 DNR 刷新。
 */
function scheduleSync() {
  if (syncTimer) {
    clearTimeout(syncTimer)
  }
  syncTimer = setTimeout(() => {
    syncTimer = 0
    void syncHeaderRules()
  }, 300)
}

/**
 * 读取本机 youtube.com 真实 cookie，拼成 Cookie 头。
 * @returns Cookie 头字符串；未登录时为空
 */
async function readYoutubeCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: 'youtube.com' })
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

/**
 * 只改扩展自己发出的请求。
 * InnerTube 带上 Origin + Cookie；googlevideo 只改 Origin，并去掉 Cookie（直链带 cookie 会 403）。
 * excludedInitiatorDomains 避免改写左边 YouTube 播放器自己的请求。
 */
async function syncHeaderRules() {
  const cookieHeader = await readYoutubeCookieHeader()
  const originHeaders = [
    { header: 'Origin', operation: 'set', value: YOUTUBE_ORIGIN },
    { header: 'Referer', operation: 'set', value: `${YOUTUBE_ORIGIN}/` }
  ]
  const innertubeHeaders = cookieHeader
    ? [...originHeaders, { header: 'Cookie', operation: 'set', value: cookieHeader }]
    : originHeaders
  const googlevideoHeaders = [
    ...originHeaders,
    { header: 'Cookie', operation: 'remove' }
  ]
  const conditionBase = {
    excludedInitiatorDomains: YOUTUBE_INITIATORS,
    resourceTypes: RESOURCE_TYPES
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: [
      {
        id: 1,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: innertubeHeaders },
        condition: { ...conditionBase, urlFilter: '||youtube.com/' }
      },
      {
        id: 2,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: innertubeHeaders },
        condition: { ...conditionBase, urlFilter: '||youtubei.googleapis.com/' }
      },
      {
        id: 3,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: googlevideoHeaders },
        condition: { ...conditionBase, urlFilter: '||googlevideo.com/' }
      }
    ]
  })
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export type Job = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: string
  error_message: string | null
  episode_id: string | null
  created_at: string
}

export type Episode = {
  id: string
  title: string
  channel_title: string
  duration_seconds: number
  created_at: string
}

function adminHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  }
}

/**
 * 用途：读取 API 响应；非 JSON 时带上状态码抛错，避免页面无提示。
 * 入参：fetch Response。
 * 返回值：解析后的 JSON。
 * 异常：正文不是 JSON，或 HTTP 失败时抛错。
 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) as unknown : null
  } catch {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  if (!response.ok) {
    const errorMessage = typeof data === 'object' && data && 'error' in data
      ? String((data as { error: unknown }).error)
      : `HTTP ${response.status}`
    throw new Error(errorMessage)
  }
  return data
}

export async function createJob(token: string, youtubeUrl: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ youtubeUrl })
  })
  return readJson(response)
}

export async function listJobs(token: string): Promise<Job[]> {
  const response = await fetch(`${API_BASE}/api/jobs`, { headers: adminHeaders(token) })
  const data = await readJson(response) as { jobs?: Job[] }
  return data.jobs ?? []
}

export async function listEpisodes(token: string): Promise<Episode[]> {
  const response = await fetch(`${API_BASE}/api/episodes`, { headers: adminHeaders(token) })
  const data = await readJson(response) as { episodes?: Episode[] }
  return data.episodes ?? []
}

export async function retryJob(token: string, jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: adminHeaders(token)
  })
  await readJson(response)
}

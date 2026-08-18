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

export async function createJob(token: string, youtubeUrl: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ youtubeUrl })
  })
  return response.json()
}

export async function listJobs(token: string): Promise<Job[]> {
  const response = await fetch(`${API_BASE}/api/jobs`, { headers: adminHeaders(token) })
  const data = await response.json() as { jobs: Job[] }
  return data.jobs
}

export async function listEpisodes(token: string): Promise<Episode[]> {
  const response = await fetch(`${API_BASE}/api/episodes`, { headers: adminHeaders(token) })
  const data = await response.json() as { episodes: Episode[] }
  return data.episodes
}

export async function retryJob(token: string, jobId: string): Promise<void> {
  await fetch(`${API_BASE}/api/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: adminHeaders(token)
  })
}

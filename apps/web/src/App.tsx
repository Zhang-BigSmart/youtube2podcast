import { useEffect, useState } from 'react'
import { createJob, listEpisodes, listJobs, retryJob, type Episode, type Job } from './api'
import './styles.css'

const rssUrl = import.meta.env.VITE_PUBLIC_RSS_URL ?? '/rss/change-me-rss-token.xml'

export function App() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('adminToken') ?? '')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [message, setMessage] = useState('')

  async function refresh() {
    if (!adminToken) return
    setJobs(await listJobs(adminToken))
    setEpisodes(await listEpisodes(adminToken))
  }

  async function submit() {
    localStorage.setItem('adminToken', adminToken)
    const result = await createJob(adminToken, youtubeUrl)
    setMessage(JSON.stringify(result))
    setYoutubeUrl('')
    await refresh()
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [adminToken])

  return (
    <main className="container">
      <h1>YouTube2Podcast</h1>
      <p className="muted">私人 YouTube 转播客控制台。第一版只负责提交、状态和 RSS。</p>

      <section className="card">
        <label>Admin Token</label>
        <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="输入管理 token" />
        <label>YouTube URL</label>
        <input value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        <button onClick={submit} disabled={!adminToken || !youtubeUrl}>提交转换</button>
        {message && <pre>{message}</pre>}
      </section>

      <section className="card">
        <h2>私人 RSS</h2>
        <code>{rssUrl}</code>
      </section>

      <section className="card">
        <h2>任务</h2>
        {jobs.map((job) => (
          <div className="row" key={job.id}>
            <span>{job.youtube_video_id}</span>
            <strong>{job.status}</strong>
            {job.error_message && <em>{job.error_message}</em>}
            {job.status === 'failed' && <button onClick={() => retryJob(adminToken, job.id).then(refresh)}>重试</button>}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Episodes</h2>
        {episodes.map((episode) => (
          <div className="row" key={episode.id}>
            <span>{episode.title}</span>
            <small>{episode.channel_title}</small>
          </div>
        ))}
      </section>
    </main>
  )
}

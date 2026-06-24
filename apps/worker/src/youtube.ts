const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export function parseYouTubeVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v')
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  return null
}

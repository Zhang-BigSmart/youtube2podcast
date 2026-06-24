import type { AudioProvider, AudioProviderResult } from './types'

export class HttpAudioProvider implements AudioProvider {
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}

  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ youtubeUrl })
    })

    if (!response.ok) {
      throw new Error(`Audio provider failed with HTTP ${response.status}`)
    }

    const data = await response.json<AudioProviderResult>()
    if (!data.audioDownloadUrl) {
      throw new Error('Audio provider response missing audioDownloadUrl')
    }

    return data
  }
}

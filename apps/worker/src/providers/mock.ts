import type { AudioProvider, AudioProviderResult } from './types'

export class MockAudioProvider implements AudioProvider {
  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    return {
      title: 'Mock YouTube Episode',
      description: `Mock audio generated for ${youtubeUrl}`,
      channelTitle: 'Mock Channel',
      durationSeconds: 60,
      audioDownloadUrl: 'https://example.com/mock-audio.mp3',
      audioMimeType: 'audio/mpeg',
      audioFileSize: 1024
    }
  }
}

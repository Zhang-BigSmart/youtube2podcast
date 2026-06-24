import type { AudioProvider, AudioProviderResult } from './types'

export class MockAudioProvider implements AudioProvider {
  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    const mockAudio = 'mock audio bytes'

    return {
      title: 'Mock YouTube Episode',
      description: `Mock audio generated for ${youtubeUrl}`,
      channelTitle: 'Mock Channel',
      durationSeconds: 60,
      audioDownloadUrl: `data:audio/mpeg;base64,${btoa(mockAudio)}`,
      audioMimeType: 'audio/mpeg',
      audioFileSize: mockAudio.length
    }
  }
}

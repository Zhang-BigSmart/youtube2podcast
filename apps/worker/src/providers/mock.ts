import type { AudioProvider, AudioProviderResult } from './types'

/**
 * 用途：不调外部 API 的假音频，便于冒烟。
 * 入参：YouTube URL，仅写入 description。
 * 返回值：一小段 UTF-8 字节作为假 MP3。
 * 异常：无。
 */
export class MockAudioProvider implements AudioProvider {
  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    const mockAudio = new TextEncoder().encode('mock audio bytes')

    return {
      provider: 'mock',
      title: 'Mock YouTube Episode',
      description: `Mock audio generated for ${youtubeUrl}`,
      channelTitle: 'Mock Channel',
      durationSeconds: 60,
      audioBytes: mockAudio.buffer,
      audioMimeType: 'audio/mpeg',
      audioFileSize: mockAudio.byteLength
    }
  }
}

export type AudioProviderResult = {
  title?: string
  description?: string
  channelTitle?: string
  durationSeconds?: number
  thumbnailUrl?: string
  audioDownloadUrl: string
  audioMimeType?: string
  audioFileSize?: number
}

export interface AudioProvider {
  extract(youtubeUrl: string): Promise<AudioProviderResult>
}

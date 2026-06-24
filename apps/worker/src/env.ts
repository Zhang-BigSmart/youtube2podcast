export type Env = {
  DB: D1Database
  AUDIO_BUCKET: R2Bucket
  CONVERSION_QUEUE: Queue<ConversionMessage>
  ADMIN_TOKEN: string
  RSS_TOKEN: string
  AUDIO_PROVIDER: 'mock' | 'http'
  AUDIO_PROVIDER_ENDPOINT?: string
  AUDIO_PROVIDER_API_KEY?: string
  PUBLIC_BASE_URL: string
}

export type ConversionMessage = {
  jobId: string
}

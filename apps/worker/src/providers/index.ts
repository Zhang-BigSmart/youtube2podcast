import type { Env } from '../env'
import { HttpAudioProvider } from './http'
import { MockAudioProvider } from './mock'
import type { AudioProvider } from './types'

export function createAudioProvider(env: Env): AudioProvider {
  if (env.AUDIO_PROVIDER === 'mock') {
    return new MockAudioProvider()
  }

  if (env.AUDIO_PROVIDER === 'http') {
    if (!env.AUDIO_PROVIDER_ENDPOINT || !env.AUDIO_PROVIDER_API_KEY) {
      throw new Error('AUDIO_PROVIDER_ENDPOINT and AUDIO_PROVIDER_API_KEY are required for http provider')
    }
    return new HttpAudioProvider(env.AUDIO_PROVIDER_ENDPOINT, env.AUDIO_PROVIDER_API_KEY)
  }

  throw new Error(`Unsupported AUDIO_PROVIDER: ${env.AUDIO_PROVIDER}`)
}

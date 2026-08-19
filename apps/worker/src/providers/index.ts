import type { Env } from '../env.js'
import { MockAudioProvider } from './mock.js'
import { FailoverAudioProvider, YoutubeDownloadInfoProvider, YoutubeToMp315Provider } from './rapidapi.js'
import type { AudioProvider } from './types.js'

/**
 * 用途：按环境变量构造音频供应商。
 * 入参：Worker Env。AUDIO_PROVIDER=mock 走本地假数据；rapidapi 走 download-info 主、yt15 备。
 * 返回值：AudioProvider 实例。
 * 异常：rapidapi 未配置 RAPIDAPI_KEY，或 AUDIO_PROVIDER 未知时抛错。
 */
export function createAudioProvider(env: Env): AudioProvider {
  if (env.AUDIO_PROVIDER === 'mock') {
    return new MockAudioProvider()
  }

  if (env.AUDIO_PROVIDER === 'rapidapi') {
    if (!env.RAPIDAPI_KEY) {
      throw new Error('RAPIDAPI_KEY is required for rapidapi provider')
    }
    return new FailoverAudioProvider(
      new YoutubeDownloadInfoProvider(env.RAPIDAPI_KEY),
      new YoutubeToMp315Provider(env.RAPIDAPI_KEY)
    )
  }

  throw new Error(`Unsupported AUDIO_PROVIDER: ${env.AUDIO_PROVIDER}`)
}

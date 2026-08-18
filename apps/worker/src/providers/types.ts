/**
 * 第三方音频提取结果。
 * 用途：把各家 RapidAPI 的差异收敛成转换器可转存 Blob 的统一结构。
 */
export type AudioProviderResult = {
  /** 实际成功的供应商标识，写入 jobs.provider。 */
  provider: string
  title?: string
  description?: string
  channelTitle?: string
  durationSeconds?: number
  thumbnailUrl?: string
  /**
   * 可 fetch 的临时音频地址。与 audioBytes 至少提供一个。
   * 签名 URL 会过期，调用方必须立刻转存 Blob。
   */
  audioDownloadUrl?: string
  /** 供应商直接返回的音频字节。存在时转换器不再二次下载。 */
  audioBytes?: ArrayBuffer
  audioMimeType?: string
  audioFileSize?: number
}

/**
 * 音频供应商。
 * 入参：公开 YouTube 视频 URL。
 * 返回值：可转存的音频与可选元数据。
 * 异常：提取失败时抛错，由上层决定是否切换备用供应商或标记任务失败。
 */
export interface AudioProvider {
  extract(youtubeUrl: string): Promise<AudioProviderResult>
}

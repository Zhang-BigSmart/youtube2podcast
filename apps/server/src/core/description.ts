/** Apple Podcasts 单集描述公开上限。 */
export const MAX_EPISODE_DESCRIPTION_LENGTH = 4000

/**
 * 用途：把单集描述截到 Apple Podcasts 允许的长度，避免 RSS 超标。
 * 入参：原始描述文本。
 * 返回值：不超过 4000 个 Unicode 码点的字符串；超长时末尾为省略号。
 * 异常：无。
 * 边界：空串与未超限原文原样返回；按码点截取，不切开代理对。
 */
export function truncateEpisodeDescription(value: string): string {
  const chars = Array.from(value)
  if (chars.length <= MAX_EPISODE_DESCRIPTION_LENGTH) {
    return value
  }
  return `${chars.slice(0, MAX_EPISODE_DESCRIPTION_LENGTH - 1).join('')}…`
}

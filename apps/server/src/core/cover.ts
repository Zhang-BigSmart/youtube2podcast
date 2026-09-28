import sharp from 'sharp'

const COVER_SIZE = 1400

/**
 * 用途：把横版 YouTube 缩略图铺成 Apple 播客要求的正方形封面。
 * 入参：原始图片字节。
 * 返回值：1400×1400 JPEG 字节。
 * 异常：图片无法解码时由 sharp 抛错。
 * 边界：背景为原图 cover 裁切后强模糊，前景 contain 居中，不裁主体。
 */
export async function squareCoverJpeg(input: Buffer): Promise<Buffer> {
  const background = await sharp(input)
    .resize(COVER_SIZE, COVER_SIZE, { fit: 'cover' })
    .blur(50)
    .toBuffer()

  const foreground = await sharp(input)
    .resize(COVER_SIZE, COVER_SIZE, { fit: 'inside' })
    .toBuffer()

  return sharp(background)
    .composite([{ input: foreground, gravity: 'centre' }])
    .jpeg({ quality: 85 })
    .toBuffer()
}

/**
 * 用途：下载缩略图并做成方图 JPEG。
 * 入参：YouTube 缩略图 URL。
 * 返回值：JPEG 字节；无 URL、下载失败或处理失败时返回 null。
 * 异常：不向外抛，避免封面问题阻断音频入库。
 */
export async function jpegFromThumbnailUrl(thumbnailUrl: string | null): Promise<Buffer | null> {
  if (!thumbnailUrl) return null

  try {
    const response = await fetch(thumbnailUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 YouTube2Podcast' }
    })
    if (!response.ok) return null

    const source = Buffer.from(await response.arrayBuffer())
    if (source.byteLength === 0) return null

    const meta = await sharp(source).metadata()
    if (!meta.width || meta.width < 200) return null

    return await squareCoverJpeg(source)
  } catch {
    return null
  }
}

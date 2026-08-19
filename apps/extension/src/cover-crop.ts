const COVER_EXPORT_SIZE = 1400

export type SourceCrop = {
  sx: number
  sy: number
  size: number
}

/**
 * YouTube 横版缩略图上的 1:1 裁剪框，导出 Apple 播客要求的 1400×1400 JPEG。
 */
export class CoverCropper {
  #stage: HTMLElement
  #image: HTMLImageElement
  #cropEl: HTMLElement
  #drag: { pointerId: number; grabX: number; grabY: number; startLeft: number; startTop: number } | null = null
  #resizeObserver: ResizeObserver

  /**
   * @param stage 封面舞台（裁剪框的定位根）
   * @param image 缩略图
   * @param cropEl 方形选择框
   */
  constructor(stage: HTMLElement, image: HTMLImageElement, cropEl: HTMLElement) {
    this.#stage = stage
    this.#image = image
    this.#cropEl = cropEl
    this.#resizeObserver = new ResizeObserver(() => this.#layoutCrop(false))
    this.#cropEl.addEventListener('pointerdown', (event) => this.#onPointerDown(event))
    this.#cropEl.addEventListener('pointermove', (event) => this.#onPointerMove(event))
    this.#cropEl.addEventListener('pointerup', (event) => this.#onPointerUp(event))
    this.#cropEl.addEventListener('pointercancel', (event) => this.#onPointerUp(event))
  }

  /**
   * 开始观察舞台尺寸，图片加载后排裁剪框。
   */
  attach(): void {
    this.#resizeObserver.observe(this.#stage)
    this.#image.addEventListener('load', () => this.#layoutCrop(true))
  }

  /**
   * 换一张缩略图源（blob URL），并重置为居中方形裁剪。
   * @param src 可绘制的图片地址
   * @returns 图片解码完成
   */
  async setSource(src: string): Promise<void> {
    if (this.#image.src && this.#image.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.#image.src)
    }
    this.#image.src = src
    if (this.#image.complete && this.#image.naturalWidth > 0) {
      this.#layoutCrop(true)
      return
    }
    await this.#image.decode()
    this.#layoutCrop(true)
  }

  /**
   * 把当前选择框映射回原图像素。
   * @returns 原图上的正方形区域
   * @throws 图片尚未布局完成
   */
  getSourceCrop(): SourceCrop {
    const displayed = this.#displayedImageRect()
    const crop = this.#cropEl.getBoundingClientRect()
    const stage = this.#stage.getBoundingClientRect()
    const cropLeft = crop.left - stage.left
    const cropTop = crop.top - stage.top
    const scaleX = this.#image.naturalWidth / displayed.width
    const scaleY = this.#image.naturalHeight / displayed.height
    const sx = (cropLeft - displayed.left) * scaleX
    const sy = (cropTop - displayed.top) * scaleY
    const size = crop.width * scaleX
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error('封面裁剪尚未就绪')
    }
    return {
      sx: Math.max(0, sx),
      sy: Math.max(0, sy),
      size: Math.min(size, this.#image.naturalWidth, this.#image.naturalHeight)
    }
  }

  /**
   * 导出播客封面 JPEG。
   * @param edge 边长，默认 1400
   * @returns image/jpeg Blob
   */
  async exportJpeg(edge = COVER_EXPORT_SIZE): Promise<Blob> {
    const crop = this.getSourceCrop()
    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = edge
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('无法创建封面画布')
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.#image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, edge, edge)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.9)
    })
    if (!blob) {
      throw new Error('封面导出失败')
    }
    return blob
  }

  /**
   * 按图片在舞台上的实际绘制区域放置方形框。
   * @param reset 为 true 时居中；否则尽量保持当前相对位置
   */
  #layoutCrop(reset: boolean): void {
    const displayed = this.#displayedImageRect()
    if (displayed.width <= 0 || displayed.height <= 0) {
      return
    }
    const size = Math.min(displayed.width, displayed.height)
    const maxLeft = displayed.left + displayed.width - size
    const maxTop = displayed.top + displayed.height - size
    let left = displayed.left + (displayed.width - size) / 2
    let top = displayed.top + (displayed.height - size) / 2
    if (!reset) {
      const current = this.#cropEl.getBoundingClientRect()
      const stage = this.#stage.getBoundingClientRect()
      left = clamp(current.left - stage.left, displayed.left, maxLeft)
      top = clamp(current.top - stage.top, displayed.top, maxTop)
    }
    this.#cropEl.style.width = `${size}px`
    this.#cropEl.style.height = `${size}px`
    this.#cropEl.style.left = `${left}px`
    this.#cropEl.style.top = `${top}px`
  }

  /**
   * 计算 object-fit: contain 后图片在舞台内的矩形（相对 stage）。
   */
  #displayedImageRect(): { left: number; top: number; width: number; height: number } {
    const stage = this.#stage.getBoundingClientRect()
    const naturalW = this.#image.naturalWidth
    const naturalH = this.#image.naturalHeight
    if (!naturalW || !naturalH) {
      return { left: 0, top: 0, width: 0, height: 0 }
    }
    const scale = Math.min(stage.width / naturalW, stage.height / naturalH)
    const width = naturalW * scale
    const height = naturalH * scale
    return {
      left: (stage.width - width) / 2,
      top: (stage.height - height) / 2,
      width,
      height
    }
  }

  /**
   * 按下裁剪框，记录抓取偏移，1:1 跟随指针。
   * @param event 指针按下
   */
  #onPointerDown(event: PointerEvent): void {
    event.preventDefault()
    this.#cropEl.setPointerCapture(event.pointerId)
    const rect = this.#cropEl.getBoundingClientRect()
    this.#drag = {
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      startLeft: rect.left,
      startTop: rect.top
    }
  }

  /**
   * 拖动裁剪框，限制在图片绘制区域内。
   * @param event 指针移动
   */
  #onPointerMove(event: PointerEvent): void {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) {
      return
    }
    const displayed = this.#displayedImageRect()
    const size = this.#cropEl.getBoundingClientRect().width
    const stage = this.#stage.getBoundingClientRect()
    const left = clamp(
      event.clientX - stage.left - this.#drag.grabX,
      displayed.left,
      displayed.left + displayed.width - size
    )
    const top = clamp(
      event.clientY - stage.top - this.#drag.grabY,
      displayed.top,
      displayed.top + displayed.height - size
    )
    this.#cropEl.style.left = `${left}px`
    this.#cropEl.style.top = `${top}px`
  }

  /**
   * 结束拖动。
   * @param event 指针抬起或取消
   */
  #onPointerUp(event: PointerEvent): void {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) {
      return
    }
    this.#drag = null
  }
}

/**
 * 把数值限制在闭区间内。
 * @param value 当前值
 * @param min 下限
 * @param max 上限
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

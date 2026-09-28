const DB_NAME = 'y2p-temp'
const DB_VERSION = 1
const STORE_NAME = 'audio'
const EXPIRE_MS = 24 * 60 * 60 * 1000

/** 封面在原图上的正方形区域，单位为原图像素。 */
export type StoredCoverCrop = {
  sx: number
  sy: number
  size: number
}

/** 侧边栏暂存的音频与元数据，上传成功或超过 24 小时后删除。 */
export type TempAudioRecord = {
  videoId: string
  youtubeUrl: string
  title: string
  description: string
  channelTitle: string
  durationSeconds: number
  thumbnailUrl: string | null
  mimeType: string
  fileName: string
  client: string
  itag: number
  hasVideo: boolean
  blob: Blob
  thumbBlob?: Blob
  crop?: StoredCoverCrop
  coverBlob?: Blob
  createdAt: number
}

/**
 * 打开扩展内的临时音频库。
 * @returns IndexedDB database
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('打开临时库失败'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'videoId' })
      }
    }
  })
}

/**
 * 按视频 ID 读取一条暂存记录。
 * @param videoId YouTube 视频 ID
 * @returns 记录；没有则 null
 * @throws IndexedDB 读取失败
 */
export async function getTempAudio(videoId: string): Promise<TempAudioRecord | null> {
  const db = await openDb()
  const record = await new Promise<TempAudioRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(videoId)
    request.onsuccess = () => resolve(request.result as TempAudioRecord | undefined)
    request.onerror = () => reject(request.error ?? new Error('读取临时音频失败'))
  })
  db.close()
  return record ?? null
}

/**
 * 读取未过期且带音频的暂存，供提取命中缓存。
 * @param videoId YouTube 视频 ID
 * @returns 可用记录；没有、过期或没有音频时 null
 * @throws IndexedDB 读取失败
 */
export async function getValidTempAudio(videoId: string): Promise<TempAudioRecord | null> {
  const record = await getTempAudio(videoId)
  if (!record) {
    return null
  }
  if (record.createdAt < Date.now() - EXPIRE_MS) {
    return null
  }
  if (!record.blob || record.blob.size <= 0) {
    return null
  }
  return record
}

/**
 * 把部分字段写回已有暂存记录。
 * @param videoId YouTube 视频 ID
 * @param patch 要合并的字段
 * @throws 记录不存在或写入失败
 */
export async function patchTempAudio(
  videoId: string,
  patch: Partial<Pick<TempAudioRecord, 'thumbBlob' | 'crop' | 'coverBlob'>>
): Promise<void> {
  const existing = await getTempAudio(videoId)
  if (!existing) {
    throw new Error('没有对应的暂存音频，请先提取')
  }
  await saveTempAudio({ ...existing, ...patch })
}

/**
 * 把裁切后的封面 JPEG 写回已有暂存记录。
 * @param videoId YouTube 视频 ID
 * @param coverBlob 1400×1400 JPEG
 * @throws 记录不存在或写入失败
 */
export async function updateTempCover(videoId: string, coverBlob: Blob): Promise<void> {
  await patchTempAudio(videoId, { coverBlob })
}

/**
 * 把提取结果写入临时库，同 videoId 会覆盖。
 * @param record 元数据 + 音频 Blob
 */
export async function saveTempAudio(record: TempAudioRecord): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写入临时音频失败'))
    tx.objectStore(STORE_NAME).put(record)
  })
  db.close()
}

/**
 * 按视频 ID 删除临时音频，上传成功后调用。
 * @param videoId YouTube 视频 ID
 */
export async function deleteTempAudio(videoId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('删除临时音频失败'))
    tx.objectStore(STORE_NAME).delete(videoId)
  })
  db.close()
}

/**
 * 删掉超过 24 小时的临时音频。
 * @returns 本次删掉的条数
 */
export async function purgeExpiredTempAudio(): Promise<number> {
  const db = await openDb()
  const cutoff = Date.now() - EXPIRE_MS
  const deleted = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.openCursor()
    let count = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }
      const value = cursor.value as TempAudioRecord
      if (value.createdAt < cutoff) {
        cursor.delete()
        count += 1
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve(count)
    tx.onerror = () => reject(tx.error ?? new Error('清理过期音频失败'))
  })
  db.close()
  return deleted
}

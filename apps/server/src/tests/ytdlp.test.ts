import { describe, expect, it } from 'vitest'
import { classifyYtdlpError, mimeFromExt } from '../core/ytdlp.js'

describe('classifyYtdlpError', () => {
  it('maps login and age-gate messages', () => {
    expect(classifyYtdlpError('Sign in to confirm your age')).toBe('login_required')
    expect(classifyYtdlpError('This video is age-restricted')).toBe('login_required')
    expect(classifyYtdlpError('This video is members-only')).toBe('login_required')
    expect(classifyYtdlpError('Private video. Sign in if you have been invited')).toBe('login_required')
    expect(classifyYtdlpError('ERROR: use --cookies-from-browser or --cookies')).toBe('login_required')
  })

  it('maps everything else as retryable', () => {
    expect(classifyYtdlpError('Unable to download webpage: HTTP Error 503')).toBe('retryable')
    expect(classifyYtdlpError('The downloaded file is empty')).toBe('retryable')
  })
})

describe('mimeFromExt', () => {
  it('maps common audio extensions', () => {
    expect(mimeFromExt('m4a')).toBe('audio/mp4')
    expect(mimeFromExt('.webm')).toBe('audio/webm')
    expect(mimeFromExt('mp3')).toBe('audio/mpeg')
  })
})

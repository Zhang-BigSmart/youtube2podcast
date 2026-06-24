import { describe, expect, it } from 'vitest'
import { parseRangeHeader } from '../services/media'

describe('parseRangeHeader', () => {
  it('parses byte ranges', () => {
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
  })

  it('clamps open-ended ranges', () => {
    expect(parseRangeHeader('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects invalid ranges', () => {
    expect(parseRangeHeader('items=1-2', 100)).toBeNull()
    expect(parseRangeHeader('bytes=200-300', 100)).toBeNull()
  })
})

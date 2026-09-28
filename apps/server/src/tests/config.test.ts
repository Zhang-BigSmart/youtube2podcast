import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'

describe('parseConfig', () => {
  it('throws when RSS_TOKEN is missing', () => {
    expect(() => parseConfig({
      PUBLIC_BASE_URL: 'http://localhost:8080'
    })).toThrow('Missing env: RSS_TOKEN')
  })
})

import { describe, expect, it } from 'vitest'
import { isAuthorizedAdmin } from '../auth.js'

describe('isAuthorizedAdmin', () => {
  it('accepts bearer token', () => {
    const request = new Request('https://example.com/api/jobs', {
      headers: { Authorization: 'Bearer secret-admin' }
    })
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(true)
  })

  it('rejects missing bearer token', () => {
    const request = new Request('https://example.com/api/jobs')
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(false)
  })

  it('rejects wrong token', () => {
    const request = new Request('https://example.com/api/jobs', {
      headers: { Authorization: 'Bearer wrong' }
    })
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(false)
  })
})

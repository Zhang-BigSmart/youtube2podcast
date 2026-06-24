export function isAuthorizedAdmin(request: Request, adminToken: string): boolean {
  const header = request.headers.get('authorization')
  return header === `Bearer ${adminToken}`
}

export function isValidToken(actual: string, expected: string): boolean {
  return actual.length > 0 && actual === expected
}

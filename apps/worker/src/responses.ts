export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  })
}

export function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, {
    ...init,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...(init.headers ?? {})
    }
  })
}

export function notFound(): Response {
  return text('Not found', { status: 404 })
}

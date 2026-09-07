// Identity is supplied by the private Sites gateway, never by a public origin.
export function requestProblem(request: Request, ownerEmail: string | undefined) {
  const url = new URL(request.url);
  const workerEvent = url.pathname === '/api/autotrader/events' && request.method === 'POST';
  if (url.pathname.includes('//')) return { status: 400, error: 'Use the canonical API path.' };
  if (!workerEvent) {
    const identity = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    if (!ownerEmail?.trim() || identity !== ownerEmail.trim().toLowerCase()) return { status: 401, error: 'Unauthorised' };
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin)) return { status: 403, error: 'Open Foresight directly before making this request.' };
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { status: 415, error: 'Send a JSON request.' };
  return null;
}

export async function boundedBody(request: Pick<Request, 'body'>, maximumBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new Error('Request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function privateResponse(response: Response) {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'private, no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'same-origin');
  result.headers.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  return result;
}

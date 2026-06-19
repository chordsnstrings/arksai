import type { FastifyRequest } from 'fastify';

/**
 * Result of a hardened reverse-proxy fetch. `body` is the fully-buffered raw
 * response bytes; the caller decides how to send it (e.g. rewrite HTML).
 */
export interface ProxyResult {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
}

// undici surfaces an early upstream socket close in a few shapes. The most common
// here is a STALE KEEP-ALIVE socket: undici pulls a pooled connection that a simple
// dev/published server has already half-closed, so the very first read throws
// "terminated" / ERR_STREAM_PREMATURE_CLOSE. A single fresh retry resolves it.
const TRANSIENT = /premature close|premature_close|terminated|ECONNRESET|socket hang up|other side closed|UND_ERR/i;

function isTransient(e: any): boolean {
  const msg = `${e?.message ?? e} ${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
  return TRANSIENT.test(msg);
}

const FORWARD_HEADERS = ['content-type', 'cache-control'];

/**
 * Reverse-proxy `req` to `upstream`, fully buffering the response. Hardened against
 * the premature-close error class: the upstream read happens INSIDE the try, and a
 * transient close (stale keep-alive socket, mid-response reset) is retried ONCE on a
 * fresh connection. Returns null when the upstream is unreachable or closes twice —
 * the caller turns that into a clean 502 instead of an unhandled 500.
 */
export async function proxyFetch(upstream: string, req: FastifyRequest, timeoutMs = 30_000): Promise<ProxyResult | null> {
  const method = req.method;
  const hasBody = !['GET', 'HEAD'].includes(method);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(upstream, {
        method,
        // identity so we can rewrite HTML; connection mgmt is undici's, but a retry
        // sidesteps a stale pooled socket.
        headers: { 'accept-encoding': 'identity' },
        body: hasBody ? ((req.body as any) ?? undefined) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      // CRITICAL: read the body inside the try — this is where a premature close throws.
      const body = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      for (const h of FORWARD_HEADERS) {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      }
      return { status: res.status, contentType: res.headers.get('content-type') ?? '', headers, body };
    } catch (e: any) {
      if (attempt === 0 && isTransient(e)) continue; // retry once on a fresh connection
      return null;
    }
  }
  return null;
}

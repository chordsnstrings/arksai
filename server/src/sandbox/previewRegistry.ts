/**
 * Per-session preview-port allocator.
 *
 * The in-canvas preview used to (a) run every app on a hard-coded 4000 and (b) have
 * the client DISCOVER the port by scanning /proc — which races and mis-picks noise
 * ports the moment two sessions preview at once. This registry replaces that: each
 * session gets ONE unique, recorded port from a dedicated range, and the proxy/router
 * resolve it by session id. No scanning, no collision, no guessing.
 *
 * Allocation is race-free by construction: `allocPort` is fully synchronous (no `await`
 * inside the critical section), and Node runs it to completion before any other turn —
 * two concurrent sessions can never be handed the same port.
 *
 * Range 42000–42999 is kept distinct from the deployment registry (41000–41999) and
 * the platform's own port (3000), so previews can't collide with published apps either.
 */
const PORT_BASE = 42000;
const PORT_MAX = 42999;

class PreviewRegistry {
  private bySession = new Map<string, number>();

  /** Allocate — or idempotently reuse — this session's preview port. */
  allocPort(sessionId: string): number {
    const existing = this.bySession.get(sessionId);
    if (existing != null) return existing;
    const used = new Set(this.bySession.values());
    for (let p = PORT_BASE; p <= PORT_MAX; p++) {
      if (!used.has(p)) {
        this.bySession.set(sessionId, p);
        return p;
      }
    }
    throw new Error('no free preview port');
  }

  /** The recorded preview port for a session, or null if none allocated yet. */
  portFor(sessionId: string): number | null {
    return this.bySession.get(sessionId) ?? null;
  }

  /** Free the reservation (on session delete / workspace purge). */
  release(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

export const previewRegistry = new PreviewRegistry();
export const PREVIEW_PORT_BASE = PORT_BASE;
export const PREVIEW_PORT_MAX = PORT_MAX;

import { EventEmitter } from 'node:events';
import type { AgentEvent, GlobalEvent, SessionMeta } from '../../../shared/types';

interface BufferedEvent {
  seq: number;
  event: AgentEvent;
}

/**
 * Per-session ordered event log. Events live in memory only: replay is needed
 * only while a run is in progress (a page refresh mid-run reconnects and
 * replays), and finished runs are persisted to the timeline table instead.
 */
class SessionBus {
  private emitter = new EventEmitter();
  private buffers = new Map<string, BufferedEvent[]>();
  private seq = 0;

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit(sessionId: string, event: AgentEvent) {
    const entry: BufferedEvent = { seq: ++this.seq, event };
    if (event.type !== 'tick') {
      const buf = this.buffers.get(sessionId) ?? [];
      buf.push(entry);
      if (buf.length > 5000) buf.splice(0, buf.length - 5000);
      this.buffers.set(sessionId, buf);
    }
    this.emitter.emit(`s:${sessionId}`, entry);
  }

  subscribe(sessionId: string, fn: (e: BufferedEvent) => void): () => void {
    const ch = `s:${sessionId}`;
    this.emitter.on(ch, fn);
    return () => this.emitter.off(ch, fn);
  }

  replayAfter(sessionId: string, afterSeq: number): BufferedEvent[] {
    return (this.buffers.get(sessionId) ?? []).filter((e) => e.seq > afterSeq);
  }

  /** Called when a run completes and its output has been persisted. */
  clear(sessionId: string) {
    this.buffers.delete(sessionId);
  }

  // ---- global channel for the sidebar (status dots, titles) ----

  emitGlobal(event: GlobalEvent) {
    this.emitter.emit('global', event);
  }

  subscribeGlobal(fn: (e: GlobalEvent) => void): () => void {
    this.emitter.on('global', fn);
    return () => this.emitter.off('global', fn);
  }

  sessionChanged(meta: SessionMeta) {
    this.emit(meta.id, { type: 'session_meta_updated', meta });
    this.emitGlobal({ type: 'session_status', session: meta });
  }
}

export const bus = new SessionBus();

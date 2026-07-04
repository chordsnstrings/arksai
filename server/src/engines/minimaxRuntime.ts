/**
 * Runtime MiniMax T2A GroupId — the speech endpoint needs the account UID (`GroupId`) as a
 * query param, and the operator activates it WITHOUT editing /opt/arksai/.env (no SSH),
 * mirroring the BytePlus ark-key pattern. Env (MINIMAX_GROUP_ID) wins; else the value is
 * persisted in app_settings. It's an account id rather than a secret, but it still never
 * lands in the public repo — only env or the DB.
 */
import { config } from '../config';
import { getSetting, setSetting } from '../db';

let cachedGroupId = config.minimaxGroupId || '';

/** Load the persisted GroupId once at boot (env wins; else app_settings). */
export async function loadMinimaxRuntime(): Promise<void> {
  if (!cachedGroupId) {
    const v = await getSetting('minimax_group_id');
    if (v) cachedGroupId = v;
  }
}

export function minimaxGroupId(): string {
  return cachedGroupId;
}

/** Persist + cache the GroupId. Flips TTS (robot voice replies + chat speech) ON when keyed. */
export async function setMinimaxGroupId(id: string): Promise<void> {
  cachedGroupId = id;
  await setSetting('minimax_group_id', id);
}

/** TEST ONLY: set the in-memory GroupId without a DB write. */
export function __setMinimaxGroupIdForTest(id: string): void {
  cachedGroupId = id;
}

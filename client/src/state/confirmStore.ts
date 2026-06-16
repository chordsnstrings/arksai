import { create } from 'zustand';

/** Promise-based in-app confirm — replaces native confirm() (which is unstyled,
 *  thread-blocking, and suppressed by some mobile browsers). Call `confirmDialog(...)`
 *  anywhere and `await` the boolean; <ConfirmModal/> (mounted once in App) renders it. */
export interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface ConfirmState {
  opts: ConfirmOpts | null;
  resolve: ((v: boolean) => void) | null;
  ask(opts: ConfirmOpts): Promise<boolean>;
  answer(v: boolean): void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  opts: null,
  resolve: null,
  ask: (opts) => new Promise<boolean>((resolve) => set({ opts, resolve })),
  answer: (v) => {
    const r = get().resolve;
    set({ opts: null, resolve: null });
    r?.(v);
  },
}));

export const confirmDialog = (opts: ConfirmOpts): Promise<boolean> => useConfirm.getState().ask(opts);

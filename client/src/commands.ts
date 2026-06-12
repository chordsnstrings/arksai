export interface CommandMeta {
  name: string;
  desc: string;
  arg?: string;
}

/** Slash commands surfaced in the composer's "/" menu. */
export const COMMANDS: CommandMeta[] = [
  { name: 'help', desc: 'List available commands' },
  { name: 'mode', desc: 'Switch mode', arg: 'chat|plan|code' },
  { name: 'model', desc: 'Switch model (no arg lists options)', arg: '[name]' },
  { name: 'clear', desc: 'Clear this conversation' },
  { name: 'stop', desc: 'Interrupt the running agent' },
  { name: 'retry', desc: 'Re-run your last message' },
  { name: 'push', desc: 'Ask the agent to commit & push', arg: '[branch]' },
  { name: 'diff', desc: 'Show uncommitted git diff' },
  { name: 'files', desc: 'List workspace files' },
  { name: 'ps', desc: 'List background processes' },
  { name: 'kill', desc: 'Stop a background process', arg: '<id>' },
  { name: 'rename', desc: 'Rename this session', arg: '<title>' },
  { name: 'cost', desc: 'Show token + cost breakdown' },
  { name: 'new', desc: 'Start a new session', arg: '[owner/repo]' },
];

export function matchCommands(input: string): CommandMeta[] {
  const m = input.match(/^\/(\w*)$/);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q));
}

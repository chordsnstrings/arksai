import { config } from '../config';

/**
 * The orchestration spine. Each engine declares what it's good at; the
 * DeepSeek orchestrator routes a task to the right one via that engine's
 * tool(s). Adding a new engine (image, video, voice) = one entry here + a
 * tool that calls it. Tools self-gate on availability.
 */
export interface EngineInfo {
  id: string;
  capability: string;
  label: string;
  provider: string;
  available: boolean;
}

export function listEngines(): EngineInfo[] {
  return [
    {
      id: 'deepseek',
      capability: 'code, reasoning, writing',
      label: 'ArksAI',
      provider: 'deepseek',
      available: !!config.deepseekApiKey,
    },
    {
      id: 'suno',
      capability: 'music & audio generation',
      label: 'Suno',
      provider: 'sunoapi.org',
      available: !!config.sunoApiKey,
    },
    {
      id: 'minimax',
      capability: 'LLM, voice/audio, music & video generation',
      label: 'MiniMax',
      provider: 'minimax',
      available: !!config.minimaxApiKey,
    },
  ];
}

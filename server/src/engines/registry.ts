import { config } from '../config';
import { byteplusConfigured } from '../agent/byteplusRuntime';

/**
 * The orchestration spine. Each engine declares what it's good at; the
 * MiniMax-powered orchestrator routes a task to the right one via that engine's
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
      id: 'minimax',
      capability: 'code, reasoning, writing, vision, image, speech & video, long-context LLM',
      label: 'ArksAI',
      provider: 'minimax',
      available: !!config.minimaxApiKey,
    },
    {
      id: 'suno',
      capability: 'music & audio generation',
      label: 'Suno',
      provider: 'sunoapi.org',
      available: !!config.sunoApiKey,
    },
    {
      id: 'arksai-video',
      capability: 'video generation with native synchronized audio — draft → final ladder (ArksAI Video 1.5 + 2.0)',
      label: 'ArksAI Video',
      provider: 'byteplus',
      available: byteplusConfigured(),
    },
  ];
}

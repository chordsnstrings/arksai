import { config } from '../config';
import { byteplusConfigured } from '../agent/byteplusRuntime';

/**
 * The orchestration spine. Each engine declares what it's good at; the orchestrator routes a
 * task to the right one via that engine's tool(s). ModelArk is the single model provider (every
 * LLM lane, vision, Seedream images, Skylark embeddings); Seedance video is listed separately
 * because it has its own draft → final ladder. Adding a new engine (music, voice) = one entry
 * here + a tool that calls it. Tools self-gate on availability.
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
      id: 'modelark',
      capability: 'code, reasoning, writing, vision, image generation & embeddings, long-context LLM',
      label: 'ArksAI Models — reasoning, code, vision, images & video',
      provider: 'modelark',
      available: byteplusConfigured(),
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
      capability: 'video generation with native synchronized audio — draft → final ladder (ArksAI Video 1.5 / 2.0 / 2.5)',
      label: 'ArksAI Video',
      provider: 'byteplus',
      available: byteplusConfigured(),
    },
  ];
}

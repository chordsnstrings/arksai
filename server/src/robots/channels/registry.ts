import type { RobotChannelKind } from '../../../../shared/types';
import type { ChannelAdapter } from './types';
import { telegramAdapter } from './telegram';
import { whatsappAdapter } from './whatsapp';
import { smsAdapter } from './sms';
import { metaAdapter } from './meta';

/**
 * The channel adapter registry — its own module so the inbound handler, the notifier,
 * the task lane and the routes can all reach adapters without import cycles.
 */
export const ADAPTERS: Record<RobotChannelKind, ChannelAdapter> = {
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  sms: smsAdapter,
  meta: metaAdapter,
};

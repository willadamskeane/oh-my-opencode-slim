/**
 * Multiplexer factory - creates the appropriate multiplexer instance
 */

import type { MultiplexerConfig, MultiplexerType } from '../config/schema';
import { log } from '../utils/logger';
import { MuxyMultiplexer } from './muxy';
import { TmuxMultiplexer } from './tmux';
import type { Multiplexer } from './types';
import { ZellijMultiplexer } from './zellij';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a multiplexer instance based on config.
 *
 * Do not cache instances: tmux/zellij integrations may depend on
 * per-process environment like TMUX_PANE/ZELLIJ, which should be captured
 * fresh for each plugin context.
 */
export function getMultiplexer(config: MultiplexerConfig): Multiplexer | null {
  const { type } = config;

  if (type === 'none') {
    return null;
  }

  // Create new instance
  let multiplexer: Multiplexer;
  let actualType: MultiplexerType;

  switch (type) {
    case 'muxy':
      multiplexer = new MuxyMultiplexer(config.layout, config.main_pane_size);
      actualType = 'muxy';
      break;
    case 'tmux':
      multiplexer = new TmuxMultiplexer(config.layout, config.main_pane_size);
      actualType = 'tmux';
      break;
    case 'zellij':
      multiplexer = new ZellijMultiplexer(config.layout, config.main_pane_size);
      actualType = 'zellij';
      break;
    case 'auto': {
      if (isMuxySession()) {
        multiplexer = new MuxyMultiplexer(config.layout, config.main_pane_size);
        actualType = 'muxy';
      } else if (process.env.TMUX) {
        multiplexer = new TmuxMultiplexer(config.layout, config.main_pane_size);
        actualType = 'tmux';
      } else if (process.env.ZELLIJ) {
        multiplexer = new ZellijMultiplexer(
          config.layout,
          config.main_pane_size,
        );
        actualType = 'zellij';
      } else {
        // Not inside any session, disable multiplexer
        log('[multiplexer] auto: not inside any session, disabling');
        return null;
      }
      break;
    }
    default:
      log(`[multiplexer] Unknown type: ${type}`);
      return null;
  }

  log(`[multiplexer] Created ${actualType} instance`);

  return multiplexer;
}

/**
 * Clear the multiplexer cache (useful for testing)
 */
export function clearMultiplexerCache(): void {
  // No-op: multiplexers are no longer cached.
}

/**
 * Get the effective multiplexer type for auto mode
 * Returns the actual type that would be used (tmux/zellij/none)
 */
export function getAutoMultiplexerType(): 'muxy' | 'tmux' | 'zellij' | 'none' {
  if (isMuxySession()) {
    return 'muxy';
  }
  if (process.env.TMUX) {
    return 'tmux';
  }
  if (process.env.ZELLIJ) {
    return 'zellij';
  }
  return 'none';
}

function isMuxySession(): boolean {
  return (
    !!process.env.MUXY_SOCKET_PATH &&
    UUID_REGEX.test(process.env.MUXY_PANE_ID ?? '')
  );
}

/**
 * Start background availability check for a multiplexer
 */
export function startAvailabilityCheck(config: MultiplexerConfig): void {
  const multiplexer = getMultiplexer(config);
  if (multiplexer) {
    // Fire and forget - don't await
    multiplexer.isAvailable().catch(() => {});
  }
}

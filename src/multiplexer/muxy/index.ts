import { crossSpawn } from '../../utils/compat';
import { log } from '../../utils/logger';
import type { Multiplexer, PaneResult } from '../types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MuxyMultiplexer implements Multiplexer {
  readonly type = 'muxy' as const;

  async isAvailable(): Promise<boolean> {
    return this.isInsideSession();
  }

  isInsideSession(): boolean {
    return isMuxySession();
  }

  async spawnPane(
    sessionId: string,
    description: string,
    serverUrl: string,
    directory: string,
  ): Promise<PaneResult> {
    const sourcePane = process.env.MUXY_PANE_ID;
    if (!sourcePane || !UUID_REGEX.test(sourcePane)) return { success: false };

    try {
      const proc = crossSpawn(
        [
          'muxy',
          'pane',
          'create',
          '--title',
          description.trim() || 'Subagent',
          '--command',
          buildAttachCommand(sessionId, serverUrl, directory),
          '--cwd',
          directory,
          '--source-pane',
          sourcePane,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        proc.stdout(),
        proc.stderr(),
      ]);
      if (exitCode !== 0) {
        log('[muxy] pane create failed', { stderr: stderr.trim() });
        return { success: false };
      }

      const paneId = parsePaneId(stdout);
      return paneId ? { success: true, paneId } : { success: false };
    } catch (error) {
      log('[muxy] pane create failed', { error: String(error) });
      return { success: false };
    }
  }

  async closePane(paneId: string): Promise<boolean> {
    if (!paneId) return false;
    try {
      const proc = crossSpawn(['muxy', 'pane', 'close', '--pane-id', paneId], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return (await proc.exited) === 0;
    } catch (error) {
      log('[muxy] pane close failed', { error: String(error) });
      return false;
    }
  }

  async applyLayout(): Promise<void> {}
}

export function isMuxySession(): boolean {
  return (
    !!process.env.MUXY_SOCKET_PATH &&
    UUID_REGEX.test(process.env.MUXY_PANE_ID ?? '')
  );
}

function buildAttachCommand(
  sessionId: string,
  serverUrl: string,
  directory: string,
): string {
  return [
    'opencode',
    'attach',
    quoteShellArg(serverUrl),
    '--session',
    quoteShellArg(sessionId),
    '--dir',
    quoteShellArg(directory),
  ].join(' ');
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parsePaneId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout.trim()) as { ok?: boolean; paneID?: string };
    return parsed.ok && parsed.paneID ? parsed.paneID : undefined;
  } catch (error) {
    log('[muxy] invalid pane create response', { error: String(error) });
    return undefined;
  }
}

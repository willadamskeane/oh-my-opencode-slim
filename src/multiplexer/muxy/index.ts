import * as net from 'node:net';
import type { MultiplexerLayout } from '../../config/schema';
import { log } from '../../utils/logger';
import type { Multiplexer, PaneResult } from '../types';

const SOCKET_AVAILABILITY_TIMEOUT_MS = 750;
const SOCKET_REQUEST_TIMEOUT_MS = 5000;

type MuxyMultiplexerOptions = {
  requestTimeoutMs?: number;
};

export class MuxyMultiplexer implements Multiplexer {
  readonly type = 'muxy' as const;

  private storedLayout: MultiplexerLayout;
  private readonly requestTimeoutMs: number;

  constructor(
    layout: MultiplexerLayout = 'main-vertical',
    mainPaneSize = 60,
    options: MuxyMultiplexerOptions = {},
  ) {
    this.storedLayout = layout;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? SOCKET_REQUEST_TIMEOUT_MS;
    void mainPaneSize;
  }

  async isAvailable(): Promise<boolean> {
    const socketPath = process.env.MUXY_SOCKET_PATH;
    if (!socketPath) return false;
    return await this.checkSocket(socketPath);
  }

  isInsideSession(): boolean {
    return !!process.env.MUXY_SOCKET_PATH;
  }

  async spawnPane(
    sessionId: string,
    description: string,
    serverUrl: string,
    directory: string,
  ): Promise<PaneResult> {
    const socketPath = process.env.MUXY_SOCKET_PATH;
    if (!socketPath) return { success: false };
    const command = buildOpencodeAttachCommand(sessionId, serverUrl, directory);
    const response = await this.sendRequest(socketPath, {
      type: 'terminal.create',
      id: sessionId,
      title: (description.trim() || 'Subagent').slice(0, 64),
      command,
      cwd: directory,
      split: this.getSplit(),
      focus: false,
      closeOnExit: true,
      sourcePaneID: process.env.MUXY_PANE_ID,
    });
    const paneId =
      typeof response?.paneID === 'string' ? response.paneID : null;
    if (!response?.ok || !paneId) return { success: false };
    return { success: true, paneId };
  }

  async closePane(paneId: string): Promise<boolean> {
    const socketPath = process.env.MUXY_SOCKET_PATH;
    if (!socketPath || !paneId) return false;
    const response = await this.sendRequest(socketPath, {
      type: 'terminal.close',
      paneID: paneId,
      id: paneId,
    });
    return response?.ok === true;
  }

  async applyLayout(
    layout: MultiplexerLayout,
    mainPaneSize: number,
  ): Promise<void> {
    this.storedLayout = layout;
    void mainPaneSize;
  }

  private getSplit(): 'down' | 'right' {
    return this.storedLayout === 'main-horizontal' ||
      this.storedLayout === 'even-vertical'
      ? 'down'
      : 'right';
  }

  private async checkSocket(socketPath: string): Promise<boolean> {
    return await new Promise((resolve) => {
      const socket = net.createConnection({ path: socketPath });
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(value);
      };
      const timeout = setTimeout(() => {
        finish(false);
      }, SOCKET_AVAILABILITY_TIMEOUT_MS);
      timeout.unref?.();
      socket.once('connect', () => {
        finish(true);
      });
      socket.once('error', () => {
        finish(false);
      });
      socket.once('close', () => {
        finish(false);
      });
    });
  }

  private async sendRequest(
    socketPath: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    return await new Promise((resolve) => {
      const socket = net.createConnection({ path: socketPath });
      let buffer = '';
      let settled = false;
      const finish = (value: Record<string, unknown> | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(value);
      };
      const timeout = setTimeout(() => {
        finish(null);
      }, this.requestTimeoutMs);
      timeout.unref?.();
      socket.on('connect', () => {
        socket.write(`${JSON.stringify(payload)}\n`);
        socket.end();
      });
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) return;
        const line = buffer.slice(0, newlineIndex).trim();
        try {
          finish(JSON.parse(line));
        } catch (error) {
          log('[muxy] invalid response', { error: String(error) });
          finish(null);
        }
      });
      socket.once('close', () => {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          finish(null);
        }
      });
      socket.once('error', (error) => {
        log('[muxy] socket error', { error: String(error) });
        finish(null);
      });
    });
  }
}

export function buildOpencodeAttachCommand(
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

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

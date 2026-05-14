import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import {
  buildOpencodeAttachCommand,
  MuxyMultiplexer,
  quoteShellArg,
} from './index';

class FakeSocket extends EventEmitter {
  written = '';
  destroyed = false;

  write(chunk: string): void {
    this.written += chunk;
  }

  end(): void {
    this.emit('end');
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe('MuxyMultiplexer', () => {
  let createConnectionSpy: ReturnType<typeof spyOn>;
  let socket: FakeSocket;

  beforeEach(() => {
    process.env.MUXY_SOCKET_PATH = '/tmp/muxy.sock';
    process.env.MUXY_PANE_ID = '123e4567-e89b-12d3-a456-426614174000';
    socket = new FakeSocket();
    createConnectionSpy = spyOn(net, 'createConnection').mockImplementation(
      () => socket as unknown as net.Socket,
    );
  });

  afterEach(() => {
    createConnectionSpy.mockRestore();
    delete process.env.MUXY_SOCKET_PATH;
    delete process.env.MUXY_PANE_ID;
  });

  test('quotes shell args safely', () => {
    expect(quoteShellArg("a'b")).toBe("'a'\"'\"'b'");
    expect(
      buildOpencodeAttachCommand(
        'sess',
        'http://127.0.0.1:3000',
        '/tmp/my dir',
      ),
    ).toContain("'/tmp/my dir'");
  });

  test('spawnPane sends create payload and returns pane id', async () => {
    const muxy = new MuxyMultiplexer('main-horizontal', 55);
    const resultPromise = muxy.spawnPane(
      'session-1',
      'A very long description that should be sliced',
      'http://127.0.0.1:3000',
      '/tmp/work dir',
    );

    socket.emit('connect');
    socket.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ ok: true, paneID: '123e4567-e89b-12d3-a456-426614174001' })}\n`,
      ),
    );

    expect(await resultPromise).toEqual({
      success: true,
      paneId: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(parsePayload(socket.written)).toEqual({
      type: 'terminal.create',
      id: 'session-1',
      title: 'A very long description that should be sliced',
      command:
        "opencode attach 'http://127.0.0.1:3000' --session 'session-1' --dir '/tmp/work dir'",
      cwd: '/tmp/work dir',
      split: 'down',
      focus: false,
      closeOnExit: true,
      sourcePaneID: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  test('spawnPane falls back to Subagent title', async () => {
    const muxy = new MuxyMultiplexer();
    const resultPromise = muxy.spawnPane(
      'session-1',
      '   ',
      'http://127.0.0.1:3000',
      '/tmp/work dir',
    );

    socket.emit('connect');
    socket.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ ok: true, paneID: '123e4567-e89b-12d3-a456-426614174004' })}\n`,
      ),
    );

    expect(await resultPromise).toEqual({
      success: true,
      paneId: '123e4567-e89b-12d3-a456-426614174004',
    });
    expect(parsePayload(socket.written)).toMatchObject({
      title: 'Subagent',
    });
  });

  test('closePane sends close payload', async () => {
    const muxy = new MuxyMultiplexer();
    const resultPromise = muxy.closePane(
      '123e4567-e89b-12d3-a456-426614174002',
    );

    socket.emit('connect');
    socket.emit('data', Buffer.from(`${JSON.stringify({ ok: true })}\n`));

    expect(await resultPromise).toBe(true);
    expect(parsePayload(socket.written)).toEqual({
      type: 'terminal.close',
      paneID: '123e4567-e89b-12d3-a456-426614174002',
      id: '123e4567-e89b-12d3-a456-426614174002',
    });
  });

  test('isAvailable returns false for missing socket', async () => {
    delete process.env.MUXY_SOCKET_PATH;
    const muxy = new MuxyMultiplexer();
    expect(await muxy.isAvailable()).toBe(false);
  });

  test('isAvailable returns true for connectable socket', async () => {
    const muxy = new MuxyMultiplexer();
    const availablePromise = muxy.isAvailable();
    socket.emit('connect');
    expect(await availablePromise).toBe(true);
  });

  test('spawnPane fails on invalid response', async () => {
    const muxy = new MuxyMultiplexer();
    const resultPromise = muxy.spawnPane(
      'session-2',
      'desc',
      'http://localhost:3000',
      '/tmp',
    );

    socket.emit('connect');
    socket.emit('data', Buffer.from('not-json\n'));

    expect(await resultPromise).toEqual({ success: false });
  });

  test('spawnPane fails on timeout', async () => {
    const muxy = new MuxyMultiplexer('main-vertical', 60, {
      requestTimeoutMs: 50,
    });
    const startedAt = Date.now();

    expect(
      await muxy.spawnPane(
        'session-3',
        'desc',
        'http://localhost:3000',
        '/tmp',
      ),
    ).toEqual({ success: false });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test('closePane fails without socket', async () => {
    delete process.env.MUXY_SOCKET_PATH;
    const muxy = new MuxyMultiplexer();
    expect(await muxy.closePane('123e4567-e89b-12d3-a456-426614174003')).toBe(
      false,
    );
  });
});

function parsePayload(payload: string): Record<string, unknown> {
  const line = payload.trim().split('\n')[0];
  return JSON.parse(line) as Record<string, unknown>;
}

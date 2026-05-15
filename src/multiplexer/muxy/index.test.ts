import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as compat from '../../utils/compat';
import { MuxyMultiplexer } from './index';

describe('MuxyMultiplexer', () => {
  const originalPath = process.env.PATH;
  const originalSocket = process.env.MUXY_SOCKET_PATH;
  const originalPane = process.env.MUXY_PANE_ID;
  let spawnSpy: ReturnType<typeof spyOn>;
  const commands: string[][] = [];

  beforeEach(() => {
    commands.length = 0;
    process.env.MUXY_SOCKET_PATH = '/tmp/muxy.sock';
    process.env.MUXY_PANE_ID = '123e4567-e89b-12d3-a456-426614174000';
    spawnSpy = spyOn(compat, 'crossSpawn').mockImplementation((command) => {
      commands.push(command);
      return {
        exited: Promise.resolve(0),
        stdout: () => Promise.resolve('{"ok":true,"paneID":"123e4567-e89b-12d3-a456-426614174001"}\n'),
        stderr: () => Promise.resolve(''),
        kill: () => true,
        get exitCode() {
          return 0;
        },
      } as ReturnType<typeof compat.crossSpawn>;
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    process.env.PATH = originalPath;
    process.env.MUXY_SOCKET_PATH = originalSocket;
    process.env.MUXY_PANE_ID = originalPane;
  });

  test('spawns child session through muxy-cli pane create', async () => {
    const result = await new MuxyMultiplexer().spawnPane(
      'session-1',
      'Explorer',
      'http://127.0.0.1:4096',
      '/tmp/project',
    );

    expect(result).toEqual({
      success: true,
      paneId: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(commands[0]).toEqual([
      'muxy',
      'pane',
      'create',
      '--title',
      'Explorer',
      '--command',
      "opencode attach 'http://127.0.0.1:4096' --session 'session-1' --dir '/tmp/project'",
      '--cwd',
      '/tmp/project',
      '--source-pane',
      '123e4567-e89b-12d3-a456-426614174000',
    ]);
  });

  test('refuses to spawn without muxy pane id', async () => {
    delete process.env.MUXY_PANE_ID;

    const result = await new MuxyMultiplexer().spawnPane(
      'session-1',
      'Explorer',
      'http://127.0.0.1:4096',
      '/tmp/project',
    );

    expect(result).toEqual({ success: false });
    expect(commands).toHaveLength(0);
  });

  test('closes pane through muxy-cli pane close', async () => {
    const result = await new MuxyMultiplexer().closePane(
      '123e4567-e89b-12d3-a456-426614174001',
    );

    expect(result).toBe(true);
    expect(commands[0]).toEqual([
      'muxy',
      'pane',
      'close',
      '--pane-id',
      '123e4567-e89b-12d3-a456-426614174001',
    ]);
  });

  test('returns failure when muxy-cli cannot be spawned', async () => {
    spawnSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await new MuxyMultiplexer().spawnPane(
      'session-1',
      'Explorer',
      'http://127.0.0.1:4096',
      '/tmp/project',
    );

    expect(result).toEqual({ success: false });
  });

  test('returns false when muxy-cli close cannot be spawned', async () => {
    spawnSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await new MuxyMultiplexer().closePane(
      '123e4567-e89b-12d3-a456-426614174001',
    );

    expect(result).toBe(false);
  });
});

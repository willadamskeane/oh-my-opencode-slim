import { afterEach, describe, expect, test } from 'bun:test';

async function importFreshFactory(suffix: string) {
  return import(`./factory?test=${suffix}-${Date.now()}-${Math.random()}`);
}

describe('multiplexer factory', () => {
  const originalTmux = process.env.TMUX;
  const originalTmuxPane = process.env.TMUX_PANE;
  const originalMuxySocket = process.env.MUXY_SOCKET_PATH;
  const originalMuxyPane = process.env.MUXY_PANE_ID;

  afterEach(() => {
    process.env.TMUX = originalTmux;
    process.env.TMUX_PANE = originalTmuxPane;
    process.env.MUXY_SOCKET_PATH = originalMuxySocket;
    process.env.MUXY_PANE_ID = originalMuxyPane;
  });

  test('returns a fresh tmux instance per call', async () => {
    process.env.TMUX = '/tmp/tmux-1000/default,123,0';
    process.env.TMUX_PANE = '%1';

    const { getMultiplexer } = await importFreshFactory('tmux-first');

    const first = getMultiplexer({
      type: 'tmux',
      layout: 'main-vertical',
      main_pane_size: 60,
    });

    process.env.TMUX_PANE = '%2';

    const { getMultiplexer: getMultiplexerAgain } =
      await importFreshFactory('tmux-second');

    const second = getMultiplexerAgain({
      type: 'tmux',
      layout: 'main-vertical',
      main_pane_size: 60,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Object.is(first, second)).toBe(false);
  });

  test('returns a fresh auto-detected tmux instance per call', async () => {
    process.env.TMUX = '/tmp/tmux-1000/default,123,0';
    process.env.TMUX_PANE = '%1';

    const { getMultiplexer } = await importFreshFactory('auto-first');

    const first = getMultiplexer({
      type: 'auto',
      layout: 'main-vertical',
      main_pane_size: 60,
    });

    process.env.TMUX_PANE = '%2';

    const { getMultiplexer: getMultiplexerAgain } =
      await importFreshFactory('auto-second');

    const second = getMultiplexerAgain({
      type: 'auto',
      layout: 'main-vertical',
      main_pane_size: 60,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Object.is(first, second)).toBe(false);
  });

  test('auto prefers muxy when running inside a muxy pane', async () => {
    process.env.MUXY_SOCKET_PATH = '/tmp/muxy.sock';
    process.env.MUXY_PANE_ID = '123e4567-e89b-12d3-a456-426614174000';
    process.env.TMUX = '/tmp/tmux-1000/default,123,0';

    const { getAutoMultiplexerType, getMultiplexer } =
      await importFreshFactory('muxy-auto');

    expect(getAutoMultiplexerType()).toBe('muxy');
    expect(
      getMultiplexer({
        type: 'auto',
        layout: 'main-vertical',
        main_pane_size: 60,
      })?.type,
    ).toBe('muxy');
  });

  test('auto ignores muxy without a valid pane id', async () => {
    process.env.MUXY_SOCKET_PATH = '/tmp/muxy.sock';
    process.env.MUXY_PANE_ID = 'not-a-uuid';
    process.env.TMUX = '/tmp/tmux-1000/default,123,0';

    const { getAutoMultiplexerType } = await importFreshFactory('muxy-invalid');

    expect(getAutoMultiplexerType()).toBe('tmux');
  });
});

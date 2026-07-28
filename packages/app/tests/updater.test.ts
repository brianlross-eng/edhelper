import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initAutoUpdate } from '../src/main/updater';
import type { UpdaterLike, UpdateInfoLike } from '../src/main/updater';

type FakeUpdater = UpdaterLike & EventEmitter & { checkForUpdates: ReturnType<typeof vi.fn>; quitAndInstall: ReturnType<typeof vi.fn> };

function makeFakeUpdater(): FakeUpdater {
  const fake = new EventEmitter() as FakeUpdater;
  fake.autoDownload = false;
  fake.checkForUpdates = vi.fn().mockResolvedValue(undefined);
  fake.quitAndInstall = vi.fn();
  return fake;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('initAutoUpdate', () => {
  it('not packaged: never checks for updates', () => {
    const updater = makeFakeUpdater();
    initAutoUpdate({ isPackaged: false, updater, showDialog: vi.fn(), log: vi.fn() });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.listenerCount('update-downloaded')).toBe(0);
  });

  it('packaged: enables autoDownload, checks, and shows the dialog on update-downloaded', async () => {
    const updater = makeFakeUpdater();
    const showDialog = vi.fn<(info: UpdateInfoLike) => Promise<'restart' | 'later'>>().mockResolvedValue('later');
    initAutoUpdate({ isPackaged: true, updater, showDialog, log: vi.fn() });
    expect(updater.autoDownload).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    updater.emit('update-downloaded', { version: '1.0.3' });
    await flush();
    expect(showDialog).toHaveBeenCalledWith({ version: '1.0.3' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled(); // 'later' → applies on next quit
  });

  it('restart choice triggers quitAndInstall', async () => {
    const updater = makeFakeUpdater();
    const showDialog = vi.fn<(info: UpdateInfoLike) => Promise<'restart' | 'later'>>().mockResolvedValue('restart');
    initAutoUpdate({ isPackaged: true, updater, showDialog, log: vi.fn() });
    updater.emit('update-downloaded', { version: '1.0.3' });
    await flush();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('updater errors are logged and swallowed (check rejection and error event)', async () => {
    const updater = makeFakeUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error('offline'));
    const log = vi.fn();
    initAutoUpdate({ isPackaged: true, updater, showDialog: vi.fn(), log });
    expect(() => updater.emit('error', new Error('feed unreachable'))).not.toThrow();
    await flush();
    expect(log).toHaveBeenCalledWith('[updater] error: feed unreachable');
    expect(log).toHaveBeenCalledWith('[updater] check failed: offline');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});

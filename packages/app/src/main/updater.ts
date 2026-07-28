// Auto-update wiring (v1.12): electron-updater against GitHub Releases.
// initAutoUpdate takes injected deps so the flow is unit-testable without
// Electron; wireAutoUpdate supplies the real electron-updater + dialog deps.
// All updater failures are logged and swallowed — offline must never break
// the app.

export interface UpdateInfoLike {
  version?: string;
}

export interface UpdaterLike {
  autoDownload: boolean;
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface AutoUpdateDeps {
  isPackaged: boolean;
  updater: UpdaterLike;
  showDialog: (info: UpdateInfoLike) => Promise<'restart' | 'later'>;
  log: (msg: string) => void;
}

export function initAutoUpdate({ isPackaged, updater, showDialog, log }: AutoUpdateDeps): void {
  // Dev runs have no update channel (and electron-updater would throw looking
  // for app-update.yml) — packaged builds only.
  if (!isPackaged) return;

  updater.autoDownload = true;
  updater.on('error', (err) => {
    log(`[updater] error: ${err instanceof Error ? err.message : String(err)}`);
  });
  updater.on('update-downloaded', (info) => {
    void showDialog(info)
      .then((choice) => {
        // 'later' needs no action: electron-updater installs on next quit.
        if (choice === 'restart') updater.quitAndInstall();
      })
      .catch((err) => log(`[updater] dialog failed: ${err instanceof Error ? err.message : String(err)}`));
  });
  updater
    .checkForUpdates()
    .then(() => log('[updater] update check completed'))
    .catch((err) => log(`[updater] check failed: ${err instanceof Error ? err.message : String(err)}`));
}

// Real wiring for index.ts. Imports are dynamic so unit tests can import this
// module (for initAutoUpdate) without loading electron/electron-updater.
export async function wireAutoUpdate(): Promise<void> {
  const { app, dialog } = await import('electron');
  const { autoUpdater } = await import('electron-updater');
  initAutoUpdate({
    isPackaged: app.isPackaged,
    updater: autoUpdater,
    showDialog: async (info) => {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: info.version
          ? `ED Helper ${info.version} has been downloaded.`
          : 'An ED Helper update has been downloaded.',
        detail: 'Restart now to apply the update, or it will be applied the next time you quit.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      return response === 0 ? 'restart' : 'later';
    },
    log: (msg) => console.log(msg),
  });
}

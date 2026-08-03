import type { MenuItemConstructorOptions } from 'electron';

export interface AboutInfo {
  /** App version, e.g. "1.0.11". */
  version: string;
  electron: string;
  chrome: string;
  node: string;
}

export const REPO_URL = 'https://github.com/brianlross-eng/edhelper';

/** Body of the About box. Pure so the wording/version wiring is unit-testable
 *  without booting Electron — the version is the whole point of the dialog
 *  (it's the first thing a bug report needs). */
export function aboutDetail(info: AboutInfo): string {
  return [
    `Version ${info.version}`,
    '',
    'A companion app for Elite Dangerous — Spansh route planning with your',
    'ship data filled in from the game journal.',
    '',
    `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    REPO_URL,
  ].join('\n');
}

export interface MenuDeps {
  info: AboutInfo;
  onAbout: () => void;
  onRepo: () => void;
}

/** Replaces Electron's stock menu (whose Help only links to electronjs.org)
 *  with the standard roles plus Help → About ED Helper. */
export function buildMenuTemplate({ info, onAbout, onRepo }: MenuDeps): MenuItemConstructorOptions[] {
  return [
    { label: 'File', submenu: [{ role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'About ED Helper', click: onAbout },
        { type: 'separator' },
        { label: `ED Helper ${info.version} on GitHub`, click: onRepo },
      ],
    },
  ];
}

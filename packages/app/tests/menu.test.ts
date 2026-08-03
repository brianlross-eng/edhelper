import { describe, it, expect } from 'vitest';
import { aboutDetail, buildMenuTemplate, REPO_URL } from '../src/main/menu';

const INFO = { version: '1.2.3', electron: '37.10.3', chrome: '140.0.0', node: '22.0.0' };

describe('aboutDetail', () => {
  it('leads with the app version — the thing a bug report needs', () => {
    const d = aboutDetail(INFO);
    expect(d.split('\n')[0]).toBe('Version 1.2.3');
    expect(d).toContain('Electron 37.10.3');
    expect(d).toContain('Chromium 140.0.0');
    expect(d).toContain('Node 22.0.0');
    expect(d).toContain(REPO_URL);
  });
});

describe('buildMenuTemplate', () => {
  it('puts About under Help and fires the handlers', () => {
    let about = 0;
    let repo = 0;
    const t = buildMenuTemplate({ info: INFO, onAbout: () => about++, onRepo: () => repo++ });

    const help = t.find((m) => m.label === 'Help')!;
    const items = help.submenu as any[];
    const aboutItem = items.find((i) => i.label === 'About ED Helper')!;
    expect(aboutItem).toBeTruthy();
    aboutItem.click();
    expect(about).toBe(1);

    const repoItem = items.find((i) => String(i.label ?? '').includes('GitHub'))!;
    expect(repoItem.label).toContain('1.2.3'); // version visible without opening the dialog
    repoItem.click();
    expect(repo).toBe(1);
  });

  it('keeps the standard menus', () => {
    const labels = buildMenuTemplate({ info: INFO, onAbout: () => {}, onRepo: () => {} }).map((m) => m.label);
    expect(labels).toEqual(['File', 'Edit', 'View', 'Window', 'Help']);
  });
});

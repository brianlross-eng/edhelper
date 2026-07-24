import type { EdhelperApi } from '../../shared/ipc-types';

declare global {
  interface Window {
    edhelper: EdhelperApi;
  }
}

export const api: EdhelperApi = window.edhelper;

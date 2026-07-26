import { join } from 'node:path';
import type { EngineClientSpawnSpec } from './engine-client.js';

export interface EngineSpawnInputs {
  /** Electron's app.isPackaged. */
  isPackaged: boolean;
  /** process.execPath — the installed Electron binary when packaged. */
  execPath: string;
  /** __dirname of the main bundle (engine-host.js sits beside index.js in out/main). */
  mainDir: string;
  /** process.env.EDHELPER_NODE — dev-only override for the Node binary. */
  edhelperNode?: string;
}

/**
 * Dev machines run the engine host under plain `node`; packaged machines have
 * no Node at all, so the packaged app re-execs its own Electron binary with
 * ELECTRON_RUN_AS_NODE=1. Electron keeps its asar fs-patching active in that
 * mode (this is how child_process.fork works from inside app.asar), so the
 * host path may live inside app.asar. EngineClient merges spec.env OVER
 * process.env, so EDHELPER_JOURNAL_DIR / SPANSH_API_URL still pass through.
 */
export function engineSpawnSpec(inputs: EngineSpawnInputs): EngineClientSpawnSpec {
  const hostPath = join(inputs.mainDir, 'engine-host.js');
  if (inputs.isPackaged) {
    return { command: inputs.execPath, args: [hostPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: inputs.edhelperNode ?? 'node', args: [hostPath] };
}

# EDDN header: report the real app version

**Date:** 2026-08-05
**Status:** Implemented

## Problem

`packages/app/src/host/engine-host.ts` hardcoded the EDDN message header:

```ts
const SOFTWARE = { softwareName: 'EDHelper', softwareVersion: '1.0.0' };
```

Every message we have ever broadcast — across twelve releases — identified as `1.0.0`.

## Why it matters

From EDDN's own [Developers.md](https://github.com/EDCD/EDDN/blob/live/docs/Developers.md):

> "You **MUST** set a pertinent value for `softwareVersion`."

> "Listeners MAY make decisions on whether to accept data, or to treat it differently,
> based on this. As such you **MUST** increment your version number if you make any changes
> to the content of messages your software sends to EDDN."

So this isn't cosmetic. If a future release ships a malformed message, listeners and EDDN
operators have no way to distinguish it from every earlier build, and no way to filter it.

Checked at the same time and found **correct, no change needed**: we send the in-game
Commander name as `uploaderID`, which is exactly what the docs ask for —

> "Please **DO** send a sensible `uploaderID` value, preferably simply the relevant in-game
> Commander name."

— and the Relay obfuscates that value to prevent long-term tracking of individual players.

Note: the docs above are the canonical EDCD repo. `spansh/EDDN` is a fork and may lag.

## Design

The engine host is a plain-Node child process with no access to Electron's `app.getVersion()`,
so the version has to cross the spawn boundary. `engineSpawnSpec()` — already the single,
unit-tested place that describes how the host is launched — now carries it as an env var in
both dev and packaged modes:

```ts
const version = { EDHELPER_VERSION: inputs.appVersion };
if (inputs.isPackaged) {
  return { command: inputs.execPath, args: [hostPath], env: { ELECTRON_RUN_AS_NODE: '1', ...version } };
}
return { command: inputs.edhelperNode ?? 'node', args: [hostPath], env: version };
```

The host reads it through a pure `softwareTag()` in `eddn/builders.ts`, keeping it testable
without importing `engine-host.ts` (whose module body wires stdio on import).

The fallback is `0.0.0-dev`, deliberately not a plausible release number. A `1.0.0` fallback
would be indistinguishable from a real shipped build — which is the bug this fixes. If
`0.0.0-dev` ever appears in EDDN data, it is unambiguously someone running unpackaged.

## Testing

- `softwareTag` reports the passed version; falls back to `0.0.0-dev` for both missing and
  empty env values.
- `engineSpawnSpec` carries the version in dev and packaged modes, and the packaged spec still
  sets `ELECTRON_RUN_AS_NODE`.

## Validation results

- `tsc --noEmit` clean; 208 app tests passing (3 new, 2 updated).
- Live smoke (2026-08-05, dev build): app launched on the modified spawn path with the footer
  reading `Spansh ✓ · Broadcasting · 0 sent · Journal linked`, confirming the engine host
  child started correctly with the added env var. (`0 sent` is expected on this PC — the
  commander plays on another machine, so this journal produces no new events to broadcast.)

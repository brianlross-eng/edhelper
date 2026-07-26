# ED Helper

A Windows desktop companion for **Elite Dangerous** — the Spansh tool set as a
native app, with your ship's data auto-filled from the game journal.

**Ten tools in one cockpit UI:** Trade Planner · Neutron Plotter · Exploration
(Road to Riches / Ammonia / Earth-likes / Rocky-Metal / Exobiology) · Fleet
Carrier Router · Tourist Planner · System Distances · Community Goals · Galaxy
Plotter · Colonisation Plotter · Ship Configure (profiles + auto FSD fuel
model).

- Reads your journal live: commander, ship, location, cargo, credits, jump
  range, and even your FSD's fuel model prefill the forms.
- Travel routes auto-advance as you jump and copy the next waypoint to the
  clipboard — just paste into the galaxy map.
- Broadcasts your market and discovery data to [EDDN](https://github.com/EDCD/EDDN)
  (toggleable in the footer), so the community data you rely on grows too.

## Install

Grab the latest [release](../../releases):

- **`ED-Helper-Setup-<version>.exe`** — per-user installer (Start Menu +
  desktop shortcut, standard uninstall).
- **`ED-Helper-Portable-<version>.exe`** — single-file portable, no install.

> **SmartScreen note:** the binaries are not code-signed, so Windows may show
> "Windows protected your PC" on first run. Click **More info → Run anyway**.
> Building from source (below) avoids this entirely.

Settings live in `%APPDATA%\ED Helper\` and survive uninstall/upgrade.

## Build from source

```bash
npm install
npm run dev            # run in development
npm run dist           # build installer + portable into packages/app/release/
```

Requires Node 20+. The repo is an npm-workspaces monorepo: `packages/engine`
(journal parsing, EDDN, local-data CLI) and `packages/app` (Electron app).

## Notes

- Route/market data comes from the excellent [spansh.co.uk](https://spansh.co.uk)
  API; community goals from Frontier's initiatives API. Be kind to both.
- Docs for every feature (specs, plans, live-probed API findings) are under
  `docs/superpowers/`.

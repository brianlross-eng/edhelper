# ED Helper

A Windows desktop companion for **Elite Dangerous** — the full
[spansh.co.uk](https://spansh.co.uk) tool set as a native app, with your ship's
data auto-filled from the game journal so you barely have to type anything.

**Ten tools in one cockpit UI:** Trade Planner · Neutron Plotter · Exploration
(Road to Riches / Ammonia / Earth-likes / Rocky-Metal / Exobiology) · Fleet
Carrier Router · Tourist Planner · System Distances · Community Goals · Galaxy
Plotter · Colonisation Plotter · Ship Configure (profiles + auto FSD fuel model)

---

## 📥 Download

Go to the **[latest release](https://github.com/brianlross-eng/edhelper/releases/latest)**
and download **one** of:

| File | What it is |
|---|---|
| `ED-Helper-Setup-<version>.exe` | **Installer (recommended).** Installs per-user, adds Start Menu + desktop shortcuts, and auto-updates itself when new versions come out. |
| `ED-Helper-Portable-<version>.exe` | **Portable.** A single file — put it anywhere (USB stick, second PC) and run it. No install, but no auto-update either. |

## 🛠 Install

1. Run `ED-Helper-Setup-<version>.exe`.
2. **Windows will likely show a blue "Windows protected your PC" screen** —
   that's SmartScreen reacting to an unsigned app, not a virus warning.
   Click **More info**, then **Run anyway**.
3. That's it — no options to pick. The app installs to your user folder
   (no admin rights needed) and opens from the Start Menu or the desktop
   shortcut ("ED Helper", orange icon).

To uninstall: Windows Settings → Apps → ED Helper. Your settings and ship
profiles are kept in `%APPDATA%\ED Helper\` and survive uninstalls and updates.

## 🚀 Run

1. **Start the app** (before or after launching Elite Dangerous — either
   works). It finds your journal files automatically in the standard
   `Saved Games\Frontier Developments\Elite Dangerous` location.
2. The left panel shows **your live game state**: commander, ship, location,
   cargo, credits — updated as you play.
3. Pick a tool from the pills across the top. Forms are **prefilled from your
   ship** (start system, jump range, cargo, pad size, even your FSD's fuel
   model on the Galaxy Plotter).
4. Plot a route and hit **START ROUTE** — the next waypoint is copied to your
   clipboard automatically. In game, open the Galaxy Map, paste, jump. Each
   time you jump, the app advances the route and copies the next system.
5. Check the footer lights: **Spansh** (route service reachable),
   **Broadcasting** (your market/discovery data feeding
   [EDDN](https://github.com/EDCD/EDDN) — toggle it there if you prefer not
   to), and **Journal linked**.

### Updates

From v1.0.2 on, the installed app checks for updates on launch, downloads them
in the background, and asks to restart when ready — you never need to come
back here for new versions.

---

## Build from source

```bash
git clone https://github.com/brianlross-eng/edhelper.git
cd edhelper
npm install
npm run dev            # run in development
npm run dist           # build installer + portable into packages/app/release/
```

Requires Node 20+. npm-workspaces monorepo: `packages/engine` (journal
parsing, EDDN, local-data CLI) and `packages/app` (Electron app).

## Notes

- Route and market data come from the excellent [spansh.co.uk](https://spansh.co.uk)
  API; community goals from Frontier's initiatives API. Be kind to both.
- Trade routes verify landing-pad sizes for your ship — stops that can't fit
  you are flagged with a red **NO M PAD** badge.
- Design docs, implementation plans, and live-probed API findings for every
  feature live under `docs/superpowers/`.

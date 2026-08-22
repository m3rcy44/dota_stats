# **Dota 2 Stats for [Millennium](https://steambrew.app)**

### 🧙‍♂️ Display public **Dota 2** stats from [OpenDota](https://www.opendota.com) inside every Steam profile page.

## ⚡ Features
- Pulls profile, MMR estimate, rank tier, win/loss record and hero insights using the public OpenDota API.
- Shows the most played hero, a high-win-rate specialty hero, plus the latest match right inside a Millennium profile card.
- Detects your logged-in Steam account and shows whether the profile has appeared in your public Dota 2 matches before.
- Works inside both the Steam overlay browser and the standalone client.

## 📥 Installation
This plugin targets the current Millennium runtime, using `millennium.toml`, Starlight, and a Lua backend.

If you installed an older build, remove the old `alowave.dota_stats` plugin folder first. The old build used `plugin.json` and a Python backend, which current Millennium versions may mark as outdated.

### Windows without PowerShell
```bat
cd /d %USERPROFILE%\workspace\dota_stats
build_and_install.cmd
```

If your source folder is somewhere else, `cd` into that folder instead.

### Manual build
```bash
pnpm install
pnpm run build
```

After building, restart Steam and enable **Dota 2 Stats** from **Millennium Settings → Plugins**.

## 🔍 Notes
- This plugin relies on the public OpenDota API only. No private keys are required, but heavily rate-limited profiles may take a second to load.
- JavaScript is injected through WebKit to style the Steam profile page. Always review code from third-party sources before installing.
- The logged-in Steam account is detected locally from the Steam client and is used only to query public OpenDota match data.

## ✅ Roadmap ideas
- Toggle between lifetime and recent stats.
- Display party MMR when available from Valve's API.
- Cache OpenDota responses locally to avoid rate limits.

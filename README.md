# **Dota 2 Stats for [Millennium](https://steambrew.app)**

### 🧙‍♂️ Display public **Dota 2** stats from [OpenDota](https://www.opendota.com) inside every Steam profile page.

## ⚡ Features
- Pulls profile, MMR estimate, rank tier, win/loss record and hero insights using the public OpenDota API.
- Shows the most played hero, a high-win-rate specialty hero, plus the latest match right inside a Millennium profile card.
- Detects your logged-in Steam account and shows whether the profile has appeared in your public Dota 2 matches before.
- Works inside both the Steam overlay browser and the standalone client.

## 📥 Installation
> Prefer publishing through [Steambrew](https://steambrew.app) once you are ready to share releases. GitHub builds are unreviewed.

1. Download the latest packaged release archive.
2. Copy the `alowave.dota_stats` folder into your Steam plugins directory:  
   - **Windows:** `C:\\Program Files (x86)\\Steam\\plugins`  
   - **Unix:** `~/.millennium/plugins`
3. Enable the plugin from **Millennium Settings → Plugins**.

## 🛠️ Building from source
```bash
git clone <repo-url>
cd millennium-dota-stats
pnpm install
pnpm run build
```
Copy the resulting folder into your Millennium plugins directory or enable it through CLI:
```bash
millennium plugins enable dota_stats
```

## 🔍 Notes
- This plugin relies on the public OpenDota API only. No private keys are required, but heavily rate-limited profiles may take a second to load.
- JavaScript is injected through WebKit to style the Steam profile page. Always review code from third-party sources before installing.

## ✅ Roadmap ideas
- Toggle between lifetime and recent stats.
- Display party MMR when available from Valve's API.
- Cache OpenDota responses locally to avoid rate limits.

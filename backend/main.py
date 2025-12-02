import json
import os
import shutil
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import Millennium, PluginUtils  # type: ignore
import requests

OPEN_DOTA_API = "https://api.opendota.com/api"
STEAM32_OFFSET = 76561197960265728
REQUEST_TIMEOUT = 10
TOP_HERO_COUNT = 3
RECENT_MATCH_COUNT = 3

MEDAL_NAMES = {
    1: "Herald",
    2: "Guardian",
    3: "Crusader",
    4: "Archon",
    5: "Legend",
    6: "Ancient",
    7: "Divine",
    8: "Immortal",
}

HERO_DICTIONARY: Dict[int, Dict[str, Any]] = {}
LOGGER = PluginUtils.Logger()


def steam64_to_account_id(steam_id: str) -> Optional[int]:
    try:
        account_id = int(steam_id) - STEAM32_OFFSET
        return account_id if account_id > 0 else None
    except (TypeError, ValueError):
        return None


def load_hero_dictionary() -> Dict[int, Dict[str, Any]]:
    global HERO_DICTIONARY
    if HERO_DICTIONARY:
        return HERO_DICTIONARY

    response = requests.get(f"{OPEN_DOTA_API}/heroes", timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    HERO_DICTIONARY = {hero.get("id"): hero for hero in response.json()}
    return HERO_DICTIONARY


def hero_image(hero_data: Dict[str, Any]) -> str:
    raw_name = hero_data.get("name", "")
    slug = raw_name.replace("npc_dota_hero_", "")
    if not slug:
        return ""
    return f"https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/{slug}_full.png"


def format_rank(rank_tier: Optional[int], leaderboard_rank: Optional[int]) -> str:
    if not rank_tier:
        return "Uncalibrated"

    medal = rank_tier // 10
    stars = rank_tier % 10
    if medal >= 8:
        return f"Immortal #{leaderboard_rank}" if leaderboard_rank else "Immortal"

    medal_name = MEDAL_NAMES.get(medal, "Unknown")
    if stars <= 0:
        return medal_name
    return f"{medal_name} {stars}"


def format_duration(seconds: Optional[int]) -> str:
    if not seconds:
        return "Unknown"
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m {secs}s"


def humanize_time(timestamp: Optional[int]) -> str:
    if not timestamp:
        return "Unknown"
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def build_hero_entry(entry: Dict[str, Any], hero_dict: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    hero_meta = hero_dict.get(entry.get("hero_id"), {})
    games = entry.get("games", entry.get("matches", 0)) or 0
    wins = entry.get("win", entry.get("wins", 0)) or 0
    win_rate = round((wins / games) * 100, 1) if games else 0.0
    return {
        "name": hero_meta.get("localized_name", "Unknown hero"),
        "image": hero_image(hero_meta),
        "games": games,
        "wins": wins,
        "winrate": win_rate,
    }


def fetch_json(url: str) -> Any:
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def build_recent_match(entry: Dict[str, Any], hero_dict: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    hero_meta = hero_dict.get(entry.get("hero_id"), {})
    player_slot = entry.get("player_slot", 0)
    is_radiant = player_slot < 128
    radiant_win = bool(entry.get("radiant_win"))
    did_win = radiant_win == is_radiant
    return {
        "match_id": entry.get("match_id"),
        "hero": hero_meta.get("localized_name", "Unknown hero"),
        "hero_image": hero_image(hero_meta),
        "result": "Win" if did_win else "Loss",
        "kills": entry.get("kills", 0),
        "deaths": entry.get("deaths", 0),
        "assists": entry.get("assists", 0),
        "duration": format_duration(entry.get("duration")),
        "started": humanize_time(entry.get("start_time")),
        "started_at": entry.get("start_time"),
        "match_url": f"https://www.opendota.com/matches/{entry.get('match_id')}" if entry.get("match_id") else None,
    }


def get_player_stats(steamId: str) -> Optional[str]:
    account_id = steam64_to_account_id(steamId)
    if account_id is None:
        return None

    try:
        hero_dict = load_hero_dictionary()
        player = fetch_json(f"{OPEN_DOTA_API}/players/{account_id}")
        wl = fetch_json(f"{OPEN_DOTA_API}/players/{account_id}/wl")
        hero_stats = fetch_json(f"{OPEN_DOTA_API}/players/{account_id}/heroes?significant=0")
        recent_matches = fetch_json(
            f"{OPEN_DOTA_API}/players/{account_id}/recentMatches?limit={RECENT_MATCH_COUNT}"
        )
    except requests.RequestException as exc:
        LOGGER.log(f"OpenDota request failed: {exc}")
        return None

    eligible_heroes = [hero for hero in hero_stats if hero.get("games", hero.get("matches", 0))]
    if not eligible_heroes:
        eligible_heroes = hero_stats

    sorted_heroes = sorted(eligible_heroes, key=lambda h: h.get("games", h.get("matches", 0)), reverse=True)
    top_heroes = [build_hero_entry(hero, hero_dict) for hero in sorted_heroes[:TOP_HERO_COUNT]]

    recent_payload = []
    for match in recent_matches[:RECENT_MATCH_COUNT]:
        if isinstance(match, dict):
            recent_payload.append(build_recent_match(match, hero_dict))

    stats_payload = {
        "steam_id": steamId,
        "account_id": account_id,
        "profile": player.get("profile", {}),
        "mmr": player.get("mmr_estimate", {}).get("estimate"),
        "rank_label": format_rank(player.get("rank_tier"), player.get("leaderboard_rank")),
        "wins": wl.get("win", 0),
        "losses": wl.get("lose", 0),
        "winrate": round((wl.get("win", 0) / max(wl.get("win", 0) + wl.get("lose", 0), 1)) * 100, 1),
        "top_heroes": top_heroes,
        "recent_matches": recent_payload,
    }

    return json.dumps(stats_payload)


def GetPluginDir():
    return os.path.abspath(os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', '..'))


class Plugin:
    def copy_frontend_files(self):
        css_source = os.path.join(GetPluginDir(), 'static', 'dota_stats.css')
        steamui_dest = os.path.join(Millennium.steam_path(), 'steamui')

        try:
            if os.path.exists(css_source):
                shutil.copy(css_source, steamui_dest)
                print(f'Copied {css_source} to {steamui_dest}')
            else:
                print(f'File not found: {css_source}')
        except Exception as exc:
            print(f'Error copying frontend files: {exc}')

    def _front_end_loaded(self):
        LOGGER.log("The front end has loaded!")

    def _load(self):
        LOGGER.log(f"Bootstrapping DotaStats, Millennium {Millennium.version()}")
        self.copy_frontend_files()
        Millennium.add_browser_css("dota_stats.css")
        Millennium.ready()

    def _unload(self):
        LOGGER.log("Unloading")

import json
import os
import shutil
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import Millennium, PluginUtils  # type: ignore
import requests

OPEN_DOTA_API = "https://api.opendota.com/api"
STEAM32_OFFSET = 76561197960265728
REQUEST_TIMEOUT = 10
TOP_HERO_COUNT = 3
RECENT_MATCH_COUNT = 3
COMMON_MATCH_DISPLAY_COUNT = 3
COMMON_MATCH_LOOKUP_LIMIT = 20
ENCOUNTER_CACHE_TTL_SECONDS = 600

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
ENCOUNTER_CACHE: Dict[str, Dict[str, Any]] = {}
LOGGER = PluginUtils.Logger()


def steam64_to_account_id(steam_id: str) -> Optional[int]:
    try:
        account_id = int(steam_id) - STEAM32_OFFSET
        return account_id if account_id > 0 else None
    except (TypeError, ValueError):
        return None


def normalize_account_id(value: Any) -> Optional[int]:
    try:
        account_id = int(value)
    except (TypeError, ValueError):
        return None

    if account_id > STEAM32_OFFSET:
        account_id -= STEAM32_OFFSET

    return account_id if account_id > 0 else None


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


def fetch_json(url: str, params: Optional[Dict[str, Any]] = None) -> Any:
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
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


def unavailable_encounter(reason: str, message: str) -> Dict[str, Any]:
    return {
        "available": False,
        "played": False,
        "match_count": 0,
        "capped": False,
        "matches": [],
        "search_url": None,
        "reason": reason,
        "message": message,
    }


def build_encounter_payload(
    viewer_account_id: Any,
    target_account_id: int,
    hero_dict: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    viewer_id = normalize_account_id(viewer_account_id)
    if viewer_id is None:
        return unavailable_encounter(
            "viewer_unknown",
            "Could not detect your Steam account ID, so shared matches were not checked.",
        )

    if viewer_id == target_account_id:
        return unavailable_encounter(
            "own_profile",
            "This is your own Steam profile.",
        )

    cache_key = f"{viewer_id}:{target_account_id}"
    now = time.time()
    cached = ENCOUNTER_CACHE.get(cache_key)
    if cached and now - cached.get("timestamp", 0) < ENCOUNTER_CACHE_TTL_SECONDS:
        return cached["payload"]

    search_url = (
        f"https://www.opendota.com/players/{viewer_id}/matches"
        f"?included_account_id={target_account_id}&significant=0"
    )

    try:
        common_matches = fetch_json(
            f"{OPEN_DOTA_API}/players/{viewer_id}/matches",
            params={
                "included_account_id": target_account_id,
                "significant": 0,
                "limit": COMMON_MATCH_LOOKUP_LIMIT + 1,
            },
        )
    except requests.RequestException as exc:
        LOGGER.log(f"OpenDota encounter lookup failed: {exc}")
        return unavailable_encounter(
            "request_failed",
            "Could not check shared matches right now.",
        )

    if not isinstance(common_matches, list):
        common_matches = []

    visible_matches = common_matches[:COMMON_MATCH_LOOKUP_LIMIT]
    display_matches = [
        build_recent_match(match, hero_dict)
        for match in visible_matches[:COMMON_MATCH_DISPLAY_COUNT]
        if isinstance(match, dict)
    ]
    last_match = visible_matches[0] if visible_matches and isinstance(visible_matches[0], dict) else {}

    payload = {
        "available": True,
        "played": bool(visible_matches),
        "match_count": len(visible_matches),
        "capped": len(common_matches) > COMMON_MATCH_LOOKUP_LIMIT,
        "matches": display_matches,
        "last_played": humanize_time(last_match.get("start_time")),
        "last_played_at": last_match.get("start_time"),
        "search_url": search_url,
        "reason": None,
        "message": None,
    }
    ENCOUNTER_CACHE[cache_key] = {
        "timestamp": now,
        "payload": payload,
    }
    return payload


def get_player_stats(steamId: str, viewerAccountId: Optional[Any] = None) -> Optional[str]:
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
        "encounter": build_encounter_payload(viewerAccountId, account_id, hero_dict),
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

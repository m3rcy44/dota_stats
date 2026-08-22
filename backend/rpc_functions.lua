local http = require("http")
local json = require("json")
local logger = require("logger")
local millennium = require("millennium")

local OPEN_DOTA_API = "https://api.opendota.com/api"
local REQUEST_TIMEOUT = 10
local TOP_HERO_COUNT = 3
local RECENT_MATCH_COUNT = 3
local COMMON_MATCH_DISPLAY_COUNT = 3
local COMMON_MATCH_LOOKUP_LIMIT = 20
local ENCOUNTER_CACHE_TTL_SECONDS = 600

local MEDAL_NAMES = {
    [1] = "Herald",
    [2] = "Guardian",
    [3] = "Crusader",
    [4] = "Archon",
    [5] = "Legend",
    [6] = "Ancient",
    [7] = "Divine",
    [8] = "Immortal",
}

local hero_dictionary = nil
local encounter_cache = {}

local function table_or_empty(value)
    return type(value) == "table" and value or {}
end

local function as_number(value, fallback)
    local parsed = tonumber(value)
    if parsed == nil then
        return fallback or 0
    end
    return parsed
end

local function safe_decode(body)
    if json.safe and json.safe.decode then
        return json.safe.decode(body)
    end

    local ok, result = pcall(json.decode, body)
    if ok then
        return result, nil
    end
    return nil, result
end

local function safe_encode(value)
    if json.safe and json.safe.encode then
        return json.safe.encode(value)
    end

    local ok, result = pcall(json.encode, value)
    if ok then
        return result, nil
    end
    return nil, result
end

local function error_payload(message, detail)
    local encoded = safe_encode({
        error = true,
        message = message,
        detail = detail,
    })
    return encoded or '{"error":true,"message":"Failed to encode error payload"}'
end

local function fetch_json(path, query)
    local url = path
    if not string.match(url, "^https?://") then
        url = OPEN_DOTA_API .. path
    end
    if query and query ~= "" then
        url = url .. "?" .. query
    end

    local response, request_error = http.get(url, {
        timeout = REQUEST_TIMEOUT,
        headers = {
            ["Accept"] = "application/json",
        },
        user_agent = "DotaStatsMillennium/0.2.0",
    })

    if not response then
        return nil, request_error or "request failed"
    end
    local status = tonumber(response.status or response.status_code or response.code)
    if not status then
        return nil, "HTTP response did not include a status code"
    end
    if status < 200 or status >= 300 then
        return nil, "HTTP " .. tostring(status)
    end

    local decoded, decode_error = safe_decode(response.body)
    if not decoded then
        return nil, decode_error or "invalid JSON"
    end
    return decoded, nil
end

local function normalize_account_id(value)
    local account_id = tonumber(value)
    if not account_id then
        return nil
    end

    account_id = math.floor(account_id)
    if account_id <= 0 then
        return nil
    end
    return account_id
end

local function load_hero_dictionary()
    if hero_dictionary then
        return hero_dictionary
    end

    local heroes, err = fetch_json("/heroes")
    if not heroes then
        logger:error("OpenDota heroes request failed: " .. tostring(err))
        return {}
    end

    hero_dictionary = {}
    for _, hero in ipairs(heroes) do
        hero_dictionary[hero.id] = hero
    end
    return hero_dictionary
end

local function hero_image(hero_data)
    hero_data = table_or_empty(hero_data)
    local raw_name = tostring(hero_data.name or "")
    local slug = string.gsub(raw_name, "npc_dota_hero_", "")
    if slug == "" then
        return nil
    end
    return "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/" .. slug .. "_full.png"
end

local function format_rank(rank_tier, leaderboard_rank)
    rank_tier = tonumber(rank_tier)
    if not rank_tier then
        return "Uncalibrated"
    end

    local medal = math.floor(rank_tier / 10)
    local stars = rank_tier % 10
    if medal >= 8 then
        if leaderboard_rank then
            return "Immortal #" .. tostring(leaderboard_rank)
        end
        return "Immortal"
    end

    local medal_name = MEDAL_NAMES[medal] or "Unknown"
    if stars <= 0 then
        return medal_name
    end
    return medal_name .. " " .. tostring(stars)
end

local function format_duration(seconds)
    seconds = tonumber(seconds)
    if not seconds then
        return "Unknown"
    end

    local minutes = math.floor(seconds / 60)
    local secs = seconds % 60
    local hours = math.floor(minutes / 60)
    minutes = minutes % 60

    if hours > 0 then
        return string.format("%dh %dm", hours, minutes)
    end
    return string.format("%dm %ds", minutes, secs)
end

local function humanize_time(timestamp)
    timestamp = tonumber(timestamp)
    if not timestamp then
        return "Unknown"
    end
    return os.date("!%Y-%m-%d %H:%M UTC", timestamp)
end

local function hero_games(entry)
    return as_number(entry.games or entry.matches, 0)
end

local function build_hero_entry(entry, hero_dict)
    entry = table_or_empty(entry)
    local hero_meta = table_or_empty(hero_dict[entry.hero_id])
    local games = hero_games(entry)
    local wins = as_number(entry.win or entry.wins, 0)
    local win_rate = 0
    if games > 0 then
        win_rate = math.floor(((wins / games) * 1000) + 0.5) / 10
    end

    return {
        name = hero_meta.localized_name or "Unknown hero",
        image = hero_image(hero_meta),
        games = games,
        wins = wins,
        winrate = win_rate,
    }
end

local function build_recent_match(entry, hero_dict)
    entry = table_or_empty(entry)
    local hero_meta = table_or_empty(hero_dict[entry.hero_id])
    local player_slot = as_number(entry.player_slot, 0)
    local is_radiant = player_slot < 128
    local radiant_win = entry.radiant_win == true
    local did_win = radiant_win == is_radiant
    local match_id = entry.match_id

    return {
        match_id = match_id,
        hero = hero_meta.localized_name or "Unknown hero",
        hero_image = hero_image(hero_meta),
        result = did_win and "Win" or "Loss",
        kills = as_number(entry.kills, 0),
        deaths = as_number(entry.deaths, 0),
        assists = as_number(entry.assists, 0),
        duration = format_duration(entry.duration),
        started = humanize_time(entry.start_time),
        started_at = entry.start_time,
        match_url = match_id and ("https://www.opendota.com/matches/" .. tostring(match_id)) or nil,
    }
end

local function unavailable_encounter(reason, message)
    return {
        available = false,
        played = false,
        match_count = 0,
        capped = false,
        matches = {},
        reason = reason,
        message = message,
    }
end

local function build_encounter_payload(viewer_account_id, target_account_id, hero_dict)
    local viewer_id = normalize_account_id(viewer_account_id)
    if not viewer_id then
        return unavailable_encounter(
            "viewer_unknown",
            "Could not detect your Steam account ID, so shared matches were not checked."
        )
    end

    if viewer_id == target_account_id then
        return unavailable_encounter("own_profile", "This is your own Steam profile.")
    end

    local cache_key = tostring(viewer_id) .. ":" .. tostring(target_account_id)
    local now = os.time()
    local cached = encounter_cache[cache_key]
    if cached and now - cached.timestamp < ENCOUNTER_CACHE_TTL_SECONDS then
        return cached.payload
    end

    local search_url = "https://www.opendota.com/players/" .. tostring(viewer_id)
        .. "/matches?included_account_id=" .. tostring(target_account_id)
        .. "&significant=0"

    local common_matches, err = fetch_json(
        "/players/" .. tostring(viewer_id) .. "/matches",
        "included_account_id=" .. tostring(target_account_id)
            .. "&significant=0&limit=" .. tostring(COMMON_MATCH_LOOKUP_LIMIT + 1)
    )
    if not common_matches then
        logger:error("OpenDota encounter lookup failed: " .. tostring(err))
        return unavailable_encounter("request_failed", "Could not check shared matches right now.")
    end

    if type(common_matches) ~= "table" then
        common_matches = {}
    end

    local visible_matches = {}
    for index = 1, math.min(#common_matches, COMMON_MATCH_LOOKUP_LIMIT) do
        visible_matches[index] = common_matches[index]
    end

    local display_matches = {}
    for index = 1, math.min(#visible_matches, COMMON_MATCH_DISPLAY_COUNT) do
        display_matches[index] = build_recent_match(visible_matches[index], hero_dict)
    end

    local last_match = table_or_empty(visible_matches[1])
    local payload = {
        available = true,
        played = #visible_matches > 0,
        match_count = #visible_matches,
        capped = #common_matches > COMMON_MATCH_LOOKUP_LIMIT,
        matches = display_matches,
        last_played = humanize_time(last_match.start_time),
        last_played_at = last_match.start_time,
        search_url = search_url,
    }

    encounter_cache[cache_key] = {
        timestamp = now,
        payload = payload,
    }
    return payload
end

---@ffi
---@return string
function getStyles()
    return millennium.assets.read("static/dota_stats.css")
end

local build_player_stats

---@ffi
---@param targetAccountId number
---@param viewerAccountId number|nil
---@return string|nil
function getPlayerStats(targetAccountId, viewerAccountId)
    local ok, result = pcall(function()
        return build_player_stats(targetAccountId, viewerAccountId)
    end)

    if not ok then
        logger:error("Dota Stats getPlayerStats crashed: " .. tostring(result))
        return error_payload("Dota Stats backend crashed.", tostring(result))
    end

    return result
end

function build_player_stats(targetAccountId, viewerAccountId)
    local account_id = normalize_account_id(targetAccountId)
    if not account_id then
        return error_payload("Could not parse this Steam profile account ID.")
    end

    local hero_dict = load_hero_dictionary()
    local player, player_err = fetch_json("/players/" .. tostring(account_id))
    local wl, wl_err = fetch_json("/players/" .. tostring(account_id) .. "/wl")
    local hero_stats, hero_err = fetch_json("/players/" .. tostring(account_id) .. "/heroes", "significant=0")
    local recent_matches, recent_err = fetch_json(
        "/players/" .. tostring(account_id) .. "/recentMatches",
        "limit=" .. tostring(RECENT_MATCH_COUNT)
    )

    if not player or not wl or not hero_stats or not recent_matches then
        logger:error(
            "OpenDota player request failed: "
                .. tostring(player_err or wl_err or hero_err or recent_err)
        )
        return error_payload(
            "OpenDota request failed.",
            tostring(player_err or wl_err or hero_err or recent_err)
        )
    end

    local eligible_heroes = {}
    for _, hero in ipairs(hero_stats) do
        if hero_games(hero) > 0 then
            table.insert(eligible_heroes, hero)
        end
    end
    if #eligible_heroes == 0 then
        eligible_heroes = hero_stats
    end

    table.sort(eligible_heroes, function(a, b)
        return hero_games(a) > hero_games(b)
    end)

    local top_heroes = {}
    for index = 1, math.min(#eligible_heroes, TOP_HERO_COUNT) do
        top_heroes[index] = build_hero_entry(eligible_heroes[index], hero_dict)
    end

    local recent_payload = {}
    for index = 1, math.min(#recent_matches, RECENT_MATCH_COUNT) do
        recent_payload[index] = build_recent_match(recent_matches[index], hero_dict)
    end

    local wins = as_number(wl.win, 0)
    local losses = as_number(wl.lose, 0)
    local total = wins + losses
    local winrate = 0
    if total > 0 then
        winrate = math.floor(((wins / total) * 1000) + 0.5) / 10
    end

    local payload = {
        steam_id = tostring(account_id),
        account_id = account_id,
        profile = table_or_empty(player.profile),
        mmr = table_or_empty(player.mmr_estimate).estimate,
        rank_label = format_rank(player.rank_tier, player.leaderboard_rank),
        wins = wins,
        losses = losses,
        winrate = winrate,
        top_heroes = top_heroes,
        recent_matches = recent_payload,
        encounter = build_encounter_payload(viewerAccountId, account_id, hero_dict),
    }

    local encoded, encode_err = safe_encode(payload)
    if not encoded then
        logger:error("Failed to encode Dota stats payload: " .. tostring(encode_err))
        return error_payload("Failed to encode Dota stats payload.", tostring(encode_err))
    end
    return encoded
end

logger:info("Registered Dota Stats RPC functions")

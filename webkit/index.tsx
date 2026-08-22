type SteamClientApi = {
    WebChat?: {
        GetCurrentUserAccountID?: () => Promise<unknown> | unknown,
    },
    SharedConnection?: {
        GetLogonInfo?: () => Promise<{
            strSteamid?: string,
            strSteamID?: string,
            bLoggedOn?: boolean,
        } | Record<string, unknown>>,
    },
};

type BackendApi = {
    getPlayerStats: (targetAccountId: number, viewerAccountId?: number | null) => Promise<unknown>,
    getStyles: () => Promise<string>,
};

type FrontendApi = {
    getCurrentUserAccountId?: () => Promise<number | null>,
};

declare const SteamClient: SteamClientApi;
declare const backend: BackendApi;
declare const frontend: FrontendApi;

type DotaHero = {
    name: string;
    image?: string;
    games: number;
    wins: number;
    winrate: number;
};

type RecentMatch = {
    match_id?: number;
    hero?: string;
    hero_image?: string;
    result?: string;
    kills?: number;
    deaths?: number;
    assists?: number;
    duration?: string;
    started?: string;
    started_at?: number;
    match_url?: string | null;
};

type DotaEncounter = {
    available: boolean;
    played: boolean;
    match_count: number;
    capped?: boolean;
    matches?: RecentMatch[];
    last_played?: string;
    last_played_at?: number;
    search_url?: string | null;
    reason?: string | null;
    message?: string | null;
};

type DotaStats = {
    error?: boolean;
    message?: string;
    detail?: string;
    steam_id: string;
    account_id: number;
    profile: {
        personaname?: string;
        avatarfull?: string;
        loccountrycode?: string;
    };
    mmr?: number;
    rank_label: string;
    wins: number;
    losses: number;
    winrate: number;
    top_heroes?: DotaHero[];
    recent_matches?: RecentMatch[];
    encounter?: DotaEncounter;
};

const steam32Offset = 76561197960265728n;
const avatarFallback = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/global/dota2_logo.png";
const styleElementId = "dota-stats-styles";

const escapeHtml = (value?: unknown) => {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

const parsePositiveAccountId = (value: unknown) => {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "object") {
        const candidate = value as Record<string, unknown>;
        return parsePositiveAccountId(
            candidate.accountid
                ?? candidate.accountId
                ?? candidate.steamid
                ?? candidate.steamId
                ?? candidate.strSteamid
                ?? candidate.strSteamID
        );
    }

    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) {
        return null;
    }

    if (raw.length >= 16) {
        return steam64ToAccountId(raw);
    }

    const accountId = Number(raw);
    return Number.isInteger(accountId) && accountId > 0 ? accountId : null;
};

const steam64ToAccountId = (steamId?: string | number | null) => {
    const raw = String(steamId ?? "").trim();
    if (!/^\d+$/.test(raw)) {
        return null;
    }

    try {
        const accountId = BigInt(raw) - steam32Offset;
        if (accountId <= 0n || accountId > BigInt(Number.MAX_SAFE_INTEGER)) {
            return null;
        }
        return Number(accountId);
    } catch (error) {
        console.warn("Failed to convert Steam64 ID", error);
        return null;
    }
};

const reportViewerDetection = (source: string, accountId: number | null) => {
    console.log(`Dota Stats viewer account source "${source}": ${accountId ?? "not found"}`);
    return accountId;
};

const accountIdFromSteamCookies = () => {
    const cookieText = document.cookie ?? "";
    const decodedCookieText = decodeURIComponent(cookieText);
    const loginSteamId = decodedCookieText.match(/(?:^|;\s*)steamLoginSecure=(\d{17})\|\|/)?.[1]
        ?? decodedCookieText.match(/(?:^|;\s*)steamLogin=(\d{17})\|\|/)?.[1];
    const machineAuthSteamId = cookieText.match(/(?:^|;\s*)steamMachineAuth(\d{17})=/)?.[1];
    return steam64ToAccountId(loginSteamId ?? machineAuthSteamId);
};

const xmlUrlForProfileHref = (href: string) => {
    const url = new URL(href);
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
        url.pathname = `${url.pathname}/`;
    }
    url.searchParams.set("xml", "1");
    return url.toString();
};

const currentUserProfileHref = () => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#global_actions a[href]"));
    const profileLink = links.find((link) => {
        try {
            const url = new URL(link.href);
            return url.hostname === "steamcommunity.com" && (/^\/(id|profiles)\//).test(url.pathname);
        } catch {
            return false;
        }
    });

    return profileLink?.href ?? null;
};

const accountIdFromCurrentUserProfileLink = async () => {
    const href = currentUserProfileHref();
    if (!href) {
        return null;
    }

    try {
        const accountIdFromUrl = steam64ToAccountId(new URL(href).pathname.match(/\/profiles\/(\d+)/)?.[1]);
        if (accountIdFromUrl) {
            return accountIdFromUrl;
        }

        const response = await fetch(xmlUrlForProfileHref(href));
        const xmlText = await response.text();
        const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
        return steam64ToAccountId(xmlDoc.querySelector("steamID64")?.textContent);
    } catch (error) {
        console.warn("Failed to resolve current Steam user profile link", error);
        return null;
    }
};

const getViewerAccountId = async () => {
    try {
        if (typeof frontend !== "undefined" && frontend.getCurrentUserAccountId) {
            const frontendAccountId = await frontend.getCurrentUserAccountId();
            const parsedFrontendAccountId = parsePositiveAccountId(frontendAccountId);
            reportViewerDetection("frontend", parsedFrontendAccountId);
            if (parsedFrontendAccountId) {
                return parsedFrontendAccountId;
            }
        } else {
            reportViewerDetection("frontend missing", null);
        }
    } catch (error) {
        console.warn("Failed to get current Steam user from frontend", error);
    }

    try {
        if (typeof SteamClient !== "undefined") {
            const accountId = await SteamClient.WebChat?.GetCurrentUserAccountID?.();
            const parsedAccountId = parsePositiveAccountId(accountId);
            reportViewerDetection("webkit SteamClient.WebChat", parsedAccountId);
            if (parsedAccountId) {
                return parsedAccountId;
            }

            const logonInfo = await SteamClient.SharedConnection?.GetLogonInfo?.();
            const steamId = logonInfo?.strSteamid ?? logonInfo?.strSteamID;
            const parsedSteamId = parsePositiveAccountId(steamId);
            reportViewerDetection("webkit SteamClient.SharedConnection", parsedSteamId);
            if (parsedSteamId) {
                return parsedSteamId;
            }
        } else {
            reportViewerDetection("webkit SteamClient missing", null);
        }
    } catch (error) {
        console.warn("Failed to get current Steam user from SteamClient", error);
    }

    const communityGlobals = window as unknown as { g_steamID?: string | number };
    const globalAccountId = parsePositiveAccountId(communityGlobals.g_steamID);
    reportViewerDetection("window.g_steamID", globalAccountId);
    if (globalAccountId) {
        return globalAccountId;
    }

    const cookieAccountId = accountIdFromSteamCookies();
    reportViewerDetection("steam cookies", cookieAccountId);
    if (cookieAccountId) {
        return cookieAccountId;
    }

    const miniProfile = document.querySelector<HTMLElement>("#global_actions [data-miniprofile], #account_pulldown [data-miniprofile]");
    const miniProfileAccountId = parsePositiveAccountId(miniProfile?.dataset?.miniprofile);
    reportViewerDetection("global_actions data-miniprofile", miniProfileAccountId);
    if (miniProfileAccountId) {
        return miniProfileAccountId;
    }

    const profileLinkAccountId = await accountIdFromCurrentUserProfileLink();
    reportViewerDetection("global_actions profile link", profileLinkAccountId);
    return profileLinkAccountId;
};

const profileXmlUrl = () => {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
        url.pathname = `${url.pathname}/`;
    }
    url.searchParams.set("xml", "1");
    return url.toString();
};

const waitForElement = (selector: string, timeout = 10000) => {
    const existing = document.querySelector(selector);
    if (existing) {
        return Promise.resolve(existing);
    }

    return new Promise<Element | null>((resolve) => {
        let observer: MutationObserver;
        const timeoutId = window.setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);

        observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (!element) {
                return;
            }

            window.clearTimeout(timeoutId);
            observer.disconnect();
            resolve(element);
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    });
};

type ProfileMount = {
    parent: Element;
    referenceNode: ChildNode | null;
};

const profileMountSelector = [
    ".profile_rightcol",
    ".profile_leftcol",
    ".profile_content",
    ".profile_header_bg",
    "#responsive_page_template_content",
    ".responsive_page_template_content",
].join(", ");

const waitForProfileMount = async (): Promise<ProfileMount | null> => {
    const element = await waitForElement(profileMountSelector);
    if (!element) {
        return null;
    }

    if (element.classList.contains("profile_header_bg") && element.parentElement) {
        return {
            parent: element.parentElement,
            referenceNode: element.nextSibling,
        };
    }

    return {
        parent: element,
        referenceNode: element.children[1] ?? null,
    };
};

const injectStyles = async () => {
    if (document.getElementById(styleElementId)) {
        return;
    }

    try {
        const css = await backend.getStyles();
        const node = document.createElement("style");
        node.id = styleElementId;
        node.textContent = css;
        document.head.appendChild(node);
    } catch (error) {
        console.warn("Failed to load Dota Stats styles", error);
    }
};

const isSteamProfilePage = () => {
    return window.location.hostname === "steamcommunity.com"
        && (/^\/(id|profiles)\//).test(window.location.pathname);
};

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined) {
        return "N/A";
    }
    return value.toLocaleString();
};

const formatPercentage = (value?: number | null) => {
    if (value === null || value === undefined) {
        return "N/A";
    }
    return `${value.toFixed(1)}%`;
};

const timeAgo = (timestamp?: number | null, fallback?: string) => {
    if (!timestamp) {
        return fallback ?? "Unknown";
    }
    const diffMs = Date.now() - timestamp * 1000;
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w ago`;
};

const heroSection = (heroes: DotaHero[] = []) => {
    if (!heroes.length) {
        return '<div class="dota-message">No hero data yet.</div>';
    }

    return heroes
        .map((hero, index) => `
            <div class="dota-hero">
                ${hero.image ? `<img class="dota-hero__image" src="${escapeHtml(hero.image)}" alt="${escapeHtml(hero.name)}">` : ""}
                <div>
                    <div class="dota-hero__title">#${index + 1} most played</div>
                    <div class="dota-hero__name">${escapeHtml(hero.name)}</div>
                    <div class="dota-hero__meta">${formatNumber(hero.games)} games • ${formatPercentage(hero.winrate)}</div>
                </div>
            </div>
        `)
        .join("");
};

const recentMatchSection = (recent: RecentMatch[] = []) => {
    if (!recent.length) {
        return "";
    }

    const rows = recent
        .map((match) => {
            return `
                <div class="dota-match">
                    ${match.hero_image ? `<img src="${escapeHtml(match.hero_image)}" alt="${escapeHtml(match.hero ?? "Dota hero")}">` : ""}
                    <div class="dota-match__body">
                        <div class="dota-match__title">${escapeHtml(match.hero ?? "Unknown hero")} · ${escapeHtml(match.result ?? "Result unknown")}</div>
                        <div class="dota-match__meta">${formatNumber(match.kills)}/${formatNumber(match.deaths)}/${formatNumber(match.assists)} · ${escapeHtml(match.duration)} · ${escapeHtml(timeAgo(match.started_at, match.started))}</div>
                    </div>
                </div>
            `;
        })
        .join("");

    return `
        <div class="dota-card__recent">
            <div class="dota-card__recent-title">Recent matches</div>
            <div class="dota-card__recent-list">${rows}</div>
        </div>
    `;
};

const encounterSection = (encounter?: DotaEncounter) => {
    if (!encounter) {
        return "";
    }

    if (!encounter.available) {
        return `
            <div class="dota-encounter dota-encounter--unknown">
                <div class="dota-encounter__header">
                    <div>
                        <div class="dota-encounter__label">Shared matches</div>
                        <div class="dota-encounter__title">Not checked</div>
                    </div>
                    <div class="dota-encounter__badge">Unknown</div>
                </div>
                <div class="dota-encounter__meta">${escapeHtml(encounter.message ?? "Shared matches could not be checked.")}</div>
            </div>
        `;
    }

    const countLabel = encounter.capped ? `${encounter.match_count}+` : formatNumber(encounter.match_count);
    const matchWord = encounter.match_count === 1 ? "match" : "matches";
    const statusClass = encounter.played ? "dota-encounter--hit" : "dota-encounter--miss";
    const title = encounter.played ? "Played with you before" : "No shared public matches";
    const badge = encounter.played ? `${countLabel} found` : "None";
    const meta = encounter.played
        ? `${countLabel} public ${matchWord} found · Last seen ${timeAgo(encounter.last_played_at, encounter.last_played)}`
        : "OpenDota did not find public matches with both accounts.";
    const matchRows = asArray<RecentMatch>(encounter.matches)
        .map((match) => `
            <a class="dota-encounter-match" target="_blank" rel="noopener" href="${escapeHtml(match.match_url ?? encounter.search_url ?? "#")}">
                ${match.hero_image ? `<img src="${escapeHtml(match.hero_image)}" alt="${escapeHtml(match.hero ?? "Dota hero")}">` : ""}
                <div class="dota-encounter-match__body">
                    <div class="dota-encounter-match__title">${escapeHtml(match.hero ?? "Unknown hero")} · ${escapeHtml(match.result ?? "Result unknown")}</div>
                    <div class="dota-encounter-match__meta">${formatNumber(match.kills)}/${formatNumber(match.deaths)}/${formatNumber(match.assists)} · ${escapeHtml(timeAgo(match.started_at, match.started))}</div>
                </div>
            </a>
        `)
        .join("");
    const searchLink = encounter.search_url
        ? `<a class="dota-encounter__link" target="_blank" rel="noopener" href="${escapeHtml(encounter.search_url)}">Open shared matches</a>`
        : "";

    return `
        <div class="dota-encounter ${statusClass}">
            <div class="dota-encounter__header">
                <div>
                    <div class="dota-encounter__label">Shared matches</div>
                    <div class="dota-encounter__title">${escapeHtml(title)}</div>
                </div>
                <div class="dota-encounter__badge">${escapeHtml(badge)}</div>
            </div>
            <div class="dota-encounter__meta">${escapeHtml(meta)}</div>
            ${matchRows ? `<div class="dota-encounter__matches">${matchRows}</div>` : ""}
            ${searchLink}
        </div>
    `;
};

const createMessageCard = (message: string) => {
    const node = document.createElement("div");
    node.className = "dota-card";
    node.innerHTML = `<div class="dota-message">${escapeHtml(message)}</div>`;
    return node;
};

const formatError = (message: string, detail?: string) => {
    if (!detail) {
        return message;
    }
    return `${message} (${detail})`;
};

const parseStatsPayload = (payload: unknown): DotaStats | null => {
    if (!payload) {
        return null;
    }
    if (typeof payload === "string") {
        return JSON.parse(payload) as DotaStats;
    }
    if (typeof payload === "object") {
        return payload as DotaStats;
    }
    throw new Error(`Unexpected Dota Stats payload type: ${typeof payload}`);
};

export default async function WebkitMain() {
    console.log("Dota Stats loaded.");
    if (!isSteamProfilePage()) {
        return;
    }

    await injectStyles();
    const mount = await waitForProfileMount();

    if (!mount) {
        console.error("Profile mount container not found");
        return;
    }

    const { parent, referenceNode } = mount;
    const insertCard = (node: Element) => {
        parent.insertBefore(node, referenceNode?.parentNode === parent ? referenceNode : null);
    };

    const loadingBlock = document.createElement("div");
    loadingBlock.className = "dota-card";
    loadingBlock.innerHTML = `
        <div class="dota-loading-container">
            <div class="dota-spinner"></div>
            <div>Fetching Dota data...</div>
        </div>
    `;
    insertCard(loadingBlock);

    const showError = (message: string) => {
        try {
            parent.removeChild(loadingBlock);
        } catch (err) {
            console.error("Failed to remove loading block", err);
        }
        insertCard(createMessageCard(message));
    };

    try {
        const parser = new DOMParser();
        const profileResponse = await fetch(profileXmlUrl());
        const profileXmlText = await profileResponse.text();
        const profileXmlDoc = parser.parseFromString(profileXmlText, "application/xml");
        const steamID64 = profileXmlDoc.querySelector("steamID64")?.textContent ?? "0";
        const targetAccountId = steam64ToAccountId(steamID64);
        const viewerAccountId = await getViewerAccountId();

        if (!targetAccountId) {
            showError("Could not detect this Steam profile ID.");
            return;
        }

        if (typeof backend === "undefined" || !backend.getPlayerStats) {
            showError("Dota Stats backend is not available. Rebuild and reinstall the plugin.");
            return;
        }

        const payload = viewerAccountId
            ? await backend.getPlayerStats(targetAccountId, viewerAccountId)
            : await backend.getPlayerStats(targetAccountId);
        if (!payload) {
            showError("No public Dota 2 data found for this profile.");
            return;
        }

        const stats = parseStatsPayload(payload);
        if (!stats) {
            showError("No public Dota 2 data found for this profile.");
            return;
        }
        if (stats.error) {
            showError(formatError(stats.message ?? "Dota Stats backend returned an error.", stats.detail));
            return;
        }

        const persona = stats.profile?.personaname ?? "Dota Player";
        const avatar = stats.profile?.avatarfull || avatarFallback;
        const heroBlocks = heroSection(asArray<DotaHero>(stats.top_heroes));
        const recentBlock = recentMatchSection(asArray<RecentMatch>(stats.recent_matches));
        const encounterBlock = encounterSection(stats.encounter);
        const dotabuffUrl = `https://www.dotabuff.com/players/${stats.account_id}`;
        const totalMatches = (stats.wins ?? 0) + (stats.losses ?? 0);

        const statsCard = document.createElement("div");
        statsCard.className = "dota-card";
        statsCard.innerHTML = `
            <div class="dota-card__header">
                <img class="dota-card__avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(persona)}">
                <div class="dota-card__identity">
                    <div class="dota-card__name">${escapeHtml(persona)}</div>
                    <div class="dota-card__rank">${escapeHtml(stats.rank_label)}</div>
                    <div class="dota-card__mmr">Matches: ${formatNumber(totalMatches)} · Dota ID: ${stats.account_id}</div>
                </div>
                <div class="dota-card__actions">
                    <a class="dota-button" target="_blank" rel="noopener" href="${escapeHtml(dotabuffUrl)}">Open Dotabuff</a>
                </div>
            </div>
            ${encounterBlock}
            <div class="dota-card__stat-grid">
                <div class="dota-pill">
                    <div class="dota-pill__label">Wins</div>
                    <div class="dota-pill__value">${formatNumber(stats.wins)}</div>
                </div>
                <div class="dota-pill">
                    <div class="dota-pill__label">Losses</div>
                    <div class="dota-pill__value">${formatNumber(stats.losses)}</div>
                </div>
                <div class="dota-pill">
                    <div class="dota-pill__label">Win rate</div>
                    <div class="dota-pill__value">${formatPercentage(stats.winrate)}</div>
                </div>
                <div class="dota-pill">
                    <div class="dota-pill__label">Matches</div>
                    <div class="dota-pill__value">${formatNumber(totalMatches)}</div>
                </div>
            </div>
            <div class="dota-card__heroes">
                ${heroBlocks}
            </div>
            ${recentBlock}
        `;

        parent.removeChild(loadingBlock);
        insertCard(statsCard);
    } catch (error) {
        console.error(error);
        showError("Failed to load Dota 2 stats - please try again in a moment.");
    }
}

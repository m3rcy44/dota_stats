type Millennium = {
    callServerMethod: (methodName: string, kwargs?: Record<string, any>) => Promise<any>,
    findElement: (privateDocument: Document, querySelector: string, timeOut?: number) => Promise<NodeListOf<Element>>,
};

declare const Millennium: Millennium;

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

type DotaStats = {
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
};

const avatarFallback = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/global/dota2_logo.png";

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
                ${hero.image ? `<img class="dota-hero__image" src="${hero.image}" alt="${hero.name}">` : ""}
                <div>
                    <div class="dota-hero__title">#${index + 1} most played</div>
                    <div class="dota-hero__name">${hero.name}</div>
                    <div class="dota-hero__meta">${formatNumber(hero.games)} games • ${formatPercentage(hero.winrate)}</div>
                </div>
            </div>
        `)
        .join("");
};

const recentMatchSection = (recent: RecentMatch[] = []) => {
    if (!recent.length) {
        return '';
    }

    const rows = recent
        .map((match) => {
            return `
                <div class="dota-match">
                    ${match.hero_image ? `<img src="${match.hero_image}" alt="${match.hero ?? 'Dota hero'}">` : ''}
                    <div class="dota-match__body">
                        <div class="dota-match__title">${match.hero ?? 'Unknown hero'} · ${match.result ?? 'Result unknown'}</div>
                        <div class="dota-match__meta">${match.kills}/${match.deaths}/${match.assists} · ${match.duration} · ${timeAgo(match.started_at, match.started)}</div>
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

const createMessageCard = (message: string) => {
    const node = document.createElement("div");
    node.className = "dota-card";
    node.innerHTML = `<div class="dota-message">${message}</div>`;
    return node;
};

export default async function WebkitMain() {
    console.log("Dota Stats loaded.");
    const rightCol = await Millennium.findElement(document, ".profile_rightcol");

    if (!rightCol.length) {
        console.error("Parent container '.profile_rightcol' not found");
        return;
    }

    const parent = rightCol[0];
    const loadingBlock = document.createElement("div");
    loadingBlock.className = "dota-card";
    loadingBlock.innerHTML = `
        <div class="dota-loading-container">
            <div class="dota-spinner"></div>
            <div>Fetching Dota data...</div>
        </div>
    `;
    parent.insertBefore(loadingBlock, parent.children[1] ?? null);

    const showError = (message: string) => {
        try {
            parent.removeChild(loadingBlock);
        } catch (err) {
            console.error("Failed to remove loading block", err);
        }
        parent.insertBefore(createMessageCard(message), parent.children[1] ?? null);
    };

    try {
        const parser = new DOMParser();
        const profileUrl = `${window.location.href}/?xml=1`;
        const profileResponse = await fetch(profileUrl);
        const profileXmlText = await profileResponse.text();
        const profileXmlDoc = parser.parseFromString(profileXmlText, "application/xml");
        const steamID64 = profileXmlDoc.querySelector("steamID64")?.textContent ?? "0";

        const payload = await Millennium.callServerMethod("get_player_stats", { steamId: steamID64 });
        if (!payload) {
            showError("No public Dota 2 data found for this profile.");
            return;
        }

        const stats: DotaStats = JSON.parse(payload);
        const persona = stats.profile?.personaname ?? "Dota Player";
        const avatar = stats.profile?.avatarfull || avatarFallback;
        const heroBlocks = heroSection(stats.top_heroes ?? []);
        const recentBlock = recentMatchSection(stats.recent_matches ?? []);
        const dotabuffUrl = `https://www.dotabuff.com/players/${stats.account_id}`;
        const totalMatches = (stats.wins ?? 0) + (stats.losses ?? 0);

        const statsCard = document.createElement("div");
        statsCard.className = "dota-card";
        statsCard.innerHTML = `
            <div class="dota-card__header">
                <img class="dota-card__avatar" src="${avatar}" alt="${persona}">
                <div class="dota-card__identity">
                    <div class="dota-card__name">${persona}</div>
                    <div class="dota-card__rank">${stats.rank_label}</div>
                    <div class="dota-card__mmr">Matches: ${formatNumber(totalMatches)} · Dota ID: ${stats.account_id}</div>
                </div>
                <div class="dota-card__actions">
                    <a class="dota-button" target="_blank" rel="noopener" href="${dotabuffUrl}">Open Dotabuff</a>
                </div>
            </div>
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
        parent.insertBefore(statsCard, parent.children[1] ?? null);
    } catch (error) {
        console.error(error);
        showError("Failed to load Dota 2 stats – please try again in a moment.");
    }
}

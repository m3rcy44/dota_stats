import { definePlugin, Field } from "millennium";

type SteamClientApi = {
    WebChat?: {
        GetCurrentUserAccountID?: () => Promise<number | string> | number | string,
    },
    SharedConnection?: {
        GetLogonInfo?: () => Promise<{
            strSteamid?: string,
            strSteamID?: string,
            bLoggedOn?: boolean,
        }>,
    },
};

declare const SteamClient: SteamClientApi;

const steam32Offset = 76561197960265728n;

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

const parseAccountId = (value: unknown) => {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "object") {
        const candidate = value as Record<string, unknown>;
        return parseAccountId(
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

const SettingsContent = () => {
    return <Field label="Dota 2 Stats is active" />;
};

/** @ffi */
export async function getCurrentUserAccountId(): Promise<number | null> {
    try {
        const accountId = await SteamClient.WebChat?.GetCurrentUserAccountID?.();
        const parsedAccountId = parseAccountId(accountId);
        if (parsedAccountId) {
            return parsedAccountId;
        }

        const logonInfo = await SteamClient.SharedConnection?.GetLogonInfo?.();
        const parsedSteamId = parseAccountId(logonInfo?.strSteamid ?? logonInfo?.strSteamID);
        if (parsedSteamId) {
            return parsedSteamId;
        }
    } catch (error) {
        console.warn("Failed to get current Steam account ID from frontend", error);
    }

    return null;
}

export default definePlugin(() => {
    console.log("Dota 2 Stats frontend loaded.");

    return {
        title: "Dota 2 Stats",
        content: <SettingsContent />,
    };
});

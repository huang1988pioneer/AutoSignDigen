import fs from "node:fs/promises";
import path from "node:path";

export const rootDir = process.cwd();
export const accountsPath = path.join(rootDir, "accounts.json");
export const profilesDir = path.join(rootDir, "profiles");
export const logsDir = path.join(rootDir, "logs");

export async function loadConfig() {
  try {
    const raw = await fs.readFile(accountsPath, "utf8");
    const config = JSON.parse(raw);

    if (!config.siteUrl) {
      throw new Error("accounts.json is missing siteUrl.");
    }

    if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
      throw new Error("accounts.json is missing accounts.");
    }

    return {
      checkin: {
        apiBaseUrl: "https://api.digen.ai",
        rewardEndpoint: "/v1/credit/reward?action=Login",
        entryTexts: [],
        successTexts: [],
        timeoutMs: 12000,
        delayBetweenAccountsMs: 45000,
        ...(config.checkin ?? {})
      },
      ...config
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("accounts.json was not found. Copy accounts.example.json first.");
    }

    throw error;
  }
}

export function getAccount(config, accountName) {
  return config.accounts.find((account) => account.name === accountName);
}

export function getEnabledAccounts(config) {
  return config.accounts.filter((account) => account.enabled !== false);
}

export function profilePathFor(accountName) {
  return path.join(profilesDir, accountName);
}

export async function ensureRuntimeDirs() {
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
}

export async function existingBrowserExecutable(preferredBrowser = "chrome") {
  const candidates = {
    chrome: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ],
    edge: [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ]
  };

  for (const executablePath of candidates[preferredBrowser] ?? []) {
    try {
      await fs.access(executablePath);
      return executablePath;
    } catch {
      // Try the next installed browser path.
    }
  }

  return null;
}

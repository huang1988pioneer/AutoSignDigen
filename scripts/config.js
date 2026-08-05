import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright";

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

/** Normalize --browser values: chrome | edge | firefox */
export function normalizeBrowserName(preferredBrowser = "chrome") {
  const name = String(preferredBrowser ?? "chrome").trim().toLowerCase();
  if (name === "firefox" || name === "ff") {
    return "firefox";
  }
  if (name === "edge" || name === "msedge") {
    return "edge";
  }
  if (name === "chrome" || name === "chromium" || name === "google-chrome") {
    return "chrome";
  }
  return name || "chrome";
}

export function isFirefoxBrowser(preferredBrowser = "chrome") {
  return normalizeBrowserName(preferredBrowser) === "firefox";
}

export function isEdgeBrowser(preferredBrowser = "chrome") {
  return normalizeBrowserName(preferredBrowser) === "edge";
}

/**
 * Profile folder suffix per browser so sessions never mix.
 * chrome → profiles/<name>
 * edge → profiles/<name>-edge  (primary fallback when Google blocks Chrome)
 * firefox → profiles/<name>-firefox
 */
export function profileFolderName(accountName, preferredBrowser = "chrome") {
  const browser = normalizeBrowserName(preferredBrowser);
  if (browser === "edge") {
    return `${accountName}-edge`;
  }
  if (browser === "firefox") {
    return `${accountName}-firefox`;
  }
  return accountName;
}

export function profilePathFor(accountName, preferredBrowser = "chrome") {
  return path.join(profilesDir, profileFolderName(accountName, preferredBrowser));
}

export async function ensureRuntimeDirs() {
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
}

export async function existingBrowserExecutable(preferredBrowser = "chrome") {
  const browser = normalizeBrowserName(preferredBrowser);
  const candidates = {
    chrome: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    ],
    edge: [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    ],
    firefox: [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
      "/Applications/Firefox.app/Contents/MacOS/firefox",
      "/usr/bin/firefox",
      "/usr/lib/firefox/firefox",
      "/snap/bin/firefox"
    ]
  };

  for (const executablePath of candidates[browser] ?? []) {
    try {
      await fs.access(executablePath);
      return executablePath;
    } catch {
      // Try the next installed browser path.
    }
  }

  return null;
}

/**
 * Launch a persistent context with the matching Playwright engine.
 * chrome → system Chrome (or Playwright Chromium)
 * edge   → system Edge via path or channel "msedge" (recommended Chrome-block fallback)
 * firefox → Playwright Firefox only (system Firefox is often protocol-incompatible)
 *
 * First-time Firefox use: npx playwright install firefox
 */
export async function launchPersistentBrowserContext(accountName, preferredBrowser = "chrome", options = {}) {
  const browser = normalizeBrowserName(preferredBrowser);
  const userDataDir = profilePathFor(accountName, browser);
  const { executablePath: explicitExecutable, useSystemFirefox = false, ...rest } = options;
  const launchOptions = {
    headless: false,
    viewport: { width: 1440, height: 960 },
    ...rest
  };

  if (browser === "firefox") {
    // Prefer Playwright-managed Firefox. System builds frequently mismatch Playwright's protocol.
    let executablePath = explicitExecutable;
    if (executablePath === undefined && useSystemFirefox) {
      executablePath = await existingBrowserExecutable("firefox");
    }
    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`Using system Firefox: ${executablePath}`);
    } else {
      console.log("Using Playwright Firefox (run `npx playwright install firefox` if this is the first time).");
    }
    return firefox.launchPersistentContext(userDataDir, launchOptions);
  }

  if (browser === "edge") {
    // Prefer real Microsoft Edge so Google login behaves like a normal desktop browser.
    if (explicitExecutable) {
      launchOptions.executablePath = explicitExecutable;
      console.log(`Using system Edge: ${explicitExecutable}`);
    } else {
      const edgePath = await existingBrowserExecutable("edge");
      if (edgePath) {
        launchOptions.executablePath = edgePath;
        console.log(`Using system Edge: ${edgePath}`);
      } else {
        // Playwright resolves installed Edge when channel is set.
        launchOptions.channel = "msedge";
        console.log('Using system Edge via Playwright channel "msedge".');
      }
    }
    return chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  // chrome (default)
  const executablePath = explicitExecutable !== undefined
    ? explicitExecutable
    : await existingBrowserExecutable("chrome");
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    console.log(`Using system browser: ${executablePath}`);
  } else {
    launchOptions.channel = "chrome";
    console.log('System Chrome path not found; trying Playwright channel "chrome", else bundled Chromium.');
  }
  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    if (launchOptions.channel === "chrome" && !executablePath) {
      delete launchOptions.channel;
      console.log("Chrome channel unavailable. Falling back to Playwright Chromium.");
      return chromium.launchPersistentContext(userDataDir, launchOptions);
    }
    throw error;
  }
}

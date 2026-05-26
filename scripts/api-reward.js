import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  ensureRuntimeDirs,
  existingBrowserExecutable,
  getAccount,
  loadConfig,
  logsDir,
  profilePathFor
} from "./config.js";

const rawArgs = process.argv.slice(2);
const accountName = rawArgs.find((arg) => !arg.startsWith("-")) ?? "main";
const cdpArg = rawArgs.find((arg) => arg.startsWith("--cdp="));
const browserArg = rawArgs.find((arg) => arg.startsWith("--browser="));
const tokenArg = rawArgs.find((arg) => arg.startsWith("--token="));
const headed = rawArgs.includes("--headed");
const cdpUrl = cdpArg?.split("=")[1];
const browserName = browserArg?.split("=")[1] ?? "chrome";
const tokenNameArg = rawArgs.find((arg) => arg.startsWith("--token-name="));
const tokenName = tokenNameArg?.slice("--token-name=".length);
const explicitToken = tokenArg?.slice("--token=".length)
  || (tokenName ? process.env[tokenName] : undefined)
  || process.env.DIGEN_TOKEN;
const tokenMode = accountName === "token" || Boolean(explicitToken);

const defaultConfig = {
  siteUrl: "https://digen.ai/zh-TW/explore",
  checkin: {
    apiBaseUrl: "https://api.digen.ai",
    rewardEndpoint: "/v1/credit/reward?action=Login"
  }
};

function todayForLogName() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function appendLog(record) {
  const file = path.join(logsDir, `api-reward-${todayForLogName()}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callRewardApiWithToken(config, token) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Digen-Language": "zh-TW",
    "Digen-SessionID": crypto.randomUUID(),
    "Digen-Token": token
  };

  const profileResponse = await fetch(`${config.checkin.apiBaseUrl}/v1/user/profile`, {
    method: "GET",
    headers
  });
  const profileBody = await readResponse(profileResponse);

  if (!profileResponse.ok) {
    return {
      status: "not-authenticated",
      profileStatus: profileResponse.status,
      profileBody
    };
  }

  const rewardResponse = await fetch(`${config.checkin.apiBaseUrl}${config.checkin.rewardEndpoint}`, {
    method: "POST",
    headers
  });

  return {
    status: rewardResponse.ok ? "reward-request-received" : "reward-request-failed",
    profileStatus: profileResponse.status,
    rewardStatus: rewardResponse.status,
    rewardBody: await readResponse(rewardResponse)
  };
}

async function callRewardApi(page, siteUrl, apiBaseUrl, rewardEndpoint) {
  await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  return await page.evaluate(async ({ apiBaseUrl, rewardEndpoint }) => {
    function getCookie(name) {
      return document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");
    }

    async function parseBody(response) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    const token = getCookie("digen_token") || getCookie("digen_token_test") || "";
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "Digen-Language": document.documentElement.lang || "en",
      "Digen-SessionID": crypto.randomUUID()
    };

    if (token) {
      headers["Digen-Token"] = decodeURIComponent(token);
    }

    const profileResponse = await fetch(`${apiBaseUrl}/v1/user/profile`, {
      method: "GET",
      credentials: "include",
      headers
    });

    const profileBody = await parseBody(profileResponse);

    if (!profileResponse.ok) {
      return {
        status: "not-authenticated",
        profileStatus: profileResponse.status,
        profileBody
      };
    }

    const rewardResponse = await fetch(`${apiBaseUrl}${rewardEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers
    });

    return {
      status: rewardResponse.ok ? "reward-request-received" : "reward-request-failed",
      profileStatus: profileResponse.status,
      rewardStatus: rewardResponse.status,
      rewardBody: await parseBody(rewardResponse)
    };
  }, { apiBaseUrl, rewardEndpoint });
}

async function runWithCdp(config) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages().find((candidate) => candidate.url().includes("digen.ai")) ?? await context.newPage();

  try {
    return await callRewardApi(page, config.siteUrl, config.checkin.apiBaseUrl, config.checkin.rewardEndpoint);
  } finally {
    await browser.close();
  }
}

async function runWithProfile(config, account) {
  const executablePath = await existingBrowserExecutable(browserName);
  const context = await chromium.launchPersistentContext(profilePathFor(account.name), {
    executablePath: executablePath ?? undefined,
    headless: !headed,
    viewport: { width: 1440, height: 960 }
  });

  const page = await context.newPage();

  try {
    return await callRewardApi(page, account.siteUrl ?? config.siteUrl, config.checkin.apiBaseUrl, config.checkin.rewardEndpoint);
  } finally {
    await context.close();
  }
}

await ensureRuntimeDirs();

let config;
try {
  config = tokenMode ? defaultConfig : await loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const startedAt = new Date().toISOString();
let result;

try {
  if (tokenMode) {
    if (!explicitToken) {
      throw new Error(`${tokenName || "DIGEN_TOKEN"} is required for token mode.`);
    }

    result = await callRewardApiWithToken(config, explicitToken);
  } else if (cdpUrl) {
    result = await runWithCdp(config);
  } else {
    const account = getAccount(config, accountName);
    if (!account) {
      throw new Error(`Account not found in accounts.json: ${accountName}`);
    }

    result = await runWithProfile(config, account);
  }
} catch (error) {
  result = {
    status: "error",
    error: error.message
  };
}

const record = {
  account: tokenMode ? "token" : cdpUrl ? "cdp" : accountName,
  mode: tokenMode ? "token" : cdpUrl ? "cdp" : "profile",
  cdpUrl,
  ...result,
  startedAt,
  finishedAt: new Date().toISOString()
};

if (record.status === "reward-request-received" && record.rewardBody?.errCode && record.rewardBody.errCode !== 0) {
  record.status = "reward-request-failed";
}

if (record.status === "reward-request-received" && record.rewardBody?.errCode === 0) {
  record.status = "reward-request-ok";
}

await appendLog(record);
console.log(JSON.stringify(record, null, 2));

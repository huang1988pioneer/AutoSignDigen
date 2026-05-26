import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  ensureRuntimeDirs,
  existingBrowserExecutable,
  getEnabledAccounts,
  loadConfig,
  logsDir,
  profilePathFor
} from "./config.js";

const args = new Set(process.argv.slice(2));
const headed = args.has("--headed");
const onlyAccount = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
const browserArg = process.argv.find((arg) => arg.startsWith("--browser="));
const browserName = browserArg?.split("=")[1] ?? "chrome";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayForLogName() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function appendLog(record) {
  const file = path.join(logsDir, `checkin-${todayForLogName()}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textPattern(texts) {
  return new RegExp(texts.map(escapeRegExp).join("|"), "i");
}

async function visibleTextExists(page, texts, timeoutMs) {
  if (!texts.length) {
    return null;
  }

  try {
    const locator = page.getByText(textPattern(texts)).first();
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return (await locator.textContent())?.trim() ?? "matched";
  } catch {
    return null;
  }
}

async function clickFirstVisibleText(page, texts, timeoutMs) {
  if (!texts.length) {
    return null;
  }

  try {
    const locator = page.getByText(textPattern(texts)).first();
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    const matchedText = (await locator.textContent())?.trim() ?? "matched";
    await locator.click({ timeout: 5000 });
    return matchedText;
  } catch {
    return null;
  }
}

async function clickLikelyCheckinControl(page, config) {
  const clickedEntry = await clickFirstVisibleText(page, config.checkin.entryTexts, config.checkin.timeoutMs);
  if (!clickedEntry) {
    return null;
  }

  await page.waitForTimeout(1200);

  const clickedAction = await clickFirstVisibleText(page, [
    "Claim",
    "Check in",
    "Check-in",
    "Go"
  ], 5000);

  return clickedAction ? `${clickedEntry} -> ${clickedAction}` : clickedEntry;
}

function isRewardResponse(response, rewardEndpoint) {
  const url = response.url();
  return url.includes(rewardEndpoint) || (url.includes("/v1/credit/reward") && url.includes("action=Login"));
}

async function waitForRewardResponse(page, rewardPromise, timeoutMs) {
  try {
    return await Promise.race([
      rewardPromise,
      page.waitForTimeout(timeoutMs).then(() => null)
    ]);
  } catch {
    return null;
  }
}

async function runForAccount(config, account) {
  const startedAt = new Date().toISOString();
  const executablePath = await existingBrowserExecutable(browserName);
  const context = await chromium.launchPersistentContext(profilePathFor(account.name), {
    executablePath: executablePath ?? undefined,
    headless: !headed,
    viewport: { width: 1440, height: 960 }
  });

  const page = context.pages()[0] ?? await context.newPage();
  let resolveRewardResponse;
  const rewardPromise = new Promise((resolve) => {
    resolveRewardResponse = resolve;
  });

  page.on("response", async (response) => {
    if (!isRewardResponse(response, config.checkin.rewardEndpoint)) {
      return;
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = null;
      }
    }

    resolveRewardResponse({
      ok: response.ok(),
      status: response.status(),
      url: response.url(),
      body
    });
  });

  try {
    await page.goto(account.siteUrl ?? config.siteUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const rewardResponse = await waitForRewardResponse(page, rewardPromise, 5000);
    if (rewardResponse) {
      return {
        account: account.name,
        status: rewardResponse.ok ? "reward-request-ok" : "reward-request-failed",
        rewardStatus: rewardResponse.status,
        rewardBody: rewardResponse.body,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    }

    const alreadyDone = await visibleTextExists(page, config.checkin.successTexts, config.checkin.timeoutMs);
    if (alreadyDone) {
      return {
        account: account.name,
        status: "already-done",
        matchedText: alreadyDone,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    }

    const clickedText = await clickLikelyCheckinControl(page, config);
    if (!clickedText) {
      return {
        account: account.name,
        status: "needs-login-or-verification",
        reason: "reward-request-not-observed",
        startedAt,
        finishedAt: new Date().toISOString()
      };
    }

    await page.waitForTimeout(2500);

    const successText = await visibleTextExists(page, config.checkin.successTexts, 5000);

    return {
      account: account.name,
      status: successText ? "success" : "clicked-needs-review",
      clickedText,
      matchedText: successText,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      account: account.name,
      status: "error",
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  } finally {
    await context.close();
  }
}

await ensureRuntimeDirs();

let config;
try {
  config = await loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const accounts = getEnabledAccounts(config).filter((account) => !onlyAccount || account.name === onlyAccount);

if (accounts.length === 0) {
  console.error(onlyAccount ? `Enabled account not found: ${onlyAccount}` : "No enabled accounts.");
  process.exit(1);
}

for (const [index, account] of accounts.entries()) {
  console.log(`[${account.name}] starting`);
  const result = await runForAccount(config, account);
  await appendLog(result);
  console.log(`[${account.name}] ${result.status}`);

  if (index < accounts.length - 1) {
    await sleep(config.checkin.delayBetweenAccountsMs);
  }
}

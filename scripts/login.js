import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  ensureRuntimeDirs,
  existingBrowserExecutable,
  getAccount,
  loadConfig,
  profilePathFor
} from "./config.js";

function getAccountName() {
  return process.argv.slice(2).find((arg) => !arg.startsWith("-"));
}

function getBrowserName() {
  const browserArg = process.argv.find((arg) => arg.startsWith("--browser="));
  return browserArg?.split("=")[1] ?? "chrome";
}

const accountName = getAccountName();

if (!accountName) {
  console.error("Specify an account name, for example: node scripts/login.js main");
  process.exit(1);
}

await ensureRuntimeDirs();

let config;
try {
  config = await loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const account = getAccount(config, accountName);

if (!account) {
  console.error(`Account not found in accounts.json: ${accountName}`);
  process.exit(1);
}

const browserName = getBrowserName();
const executablePath = await existingBrowserExecutable(browserName);

if (executablePath) {
  console.log(`Using system browser: ${executablePath}`);
} else {
  console.log(`System ${browserName} was not found. Falling back to Playwright Chromium.`);
}

const context = await chromium.launchPersistentContext(profilePathFor(account.name), {
  executablePath: executablePath ?? undefined,
  headless: false,
  viewport: { width: 1440, height: 960 }
});

const page = context.pages()[0] ?? await context.newPage();
await page.goto(account.siteUrl ?? config.siteUrl, {
  waitUntil: "domcontentloaded",
  timeout: 120000
});

console.log(`Opened login browser for ${account.name}.`);
console.log("Log in to Digen, confirm the account is active, then return here and press Enter.");
console.log("There is no login time limit. Leave this window open until you are done.");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter after login is complete...");
rl.close();

await context.close();
console.log(`Saved profile: ${profilePathFor(account.name)}`);

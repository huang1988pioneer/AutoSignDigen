import { chromium } from "playwright";
import {
  ensureRuntimeDirs,
  existingBrowserExecutable,
  getAccount,
  loadConfig,
  profilePathFor
} from "./config.js";

const args = process.argv.slice(2);
const accountName = args.find((arg) => !arg.startsWith("-"));
const browserName = args.find((arg) => arg.startsWith("--browser="))?.split("=")[1] ?? "chrome";

if (!accountName) throw new Error("Specify an account name.");
await ensureRuntimeDirs();
const config = await loadConfig();
const account = getAccount(config, accountName);
if (!account) throw new Error(`Account not found in accounts.json: ${accountName}`);

const context = await chromium.launchPersistentContext(profilePathFor(account.name), {
  executablePath: await existingBrowserExecutable(browserName) ?? undefined,
  headless: true
});

try {
  const cookies = await context.cookies([account.siteUrl ?? config.siteUrl]);
  const token = cookies.find((cookie) => cookie.name === "digen_token" || cookie.name === "digen_token_test")?.value;
  if (!token) throw new Error("No Digen login token was found. Complete browser login first.");
  console.log(JSON.stringify({ token: decodeURIComponent(token) }));
} finally {
  await context.close();
}

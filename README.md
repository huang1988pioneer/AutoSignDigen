# Digen Auto Sign

Playwright multi-profile daily login reward helper for Digen.

## What Was Found

Digen's frontend includes a `LoginReward` component. When a user is logged in, that component calls:

```text
POST /v1/credit/reward?action=Login
```

The check-in script now watches for that real reward request first. If the request is not observed, it falls back to simple visible text detection.

## Install

```bat
cmd /c npm install
```

## Accounts

Edit `accounts.json` and add one entry per local profile:

```json
{
  "name": "goldshoot0720",
  "enabled": true
}
```

The name is only a local profile name. Do not put passwords in the config file.

## Login

```bat
node scripts/login.js goldshoot0720 --browser=chrome
```

Log in to Digen in the opened browser. After the account is active, return to the terminal and press Enter.

If Google blocks Chrome, try Edge:

```bat
node scripts/login.js goldshoot0720 --browser=edge
```

## Check In

```bat
cmd /c npm run checkin
```

To watch the browser:

```bat
cmd /c npm run checkin:headed
```

If the profile was created with Edge:

```bat
node scripts/checkin.js --headed --browser=edge
```

Results are written to `logs/checkin-YYYY-MM-DD.jsonl`.

## Direct Reward API

This calls the same endpoint the frontend uses, without clicking UI:

```bat
node scripts/api-reward.js goldshoot0720 --headed
```

The frontend API host is:

```text
https://api.digen.ai
```

For a normal Chrome Default profile, first close all Chrome windows, then start Chrome with remote debugging:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --profile-directory="Default" https://digen.ai/zh-TW/explore
```

After Digen is logged in in that Chrome window, run:

```bat
node scripts/api-reward.js --cdp=http://127.0.0.1:9222
```

Results are written to `logs/api-reward-YYYY-MM-DD.jsonl`.

## GitHub Actions

GitHub Actions cannot use the local browser profile. For Actions, save each Digen cookie value named `digen_token` as a repository secret. For `goldshoot0720`, use:

```text
DIGEN_TOKEN1
```

For `abuhg17`, use:

```text
DIGEN_TOKEN2
```

For `fengtuprinfo`, use:

```text
DIGEN_TOKEN3
```

For `feng33feng35feng3`, use:

```text
DIGEN_TOKEN4
```

For `chbondg2`, use:

```text
DIGEN_TOKEN5
```

For `huang1988pioneer`, use:

```text
DIGEN_TOKEN6
```

The workflow at `.github/workflows/digen-daily-reward.yml` can run `DIGEN_TOKEN1` through `DIGEN_TOKEN33`. It runs every day at `21:05 UTC`, which is `05:05` in Taipei, and waits 600 seconds between configured tokens.

Unset token secrets are skipped. During each run, the workflow also checks configured token values for duplicates and writes a warning if two `DIGEN_TOKEN` secrets have the same value.

The workflow can also be started manually from the Actions tab.

The workflow writes the latest JSON results to the GitHub step summary and uploads `logs/` as a workflow artifact, so you can download the run logs from the Actions page.

To test token mode locally:

```bat
cmd /c "set DIGEN_TOKEN1=your_token_value&& npm run api-reward -- token --token-name=DIGEN_TOKEN1"
```

```bat
cmd /c "set DIGEN_TOKEN2=your_token_value&& npm run api-reward -- token --token-name=DIGEN_TOKEN2"
```

```bat
cmd /c "set DIGEN_TOKEN3=your_token_value&& npm run api-reward -- token --token-name=DIGEN_TOKEN3"
```

```bat
cmd /c "set DIGEN_TOKEN4=your_token_value&& npm run api-reward -- token --token-name=DIGEN_TOKEN4"
```

```bat
cmd /c "set DIGEN_TOKEN5=your_token_value&& npm run api-reward -- token --token-name=DIGEN_TOKEN5"
```

Use the same command shape for `DIGEN_TOKEN6` through `DIGEN_TOKEN33`.

## Scheduler

In Windows Task Scheduler, run this command daily with this folder as the working directory:

```bat
cmd /c npm run checkin
```

## Notes

- If Digen asks for CAPTCHA, phone verification, or a fresh login, handle that manually.
- If the frontend changes, update `checkin.rewardEndpoint` in `accounts.json`.
- Make sure your usage follows Digen's terms.

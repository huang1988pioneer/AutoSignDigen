# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Windows users who manage one or more Digen accounts and need a quick, reliable daily reward check-in routine.

## Product Purpose

Digen Auto Sign Desktop makes the existing local Playwright check-in scripts accessible from a Windows desktop interface. Success means users can configure accounts, save browser login sessions locally, run rewards for selected accounts, and understand each outcome without using terminal commands.

## Positioning

The application is a Windows Avalonia control surface over the project's local browser profiles and Node/Playwright automation; credentials remain in the user's browser profiles rather than in the account configuration.

## Operating Context

The tool runs beside this repository on Windows. It uses local Chrome or Edge profile folders under `profiles/`, reads `accounts.json`, invokes the scripts in `scripts/`, and reads structured logs from `logs/`.

## Capabilities and Constraints

- Windows-only for the first release; support Chrome and Edge local browser profiles.
- Manage account names and enabled states in `accounts.json`.
- Open an interactive browser for each account's manual Digen login.
- Run one account or all enabled accounts, then show script output and recent results.
- Preserve the existing Node/Playwright scripts as the automation implementation.
- Never persist passwords or Digen tokens in the desktop application's account configuration.

## Brand Commitments

The product name is Digen Auto Sign. The UI language is Traditional Chinese.

## Evidence on Hand

Existing scripts: `scripts/login.js`, `scripts/checkin.js`, `scripts/api-reward.js`, and `scripts/config.js`; configuration example: `accounts.example.json`; log output is JSONL in `logs/`. No logo, marketing imagery, or other brand assets were supplied.

## Product Principles

- Keep the daily workflow visible and low-risk.
- Make account status and the next recovery action immediately clear.
- Keep authentication local and user-controlled.
- Treat automation results as operational records, not opaque background activity.

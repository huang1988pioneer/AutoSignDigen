# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Repository maintainers who operate one or more Digen accounts and need to renew login tokens and supervise automated daily reward claims.

## Product Purpose

Digen Auto Sign is a desktop companion for the repository's existing Playwright and GitHub Actions automation. It makes account setup, token export, manual workflow runs, and run-status review accessible without manually assembling terminal commands.

## Operating Context

The app runs beside this repository on Windows, macOS, or Linux. A user completes Digen and any third-party login challenges manually in a browser; the app never attempts to bypass OTP, CAPTCHA, or authentication protections. Tokens are copied to the clipboard for GitHub Secrets and are not written into the desktop configuration.

## Capabilities and Constraints

- Accounts use `DIGEN_TOKEN1` through `DIGEN_TOKEN33` GitHub secrets.
- The existing Node/Playwright scripts remain the source of truth for browser automation (`scripts/login.js`, `scripts/export-token.js`, `scripts/api-reward.js`).
- GitHub Actions access requires the authenticated GitHub CLI (`gh`).
- Local account aliases are stored under the user AppData folder and synced into `accounts.json` for script compatibility.

## Brand Commitments

The product name is Digen Auto Sign. The UI language is Traditional Chinese. The desktop shell is modelled after Musicful Flow (AutoSignMusicful).

## Evidence on Hand

- Existing reward automation: `scripts/api-reward.js`, `scripts/checkin.js`
- Existing token export: `scripts/export-token.js`
- Existing workflows: `.github/workflows/digen-daily-reward.yml`, `.github/workflows/check-token-secret-duplicates.yml`

## Product Principles

- Keep authentication visibly manual and user-controlled.
- Make token ownership and secret destinations unambiguous.
- Surface automation state before asking users to act.
- Preserve the repository scripts rather than duplicating their automation logic.

import fs from "node:fs";
import path from "node:path";

/**
 * Write a single-account check-in result JSON for the daily-summary job.
 *
 * Env:
 *   DIGEN_TOKEN_INDEX     required account number (1-33)
 *   DIGEN_ACCOUNT_LABEL   display name
 *   DIGEN_RESULT_DIR      output dir (default: artifacts)
 *   DIGEN_FORCE_STATUS    optional: skipped | failed
 *   DIGEN_FORCE_MESSAGE   optional message when forcing status
 *   DIGEN_LOGS_DIR        logs dir to scan (default: logs)
 */

const STATUS_FROM_LOG = {
  "reward-request-ok": "ok",
  "reward-request-received": "ok",
  "reward-request-failed": "failed",
  "not-authenticated": "failed",
  error: "failed"
};

function normalizeFromLog(record) {
  const errMsg = record?.rewardBody?.errMsg ?? "";
  const creditsRaw = record?.rewardBody?.data?.credits;
  const credits =
    creditsRaw === null || creditsRaw === undefined ? null : Number(creditsRaw);
  const logStatus = record?.status || "unknown";

  let status = STATUS_FROM_LOG[logStatus] || "failed";
  let message = errMsg || logStatus;

  if (status === "ok") {
    if (errMsg === "have rewarded" || (errMsg === "success" && Number(credits) === 0)) {
      status = "already_done";
      message = errMsg === "have rewarded" ? "claimed earlier" : "success with 0 credits";
    } else if (errMsg === "success" && Number(credits) > 0) {
      status = "checked_in";
      message = "new today";
    } else if (record?.rewardBody?.errCode === 0) {
      status = Number(credits) > 0 ? "checked_in" : "already_done";
      message = errMsg || (Number(credits) > 0 ? "new today" : "claimed earlier");
    } else {
      status = "failed";
      message = errMsg || `unexpected reward body (errCode=${record?.rewardBody?.errCode})`;
    }
  } else if (logStatus === "not-authenticated") {
    message = "not authenticated (token expired or invalid)";
  } else if (logStatus === "error") {
    message = record?.error || message || "error";
  }

  return {
    status,
    message,
    creditsDelta: Number.isFinite(credits) ? credits : null,
    profileStatus: record?.profileStatus ?? null,
    rewardStatus: record?.rewardStatus ?? null,
    rawStatus: logStatus,
    finishedAt: record?.finishedAt || new Date().toISOString()
  };
}

function latestJsonlRecord(logsDir) {
  if (!fs.existsSync(logsDir)) return null;
  const files = fs
    .readdirSync(logsDir)
    .filter((name) => name.startsWith("api-reward-") && name.endsWith(".jsonl"))
    .map((name) => path.join(logsDir, name))
    .sort();

  if (files.length === 0) return null;

  const content = fs.readFileSync(files[files.length - 1], "utf8").trim();
  if (!content) return null;

  const lines = content.split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function main() {
  const account = Number(process.env.DIGEN_TOKEN_INDEX);
  if (!Number.isFinite(account) || account < 1) {
    console.error("DIGEN_TOKEN_INDEX is required (positive number).");
    process.exit(1);
  }

  const name =
    process.env.DIGEN_ACCOUNT_LABEL?.trim() ||
    `DIGEN_TOKEN${account}`;
  const outDir = process.env.DIGEN_RESULT_DIR || path.join(process.cwd(), "artifacts");
  const logsDir = process.env.DIGEN_LOGS_DIR || path.join(process.cwd(), "logs");
  const forceStatus = process.env.DIGEN_FORCE_STATUS?.trim();
  const forceMessage = process.env.DIGEN_FORCE_MESSAGE?.trim();

  let row;

  if (forceStatus) {
    row = {
      account,
      name,
      status: forceStatus,
      message: forceMessage || forceStatus,
      creditsDelta: null,
      profileStatus: null,
      rewardStatus: null,
      rawStatus: forceStatus,
      finishedAt: new Date().toISOString()
    };
  } else {
    const record = latestJsonlRecord(logsDir);
    if (!record) {
      row = {
        account,
        name,
        status: "failed",
        message: "no api-reward log found after job",
        creditsDelta: null,
        profileStatus: null,
        rewardStatus: null,
        rawStatus: "missing-log",
        finishedAt: new Date().toISOString()
      };
    } else {
      const normalized = normalizeFromLog(record);
      row = {
        account,
        name,
        ...normalized
      };
    }
  }

  row.runId = process.env.GITHUB_RUN_ID || null;
  row.job = process.env.GITHUB_JOB || null;
  row.tokenName = `DIGEN_TOKEN${account}`;

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "checkin-result.json");
  fs.writeFileSync(outPath, `${JSON.stringify(row, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(row, null, 2));
}

main();

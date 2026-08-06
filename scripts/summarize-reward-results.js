import fs from "node:fs";
import path from "node:path";
import {
  applyRowsToStreakState,
  attachStreaksToRows,
  loadStreakState,
  saveStreakState,
  streakStats,
  taipeiDateString
} from "./checkin-streaks.js";

const STATUS_ORDER = {
  failed: 0,
  checked_in: 1,
  already_done: 2,
  skipped: 3,
  unknown: 9
};

function walkFiles(rootDir, predicate) {
  const files = [];

  function visit(current) {
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      if (predicate(current)) files.push(current);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(current)) {
      visit(path.join(current, entry));
    }
  }

  visit(rootDir);
  return files;
}

function parseAccountFromPath(filePath) {
  const parts = filePath.split(/[/\\]/);
  for (const part of parts) {
    const m =
      part.match(/^checkin-result-(\d+)$/i) ||
      part.match(/^digen-reward-logs-token(\d+)-(.+)$/i);
    if (m) {
      return {
        account: Number(m[1]),
        nameFromPath: m[2] || null
      };
    }
  }
  return { account: null, nameFromPath: null };
}

function normalizeLogRecord(record, fallback = {}) {
  const errMsg = record?.rewardBody?.errMsg ?? "";
  const creditsRaw = record?.rewardBody?.data?.credits;
  const credits =
    creditsRaw === null || creditsRaw === undefined ? null : Number(creditsRaw);
  const logStatus = record?.status || "unknown";

  let status = "failed";
  let message = errMsg || logStatus || "unknown";

  if (logStatus === "reward-request-ok" || logStatus === "reward-request-received") {
    if (errMsg === "have rewarded" || (errMsg === "success" && Number(credits) === 0)) {
      status = "already_done";
      message = errMsg === "have rewarded" ? "claimed earlier" : "success with 0 credits";
    } else if (errMsg === "success" && Number(credits) > 0) {
      status = "checked_in";
      message = "new today";
    } else if (record?.rewardBody?.errCode === 0) {
      status = Number(credits) > 0 ? "checked_in" : "already_done";
      message = errMsg || message;
    } else {
      status = "failed";
      message = errMsg || `errCode=${record?.rewardBody?.errCode}`;
    }
  } else if (logStatus === "not-authenticated") {
    status = "failed";
    message = "not authenticated (token expired or invalid)";
  } else if (logStatus === "error") {
    status = "failed";
    message = record?.error || message;
  } else if (logStatus === "reward-request-failed") {
    status = "failed";
  }

  return {
    account: fallback.account ?? null,
    name: fallback.name || record?.account || "unknown",
    status,
    message,
    creditsDelta: Number.isFinite(credits) ? credits : null,
    profileStatus: record?.profileStatus ?? null,
    rewardStatus: record?.rewardStatus ?? null,
    rawStatus: logStatus,
    finishedAt: record?.finishedAt || null,
    source: fallback.source || null
  };
}

function loadRows(rootDir) {
  const resultFiles = walkFiles(
    rootDir,
    (file) => path.basename(file) === "checkin-result.json" || /checkin-result-\d+\.json$/i.test(path.basename(file))
  );
  const jsonlFiles = walkFiles(
    rootDir,
    (file) => path.basename(file).startsWith("api-reward-") && file.endsWith(".jsonl")
  );

  const rows = [];

  for (const file of resultFiles) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      console.warn(`Skip invalid JSON: ${file} (${error.message})`);
      continue;
    }

    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const fromPath = parseAccountFromPath(file);
      rows.push({
        account: item.account ?? fromPath.account,
        name: item.name || fromPath.nameFromPath || (item.account != null ? `DIGEN_TOKEN${item.account}` : "unknown"),
        status: item.status || "unknown",
        message: item.message || "",
        creditsDelta: item.creditsDelta ?? null,
        profileStatus: item.profileStatus ?? null,
        rewardStatus: item.rewardStatus ?? null,
        rawStatus: item.rawStatus ?? null,
        finishedAt: item.finishedAt || null,
        source: file
      });
    }
  }

  // Fallback: parse raw api-reward jsonl artifacts when structured results are missing.
  if (rows.length === 0) {
    for (const file of jsonlFiles) {
      const content = fs.readFileSync(file, "utf8").trim();
      if (!content) continue;
      const last = content.split(/\r?\n/).filter(Boolean).at(-1);
      let record;
      try {
        record = JSON.parse(last);
      } catch (error) {
        console.warn(`Skip invalid JSONL: ${file} (${error.message})`);
        continue;
      }
      const fromPath = parseAccountFromPath(file);
      rows.push(
        normalizeLogRecord(record, {
          account: fromPath.account,
          name: fromPath.nameFromPath || `token${fromPath.account ?? "?"}`,
          source: file
        })
      );
    }
  }

  const byKey = new Map();
  for (const row of rows) {
    const key =
      row.account != null ? `account:${row.account}` : `name:${row.name}`;
    byKey.set(key, row);
  }

  return [...byKey.values()].sort((a, b) => {
    const aNum = a.account ?? Number.MAX_SAFE_INTEGER;
    const bNum = b.account ?? Number.MAX_SAFE_INTEGER;
    if (aNum !== bNum) return aNum - bNum;
    return String(a.name).localeCompare(String(b.name));
  });
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function statusLabel(status) {
  switch (status) {
    case "checked_in":
      return "✅ checked_in";
    case "already_done":
      return "☑️ already_done";
    case "skipped":
      return "⏭️ skipped";
    case "failed":
      return "❌ failed";
    default:
      return escapeCell(status);
  }
}

function fmtCredits(value) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (num > 0) return `+${num}`;
  return String(num);
}

function fmtStreak(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return `${num}d`;
}

function buildMarkdown(rows, meta = {}) {
  const counts = {
    total: rows.length,
    checked_in: rows.filter((r) => r.status === "checked_in").length,
    already_done: rows.filter((r) => r.status === "already_done").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    failed: rows.filter((r) => r.status === "failed").length,
    ok: rows.filter((r) => r.status === "checked_in" || r.status === "already_done").length
  };

  const gained = rows.reduce((sum, row) => {
    const delta = Number(row.creditsDelta);
    return Number.isFinite(delta) && delta > 0 ? sum + delta : sum;
  }, 0);

  const streaks = meta.streakStats || {
    accountsWithStreak: rows.filter((r) => (r.streak || 0) > 0).length,
    maxStreak: rows.reduce((m, r) => Math.max(m, Number(r.streak) || 0), 0),
    avgStreak: 0
  };

  const generatedAt = meta.generatedAt || new Date().toISOString();
  const title = meta.title || "Digen daily login reward summary";
  const headline =
    counts.failed === 0
      ? "**✅ All reported accounts OK**"
      : `**⚠️ Failed accounts: ${counts.failed}**`;

  const lines = [
    `## ${title}`,
    "",
    headline,
    "",
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| Reported | **${counts.total}** |`,
    `| New check-in | **${counts.checked_in}** |`,
    `| Already done | **${counts.already_done}** |`,
    `| OK total | **${counts.ok}** |`,
    `| Failed | **${counts.failed}** |`,
    `| Skipped (no secret) | **${counts.skipped}** |`,
    `| Credits gained this run | **+${gained}** |`,
    `| Active streaks | **${streaks.accountsWithStreak}** |`,
    `| Max consecutive days | **${streaks.maxStreak}** |`,
    `| Avg consecutive days | **${streaks.avgStreak}** |`,
    "",
    `- Generated at: \`${generatedAt}\``,
    meta.asOfDate ? `- Streak date (Asia/Taipei): \`${meta.asOfDate}\`` : null,
    meta.runUrl ? `- Workflow run: ${meta.runUrl}` : null,
    "",
    "### Account results",
    "",
    `| # | Account | Status | Credits | Streak | Longest | Note |`,
    `| ---: | --- | --- | ---: | ---: | ---: | --- |`,
    ...rows.map((row) => {
      const no = row.account ?? "—";
      return `| ${no} | ${escapeCell(row.name)} | ${statusLabel(row.status)} | ${fmtCredits(
        row.creditsDelta
      )} | ${fmtStreak(row.streak)} | ${fmtStreak(row.longestStreak)} | ${escapeCell(row.message)} |`;
    }),
    ""
  ].filter((line) => line !== null);

  const failedRows = rows
    .filter((r) => r.status === "failed")
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  if (failedRows.length > 0) {
    lines.push("### Failed accounts", "");
    for (const row of failedRows) {
      lines.push(`- **#${row.account ?? "?"} ${row.name}**: ${escapeCell(row.message)}`);
    }
    lines.push("");
  }

  const skipped = rows.filter((r) => r.status === "skipped").map((r) => r.account).filter((n) => n != null);
  if (skipped.length > 0) {
    lines.push("### Skipped", "");
    lines.push(`No secret: **#${skipped.join(", ")}**`);
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "<sub>Status: `checked_in` = claimed this run · `already_done` = already claimed today · `skipped` = token secret missing · `failed` = re-auth or API error · Streak = consecutive Asia/Taipei calendar days with successful check-in</sub>",
    ""
  );

  return { markdown: `${lines.join("\n")}\n`, counts, gained, streaks };
}

function printConsoleTable(rows, counts, gained, streaks) {
  console.log("\n========== Digen daily reward summary ==========");
  console.log(
    `Total: ${counts.total} | checked_in: ${counts.checked_in} | already_done: ${counts.already_done} | skipped: ${counts.skipped} | failed: ${counts.failed} | gained: +${gained}`
  );
  if (streaks) {
    console.log(
      `Streaks: active ${streaks.accountsWithStreak} | max ${streaks.maxStreak}d | avg ${streaks.avgStreak}d`
    );
  }
  for (const row of rows) {
    console.log(
      `- #${row.account ?? "?"} ${row.name}: ${row.status} | ${fmtCredits(row.creditsDelta)} | streak ${fmtStreak(row.streak)} (best ${fmtStreak(row.longestStreak)}) | ${row.message}`
    );
  }
  console.log("================================================\n");
}

function main() {
  const inputDir = process.argv[2] || path.join(process.cwd(), "collected");
  const outDir = process.env.DIGEN_SUMMARY_DIR || path.join(process.cwd(), "artifacts");
  const streakStatePath =
    process.env.DIGEN_STREAK_STATE ||
    path.join(process.cwd(), "streak-state", "checkin-streaks.json");
  const failOnFailed = process.env.DIGEN_FAIL_ON_FAILED !== "0";

  const baseRows = loadRows(inputDir);
  if (baseRows.length === 0) {
    const message = `No check-in result JSON or api-reward logs found under ${inputDir}`;
    console.error(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Digen daily login reward summary\n\n❌ ${message}\n`,
        "utf8"
      );
    }
    process.exitCode = 1;
    return;
  }

  const asOfDate = process.env.DIGEN_STREAK_DATE || taipeiDateString();
  const prevStreakState = loadStreakState(streakStatePath);
  const streakState = applyRowsToStreakState(prevStreakState, baseRows, asOfDate);
  const rows = attachStreaksToRows(baseRows, streakState);
  const streaks = streakStats(streakState);
  saveStreakState(streakStatePath, streakState);

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl =
    repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : null;

  const { markdown, counts, gained } = buildMarkdown(rows, {
    title: "Digen daily login reward summary",
    generatedAt: new Date().toISOString(),
    runUrl,
    asOfDate,
    streakStats: streaks
  });

  printConsoleTable(rows, counts, gained, streaks);

  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "checkin-daily-summary.md");
  const jsonPath = path.join(outDir, "checkin-daily-summary.json");
  const streaksOutPath = path.join(outDir, "checkin-streaks.json");
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        asOfDate,
        timezone: "Asia/Taipei",
        runUrl,
        counts,
        gained,
        streaks,
        rows
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(streaksOutPath, `${JSON.stringify(streakState, null, 2)}\n`, "utf8");

  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${streaksOutPath}`);
  console.log(`Updated streak state: ${streakStatePath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
  }

  if (failOnFailed && counts.failed > 0) {
    console.error(`Daily summary detected problems: ${counts.failed} account(s) failed`);
    process.exitCode = 1;
  }
}

main();

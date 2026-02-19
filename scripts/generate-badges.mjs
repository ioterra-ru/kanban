import fs from "node:fs/promises";
import path from "node:path";

function fmtPct(pct) {
  if (!Number.isFinite(pct)) return "unknown";
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function colorForPct(pct) {
  if (!Number.isFinite(pct)) return "lightgrey";
  if (pct >= 100) return "brightgreen";
  if (pct >= 95) return "green";
  if (pct >= 85) return "yellowgreen";
  if (pct >= 70) return "yellow";
  return "red";
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function sumTests(reports) {
  let passed = 0;
  let total = 0;
  for (const r of reports) {
    passed += Number(r?.numPassedTests ?? 0);
    total += Number(r?.numTotalTests ?? 0);
  }
  const pct = total > 0 ? (passed / total) * 100 : Number.NaN;
  return { passed, total, pct };
}

function sumCoverageLines(summaries) {
  let covered = 0;
  let total = 0;
  for (const s of summaries) {
    const lines = s?.total?.lines;
    covered += Number(lines?.covered ?? 0);
    total += Number(lines?.total ?? 0);
  }
  const pct = total > 0 ? (covered / total) * 100 : Number.NaN;
  return { covered, total, pct };
}

function ensurePosix(p) {
  return p.split(path.sep).join(path.posix.sep);
}

async function main() {
  const repoRoot = process.cwd();
  const backendReport = path.join(repoRoot, "backend", "vitest-report.json");
  const frontendReport = path.join(repoRoot, "frontend", "vitest-report.json");
  const backendCoverage = path.join(repoRoot, "backend", "coverage", "coverage-summary.json");
  const frontendCoverage = path.join(repoRoot, "frontend", "coverage", "coverage-summary.json");

  const [bReport, fReport, bCov, fCov] = await Promise.all([
    readJson(backendReport),
    readJson(frontendReport),
    readJson(backendCoverage),
    readJson(frontendCoverage),
  ]);

  const tests = sumTests([bReport, fReport]);
  const cov = sumCoverageLines([bCov, fCov]);

  const outDir = path.join(repoRoot, "badges");
  await fs.mkdir(outDir, { recursive: true });

  const testsBadge = {
    schemaVersion: 1,
    label: "tests",
    message: `${fmtPct(tests.pct)} (${tests.passed}/${tests.total})`,
    color: colorForPct(tests.pct),
  };

  const coverageBadge = {
    schemaVersion: 1,
    label: "coverage",
    message: `${fmtPct(cov.pct)} (${cov.covered}/${cov.total} lines)`,
    color: colorForPct(cov.pct),
  };

  await fs.writeFile(path.join(outDir, "tests.json"), JSON.stringify(testsBadge, null, 2) + "\n");
  await fs.writeFile(path.join(outDir, "coverage.json"), JSON.stringify(coverageBadge, null, 2) + "\n");

  // Helpful for local runs/logs
  process.stdout.write(
    [
      `Wrote ${ensurePosix(path.relative(repoRoot, path.join(outDir, "tests.json")))}`,
      `Wrote ${ensurePosix(path.relative(repoRoot, path.join(outDir, "coverage.json")))}`,
    ].join("\n") + "\n",
  );
}

await main();


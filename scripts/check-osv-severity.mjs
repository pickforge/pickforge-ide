import { readFileSync } from "node:fs";

const [reportPath, ...expectedLockfiles] = process.argv.slice(2);
if (!reportPath || expectedLockfiles.length === 0) {
  console.error(
    "usage: node scripts/check-osv-severity.mjs <osv-report.json> <lockfile>...",
  );
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (!Array.isArray(report.results)) {
  throw new Error("OSV report is missing its results array");
}

const scannedPaths = report.results.map((result) => result.source?.path).filter(Boolean);
for (const lockfile of expectedLockfiles) {
  const suffix = `/${lockfile}`;
  if (!scannedPaths.some((path) => path === lockfile || path.endsWith(suffix))) {
    throw new Error(`OSV report is missing lockfile: ${lockfile}`);
  }
}

const groups = report.results.flatMap((result) =>
  (result.packages ?? []).flatMap(({ package: pkg, groups: packageGroups = [] }) =>
    packageGroups.map((group) => ({
      package: `${pkg?.ecosystem ?? "unknown"}:${pkg?.name ?? "unknown"}@${pkg?.version ?? "unknown"}`,
      ids: group.ids ?? [],
      severity: group.max_severity,
    })),
  ),
);
const blocking = groups.filter(({ ids, severity }) => {
  if (ids.length === 0) return false;
  const normalized = String(severity ?? "").trim().toUpperCase();
  if (normalized === "HIGH" || normalized === "CRITICAL") return true;
  if (normalized === "") return true;
  const numericSeverity = Number(normalized);
  return !Number.isFinite(numericSeverity) || numericSeverity >= 7;
});

console.log(
  `OSV dependency audit: ${groups.length} advisories, ${blocking.length} blocking; scanned ${expectedLockfiles.length} lockfiles.`,
);
for (const finding of blocking) {
  console.error(`${finding.severity ?? "missing"} ${finding.ids.join(", ")} (${finding.package})`);
}
if (blocking.length > 0) process.exit(1);

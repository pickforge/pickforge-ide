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

const vulnerabilitiesById = new Map(
  report.results.flatMap((result) =>
    (result.packages ?? []).flatMap(({ vulnerabilities = [] }) =>
      vulnerabilities.filter(({ id }) => id).map((vulnerability) => [vulnerability.id, vulnerability]),
    ),
  ),
);
const groups = report.results.flatMap((result) =>
  (result.packages ?? []).flatMap(({ package: pkg, groups: packageGroups = [] }) =>
    packageGroups.map((group) => ({
      package: `${pkg?.ecosystem ?? "unknown"}:${pkg?.name ?? "unknown"}@${pkg?.version ?? "unknown"}`,
      ids: group.ids ?? [],
      severity: group.max_severity,
    })),
  ),
);
function isInformational(vulnerability) {
  return Boolean(
    vulnerability?.withdrawn ||
      vulnerability?.database_specific?.informational ||
      vulnerability?.affected?.some(({ database_specific: details }) => details?.informational),
  );
}
const skippedInformational = [];
const blocking = groups.filter((group) => {
  const { ids, severity } = group;
  if (ids.length === 0) return false;
  const normalized = String(severity ?? "").trim().toUpperCase();
  const numericSeverity = normalized === "" ? Number.NaN : Number(normalized);
  if (Number.isFinite(numericSeverity)) return numericSeverity >= 7;
  if (normalized === "HIGH" || normalized === "CRITICAL") return true;
  if (ids.every((id) => isInformational(vulnerabilitiesById.get(id)))) {
    skippedInformational.push(group);
    return false;
  }
  return true;
});

console.log(
  `OSV dependency audit: ${groups.length} advisories, ${blocking.length} blocking; scanned ${expectedLockfiles.length} lockfiles.`,
);
for (const finding of skippedInformational) {
  console.log(`skipped informational ${finding.ids.join(", ")} (${finding.package})`);
}
for (const finding of blocking) {
  console.error(`${finding.severity ?? "missing"} ${finding.ids.join(", ")} (${finding.package})`);
}
if (blocking.length > 0) process.exit(1);

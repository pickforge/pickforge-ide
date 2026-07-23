import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node scripts/check-osv-severity.mjs <osv-report.json>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const groups = report.results.flatMap((result) =>
  result.packages.flatMap(({ package: pkg, groups: packageGroups }) =>
    packageGroups.map((group) => ({
      package: `${pkg.ecosystem}:${pkg.name}@${pkg.version}`,
      ids: group.ids,
      severity: group.max_severity,
    })),
  ),
);
const blocking = groups.filter(({ severity }) => {
  const normalized = String(severity).toUpperCase();
  return normalized === "HIGH" || normalized === "CRITICAL" || Number(severity) >= 7;
});

console.log(
  `OSV dependency audit: ${groups.length} advisories, ${blocking.length} high/critical.`,
);
for (const finding of blocking) {
  console.error(`${finding.severity} ${finding.ids.join(", ")} (${finding.package})`);
}
if (blocking.length > 0) process.exit(1);

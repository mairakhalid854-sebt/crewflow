import { spawnSync } from 'node:child_process';
import process from 'node:process';

const reviewedAdvisories = new Map([
  [
    'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
    {
      packageName: 'zod',
      reviewBy: '2026-11-10',
      severity: 'high',
      source: 1243066,
    },
  ],
]);

function fail(message) {
  process.stderr.write(`Mobile dependency audit policy failed: ${message}\n`);
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) fail('npm_execpath is unavailable. Run this policy through npm.');

const audit = spawnSync(
  process.execPath,
  [npmCli, 'audit', '--omit=dev', '--workspace', '@crewflow/mobile', '--json'],
  { encoding: 'utf8', shell: false },
);

if (!audit.stdout) {
  fail(audit.stderr?.trim() || 'npm audit returned no JSON report.');
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  fail('npm audit returned malformed JSON.');
}

if (report.error) {
  fail(report.error.summary || report.error.message || 'npm audit errored.');
}

const observed = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const cause of vulnerability.via ?? []) {
    if (typeof cause === 'string' || !cause.url) continue;
    observed.set(cause.url, {
      packageName: cause.name,
      severity: cause.severity,
      source: cause.source,
    });
  }
}

if (!observed.size && audit.status === 0) {
  process.stdout.write(
    'Mobile production dependencies have no known vulnerabilities.\n',
  );
  process.exit(0);
}

for (const [url, details] of observed) {
  const reviewed = reviewedAdvisories.get(url);
  if (!reviewed) fail(`unreviewed advisory ${url}`);
  if (
    details.packageName !== reviewed.packageName ||
    details.severity !== reviewed.severity ||
    details.source !== reviewed.source
  ) {
    fail(`reviewed advisory metadata changed for ${url}`);
  }
}

for (const [url, reviewed] of reviewedAdvisories) {
  if (!observed.has(url)) {
    fail(
      `reviewed advisory ${url} is no longer present; remove the stale exception`,
    );
  }
  if (new Date() > new Date(`${reviewed.reviewBy}T23:59:59.999Z`)) {
    fail(`review period expired for ${url} on ${reviewed.reviewBy}`);
  }
}

process.stderr.write(
  `Mobile release remains blocked by ${observed.size} reviewed transitive advisories. ` +
    'No new advisories were found; review is required again by 2026-11-10.\n',
);

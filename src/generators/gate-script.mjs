import { coverageCommand } from './coverage.mjs';

/**
 * Generates the standalone quality-gate script content for a target project.
 *
 * @param {object} config
 * @param {Set<string>} config.checks         - Active checks: 'eslint', 'coverage', 'duplication', 'audit'
 * @param {string}      config.coverageReportPath
 * @param {string}      config.packageManager
 * @param {string|null} config.testRunner
 * @param {string}      config.lintExtensions
 * @param {boolean}     config.hasSrcDir
 * @param {string}      config.srcDirName
 * @param {string}      config.projectName
 * @param {boolean}     config.isTypeScript
 * @returns {string}
 */
export function generateGateScript(config) {
  const {
    checks,
    coverageReportPath,
    packageManager,
    testRunner,
    lintExtensions,
    hasSrcDir,
    srcDirName,
    projectName,
    isTypeScript,
  } = config;

  const hasEslint = checks.has('eslint');
  const hasCoverage = checks.has('coverage');
  const hasDuplication = checks.has('duplication');
  const hasAudit = checks.has('audit');
  const hasMutation = checks.has('mutation');
  const hasComplexity = checks.has('complexity');

  const pm = packageManager ?? 'npm';
  const auditCmd =
    pm === 'pnpm' ? 'pnpm audit --reporter json' :
    pm === 'yarn' ? 'yarn npm audit --json' :
    'npm audit --json';

  const srcDir = hasSrcDir ? srcDirName : '.';
  const eslintCmd = isTypeScript
    ? `npx eslint ${srcDir} --ext ${lintExtensions} --format json --output-file reports/eslint.json || true`
    : `npx eslint ${srcDir} --format json --output-file reports/eslint.json || true`;

  // Coverage path depending on runner; derive the output dir for the forced flags.
  const covPath = coverageReportPath ?? 'coverage/coverage-summary.json';
  const covLastSlash = covPath.lastIndexOf('/');
  const coverageDir = covLastSlash >= 0 ? covPath.slice(0, covLastSlash) : 'reports/coverage';

  // Build metrics definitions (only for selected checks)
  const metricsDefs = [];
  if (hasEslint) {
    metricsDefs.push(
      `  eslint_errors:    { label: 'ESLint errors',        unit: 'errors',  lowerIsBetter: true,  blocking: false },`,
      `  eslint_warnings:  { label: 'ESLint warnings',      unit: 'warnings',lowerIsBetter: true,  blocking: false },`,
    );
  }
  if (hasCoverage) {
    metricsDefs.push(
      `  coverage_lines:   { label: 'Coverage lines %',     unit: '%',       lowerIsBetter: false, blocking: true  },`,
      `  coverage_branches:{ label: 'Coverage branches %',  unit: '%',       lowerIsBetter: false, blocking: true  },`,
      `  coverage_functions:{ label: 'Coverage functions %',unit: '%',       lowerIsBetter: false, blocking: true  },`,
    );
  }
  if (hasDuplication) {
    metricsDefs.push(
      `  duplicate_percent:{ label: 'Duplication %',        unit: '%',       lowerIsBetter: true,  blocking: true  },`,
    );
  }
  if (hasAudit) {
    metricsDefs.push(
      `  audit_critical:   { label: 'Critical vulns',       unit: 'vulns',   lowerIsBetter: true,  blocking: 'zero'},`,
      `  audit_high:       { label: 'High vulns',           unit: 'vulns',   lowerIsBetter: true,  blocking: false },`,
    );
  }
  if (hasMutation) {
    metricsDefs.push(
      `  mutation_score:   { label: 'Mutation score',       unit: '%',       lowerIsBetter: false, blocking: false },`,
    );
  }
  if (hasComplexity) {
    metricsDefs.push(
      `  complexity_violations:     { label: 'Complexity violations',     unit: 'funcs', lowerIsBetter: true,  blocking: false },`,
      `  long_function_violations:  { label: 'Long function violations',  unit: 'funcs', lowerIsBetter: true,  blocking: false },`,
    );
  }

  // Build gather-metrics section
  const gatherParts = [];

  if (hasEslint) {
    gatherParts.push(`
  // --- ESLint ---
  // null = report unavailable (missing/unreadable); a numeric 0 means "ran, found none".
  let eslintErrors = null;
  let eslintWarnings = null;
  if (existsSync('reports/eslint.json')) {
    try {
      const eslintData = JSON.parse(readFileSync('reports/eslint.json', 'utf8'));
      eslintErrors = 0;
      eslintWarnings = 0;
      for (const file of eslintData) {
        eslintErrors   += file.errorCount   ?? 0;
        eslintWarnings += file.warningCount ?? 0;
      }
    } catch (e) {
      warn('Could not parse reports/eslint.json: ' + e.message);
    }
  } else {
    warn('reports/eslint.json not found — ESLint step may have been skipped');
  }
  metrics.eslint_errors   = eslintErrors;
  metrics.eslint_warnings = eslintWarnings;`);
  }

  if (hasCoverage) {
    gatherParts.push(`
  // --- Coverage ---
  const covPath = '${covPath}';
  if (existsSync(covPath)) {
    try {
      const covData = JSON.parse(readFileSync(covPath, 'utf8'));
      const total = covData.total ?? {};
      metrics.coverage_lines     = total.lines?.pct     ?? null;
      metrics.coverage_branches  = total.branches?.pct  ?? null;
      metrics.coverage_functions = total.functions?.pct ?? null;
    } catch (e) {
      warn('Could not parse coverage report: ' + e.message);
      metrics.coverage_lines     = null;
      metrics.coverage_branches  = null;
      metrics.coverage_functions = null;
    }
  } else {
    warn(covPath + ' not found — coverage step may have been skipped');
    metrics.coverage_lines     = null;
    metrics.coverage_branches  = null;
    metrics.coverage_functions = null;
  }`);
  }

  if (hasDuplication) {
    gatherParts.push(`
  // --- Duplication (jscpd) ---
  const jscpdReportPath = 'reports/jscpd-report.json';
  if (existsSync(jscpdReportPath)) {
    try {
      const jscpdData = JSON.parse(readFileSync(jscpdReportPath, 'utf8'));
      const dupPct = jscpdData?.statistics?.total?.percentage;
      metrics.duplicate_percent = typeof dupPct === 'number' ? parseFloat(dupPct.toFixed(2)) : null;
    } catch (e) {
      warn('Could not parse jscpd report: ' + e.message);
      metrics.duplicate_percent = null;
    }
  } else {
    warn(jscpdReportPath + ' not found — jscpd may not have run yet');
    metrics.duplicate_percent = null;
  }`);
  }

  if (hasMutation) {
    gatherParts.push(`
  // --- Mutation score (Stryker) ---
  const mutationReportPath = 'reports/mutation/mutation.json';
  if (existsSync(mutationReportPath)) {
    try {
      const mutData = JSON.parse(readFileSync(mutationReportPath, 'utf8'));
      let killed = 0, total = 0;
      for (const file of Object.values(mutData.files ?? {})) {
        for (const mutant of file.mutants ?? []) {
          if (mutant.status === 'Ignored' || mutant.status === 'CompileError') continue;
          total++;
          if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed++;
        }
      }
      metrics.mutation_score = total > 0 ? parseFloat(((killed / total) * 100).toFixed(2)) : null;
    } catch (e) {
      warn('Could not parse mutation report: ' + e.message);
      metrics.mutation_score = null;
    }
  } else {
    warn(mutationReportPath + ' not found — Stryker may not have run yet');
    metrics.mutation_score = null;
  }`);
  }

  if (hasComplexity) {
    gatherParts.push(`
  // --- Complexity (cyclomatic complexity + function size) ---
  const complexityReportPath = 'reports/complexity.json';
  if (existsSync(complexityReportPath)) {
    try {
      const cxData = JSON.parse(readFileSync(complexityReportPath, 'utf8'));
      let complexViolations = 0;
      let longFnViolations = 0;
      for (const file of cxData) {
        for (const msg of file.messages ?? []) {
          if (msg.ruleId === 'complexity') complexViolations++;
          else if (msg.ruleId === 'max-lines-per-function') longFnViolations++;
        }
      }
      metrics.complexity_violations    = complexViolations;
      metrics.long_function_violations = longFnViolations;
    } catch (e) {
      warn('Could not parse complexity report: ' + e.message);
      metrics.complexity_violations    = null;
      metrics.long_function_violations = null;
    }
  } else {
    warn(complexityReportPath + ' not found — complexity scan may not have run yet');
    metrics.complexity_violations    = null;
    metrics.long_function_violations = null;
  }`);
  }

  if (hasAudit) {
    gatherParts.push(`
  // --- npm audit ---
  const auditReportPath = 'reports/audit.json';
  if (existsSync(auditReportPath)) {
    try {
      const auditRaw = JSON.parse(readFileSync(auditReportPath, 'utf8'));
      // npm audit --json format
      const meta = auditRaw?.metadata?.vulnerabilities;
      if (meta && typeof meta === 'object') {
        // npm v7+ format: { info, low, moderate, high, critical, total }
        metrics.audit_critical = meta.critical ?? 0;
        metrics.audit_high     = meta.high     ?? 0;
      } else if (auditRaw?.advisories && typeof auditRaw.advisories === 'object') {
        // Older format: count from advisories
        let crit = 0, high = 0;
        for (const adv of Object.values(auditRaw.advisories)) {
          if (adv.severity === 'critical') crit++;
          else if (adv.severity === 'high') high++;
        }
        metrics.audit_critical = crit;
        metrics.audit_high     = high;
      } else {
        // Unrecognised shape — never silently report 0 critical vulns.
        warn('Audit report has an unrecognised shape — treating as unavailable');
        metrics.audit_critical = null;
        metrics.audit_high     = null;
      }
    } catch (e) {
      warn('Could not parse audit report: ' + e.message);
      metrics.audit_critical = null;
      metrics.audit_high     = null;
    }
  } else {
    warn(auditReportPath + ' not found — audit step may have been skipped');
    metrics.audit_critical = null;
    metrics.audit_high     = null;
  }`);
  }

  // Build generate-baseline commands
  const baselineCmds = [];
  if (hasEslint) {
    baselineCmds.push(`  log('Running ESLint...');`);
    baselineCmds.push(`  execSync(${JSON.stringify(eslintCmd)}, { stdio: 'inherit', shell: true });`);
  }
  if (hasCoverage) {
    const covScript = coverageCommand({ testRunner, dir: coverageDir });
    baselineCmds.push(`  log('Running tests with coverage...');`);
    baselineCmds.push(`  execSync(${JSON.stringify(covScript)}, { stdio: 'inherit', shell: true });`);
  }
  if (hasDuplication) {
    baselineCmds.push(`  log('Running jscpd...');`);
    baselineCmds.push(`  execSync('npx jscpd ${srcDir} --reporters json --output reports/', { stdio: 'inherit', shell: true });`);
  }
  if (hasAudit) {
    baselineCmds.push(`  log('Running audit...');`);
    baselineCmds.push(`  execSync(${JSON.stringify(`${auditCmd} > reports/audit.json || true`)}, { stdio: 'inherit', shell: true });`);
  }
  if (hasMutation) {
    baselineCmds.push(`  log('Running Stryker mutation tests...');`);
    baselineCmds.push(`  execSync('npx stryker run', { stdio: 'inherit', shell: true });`);
  }
  if (hasComplexity) {
    const complexityCmd = isTypeScript
      ? `npx eslint ${srcDir} --ext ${lintExtensions} --rule '{"complexity":["warn",10],"max-lines-per-function":["warn",50]}' --format json --output-file reports/complexity.json || true`
      : `npx eslint ${srcDir} --rule '{"complexity":["warn",10],"max-lines-per-function":["warn",50]}' --format json --output-file reports/complexity.json || true`;
    baselineCmds.push(`  log('Running complexity scan...');`);
    baselineCmds.push(`  execSync(${JSON.stringify(complexityCmd)}, { stdio: 'inherit', shell: true });`);
  }

  return `#!/usr/bin/env node
/**
 * quality-gate.mjs — Generated by boatman
 * Project: ${projectName}
 *
 * This script implements a ratchet-style quality gate:
 *  - Reads current metrics from report files
 *  - Compares against baseline.json (committed to the repo)
 *  - Exits with code 1 if any blocking metric has regressed
 *  - Detects improvements and reports them
 *
 * Usage:
 *   node scripts/quality-gate.mjs                 # CI mode (Markdown output)
 *   node scripts/quality-gate.mjs --local         # Human-readable terminal output
 *   node scripts/quality-gate.mjs --generate-baseline  # Run tools and save baseline
 *
 * Typical npm scripts:
 *   quality:gate         → node scripts/quality-gate.mjs
 *   quality:gate:local   → node scripts/quality-gate.mjs --local
 *   quality:baseline     → node scripts/quality-gate.mjs --generate-baseline
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BASELINE_PATH = join(ROOT, 'baseline.json');

const isLocal        = process.argv.includes('--local');
const isGenBaseline  = process.argv.includes('--generate-baseline');
const isCI           = !isLocal && !isGenBaseline;

// ─── ANSI helpers (only when --local) ───────────────────────────────────────
const c = {
  reset:  isLocal ? '\\x1b[0m'  : '',
  bold:   isLocal ? '\\x1b[1m'  : '',
  dim:    isLocal ? '\\x1b[2m'  : '',
  green:  isLocal ? '\\x1b[32m' : '',
  yellow: isLocal ? '\\x1b[33m' : '',
  red:    isLocal ? '\\x1b[31m' : '',
  cyan:   isLocal ? '\\x1b[36m' : '',
};

function log(msg)  { console.log(msg); }
function warn(msg) { console.warn(\`\${c.yellow}⚠  \${msg}\${c.reset}\`); }

// ─── Metric definitions ──────────────────────────────────────────────────────
/**
 * lowerIsBetter: true  → regression when current > baseline
 * lowerIsBetter: false → regression when current < baseline
 * blocking: true       → exit 1 on regression
 * blocking: 'zero'     → exit 1 if current > 0 (must stay at 0)
 * blocking: false      → warn only
 */
const METRIC_DEFS = {
${metricsDefs.join('\n')}
};

// ─── Gather metrics ──────────────────────────────────────────────────────────
async function gatherMetrics() {
  const metrics = {};
${gatherParts.join('\n')}
  return metrics;
}

// ─── Generate baseline ───────────────────────────────────────────────────────
async function generateBaseline() {
  log(\`\${c.bold}Generating quality baseline for ${projectName}...\${c.reset}\\n\`);
  mkdirSync(join(ROOT, 'reports'), { recursive: true });

${baselineCmds.join('\n')}

  const metrics = await gatherMetrics();
  const baseline = {
    generatedAt: new Date().toISOString(),
    commit: (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: 'pipe' }).toString().trim(); } catch { return 'unknown'; } })(),
    project: '${projectName}',
    metrics,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\\n', 'utf8');
  log(\`\\n\${c.green}✔ Baseline saved to baseline.json\${c.reset}\`);
  log(\`\${c.dim}Commit this file to track quality improvements over time.\${c.reset}\\n\`);
  log('Current metrics:');
  for (const [key, val] of Object.entries(metrics)) {
    const def = METRIC_DEFS[key];
    log(\`  \${def?.label ?? key}: \${c.cyan}\${val === null ? 'N/A' : val}\${c.reset} \${def?.unit ?? ''}\`);
  }
  const missing = Object.entries(metrics).filter(([, v]) => v === null).map(([k]) => METRIC_DEFS[k]?.label ?? k);
  if (missing.length > 0) {
    warn('Some metrics could not be measured and were stored as null: ' + missing.join(', '));
    warn('Those tools may not have run. Re-run the baseline once they are configured so it is complete.');
  }
  log('');
}

// ─── Ratchet comparison ──────────────────────────────────────────────────────
function compareMetrics(current, baseline) {
  const regressions = [];
  const improvements = [];
  const unchanged = [];
  const unavailable = [];

  for (const [key, def] of Object.entries(METRIC_DEFS)) {
    const cur = current[key] ?? null;
    const base = baseline[key] ?? null;

    if (cur === null) {
      // Report missing or unreadable — we cannot verify this metric.
      unavailable.push({ key, def, cur: null, base });
      continue;
    }
    if (base === null) {
      // No baseline value; treat as new metric
      unchanged.push({ key, def, cur, base: 'N/A' });
      continue;
    }

    const curNum  = typeof cur  === 'number' ? cur  : parseFloat(cur);
    const baseNum = typeof base === 'number' ? base : parseFloat(base);

    if (isNaN(curNum) || isNaN(baseNum)) {
      unchanged.push({ key, def, cur, base });
      continue;
    }

    // blocking: 'zero' — current must be 0
    if (def.blocking === 'zero') {
      if (curNum > 0) {
        regressions.push({ key, def, cur: curNum, base: baseNum });
      } else {
        unchanged.push({ key, def, cur: curNum, base: baseNum });
      }
      continue;
    }

    const threshold = 0.1; // allow tiny floating-point differences
    const isRegression = def.lowerIsBetter
      ? curNum > baseNum + threshold
      : curNum < baseNum - threshold;
    const isImprovement = def.lowerIsBetter
      ? curNum < baseNum - threshold
      : curNum > baseNum + threshold;

    if (isRegression) {
      regressions.push({ key, def, cur: curNum, base: baseNum });
    } else if (isImprovement) {
      improvements.push({ key, def, cur: curNum, base: baseNum });
    } else {
      unchanged.push({ key, def, cur: curNum, base: baseNum });
    }
  }

  return { regressions, improvements, unchanged, unavailable };
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtDelta(cur, base, lowerIsBetter) {
  if (typeof cur !== 'number' || typeof base !== 'number') return '';
  const delta = cur - base;
  const sign = delta >= 0 ? '+' : '';
  const arrow = lowerIsBetter
    ? (delta > 0 ? '↑' : '↓')
    : (delta > 0 ? '↑' : '↓');
  return \`\${sign}\${delta.toFixed(2)} \${arrow}\`;
}

// ─── Local (terminal) output ──────────────────────────────────────────────────
function printLocal(current, result) {
  const { regressions, improvements, unchanged, unavailable } = result;
  log(\`\${c.bold}Quality Gate — ${projectName}\${c.reset}\\n\`);

  if (improvements.length > 0) {
    log(\`\${c.green}\${c.bold}Improvements:\${c.reset}\`);
    for (const { def, cur, base } of improvements) {
      log(\`  \${c.green}✔\${c.reset} \${def.label}: \${c.green}\${cur} \${def.unit}\${c.reset}  (was \${base} \${def.unit}  \${fmtDelta(cur, base, def.lowerIsBetter)})\`);
    }
    log('');
  }

  if (unchanged.length > 0) {
    log(\`\${c.dim}Unchanged:\${c.reset}\`);
    for (const { def, cur, base } of unchanged) {
      log(\`  \${c.dim}─\${c.reset} \${def.label}: \${cur} \${def.unit ?? ''}\`);
    }
    log('');
  }

  const blocking = regressions.filter((r) => r.def.blocking !== false);
  const warnings = regressions.filter((r) => r.def.blocking === false);
  const unavailBlocking = unavailable.filter((u) => u.def.blocking !== false);
  const unavailWarn = unavailable.filter((u) => u.def.blocking === false);

  if (warnings.length > 0 || unavailWarn.length > 0) {
    log(\`\${c.yellow}Warnings (non-blocking):\${c.reset}\`);
    for (const { def, cur, base } of warnings) {
      log(\`  \${c.yellow}⚠\${c.reset} \${def.label}: \${c.yellow}\${cur} \${def.unit}\${c.reset}  (was \${base} \${def.unit}  \${fmtDelta(cur, base, def.lowerIsBetter)})\`);
    }
    for (const { def } of unavailWarn) {
      log(\`  \${c.yellow}⚠\${c.reset} \${def.label}: \${c.yellow}report unavailable\${c.reset} \${c.dim}(metric could not be measured)\${c.reset}\`);
    }
    log('');
  }

  const failed = blocking.length > 0 || unavailBlocking.length > 0;

  if (blocking.length > 0) {
    log(\`\${c.red}\${c.bold}Regressions (BLOCKING):\${c.reset}\`);
    for (const { def, cur, base } of blocking) {
      log(\`  \${c.red}✘\${c.reset} \${def.label}: \${c.red}\${cur} \${def.unit}\${c.reset}  (was \${base} \${def.unit}  \${fmtDelta(cur, base, def.lowerIsBetter)})\`);
    }
    log('');
  }

  if (unavailBlocking.length > 0) {
    log(\`\${c.red}\${c.bold}Reports unavailable (BLOCKING):\${c.reset}\`);
    for (const { def, base } of unavailBlocking) {
      log(\`  \${c.red}✘\${c.reset} \${def.label}: \${c.red}report missing or unreadable\${c.reset}  (baseline \${base} \${def.unit}) — ensure this step ran and produced its report\`);
    }
    log('');
  }

  if (failed) {
    log(\`\${c.red}\${c.bold}Quality gate FAILED.\${c.reset} Fix the issues above, then run:\`);
    log(\`  \${c.cyan}npm run quality:gate:local\${c.reset}\\n\`);
    return false;
  }

  log(\`\${c.green}\${c.bold}Quality gate PASSED.\${c.reset}\\n\`);
  return true;
}

// ─── CI (Markdown) output ─────────────────────────────────────────────────────
function printMarkdown(current, result) {
  const { regressions, improvements, unchanged, unavailable } = result;
  const blocking = regressions.filter((r) => r.def.blocking !== false);
  const unavailBlocking = unavailable.filter((u) => u.def.blocking !== false);
  const passed = blocking.length === 0 && unavailBlocking.length === 0;
  const status = passed ? '✅ Quality Gate PASSED' : '❌ Quality Gate FAILED';

  const lines = [];
  lines.push(\`## \${status}\`);
  lines.push('');
  lines.push(\`**Project:** \\\`${projectName}\\\`\`);
  lines.push(\`**Generated:** \${new Date().toISOString()}\`);
  lines.push('');

  // Metrics table
  lines.push('### Metrics');
  lines.push('');
  lines.push('| Metric | Current | Baseline | Delta | Status |');
  lines.push('|--------|---------|----------|-------|--------|');

  const allRows = [...improvements, ...unchanged, ...regressions, ...unavailable];
  for (const { key, def, cur, base } of allRows) {
    const delta = (typeof cur === 'number' && typeof base === 'number')
      ? fmtDelta(cur, base, def.lowerIsBetter)
      : '—';
    let statusIcon = '➡️';
    if (improvements.some((i) => i.key === key)) statusIcon = '✅';
    else if (unavailable.some((u) => u.key === key)) statusIcon = def.blocking !== false ? '❌' : '⚠️';
    else if (regressions.some((r) => r.key === key)) {
      statusIcon = def.blocking !== false ? '❌' : '⚠️';
    }
    const curCell  = cur  === null || cur  === undefined ? 'N/A' : \`\${cur} \${def.unit}\`;
    const baseCell = base === null || base === undefined || base === 'N/A' ? 'N/A' : \`\${base} \${def.unit}\`;
    lines.push(\`| \${def.label} | \${curCell} | \${baseCell} | \${delta} | \${statusIcon} |\`);
  }
  lines.push('');

  if (blocking.length > 0) {
    lines.push('### ❌ Blocking Regressions');
    lines.push('');
    for (const { def, cur, base } of blocking) {
      lines.push(\`- **\${def.label}**: \${cur} \${def.unit} ← was \${base} \${def.unit}\`);
    }
    lines.push('');
    lines.push('> Fix these regressions before merging, then run \`npm run quality:baseline\` if the new values are intentional.');
    lines.push('');
  }

  if (unavailBlocking.length > 0) {
    lines.push('### ❌ Reports Unavailable');
    lines.push('');
    for (const { def, base } of unavailBlocking) {
      lines.push(\`- **\${def.label}**: report missing or unreadable (baseline \${base} \${def.unit}). Ensure the step ran and produced its report.\`);
    }
    lines.push('');
    lines.push('> A required metric could not be measured, so the gate cannot pass. This is treated as a failure rather than silently ignored.');
    lines.push('');
  }

  if (improvements.length > 0) {
    lines.push('### ✅ Improvements Detected');
    lines.push('');
    for (const { def, cur, base } of improvements) {
      lines.push(\`- **\${def.label}**: \${cur} \${def.unit} ↑ (was \${base} \${def.unit})\`);
    }
    lines.push('');
    lines.push('> Run \`npm run quality:baseline\` to update the baseline with these improvements.');
    lines.push('');
  }

  lines.push(\`---\`);
  lines.push(\`*Generated by [boatman](https://github.com/rafaelvieiras/boatman)*\`);

  const markdown = lines.join('\\n');
  log(markdown);

  // Write to file for CI artifact / PR comment step
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports', 'quality-gate-report.md'), markdown + '\\n', 'utf8');

  return passed;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (isGenBaseline) {
    await generateBaseline();
    return;
  }

  // Load baseline
  if (!existsSync(BASELINE_PATH)) {
    warn('baseline.json not found. Run: npm run quality:baseline');
    warn('Skipping quality gate comparison.');
    process.exit(0);
  }

  let baseline;
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    baseline = raw.metrics ?? raw;
  } catch (e) {
    warn('Could not read baseline.json: ' + e.message);
    process.exit(1);
  }

  const current = await gatherMetrics();
  const result  = compareMetrics(current, baseline);

  let passed;
  if (isLocal) {
    passed = printLocal(current, result);
  } else {
    passed = printMarkdown(current, result);
  }

  if (!passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('quality-gate error:', err);
  process.exit(1);
});
`;
}

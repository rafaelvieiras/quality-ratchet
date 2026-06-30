/**
 * Coverage command helpers.
 *
 * The quality gate reads coverage from `reports/coverage/coverage-summary.json`.
 * That file is only produced when the `json-summary` reporter is enabled, which
 * is NOT a default for either vitest or jest. To avoid depending on the user's
 * vitest/jest config (and silently producing no report → a false "coverage
 * unavailable" gate failure), we force the reporter and output directory via
 * CLI flags on every coverage run.
 */

/**
 * Forced CLI flags that make the runner emit json-summary into `dir`.
 *
 * @param {string|null} testRunner - 'vitest' | 'jest' | other/null
 * @param {string}      [dir='reports/coverage']
 * @returns {string} flag string (empty when the runner is unknown)
 */
export function coverageForcedFlags(testRunner, dir = 'reports/coverage') {
  if (testRunner === 'vitest') {
    return `--coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=${dir}`;
  }
  if (testRunner === 'jest') {
    return `--coverageReporters=json-summary --coverageReporters=text --coverageDirectory=${dir}`;
  }
  return '';
}

/**
 * Builds the full coverage command, forcing the json-summary report path.
 *
 * @param {object}      opts
 * @param {string|null} opts.testRunner
 * @param {string}      [opts.runCmd='npm run']      - package-manager run prefix
 * @param {string|null} [opts.testCoverageScript]    - detected coverage npm script
 * @param {string}      [opts.dir='reports/coverage']
 * @returns {string}
 */
export function coverageCommand({ testRunner, runCmd = 'npm run', testCoverageScript = null, dir = 'reports/coverage' }) {
  const flags = coverageForcedFlags(testRunner, dir);

  // A user-defined coverage script: run it, then forward the forced flags so the
  // summary lands where the gate expects (works for vitest/jest-based scripts).
  if (testCoverageScript) {
    return flags ? `${runCmd} ${testCoverageScript} -- ${flags}` : `${runCmd} ${testCoverageScript}`;
  }

  if (testRunner === 'vitest') return `npx vitest run --coverage ${flags}`.trim();
  if (testRunner === 'jest') return `npx jest --coverage ${flags}`.trim();

  // Unknown runner: best effort. The gate will report coverage as unavailable
  // (a clear, blocking error) rather than silently passing if no summary appears.
  return `${runCmd} test`;
}

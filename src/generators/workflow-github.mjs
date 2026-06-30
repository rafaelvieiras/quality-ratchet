import { coverageCommand } from './coverage.mjs';

/**
 * Generates the GitHub Actions workflow YAML for the quality gate.
 *
 * @param {object} config
 * @param {Set<string>}  config.checks
 * @param {string}       config.packageManager
 * @param {string|null}  config.testRunner
 * @param {string|null}  config.testCoverageScript
 * @param {string|null}  config.lintScript
 * @param {string}       config.lintExtensions
 * @param {boolean}      config.hasPrComment
 * @param {string[]}     config.mainBranches
 * @returns {string}
 */
export function generateGithubWorkflow(config) {
  const {
    checks,
    packageManager: pm,
    testRunner,
    testCoverageScript,
    lintScript,
    lintExtensions,
    hasPrComment,
    mainBranches,
  } = config;

  const hasEslint      = checks.has('eslint');
  const hasCoverage    = checks.has('coverage');
  const hasDuplication = checks.has('duplication');
  const hasAudit       = checks.has('audit');
  const hasMutation    = checks.has('mutation');
  const hasComplexity  = checks.has('complexity');

  const branches = (mainBranches ?? ['main', 'master']).map((b) => `      - ${b}`).join('\n');

  // --- Package manager setup steps ---
  let pmSetupSteps = '';
  let installCmd = 'npm ci';
  let runCmd = 'npm run';

  if (pm === 'pnpm') {
    pmSetupSteps = `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest
`;
    installCmd = 'pnpm install --frozen-lockfile';
    runCmd = 'pnpm';
  } else if (pm === 'yarn') {
    installCmd = 'yarn install --frozen-lockfile';
    runCmd = 'yarn';
  } else if (pm === 'bun') {
    pmSetupSteps = `
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
`;
    installCmd = 'bun install';
    runCmd = 'bun run';
  }

  // Cache configuration
  let cacheConfig = '';
  if (pm === 'npm') {
    cacheConfig = `          cache: 'npm'`;
  } else if (pm === 'pnpm') {
    cacheConfig = `          cache: 'pnpm'`;
  } else if (pm === 'yarn') {
    cacheConfig = `          cache: 'yarn'`;
  }
  // bun handles its own caching via setup-bun

  const nodeSetupCache = cacheConfig ? `\n${cacheConfig}` : '';

  // --- Conditional steps ---
  const steps = [];

  // ESLint step
  if (hasEslint) {
    const eslintRun = lintScript
      ? `${runCmd} ${lintScript} -- --format json --output-file reports/eslint.json || true`
      : `npx eslint . --ext ${lintExtensions} --format json --output-file reports/eslint.json || true`;
    steps.push(`
      - name: Run ESLint
        run: |
          mkdir -p reports
          ${eslintRun}`);
  }

  // Coverage step — force the json-summary report into reports/coverage so the
  // gate finds it regardless of the project's vitest/jest config.
  if (hasCoverage) {
    const covScript = coverageCommand({ testRunner, runCmd, testCoverageScript });
    steps.push(`
      - name: Run tests with coverage
        run: |
          mkdir -p reports
          ${covScript}`);
  } else if (!hasEslint && !hasCoverage) {
    // No specific test/lint step; still need to run tests minimally
    steps.push(`
      - name: Run tests
        run: ${runCmd} test || true`);
  }

  // Duplication step
  if (hasDuplication) {
    steps.push(`
      - name: Check code duplication
        run: |
          mkdir -p reports
          npx jscpd . --ignore "node_modules,coverage,reports" --reporters json --output reports/ || true`);
  }

  // Audit step
  if (hasAudit) {
    const auditCmd =
      pm === 'pnpm' ? 'pnpm audit --reporter json > reports/audit.json || true' :
      pm === 'yarn' ? 'yarn npm audit --json > reports/audit.json || true' :
      'npm audit --json > reports/audit.json || true';
    steps.push(`
      - name: Run security audit
        run: |
          mkdir -p reports
          ${auditCmd}`);
  }

  // Mutation step
  if (hasMutation) {
    steps.push(`
      - name: Run mutation tests (Stryker)
        run: |
          mkdir -p reports/mutation
          npx stryker run || true`);
  }

  // Complexity step
  if (hasComplexity) {
    steps.push(`
      - name: Run complexity scan
        run: |
          mkdir -p reports
          npx eslint . --ext ${lintExtensions} --rule '{"complexity":["warn",10],"max-lines-per-function":["warn",50]}' --format json --output-file reports/complexity.json || true`);
  }

  // Quality gate step
  steps.push(`
      - name: Run quality gate
        id: quality_gate
        run: node scripts/quality-gate.mjs > reports/quality-gate-report.md 2>&1; echo "exit_code=$?" >> $GITHUB_OUTPUT
        continue-on-error: true`);

  // PR comment step
  if (hasPrComment) {
    steps.push(`
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: reports/quality-gate-report.md
          recreate: true`);
  }

  // Upload artifacts step
  steps.push(`
      - name: Upload quality reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: quality-reports
          path: reports/
          retention-days: 30`);

  // Final gate check step
  steps.push(`
      - name: Check quality gate result
        run: |
          if [ "\${{ steps.quality_gate.outputs.exit_code }}" != "0" ]; then
            echo "Quality gate failed. See reports/quality-gate-report.md for details."
            exit 1
          fi`);

  const stepsYaml = steps.join('\n');

  return `# quality-gate.yml — Generated by boatman
# https://github.com/rafaelvieiras/boatman
#
# This workflow runs the quality gate on every push to main branches and PRs.
# It compares metrics against baseline.json and blocks merges on regressions.

name: Quality Gate

on:
  push:
    branches:
${branches}
  pull_request:
    branches:
${branches}

permissions:
  contents: read
  pull-requests: write

jobs:
  quality-gate:
    name: Quality Gate
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
${pmSetupSteps}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'${nodeSetupCache}

      - name: Install dependencies
        run: ${installCmd}
${stepsYaml}
`;
}

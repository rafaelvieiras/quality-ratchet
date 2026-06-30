# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Project

**boatman** is a CLI that installs a *ratchet-style* quality gate into JavaScript/TypeScript
projects. A ratchet gate reads current metrics from tool reports, compares them against a
committed `baseline.json`, and fails CI when a blocking metric regresses — so quality can only
hold or improve, never silently slip.

The package ships an interactive installer (`npx boatman`) that detects a project's stack and
generates: a standalone `scripts/quality-gate.mjs`, CI workflows (GitHub Actions / GitLab CI),
and `package.json` scripts.

## Layout

- `bin/boatman.mjs` — CLI entry point.
- `src/installer/`
  - `index.mjs` — orchestrates detect → prompt → generate → write.
  - `detector.mjs` — detects package manager, test runner, coverage provider, ESLint, Stryker, CI, source dir.
  - `prompts.mjs` — zero-dependency readline prompts (`confirm`, `select`, `multiselect`).
- `src/generators/`
  - `gate-script.mjs` — emits the standalone quality-gate script (a big template string).
  - `coverage.mjs` — builds the coverage command, forcing the `json-summary` report into `reports/coverage`.
  - `workflow-github.mjs` / `workflow-gitlab.mjs` — emit CI pipelines.
  - `pkg-scripts.mjs` / `count-lint-script.mjs` — inject npm scripts / emit the lint-count helper.
- `scripts/quality-gate.mjs` — the gate this repo runs **on itself**. It is generated output; see the sync rule below.
- `baseline.json` — committed quality baseline for this repo.
- `test/` — Vitest tests mirroring `src/`.

## Commands

```bash
npm test                  # run the Vitest suite (vitest run)
npm run test:coverage     # tests with coverage → reports/coverage
npx eslint src            # lint source
npm run quality:gate:local  # run the ratchet gate locally (human-readable)
npm run quality:baseline    # regenerate baseline.json (runs all tools)
npm run quality:mutation    # Stryker mutation tests
```

Node **>= 24** is required. The package manager is **npm**, pinned to `npm@11.6.2`
(`packageManager` field); CI installs that exact version.

## Conventions

- **ES modules only**, `.mjs` everywhere. No TypeScript in this repo.
- **`scripts/quality-gate.mjs` must stay in sync with the generator.** Do not hand-edit it.
  Change `src/generators/gate-script.mjs`, then regenerate:

  ```bash
  node --input-type=module -e "
  import { generateGateScript } from './src/generators/gate-script.mjs';
  import { writeFileSync } from 'node:fs';
  writeFileSync('scripts/quality-gate.mjs', generateGateScript({
    checks: new Set(['eslint','coverage','duplication','audit','mutation','complexity']),
    coverageReportPath: 'reports/coverage/coverage-summary.json',
    packageManager: 'npm', testRunner: 'vitest', lintExtensions: 'js,jsx',
    hasSrcDir: true, srcDirName: 'src', projectName: 'boatman', isTypeScript: false,
  }), 'utf8');
  "
  ```

- **Gate semantics — "unavailable" ≠ 0.** When a tool report is missing or unreadable, its
  metric is `null` ("unavailable"), never `0`. In `compareMetrics`, an unavailable **blocking**
  metric fails the gate; an unavailable non-blocking metric only warns. This deliberately avoids
  two traps: a broken `npm audit` silently passing security (fail-open), and a missing
  duplication/complexity report registering as a false "improvement" that poisons the baseline.
  When adding a metric, initialise it to `null` and assign a number only inside a successful parse.
- **Coverage is config-independent.** Coverage runs always force the `json-summary` reporter and
  output directory via CLI flags (see `src/generators/coverage.mjs`), so the gate never depends on
  the user's vitest/jest config.
- **Every generator change needs a test.** `src/generators/*.mjs` and `src/installer/detector.mjs`
  are also mutation-tested by Stryker (`stryker.config.mjs`).

## Quality gate / CI

`baseline.json` blocks regressions in coverage and duplication, and requires zero critical
vulnerabilities. ESLint, mutation score, complexity, and high vulns are tracked but non-blocking.
If you intentionally change a baseline metric, run `npm run quality:baseline` and commit the result.

## Commits & releases

- **Conventional Commits** are enforced by commitlint via a Husky `commit-msg` hook
  (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`, `perf`, `revert`).
  The `pre-push` hook runs the test suite.
- Releases are automated by **semantic-release** on push to `main` (`.releaserc.json`), publishing
  to npm via OIDC trusted publishing (no `NPM_TOKEN`). CI sets `HUSKY=0` so hooks don't run there.
- If `npm ci` fails with an `@emnapi` / lock-out-of-sync error, the lock file has drifted from
  vitest's optional wasm deps. Fix by running `npm install` and committing the regenerated
  `package-lock.json`.

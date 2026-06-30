import { describe, it, expect } from 'vitest';
import { coverageForcedFlags, coverageCommand } from '../../src/generators/coverage.mjs';

describe('coverageForcedFlags', () => {
  it('forces json-summary + reportsDirectory for vitest', () => {
    const flags = coverageForcedFlags('vitest');
    expect(flags).toContain('--coverage.reporter=json-summary');
    expect(flags).toContain('--coverage.reportsDirectory=reports/coverage');
  });

  it('forces json-summary + coverageDirectory for jest', () => {
    const flags = coverageForcedFlags('jest');
    expect(flags).toContain('--coverageReporters=json-summary');
    expect(flags).toContain('--coverageDirectory=reports/coverage');
  });

  it('honours a custom output directory', () => {
    expect(coverageForcedFlags('vitest', 'out/cov')).toContain('--coverage.reportsDirectory=out/cov');
    expect(coverageForcedFlags('jest', 'out/cov')).toContain('--coverageDirectory=out/cov');
  });

  it('returns empty string for an unknown runner', () => {
    expect(coverageForcedFlags('mocha')).toBe('');
    expect(coverageForcedFlags(null)).toBe('');
  });
});

describe('coverageCommand', () => {
  it('builds a direct vitest command with forced flags', () => {
    const cmd = coverageCommand({ testRunner: 'vitest' });
    expect(cmd).toBe(
      'npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=reports/coverage'
    );
  });

  it('builds a direct jest command with forced flags', () => {
    const cmd = coverageCommand({ testRunner: 'jest' });
    expect(cmd).toContain('npx jest --coverage');
    expect(cmd).toContain('--coverageReporters=json-summary');
  });

  it('forwards forced flags to a detected coverage script via --', () => {
    const cmd = coverageCommand({ testRunner: 'vitest', runCmd: 'pnpm', testCoverageScript: 'test:cov' });
    expect(cmd).toBe(
      'pnpm test:cov -- --coverage.reporter=json-summary --coverage.reporter=text --coverage.reportsDirectory=reports/coverage'
    );
  });

  it('runs a detected script without flags when runner is unknown', () => {
    const cmd = coverageCommand({ testRunner: null, runCmd: 'yarn', testCoverageScript: 'cov' });
    expect(cmd).toBe('yarn cov');
  });

  it('falls back to the test script for an unknown runner with no coverage script', () => {
    expect(coverageCommand({ testRunner: 'mocha', runCmd: 'npm run' })).toBe('npm run test');
  });

  it('passes a custom directory through to the flags', () => {
    const cmd = coverageCommand({ testRunner: 'vitest', dir: 'reports/cov2' });
    expect(cmd).toContain('--coverage.reportsDirectory=reports/cov2');
  });
});

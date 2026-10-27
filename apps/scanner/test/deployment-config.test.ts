import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface RailwayConfig {
  build: { builder: string; dockerfilePath: string };
  deploy: Record<string, unknown>;
}

function readRailwayConfig(path: string): RailwayConfig {
  return JSON.parse(
    readFileSync(`${repositoryRoot}${path}`, 'utf8'),
  ) as RailwayConfig;
}

describe('Railway deployment configuration', () => {
  it('gates scanner deploys on ClamAV readiness', () => {
    const config = readRailwayConfig('apps/scanner/railway.json');

    expect(config.build.builder).toBe('DOCKERFILE');
    expect(existsSync(`${repositoryRoot}${config.build.dockerfilePath}`)).toBe(
      true,
    );
    expect(config.deploy.healthcheckPath).toBe('/ready');
    expect(config.deploy.numReplicas).toBe(1);
  });

  it('keeps the ClamAV daemon private and pinned', () => {
    const config = readRailwayConfig('apps/scanner/clamav/railway.json');
    const dockerfile = readFileSync(
      `${repositoryRoot}${config.build.dockerfilePath}`,
      'utf8',
    );

    expect(dockerfile).toMatch(/^FROM clamav\/clamav:\d+\.\d+\.\d+$/m);
    expect(dockerfile).not.toMatch(/^\s*EXPOSE/m);
    expect(config.deploy).not.toHaveProperty('healthcheckPath');
  });
});

describe('VPS deployment configuration', () => {
  it('publishes only the TLS proxy and pins ClamAV', () => {
    const compose = readFileSync(
      `${repositoryRoot}apps/scanner/vps/compose.yaml`,
      'utf8',
    );

    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
    expect(compose).not.toContain('3310:');
    expect(compose).not.toContain('8080:');
    expect(compose).toMatch(/image: clamav\/clamav:\d+\.\d+\.\d+$/m);
    expect(compose).toContain('${SCANNER_AUTH_TOKEN:?');
  });
});

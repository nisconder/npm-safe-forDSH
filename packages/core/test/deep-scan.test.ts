import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { NpmSafeEngine } from '../src/index.js';
import type { PackageMetadata } from '../src/registry/types.js';

const originalFetch = globalThis.fetch;

describe('NpmSafeEngine deep package scan', () => {
  let engine: NpmSafeEngine | undefined;

  afterEach(() => {
    engine?.close();
    engine = undefined;
    globalThis.fetch = originalFetch;
  });

  it('upgrades a cached metadata scan to one verified tarball scan', async () => {
    const archive = gzipSync(Buffer.alloc(1024));
    const metadata: PackageMetadata = {
      name: 'safe-lib',
      modified: '2026-01-01T00:00:00.000Z',
      'dist-tags': { latest: '3.0.0' },
      versions: {
        '3.0.0': {
          name: 'safe-lib',
          version: '3.0.0',
          dist: {
            tarball: 'https://registry.npmjs.org/safe-lib/-/safe-lib-3.0.0.tgz',
            integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
          },
        },
      },
      readme: '# safe-lib',
    };
    let metadataCalls = 0;
    let tarballCalls = 0;
    globalThis.fetch = ((url: unknown) => {
      if (String(url).endsWith('.tgz')) {
        tarballCalls++;
        return Promise.resolve(new Response(archive, { status: 200 }));
      }
      metadataCalls++;
      return Promise.resolve(new Response(JSON.stringify(metadata), { status: 200 }));
    }) as typeof fetch;

    engine = new NpmSafeEngine({ dbPath: ':memory:' });
    const shallow = await engine.checkPackage('safe-lib');
    const deep = await engine.checkPackage('safe-lib', { deep: true });
    const cachedDeep = await engine.checkPackage('safe-lib', { deep: true });

    expect(shallow.security.staticScan?.contentScan).toBeUndefined();
    expect(deep.security.staticScan?.contentScan?.status).toBe('complete');
    expect(deep.security.staticScan?.contentScan?.integrityVerified).toBe(true);
    expect(cachedDeep.security.staticScan?.contentScan?.status).toBe('complete');
    expect(metadataCalls).toBe(1);
    expect(tarballCalls).toBe(1);
  });
});

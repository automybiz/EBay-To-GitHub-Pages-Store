'use strict';

const { rmSync } = require('node:fs');
const path = require('node:path');

/**
 * Removes the build output before `astro build` runs.
 *
 * Astro does not clean its out dir between builds, so a page for a product that
 * was deleted (or renamed) in Sveltia CMS would otherwise linger in `dist/` and
 * keep being deployed. Wired up as the first half of `npm run build`.
 */
const dist = path.resolve(__dirname, '..', 'dist');

try {
  rmSync(dist, { recursive: true, force: true });
  console.log(`Cleaned ${path.relative(process.cwd(), dist)}/`);
} catch (error) {
  // On Windows the directory is locked while `astro preview` is serving it, so
  // this is best-effort — warn rather than fail the whole build.
  console.warn(
    `[clean-dist] Could not remove dist/ (${error.code}). Is \`npm run preview\` still running? ` +
      'Stale pages may survive this build — stop the preview and re-run `npm run build`.'
  );
}

// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // The storefront is fully pre-rendered (see `getStaticPaths()` in
  // src/pages/products/[id].astro), so `static` output ships plain HTML/CSS/JS.
  // The Cloudflare adapter is wired up so individual routes can be opted into
  // on-demand rendering later (e.g. a live inventory / inquiry endpoint)
  // without re-configuring the project.
  output: 'static',
  adapter: cloudflare(),
  site: 'https://europartswest.com',
});


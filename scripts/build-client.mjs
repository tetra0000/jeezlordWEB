// Bundles the TypeScript client (+ PixiJS) into client/bundle.js with esbuild.
// The server is built with `tsc` under NodeNext, which requires explicit `.js`
// extensions on relative imports. The `resolveTsExtension` plugin below lets
// esbuild resolve those same `./foo.js` specifiers to their `./foo.ts` sources
// so the shared/ folder can be imported by both builds without divergence.
import { build, context } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const resolveTsExtension = {
  name: 'resolve-ts-extension',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      if (existsSync(tsPath)) return { path: tsPath };
      return undefined; // fall through to default resolution
    });
  },
};

const options = {
  entryPoints: [resolve(root, 'client/src/main.ts')],
  outfile: resolve(root, 'client/bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  plugins: [resolveTsExtension],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-client] watching for changes…');
} else {
  await build(options);
  console.log('[build-client] done.');
}

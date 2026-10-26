import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Query the server, not a possibly stale origin/main tracking ref.
export function assertProductionSource(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (git('status', '--porcelain', '--untracked-files=all')) {
    throw Error('Production requires a clean worktree. Commit the intended changes and merge them into main first.')
  }
  const commit = git('rev-parse', 'HEAD')
  const remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0]
  if (commit !== remote) throw Error('Production source differs from remote main. Update to the merged main commit before publishing.')
  return commit
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: {
    ...process.env, SODADEX_FRAGMENTS_WRANGLER: 'wrangler.fragments-196-production.jsonc',
  } })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error(`${command} failed (${result.status ?? result.signal})`)
}

export function publishProduction(root) {
  const commit = assertProductionSource(root)
  // Never publish a dist left over from a different branch or uncommitted build.
  run('npm', ['--prefix', 'standalone/web', 'run', 'build:dex-production'], root)
  run(process.execPath, ['scripts/sodadex/check-dex-web-build.mjs'], root)
  fs.writeFileSync(path.join(root, 'standalone/web/dist/release-build.json'), JSON.stringify({
    schemaVersion: 1, commit, builtAt: new Date().toISOString(),
  }) + '\n')
  if (assertProductionSource(root) !== commit) throw Error('Source changed during the build. Restart the release from current main.')
  console.log(`Publishing SodaDEX main@${commit}`)
  run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--keep-vars',
    '--durable-objects-code-update-mode', 'immediate', '--config', 'wrangler.fragments-196-production.jsonc',
    '--message', `main@${commit}`], path.join(root, 'standalone/worker'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw Error('Legacy deploy:test targets the production site and is disabled. Use deploy:production from merged main.')
  publishProduction(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'))
}

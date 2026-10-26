import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertProductionSource, publishProduction } from './production-release.mjs'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-release-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const remote = path.join(directory, 'remote.git'), root = path.join(directory, 'work')
  fs.mkdirSync(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim()
  git('init', '--bare', remote)
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release@example.invalid')
  git('config', 'core.hooksPath', '/dev/null')
  fs.writeFileSync(path.join(root, 'source.txt'), 'initial\n')
  git('add', 'source.txt')
  git('commit', '-m', 'initial')
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'main')
  return { root, remote, git }
}

test('accepts a clean checkout of the exact published main commit', t => {
  const { root, git } = fixture(t)
  assert.equal(assertProductionSource(root), git('rev-parse', 'HEAD'))
})

test('rejects unstaged, staged and untracked source changes', t => {
  const { root, git } = fixture(t)
  fs.appendFileSync(path.join(root, 'source.txt'), 'changed\n')
  assert.throws(() => assertProductionSource(root), /clean worktree/)
  git('add', 'source.txt')
  assert.throws(() => assertProductionSource(root), /clean worktree/)
  git('reset', '--hard', 'HEAD')
  fs.writeFileSync(path.join(root, 'new-source.txt'), 'new\n')
  assert.throws(() => assertProductionSource(root), /clean worktree/)
})

test('rejects a clean local commit that has not reached main', t => {
  const { root, git } = fixture(t)
  git('commit', '--allow-empty', '-m', 'not merged')
  assert.throws(() => assertProductionSource(root), /differs from remote main/)
})

test('checks the server even when the local origin/main tracking ref is stale', t => {
  const { root, remote, git } = fixture(t)
  const old = git('rev-parse', 'HEAD')
  git('commit', '--allow-empty', '-m', 'new main')
  git('push', remote, 'HEAD:refs/heads/main')
  git('reset', '--hard', old)
  assert.equal(git('rev-parse', 'origin/main'), old)
  assert.throws(() => assertProductionSource(root), /differs from remote main/)
})

test('fails closed when remote main cannot be read', t => {
  const { root, git } = fixture(t)
  git('remote', 'set-url', 'origin', path.join(root, 'missing.git'))
  assert.throws(() => assertProductionSource(root))
})

test('the legacy test publish entry stops before build or deployment', () => {
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('./production-release.mjs', import.meta.url)), '--test'],
    { stdio: ['ignore', 'pipe', 'pipe'] }), /Legacy deploy:test targets the production site and is disabled/)
})

function pipelineFixture(t, buildAction = '') {
  const { root, git } = fixture(t)
  fs.mkdirSync(path.join(root, 'scripts/sodadex'), { recursive: true })
  fs.mkdirSync(path.join(root, 'standalone/worker/node_modules/wrangler/bin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), 'standalone/web/dist/\n')
  fs.writeFileSync(path.join(root, 'scripts/sodadex/check-dex-web-build.mjs'), '')
  fs.writeFileSync(path.join(root, 'standalone/worker/node_modules/wrangler/bin/wrangler.js'),
    "require('node:fs').writeFileSync('../web/dist/deploy-called', JSON.stringify(process.argv.slice(2)))")
  git('add', '.')
  git('commit', '-m', 'local release fixture')
  git('push', 'origin', 'main')
  const bin = path.join(path.dirname(root), 'fake-bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}\nconst fs = require('node:fs'); fs.mkdirSync('standalone/web/dist', {recursive:true}); ${buildAction}`, { mode: 0o755 })
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`
  t.after(() => { process.env.PATH = previousPath })
  return { root, git, deployed: path.join(root, 'standalone/web/dist/deploy-called') }
}

test('a failed build never invokes the uploader', t => {
  const { root, deployed } = pipelineFixture(t, 'process.exit(9)')
  assert.throws(() => publishProduction(root), /npm failed/)
  assert.equal(fs.existsSync(deployed), false)
})

test('a source change during build never invokes the uploader', t => {
  const { root, deployed } = pipelineFixture(t, "fs.appendFileSync('source.txt', 'changed during build')")
  assert.throws(() => publishProduction(root), /clean worktree/)
  assert.equal(fs.existsSync(deployed), false)
})

test('a successful local pipeline rebuilds and records the same main commit in assets and upload metadata', t => {
  const { root, git, deployed } = pipelineFixture(t)
  publishProduction(root)
  const commit = git('rev-parse', 'HEAD')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'standalone/web/dist/release-build.json'))).commit, commit)
  const args = JSON.parse(fs.readFileSync(deployed))
  assert.equal(args[args.indexOf('--message') + 1], `main@${commit}`)
  assert.equal(args[args.indexOf('--config') + 1], 'wrangler.fragments-196-production.jsonc')
})

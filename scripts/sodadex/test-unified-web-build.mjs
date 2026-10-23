import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkUnifiedWebBuild, miningMountProfile } from './check-unified-web-build.mjs'
test('unified build requires the selected mining chain and leaves root DEX intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-build-'))
  const write = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data))
  try {
    fs.mkdirSync(path.join(root, 'mining'))
    write('network-build.json', { id: '196-test', chainId: 196, mount: '/' })
    write('preferences-script.json', { hash: 'same' }); write('mining/preferences-script.json', { hash: 'same' })
    fs.writeFileSync(path.join(root, 'mining/index.html'), '<script src="/mining/assets/index.js"></script>')
    for (const chainId of [1952, 196]) {
      const profile = `${chainId}-mining-test`
      write('mining/network-build.json', { id: profile, chainId, mount: '/mining/' })
      assert.equal(checkUnifiedWebBuild(root, profile).miningChainId, chainId)
      assert.throws(() => checkUnifiedWebBuild(root, `${chainId === 196 ? 1952 : 196}-mining-test`))
    }
    write('network-build.json', { id: '196-mining-test', chainId: 196, mount: '/' })
    assert.throws(() => checkUnifiedWebBuild(root, '196-mining-test'))
  } finally { fs.rmSync(root, { recursive: true }) }
})
test('mount defaults to 1952 and rejects arbitrary profiles', () => {
  assert.equal(miningMountProfile(), '1952-mining-test')
  for (const invalid of ['', '196-test', 'production']) assert.throws(() => miningMountProfile(invalid))
})

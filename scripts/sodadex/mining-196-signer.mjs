import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Dedicated encrypted 196 test identity. Never export private material for rehearsal. */
export function persistentMining196Signer() {
  const folder = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-196-mining-authorizer')
  const publicIdentity = JSON.parse(fs.readFileSync(path.join(folder, 'public.json'), 'utf8'))
  if (publicIdentity.chainId !== 196 || publicIdentity.profileId !== '196-mining-test' ||
      !/^0x[0-9a-fA-F]{40}$/.test(publicIdentity.address)) throw new Error('Invalid 196 signing identity')
  for (const name of ['authorizer', 'password']) {
    const stat = fs.lstatSync(path.join(folder, name))
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Signing files must be private regular files')
  }
  const credentials = ['--keystore', path.join(folder, 'authorizer'), '--password-file', path.join(folder, 'password')]
  const invoke = (args) => execFileSync('cast', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const address = invoke(['wallet', 'address', ...credentials])
  if (address.toLowerCase() !== publicIdentity.address.toLowerCase()) throw new Error('196 signer keystore identity mismatch')
  const signDigest = (digest, raw) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error('Invalid signing digest')
    const result = invoke(['wallet', 'sign', ...credentials, ...(raw ? ['--no-hash'] : []), digest])
    if (!/^0x[0-9a-fA-F]{130}$/.test(result)) throw new Error('Invalid signature output')
    return result
  }
  return { address, sign: ({ hash }) => signDigest(hash, true), signMessage: ({ message }) => signDigest(message.raw, false) }
}

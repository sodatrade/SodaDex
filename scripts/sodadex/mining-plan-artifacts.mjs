import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { encodeDeployData, keccak256, stringToHex } from 'viem'

export const PRODUCT_SNAPSHOT = '1bbcc48c52d39e0038cf3c7704192deef53649b003ba245ee8f4bd197ebde569'
export const HISTORY_SNAPSHOT = '1cb8e9c16d9425b357aea5eaa33be697ccbd8b3839126b963fa7cd97f25552b1'
export const fileSha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hex = (value) => value.startsWith('0x') ? value : `0x${value}`

export function verifyCompiledSources(artifact, relativeRoot) {
  const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata
  if (!metadata?.sources || !metadata.settings || !metadata.compiler?.version) throw new Error('Missing compiler provenance')
  const sources = {}
  for (const [source, identity] of Object.entries(metadata.sources)) {
    const file = path.isAbsolute(source) ? source : path.join(relativeRoot, source)
    if (!fs.existsSync(file) || keccak256(stringToHex(fs.readFileSync(file, 'utf8'))) !== identity.keccak256) throw new Error(`Compiled input changed: ${source}`)
    sources[source] = identity.keccak256
  }
  return { compiler: metadata.compiler.version, settings: metadata.settings, sourceKeccak256: sources }
}

/** Resolve by pinned compilation target, since Foundry output basenames collide. */
export function sourceArtifact(root, name) {
  const directory = path.join(root, '.analysis/mining-1952/rewards-out')
  const matches = []
  const walk = (folder) => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.name === `${name}.json`) {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'))
        const metadata = typeof value.metadata === 'string' ? JSON.parse(value.metadata) : value.metadata
        const targets = Object.entries(metadata?.settings?.compilationTarget ?? {})
        if (targets.length !== 1 || targets[0][1] !== name) continue
        const target = targets[0][0]
        const history = target.includes(`/fabx-history-v2/${HISTORY_SNAPSHOT}/`)
        const proxyDependency = name === 'ERC1967Proxy' && target === path.join(root, '.analysis/mining-1952/fabx-snapshot/lib/openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol')
        if (history || proxyDependency) {
          verifyCompiledSources(value, root)
          matches.push({ file, value, history })
        }
      }
    }
  }
  walk(directory)
  const candidates = matches.some((a) => a.history) ? matches.filter((a) => a.history) : matches
  const deploymentIdentity = (a) => JSON.stringify({ abi: a.value.abi, bytecode: a.value.bytecode.object,
    links: a.value.bytecode.linkReferences, runtime: a.value.deployedBytecode.object,
    runtimeLinks: a.value.deployedBytecode.linkReferences, immutables: a.value.deployedBytecode.immutableReferences })
  if (candidates.length === 0 || new Set(candidates.map(deploymentIdentity)).size !== 1) throw new Error(`Missing or conflicting pinned history artifact: ${name}`)
  // Forge may keep duplicate output paths after a dependency graph changes; bytes must agree.
  return candidates.sort((a, b) => a.file.localeCompare(b.file))[0]
}

export function productArtifact(root, name) {
  const directory = path.join(root, '.analysis/mining-1952/product-artifacts', PRODUCT_SNAPSHOT)
  const hashes = Object.fromEntries(fs.readdirSync(directory).sort().map((folder) => {
    const contract = folder.slice(0, -4), file = path.join(directory, folder, `${contract}.json`)
    return [contract, fileSha(fs.readFileSync(file))]
  }))
  // Match Python json.dumps(..., sort_keys=True) used by the immutable snapshot producer.
  const serialised = `{${Object.entries(hashes).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`
  if (fileSha(serialised) !== PRODUCT_SNAPSHOT) throw new Error('Product artifact snapshot has changed')
  const file = path.join(directory, `${name}.sol`, `${name}.json`)
  // These five frozen dependencies were compiled in their own pinned source trees.
  const external = {
    PoolManager: '.analysis/upstream/universal-router-2.1.2/lib/v4-periphery/lib/v4-core',
    Permit2: '.analysis/upstream/permit2', PositionDescriptor: '.analysis/branding-repro/v4',
    PositionManager: '.analysis/branding-repro/v4', V4Quoter: '.analysis/upstream/universal-router-2.1.2/lib/v4-periphery',
  }
  return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')),
    sourceRoot: external[name] ? path.join(root, external[name]) : path.join(os.homedir(), 'XTruthWorkspace/contract') }
}

export function linkCreation(artifact, libraries) {
  let code = hex(artifact.bytecode.object).slice(2)
  const sites = []
  for (const [source, entries] of Object.entries(artifact.bytecode.linkReferences ?? {})) for (const [name, refs] of Object.entries(entries)) {
    if (!libraries[name]) throw new Error(`Unbound library: ${source}:${name}`)
    for (const { start, length } of refs) sites.push({ name, start, length })
  }
  for (const [name, starts] of Object.entries(artifact.sodadexLibraries ?? {})) for (const start of starts) {
    if (!sites.some((s) => s.start === start)) sites.push({ name, start, length: 20, normalised: true })
  }
  sites.sort((a, b) => a.start - b.start)
  let end = 0
  for (const site of sites) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(libraries[site.name] ?? '') || site.length !== 20 || site.start < end || (site.start + 20) * 2 > code.length)
      throw new Error('Invalid or overlapping library binding')
    const existing = code.slice(site.start * 2, (site.start + 20) * 2)
    if (site.normalised && existing !== '0'.repeat(40)) throw new Error('Manager library placeholder was changed')
    code = code.slice(0, site.start * 2) + libraries[site.name].slice(2) + code.slice((site.start + 20) * 2)
    end = site.start + 20
  }
  if (!/^[0-9a-fA-F]+$/.test(code) || code.length % 2) throw new Error('Unresolved contract creation code')
  return `0x${code}`
}
export function creation(artifact, libraries = {}, args = []) {
  return encodeDeployData({ abi: artifact.abi, bytecode: linkCreation(artifact, libraries), args })
}

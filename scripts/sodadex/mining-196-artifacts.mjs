import fs from 'node:fs'
import { fileSha, verifyCompiledSources } from './mining-plan-artifacts.mjs'
export function load196Artifacts(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.chainId !== 196 || !manifest.sourceRoot || !manifest.artifacts) throw new Error('Explicit 196 compilation manifest required')
  const proof = {}, cache = new Map()
  const resolve = (_root, name) => {
    if (cache.has(name)) return cache.get(name)
    const record = manifest.artifacts[name]
    if (!record?.file || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error(`Missing pinned 196 artifact ${name}`)
    const bytes = fs.readFileSync(record.file)
    if (fileSha(bytes) !== record.sha256) throw new Error(`196 artifact changed: ${name}`)
    const value = JSON.parse(bytes), sourceRoot = record.sourceRoot ?? manifest.sourceRoot
    if (name === 'V2Graduation' && (value.methodIdentifiers?.['inject(mapping(address => address) storage,address,address,uint128,uint128,V2Graduation.Venue)'] !== 'd51faceb' ||
        value.methodIdentifiers?.['validateConfiguration(address,address,address,address,address)'] !== '71155bec')) throw new Error('Test V2 library selectors differ from the Manager ABI')
    const source = verifyCompiledSources(value, sourceRoot)
    proof[name] = { file: record.file, sha256: record.sha256, compiler: source.compiler, sourceKeccak256: source.sourceKeccak256 }
    const result = { file: record.file, value, sourceRoot }; cache.set(name, result); return result
  }
  for (const name of Object.keys(manifest.artifacts)) resolve(manifest.sourceRoot, name)
  return { resolve, proof }
}

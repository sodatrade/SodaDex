import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { concatHex, encodeFunctionData, getCreate2Address, keccak256, parseAbi, padHex, stringToHex, toHex } from 'viem'
import { creation, fileSha, productArtifact, sourceArtifact, verifyCompiledSources } from './mining-plan-artifacts.mjs'
import { verifyMiningPermit2 } from './mining-permit2-proof.mjs'

export async function prepareMiningStack(plan, root, signer) {
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/dependencies.json')))
  if (saved.chainId !== 1952 || saved.owner.toLowerCase() !== plan.owner.toLowerCase()) throw new Error('Base deployment identity mismatch')
  const recorded = Object.fromEntries(saved.dependencies.filter((d) => d.address).map((d) => [d.role, d.address]))
  const base = { ...recorded, nftFactory: recorded.factory, netlist: recorded.PodNetlist }
  for (const dependency of saved.dependencies.filter((d) => d.sourceVerified)) {
    const code = await plan.rpc('eth_getCode', [dependency.address, 'latest'])
    if (createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex') !== dependency.expectedRuntimeSha256) throw new Error(`Base runtime changed: ${dependency.role}`)
  }
  const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
  for (const [proxy, implementation] of [[base.mining, base.miningImplementation], [base.nftFactory, base.factoryImplementation], [base.circuitMarket, base.marketImplementation]]) {
    const word = await plan.rpc('eth_getStorageAt', [proxy, implementationSlot, 'latest'])
    if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(word) || word.slice(-40).toLowerCase() !== implementation.slice(2).toLowerCase()) throw new Error('Base UUPS implementation drifted')
  }
  for (const [getter, beaconRole, implementationRole] of [['circuitBeacon', 'circuitBeacon', 'circuitsImplementation'], ['transistorBeacon', 'transistorBeacon', 'transistorsImplementation']]) {
    const beacon = await plan.call(base.nftFactory, `function ${getter}() view returns(address)`)
    const implementation = await plan.call(beacon, 'function implementation() view returns(address)')
    if (beacon.toLowerCase() !== base[beaconRole].toLowerCase() || implementation.toLowerCase() !== base[implementationRole].toLowerCase()) throw new Error('Base NFT beacon implementation drifted')
  }
  const sourceOwner = await plan.call(base.mining, 'function owner() view returns(address)')
  if (sourceOwner.toLowerCase() !== plan.owner.toLowerCase() || await plan.call(base.mining, 'function minerCount() view returns(uint256)') !== 0n ||
    await plan.call(base.mining, 'function taskCount() view returns(uint32)') !== 0) throw new Error('Source migration requires the verified empty 1952 state')
  const libraries = { PodNetlist: base.netlist }, product = {}, v2Root = path.join(root, '.analysis/mining-1952/v2-artifacts')
  const deploySource = async (name) => plan.deploy(name, creation(sourceArtifact(root, name).value, libraries))
  libraries.FabxRewardHistory = await deploySource('FabxRewardHistory')
  libraries.DewebRewardAccounting = await deploySource('DewebRewardAccounting')
  libraries.DewebMiningExtension = await deploySource('DewebMiningExtension')
  const miningImplementation = await deploySource('PodMining')
  await plan.write('Upgrade empty 1952 mining history', base.mining, 'function upgradeToAndCall(address,bytes) payable', [miningImplementation, '0x'])
  if (await plan.call(base.mining, 'function rewardHistoryVersion() pure returns(uint256)') !== 2n ||
    (await plan.call(base.mining, 'function owner() view returns(address)')).toLowerCase() !== sourceOwner.toLowerCase()) throw new Error('History upgrade postcondition failed')
  const deploy = async (name, args = []) => {
    const artifact = productArtifact(root, name)
    verifyCompiledSources(artifact.value, artifact.sourceRoot)
    return plan.deploy(name, creation(artifact.value, product, args))
  }
  const v2Manifest = JSON.parse(fs.readFileSync(path.join(v2Root, 'sources.json')))
  const deployV2 = async (name, args = []) => {
    const bytes = fs.readFileSync(path.join(v2Root, `${name}.json`))
    if (fileSha(bytes) !== v2Manifest.artifacts[name]?.artifactSha256) throw new Error('V2 artifact provenance mismatch')
    return plan.deploy(name, creation(JSON.parse(bytes), {}, args))
  }
  const wrapped = await deployV2('WETH9'), v2Factory = await deployV2('UniswapV2Factory', [plan.owner])
  const router = await deployV2('UniswapV2Router02', [v2Factory, wrapped])
  const pm = await deploy('PoolManager', [plan.owner]), permit = base.permit2
  if (!permit) throw new Error('Permit2 identity is unavailable')
  plan.permit2Proof = await verifyMiningPermit2(plan, root, permit)
  const descriptor = await deploy('PositionDescriptor', [pm, wrapped, padHex(stringToHex('OKB'), { size: 32, dir: 'right' })])
  const positionManager = await deploy('PositionManager', [pm, permit, 300000n, descriptor, wrapped])
  const quoter = await deploy('V4Quoter', [pm]), registry = await deploy('VaultRegistry', [plan.owner]), launchFactory = await deploy('IgnixLaunchFactory')
  for (const name of ['CurveTrading', 'LaunchLogic', 'V2Graduation']) product[name] = await deploy(name)
  const managerImplementation = await deploy('IgnixManager')
  const initAbi = parseAbi(['function initialize(address,address,address,address,address,address,uint24,int24,address)'])
  const init = encodeFunctionData({ abi: initAbi, functionName: 'initialize', args: [plan.owner, pm, positionManager, permit, registry, launchFactory, 0, 1, signer] })
  const manager = await plan.deploy('ManagerProxy', creation(sourceArtifact(root, 'ERC1967Proxy').value, {}, [managerImplementation, init]))
  const lpLocker = await deploy('IgnixLpLocker', [manager, pm, positionManager]), v2Locker = await deploy('IgnixV2Locker', [manager])
  const helper = await deploy('IgnixLiquidityHelper', [manager, v2Factory, router, wrapped]), protectionRouter = await deploy('IgnixV4Router', [manager, pm, permit])
  const singleton = '0x4e59b44847b379578588920ca78fbf26c0b4956c'
  const singletonCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3'
  if (await plan.rpc('eth_getCode', [singleton, 'latest']) !== singletonCode) throw new Error('Verified CREATE2 singleton is unavailable')
  const initcode = creation(productArtifact(root, 'IgnixPoolGuard').value, {}, [pm, manager, protectionRouter, quoter])
  let salt, hook
  for (let i = 0n; ; i++) {
    salt = toHex(i, { size: 32 }); hook = getCreate2Address({ from: singleton, salt, bytecodeHash: keccak256(initcode) })
    if ((BigInt(hook) & 0x3fffn) === 0x2080n) break
  }
  await plan.send('Deploy fixed CREATE2 pool guard', singleton, concatHex([salt, initcode]))
  if (await plan.rpc('eth_getCode', [hook, 'latest']) === '0x') throw new Error('Pool guard was not deployed')
  await plan.write('Configure Manager V4 dependencies', manager, 'function configure(address,address)', [hook, lpLocker])
  await plan.write('Configure Manager V2 dependencies', manager, 'function configure2(address,address,address,address,address)', [v2Factory, router, v2Locker, wrapped, helper])
  const miningFactory = await deploy('MiningProjectFactory', [base.fab, manager, plan.owner, signer, plan.owner, 5000n * 10n ** 8n])
  const farm = await deploy('FabMiningFarm', [base.fab, miningFactory, base.mining, base.circuits, base.nftFactory, 4, base.circuitMarket, router, signer])
  await plan.write('Bind shared mining farm once', miningFactory, 'function bindFarm(address)', [farm])
  await plan.write('Register isolated test template', registry, 'function setTemplate(uint16,address)', [0, miningFactory])
  const fragmentVault = await deploy('FabFragmentVault', [base.fab, base.mining, base.circuits, base.nftFactory, 4])
  const fragmentPool = await deploy('FabFragmentPool', [fragmentVault, plan.owner])
  const minerBuyer = await deploy('FabMinerTestBuyer', [base.circuitMarket, fragmentVault])
  const result = { ...base, miningImplementation, signer, wrapped, v2Factory, router, pm, permit, positionManager, registry, launchFactory,
    manager, managerImplementation, lpLocker, v2Locker, helper, protectionRouter, hook, miningFactory, farm, fragmentVault, fragmentPool, minerBuyer }
  plan.stack = result
  return result
}

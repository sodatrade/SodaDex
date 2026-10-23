import fs from 'node:fs'
import path from 'node:path'
import { concatHex, decodeEventLog, encodeFunctionData, getContractAddress, getCreate2Address, keccak256, parseAbi, toHex } from 'viem'
import { creation, fileSha, sourceArtifact, verifyCompiledSources } from './mining-plan-artifacts.mjs'

export async function prepare196Stack(plan, root, signer, resolve, reused) {
  const libraries = {}, product = {}, base = {}
  const deploySource = async (name, args = []) => plan.deploy(name, creation(sourceArtifact(root, name).value, libraries, args))
  for (const name of ['PodNetlist', 'FabxRewardHistory', 'DewebRewardAccounting', 'DewebMiningExtension']) libraries[name] = await deploySource(name)
  base.netlist = libraries.PodNetlist
  base.transistorsImplementation = await deploySource('Transistors')
  base.circuitsImplementation = await deploySource('Circuits', [plan.owner])
  base.factoryImplementation = await deploySource('CircuitFactory')
  const initFactory = encodeFunctionData({ abi: sourceArtifact(root, 'CircuitFactory').value.abi, functionName: 'initialize', args: [plan.owner, base.transistorsImplementation, base.circuitsImplementation, plan.owner, 0n, 0n] })
  base.nftFactory = await plan.deploy('FactoryProxy', creation(sourceArtifact(root, 'ERC1967Proxy').value, {}, [base.factoryImplementation, initFactory]))
  base.miningImplementation = await deploySource('PodMining')
  const nonce = BigInt(await plan.rpc('eth_getTransactionCount', [plan.owner, 'latest']))
  const predictedMining = getContractAddress({ from: plan.owner, nonce: nonce + 1n })
  base.fab = await deploySource('PodToken', ['SodaDEX TEST FAB', 'TEST-FAB', predictedMining, plan.owner])
  const initMining = encodeFunctionData({ abi: sourceArtifact(root, 'PodMining').value.abi, functionName: 'initialize', args: [plan.owner, base.fab, 0n] })
  base.mining = await plan.deploy('MiningProxy', creation(sourceArtifact(root, 'ERC1967Proxy').value, {}, [base.miningImplementation, initMining]))
  if (base.mining.toLowerCase() !== predictedMining.toLowerCase() || await plan.call(base.mining, 'function rewardHistoryVersion() pure returns(uint256)') !== 2n) throw new Error('New history-V2 mining binding failed')
  const factoryAbi = sourceArtifact(root, 'CircuitFactory').value.abi
  const cpu = await plan.send('Create independent TEST CPU', base.nftFactory, encodeFunctionData({ abi: factoryAbi, functionName: 'createCPU', args: ['SodaDEX TEST FAB Miner', 'TEST-FAB-NFT', 'X Layer 196 test assets only', 100000n, 0n] }))
  for (const log of cpu.logs.filter((l) => l.address.toLowerCase() === base.nftFactory.toLowerCase())) {
    try { const e = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics }); if (e.eventName === 'CPUCreated') { base.circuits = e.args.circuits; base.transistors = e.args.transistors } } catch {}
  }
  if (!base.circuits || !base.transistors) throw new Error('CPU creation event missing')
  await plan.write('Set minimum TEST tapeout fee', base.circuits, 'function setTapeoutFee(uint256)', [0n])
  await plan.write('Register TEST processor', base.mining, 'function setProcessor(address,uint256)', [base.circuits, 6n])
  base.marketImplementation = await deploySource('CircuitMarket')
  const initMarket = encodeFunctionData({ abi: sourceArtifact(root, 'CircuitMarket').value.abi, functionName: 'initialize', args: [plan.owner, base.nftFactory, plan.owner, 0n] })
  base.circuitMarket = await plan.deploy('MarketProxy', creation(sourceArtifact(root, 'ERC1967Proxy').value, {}, [base.marketImplementation, initMarket]))
  base.lens = await deploySource('PodLens', [base.mining])
  const deploy = async (name, args = []) => { const a = resolve(root, name); verifyCompiledSources(a.value, a.sourceRoot); return plan.deploy(name, creation(a.value, product, args)) }
  const v2Root = path.join(root, '.analysis/mining-1952/v2-artifacts'), manifest = JSON.parse(fs.readFileSync(path.join(v2Root, 'sources.json')))
  const deployV2 = async (name, args) => { const bytes = fs.readFileSync(path.join(v2Root, `${name}.json`)); if (fileSha(bytes) !== manifest.artifacts[name]?.artifactSha256) throw new Error('V2 artifact changed'); return plan.deploy(name, creation(JSON.parse(bytes), {}, args)) }
  const { wrapped, pm, permit, positionManager, quoter } = reused
  const v2Factory = await deployV2('UniswapV2Factory', [plan.owner]), router = await deployV2('UniswapV2Router02', [v2Factory, wrapped])
  const registry = await deploy('VaultRegistry', [plan.owner]), launchFactory = await deploy('IgnixLaunchFactory')
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
  const initcode = creation(resolve(root, 'IgnixPoolGuard').value, {}, [pm, manager, protectionRouter, quoter])
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
  const result = { ...base, signer, wrapped, v2Factory, router, pm, permit, positionManager, registry, launchFactory,
    manager, managerImplementation, lpLocker, v2Locker, helper, protectionRouter, hook, miningFactory, farm, fragmentVault, fragmentPool, minerBuyer }
  plan.stack = result
  return result
}

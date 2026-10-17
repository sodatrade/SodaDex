# 两套矿机业务 · X Layer 1952

状态：基础依赖已在 1952 部署并核验；募资分红、碎片化交易和独立前端已完成本地真实合约验收，新增公开部署尚未执行。
本目录与 `xlayer-test/` 的 196 测试组独立；实际地址和回执见下方部署记录。

## 本轮就绪状态（2026-10-17）

- 当前新增公开交易为 0；`products.json` 保持 `pending`。本地 Anvil 的地址和交易哈希不能当成公开 1952 部署。
- 合约全回归 959 通过、0 失败、3 项可选用例跳过；真实 FABX／Manager 集成 15 通过。
- 覆盖签名发行、曲线买卖、税款投入、真实市场采购、毕业前分红、V2 毕业、保护期内外双向交易、项目 LP 增减和锁定 LP 收费。
- 碎片业务覆盖真实矿机背书、双向交易、LP 增减、NFT 存赎、失格共同损失、晋升、暂停与历史分红；原子零售购买在付款后再次检查矿机资格。
- 前端按钱包预览、逐笔确认、保留哈希；未知广播结果不直接重发。普通 LP 交易费与矿机 FAB 分红分别说明。
- FAB 供应上限按各时段原应得额同比例缩减；独立烧币凭证仍按各自 7 天时间到期。无人合格持有期间的收益隔离保留，生产归属待产品决定。
- Permit2 已完成含 immutable 的完整运行码和签名域核验，见 [核验记录](2026-10-17-permit2-runtime.json)。旧基础批次的 readiness 文件保留其当时观测，不作为本轮最新结论。
- 当前前端操作已登记的测试项目；新项目发行和自动矿机采购的线上签名服务尚未发布。BEM 不属于本轮验收。
- 冻结执行源码后的完整本地分叉预演共 102 笔，全部成功；模拟实际执行费约 0.00212139 测试 OKB，含 gas 余量的上限约 0.00239987。
  用户已将本阶段 gas 上限批准为 0.0025 测试 OKB，本金仍最多 0.001 测试 OKB 与 10,000 TEST-FAB。
  公开执行前逐笔刷新费用，超出本阶段上限立即停止。
- 新增真实 FABX／Farm／Holder／项目代币回归：供应完全耗尽后跨过 7 天，零实收仍能推进结算、清除到期凭证、转账并领取此前已记账收益。
- 用户已批准将本轮增量提交、推送至两个现有需求分支并更新 Draft PR，再部署 1952 及独立测试前端；均不合并。生产及 196 不变。
- 官方测试 RPC 间歇返回旧 `pending`。执行器对只读 pending 请求在同一批次核验链号、区块、owner nonce 与目标代码，最多重试 6 次；真实未确认交易、持续不一致或模拟失败均停止。广播不自动重试，哈希先保存再提交。

## 责任与分支

- SodaDEX 集成：`/Users/LevyHoo/Documents/SodaDex`，`codex/feat/mining-products-1952`。
  基点 `7506ce36138dfb6262ef11d1e3ca4828fec5ede3`；明确依赖尚未合并的 SodaDEX PR #1。
  原 `codex/feat/sodadex-bootstrap` 分支及 PR 不在本阶段改写。
- 新矿机收益合约：canonical `okasplaunchpad/contract` 的本地 checkout
  `/Users/LevyHoo/XTruthWorkspace/contract`，同名需求分支，基于 `develop@1426a613b6386be26c6ac91e14612ec581ff9c4c`。
  `src/mining/` 与旧 `src/miner/` 固定价发射业务分别维护。
- FABX 源合约：`MinerWorkspace/pod-contract@4caabe00d0e4d198aac4576bc0ad27c8cca5ce54`。
  仅只读检查；本地预演从提交提取快照，保留原工作树及已有修改。

owner locator 为当前 SodaDEX 矿机需求会话 `/root`。本批已按用户授权提交、推送并创建
[SodaDEX Draft PR #2](https://github.com/sodatrade/SodaDex/pull/2) 和
[IGNIX Draft PR #3](https://github.com/okasplaunchpad/contract/pull/3)，均未合并。生产与 196 不变。

## 已核实的接口与资产

2026-10-17 核实 `api.fabx.tech/v1/{status,pod/mainnet,pod/state}` 和公开链上 getter：

| 组件 | 196 生产参考地址，仅用于身份和接口核实 |
|---|---|
| PodMining | `0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265` |
| FAB | `0x72F349B1Eee7833B26f8C81a8410775A4e231ed2` |
| PodLens | `0xE566F9F6F20C19e2AfbD0BB9028A2517d55Bf5F5` |
| CircuitMarket | `0x0BC37F95aE57bb20e995D425d46D6df9f22Bd7a1` |
| FAB-Genisis NFT | `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6` |

上述身份 getter 核实不等于所有运行码均已重编译匹配。

- `minerKey` / `getMiner` 查询矿机；已验证普通机器为 active、`taskId != 0`、非最优，无设计溢价。
  采购准入还需处理工厂登记、Boost/DeWEB 和挑战失效，不能单凭 NFT 名称或 API 状态。
- `claim` 可由任何人触发，FAB 发给 NFT 当前持有人。NFT 转移、市场购买均不自动替旧主持有人领取。
  碎片化存入／赎回必须在转移前结算；市场购入则按实际取得的 NFT 和收益余额记账。
- `CircuitMarket.buy(id, expectedPrice)` 只收原生 OKB，要求 `msg.value == price`。
  PRD 的 FAB 采购预算需要有价格约束的 FAB→OKB 兑换及固定市场购买适配。
- FAB 为 8 位；生产公开常量 `PREMINE=105000000000000`、`MAX_SUPPLY=2100000000000000`，
  即 5% 初始发行，非 PRD 写的“无预挖”。
- 1952 的 owner 在区块 43754029 观测余额为 0.2 测试 OKB；Permit2 有代码且签名域匹配 1952，但源码重编译核验尚未完成。
  该预部署观测不作为本批新合约的部署证明；最新基础依赖证据见下方，未部署的 DEX 组件仍使用 null。

## 文档问题与决定状态

| 项目 | 分类 | 当前处置／决定人 |
|---|---|---|
| BEM 在已核实的 FABX 中是 Boost 质押资产，未找到独立产 BEM 矿机 | accepted behavior（首轮范围） | 用户确认先用 FAB 跑通两套产品，BEM 分支随后补齐 |
| “毕业即挖矿”与活跃 NFT 购入后持续产出不一致 | accepted behavior（已定案） | 用户确认购入后按实际持仓累计分红，毕业后开放烧币加权 |
| FAB“无预挖”与实际 5% 初始发行不符 | confirmed defect（文档事实） | 按真实合约口径记录；不修改原始 PRD 文件 |
| 碎片化 0.5% 及 30/70 的最小单位尾数 | accepted behavior（已定案） | 用户确认总费下取整、平台分成下取整、分成余数归 LP，无额外 AMM 费，不另设最低交易额 |
| 矿机“生命周期阶段”缺少对应单机字段 | specification ambiguity | FABX 当前为全局发行减半；先核对同型号及全局纪元，不能虚构 NFT 寿命 |
| Mining 毕业后 A 币转账税与现有 V3/V4 路径不兼容 | change request（集成缺项） | 用户确认新增 Mining V2 LP 费 0.3%，另计 PRD 项目币买卖税；碎片化另走唯一 0.5% 费率路径，现有 V3/V4 保留 |
| 产出平台费全局调整对存量金库的生效规则 | specification ambiguity | 尚未实现 setter，待上下限、存量效力和生效时点明确 |

## 可复现的验证入口

仅查询链号、区块、余额与代码，不签名或广播；返回码 2 表示清单有未就绪项目：

```sh
python3 scripts/sodadex/check-mining-testnet.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sodadex -p test_mining_testnet.py
```

`configuredDependenciesReady` 仅表示清单中条目及 owner 余额通过检查，不等于全套依赖、业务或部署批准。
`sourceVerified` 记录先前的人工构建核验，该脚本本身不重编译运行码。历史证据不得覆盖。

用固定 FABX 提交在 Foundry 内存中部署真源码进行预演：

```sh
python3 scripts/sodadex/rehearse-mining-dependencies.py \
  --fabx-source /Users/LevyHoo/Documents/ChatGPT/MinerWorkspace/pod-contract
```

该预演使用本地虚拟余额和时间，虽设置 chainId=1952，仍不是 1952 实际部署。
继承的 MockBem 仅为源项目 Boost fixture，不是 BEM 挖矿业务验收。测试托管辅助合约也不是产品金库。

当前 8 项内存测试还涵盖领取暂停时推进未领收益、发行上限裁剪，以及基础部署入口在
196 或错误 owner 下拒绝创建任何合约。未领取收益不等于已到账可领取，最终收益账本须区分这两个状态。

基础依赖的官方 1952 RPC 预演命令不提供签名／广播参数，不读取 keystore 或 dotenv：

```sh
python3 scripts/sodadex/prepare-mining-dependencies.py \
  --fabx-source /Users/LevyHoo/Documents/ChatGPT/MinerWorkspace/pod-contract \
  --output /tmp/sodadex-1952-new-simulation
```

该命令共用固定提交源码校验和受限环境。Solidity 入口硬性核对 1952 与公开 owner，
创建带 TEST 名称的 FAB／NFT、挖矿、市场和 Lens 依赖，CPU／铸造／流片／市场设置费为零。
末尾逐项核验接线和费率；这里只模拟部署，还没有创建实际测试矿机或运行两套业务。
2026-10-17 最新预演 16 笔候选交易通过，含裕量估算约 0.00135461 测试 OKB。
输出 `plan.json` 中的地址明确标注为未部署，不填入 `dependencies.json`，也不发给同事当实际地址。

下一批为真实矿场收益和受约束采购、碎片化 NFT／份额／收益记账，然后接发行和页面。
后续矿机业务部署、兑换及跨模块对账须分别保存回执；生产组保持独立，尚不部署。

## 1952 实际基础部署 · 2026-10-17

16 笔交易全部成功，覆盖 17 个组件（含库、实现、代理和 beacon）。实际 gas 共 **0.000513486725674335 测试 OKB**，
低于本阶段 **0.002 测试 OKB** 上限；附加 L1／operator 费用为零。Owner nonce 从 0 到 16。
已逐字节核对 17 份运行码及库／immutable 地址，回读 59 个 getter 与 10 个代理槽，
包括 TEST 名称、owner／factory／minter、零设置费、processor=6、boost=0 和实际部署时间。

| 组件 | X Layer 1952 实际地址 |
| --- | --- |
| 测试 FAB | `0x7a188d4c46c9fe045a5875fecaef9bf00e4521ff` |
| NFT 工厂 | `0xad6e6bd6feecd3ef77ead8779ffcf5d52521abca` |
| 挖矿合约 | `0x7991d4a8493b9709365cd079dffc75e790007874` |
| 晶体管 NFT | `0xd1bb400c5b0d1c65a0025b110cb7e942f168ae98` |
| 矿机 NFT | `0x5ae194d008292ef9d02933a599070c9661be040c` |
| 矿机市场 | `0xa619c4cf1264bc071a3827edd0b64252842471be` |
| 批量读取 Lens | `0xcdb3efbdfe3858aba4d4d5c83e6bffa47848945e` |

- [完整组件与费用摘要](2026-10-17-base-deployment.json)
- [16 笔成功回执](2026-10-17-base-receipts.json)
- [运行码、getter 与代理槽核验](2026-10-17-base-runtime.json)
- [依赖清单](dependencies.json)：只填写已部署且已核验组件，未部署项仍为空。
- [部署后就绪检查](2026-10-17-post-deployment-readiness.json)：17 项运行码已核验；5 项未部署，Permit2 等待源码验证。

本批只建立 FAB／NFT／挖矿／市场基础环境；尚未注册任务或铸造实际测试矿机，
也未部署、接通真实募资金库、碎片化交易池和持有人收益账本。
`configuredDependenciesReady` 仍应为 false：WOKB、DEX 组件尚未部署，Permit2 源码验证仍未完成。
公开 196 测试站没有替换，1952 页面也没有发布。不能把本批依赖部署当作两套业务验收完成。

下一阶段收益接口约束：固定 FABX 源码只有全局 `totalMined`，没有按
矿机 key／收款人的累计实际实付 getter。第三方代领或挑战也能让托管地址收到 FAB，
仅按主动 claim 的余额差会遗漏收益，仅按余额又会计入捐赠；接近总供应上限时不能
用名义 pending 替代实付。下一批先补齐可核验的收益来源，再接具体矿场和项目分红接收器。
当前 PodMining 实现运行码为 24,504 字节，后续增加接口还须通过实现体大小验证，不能仅验证逻辑。
当前基础组仍是上述原提交源码，未升级任何生产或测试实现；后续测试源码扩展及升级须另存版本和回执。

## 最低测试参数与生产费用决定

[收费与收入分配清单](../fees/checklist.html) 面向产品逐项确认。
[test-1952.json](../fees/test-1952.json) 使用基础设置费 0、Mining 双侧税各 1%、
协议分税款 1%、Creator 0，保留已确认的 Mining V2 0.3% 与碎片化 0.5%／平台 30%／LP 70%。
当前源码不支持把这些业务固定费全部改成 0；未来产出服务费、界面费等使用零费测试目标。
这份配置不代表新业务已部署，也不改变已有 196 池；未来 1952 普通 V3 零费档尚须启用及另建池。

基础部署预演先核对该测试配置，再查询 RPC 或启动 Forge，成功证据记录配置摘要。
每个后续 CPU 仍须显式设零流片费并核验，不能以首组零费推断工厂默认值已改变。

```sh
python3 scripts/sodadex/check-fee-policy.py --stage test
python3 scripts/sodadex/check-fee-policy.py --stage production
python3 scripts/sodadex/render-fee-checklist.py
```

[production-pending.json](../fees/production-pending.json) 的费用、收款人和运营规则全部留空，
生产预检应拒绝未定稿配置。产品决定须记录负责人、依据及完整配置摘要；参数或收款地址变化后
原摘要失效。该检查不验证审批者身份，也不代替部署授权、合约验收或未来生产部署入口的接入。
没有把 PRD 的产出 5%／服务费 10% 自动批准用于生产。

## 上一基础批次的实现与验证记录（保留历史口径）

`contract/src/mining/` 已实现费用数学、`MiningRevenueVault` 与抽象的 `MiningFarmFunding`。
资金从固定税收金库进入矿场前先执行旧份额 checkpoint，再以实际净增 FAB 记永久出资；
后者没有真实产出结算、采购或分红实现，不能直接部署为完整矿场。

本批新模块 34 项测试通过，含 3 项有攻击者 handler 的不变量。全合约离线回归
761 通过、3 项因缺少 Fork 配置失败、110 跳过；随后提供公开 RPC 单独运行这三组 Fork，
27 项全部通过。其余未配置 Fork 不计通过。完整验证摘要见 `2026-10-17-validation.json`。

`standalone/network-profile.ts` 为前端与 Worker 共用网络配置，默认保留 196。
1952 以独立准备页读取链状态和钱包测试余额，阻止原有 196 资产、DEX 合约模拟、行情及订单。
前端 332 项、Worker 133 项通过；前端另有 22 项缺少 fixture 跳过。196/1952 构建、typecheck、lint 通过。
真实浏览器已验证 1280/768/390 宽度、中英粤和默认白天；钱包切链、换账户及余额清除由模拟 provider 组件测试覆盖。
没有发布 1952 准备页，也没有替换现有 196 测试站。网络配置与后续接入方式见
[`standalone/NETWORK_PROFILES.md`](../../standalone/NETWORK_PROFILES.md)。

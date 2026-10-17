# 两套矿机业务 · X Layer 1952

状态：开发中。这里保存独立测试网准备与后续部署证据，不替换 `xlayer-test/` 的 196 测试组。
当前尚未部署矿机业务，没有把准备清单当作链上合约地址表。

## 责任与分支

- SodaDEX 集成：`/Users/LevyHoo/Documents/SodaDex`，`codex/feat/mining-products-1952`。
  基点 `7506ce36138dfb6262ef11d1e3ca4828fec5ede3`；明确依赖尚未合并的 SodaDEX PR #1。
  原 `codex/feat/sodadex-bootstrap` 分支及 PR 不在本阶段改写。
- 新矿机收益合约：canonical `okasplaunchpad/contract` 的本地 checkout
  `/Users/LevyHoo/XTruthWorkspace/contract`，同名需求分支，基于 `develop@1426a613b6386be26c6ac91e14612ec581ff9c4c`。
  `src/mining/` 与旧 `src/miner/` 固定价发射业务分别维护。
- FABX 源合约：`MinerWorkspace/pod-contract@4caabe00d0e4d198aac4576bc0ad27c8cca5ce54`。
  仅只读检查；本地预演从提交提取快照，保留原工作树及已有修改。

owner locator 为当前 SodaDEX 矿机需求会话 `/root`。本阶段未提交、推送或修改生产。

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
  当前未取得其他组件的可信 1952 部署记录，`dependencies.json` 使用 null，不能复制 196 地址填入。

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
1952 实际部署、兑换及跨模块对账须分别保存回执；生产组保持独立，尚不部署。

## 本地实现与验证进度

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

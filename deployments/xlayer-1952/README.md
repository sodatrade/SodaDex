# 两套 FAB 矿机业务 · X Layer 1952

**两套 FAB 业务已完成公开链脚本验收；真实 Chrome＋OKX 前端钱包验收正在进行，当前已核实 23 笔成功交易，尚未完成全流程。** 196 测试站及生产合约未改动。

测试入口：[https://sodadex-mining-test-1952.jsmsdx2025.workers.dev/](https://sodadex-mining-test-1952.jsmsdx2025.workers.dev/)。连接钱包后切换至 **X Layer Testnet 1952**；用测试 OKB 获取 TEST-FAB，再进入募资分红或矿机碎片。

## 2026-10-18 真实前端钱包进度（本轮）

通过公开测试站和实际 OKX 扩展操作，由用户逐笔点击最终确认，未用脚本替代本轮业务交易。
已完成 TEST-WALLET 发行、曲线买卖和毕业、毕业后池买入、购买 NFT #5、存入换取 6,000 份碎片、
碎片双向兑换、碎片 LP 添加与全部退出，以及三类分红领取。钱包实际收到分红 **9.43007234 TEST-FAB**，
支付事件、FAB 转账、累计领取和区块前后余额增量一致。

**当前等待用户确认 NFT #5 赎回。** 之后仍须验收项目池卖出、项目 LP 加减、烧币加权、原生测试 OKB 换 FAB，
以及最终刷新／重连与历史查询。不能把先前的本地或公开脚本验收计作这些前端步骤已完成。

补充的 NFT #8 已由后台自动采购，矿场共 4 台，已满员。项目池买入税款已自动转换，剩余 **0.00984263 TEST-FAB**
已投入矿场，待投入余额为零。相关费用账本未清空；当前后台构建 `online-1952-20261018-v5-budget` 已从公共状态核实。

本轮总 gas 上限仍为 **0.0013 测试 OKB**：库存准备最多 0.00008，前端钱包最多 0.001，后台新增最多 0.00022。
库存准备实际 0.000036535281826764；已列 23 笔钱包交易实际 0.000725792166019786；
后台独立快照新增 0.000205502330275116。快照合计 **0.000967829778121666**，并非持续运行后台的永久最终账单。
单笔后台最多 300 万 gas、最高 0.03 Gwei，采购白名单和本金上限不变。授权计划按原始快照保留，调配另存审批记录。

第一笔发行的实际 gas 单价高于原计划值，已按实际费用计入钱包上限；前端现已把检查过的 RPC gasPrice 传给钱包，
后续已列回执约 0.02 Gwei。早先钱包曾把目标提示为 EOA，相关请求均取消；切换官方 1952 RPC 后未再出现该提示，
没有关闭安全检查，也未把钱包内部原因当作已确定结论。

[本轮前端验收进度和新项目地址](2026-10-18-public-wallet-acceptance.json) ·
[23 笔真实钱包回执](2026-10-18-public-wallet-receipts.json) ·
[库存准备回执](2026-10-18-wallet-inventory-receipts.json) ·
[费用调配审批](2026-10-18-keeper-budget-reallocation.json) ·
[后台入矿场核验](evidence/public-wallet-2026-10-18/keeper-fund.json) ·
[三类分红核验](evidence/public-wallet-2026-10-18/dividend-claims.json)。

## 此前部署与脚本验收（历史记录）

2026-10-17 原 102 笔合约验收阶段的实际 gas 为 **0.002136241206812055 测试 OKB**，低于批准的 **0.0025** 上限。
本金按保守上界统计为 **0.00010001 测试 OKB + 6686.09292095 TEST-FAB**，低于批准的 0.001 与 10,000 上限；这不是净损失，池中资产和仓位仍保留。

## 可以测试什么

- 募资分红：已登记的 TEST-A 买卖、项目 LP 加减、毕业后烧币凭证、持有人 FAB 分红。
- 碎片化：真实矿机 NFT 背书、份额双向兑换、LP 加减、矿机存入与赎回、碎片及 LP 分红。
- 钱包逐笔预览和确认；提交后保留交易哈希，查询确认结果，不自动重发未知结果。
- 本次公开验收还覆盖签名发行、曲线买卖、真实矿机市场采购、毕业前分红、V2 毕业、保护期内买卖、税款转换投入及各类费用领取。

当前公开链的 102 笔验收中，发行、采购和税款转换签名由本机脚本提供。

**2026-10-18 线上签名与后台服务已启用，并完成公开 1952 验收。** 新项目 `TEST-ONLINE` 已通过线上服务发行、曲线毕业、毕业后双向兑换；后台自动采购两台指定矿机，并将项目税款转换为 FAB、投入矿场。测试 owner 实际领取 **5.98386921 TEST-FAB**，领取事件、FAB 转账、累计领取额和余额增量一致。

- 当前入口有「发行测试项目」「自动处理」页签；募资分红页可选择 `TEST-A` 或 `TEST-ONLINE`。
- 碎片化仍支持矿机买入、存入／赎回、份额交易、LP 加减和收益领取；零售挂单 2／NFT 5 已保留供手动测试。
- S 和专用执行钱包密钥已存入 Cloudflare Secret，owner 密钥只留本机。1952 服务保留同一 SQLite 账本，未重置历史。
- 本阶段 owner 共 25 笔成功交易（14 笔资产准备＋11 笔业务调用），实际 gas **0.000486796424339820 测试 OKB**，低于 0.0005 上限。后台继续在独立 0.0005 上限内运行，整个阶段最多 0.001；最新费用快照以验收记录的时间为准。
- 本金保守上界为 **0.000899819738236227 测试 OKB＋14,501 TEST-FAB**，低于批准的 0.001 与 15,000 上限。新增 LP 归 owner；后台尚未使用的 gas 余额不是已付手续费。
- 测试发行最多 3 个项目、每钱包最多 2 个；自动采购限挂单 3／4、累计最多 2 FAB，滑点 0.5%。这些不作为生产参数。
- 两台白名单矿机已经采购完，后台显示「暂无合格矿机挂单」属于当前库存状态；后续新增自动采购需另行补充并批准库存。零售挂单 2 仍保留供前端手动买入。

[本轮完整结果、地址与预算](2026-10-18-online-acceptance.json) · [公开链业务与后台回执](2026-10-18-online-receipts.json) · [14 笔资产准备回执](2026-10-18-online-assets-receipts.json) · [执行前冻结的批准计划](2026-10-18-online-service-plan.json)。批准计划保留执行时快照，当前完成状态以验收记录为准。

本轮公开链由受限脚本验收；前端钱包流程另在本地真实业务合约上完成 31 笔，后台 14 笔，45 份回执全部成功。本地只提供 OP 零附加费基础设施 fixture，没有替换业务合约；不把它混称为公开浏览器钱包交易。浏览器已核对公开站的新项目目录、启用状态和真实后台回执。相关测试为 web 435 通过／22 项既有 fixture 跳过、Worker 179 通过、服务 70 通过、公开验收与资产计划 29 通过。

一次公开执行在 nonce 137 授权后、后续兑换广播前停止。已重新核验前 6 笔及 nonce 138，并用新报价继续后缀；没有重复发行、重放成功交易或重复计入 1 FAB。原异常没有保留具体原因，不能据此声称修复了某项合约缺陷。未知广播继续只核对原 hash。

**BEM 尚未接入。** 1952 没有通用 V3 部署；V4 依赖已部署不等于开放通用 V4 前端。1952 不复用 196 的行情、限价单或官方池接口；生产和 196 均未改动。

7 天到期、供应封顶、失格、晋升、紧急暂停和无人合格持有等边界已通过本地真实合约集成与故障／时间注入验证；不能把它们宣传成已在公开链等待 7 天的验证。
合约回归 959 通过、3 项可选跳过，真实 FABX／Manager 集成 15 通过，历史收益专项 32 通过。
Permit2 的运行码和签名域核验见 [独立记录](2026-10-17-permit2-runtime.json)。

## 发给同事的地址

本轮新建的 `TEST-ONLINE` 项目地址（**1952 测试网**）：

| 用途 | 地址 |
| --- | --- |
| TEST-ONLINE 项目币 | `0xb149691FC4fbd703168e326aD97005AD882809B8` |
| 税收金库 | `0xC9acB507a8D392CeDd29B7f06Ae733340E8abD86` |
| 持有人分红 | `0xA0aedF82394ac3a97953C217F49D0688E4b6C95c` |
| TEST-ONLINE/FAB 池 | `0x08676291C759a407E6c2174212A5c69aF7333CcD` |

以下均为 **X Layer 测试网 1952**，只使用测试资产。

| 用途 | 已部署地址 |
| --- | --- |
| TEST-FAB | `0x7a188d4c46c9fe045a5875fecaef9bf00e4521ff` |
| 矿机 NFT | `0x5ae194d008292ef9d02933a599070c9661be040c` |
| 挖矿代理 | `0x7991d4a8493b9709365cd079dffc75e790007874` |
| 矿机市场 | `0xa619c4cf1264bc071a3827edd0b64252842471be` |
| 共享矿场 | `0x0e51055559be68416210eae41d7e31df890b5708` |
| 项目工厂 | `0xc5e7fd4b379afd2e93c3def70989e9bb14815b1d` |
| 碎片金库／TEST-fFAB | `0xed377733590639e0a4ec7cd14df7509c7b2ca87d` |
| 碎片交易池／LP | `0x6f1666231685cf8fc45b355a9eba8afd9ba6d2fa` |
| 测试矿机购买入口 | `0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab` |
| 交易 Manager | `0xe713afd6133207df18662080e2b0f7e456aeeba5` |
| V2 Router | `0xd7e58272181d6b56af5b10a12f519ba4a85914e7` |
| WOKB | `0xda5bc8bc981d9b2f5df2b0c7e5aed044993709fa` |
| TEST-A 项目币 | `0xf71c2666394361016b10A3310C7A6d4F15Af0934` |
| TEST-A 税收金库 | `0x4acE41319812BD273CBc010C39EBed3B3162deB7` |
| TEST-A 持有人分红 | `0xc4D4d2367ddfb3632FA9b025e27a0671E35A81Dc` |
| TEST-A/FAB 池 | `0xc3C595d36881a72B6646512b7f9ceC19Ea16e384` |

- [完整部署摘要、运行码与费用核验](2026-10-17-products-deployment.json)
- [102 笔成功交易回执](2026-10-17-products-receipts.json)
- [前端可信地址与代理／beacon 清单](products.json)
- [测试参数与批准上限](test-policy.json)
- [测试站版本、公开接口和浏览器验收](2026-10-17-products-acceptance.json)
- [桌面截图](evidence/desktop.png) · [手机粤语夜间截图](evidence/mobile-yue-dark.png)

已重新核对全部回执、实际费用、27 份新部署运行码，以及产品代理槽和 NFT beacon 接线。源码对应提交见部署摘要；这不等于浏览器网站已完成源码认证。
前端 354 项通过、22 项旧 fixture 用例跳过；Worker 152 项通过。类型检查、lint、196/1952 构建与 CSP 检查通过。公开浏览器核验了合约版本、四个页签、中英粤和 390/820/1440 宽度；公开链的 102 笔由部署脚本执行，本地真实钱包界面另有 8 笔验收，不混称为公开 GUI 交易。

官方测试 RPC 偶尔返回旧 pending 状态；初次公开接口检查曾有两次 502，随后完整 13 项复测通过。预览遇到持续异常会停止，稍后可重试；不接受旧状态，也不自动重发交易。

原 4 笔创建交易在恢复执行时保留，无重复提交或重复计费。广播前保存哈希；只读 pending 状态陈旧时等待核验恢复，持续异常则停止。

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

上述为基础准备阶段入口；本轮产品部署与验收以文首的新部署记录为准，生产组尚不部署。

## 基础批次历史快照 · 2026-10-17

以下保留该基础批次当时的状态；最新产品地址、实现升级与 Permit2 核验以文首记录为准。

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
基础批次当时的 PodMining 实现运行码为 24,504 字节，后续增加接口还须通过实现体大小验证，不能仅验证逻辑。
当前基础组仍是上述原提交源码，未升级任何生产或测试实现；后续测试源码扩展及升级须另存版本和回执。

## 最低测试参数与生产费用决定

[收费与收入分配清单](../fees/checklist.html) 面向产品逐项确认。
[test-1952.json](../fees/test-1952.json) 使用基础设置费 0、Mining 双侧税各 1%、
协议分税款 1%、Creator 0，保留已确认的 Mining V2 0.3% 与碎片化 0.5%／平台 30%／LP 70%。
当前源码不支持把这些业务固定费全部改成 0；未来产出服务费、界面费等使用零费测试目标。
本轮部署已核对这份测试配置，不改变已有 196 池；1952 普通 V3 零费档尚未部署。

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

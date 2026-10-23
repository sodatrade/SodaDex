# SodaDEX 矿机碎片专用池：Owner 正式部署说明

日期：2026-10-22（洛杉矶）
目标网络：X Layer 主网，chainId **196**，原生 Gas 币 **OKB**。

这份说明交给 Owner 部署接入 fabx.tech 正式矿机的 SodaDEX 新实例。当前交付的是已完成本地测试的适配候选，**尚未部署正式 SodaDEX 地址**。请在外部审计完成、最终参数冻结并预演后，由 Owner 签名部署。现有测试池、LP 和收益债务不会自动迁移。

## 1. 使用哪份代码

使用审计包 `SodaDEX-Formal-FABX-adapter-audit-2026-10-22.zip` 中的：

- 源码：`contracts/sodadex-fragments-production/src/`
- 编译配置：`contracts/sodadex-fragments-production/foundry.toml`
- ABI 和编译产物：`contracts/sodadex-fragments-production/review/artifacts/`，每个 JSON 的 `abi` 字段即完整 ABI。
- 评审与验证：同目录 `review/REVIEW.md`、`validation.json`、`scanner-triage.json`。
- 固定依赖：`contracts/sodadex-fragments/vendor/`；解压时保留相对路径。

审计包 SHA256：

```text
dc48341c57e3a1859d4de234407e0426fc78990ef8ace64b4e686176f7ce4895
```

版本标识：`keccak256("SodaDEX.OKB.Fragments.Formal.v1")`。

仓库：https://github.com/sodatrade/SodaDex
候选工作分支：`codex/fix/sodadex-formal-fabx-adapter`。审计 ZIP 制作时适配代码尚未提交；基线 `d5c1a940ba8353ab8a5541f1c219362376679f23` **不包含这次适配修改**。本说明与适配源码一同提交到 main；请使用实际包含 `contracts/sodadex-fragments-production/` 的交付提交，记录其完整 SHA，并核对源码哈希和产物后部署。包内 validation.json 的未提交／未推送字段是打包时的历史状态。

本说明是审计 ZIP 之后单独生成的交接文件，不改变原 ZIP 或其校验值。

## 2. 正式外部合约与收款地址

以下 FAB、Mining、NFT 已与 fabx.tech 当时实际发布的网站配置及链上绑定核对；广播前须重新运行只读预检。

| 用途 | 地址 |
| --- | --- |
| 正式 FAB，8 位精度 | `0x72F349B1Eee7833B26f8C81a8410775A4e231ed2` |
| 正式 Mining | `0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265` |
| 正式矿机 NFT | `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6` |
| Vault 构造参数 factory：NFT 创建工厂 | `0x1f09DAeFA827f02CBb40967cc91b259763760761` |
| FABX 注册工厂，仅用于核验，不代填 factory | `0x82935793a854fA2F2e8A9d2B3F17BbfBf81D6C05` |
| SodaDEX Policy Owner、国库、Locker 初始受益人 | `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A` |

配置来源：<https://api.fabx.tech/v1/pod/mainnet>。网站绑定证据在包内 `deployments/xlayer-production/fabx-website-binding-2026-10-22.json`。

此处 Owner 是 SodaDEX 的管理员，不是对外部 FABX Mining 所有权的变更。Vault、Pool、REWARDS、INCOME 没有统一的可修改 owner 字段；各自固定绑定关系以以下构造参数为准。

## 3. 部署前确定的参数

| 参数 | 状态及要求 |
| --- | --- |
| 网络、FAB、Mining、NFT、factory、Owner、国库 | 已确定，见上表；部署当天重新核验依赖 |
| `capacity` | Owner 最终确定，类型 uint16 且大于 0；测试容量 8 不代表正式容量。收益结算遍历矿机，必须验证拟用容量下的 Gas |
| 初始投入的矿机、sFAB、OKB 和价格 | Owner 最终确定；sFAB 必须通过合格矿机存入获得 |
| Locker 注入多少 LP、何时锁定 | Owner 最终确定；当前合约一次性锁定，期限固定 **60 天**，从 `lock()` 成功区块计时 |
| 部署执行账户／方式、nonce、Gas 预算 | Owner 最终确定并完整预演；EOA、Safe、部署工厂的创建地址算法和执行者不同 |

如需不同锁仓期限，须修改源码、测试及重新冻结产物；不能在构造参数中传入期限。不要沿用旧测试批次的 Gas 授权作为正式部署预算。

## 4. 编译和只读检查

以下命令在解压后的包根目录执行。需要 Foundry、Python 3 和精确版本的 solc 0.8.26。`/path/to/solc-0.8.26` 替换为 Owner 本机路径。

编译设置：Solidity 0.8.26、优化开启、runs 200、viaIR 开启、EVM Cancun；使用包内固定依赖，不升级依赖重新部署。

```sh
# 只读预检；输出必须是尚不存在的新文件。
python3 scripts/sodadex/formal-fragments-preflight.py --output /tmp/soda-formal-preflight-owner.json

python3 -m unittest discover -s scripts/sodadex -p test_formal_fragments_preflight.py -v

SODA_FORMAL_FORK_RPC=https://rpc.xlayer.tech forge test \
  --root contracts/sodadex-fragments-production \
  --use /path/to/solc-0.8.26 --offline --summary

forge build --root contracts/sodadex-fragments-production \
  --use /path/to/solc-0.8.26 --offline --sizes
```

预检核对 chainId、依赖绑定、FAB 精度、NFT 工厂、Mining 暂停状态和倍数。预检输出 `readyForOwnerBroadcast: false` 是刻意保留的状态：它仅核对依赖，不能替代最终交易预演。上述测试的正式 fork 固定在区块 73957111；部署前还需按最新链状态及最终参数预演。

包内已记录的验证结果为 26 项合约测试通过、6 项预检测试通过，解压重编译的 6 份 ABI／字节码模板一致。它们不等于外部审计通过，也不等于正式部署成功。

## 5. 部署顺序与构造参数

源码文件均在 `contracts/sodadex-fragments-production/src/mining/soda/`。所有构造部署调用均不需要转入初始本金；初始流动性另行调用。

### 第一步：部署 SodaPolicy

```solidity
SodaPolicy(address admin, address treasury_, IERC20 fab)
```

依次传入：

1. `admin`：`0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`
2. `treasury_`：同上
3. `fab`：正式 FAB 地址

保存 Policy 地址及创建回执；核对 `owner()`、`treasury()` 和 `FAB()`。

### 第二步：准确预计算 Pool 地址

Vault 的 `LP_POOL` 是不可修改的地址，必须在部署 Vault 前确定。

若采用**同一 EOA 连续直接 CREATE 部署**，在 Policy 已确认后，设该 EOA 下一笔创建 Vault 的 nonce 为 `n`，则下一笔创建 Pool 使用 nonce `n+1`。预计算 `CREATE(该 EOA, n+1)` 作为 Vault 的 `lpPool`。

这个关系只适用于上述部署方式。中间不能插入转账、授权或其它占用 nonce 的交易；失败交易也可能消耗 nonce。Pool 内部创建 REWARDS／INCOME 不消耗部署 EOA 的额外 nonce。

若 Owner 是 Safe 或通过部署工厂执行，应按实际 CREATE／CREATE2 发起者与方式计算，并在完整预演中验证；不能使用 Owner 钱包地址加 EOA nonce 的公式代替。

### 第三步：部署 SodaIncentiveVault

**必须部署 `SodaIncentiveVault`，不能用父类 `SodaVault` 代替。**

```solidity
SodaIncentiveVault(
    IERC20 fab,
    IFabxMining mining,
    IERC721 nft,
    address factory,
    uint16 capacity,
    SodaPolicy policy,
    address lpPool
)
```

依次传入：正式 FAB、正式 Mining、正式 NFT、**NFT 创建工厂**、最终容量、新 Policy 地址、预计算 Pool 地址。

此 Vault 本身就是 sFAB ERC20 合约，不需要额外部署一个碎片代币。保存地址并核对 `FAB()`、`MINING()`、`MINER_NFT()`、`NFT_FACTORY()`、`MAX_MINERS()`、`POLICY()`、`LP_POOL()`。

在 Pool 部署并核对成功前，不开放 Vault 存入、收益结算或前端入口。

### 第四步：部署 SodaIgnixPool

```solidity
SodaIgnixPool(SodaVault vault, address ignixTreasury)
```

传入新 `SodaIncentiveVault` 地址，以及 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`。

**实际 Pool 地址必须等于 Vault.LP_POOL()。** 该 Pool 自身就是 LP ERC20，不需要再部署独立 LP 代币。

构造函数自动创建两个子合约，随后从 Pool 读取：

- `REWARDS()`：`IgnixLpRewards`，保存 LP 的 FAB 和 OKB 收益；固定激励来源为上述 Vault。
- `INCOME()`：`IgnixTreasuryIncome`，保存平台 OKB 手续费；固定收款人为 IGNIX 国库。

**REWARDS 与 INCOME 是两个不同合约。不要另行手工部署替代实例，也不要把国库地址填写成 REWARDS。**

### 第五步：部署 SodaLocker

```solidity
SodaLocker(SodaPool pool, address receiver)
```

传入新 Pool 地址，`receiver` 为 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`。

`FUNDER` 固定为构造时的 `msg.sender`。后续只有 FUNDER 能调用 `lock(amount)`，且该账户必须持有 LP 并授权 Locker。通过工厂部署时 FUNDER 会成为工厂；若工厂不能持币、授权并调用 lock，这种部署方式不适用。须在预演中核实真实调用者。

## 6. 5% LP 激励怎样接入

本候选在构造阶段已经建立绑定，不需要后续设置 5% 收款地址：

1. Vault 收到并识别新增 FAB；来源包括自己领取、第三方代领及主动转入。
2. Vault 将 10% 通过 Policy 记入国库债务。
3. Vault 查询固定 Pool 的 REWARDS，校验 Pool、FAB、激励来源三个绑定。
4. Vault 授权 REWARDS 拉取本次 5%，调用 `notifyIncentive(amount)`，完成后清除授权。
5. 其余 FAB 记给当时份额持有人；Pool 持有份额对应的 FAB 通过 Pool.harvest() 进入同一个 REWARDS。

`notifyIncentive` 只接受固定 Vault 调用。IGNIX 同事应接入这套新 Vault／Pool／REWARDS；不能从其它金库或 Owner 钱包直接调用该接口作为 5% 注入。若改用另一金库，属于新的绑定方案，需要重新评审部署。

金额按 FAB 最小单位计算：国库 `floor(received × 10%)`，LP 激励 `floor(received × 5%)`，持币部分为余数。无人持有 LP 时的对应激励保留为 parked，不分给未来首位 LP。

## 7. 上线前核对与初始化

先逐项只读核对：

| 读取项 | 期望 |
| --- | --- |
| Policy.owner / treasury / FAB | 指定 Owner／国库／正式 FAB |
| Vault.LP_POOL | 新 Pool |
| Pool.VAULT / POLICY / FAB | 新 Vault／新 Policy／正式 FAB |
| Vault.lpRewards() | 等于 Pool.REWARDS()，调用成功 |
| REWARDS.POOL / FAB / INCENTIVE_SOURCE | 新 Pool／正式 FAB／新 Vault |
| INCOME.POOL / FAB / RECIPIENT | 新 Pool／正式 FAB／指定国库 |
| Locker.POOL / FUNDER / beneficiary | 新 Pool／实际锁仓出资执行者／指定受益人 |
| Vault 与 Pool 的 PRODUCT_VERSION | 本文版本 hash |

然后按最终资金方案初始化：

1. 持有人先检查 `Vault.admissibleMiner(id)` 和 `previewDeposit(id)`，授权 NFT 给 Vault，再调用 `deposit(id, minimumShares)` 获得 sFAB。不要直接把 NFT 转给 Vault。
2. 将拟投入的 sFAB 授权给 Pool，调用 `addLiquidity(desiredShares, minimumShares, minimumOkb, deadline)`，原生 OKB 通过 `msg.value` 传入。初始投入比例决定初始价格；本金不要直接转给 Pool。
3. 首次建立 LP 之前已结算的 LP 激励可能进入 parked；须理解这一启动顺序，不把它当作后来 LP 可领取的收益。
4. 如执行官方 LP 锁仓，由 Locker.FUNDER 持有并授权 LP 后调用 `lock(amount)`，核对 `locked` 与 `unlockAt`。本实例只允许一次锁定；到期由 beneficiary 提取。

先在本地最新 fork 完整预演，再由 Owner 按已确认的最小金额进行链上验收：合格矿机存入／赎回、份额增发／销毁、LP 添加／部分和全部移除、双向兑换、三路 FAB 分账、LP 转移前后历史收益归属、普通持有人和国库领取，以及最优解／未验证池／DeWeb／钱包加速矿机拒绝。

兑换费取 OKB 侧毛额的 0.5%，其中 30% 给 INCOME，70% 给 REWARDS，按合约整数舍入。矿机赎回产品费按基础权重乘 `1e12 wei OKB`，通过 `previewRedeem` 获取实际应付；这不是加减 LP 手续费。

## 8. 谁领取，谁支付 Gas

| 动作 | 调用及资金去向 |
| --- | --- |
| 收集矿机收入并拆分 | `Vault.harvest()`；由调用者付 Gas |
| 同时收集 Pool 的份额收益 | `Pool.harvest()`，内部先结算 Vault，再将 Pool 的 FAB 转入 REWARDS |
| 持有人领取 FAB | `Vault.claimFor(account)`，付给记账的 account |
| LP 领取 FAB／OKB | `REWARDS.claimFor(account)`，或分别 claimFabFor／claimOkbFor |
| 国库领取 10% FAB 与赎回产品费 | `Policy.claimFor(国库地址)` |
| 国库领取平台 30% OKB 手续费 | `INCOME.claimPlatformOkb()`，只能付给固定 RECIPIENT |
| Locker 收益结算／领取 | `Locker.harvest()` 后 `Locker.claimFor(受益人)` |

可代领接口不会把钱付给调用者。若运营要求 Owner 承担收取／派发 Gas，应由 Owner 或其授权执行程序发起；当前交付没有“每 10 分钟 harvest”或“每日自动到账”的后台任务。合约部署不会自动创建这些任务。

Policy 的国库变更经过 48 小时延迟；INCOME.RECIPIENT 是固定地址，修改 Policy 国库不会同步改掉它。

## 9. 异常时怎样处理

- 预检失败、依赖变化、容量 Gas 超限或模拟回滚：停止对应部署步骤，先更新证据和预演。
- 广播返回异常：先按交易哈希、账户 nonce 和回执核对，不能直接重发一份不同交易。
- Vault 已部署但 Pool 创建失败／地址不符：不要开放业务。重新判断固定 LP_POOL 是否仍可部署到正确地址；不能直接修改 Vault 的绑定。必要时重新部署一整套新绑定。
- 领取失败：交易回滚保留债务；核对代币或收款方对原生 OKB 的接收能力。REWARDS 支持 FAB／OKB 分开领取。
- ABI／源码／链上 runtime 不一致：停止页面切换，核对编译设置、构造参数与最终产物。包内 runtime 含 immutable 占位模板，不能直接当链上最终 runtime hash。

## 10. 部署后交给 IGNIX 的材料

完成验收后输出正式 manifest，至少包含：

- `chainId: 196`、网络名称、部署执行账户、源提交、版本 hash、编译设置。
- FAB、Mining、NFT、NFT 创建工厂。
- **Vault（sFAB）、Pool（LP）、REWARDS、INCOME、Policy、Locker** 六个新地址。
- 每个合约的 ABI、构造参数、创建交易哈希、创建区块／索引 fromBlock、实际 runtime code hash、源码验证链接。
- 容量、初始流动性和价格、Locker.FUNDER／beneficiary／locked／unlockAt。
- 完整部署与验收回执；未执行项目明确标记未执行。

IGNIX 使用实际新地址切换页面、读取和索引。SodaDEX 域名继续用 `https://soda.ignix.bot`；前端发布与合约部署是两个动作。地址尚未产生前留空，不用旧测试地址填入正式 manifest。新 ABI 使用 `FabIncomeRecognized` 事件，不再依赖旧 `MiningCollected`／`paidTo`。

# IGNIX 新金库与 SodaDEX 历史 LP 收益接入

日期：2026-10-23。对接基线：IGNIX `origin/develop` 的 `f0ca687`；SodaDEX 基线 `2f18787a98bb7aabb9b4f48308f0db56481a77d8`，本地工作分支 `codex/fix/lp-history-rewards`。

## 当前结果与部署状态

SodaDEX 新增 MirrorSodaPool、MirrorLpRewards、EpochRewardLedger。已验证 LP 退出、转让和空池时段不会按到账时的持有人重分历史收益。旧池子和旧账本保持原实现；新池必须绑定实现下述协议的新金库。

**部署已交由 owner 执行；本次只交付源码和接入说明。尚未部署 FABS，也没有可交付的新链上地址。** f0ca687 的 MirrorVault 仍硬编码 `ERC20("Open Miner Shares", "sFAB")`，且只有旧 `notifyIncentive(uint256)` 调用，不能直接接入新奖励合约。FABS 表示新矿机金库的 ERC20 份额，由金库在存入矿机时铸造、赎回时销毁；独立代币没有 owner 任意增发入口。若使用独立币方案，部署 FabsToken 后将金库 ERC20 份额拆分为对该币的调用；使用 MirrorFabsPool。池子按地址和接口绑定，不按 symbol 识别。

## 已确定的收益归属

- 池内份额币产生的 FAB：按各时段池子取得收益的权重和当时 LP 份额分给对应 LP。
- 本期 5% 激励：整笔分给本期曾经参与的 LP，按 `积分 = ∫(个人 LP / 总 LP) dt` 分配。分母只累计总 LP 大于零的秒数。中途空池不稀释历史 LP；确认时已全部退出仍有权领取。
- 本期完全没有 LP 的 5% 继续在金库侧按现有国库路径处理，不传给 REWARDS。这与“确认时没有 LP”不同。
- OKB 交易手续费不变：OKB 侧金额的 0.5%，其中 30% 给国库、70% 给 LP。
- 新 LP 不分走此前收益，已退出 LP 保留此前已形成的权益；到账前显示可领为零并不意味着没有待确认权益。

## IGNIX 同事需要实现的接口和顺序

接口定义在 `src/mining/soda/interfaces/IMirrorEpochVault.sol`。新 REWARDS 对以下三个写入口仅允许永久绑定的金库调用。

```solidity
// 金库提供
function LP_REWARDS_VERSION() external view returns (bytes32);
// 返回 keccak256("SodaDEX.MirrorEpochRewards.v1")
function openEpoch() external view returns (uint64); // 新部署从 1 开始

// 新 REWARDS 提供
function checkpoint(uint64 epoch, uint256 cumulativePoolWeight) external;
function closeEpoch(uint64 epoch, uint256 cumulativePoolWeight) external;
function notifyEpochRewards(uint64 epoch, uint256 poolFab, uint256 incentiveFab) external;
function activeSeconds(uint64 epoch) external view returns (uint256);
```

金库还需提供池子现有依赖：`FAB()`、`POLICY()`、`totalEligibleWeight()`、无参 `harvest()`、标准 ERC20。`totalEligibleWeight()` 应从新金库权重状态读取，不为兼容接口重新遍历所有矿机。无参 harvest 用于轻量同步；矿机实际领取仍按新金库的分批接口执行，不能强制在 LP 交易中全量领取。

### 1. 先记录收益，再改变持币量

金库维护单调递增的 `cumulativePoolWeight`：累计池子持有份额应获的原始收益权重。沿用金库既有原始收益单位，在每次池子份额余额变化之前，把旧余额对应的新增权益累加，再调用 `checkpoint`。例如依据原有 `accShare` 计算旧池余额对应的增量；精度和余数必须与金库最终结算一致。

必须覆盖普通 transfer、transferFrom、铸造、销毁及直接向池子转币，不能只在池子 add/remove/swap 入口同步。LP 铸造、销毁、转让前，池子调用金库无参 harvest，金库也必须调用 checkpoint，即使这次没有新增收益、没有关闭周期。REWARDS 以旧 LP 余额记账后才改 LP 余额。

权重不能按到账时间补记到下一期，也不能在换期时重置累计值。只在池子业务入口做同步会漏掉 ERC20 直接转入。

### 2. 关闭周期必须传出最终权重

金库先完成本期原始收益累计，再调用 `closeEpoch(epoch, cumulativePoolWeight)`，成功后才把自身 openEpoch 加一。零收益周期也必须关闭和确认；否则两边序号不一致会阻止后续操作。

当前实现与金库“一个待确认旧期 + 一个当前期”的结构对应。前一期未确认时不能再关闭下一期。奖励结算不遍历历史周期；不要把多期任意积压接到该接口。

关闭时间使用实际调用时间。若 IGNIX 要把周期终点回溯到过去的整点，当前接口不能假装完成历史回溯：必须另外评审边界时间和历史 LP 记录。本方案要求双方采用相同的实际关闭边界。

### 3. 确认时一次注入本期两笔 FAB

金库算出本期池子持币分红 `poolFab`，以及本期 5% `incentiveFab`。把同一笔池子分红从普通持币人的待领债务中消耗掉，更新金库总负债/已支付状态，授权 REWARDS 拉取二者之和，再调用 `notifyEpochRewards`。调用失败必须整笔回滚，保留原可重试状态。

不能同时保留 `claimFor(pool)` 对同一笔钱的可领取权，也不能先转账再让旧 `recordFab()` 入账。第三方调用 claimFor(pool) 也不得绕过上述分流。新池不再通过旧 claimFor(pool) 领取分红。

5% 的资格判断改为 `activeSeconds(epoch)`，不能读取确认时的 totalSupply。当 activeSeconds 大于零，完整 5% 都注入该历史周期；为零才沿用金库侧国库路径并传 incentiveFab=0。

该入口按期顺序确认；重复、倒序、未关闭的周期回滚。两种 FAB 同时确认，金额为零也调用。REWARDS 检查实际到账差额，按期固定金额，之后不能重复修改。本版的旧 `notifyIncentive(uint256)` 与 `recordFab()` 都主动拒绝调用。

## 必须继续处理的锁仓边界

旧 SodaLocker 仍按“收钱时的 beneficiary”归属新增余额。若 Alice 的锁仓收益尚未确认便把 beneficiary 换成 Bob，后续收到历史 FAB 时可能归给 Bob。普通 LP 地址层面的历史账已解决，并不自动解决这一层受益人转移。

新版本上线若包含可更换受益人的锁仓器，需另加受益人历史账并完成回归；不能直接把旧 Locker 宣称为新金库完全兼容，也不能未经确认冻结受益人变更。当前未修改该规则。

## 新部署顺序与核验

1. 先完成 IGNIX 金库上述接口及 FABS 命名，联调真实 MirrorVault，不使用测试 fixture 上线。
2. 预计算池地址解决金库 LP_POOL 与池 VAULT 的绑定；根据最终部署者 nonce 预演完整部署顺序。池构造时要求金库版本正确、openEpoch==1。
3. 部署新金库、MirrorSodaPool；奖励合约由池构造创建。核对 FAB、POLICY、LP_POOL、REWARDS.POOL、INCENTIVE_SOURCE、国库和 owner。
4. Owner 沿用用户最新指定 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`；资金收款地址必须从本次部署清单核对，不能仅凭 owner 推断。
5. 固定正式 FABX 来源、chainId=196，进行最终 fork 部署与业务预演后，形成实际 Gas 预算。历史测试批次预算不能挪用。
6. 完成链上部署和回执/绑定核查后才交付 FABS、Pool、REWARDS、INCOME 等新地址；旧测试币和旧债务不自动迁移。

## 本轮验证及限制

- 提交前复跑：34 项本地测试通过；首次完整运行的 fork setUp 因 RPC TLS 失败，随后单独重试 3 项正式 fork 全部通过。合计 37 项业务测试通过、0 跳过；首次命令仍以网络失败退出，不能记为一次全绿运行。其中新 Mirror 奖励测试 11 项，包括 256 轮随机多参与者历史测试，参考模型同时检查少发与超发。
- 覆盖中途转让、全部退出、空池间隙、直接转入份额币、零额与重复确认、300 期后领取和 OKB 手续费。300 期后领取设置 350,000 gas 回归门槛，不按期遍历。
- 频繁第三方代领曾导致不足一秒的权重被截断：已先复现失败，再保留跨次结算小数余数，100 次每秒代领回归通过。
- 3 项正式 FABX fork 测试通过，RPC 为 https://rpc.xlayer.tech。这三项验证既有正式 FABX 集成，**不是**新版 IGNIX MirrorVault 与新池完整联调证据。新协议目前使用 EpochVaultFixture 验证。
- Solidity 编译及高严重性 forge lint 通过。MirrorLpRewards 运行字节码 9,735 字节、MirrorSodaPool 6,962 字节，低于 EIP-170；新池 initcode 20,912 字节。
- Slither 执行遇到继承/引用解析错误，并报告 36 条结果，不能称完整扫描通过。新账本局部变量默认初始化属于 Solidity 零值语义；代领 OKB 的收款人受其账本约束，并非任意提取。其余旧托管路径告警不作为本次新协议已通过的证据。
- Aderyn 0.6.8 编译 AST 阶段 `content not found` 崩溃，属于未完成的工具检查。

本轮代码交付分支为 `codex/fix/lp-history-rewards`；本文件不代表链上已部署。本文件与新增接口须一起交给 IGNIX 同事；补齐后还需真实金库联调、锁仓受益人回归及最终部署预演。

## 独立 FABS 的额外适配边界

本次 MirrorSodaPool 仍沿用“金库本身就是 ERC20 份额币”的接口，新增独立 FabsToken 和 MirrorFabsPool 已完成代码实现，MirrorFabsPool 通过 SHARES() 使用独立币；原 MirrorSodaPool 继续服务一体式金库。若 owner 要先部署独立 FABS，请先完成 [独立代币接入要求](fabs-owner-handoff.md)，不能只把本次池子 VAULT 参数换成普通 ERC20 地址。本轮独立币代码采用 owner 一次性绑定金库；部署由 owner 执行，实际绑定前须完成真实金库适配。

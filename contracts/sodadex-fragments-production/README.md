# 正式 FABX 适配候选：矿机碎片专用池

**独立 FABS 新部署入口：**参见 [Owner 部署及 IGNIX 接入说明](docs/fabs-owner-handoff.md)。独立币使用 `FabsToken`，池子使用 `MirrorFabsPool`；下文旧一体式金库与其容量参数不能直接作为这套新部署配置。

本目录是新部署候选源码，版本标识为 `SodaDEX.OKB.Fragments.Formal.v1`。**尚未部署，没有正式 SodaDEX Pool／Vault／REWARDS 地址，也没有切换网站。** 正式部署由 Owner 签名执行，Owner／国库仍为 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`。

`../sodadex-fragments/` 保留已部署 TEST v5 的冻结源码。本目录从该版本派生，单独维护；编译共用其 `vendor/` 内已固定的 OpenZeppelin 5.4.0 和 forge-std 依赖，不修改外部 FABX、旧合约、普通 V2/V3/V4 或前端。

## 正式依赖与工厂职责

依赖来自 `https://api.fabx.tech/v1/pod/mainnet`，链为 X Layer 196。固定区块核验见 [formal-adapter-preflight-2026-10-22.json](../../deployments/xlayer-production/formal-adapter-preflight-2026-10-22.json)。

| 构造参数／角色 | 正式地址 |
| --- | --- |
| FAB（8 位精度） | `0x72F349B1Eee7833B26f8C81a8410775A4e231ed2` |
| Mining | `0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265` |
| Miner NFT | `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6` |
| Vault 的 factory 参数：NFT 创建工厂 | `0x1f09DAeFA827f02CBb40967cc91b259763760761` |
| FABX 注册工厂；不能代填上面的参数 | `0x82935793a854fA2F2e8A9d2B3F17BbfBf81D6C05` |

只读脚本 `scripts/sodadex/formal-fragments-preflight.py` 从 NFT 的 `factory()` 读取创建工厂，同时检查两个工厂都认可该 NFT，并固定每次读链的区块。API 改变正式地址、链不符、Mining 的 FAB 不符、精度不符、矿机倍数不符或暂停时，脚本直接失败。输出始终不宣称已满足广播条件。

## 收益如何记账

正式 Mining 没有 TEST v5 的 `paidTo` 扩展。`FabxMinerCustody` 负责 NFT 托管和领取，不再读取该计数器；`SodaVault._collectFabIncome()` 持有收益账本，先领取，再计算：

`本次新增 FAB = 金库 FAB 实际余额 − 已记账但未支付的持币收益债务`

领取旧收益时，余额和债务同步减少，因此不会重新分账。第三方替矿机触发 `claim` 后，FAB 仍进 NFT 持有人即本份额金库；之后结算时也能识别，不要求必须由金库自己触发领取。若余额低于债务，结算回滚，不会继续生成新债务。

用户已于 2026-10-22（洛杉矶）确认：**主动直接转进份额金库的 FAB，也按 85% 持币人、10% 国库、5% LP 分配。** 正常流程不需要直接转币。链上不能区分这些转账与第三方代领；`cumulativeMiningFab` 为兼容已有读取接口而保留名称，其值表示全部已识别 FAB，包含主动转入。新事件 `FabIncomeRecognized` 取代旧 `MiningCollected`，`MiningIncomeSplit` 仍记录实际拆分。索引应使用本候选实际 ABI。

份额转移、增发与销毁之前先结算，已产生的收益归原持有人。无人持有份额或 LP 时产生的对应收益继续保留在 reserved／parked，不分给以后首次入场的人。已记账收益的领取不依赖 Mining 是否暂停；产生新收入的结算仍依赖正式 Mining 可用。

金库和 REWARDS 都拒绝向自身领取自身收益：自转账不会实际支付 FAB，不能据此减少债务后再把同一笔币作为新增收入。误转给合约自身的份额或 LP 不能通过这条路径制造重复分账；普通用户领取不受影响。

矿机准入、按基础权重的份额增发／销毁、兑换的 0.5% OKB 侧手续费及 30% 国库／70% LP 分成、按基础权重收取的赎回产品费沿用原规则。最优解、钱包加速、DeWeb 加速、未验证池矿机仍被拒绝。池内份额的 FAB 收益和额外 5% 激励都进入固定 REWARDS，按历史 LP 份额领取。

## 验证与复现

从仓库根目录执行。需要 Foundry、Python 3 和精确 `solc 0.8.26`，不读取钱包或 `.env`。

```sh
# 仅本地夹具与不变量，不读取 RPC。
forge test --root contracts/sodadex-fragments-production --use /path/to/solc-0.8.26 --offline --no-match-contract SodaFormalForkTest --summary
# 正式依赖 fork：只在 Forge 本地 EVM 改状态，公共 RPC 只读。
SODA_FORMAL_FORK_RPC=https://rpc.xlayer.tech forge test --root contracts/sodadex-fragments-production --use /path/to/solc-0.8.26 --offline --summary
forge build --root contracts/sodadex-fragments-production --use /path/to/solc-0.8.26 --offline --sizes
forge lint "$PWD/contracts/sodadex-fragments-production/src" --root contracts/sodadex-fragments-production --use /path/to/solc-0.8.26 --offline --severity high
forge fmt --root contracts/sodadex-fragments-production --check
python3 -m unittest discover -s scripts/sodadex -p test_formal_fragments_preflight.py -v
# 输出文件必须尚不存在；仅公开读链，不允许覆盖旧证据。
python3 scripts/sodadex/formal-fragments-preflight.py --output /tmp/formal-preflight-new.json
```

完整测试含 26 项：3 项正式依赖 fork，4 项状态不变量，以及 19 项例子／模糊测试。Fork 固定区块 `73957111`，本地转移并托管真实矿机 NFT #1、#2，覆盖增发／赎回、LP 加减、双向兑换、代领、分账和领取；真实未验证矿机 #11 被拒绝。四类拒绝的完整组合还由无 `paidTo` 的本地夹具覆盖。

Fork 证明该区块的依赖行为，不代表 Owner 最终参数的部署预演，不等于独立审计结论。测试容量为 8；正式容量、初始流动性／价格、锁仓安排及部署 Gas 尚需最终确定和按实际 Owner nonce 预演。容量影响每次结算的全量矿机遍历成本，不能把测试容量自动当正式值，也不能从少量矿机测试推导满容量可用。

本候选不升级旧实例、不迁移旧债务，不部署定时 harvest 或自动派发程序。外部 FABX 可升级／暂停的信任边界仍存在。通过这些检查后，仍应先完成外部审计，再冻结实际源码、构造参数和编译产物，交 Owner 部署。

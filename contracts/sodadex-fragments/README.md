# 矿机碎片专用池 v5：审计源码

这是一份与 **2026-10-22 的 X Layer 196 独立测试部署**对应的冻结源码。池子、份额金库和分红需一起审计。本目录不是新部署，也不改变网站当前绑定。它不包含其它已退役挖矿产品。

业务源码的维护仓库是 [okasplaunchpad/contract](https://github.com/okasplaunchpad/contract)。部署基线为 `13f0eaf031370a9de44f6a55501dbb3097a7a55a`，但该提交本身不包含全部 v5 改动；**以本目录实际文件及 `audit-manifest.json` 的校验值为准**。此快照来自部署时的冻结交付包，不是从持续变化的工作区直接复制。

## 审计哪些文件

| 文件（`src/mining/` 下） | 职责 |
| --- | --- |
| `soda/SodaIncentiveVault.sol` | 当前 v5 金库；收到挖矿 FAB 后拆为持币人 85%、国库 10%、LP 激励 5% |
| `soda/SodaVault.sol`、`soda/SodaRewards.sol` | 金库基类、矿机存取、份额增发与销毁、持币收益记账；是 v5 实际依赖，不能删除 |
| `FabxMinerCustody.sol`、`interfaces/IFabxMining.sol` | 矿机托管、准入检查和实际挖矿收益来源 |
| `soda/SodaIgnixPool.sol`、`soda/SodaPool.sol` | 兑换及加减流动性；本金与手续费分开 |
| `soda/IgnixLpRewards.sol`、`soda/RewardLedger.sol` | 接收 5% 激励和池内份额产生的 FAB、LP 的 OKB 手续费；历史收益不随 LP 转移 |
| `soda/IgnixTreasuryIncome.sol` | 平台 30% OKB 手续费记账及固定国库收款 |
| `soda/SodaPolicy.sol` | 操作开关、赎回产品费、服务费和国库配置 |
| `soda/SodaLocker.sol` | LP 锁仓及锁仓收益归属 |

`vendor/` 仅包含这些源码和测试实际导入的依赖。OpenZeppelin 为 5.4.0，forge-std 固定提交见 manifest；原 SPDX 和许可保留。`test/` 是测试夹具，不是待部署合约。

## 地址与资金路径

| 合约 | 196 测试地址 |
| --- | --- |
| Pool / LP | `0x6DB7Bb086C285FBE3eB6005C30eaED8c77db4506` |
| Vault / sFAB | `0x77D94C4c34F1E67621aD94Aa20a697E3544aB726` |
| REWARDS | `0x7F2b9c85592E8C5d73d198565056Af79b22E49ef` |
| INCOME | `0x1c9fff7466EAAE3702bdDe1cCF239946b7b434Fb` |
| Policy | `0x57d4Fb4F98fe8beD34dA997bE11dE6Dd25546085` |
| Locker | `0xAe8A0C13921416E673b7c27Ea3E997043398811F` |

完整 ABI、外部 FAB／矿机／挖矿合约和起始区块见 [deployment/integration-v5.json](deployment/integration-v5.json)。测试管理员和国库为 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`。

兑换手续费以 OKB 侧金额的 0.5% 计算，其中 30% 进入 INCOME 归国库、70% 进入 REWARDS 归 LP。金库挖矿收益的 85% 按份额币归属分配，其中池子持币获得的 FAB 进入 REWARDS；另有 5% 直接注入 REWARDS，均按收益记账时的 LP 份额领取。10% 服务费记在 Policy。赎回产品费是每单位基础权重 `1e12 wei OKB`。加减池子本金不包含这些已分离收益。

以上记账和领取需要交易触发；合约不会按时钟自行运行。本快照不包含“每 10 分钟收取”或“每日 02:00 满 1 USD 派发”的后台任务，也不据此承诺自动到账。旧测试池及旧债务是另一代地址，不与本目录混账。

## 离线复现

需要 Foundry（forge/cast）、Python 3 和精确的 Solidity `0.8.26+commit.8a97fa7a`。依赖已按导入范围收录，无需安装根前端 monorepo，也无需 RPC、钱包或 `.env`。

```sh
# 从仓库根目录执行；--solc 指向你自己的精确版本编译器。
python3 contracts/sodadex-fragments/verify.py --solc /path/to/solc-0.8.26
forge test --root contracts/sodadex-fragments --use /path/to/solc-0.8.26 --offline
forge build --root contracts/sodadex-fragments --use /path/to/solc-0.8.26 --offline --sizes
forge lint "$PWD/contracts/sodadex-fragments/src" --root contracts/sodadex-fragments --use /path/to/solc-0.8.26 --offline --severity high
forge fmt --root contracts/sodadex-fragments --check
```

`verify.py` 检查源码、依赖和冻结产物的 SHA256，并把每个部署输入文件的 Keccak 与冻结 artifact metadata 对照。指定 `--solc` 后，它使用部署时原始 source-unit 路径和设置重编译，逐一比较六个合约的 creation/runtime 模板字节码和 ABI。Foundry 测试编译使用本目录 vendor 路径，metadata 路径可能不同，不能直接拿该输出冒充部署模板。

`deployment/verification.json`、`public-journal.json` 是此前公开链验证证据，构造参数在 `constructor-args.json`。runtime 模板中的 immutable 值需要结合构造参数解释；模板复现不等于本次重新查链。测试结果不等于独立审计结论，也不代表已完成生产依赖验证。

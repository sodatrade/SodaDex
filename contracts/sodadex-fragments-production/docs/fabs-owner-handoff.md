# FABS：给 owner 的部署说明与 IGNIX 接入要求

2026-10-23。本轮交付独立 `FabsToken`、独立币池 `MirrorFabsPool`、测试和仅部署代币的脚本。**未执行链上部署，无新 CA。Owner 可以先部署零供应量 FABS；绑定金库前需完成同事的真实金库适配与联调。**

## 一、这次部署什么

| 项目 | 值／行为 |
| --- | --- |
| 网络 | X Layer，chainId 196 |
| 合约 | `src/mining/soda/FabsToken.sol:FabsToken` |
| 名称 / 符号 / 小数位 | FAB Miner Shares / FABS / 18 |
| 构造参数 initialOwner | `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A` |
| 初始供应量 | 0，无预铸 |
| 发行上限 | 没有配置数量上限；使用标准 uint256 算术 |
| 绑定权限 | 上述 owner 可调用一次 bindVault，必须是有代码、回报本 FABS 地址和正确版本的金库 |
| 增发 / 销毁 | 仅绑定的金库可以调用；owner 无直接 mint/burn 权限 |
| 后续管理 | owner 不可改，金库地址不可换，无升级、任意提币或黑名单入口 |

矿机准入、每台铸多少币、赎回应销毁多少由 IGNIX 金库负责；FABS 本身不查询矿机，也不证明金库真的持有矿机。金库必须完成相应审计和联调。若所绑定金库本身可升级，其业务仍受该升级权限影响；代币固定地址并不能限制外部金库升级。

独立 FABS 不自动迁移旧 sFAB，不关联旧债务，不创建 LP，也不会自动启动 harvest。

## 二、先在本机编译与预演

从 SodaDEX 仓库根目录进入：

```sh
cd contracts/sodadex-fragments-production
forge build --sizes
forge test --no-match-contract SodaFormalForkTest --summary
export FABS_OWNER=0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A
export RPC_URL=https://rpc.xlayer.tech
cast chain-id --rpc-url "$RPC_URL"
forge script script/DeployFabs.s.sol:DeployFabs --rpc-url "$RPC_URL" --sender "$FABS_OWNER"
```

应读到 chainId 196；无 `--broadcast` 的最后一条只预演。脚本拒绝非 196 链，要求显式设置非零 FABS_OWNER；只产生一笔代币部署，不绑定金库、不铸币、不转入 LP。固定编译器 0.8.26、优化 200 次、viaIR、Cancun，沿用仓库 vendored OpenZeppelin。

把预演的构造参数、部署发送者、nonce、预计 Gas 和当前 Gas 单价核对后再广播。不要用旧测试批次预算。若 RPC 失败，不能当作模拟成功。

## 三、由 owner 广播并取实际 CA

用本机已配置的 Foundry keystore 账户名设置 SIGNER_ACCOUNT，不在命令里写私钥。部署者可与 initialOwner 不同，但绑定交易必须由 initialOwner 发起。

```sh
# SIGNER_ACCOUNT 由 owner 设置为本机已有 keystore 账户名。
forge script script/DeployFabs.s.sol:DeployFabs \
  --rpc-url "$RPC_URL" --account "$SIGNER_ACCOUNT" --broadcast
```

保存 `broadcast/DeployFabs.s.sol/196/run-latest.json` 中的交易哈希、构造参数与实际 contractAddress。确认成功回执和部署地址代码后，将真实 CA 填入 FABS_CA，再核查：

```sh
cast code "$FABS_CA" --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'name()(string)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'symbol()(string)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'decimals()(uint8)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'owner()(address)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'vault()(address)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'totalSupply()(uint256)' --rpc-url "$RPC_URL"
```

期望：名称/符号/精度与上表一致；owner 为指定地址；vault 为零地址；totalSupply 为 0。CA 从成功回执取，不把预测地址当部署结果。若广播状态不明，先查询原交易与 nonce；不要直接重复部署。

导出 ABI：

```sh
forge inspect src/mining/soda/FabsToken.sol:FabsToken abi > FabsToken.abi.json
forge inspect src/mining/soda/interfaces/IFabsVault.sol:IFabsVault abi > IFabsVault.abi.json
forge inspect src/mining/soda/MirrorFabsPool.sol:MirrorFabsPool abi > MirrorFabsPool.abi.json
```

ABI 的仓库副本在 [abi/](abi/)。源码验证需用同一提交和编译设置，构造参数只有 initialOwner；区块浏览器未验证前，不把 ABI 上传成功称作源码验证成功。

**到这里可先把 FABS CA 给同事，金库保持未绑定。** 未绑定时无法 mint/burn，转账也会回滚；approve 是标准 ERC20 授权，不能凭授权生成余额。

## 四、同事改好金库后再绑定

同事对接接口见 `interfaces/IFabsVault.sol`：

```solidity
function FABS() external view returns (address);
function FABS_HOOK_VERSION() external view returns (bytes32);
// 返回 keccak256("SodaDEX.FABS.VaultHook.v1")
function beforeFabsTransfer(address from, address to, uint256 amount)
    external returns (bytes4);
// 成功返回 IFabsVault.beforeFabsTransfer.selector
```

金库不能再把自身当作 ERC20 份额币：

1. 矿机 deposit 完成准入和收取后，按原业务公式调用 `FabsToken.mint(user, shares)`；赎回完成有效申请、确认期和锁定检查后调用 `burn(user, shares)`。burn 仅金库可调，不使用用户 ERC20 allowance，与原内部 _burn 一致。
2. 所有份额 balanceOf、totalSupply 改读 FABS；FAB 挖矿收益币保持原引用。原来的 share transfer/approve 页面与索引改为 FABS CA。
3. `beforeFabsTransfer` 只允许 FABS CA 调用。它必须读取**变化前**余额，检查锁定份额，先 checkpoint，再 settle(from/to)。覆盖 mint 的 from=0、burn 的 to=0、自转和零额转账；不得让任何分支跳过应有结算。
4. 金库原有 deposit/redeem 若带 nonReentrant，预期链路是“金库 → FABS → 金库 hook”。不能在 hook 上重复同一个锁导致所有 mint/burn 失败；hook 应鉴权并调用内部结算逻辑，防止外部业务入口重入。FABS 自身对全部余额更新设置同一重入锁。
5. 回调 revert、错误返回值或重入失败，FABS 余额、供应量、allowance 及同笔金库状态一起回滚；禁止吞掉结算失败再返回成功。
6. 池内份额变更前的历史 LP checkpoint、周期关闭和两笔 FAB 注入仍按 [历史 LP 收益接口](mirror-lp-rewards-integration.md) 实现，不能因拆分代币省略。

本轮金库测试替身用于验证调用顺序，**不可部署为业务金库**。真实 IGNIX 金库不在本轮改写范围内。

金库部署并确认上述逻辑后，owner 检查 `FABS()` 指向本次币、版本正确、字节码与已联调版本一致，再执行一次性绑定：

```sh
cast call "$VAULT_CA" 'FABS()(address)' --rpc-url "$RPC_URL"
cast call "$VAULT_CA" 'FABS_HOOK_VERSION()(bytes32)' --rpc-url "$RPC_URL"
cast call "$FABS_CA" 'HOOK_VERSION()(bytes32)' --rpc-url "$RPC_URL"
# 上面返回匹配，且真实金库业务测试完成后：
cast send "$FABS_CA" 'bindVault(address)' "$VAULT_CA" \
  --rpc-url "$RPC_URL" --account "$OWNER_ACCOUNT"
cast call "$FABS_CA" 'vault()(address)' --rpc-url "$RPC_URL"
```

OWNER_ACCOUNT 必须能代表上述 initialOwner 签名；若 owner 是合约钱包，由其钱包执行同一调用。不要使用“部署者账户”代替 owner。绑定不可撤回，不接受 EOA、零地址、token 自身、错误 FABS 指针或版本。

## 五、SodaDEX 使用新池，不把 FABS 当金库传入

使用 `MirrorFabsPool(SodaVault vault, address treasury)`。ABI 中 vault 是地址，实际传新 IGNIX 业务金库，不要求它继承 SodaVault 或 ERC20。新池读取：

- `VAULT()`：业务金库。
- `SHARES()`：从金库 FABS() 取得的独立币，用于余额和 transfer/transferFrom。
- `FAB()`：收益币。
- `REWARDS()` / `INCOME()`：池构造时创建的奖励和平台收入合约。

新池拒绝未绑定到该金库的 FABS；金库还须提供 POLICY、FAB、totalEligibleWeight、无参 harvest、LP_REWARDS_VERSION 和 openEpoch=1。Owner 的新部署次序是：**FABS → 金库 → owner 绑定 FABS → MirrorFabsPool → 完成金库/池初始化核验 → 开放业务**。若金库构造参数预设池地址，预测 nonce 必须包含中间绑定交易；不可照搬旧脚本 nonce。

旧 SodaPool/MirrorSodaPool 默认 SHARES=VAULT，旧一体式金库行为不变。此次未修改前端地址配置，前端接入独立币时要分别使用 FABS 与金库 CA。

## 六、验证证据与已知边界

独立 FABS 与分离地址池的 20 项针对性测试通过，包含两个 256 轮 fuzz；其中覆盖权限、不可重绑、失败回滚、授权转移锁定份额、回调重入、旧余额结算、双向兑换、加减 LP、历史收益保留以及部署脚本链检查。完整生产合约包 57 项测试通过、0 失败、0 跳过，其中包含 3 项正式 FABX fork；编译和高严重性 forge lint 通过。

真实 IGNIX 新金库尚待同事适配与联调；已有正式 FABX fork 测试验证原有路径，不能替代新金库端到端证据。旧 SodaLocker 更换 beneficiary 的延迟收益问题仍按历史接口文档处理，本次没有改其业务规则。

本轮不发送任何交易，不产生 CA，不修改主网已有实例。Owner 部署后交付：实际 CA、交易哈希、回执、owner/vault/supply 核验、源码提交、ABI、实际 Gas 支出与绑定状态。

静态检查：Slither 直接 solc 编译完成 token 扫描；回调后更新余额的告警对应设计要求，所有余额更新都受同一 nonReentrant 保护，恶意回调回归通过；依赖 pragma/命名/未用辅助函数告警未修改 vendor。Aderyn 0.6.8 在解析外部 vendor 的 AST 时 content not found 崩溃，不能称该项检查通过。

池继承树的 Slither 扫描也已执行；输出包含未改动托管合约、OpenZeppelin 数学库及已有分红代码的告警，不作为本轮已完成整套业务审计的结论。此次逐项核查新增 token hook、绑定权限、池 SHARES 引用与旧池兼容路径，未修改依赖或扩大托管业务范围。

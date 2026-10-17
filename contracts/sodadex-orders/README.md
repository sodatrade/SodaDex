# SodaDEX 测试限价结算

此目录提供链 196 的不可升级结算合约源码与本地验收；尚未部署至公开 X Layer。`protocol.json` 是签名格式，`abi.json` 由源码生成。实际地址应来自之后独立确认的部署记录，不能使用本地 Anvil 的合约地址。

Maker 明确包装 OKB 后，以 ERC-20 向 Permit2 授予本单所需额度，再签署完整 `PermitWitnessTransferFrom` typed data。`spender` 是结算合约，`witness` 包含网络、结算地址、Maker、交易资产、完整金额、收款人、nonce、用户填写的到期时间和完整池标识。使用 `orderDigest` 对照客户端签名摘要；事件中的 `orderHash` 是 `hashOrder` 的结构摘要。

Keeper 只调用 `execute(order, signature)`。结算合约验证自己的固定 Factory/PoolManager 中的池，签名拉取全额输入，通过固定 Router 单跳成交，将全部新输出交给签名收款人，并核对实际输入扣款与实际输出到账。它不提供任意 target/calldata、部分成交、平台收费、管理员提款或升级。V4 仅支持无 Hook 池。原生输入不支持；原生输出支持。

`cancel(nonce)` 必须由 Maker 发起链上交易。`nonceStatus` 为 0 未使用、1 已取消、2 已成交；到期由区块时间判断。成功或取消均不可重放；成交失败回滚 Maker 资产和两层 nonce。数据库标记取消不能替代链上取消。

V3 使用 `V3_SWAP_EXACT_IN`，原生输出再执行 `UNWRAP_WETH`；V4 使用 `V4_SWAP` 和 `SWAP_EXACT_IN_SINGLE / SETTLE_ALL / TAKE_ALL`。付款人为结算合约；它自行设置精确有限的 ERC-20/Permit2 Router 额度，完成后清零。Maker 原有的 Router allowance 无法替代本次 witness 授权。

## 本地检查

先在仓库根目录准备公开测试依赖与真实 Permit2 runtime：

```sh
python3 scripts/sodadex/build-orders-fixtures.py --state <owned-local-rehearsal.json> --forge-std <pinned-forge-std-folder>
python3 scripts/sodadex/build-orders.py --solc <solc-0.8.26>
forge test --root contracts/sodadex-orders --use <solc-0.8.26> --offline
forge lint --root contracts/sodadex-orders --use <solc-0.8.26> --offline
forge fmt --root contracts/sodadex-orders --check
```

真实协议集成使用已有的 owned Anvil helper，Node.js 22，和 `standalone/web` 的 Viem 依赖：

```sh
SODADEX_LP_FORK_STATE=<owned-local-rehearsal.json> SODADEX_LP_STATEVIEW_CODE=<stateview-runtime.json> node --experimental-strip-types contracts/sodadex-orders/test/integration.mjs
```

`test/fixture.mjs` 导出 `startOrderFixture`，用于服务联合验收。它产生仅在内存中的临时账户，启动并校验自有 localhost Anvil，加载快照、部署结算合约，显式包装本地测试 OKB，并建立 ERC-20 V4 池。调用方必须在 `finally` 执行 `fork.stop()`。它没有外部 RPC URL 参数，不读取现有钱包，也不广播真实链交易。

验收记录写入忽略目录 `.analysis/orders/`：Foundry 分支测试、256 次金额模糊测试、4096 次状态不变量调用；另有真实 SodaDEX V3/V4 的 ERC-20/原生输出、重放拒绝、限价失败回滚和取消验证。实际链部署、正式 keeper 运行、服务持久化与前端钱包流程需各自提供证据，不能由这些合约测试推定完成。

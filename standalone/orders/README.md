# SodaDEX 本地订单服务

这是独立的 Node 22 服务，负责接收已签名限价单、保存订单、核对链上状态和运行 keeper。它使用自己的 SQLite 文件，不连接 IGNIX 数据库。当前测试合约部署地址仍为 `null`；默认可启动查询服务，但不接单、不签名、不广播。没有部署到 AWS、IGNIX 或公网。

## 启动和检查

要求 Node `>=22.22.2`，使用 Node 自带的实验性 `node:sqlite`。

```sh
cd standalone/orders
npm ci
npm run check
npm start
```

默认监听 `127.0.0.1:3031`，数据库为本包 `.data/orders.sqlite`。`GET /v1/status` 返回 `NOT_DEPLOYED`；提交订单返回 503。这是真实部署状态，不是已接入生产服务的占位成功。

| 配置 | 默认值与约束 |
| --- | --- |
| `ORDERS_DB_PATH` | 专用 SQLite 路径；拒绝已有的非本服务数据库、符号链接和其他用户可读写的文件 |
| `ORDERS_PUBLIC_ORIGIN` | `http://127.0.0.1:3031`；显式 HTTPS origin 或 localhost/127.0.0.1 HTTP origin |
| `ORDERS_PORT` | `3031`；始终只监听 127.0.0.1 |
| `ORDERS_POLL_MS` | `10000`；最小 1000，运行只读核对及 keeper 周期 |
| `ORDERS_RPC_URL` | 固定 `https://rpc.ignix.bot/rpc/196`；API 请求不能更换 RPC |
| `ORDERS_LOCAL_TEST` | 默认关闭；开启后 RPC 只能为 `http://127.0.0.1:端口/` |
| `ORDERS_LOCAL_SETTLEMENT` | 只在本地测试模式接受；必须是实际部署的测试 settlement |
| `ORDERS_GAS_BUDGET_WEI` | 默认 `0`；启用执行必须显式配置正整数累计 gas 预算 |
| `ORDERS_EXECUTION_ENABLED` | 默认关闭；CLI 拒绝开启，执行需程序显式注入 signer |

远程 settlement 当前没有已审核的部署地址。即使提供环境变量，本实现也不会在远程自动启用订单执行。未来上线需要同时更新部署配置、固定合约校验和对应验收。

## 数据流和职责

`server.ts` 限制来源、JSON 请求大小和公开字段；`service.ts` 使用共享 `order-types.ts` 验证订单字段、Permit2 域、签名及 nonce。`chain.ts` 只调用固定 SodaDEX 合约，使用链上时间核对到期，EOA 与 ERC1271 签名都经验证；固定区块的读取完成后再次核对区块哈希。

`store.ts` 保存 maker/nonce 唯一的订单和独立执行记录。订单签名、已签交易和原始交易仅保存在本服务的私有 SQLite 文件中，公开 API 从不返回这些字段。主数据库要求 0600，新目录默认 0700，WAL 使用 SQLite 的同目录权限；备份应在关闭服务后复制整个数据库，或使用一致性 SQLite 备份，不要只复制仍在运行的主文件。当前 schema 为 v2；启动时对本服务 v1 数据库进行增量迁移，保留所有订单、签名和执行记录，只增加 keeper nonce 证据表。

`keeper.ts` 先核对链上 nonce，再原样模拟 `execute(order, signature)`。未达到签名最低到账时保留 `open/awaiting_price`。模拟不通过不签名、不广播，也不降低最低到账。实际执行只接受调用方注入的 `ExecutionSigner`；不读取任何钱包文件、助记词或私钥环境变量。maker 仅需对 canonical Permit2 进行明确的 ERC20 输入金额授权，keeper 钱包只支付 gas。

执行顺序为：获得 SQLite 独占 keeper guard → 模拟 → 校验累计 gas 预算 → 签名 → 验证签名交易的 chain/to/data/value/nonce/gas → 将 hash 和原始交易持久化 → 广播。发生广播超时或进程重启后，先查原 hash 的回执，必要时只重发相同原始交易。即使 maker 已取消、到期或被其他 keeper 成交，已保存的原始交易仍会在既有预算内重播，通常以 revert 回执消耗该 keeper nonce，再继续后续队列。存在未解决的交易时不会盲目生成新交易，也没有自动加价或替换交易。

若缺少原 hash 回执但经区块哈希核对的链上 confirmed keeper nonce 已越过该交易，服务持久化该区块和 nonce 证据后结束等待；不使用 mempool pending nonce 推断已经成交，也不假设原交易实际费用为零，仍保留其 gas 上限计入累计预算。

| 状态 | 依据和恢复 |
| --- | --- |
| `open` | 合约 nonce 为 0 且未到期；reason 说明价格、模拟、预算或执行关闭 |
| `pending` | 原始交易已写入本地数据库；`broadcast_unknown` 表示无法确定节点是否接收 |
| `filled` | 已核对的成功回执及完整 OrderFilled 字段，或合约 nonce 为 2 |
| `cancelled` | maker 在 settlement 调用 cancel 后，合约 nonce 为 1 |
| `expired` | 观察到的区块时间达到订单 expiry |

HTTP 删除不会取消订单。撤单需要 maker 钱包链上确认。重发相同订单不会替换签名或直接覆盖终态；同 maker/nonce 的不同订单被拒绝。链上核对使用独立的 store 路径：先核对当前 snapshot 和旧 observation 的区块哈希，再按 canonical nonce/区块时间恢复因重组失效的终态。旧区块不足以证明时，当前 nonce 为 0 的订单仍以 `open/chain_unavailable` 保留可恢复、可取消入口。列表轮询也会刷新该页终态记录。若曾成交的自身交易因重组失效，服务先恢复其原始交易，不盲目签一个替代交易。

Permit2 nonce 是 maker 的全局 bitmap；若它已被其他用途消耗，而本 settlement nonce 仍为 0，订单保持 `open/nonce_unavailable`。maker 仍能链上取消，keeper 不再模拟或签名该订单，也不会将其误标为已成交。

暂停执行也会暂停接收新订单：已部署地址仍保留，状态返回 `EXECUTION_PAUSED`。既有订单可查询、幂等重提，并继续核对 maker 已完成的链上撤单和到期。暂停不会删除订单记录或伪装成合约尚未部署。

gas 预算按本数据库所有执行累计：未确认交易保留 `gas × gasPrice` 上限，确认后记实际 `gasUsed × effectiveGasPrice`。重启会保留累计用量。单个数据库同一时刻只允许一个 keeper 周期；跨主机多实例和外部使用相同 keeper 钱包不在本地服务支持范围内。若原交易长期未确认，服务会停留等待状态；应先核查原 hash，不要删除数据库强制重新签名。

## 本地执行注入

应用程序通过 `validateConfig`、`OrderStore`、`ViemOrderChain`、`OrdersService` 组合服务，再把受控 signer 注入 `new OrdersKeeper(config, store, chain, signer)`。接口见 `src/chain-types.ts`。signer 只收到精确的 `ExecutionPlan`，返回已签名原始交易；keeper 会重新恢复发送者并核对所有字段。不能将任意 HTTP 请求转换为 signer 调用。真实执行配置必须显式给定 `executionEnabled: true`、正 gas 预算及已核验的 settlement。

## 实际合约集成测试

`test/integration.mjs` 复用 `contracts/sodadex-orders/test/fixture.mjs`，创建本进程拥有的 Anvil、临时 maker/keeper 钱包和临时私有数据库。测试只接受本地 snapshot 文件，运行结束会停止该 Anvil；没有真实链广播路径。

```sh
SODADEX_LP_FORK_STATE=/绝对路径/owned-state.json \
SODADEX_LP_STATEVIEW_CODE=/绝对路径/stateview-code.json \
npm run test:integration
```

需先按合约包流程准备 `.analysis/orders/settlement.json`。分离工作树验收可用 `SODADEX_ORDER_FIXTURE_MODULE` 显式指定本地 fixture 模块文件。`SODADEX_ORDER_SERVICE_PROOF` 可把已脱敏的验收结果写入本地文件；不含签名、原始交易或密钥。

验收覆盖 V3/V4 的四种真实路由、receiver 实际到账和 maker 精确扣款；另覆盖广播成功但响应丢失后的数据库重启恢复、未达最低到账、maker 撤单、链上到期、终态幂等和 HTTP 敏感字段隔离。实际 Anvil `snapshot/revert` 会撤销已观察到的取消，验证同高度不同哈希后恢复 open 并成功成交；还验证取消前已保存但未发送的原始交易在重启后确实上链 revert，再让下一单成交。纯逻辑与 HTTP 测试运行 `npm test`；它们不等同于已上线验收。

公开接口见 [API.md](./API.md)。

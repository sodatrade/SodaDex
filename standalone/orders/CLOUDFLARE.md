# Cloudflare 测试订单后台

SQLite Durable Object 后台部署在 `sodadex-orders-test`，复用 Node 订单服务的策略和 keeper。结算合约、API 地址和执行开关以根目录 `deployments/orders-test.json` 为准；部署和验收记录见 `../../deployments/xlayer-test/orders-receipts.json`。只接入 X Layer 196 的 SodaDEX 测试合约，没有绑定正式域名、CI、cron 或 AWS。

## 调用和持久化

前端订单代理把 reviewed `apiOrigin` 指向此独立后台。公开路径保持 `/v1/status`、`/v1/orders` 和 `/v1/orders/:id`，字段见 `API.md`。Worker 只转发到一个固定 actor：`sodadex-orders:196:<reviewed settlement 小写地址>`，请求参数不能选 actor、RPC 或合约。暂停不改变地址，因此旧订单、原始交易和累计预算继续留在同一个 actor。

`src/repository.ts` 保存订单 SQL、nonce 唯一性、状态、原始交易、预算和轮询进度。`store.ts` 是 Node 适配器，保留 0600、专用数据库探测、v1→v2 迁移和 PID 锁。云端 `cloudflare/sql.ts` 把相同 repository 接到私有 DO SQL；同步消费 cursor，以 `storage.transactionSync()` 包住事务，不执行 SQL BEGIN。DO 使用 actor 互斥，不保存 Node PID 或文件路径。这符合 [SQLite DO API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) 的事务和 cursor 约束。

`src/http.ts` 是两种运行环境共用的 HTTP 校验和错误边界。`service.ts` 与 `keeper.ts` 只有一份验签、最低到账、撤单、重组和恢复策略。DO 在广播之前等待 `storage.sync()`；重启恢复仍只使用已保存的 raw transaction 和 hash，不因换运行环境重新签名。

预算总额用十进制 BigInt 字符串持久化，预留、回执费用和重组恢复在同一 SQL 事务内调整。正常运行不再逐次读取全部历史执行记录来计算预算。旧 Node 数据库首次升级会按原执行记录初始化该总额；升级前应停止旧 Node 进程，不混跑旧写入器。

## Alarm 和平台边界

云端每次 alarm 最多处理一条待恢复 raw 或一条候选订单；已有 raw 优先。候选订单的游标保存到 SQL，未到价的第一单不会让后续订单一直得不到检查。只有存在 open/pending 订单或未解决 raw 时才设置下一次 alarm；空队列不运行 setInterval。轮询间隔来自显式 `ORDERS_POLL_MS`，配置中的 10000ms 是测试轮询参数，不保证成交时间。

一个请求或 alarm 最多发出 45 次固定 RPC 调用，超额停止调用。列表每次最多刷新 6 条，按 maker 持久轮询该页，其余返回原 observation，后续轮询继续更新；指定单单 GET 可单独刷新。HTTP 返回的每条 observation 才是对应的观测区块，不能把整页当作同一时刻的完整链快照。

Alarm 可能被平台重试；幂等存储、原 hash 恢复和 actor 互斥处理重复触发。暂时 RPC 失败保留待办和 raw，再按显式间隔安排下一次检查。平台本身仍有 CPU、请求、存储及重试限制；本地验证不等于 Cloudflare 账户额度或远端性能验证。[Alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/) 说明其至少一次执行语义。

## 配置

入口为 `cloudflare/index.ts`，配置为 `cloudflare/wrangler.test.jsonc`，Worker 名称 `sodadex-orders-test`。只有 `workers_dev` 和测试 SQLite DO migration；没有 production route、custom domain、cron、CI 或 D1。

| 输入 | 作用和关闭条件 |
| --- | --- |
| 根 `deployments/orders-test.json` | 唯一 reviewed settlement；chain 196、test、ready 和 executionEnabled 都必须符合。任何 secret 都不能越过 reviewed 地址和开关 |
| `ORDERS_PUBLIC_ORIGIN` | 明确的浏览器 origin；当前为已有测试前端 URL |
| `ORDERS_POLL_MS` | 显式 alarm 间隔，至少 1000ms；缺少时不安排 alarm、不启用执行 |
| `ORDERS_EXECUTION_ENABLED` | 必须明确为字符串 `true` 才可执行；必须与 reviewed 开关共同开启 |
| `ORDERS_GAS_BUDGET_WEI` | 明确的累计上限；重启或改环境变量不会抹掉已累计的费用和预留 |
| `ORDERS_KEEPER_ADDRESS` | 新建专用 keeper 的公开地址；不得用 owner |
| `ORDERS_KEEPER_PRIVATE_KEY` | 单独注入的 secret；必须匹配上述公开地址。代码不读取既有钱包或本地凭据，不写入 Git、日志、API 或验收 JSON |

缺少 key、预算、轮询配置或执行开关时，ready 合约仍保留地址并显示 `EXECUTION_PAUSED`。GET 和链上撤单状态仍可查询；暂停不是链上撤单，旧签名的实际撤销仍由 maker 调用合约。

## 本地运行和验收

使用现有 `standalone/worker` 的 Wrangler/esbuild/Miniflare 依赖，以及本包的 Node 22/viem。没有新增运行时数据库依赖。

```sh
npm --prefix standalone/orders ci
npm --prefix standalone/orders run check
npm --prefix standalone/orders run test:cloudflare
npm --prefix standalone/orders run dev:cloudflare
```

`dev:cloudflare` 只启动本地 Wrangler；没有匹配 keeper Secret 时保持暂停。隔离验收显式替换构建中的 manifest，并将固定 RPC 拦截到 owned Anvil。需要原有 snapshot、StateView 代码和经 SHA256/区块核对的真实 fee oracle fixture：

```sh
SODADEX_LP_FORK_STATE=/绝对路径/owned-state.json \
SODADEX_LP_STATEVIEW_CODE=/绝对路径/stateview-code.json \
SODADEX_ORDER_FEE_ORACLE_FILE=/绝对路径/fee-oracle-fixture.json \
npm --prefix standalone/orders run test:cloudflare:integration
```

需要合约包的已编译 `.analysis/orders/settlement.json`。分离工作树可设置 `SODADEX_ORDER_FIXTURE_MODULE` 指向同机 fixture 文件。验收只在构建内存中覆盖 manifest，且把固定 RPC 拦截到本进程拥有的 Anvil；没有改根 manifest、外部广播或远端资源。`SODADEX_ORDER_DO_PROOF` 可输出脱敏证明。

验收使用真实 Miniflare/workerd 和磁盘 SQLite DO，先让 alarm 保存原始交易，再销毁整个 runtime，以同一持久目录重启。随后验证暂停、预算保留、同 hash 成交、签名只调用一次、实际 receiver 到账、空队列停止和 API RPC 上限。测试 signer 调用计数只存在于测试 esbuild instrumentation 中；没有产品诊断或签名接口。

## 更新测试部署

更新前核对明确的 Cloudflare 账户和测试 Worker。保持原 SQLite migration、actor 和 Secret，不重建数据库或钱包。需要链上操作时，先核对该阶段累计 gas 台账；keeper 转账金额和 gas 费用分别记录。SQLite DO 可用于 Free 和 Paid 计划，但计算、alarm 请求、SQL 读写和存储受账户额度及计费约束；不能据此承诺当前账户免费。[官方价格说明](https://developers.cloudflare.com/durable-objects/platform/pricing/) 是核对依据。

可先在审核允许的本地 CLI 环境验证打包，仍不会上传：

```sh
CLOUDFLARE_SEND_METRICS=false node standalone/worker/node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir standalone/orders/.data/cf-bundle --config standalone/orders/cloudflare/wrangler.test.jsonc
```

发布为手动 Wrangler 部署；本地 workerd 验证不代替公开 API 和真实链上回执验收。

1. 完成并审核测试 settlement 部署，记录实际地址及 deploymentBlock；更新根 reviewed manifest，初次仍设 executionEnabled=false。
2. 在 `wrangler.test.jsonc` 保持执行关闭和预算 0，核对 `ORDERS_PUBLIC_ORIGIN`。部署固定测试 Worker，记录 Cloudflare 实际返回的 workers.dev URL：

   ```sh
   node standalone/worker/node_modules/wrangler/bin/wrangler.js deploy --config standalone/orders/cloudflare/wrangler.test.jsonc
   ```

3. 只把新建专用 keeper 的公开地址写入配置，私钥通过交互 secret 输入，不把值放命令参数、命令历史或文件：

   ```sh
   node standalone/worker/node_modules/wrangler/bin/wrangler.js secret put ORDERS_KEEPER_PRIVATE_KEY --config standalone/orders/cloudflare/wrangler.test.jsonc --name sodadex-orders-test
   ```

4. root 审核显式累计预算及轮询参数后，才允许同时打开 reviewed manifest 和环境执行开关。把根订单 manifest 的 apiOrigin 设为已验证后台 URL，并由 root 单独更新前端代理，再发布测试前端。
5. 先查 status 的 chain/settlement/readiness，再以已批准的微量测试单验收。检查订单 observation、同 hash 回执、实际到账及跨重启累计预算；失败保留数据库和原 hash，不删除原始记录强行重签。

## 暂停与回退

需要停止新单和执行时，保持同一 settlement 和 actor，把执行开关关闭；不要删除 DO namespace、migration、数据库、预算或 raw。暂停仍可查询订单和 maker 已完成的链上取消。回退到上一个已验证的 Cloudflare Worker 版本时保持类名、binding 和 SQL 数据兼容；Node CLI 入口不能作为云端回退版本。

更换 settlement 会使用另一个固定 actor。本波不实现跨合约订单迁移；更换前应保留原部署的读取入口并单独审核旧订单的处理。没有提供任意 actor 查询或 HTTP 删除订单的入口。

## 本阶段费用边界

本阶段总 gas 上限为 0.0002 OKB：owner 操作最多 0.0001，keeper 累计最多 0.0001。专用 keeper 的初始 gas 资金最多 0.0001 OKB；资金转移本身不重复记为已消耗 gas。SQLite 保存 keeper 已用费用与 pending 交易预留，Worker 重新部署不会归零。签名前、每次广播/恢复前和历史回执核算时，均核验固定 X Layer fee oracle 实现及 L1/operator 附加费用为零；模型不符就保留原交易及预留并停止执行。不得通过改配置重置已花费用或增加预算。

停止执行时同时把 reviewed manifest 与 `ORDERS_EXECUTION_ENABLED` 设为 false，保留地址、读取入口和 DO。订单签名的链上撤销仍须 maker 调用 `cancel(nonce)`。

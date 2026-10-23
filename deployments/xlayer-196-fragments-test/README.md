# IGNIX 接入 SodaDEX：新版独立测试合约

**当前状态：新版已部署到 X Layer 196 独立测试环境，测试站已接入。生产合约未改动。** 同目录 `integration.json` 包含真实地址、ABI 和测试依赖。

测试站：https://sodadex-preview.jsmsdx2025.workers.dev

| 合约 | 196 测试地址 |
| --- | --- |
| SodaPolicy | `0xb678a4b26ba091d6eeb3aaa85d6abd6afc794937` |
| SodaVault | `0xb97d23f0c874fc1380016fa31d975d7ccd13b94d` |
| SodaPool | `0x6366dba62dd679de99078819c212b1fdd431a953` |
| IgnixLpRewards | `0xbBD5ce08aFa04D173982585E0cFC75194eAe3900` |
| SodaLocker | `0xf9851d7a14ce5cd681aa2e639d8fa0def63bb7fe` |

## SodaDEX 与 IGNIX 分工

SodaDEX 只负责 OKB／sFAB 兑换，以及 LP 流动性的添加、移除、查看。“我的”只显示钱包资产与 LP 本金。矿机质押、金库、国库、分红领取、LP 收益领取和 Locker 的业务入口由 IGNIX 负责。下面列出的其它合约是 IGNIX 接入地址，不是 SodaDEX 新增功能。

## 各地址用来做什么

| 合约 | 用户做什么 | 谁接入 |
| --- | --- | --- |
| `SodaPool` | 用 OKB 买卖 sFAB；加入或撤出流动性。这个地址也是 LP 代币地址 | SodaDEX；IGNIX 可复用接口 |
| `SodaVault` | 存矿机获得 sFAB，销毁份额赎回矿机，领取持币产生的 FAB 收益。这个地址也是 sFAB 代币地址 | IGNIX |
| `IgnixLpRewards` | 领取 LP 累积的 OKB 手续费和 FAB 收益 | IGNIX |
| `SodaPolicy` | 记录并领取平台手续费、赎回费和挖矿服务收入 | IGNIX 国库 |
| `SodaLocker` | 锁定项目方 LP 60 天；锁定期间仍可领取收益 | IGNIX |

国库收款钱包与 `SodaPolicy` 合约是两个不同地址。正式环境的国库和 Locker 受益人需在生产部署时单独配置。

## LP 怎样收到钱

每笔兑换收取 0.5% OKB 手续费，其中 30% 记入国库，70% 记入 LP 收益合约。买入时从支付的 OKB 中扣，卖出时从换出的 OKB 中扣。LP 收益与可撤出的池子本金分开。

池子持有的 sFAB 也会获得 FAB 分红。调用 `SodaPool.harvest()` 后，这部分收益进入 LP 收益合约，按 LP 持仓结算。矿机收益中的 5% 给 Soda、10% 为服务费、85% 给份额持有人；这里没有把额外 5% 自动发给 LP。

IGNIX 的领取流程：

1. 从 `SodaPool.REWARDS()` 获取收益合约，核对其 `POOL()` 等于目标池子。
2. 需要更新尚未结算的 FAB 时，调用池子的 `harvest()`；交易 gas 由发起人支付。
3. 调用收益合约的 `claimable(用户地址)`，依次得到可领 FAB、OKB。
4. 调用 `claimFor(用户地址)`，资金直接到该用户地址；调用人不能另填收款地址。

撤出全部 LP 后，旧收益仍然保留，可以继续领取。增减和转让 LP 会先结算旧持有人的收益；后来买入 LP 的人不会拿走旧收益。已结算收益的领取不依赖再次挖矿成功。

锁在 Locker 的 LP 要通过 Locker 领取并结算给受益人，不能当作用户钱包中直接持有的 LP 处理。

## 流动性怎样接

- 加池：有限额度授权 sFAB 给 Pool，再调用 `addLiquidity`，随交易附带原生 OKB。传入最低接受数量和截止时间。
- 撤池：调用 `removeLiquidity`，同时填写最低拿回的 sFAB／OKB 数量和截止时间。
- 加减流动性不收业务手续费；用户仍支付链上 gas。
- 初始价格由第一笔加入的 sFAB 与 OKB 比例决定。矿机存入时不强制配 OKB。

FAB 的小数位需从实际代币读取；sFAB、LP 和原生 OKB 为 18 位。金额计算使用整数，页面显示数字不能直接作为全额撤出的数量。

## 196 测试预算与执行记录

本阶段批准总上限 **0.0005 OKB**：gas 最多 0.00049，非 gas 支出最多 0.00001；最高 gas 单价 0.03 Gwei。部署前已按最终签名地址与 nonce 完成分叉预演。

公共链部署及业务验收共 21 笔成功交易，gas 为 **0.000312084549 OKB**，非 gas 累计支出 **0.0000080001 OKB**，合计 **0.000320084649 OKB**。随后测试站网页完成两笔真实钱包兑换，总支出最终为 **0.000353092150 OKB**，其中 gas **0.000345091950 OKB**、非 gas **0.000008000200 OKB**。详见 `release-evidence.json` 和 `public-browser-journal.json`。回收本金不会重置支出额度。

NFT #5 基础算力为 6，赎回费实际支付 **0.000006 OKB**。最终池内注入 **3,000 sFAB + 0.000001 OKB**，项目方 LP 已锁定 60 天。该流动性仅用于微量测试。

公共链回执见 `public-journal.json`。旧版地址和旧分叉记录不能作为本次接入地址。

## 已验收与尚未完成

- 本地浏览器已执行加池、双向兑换、追加和部分／全部撤出；合约集成已核对领取收益、费用分配和矿机赎回。
- IGNIX 页面另行安排，本轮只提供合约和 SodaDEX。
- 196 已完成部署、存矿机、建池、双向兑换、全部撤池、LP 收益领取、持币收益领取、矿机赎回、国库领取和重新建池锁仓。生产合约未改动。
- 新池行情通过 Cloudflare Durable Objects 的 SQLite 持久化，从部署区块逐段同步 `Swapped` 成交。页面只读 `/api/fragments/market`，不再自行扫描链上日志。
- 后台持续校验区块并同步新成交；发生回滚时移除相关记录并使旧分页失效。RPC 暂时不可用会保留已有记录，同时显示同步延迟。
- 历史成交每页最多 10 条，分页固定在同一索引快照。行情图展示最近 500 笔实际成交价格；更早的记录仍能翻页查看，不伪造没有发生的成交。
- 索引仅访问只读 RPC，没有签名或交易广播权限。测试站部署后首次预热从后台完成，后续刷新直接读取已保存的数据。

## 本地验证与发布

`npm --prefix standalone/web run typecheck`、`run lint`、`test` 检查前端；`npm --prefix standalone/worker run check` 检查后台。`node standalone/worker/test/fragments-index-runtime.mjs` 使用隔离 workerd + SQLite 验证 10／10／3 分页、进程重启保留历史、页面请求不扫描 RPC；所有上游响应均为测试夹具。

`node scripts/sodadex/fragments-196-release.mjs` 只读核实测试链地址并构建前端，不广播交易。发布使用 `standalone/worker/wrangler.fragments-196-test.jsonc`，目标固定为 `sodadex-preview`。本次不新增存储迁移，继续使用已有 `SodaChainIndex` 类，通过部署版本和池地址隔离新旧池数据。

# SodaDEX 测试前端

独立构建的 SodaDEX 界面，复用本仓库的 Mycelium 样式工厂。`web/` 保存界面、钱包连接状态和交易流程；`worker/` 提供静态文件及同源 RPC 代理。它不依赖上游缺失的 `tools/uniswap-nx`。

## 本地运行

使用 Node.js 22.22.2 或更新的 22.x，在仓库根目录执行：

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/worker ci --workspaces=false
npm --prefix standalone/web run build
npm --prefix standalone/worker run dev
```

访问 Wrangler 输出的本地地址（默认 `http://localhost:8787`）。开发界面也可独立运行 `npm --prefix standalone/web run dev`；Vite 会通过同源开发代理访问 Worker 的 RPC 校验入口，因此也需要启动 Worker。

```sh
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web test
npm --prefix standalone/web run build
npm --prefix standalone/worker run check
```

真实浏览器验收使用本机 `playwright-cli`。先启动本地站点，再在仓库根目录执行：

```sh
playwright-cli -s=sodadex-acceptance open http://localhost:8787
playwright-cli -s=sodadex-acceptance run-code --filename=standalone/acceptance/smoke.js
playwright-cli -s=sodadex-acceptance close
```

该脚本使用隔离的模拟钱包和模拟 RPC，覆盖 1440/768/390 宽度、全局和资产搜索、中英粤切换、货币偏好、默认白天主题与偏好持久化、协议选择、余额、切链、撤销授权和节点失败。切换偏好时会检查钱包、精确金额、资产方向与 V4 选择保持不变。它不会签名或发送链上交易；实际 RPC 连通性需另行验证。

## 本地 fork 兑换验收

`acceptance/fork-server.mjs` 只绑定 localhost，并验证 Anvil 进程 PID、客户端和 chain ID。它将实际编译的 Worker 读取入口接到该节点，钱包写入也仅转到这个 Anvil；不读取 keystore，不签名真实交易。前端/Worker 的部署清单必须指向该 fork 上实际存在的合约和池。

```sh
# 已有自己的 Anvil 进程，以及包含当前前端构建的 Worker dry-run bundle：
node standalone/acceptance/fork-server.mjs /absolute/path/index.mjs 18549 ANVIL_PID 4173
playwright-cli -s=sodadex-fork-ui open http://127.0.0.1:4173
playwright-cli -s=sodadex-fork-ui run-code --filename=standalone/acceptance/fork-swaps.js
playwright-cli -s=sodadex-fork-ui close
```

公开交易暂停时，该兑换验收也应被策略阻止。若需要复现历史兑换验收，应在独立本地 fixture 副本中显式启用策略并构建，不能修改当前发布分支的开关。脚本从界面连接模拟钱包、分别选择 V3/V4，提交各一次双向兑换。每笔核对成功回执、自有池 Swap 事件、扣除 gas 后的实际余额变化、输入数量、预览最低接收量和零 WOKB 残留。该证据属于本地 fork；真实链部署及兑换以公开回执为准。浏览器脚本限制地址为 `127.0.0.1:4173`，不能对线上网站运行。

## 本地 LP 验收

`web/tests/liquidityFork.test.ts` 包含 5 个真实 Anvil 用例，覆盖两种协议的仓位完整生命周期、新池初始化，以及 V4 待领取费用大于新增本金时的加仓。运行需要 Foundry `anvil` 和此前本地预演产生的 `owned-local-rehearsal` 状态快照；快照及 StateView runtime 是本地验收资料，不进入 Git。显式提供 fixture 后运行：

```sh
SODADEX_LP_FORK_STATE=/absolute/path/browser-fork-state.json \
SODADEX_LP_STATEVIEW_CODE=/absolute/path/lp-stateview.json \
npm --prefix standalone/web test
```

未提供状态快照时，这 5 项会跳过，不能据此声称完整 LP 集成验收通过。`tests/liquidityForkFixture.ts` 也可单独启动受控 Anvil，配合上文编译后的 Worker 和 `fork-server.mjs`，然后运行 `acceptance/liquidity.js`。浏览器脚本覆盖两个已初始化池的建仓、加仓、部分减仓后立即全部退出；新池初始化由前述 Anvil 用例验证。所有新交易只发生在自有本地进程，不读取部署钱包。

当前已发布源码、构建文件 hash、真实 RPC 读取和分层验收结果见 [`../deployments/frontend-test.json`](../deployments/frontend-test.json) 及其链接的证据文件。

## 测试发布

`worker/wrangler.jsonc` 只配置 `sodadex-preview` 的 `workers.dev` 地址。没有自定义域名、Cron 或自动发布 CI。人工发布前，先完成上述检查与浏览器验收，再运行：

```sh
npm --prefix standalone/worker run deploy:test
```

Cloudflare 凭证使用本机 Wrangler 登录状态，不进入源码或前端构建。静态资源只从 `web/dist` 上传。

当前测试地址为 [sodadex-preview.jsmsdx2025.workers.dev](https://sodadex-preview.jsmsdx2025.workers.dev)，版本记录保存在 [`../deployments/frontend-test.json`](../deployments/frontend-test.json)。正式域名暂未绑定。

浏览器读取 `/api/rpc`；Worker 用固定地址 `https://rpc.ignix.bot/rpc/196` 查询 X Layer。代理接受受限读取、自有 V3/V4 池报价，以及当前 PositionManager 的建池、仓位和有限授权模拟。行情及事件分页接口见 [`worker/API.md`](worker/API.md)。真实交易由用户的浏览器钱包签名与广播；代理不签名、不广播，也不接受任意上游地址。节点失败时前端显示连接失败，不回退到其他节点。

## 当前范围

这是 **X Layer 主网 196 上的测试界面**，OKB 是真实资产。SodaDEX 仓位 NFT 名称和原创 SVG 已部署，V3 WOKB/USD₮0（0.01%）与 V4 原生 OKB/USD₮0（0%）均已创建、注入少量流动性并完成真实双向兑换。当前 `pools.json` 保持 `ready`，只表示链上测试池已经核验。`standalone/trading-policy.json` 的 `publicSwapsEnabled=false` 独立暂停公开兑换：前端保留只读参考报价和预计接收数量，但不能创建新预览或提交新授权／兑换；已提交交易的链接、等待回执与再次检查回执功能保留。Worker 拒绝 Router 兑换及正金额 Router Permit2 授权的 `eth_call`／`eth_estimateGas`；LP 使用的有限 ERC-20／Permit2 授权单独开放。流动性页面支持自助创建池／仓位、追加、部分／全部减少和领取资产，所有写入均须用户钱包确认。V3 支持标准费率，V4 支持无 Hook 池。待领取资产可能包含已减仓本金，不冒称全部是手续费。报价、价格和池数据不使用虚构数值。前端不读取本机部署钱包。

界面支持简体中文、English 与粵語，新访客默认白天主题。语言、外观和 CNY/USD/HKD 展示货币保存在浏览器的 `sodadex.preferences.v1`；存储不可用时使用默认设置。展示货币只影响价格标签，池内相对价格、指定区块区间的交换轨迹和交易量来自实际链上状态／事件；当前没有独立法币估值，不会把 OKB 余额换算成法币，亦不虚构美元 TVL 或 APR。

`web build` 会生成首帧偏好初始化脚本及 `dist/preferences-script.json`。Worker 构建和检查会读取该脚本的精确 CSP hash，因此必须先构建前端，再检查或发布 Worker；两者应一起发布。

当前前端及 Worker 的合约地址统一读取 [`../deployments/xlayer-test/active.json`](../deployments/xlayer-test/active.json)，池就绪状态读取 `pools.json`。原始 `plan.json` / `receipts.json` 和已经完成的三笔交易记录 `pools-interrupted.json` 保留用于历史核验。当前地址已按品牌更新的真实回执切换；完整地址、NFT 图片及兑换回执见 [`ADDRESSES.md`](../deployments/xlayer-test/ADDRESSES.md)。本应用与保留的上游 `apps/web` 分开构建，独立检查通过不代表整个上游单体仓库检查通过。

重新开放公开兑换需要修改独立交易策略、运行就绪与暂停分支的回归和浏览器验收，再手动发布前端与 Worker。仅修改 `pools.json` 不会解除暂停。暂停前已经进入钱包确认窗口或已广播的交易不能由网站撤回。

## 核心 DEX 数据与操作

`#swap` 为两个已核验测试池的参考报价入口，公开兑换继续暂停；`#pools` 管理自有 Factory／PoolManager 下的 V3/V4 池与 PositionManager NFT。LP 默认滑点对齐此 fork 的上游源码回退值：一般为 2.5%，含原生币的 V4 为 0.05%，可手动修改；这里不使用 Uniswap 的远程配置或报价服务，因此不宣称复制其动态自动滑点。

`#market` 按池查看链上价格、区块区间轨迹、交易量和费用估算；估算费用并非持有人实际可领取收入。V4 PoolManager 的总余额不作为单池资产余额。`#history` 分页扫描合约事件，支持钱包过滤、公开交易哈希回执查询和本浏览器提交记录；扫描游标过期或区块重组时须重启扫描。Cloudflare Cache 只保存可回收的扫描状态，没有永久索引、D1、AWS、自动调度或新增付费资源。

交易公开元数据保存在浏览器 `sodadex.transactions.v1`；LP 另保存最后一笔待确认记录用于刷新恢复。浏览器不保存签名、私钥或 keystore。刷新后只查询回执，不自动续签下一笔授权或重发交易。清除浏览器存储会移除本设备记录，链上事件和哈希查询仍可使用。

SDK 固定版本的传递依赖扫描仍有未提供兼容修补版本的告警；没有使用 `audit fix --force` 更换协议版本。客户端仅使用其数学能力，签名仍由 EIP-1193 钱包完成。此限制不等于已完成独立安全审计。

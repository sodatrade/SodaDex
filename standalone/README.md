# SodaDEX 测试前端

独立构建的 SodaDEX 界面，使用 Svelte 5、Tailwind CSS v4 与 shadcn-svelte（`web/src/lib/components/ui`）。`web/` 保存界面、钱包连接状态和交易流程；`worker/` 提供静态文件及同源 RPC 代理。它不依赖上游缺失的 `tools/uniswap-nx`。

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

脚本从界面连接模拟钱包、分别选择 V3/V4，提交各一次双向兑换。每笔核对成功回执、自有池 Swap 事件、扣除 gas 后的实际余额变化、输入数量、预览最低接收量和零 WOKB 残留。该证据属于本地 fork；真实链部署及兑换以公开回执为准。浏览器脚本限制地址为 `127.0.0.1:4173`，不能对线上网站运行。

## 测试发布

`worker/wrangler.jsonc` 只配置 `sodadex-preview` 的 `workers.dev` 地址。没有自定义域名、Cron 或自动发布 CI。人工发布前，先完成上述检查与浏览器验收，再运行：

```sh
npm --prefix standalone/worker run deploy:test
```

Cloudflare 凭证使用本机 Wrangler 登录状态，不进入源码或前端构建。静态资源只从 `web/dist` 上传。

当前测试地址为 [sodadex-preview.jsmsdx2025.workers.dev](https://sodadex-preview.jsmsdx2025.workers.dev)，版本记录保存在 [`../deployments/frontend-test.json`](../deployments/frontend-test.json)。正式域名暂未绑定。

浏览器读取 `/api/rpc`；Worker 用固定地址 `https://rpc.ignix.bot/rpc/196` 查询 X Layer。代理接受白名单读取，以及固定 V3/V4 交易对的报价、授权和兑换模拟。真实交易由用户的浏览器钱包签名与广播；代理不签名、不广播，也不接受任意上游地址。节点失败时前端显示连接失败，不回退到其他节点。

## 当前范围

这是 **X Layer 主网 196 上的测试界面**，OKB 是真实资产。SodaDEX 仓位 NFT 名称和原创 SVG 已部署，V3 WOKB/USD₮0（0.01%）与 V4 原生 OKB/USD₮0（0%）均已创建、注入少量流动性并完成真实双向兑换。当前 `pools.json` 已核验为 `ready`，界面通过自有池报价、有限授权、交易预览、钱包执行与收据查询完成兑换。提供流动性的前端入口尚未开放。报价、价格和池数据不使用虚构数值。前端不读取本机部署钱包。

界面支持简体中文、English 与粵語，新访客默认白天主题。语言、外观和 CNY/USD/HKD 展示货币保存在浏览器的 `sodadex.preferences.v1`；存储不可用时使用默认设置。展示货币只影响价格标签，当前没有价格数据，不会把 OKB 余额换算成法币。

`web build` 会生成首帧偏好初始化脚本及 `dist/preferences-script.json`。Worker 构建和检查会读取该脚本的精确 CSP hash，因此必须先构建前端，再检查或发布 Worker；两者应一起发布。

当前前端及 Worker 的合约地址统一读取 [`../deployments/xlayer-test/active.json`](../deployments/xlayer-test/active.json)，池就绪状态读取 `pools.json`。原始 `plan.json` / `receipts.json` 和已经完成的三笔交易记录 `pools-interrupted.json` 保留用于历史核验。当前地址已按品牌更新的真实回执切换；完整地址、NFT 图片及兑换回执见 [`ADDRESSES.md`](../deployments/xlayer-test/ADDRESSES.md)。本应用与保留的上游 `apps/web` 分开构建，独立检查通过不代表整个上游单体仓库检查通过。

# SodaDex 测试前端

独立构建的 SodaDex 界面，复用本仓库的 Mycelium 样式工厂。`web/` 保存界面、钱包连接状态和只读链数据；`worker/` 提供静态文件及同源 RPC 代理。它不依赖上游缺失的 `tools/uniswap-nx`。

## 本地运行

使用 Node.js 22.22.2 或更新的 22.x，在仓库根目录执行：

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/worker ci --workspaces=false
npm --prefix standalone/web run build
npm --prefix standalone/worker run dev
```

访问 Wrangler 输出的本地地址（默认 `http://localhost:8787`）。开发界面也可独立运行 `npm --prefix standalone/web run dev`；Vite 会通过同源开发代理读取指定 RPC，无需同时启动 Worker。

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

## 测试发布

`worker/wrangler.jsonc` 只配置 `sodadex-preview` 的 `workers.dev` 地址。没有自定义域名、Cron 或自动发布 CI。人工发布前，先完成上述检查与浏览器验收，再运行：

```sh
npm --prefix standalone/worker run deploy:test
```

Cloudflare 凭证使用本机 Wrangler 登录状态，不进入源码或前端构建。静态资源只从 `web/dist` 上传。

当前测试地址为 [sodadex-preview.jsmsdx2025.workers.dev](https://sodadex-preview.jsmsdx2025.workers.dev)，版本记录保存在 [`../deployments/frontend-test.json`](../deployments/frontend-test.json)。正式域名暂未绑定。

浏览器读取 `/api/rpc`；Worker 用固定地址 `https://rpc.ignix.bot/rpc/196` 查询 X Layer。代理只接受允许的读取方法和已核实 WOKB 的余额、元数据调用，不接受签名、交易广播或任意上游地址。节点失败时前端显示连接失败，不回退到其他节点。

## 当前范围

这是 **X Layer 主网 196 上的测试界面**，OKB 是真实资产。当前可连接浏览器钱包、检查网络、读取余额、选择资产和协议；自有合约未部署，兑换和提供流动性尚未开放。报价、价格和池数据不使用虚构数值。前端不读取本机部署钱包。

界面支持简体中文、English 与粵語，新访客默认白天主题。语言、外观和 CNY/USD/HKD 展示货币保存在浏览器的 `sodadex.preferences.v1`；存储不可用时使用默认设置。展示货币只影响价格标签，当前没有价格数据，不会把 OKB 余额换算成法币。

`web build` 会生成首帧偏好初始化脚本及 `dist/preferences-script.json`。Worker 构建和检查会读取该脚本的精确 CSP hash，因此必须先构建前端，再检查或发布 Worker；两者应一起发布。

合约部署状态以 [`../deployments/xlayer-test/plan.json`](../deployments/xlayer-test/plan.json) 为准。部署完成仍需接入自有池的报价、授权与执行流程，然后才能开放交易。本应用与保留的上游 `apps/web` 分开构建，独立检查通过不代表整个上游单体仓库检查通过。

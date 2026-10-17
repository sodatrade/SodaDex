# SodaDEX Test web

X Layer 196 的独立前端，默认白天主题，支持简体中文、English、粵語及 CNY/USD/HKD 展示偏好。真实金额始终按代币单位显示；未接入独立法币价格，不显示虚构的估值。

## 页面与职责

- **交易**：选币、按地址导入并重新核验元数据、读取自有 V3/V4 池、自动选择报价最优的单池精确输入或精确输出路径、可调滑点、最低接收和池内价格影响、预览及钱包确认。支持 OKB/WOKB 1:1 包装和解包。
- **探索**：代币列表及详情、SodaDEX 池行情和事件、官方 Uniswap 候选池只读查询及报价。官方 V2/V3/V4 池不提供授权或提交交易入口，亦不代表全链排名。
- **流动性**：自助建池与仓位、追加、部分或全部减少、领取资产、NFT 查询。仅使用 SodaDEX 自有 Factory/PoolManager/PositionManager。V3 支持标准费率，V4 支持无 Hook 池。
- **投资组合**：概览、代币余额、SodaDEX 仓位 NFT、SodaDEX 活动及本浏览器提交记录；钱包发送原生 OKB/ERC20 和接收地址复制。发送先预览再由钱包确认。
- **搜索与偏好**：代币、池、公开钱包地址搜索；三语、主题和展示货币设置持久化。已知币使用本地官方原链图标，来源及哈希见 `public/assets/SOURCES.md`。

交易页的「限价单」连接已部署测试结算合约和 Cloudflare 持久化后台：用户确认有限授权和完整 Permit2 witness 签名，keeper 达到签名最低到账时全额成交；未成交订单由 maker 链上撤单。订单记录和实际部署见 [回执](../../deployments/xlayer-test/orders-receipts.json)。输入资产须为 ERC20，原生 OKB 须先自行包装。法币买卖、内置发行/拍卖、奖励、跨链执行、多跳和完整钱包外部历史尚未接入；发行走外部 IGNIX，桥走 X Layer 官方页面。

## 本地运行与检查

使用 `.nvmrc` 中的 Node 22.22.2。独立锁文件绕开上游缺失的私有 `tools/uniswap-nx`：

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/web run dev
npm --prefix standalone/web test
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web run build
```

Vite 默认 `http://127.0.0.1:5173`，同源 `/api` 转发给本地 Worker（默认 8787）。先按 [运行手册](../README.md) 启动 Worker。固定上游为 `https://rpc.ignix.bot/rpc/196`；节点失败显示失败，不切换其他链或伪造数据。

前端构建生成 `dist/preferences-script.json` 的精确 CSP hash，因此先构建 web，再检查或部署 Worker。

## 状态和资金流

`src/liquidity/` 负责币种核验、池发现、仓位及 LP 编码；`src/trading/poolTrade*` 负责单池报价、注册验证、有限授权和交易编码；`walletExecution.ts` 负责账户/链身份、模拟、余额/gas、确认和回执。`features/swap`、`features/portfolio` 保存界面操作状态，页面导航和偏好切换保留兑换表单。

交易刷新相同自有池报价，并保留用户确认的最低接收底线。ERC20 只按本次输入有限授权给 Permit2，再授权给自有 Router；不足的非零 allowance 先归零。每笔操作由注入钱包逐笔确认并广播，Worker 只读或模拟，不持有私钥。

交易哈希提交后立即写入浏览器 journal；超时保留 hash 并锁住重复提交，刷新恢复后只查回执，不自动续签或重发。清除浏览器数据会移除本设备记录，链上交易仍可通过 hash 查询。导入币只存地址，每次重新读取链上元数据和当前钱包余额。

合约地址由 `deployments/xlayer-test/active.json` 统一提供，初始两池记录位于 `pools.json`。公开兑换由共享 `standalone/trading-policy.json` 控制，官方池查询没有写入能力。测试合约位于 X Layer 主网，使用真实 OKB 和代币。

## 验证边界

纯逻辑、组件、Worker、真实本地 Anvil 合约生命周期和浏览器验收分别记录。需要完整 fixture 的用例与环境变量见 [运行手册](../README.md)，缺少 fixture 的跳过不算通过。Mock UI 不能证明链上成交，本地 Anvil 成交不能证明主网广播。当前发布源码及证据见 [发布记录](../../deployments/frontend-test.json)。前端独立检查通过不代表上游整个 monorepo 检查通过。

# SodaDEX 测试站

当前主站只保留 **Swap、Pool、我的** 三个 Tab，运行于 X Layer 196 的独立测试合约。196 使用真实 OKB 支付网络费。生产合约未调整。

- **Swap**：统一选币与按地址导入标准 ERC-20，直接单池自动比价或指定 V3/V4，精确输入／精确输出，默认兑换滑点 0.5%，有限授权、交易预览、钱包确认与回执恢复。原生 OKB/WOKB 支持 1:1 包装和解包。
- **Pool**：创建池／新仓位，列表统一点击“管理流动性”打开弹窗；普通 V3 与无 Hook V4 支持添加、追加、部分／全部移除和领取待领取资产。仓位为 NFT，管理入口位于“我的仓位”。矿机 OKB/sFAB 专用池在同一列表，通过创建弹窗中的“矿机碎片专用池”进入。
- **我的**：以列表展示 OKB、sFAB 与专用池 LP；完整精度、地址和本金明细在详情弹窗。普通仓位仍在 Pool → 我的仓位，不把此页宣称为全链资产总览。

普通池 **V2 尚未接入**；V4 不支持任意 Hook／动态费率。能导入某个代币，不代表存在可交易流动性。当前没有多跳及官方池交易路由。完整功能与验证边界见 [普通池支持清单](../../deployments/xlayer-test/ordinary-pools/README.md)。

矿机存入、赎回、金库、国库、LP 收益账本和领取由 IGNIX 负责。SodaDEX 不提供这些业务页面。

## 状态和资金流

`src/liquidity/` 管理币种核验、池发现、仓位与流动性交易编码；`src/trading/poolTrade*` 管理单池报价、注册验证、有限授权和 Router 编码。`features/liquidity`、`features/swap` 保存操作状态；同源 Worker 只读取或模拟，不持有用户密钥，不替用户广播。

池目录和历史成交使用 Cloudflare 持久化索引。成功添加流动性后，当前会话会先向固定工厂／PoolManager 重新读取并核验池，再供界面发现；报价和执行仍实时校验。其他访客及刷新后的会话依赖后台目录追块。V3/V4 仓位分开读取，V4 的 Transfer 历史扫描不会挡住已经读到的 V3 仓位；V4 持有人服务端索引仍待补齐。

交易 hash 写入本浏览器记录；超时后保留记录并阻止重复发送。刷新后只检查回执，不自动续签或重发。清除本机数据不会改变链上资产，但会清除本机记录。列表最多每页 10 条。

普通 V3/V4 按协议自身规则收费；矿机专用池使用独立的 0.5% OKB 交易费及平台 30%／LP 70% 分成。生产收款地址和部署配置仍需正式发布前核对。

## 本地运行

使用 `.nvmrc` 对应的 Node 22.x，独立 npm 锁文件和脚本，不需要安装上游完整 monorepo。

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/web run dev
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web test
npm --prefix standalone/web run build
```

Vite 默认 `http://127.0.0.1:5173`，同源 `/api` 转发给本机 Worker（默认 8787）。测试发布使用 `worker/wrangler.fragments-196-test.jsonc`，前后端必须绑定同一份已核验矿机专用池清单。不要用旧的 mining/unified 构建替换当前三 Tab 测试站。

## 验证边界

完整本地 Anvil 用例需要显式配置 `SODADEX_LP_FORK_STATE`、`SODADEX_LP_STATEVIEW_CODE`、`SODADEX_TRADE_RUNTIMES`；缺 fixture 的跳过不能算通过。浏览器脚本 `acceptance/ordinary-pools.js` 仅允许自有 localhost 4181 的 Anvil 适配器，不能对公共站签名或广播。

本地单元／组件测试、本地合约与浏览器回执、公共 196 链回执、正式生产发布分别记录。本地通过不等于公链通过；196 独立测试合约不等于生产合约。

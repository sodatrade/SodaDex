# SodaDEX Test web

SodaDEX 的独立前端，保留日间 / 夜间、简体中文 / English / 粵語与 CNY / USD / HKD 展示偏好。钱包、输入数量、资产方向和协议偏好不会因切换语言或外观而重建。没有法币价格来源时仍显示 `—`，不会把资产数量当作法币估值。

兑换仅对 `deployments/xlayer-test/pools.json` 中已就绪且通过校验的 X Layer 196 测试池开放。缺少记录、pending、网络或资产/费用不一致时关闭报价及交易。默认 OKB / USD₮0，USD₮0 使用 6 位小数；WOKB 可查看余额，暂不提供直接交易路径。V3 自动包装 / 解包原生 OKB，V4 直接使用原生 OKB。测试合约位于主网，使用真实资产，网络手续费以真实 OKB 支付。

## 开发与检查

使用仓库 `.nvmrc` 指定的 Node 22.22.2，独立 npm 锁文件绕开上游缺失的私有 `tools/uniswap-nx`：

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/web run dev
npm --prefix standalone/web test
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web run build
```

Vite 默认 `http://127.0.0.1:5173`，同源 `/api/rpc` 转发到 `http://127.0.0.1:8787` 的 Worker，保留生产环境相同的方法、合约和 calldata 校验。请先按 `../worker/` 的说明启动本地 Worker；不直接连接上游 RPC。Worker 使用用户指定的 `https://rpc.ignix.bot/rpc/196`。钱包写入仅由注入钱包通过 `eth_sendTransaction` 发起，不经过代理，也不读取部署钱包文件。

`tooling/preferences-prepaint.ts` 在 HTML head 生成同步初始化脚本。构建输出 `dist/preferences-script.json.hash`，是 inline 脚本精确的 `sha256-<base64>` CSP 授权。先构建 web，再检查或部署 Worker，确保两者来自同一次构建。

## 兑换数据与状态

- `src/domain/` 集中定义 OKB、WOKB、USD₮0 与 BigInt 金额规则；官方图标保存在 `public/assets/`，来源和 SHA-256 见 `SOURCES.md`。
- `src/trading/config.ts` 从部署计划读取固定合约，校验 pool manifest。`quotes.ts` 用 V3 / V4 Quoter 链上调用取得精确输入报价，自动模式比较可用池实际输出。没有报价时不会填充模拟数据。
- `encoding.ts` 对应锁定的 Universal Router 2.1.2 输入格式。最低接收使用向上取整的 0.5% 滑点保护，避免 6 位小数中的舍入突破上限。V3 费率 0.01%、V4 0%、平台费 0%。
- `execution.ts` 负责确认后的流程：核对钱包身份及链 → 必要授权并等待回执 → 重新读取同一路由报价 → 保留用户确认的最低接收底线 → 模拟及估算 gas → 再次核对钱包 → 请求钱包发送 → 读取回执。有效期最长 600 秒。输入、账户、provider 或链变化会阻止后续写入。
- `approvals.ts` 仅对本次精确输入授权：USD₮0 → Permit2，再由 Permit2 → SodaDEX router。已有足额授权跳过；非零但不足的 ERC-20 授权先重置为 0，每一步等待回执并重新读取。新 Permit2 路由授权最长 600 秒，ERC-20 授权本身没有时间字段。
- `useTrade.ts` 管理用户操作状态。已提交 hash 会先保存再等待回执；超时或节点故障不自动重发，界面锁住重复提交并提供「检查交易回执」。授权回执人工确认后要求重新预览；兑换确认后刷新余额。关闭弹窗会停止尚未发送的后续步骤，无法撤回已发送的交易。卡片保留最近提交的 hash 与浏览器入口，表单或弹窗重置不清除该记录，下一笔实际提交才替换；刷新页面不持久化交易历史。
- `useWallet.ts` 在 provider 事件到达时同步更新身份 revision，避免 React 尚未重新渲染期间的旧账户 / 旧链继续发送。页面导航保留兑换卡片状态；偏好设置不重挂钱包或交易控制器。
- `components/TradeConfirmation.tsx` 展示输入、预计输出、最低接收、协议费率、链、接收地址及 router。浏览器钱包会要求用户逐笔确认，页面不会自动签名。

搜索支持已知资产名称、代号、合约地址；池就绪后显示对应测试池入口。有效公开地址仅链接到区块浏览器。添加流动性尚未提供前端交易入口。

## 验证范围

本地测试覆盖 6 / 18 位小数、路由编码、精确授权 / 零重置、重新报价最低接收、钱包事件竞态、已发送 hash、pending / revert 回执，以及三语确认界面和偏好状态。浏览器 mock 交易用于验证交互与编码，不证明链上交易成功；真实部署、池流动性、RPC 白名单兼容及实际广播由集成环境单独验证。前端不存储私钥。

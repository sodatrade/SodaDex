# SodaDex Test web

独立的 SodaDex 前端：原创深色 / 浅色外观、资产选择、协议偏好、浏览器钱包连接、X Layer 网络切换与真实余额查询。当前测试合约尚未部署，兑换与添加流动性保持关闭；不生成模拟报价、不签名、不发送交易。

## 开发与检查

使用仓库 `.nvmrc` 指定的 Node 22.22.2。在仓库根目录运行：

```sh
npm --prefix standalone/web ci --workspaces=false
npm --prefix standalone/web run dev
npm --prefix standalone/web test
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web run build
```

Vite 默认使用 `http://127.0.0.1:5173`。开发代理和部署后的 Worker 都将同源 `/api/rpc` 请求发送到用户指定的 `https://rpc.ignix.bot/rpc/196`。开发代理移除 Origin，并使用 SodaDex 的 User-Agent，避免节点拒绝浏览器跨域请求。正式托管和只读代理配置由 `../worker/` 负责。

这个目录在上游 `apps/*` workspaces 之外，使用自己的锁文件。它直接复用仓库当前的 `@universe/mycelium/styled` 工厂与 Tailwind 设计基础；`ui/src` 已不再导出该工厂。独立安装可避开公开上游缺失的 `tools/uniswap-nx`，并不代表上游整仓检查已恢复。

## 数据与状态

- `src/domain/` 保存已核对的 OKB / WOKB 元数据和精确整数金额规则。
- `src/lib/rpc.ts` 仅通过同源代理读取链 ID、区块与余额。React Query 管理请求状态；节点错误显示为不可用，不填充价格或资产数据。
- `src/lib/wallet.ts` / `useWallet.ts` 处理 EIP-6963、注入钱包、用户授权、账户/网络事件与本地断开状态。连接不会读取本地部署钱包文件。
- `src/components/` 负责兑换、资产、流动性和原生对话框。测试状态始终可见，费用显示为计划配置。
- `tests/` 覆盖精确金额、钱包授权与拒绝、网络切换、余额读取、资产选择及交易关闭状态。浏览器视口与实际 RPC 验证需另外执行，组件模拟不等于链上交易验证。

启用兑换前须接入真实部署地址、可用流动性和真实报价/交易构建流程。不能仅把按钮改为可点击。

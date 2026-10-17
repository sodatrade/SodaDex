# SodaDEX Test：X Layer 196

当前状态是 **SodaDEX NFT 品牌更新、两个测试池、少量流动性和 V3/V4 双向微额兑换均已部署并核验**。当前完整地址、部署交易和链上 NFT 图片见 [ADDRESSES.md](ADDRESSES.md)。本阶段新增六个外围合约，共 18 笔成功交易；包含此前三笔在内的总 gas 为 **0.000619773462 OKB**，低于获批的 **0.0007 OKB**，累计发送本金不超过 **0.0002 OKB**。生产部署留待后续。

当前合约见 [active.json](active.json)，测试池见 [pools.json](pools.json)，本轮完整回执及独立只读核验见 [branding-receipts.json](branding-receipts.json)，可复现构建指纹见 [branding-build.json](branding-build.json)。原始基础部署 `plan.json` / `receipts.json` 保持不变：12 个合约、13 笔成功交易，费用 0.000878811864 OKB，属于此前单独批准的 0.001 OKB 阶段。原建池流程的三笔完成记录保留在 [pools-interrupted.json](pools-interrupted.json)，其 gas 0.000007084791 OKB 已计入本轮总额；已买入的 0.011844 USD₮0 直接复用，没有再次买入。

品牌更新源码和原创 SVG 见 [合约说明](../../contracts/sodadex-branding/README.md)。六个外围合约已替换；原 Factory、PoolManager、Quoter、StateView 复用。V3 WOKB/USD₮0（0.01%）与 V4 原生 OKB/USD₮0（0%、tickSpacing=1、无 hooks）均为全范围仓位。两池各完成一次 OKB 输入 0.000001 和一次 USD₮0 输入 0.0001 的兑换，逐笔核对事件、实际余额与 0.5% 滑点最低输出。

测试使用 X Layer 主网的真实 OKB，不创建测试代币。v3 使用现有 WOKB，路由负责包装和解包；v4 可以直接使用原生 OKB。WOKB 与 Permit2 采用已核对的官方现网地址，其余合约独立部署。

## 部署内容与收费

部署组合包含 v3 Factory、NFTDescriptor、TokenDescriptor、PositionManager、Quoter，以及 v4 PoolManager、Descriptor、PositionManager、Quoter、StateView，最后部署 UnsupportedProtocol 和同时支持 v3/v4 的 Universal Router。共 12 个合约，加一笔启用 v3 低费档的调用。无需单独部署 v3 SwapRouter、v2 或跨链桥。

目标为平台费 0、协议抽成 0、v3 测试池费率 0.01%、v4 测试池费率 0。基础合约部署不会创建池；v3 Factory 会保留原有费档，并额外启用 `enableFeeAmount(100, 1)`。之后创建测试池时应使用指定费率。v4 测试池已确定 tickSpacing=1、hooks=0。

`v4UnsubscribeGasLimit=300000` 沿用官方 X Layer PositionManager 的只读查询结果，限制订阅回调的 gas，与部署预算无关。

owner 的公开地址记录在 `plan.json`。本机加密 keystore 位于 `~/.local/share/sodadex/wallets/xlayer-test-owner/owner`，目录权限为 0700，密钥与本地解锁文件权限为 0600，均在仓库外。预演脚本不读取或解密钱包。

部署 gas 必须是 **X Layer 主网（chain ID 196）的原生 OKB**。同一 owner 地址在 Ethereum 上的 ERC-20 OKB 不会自动成为 X Layer 余额；转账或提币时必须确认所选网络为 X Layer。实际广播前重新读取目标链余额并核算费用，不能把其他网络上的余额计入部署预算。

## 固定来源与构建

v3 使用官方 npm 发布 artifacts：`@uniswap/v3-core@1.0.1` 和 `@uniswap/v3-periphery@1.4.4`。原始基础部署保留官方字节码。后续品牌更新只修改外围 NFT 源码；Factory/Pool 的字节码和 V3 Pool init code hash 保持不变。完整来源、下载完整性校验及构造 ABI 见本机 `.analysis/v3-deployment-research.json`。

v4 使用 Universal Router `2.1.2`，固定提交 `802fe4c18f47300e0f183e2a42e9146ec2ea9fc3` 及其递归子模块。每个项目使用自己的编译设置，不能把 Router 的设置用于 PoolManager 或 PositionManager。`plan.json` 固定所有 creation bytecode 的 SHA256，预演会检查匹配。

已准备的源码目录是 `.analysis/upstream/universal-router-2.1.2`，v3 artifacts 目录是 `.analysis/upstream/v3-artifacts`。重新获取时使用下列公开来源，并将子模块初始化到锁定版本：

```bash
git clone --branch 2.1.2 --recursive https://github.com/Uniswap/universal-router.git .analysis/upstream/universal-router-2.1.2
```

在 Router 目录安装其 package.json 固定的生产依赖，禁用生命周期脚本且不修改锁：

```bash
npm install --ignore-scripts --package-lock=false --no-save --omit=dev
```

在 `lib/v4-periphery/lib/v4-core` 执行：

```bash
FOUNDRY_FFI=false forge build src/PoolManager.sol --sizes
```

在 `lib/v4-periphery` 执行：

```bash
FOUNDRY_FFI=false forge build src/PositionManager.sol src/PositionDescriptor.sol src/lens/V4Quoter.sol src/lens/StateView.sol --sizes
```

在 Router 根目录执行：

```bash
FOUNDRY_FFI=false forge build contracts/UniversalRouter.sol contracts/deploy/UnsupportedProtocol.sol --sizes
```

v3 官方包下载地址：

- [v3-core 1.0.1](https://registry.npmjs.org/@uniswap/v3-core/-/v3-core-1.0.1.tgz)，压缩包 SHA256：`141b001e2a376fff867cb24e0713b2834095cb1250c13aae263d9a646446d329`
- [v3-periphery 1.4.4](https://registry.npmjs.org/@uniswap/v3-periphery/-/v3-periphery-1.4.4.tgz)，压缩包 SHA256：`7177174c4b8c66bd1d61e7c4127ee15e95f851edfb1a65ee8225b6ab4f818bd7`

分别解压到 `.analysis/upstream/v3-artifacts/v3-core-1.0.1` 与 `v3-periphery-1.4.4`，保留包内 `package/` 目录。

## 本地预演

以下记录本次部署前的流程。当前 `plan.json` 已包含真实部署地址，预演和执行脚本会拒绝将它作为新部署计划重复执行；不要清空地址或删除私有日志来重新部署。后续部署应使用新的独立计划。

需要 Python 3、Git、Foundry 的 `cast/anvil` 和 `lsof`。在 SodaDex 根目录执行：

```bash
python3 scripts/sodadex/rehearse-xlayer-test.py
```

脚本只读访问公共 X Layer RPC，检查 chain ID、依赖代码、源码版本和字节码。它启动独立的 localhost Anvil fork，验证进程与监听端口归属，然后仅在该本地节点临时设置余额、模拟全部部署与配置。过程中没有签名，也没有向公共 RPC 发送写入请求；结束时关闭本次节点。端口被占用时直接停止，可用 `--port` 选择另一个端口。

输出保存在 `.analysis/deployment/xlayer-test-rehearsal.json`，包含本地回执、未签名部署数据、构造参数和费用估算。实际主网部署前需要重新核对 nonce、余额、gas 与链上费用，执行后逐笔读取真实回执，并核对 owner 与各合约绑定地址。保持 `contracts` 为空直到取得真实部署回执。

## 已授权测试部署的执行与恢复

`scripts/sodadex/deploy-xlayer-test.py` 使用同一构造／依赖计划，额外核对签名发送者、chain ID、nonce、calldata、完整 runtime hash、回执及合约绑定。签名通过本机加密 keystore 完成，钱包不进入前端。

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sodadex -p 'test_*.py'
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sodadex/rehearse-xlayer-test.py --output .analysis/deployment/xlayer-test-runtime-rehearsal.json
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sodadex/deploy-xlayer-test.py
# 仅在用户已授权当前测试计划和预算后执行：
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sodadex/deploy-xlayer-test.py --broadcast
```

私有执行日志位于 `~/.local/share/sodadex/deployments/xlayer-test/journal.json`（目录 0700、文件 0600）。每笔签名与 hash 先落盘，再广播；网络响应丢失时按同一命令恢复，先核对已知 hash 的真实回执与 nonce。不要删除日志重新部署；脚本不会自动替换交易或提高 gas 价格。检测到未知 nonce、回执失败、字节码不符或预算超限会停止并保留原日志。

原始基础部署的批准预算为 0.001 OKB，执行时逐笔刷新余额和费用，并预留全部剩余交易的执行费上限。本轮品牌更新与建池兑换使用另行批准的 0.0007 OKB 总 gas 上限，记录在 `branding-receipts.json`。目前执行器要求链上 L1 数据费和 operator fee 报价均为 0；费用模型变化时停止重新核算。该读取是当时的链上报价，不保证未来区块费率不变。完成后的公开回执保存在 `receipts.json`，其中不含签名原文。

## 测试身份与应用接入

网页基础标题、分享元数据与钱包连接显示名已标为 `SodaDex Test`。自有合约接入后，页面顶部还应持续显示“SodaDex 测试版 · X Layer 主网（196）”，交易确认页列出实际测试合约地址并提供浏览器链接；正式版使用另一组部署记录。

保留的上游 `apps/web` 使用 Uniswap 服务；独立构建的 `standalone/web` 和 Worker 统一读取 `active.json` 与已核验的 `pools.json`，已实现这两个自有测试池的报价、有限授权、预览、兑换与回执查询。当前独立公开兑换策略保留只读报价，但已关闭新的 Router 预览和兑换入口；保留已部署池记录、余额及已提交交易回执查询。池配置仍为 `ready`，不以伪造池未创建的状态代替交易暂停。真实交易由浏览器钱包签名和广播，Worker 仅通过指定 RPC 读取与模拟。独立流动性入口支持用户自签建池、创建仓位、追加、减少与领取资产；其有限授权和模拟与 Router 兑换暂停分开处理。本轮仅在自有本地 Anvil 验收这些新增操作，没有再次动用部署钱包或生产合约。

初始化价格通过固定市场路由在指定 RPC 的最新明确区块做只读 `eth_call` 得出；过期 API 报价仅保留为路径来源，模拟没有产生额外买币。18 笔本轮回执、六个新 runtime、合约绑定及实际 NFT metadata 已经另一只读节点独立核对。浏览器证据分为模拟钱包/RPC 的界面验收、本地 Anvil fork 的四向真实合约执行，以及公开链上的四笔兑换回执；三者分别记录，不能互相替代。上游整个单体仓库检查仍受缺失 `tools/uniswap-nx` 限制。

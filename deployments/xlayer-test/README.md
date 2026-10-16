# SodaDex Test：X Layer 196

当前状态是**V3 / V4 基础测试合约已在 X Layer 主网 196 部署并核验**：12 个新合约、13 笔成功交易，实际费用 **0.000878811864 OKB**，预算 0.001 OKB。完整地址见 [ADDRESSES.md](ADDRESSES.md)，真实回执见 [receipts.json](receipts.json)。生产部署留待后续单独进行。

测试使用 X Layer 主网的真实 OKB，不创建测试代币。v3 使用现有 WOKB，路由负责包装和解包；v4 可以直接使用原生 OKB。WOKB 与 Permit2 采用已核对的官方现网地址，其余合约独立部署。

## 部署内容与收费

部署组合包含 v3 Factory、NFTDescriptor、TokenDescriptor、PositionManager、Quoter，以及 v4 PoolManager、Descriptor、PositionManager、Quoter、StateView，最后部署 UnsupportedProtocol 和同时支持 v3/v4 的 Universal Router。共 12 个合约，加一笔启用 v3 低费档的调用。无需单独部署 v3 SwapRouter、v2 或跨链桥。

目标为平台费 0、协议抽成 0、v3 测试池费率 0.01%、v4 测试池费率 0。基础合约部署不会创建池；v3 Factory 会保留原有费档，并额外启用 `enableFeeAmount(100, 1)`。之后创建测试池时应使用指定费率。v4 建池还需要确定 tick spacing。

`v4UnsubscribeGasLimit=300000` 沿用官方 X Layer PositionManager 的只读查询结果，限制订阅回调的 gas，与部署预算无关。

owner 的公开地址记录在 `plan.json`。本机加密 keystore 位于 `~/.local/share/sodadex/wallets/xlayer-test-owner/owner`，目录权限为 0700，密钥与本地解锁文件权限为 0600，均在仓库外。预演脚本不读取或解密钱包。

部署 gas 必须是 **X Layer 主网（chain ID 196）的原生 OKB**。同一 owner 地址在 Ethereum 上的 ERC-20 OKB 不会自动成为 X Layer 余额；转账或提币时必须确认所选网络为 X Layer。实际广播前重新读取目标链余额并核算费用，不能把其他网络上的余额计入部署预算。

## 固定来源与构建

v3 使用官方 npm 发布 artifacts：`@uniswap/v3-core@1.0.1` 和 `@uniswap/v3-periphery@1.4.4`。保留原字节码，使 Pool init code hash 与官方 SDK 一致。完整来源、下载完整性校验及构造 ABI 见本机 `.analysis/v3-deployment-research.json`。

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

当前预算为 0.001 OKB，逐笔刷新余额和费用，并预留全部剩余交易的执行费上限。目前执行器要求链上 L1 数据费和 operator fee 报价均为 0；费用模型变化时停止重新核算。该读取是当时的链上报价，不保证未来区块费率不变。完成后的公开回执保存在 `receipts.json`，其中不含签名原文。

## 测试身份与应用接入

网页基础标题、分享元数据与钱包连接显示名已标为 `SodaDex Test`。自有合约接入后，页面顶部还应持续显示“SodaDex 测试版 · X Layer 主网（196）”，交易确认页列出实际测试合约地址并提供浏览器链接；正式版使用另一组部署记录。

保留的上游 `apps/web` 使用 Uniswap 服务；已发布的 `standalone/web` 是独立只读界面，仅使用指定 RPC 查询网络与余额，兑换和 LP 操作尚未开放。自有流动性不能仅靠替换交易的 `to` 地址接入；还需接入对应的报价、授权、LP 操作和持仓查询，并按自有 PoolManager 隔离 v4 池数据。完成这些步骤前不能把网页视为已接入 SodaDex 自有流动性。

本次未创建池或注入流动性。下一步还需要第二种现有资产、初始价格、金额与价格范围。基础合约部署、真实回执、12 个 runtime hash 与 23 项绑定核验已完成；真实资产兑换和浏览器交易验收尚未进行。

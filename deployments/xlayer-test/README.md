# SodaDex Test：X Layer 196

当前状态是**部署准备完成，尚未在主网部署**。`plan.json` 的 `contracts` 为空；本地预演产生的地址和交易回执不会写入这个字段。生产部署留待后续单独进行。

测试使用 X Layer 主网的真实 OKB，不创建测试代币。v3 使用现有 WOKB，路由负责包装和解包；v4 可以直接使用原生 OKB。WOKB 与 Permit2 采用已核对的官方现网地址，其余合约独立部署。

## 部署内容与收费

部署组合包含 v3 Factory、NFTDescriptor、TokenDescriptor、PositionManager、Quoter，以及 v4 PoolManager、Descriptor、PositionManager、Quoter、StateView，最后部署 UnsupportedProtocol 和同时支持 v3/v4 的 Universal Router。共 12 个合约，加一笔启用 v3 低费档的调用。无需单独部署 v3 SwapRouter、v2 或跨链桥。

目标为平台费 0、协议抽成 0、v3 测试池费率 0.01%、v4 测试池费率 0。基础合约部署不会创建池；v3 Factory 会保留原有费档，并额外启用 `enableFeeAmount(100, 1)`。之后创建测试池时应使用指定费率。v4 建池还需要确定 tick spacing。

`v4UnsubscribeGasLimit=300000` 沿用官方 X Layer PositionManager 的只读查询结果，限制订阅回调的 gas，与部署预算无关。

owner 的公开地址记录在 `plan.json`。本机加密 keystore 位于 `~/.local/share/sodadex/wallets/xlayer-test-owner/owner`，目录权限为 0700，密钥与本地解锁文件权限为 0600，均在仓库外。预演脚本不读取或解密钱包。

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

需要 Python 3、Git、Foundry 的 `cast/anvil` 和 `lsof`。在 SodaDex 根目录执行：

```bash
python3 scripts/sodadex/rehearse-xlayer-test.py
```

脚本只读访问公共 X Layer RPC，检查 chain ID、依赖代码、源码版本和字节码。它启动独立的 localhost Anvil fork，验证进程与监听端口归属，然后仅在该本地节点临时设置余额、模拟全部部署与配置。过程中没有签名，也没有向公共 RPC 发送写入请求；结束时关闭本次节点。端口被占用时直接停止，可用 `--port` 选择另一个端口。

输出保存在 `.analysis/deployment/xlayer-test-rehearsal.json`，包含本地回执、未签名部署数据、构造参数和费用估算。实际主网部署前需要重新核对 nonce、余额、gas 与链上费用，执行后逐笔读取真实回执，并核对 owner 与各合约绑定地址。保持 `contracts` 为空直到取得真实部署回执。

## 测试身份与应用接入

网页基础标题、分享元数据与钱包连接显示名已标为 `SodaDex Test`。自有合约接入后，页面顶部还应持续显示“SodaDex 测试版 · X Layer 主网（196）”，交易确认页列出实际测试合约地址并提供浏览器链接；正式版使用另一组部署记录。

当前前端仍调用上游 Uniswap 服务和官方合约。自有流动性不能仅靠替换交易的 `to` 地址接入；还需接入对应的报价、授权、LP 操作和持仓查询，并按自有 PoolManager 隔离 v4 池数据。完成这些步骤前不能把网页视为已接入 SodaDex 自有流动性。

本次不创建池或注入流动性。这一步还需要第二种现有资产、初始价格、金额与价格范围。主网部署、真实资产买卖和浏览器交易验收均未完成。

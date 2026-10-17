# SodaDEX 测试仓位 NFT

这组源码只修改仓位 NFT 的名称、元数据和图片，并在 V3/V4 仓位管理器增加只读 `deploymentInfo()`。现有资金操作、权限、回调、Factory、Pool、费率和 UniversalRouter 源码保持原样。项目使用范围为用户指定的个人学习、非商用测试；这项用途说明不改变上游许可证。

Collection name 分别为 `SodaDEX V3 Positions NFT`、`SodaDEX V4 Positions NFT`，symbol 为 `SODA-V3-POS`、`SODA-V4-POS`。`deploymentInfo()` 返回 `("SodaDEX", 1, block.chainid, true)`，不写入状态。Permit 使用新 collection name：V3 保留版本 `1` 的原 EIP-712 结构，V4 保留原本没有 version 字段的结构。

新 SVG 使用 SodaDEX 字标、测试标记和真实币对、tokenId、费率、价格范围。共同的纯函数分别处理 JSON 和 XML 文本编码；非法 UTF-8 和 XML 禁用字符由替代字符表示，币种符号不能成为 SVG 标签。原始许可、代码来源和作者署名保留；新模板不继续调用原来的随机配色和曲线生成器。

## 固定来源与许可

| 部分 | 固定版本 | 许可来源 |
| --- | --- | --- |
| V3 periphery | [`697c2474757ea89fec12a4e6db16a574fe259610`](https://github.com/Uniswap/v3-periphery/tree/697c2474757ea89fec12a4e6db16a574fe259610)，npm `1.4.4` | 源文件 SPDX、[保留的 GPL 文本](licenses/v3-periphery.LICENSE) |
| V4 periphery | [`545a5d2a87228167edde48f3b9eda122d1e3c4d6`](https://github.com/Uniswap/v4-periphery/tree/545a5d2a87228167edde48f3b9eda122d1e3c4d6) | 源文件 SPDX、[保留的根许可文本](licenses/v4-periphery.LICENSE) |
| V4 core 依赖 | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | 标准 JSON 中保留各文件 SPDX；完整依赖许可随输入归档提供 |
| UniversalRouter | `802fe4c18f47300e0f183e2a42e9146ec2ea9fc3`，源和编译产物不修改 | 固定源的 GPL-3.0-or-later 及依赖许可随输入归档提供 |
| 原创共同 helpers | `common/SodaMetadata.sol`、`common/SodaSVG.sol` | MIT |

## 构建与验证

在独立 staging 中构建，不修改 `.analysis/upstream`，也不安装根工作区依赖：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sodadex/build-branding.py \
  --source-root /path/to/SodaDex \
  --output .analysis/branding/build.json

PYTHONDONTWRITEBYTECODE=1 python3 scripts/sodadex/test_branding.py \
  --source-root /path/to/SodaDex \
  --manifest .analysis/branding/build.json -v
```

V3 编译器固定 `0.7.6+commit.7338295f`、Istanbul、metadata hash none；NPM 优化次数 2000，两个 Descriptor 为 1000。先精确复现三个官方 V3 artifact 的 ABI、creation/runtime 对象和链接引用，再编译修改版。依赖来自固定 npm 归档，并核验上游 lockfile 的归档摘要。macOS 可下载已固定 SHA256 的官方 0.7.6 编译器；其它环境使用 `--solc-v3` 指定精确版本。

V4 固定 `0.8.26+commit.8a97fa7a`，复制原 Foundry 设置：Cancun、via IR、metadata hash none，PosM 优化次数 500、Descriptor 为 1。`--solc-v4` 可指定本地固定版本编译器。

`build.json.artifacts` 提供六个部署产物的相对路径、文件摘要、creation/runtime 对象摘要、大小和编译设置；`canonicalSources` 使用仓库相对路径和 SHA256。仅本地测试的 harness 放在 `testArtifacts`。`unmodified` 记录旧 Factory/Pool/Router 源码与产物摘要。编译与测试均不连接远端 RPC、不访问钱包、不签名、不部署真实合约。

`compiler-inputs.tar.gz` 包含完整标准 JSON 编译输入和对应依赖的许可证文本，便于公开源码和浏览器验证；归档不含本机绝对路径，相同输入在不同 staging 目录构建的 manifest 与归档摘要一致；`local-test-evidence.json` 记录真实本地部署及元数据 gas 对照，`metadata-evidence/` 保存解码 JSON/SVG。这些生成文件位于忽略目录，不应把本地测试地址当作链上部署地址。提交中的 `compiler-inputs.tar.gz` 是对应源码归档快照，最终部署版本应同时保留其构建 manifest、链接地址和 constructor 参数。

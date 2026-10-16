# SodaDex V3 / V4 测试合约地址

部署日期：2026-10-16（Asia/Singapore）。网络：**X Layer 主网，Chain ID 196**。以下为本次独立部署的测试合约；生产部署留待后续进行。

Owner：`0x6ecf746b078d46391f8C425B150153212F7C0545`。RPC：<https://rpc.ignix.bot/rpc/196>。

12 个新合约、13 笔成功交易；实际费用 **0.000878811864 OKB**，预算 0.001 OKB。

| 合约 | 实际部署地址 | 部署交易 |
| --- | --- | --- |
| V3 Factory | [0xa6109b7f4237d2ac28b8009fbd21b88cff194cfe](https://www.oklink.com/xlayer/address/0xa6109b7f4237d2ac28b8009fbd21b88cff194cfe) | [交易](https://www.oklink.com/xlayer/tx/0x1c5d2b5a0831077e56133eb5308a86ff0eda38108792b3214e9190c034d18953) |
| V3 NFTDescriptor（库） | [0xbde586b47373676afbdf9669caa40e932d45dafe](https://www.oklink.com/xlayer/address/0xbde586b47373676afbdf9669caa40e932d45dafe) | [交易](https://www.oklink.com/xlayer/tx/0xedc0864f7d760f8f6710e21cb1f48258d707ace98dd11ddcdf9ee57c9a3b6086) |
| V3 TokenDescriptor | [0xd89f1293deb12ab050531bcba4a465b7847bee7d](https://www.oklink.com/xlayer/address/0xd89f1293deb12ab050531bcba4a465b7847bee7d) | [交易](https://www.oklink.com/xlayer/tx/0x69235e41030ba433b5526a1290bebe3431d903662a4f66303fb38af6528ebd74) |
| V3 PositionManager | [0x484c58d937387ec34c5ae01ad796f0c5f801fd72](https://www.oklink.com/xlayer/address/0x484c58d937387ec34c5ae01ad796f0c5f801fd72) | [交易](https://www.oklink.com/xlayer/tx/0x847c163c688c4b6ed1153a02585a3c6ede5bed0b869d6373acbec4229209036e) |
| V3 QuoterV2 | [0x98f4dfbfab6fc37e59e00d6881e779b33b23b009](https://www.oklink.com/xlayer/address/0x98f4dfbfab6fc37e59e00d6881e779b33b23b009) | [交易](https://www.oklink.com/xlayer/tx/0x007ad495f25e2123f2818b0b3a9037af4b66a9f2742099011ac9bbc190141e7e) |
| V4 PoolManager | [0x6b5c32ad97eb42230138e02a21b0e6d811fd713d](https://www.oklink.com/xlayer/address/0x6b5c32ad97eb42230138e02a21b0e6d811fd713d) | [交易](https://www.oklink.com/xlayer/tx/0x6920add66040fd7af83d2fe8845b2942c4de6f3a1a354d00b70251c6f1e0d0d2) |
| V4 Descriptor | [0xad6e6bd6feecd3ef77ead8779ffcf5d52521abca](https://www.oklink.com/xlayer/address/0xad6e6bd6feecd3ef77ead8779ffcf5d52521abca) | [交易](https://www.oklink.com/xlayer/tx/0x3b2c0a4e3f1d9ec751380f02847f095183a92a8a93b84ade4fb82b1b874b58e4) |
| V4 PositionManager | [0xfe32078e62a43d88f65731da693950e6e221fe0b](https://www.oklink.com/xlayer/address/0xfe32078e62a43d88f65731da693950e6e221fe0b) | [交易](https://www.oklink.com/xlayer/tx/0x1cb2cfbf66cf6fa1778837bbe596d40b84406fb26196c2653d2acfcfbfe9c902) |
| V4 Quoter | [0x7a188d4c46c9fe045a5875fecaef9bf00e4521ff](https://www.oklink.com/xlayer/address/0x7a188d4c46c9fe045a5875fecaef9bf00e4521ff) | [交易](https://www.oklink.com/xlayer/tx/0x787a652148d1102eed7ec3c3a14727ff7a23ad7f5a3d6effb377a7c2b77045b3) |
| V4 StateView | [0x7991d4a8493b9709365cd079dffc75e790007874](https://www.oklink.com/xlayer/address/0x7991d4a8493b9709365cd079dffc75e790007874) | [交易](https://www.oklink.com/xlayer/tx/0x4b341a1f30d8e254aea8165872e3cb95f2ff9a8a93a7b341bc0abc1d0a2d8152) |
| UnsupportedProtocol（占位） | [0x68eca93437df07be4b2c3a67956ace2dc87d2f39](https://www.oklink.com/xlayer/address/0x68eca93437df07be4b2c3a67956ace2dc87d2f39) | [交易](https://www.oklink.com/xlayer/tx/0x6b82ed35bf18729ec89ac692df89c2e63979e179f0c2c758d85c1b210fa45d44) |
| Universal Router（V3/V4） | [0x9206a7fac11948efdb391fc1dfa310f8b09d3afa](https://www.oklink.com/xlayer/address/0x9206a7fac11948efdb391fc1dfa310f8b09d3afa) | [交易](https://www.oklink.com/xlayer/tx/0xe899e43d599393917180da2475b0dba32bcd84bdc2b565b0bd61cdcc17a50247) |

V3 已启用 **0.01%（fee=100，tickSpacing=1）** 费档：[配置交易](https://www.oklink.com/xlayer/tx/0xcf525d5e0d45c91f9baeba74227fbf275687ff3e93817e86045021db781193cd)。

尚未创建池或注入流动性；V4 的 0 费率计划在建池时应用。前端仍为只读测试界面，兑换及提供流动性未开放。

完整回执、runtime SHA-256 和费用记录见 [receipts.json](receipts.json)；固定版本、收费与现有 WOKB / Permit2 地址见 [plan.json](plan.json)。

核验范围：成功回执、canonical 区块、12 个完整运行时代码 hash、23 项 owner／依赖／费档绑定。浏览器源码验证尚未提交。

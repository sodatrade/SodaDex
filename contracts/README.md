# SodaDEX 合约审计入口

正式 FABX 接入的本次外部审计请从 **[正式适配候选与复核说明](sodadex-fragments-production/README.md)** 开始。该候选尚未部署；[旧 v5 源码与复现说明](sodadex-fragments/README.md)继续作为已部署独立测试版本的冻结记录，不混用两版源码、ABI 和地址。

| 目录 | 用途 | 审计范围 |
| --- | --- | --- |
| `sodadex-fragments-production/` | 正式 FABX 适配候选，尚未部署 | 新版收益识别、正式依赖 fork 和回归测试；详见该目录 README |
| `sodadex-fragments/` | v5 专用池、份额金库、LP 分红、国库收入、策略和锁仓 | 冻结源码、必要依赖、测试、编译产物及部署地址；本轮主要审计对象 |
| `sodadex-branding/` | 普通 V3/V4 仓位管理器、NFT 元数据与图像 | 普通 DEX 仍使用，保留原始许可和完整编译输入 |
| `sodadex-orders/` | 限价单结算 | 测试订单服务仍使用，保留源码、签名格式及测试 |
| `mining-rehearsal/README.md` | 已退役挖矿业务的历史说明 | 旧 Solidity、补丁及 Foundry 配置已删除，不属于当前审计对象 |

普通 V2/V3/V4 的 Factory、Pool、Router 上游来源和实际部署记录仍在 `deployments/xlayer-test/`；不能因为源码未在这个目录单独展开，就认为这些依赖可以删除。历史部署、账本与测试回执保留，删除仓库文件不改变链上合约。

v5 审计冻结提交为 [`c5458605bfe8888c9ac6d4dca6912f45f504900a`](https://github.com/sodatrade/SodaDex/tree/c5458605bfe8888c9ac6d4dca6912f45f504900a/contracts/sodadex-fragments)。后续交付请固定实际提交和 `audit-manifest.json`，不要只按分支名判断版本。正式部署由 Owner 执行；[生产接入核验和交付说明](../deployments/xlayer-production/README.md)记录了当前 v5 与正式 FABX 的兼容阻塞，源码合入 main 不等于可以直接部署生产。

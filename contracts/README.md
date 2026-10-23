# SodaDEX 合约审计入口

矿机碎片专用池的本次审计请从 **[v5 源码与复现说明](sodadex-fragments/README.md)** 开始。此目录对应 X Layer 196 上的独立测试部署，不代表生产版本已经批准上线。

| 目录 | 用途 | 审计范围 |
| --- | --- | --- |
| `sodadex-fragments/` | v5 专用池、份额金库、LP 分红、国库收入、策略和锁仓 | 冻结源码、必要依赖、测试、编译产物及部署地址；本轮主要审计对象 |
| `sodadex-branding/` | 普通 V3/V4 仓位管理器、NFT 元数据与图像 | 普通 DEX 仍使用，保留原始许可和完整编译输入 |
| `sodadex-orders/` | 限价单结算 | 测试订单服务仍使用，保留源码、签名格式及测试 |
| `mining-rehearsal/README.md` | 已退役挖矿业务的历史说明 | 旧 Solidity、补丁及 Foundry 配置已删除，不属于当前审计对象 |

普通 V2/V3/V4 的 Factory、Pool、Router 上游来源和实际部署记录仍在 `deployments/xlayer-test/`；不能因为源码未在这个目录单独展开，就认为这些依赖可以删除。历史部署、账本与测试回执保留，删除仓库文件不改变链上合约。

当前交付分支是 `codex/feat/mining-products-1952`，PR 为 [#2](https://github.com/sodatrade/SodaDex/pull/2)。审计请固定该分支的具体提交，不使用未包含本次清理的 `main`。

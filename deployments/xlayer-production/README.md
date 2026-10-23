# SodaDEX 正式部署交给 Owner

本次只准备代码和交付材料。**尚未部署正式合约，没有可供 IGNIX 切换的正式 Pool／Vault／REWARDS 地址。** 域名继续使用 `https://soda.ignix.bot`；合并 main 不会自动切换网站或部署合约。GitHub 原有的上游自动打标签工作流已改为手动触发，避免源码合并直接发布旧的 Uniswap VERSION／RELEASE。

## 已确认的部署职责

- Owner 统一签名和支付正式部署 Gas；本次准备工作不读取部署私钥、不签名、不广播。
- SodaDEX 的 Owner、国库和 Locker 受益人沿用用户最后指定的 `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A`。该地址不等于 FABX 挖矿合约管理员。
- 业务源码与审计对象见 [../../contracts/README.md](../../contracts/README.md)。当前 `contracts/sodadex-fragments` 是已部署的独立测试 v5 冻结快照，不得在原目录静默替换成新的生产适配代码。
- 用户已确认上线界面沿用现有测试站的 React 实现；不切换 main 曾加入的 Svelte 重写。

## 正式依赖及阻塞点

线上来源为 [fabx.tech 的 mainnet 配置](https://api.fabx.tech/v1/pod/mainnet)，逐项只读核验见 [preflight-2026-10-22.json](preflight-2026-10-22.json)。链为 X Layer 196，FAB 精度为 8。

| 角色 | 核验地址 |
| --- | --- |
| 正式 FAB | `0x72F349B1Eee7833B26f8C81a8410775A4e231ed2` |
| 正式挖矿合约 | `0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265` |
| FAB-Genisis 矿机 NFT | `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6` |
| NFT 自身返回的创建工厂 | `0x1f09DAeFA827f02CBb40967cc91b259763760761` |
| FABX 配置中的注册工厂 | `0x82935793a854fA2F2e8A9d2B3F17BbfBf81D6C05` |

这两个 factory 负责不同角色：NFT 是外部工厂创建、再登记到 FABX 工厂。现有 `FabxMinerCustody` 要求传入的 factory 等于 NFT 的 `factory()`，因此不能直接把 API 的注册工厂当作该构造参数。

**当前不能直接部署 v5 的主要原因是 `paidTo(bytes32,address)` 不兼容。** 正式挖矿合约的该调用回滚，而 v5 构造函数和后续收益结算都依赖实际已支付累计数。不得只删除构造函数检查后继续部署，运行时仍然会失败，也会失去原先防重复入账的依据。

接下来需要对正式挖矿合约做 SodaDEX 侧的兼容设计和验证；具体收益识别、第三方代领和 NFT 转入前后的归属必须保持原业务规则。当前证据不授权升级 FABX 合约。本目录没有把该适配标为已完成。

## Owner 在广播前需要拿到的材料

1. 通过正式依赖 fork 测试的适配源码、固定提交、编译器设置及 artifact hash；不能使用测试 FAB、测试 NFT 或测试 Mining。
2. 对实际管理员、国库、矿机容量、初始流动性、初始价格、锁仓期限和 Gas 预算的最终部署参数。测试环境的容量 32、种子 LP 和锁仓期限不能自动当成正式配置。
3. 按 Owner 实际账户和 nonce 预演的部署清单。顺序为 Policy → Vault → Pool（构造中创建 REWARDS／INCOME）→ Locker；Vault 的固定 Pool 地址需预先准确计算，不能在中间插入改变 nonce 的交易。
4. 完整验收：存入与赎回矿机、份额增发／销毁、加减 LP、双向兑换、85%／10%／5% 分账、LP 历史收益、持币领取、国库领取、矿机反例拒绝，以及已有本金与收益的守恒。

Owner 部署后应保留逐笔回执、创建区块、ABI、构造参数、实际 runtime hash 和源码验证结果。旧测试池、用户原有 LP 和债务不会自动迁移。

## 给 IGNIX 的正式交付

部署及验收完成后，由实际回执生成一份新的正式 manifest，包含：chainId、FAB／Mining／NFT／factory、Pool／Vault／REWARDS／INCOME／Policy／Locker、各合约 ABI、fromBlock、Owner／国库、源提交与 runtime hash。地址尚未产生时保持未部署状态，不使用测试地址占位。

IGNIX 再据此切换页面调用与索引；SodaDEX 同步正式网络配置、前端构建、RPC 校验和索引起始区块。定时 harvest 和自动派发是另行部署的后台任务，不能因合约已部署就宣称它们自动运行。

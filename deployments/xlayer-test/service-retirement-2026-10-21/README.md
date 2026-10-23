# 旧挖矿执行服务退役与订单 C2 修复

用户已批准：停用 SodaDEX 旧挖矿执行服务，移除旧入口和绑定，保留历史账本及 LP／金库／分红接口；修复订单 C2 并发布测试。矿机执行业务交由 IGNIX。本次没有链上签名、广播、合约迁移、Owner 或国库修改，也没有 Git 提交或推送。

## 截图问题的核实与处理

| 项目 | 分类 | 预期行为来源与观察 | 本次处理 | 决策归属 |
| --- | --- | --- | --- | --- |
| C2 慢请求体阻塞订单 | confirmed defect | 订单 API 与 alarm 共用 DO；旧实现把读 body 放进串行队列，无总期限。真实本地 workerd 中，旧代码的并发状态查询超时 | 请求体先读取并解析，再排队执行 SQL／业务；复用现有 12 秒 I/O 期限和 16,384 字节上限；查询与 alarm 并发验证通过 | SodaDEX，已批准修复 |
| C3 过期已签交易阻塞 keeper | specification ambiguity | `keeper.ts` 优先恢复原 raw/hash 并返回；当前恢复例外有特定链与哈希限制。改变广播、取消或 nonce 处理需要明确业务授权 | 旧执行服务退役，不扩展重签、取消或广播权限；原 raw/hash、预留保留 | 旧业务由 IGNIX 接管；恢复策略未在本次改动 |
| C5 全量 JSON 行增长 | confirmed defect | `repository.ts` 全量写回，历史记录无上限；本地模拟达到 Cloudflare 行大小上限后写入失败。未证明线上已达上限 | 退役后禁止写入与定时执行，不新增迁移或删除历史；原 namespace 保留 | SodaDEX 已批准退役 |
| C6 重组后项目残留 | unresolved | `directory.ts` 没有独立保存创建区块锚点，但尚未完成完整重组复现 | 旧目录不再注册或刷新；保留历史快照，不声称已修复重组算法 | IGNIX 后续独立核实 |
| C7 未签 challenge 被淘汰 | accepted behavior | `admission.ts` 明确对未验证缓存使用数量上限和淘汰；已验证记录受保护。本地确认仍有效的未签 challenge 可被淘汰 | 不擅自取消缓存上限；旧 admission 停止 | 旧业务策略，不属于本次缺陷修复 |

Cloudflare 行大小限制依据：[Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)。C5 的模拟限制证据不能当作线上存储用量证明。

## 当前行为

- 主站顶部移除旧“矿机交易”入口；196 DEX 和矿机碎片专用 LP 继续保留。
- 主站 `/mining`、`/mining/*`、`/api/mining/*` 与旧 1952 前端返回 410。网关配置移除 MINING_API／MINING_API_196 Service Binding；未创建不存在的 196 旧前端。
- 1952、196 两个旧后台启用 `MINING_SERVICE_RETIRED=true`，覆盖旧 admission/execution 开关且不加载签名适配器；alarm 只删除定时安排。仅保留私有无查询参数的状态／项目快照读取。
- 原 Worker 名称、DO 类和 namespace、累计费用与预留、历史 signed raw/hash 保留。没有删除已部署合约或账本。
- 订单体超时返回 408，超长返回 413；取消流本身不延长等待。只有已解析的业务操作进入原串行队列，继续保护 SQL、nonce、预算与 keeper。
- 订单来源显式增加 `https://soda.ignix.bot`，同时保留原 workers.dev 来源，不开放通配符。

## 验证边界

订单 74 项、旧挖矿服务 102 项、网关 222 项单元／服务测试通过，相关 typecheck 与 lint 通过。前端最终 518 项通过，27 项因缺少可选链上 fixture 跳过，typecheck／lint／构建通过。减少的 6 项是随入口退役移除的旧矿机导航用例。

真实本地 workerd/SQLite 额外验证：未完成请求体不阻塞状态查询或实际 alarm；退役服务拒绝写入、清除 alarm、完整 SQL 行原样保留、没有外部请求且不使用签名凭据。不是本轮真实链上交易验收。

线上版本、接口检查、预算和 namespace 对比见同目录 `release.json`。1952 公开历史快照能核对账本与执行哈希；196 私有后台不新增公开诊断入口，其线上证据限于已部署代码、开关、namespace 与预算配置，存储不变由本地运行时验证补足。

## 后续维护

部署沿用原 migration tag，使用 `--keep-vars` 保留线上预算、签名地址与 manifest，并显式 `--durable-objects-code-update-mode immediate`。不能仅凭上传成功判断退役已生效。

不要回退旧挖矿后台到仍启用执行的历史版本，也不要删除 namespace、清空 raw/hash 或重置费用来恢复。需要恢复业务时应单独确认其归属与原账本状态。订单修复不改变 settlement 或 maker nonce，主站继续使用碎片测试发布配置。生产合约保持不动。

专用池／金库／分红合约的续审另见本机 `/Users/LevyHoo/Downloads/IGNIX-contract-security-2026-10-21.md`；该报告中的合约问题不因这次后台退役而视为已修复。

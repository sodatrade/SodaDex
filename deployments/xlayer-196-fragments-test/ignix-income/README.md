# IGNIX 联调：新版矿机碎片专用池

网络：X Layer 196。以下均为独立测试合约，使用测试 sFAB 和 TEST-FAB；Gas 使用真实 OKB。生产合约未变。

| 用途 | 地址 |
| --- | --- |
| 矿机专用池 / LP 代币 | `0x5d98189f79234d5f988ea5b94641c3b04b0a7866` |
| 国库收入账本 INCOME | `0x2004FE0f7F023c24CB826F157235D5d3418B51c8` |
| LP 的 70% OKB 收益账本 REWARDS | `0xd64904EDdF64D92178dfaB9e6d0E926D6b520Ca0` |
| LP Locker | `0x000ad39076dc89150c27c6e2bf2fe5bca5899f18` |
| 现有测试 sFAB / 金库（复用） | `0xb97d23f0c874fc1380016fa31d975d7ccd13b94d` |
| 现有 TEST-FAB（复用，8 位小数） | `0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab` |
| IGNIX 国库（固定收款人） | `0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A` |

## 向池子加钱和兑换

- 添加：先给 Pool 有限授权 sFAB，再调用 `addLiquidity(sharesDesired, minShares, minOkb, deadline)`，同时附带原生 OKB。已有池按比例配对，多余 OKB 退回；LP 发给调用者。
- 移除：调用 `removeLiquidity(lp, minShares, minOkb, deadline)`，销毁自己的 LP，取回 sFAB 和 OKB。本金与手续费收益分别记账。
- 兑换：`swap(shareIn, amountIn, minOut, deadline)`。`shareIn=false` 表示付 OKB 买 sFAB，需附带对应 OKB；`shareIn=true` 表示卖 sFAB，需要有限授权。
- 报价与最少到账以当前链上读取和模拟为准。不要直接转币到合约来代替添加流动性。

## 手续费和 FAB 分给谁

专用池总交易费 0.5%，以 OKB 计算。手续费中的 30% 进入 INCOME，最终转给 IGNIX 国库；70% 留在 REWARDS，属于收益发生时的 LP 持有人。普通 V2/V3/V4 不适用这套分账。

池子持有 sFAB 获得的净 FAB 进入 INCOME，转给同一个 IGNIX 国库，再由 IGNIX 分给对应 LP。SodaDEX 不重复扣挖矿的 5% / 10%，不改矿机质押和金库业务。

owner 支付 Gas，依次调用 `Pool.harvest()`、`INCOME.claimPlatformOkb()`、`INCOME.claimLpFab()`。两个领取接口也允许别人代付 Gas，但只能打给固定国库，不能改收款人。转账失败保留原债权。查询 `platformOkbOwed()` / `lpFabOwed()` 看当前待转金额。

LP 的 70% OKB 可用 `REWARDS.claimable(account)` 查询、`REWARDS.claimFor(account)` 领取；该接口只能付给对应账户。Locker 持有的部分由 Locker 的收益流程领取，锁仓不妨碍领取收益。

## IGNIX 怎样给 LP 分 FAB

按区块、交易顺序、日志顺序索引 `INCOME.LpFabRecorded(amount, lpSupply, cumulativeAmount)` 和 Pool 的 `Transfer`。FAB 记账事件发生在 LP 增发、销毁或转移之前，因此按收益发生时的持有人分配；不能在国库提现时才查看 LP 余额。

Locker 的 LP 归到当时的受益人，受益人更换前的收益仍归原人。`lpSupply=0` 的记录单独留账，不分给后来加入的 LP。用链 ID、交易哈希、日志序号去重；链重组时回滚对应记录。

## 这轮验收结果

14 笔成功：部署新池与 Locker、有限授权、首次添加、追加、买入、卖出、部分移除、TEST-FAB 入账、两笔国库付款、剩余 LP 锁仓。真实 Gas 0.000200408901 OKB，累计原生投入 0.00000003301 OKB，合计 **0.000200441911 OKB**，低于批准的 0.00039 OKB。投入按转出累计，撤回资金不恢复预算。

国库本轮收到 19502 wei OKB 和 1107294 raw TEST-FAB（0.01107294 TEST-FAB）。最后锁 LP 又产生 372752 raw（0.00372752 TEST-FAB）待转国库；平台 OKB 待转余额为 0。LP 收益账本留有 45505 wei OKB，覆盖全部 45505 wei 负债；原持有人可领 45504 wei，另有 1 wei 舍入余量。以上为验收区块 73802505 的状态。

14 笔交易已逐笔独立复核。追加流动性交易所在区块的哈希后续改变，原交易仍在当前区块内成功、金额和费用均未变化；原账本保留旧记录，`verification.json` 补充当前区块哈希，没有重播该交易。新 Locker 于 2026-10-21 08:32:21 UTC 锁定，2026-12-20 08:32:21 UTC 解锁。

旧池和旧 Locker 保留。不能用旧池 `0x39fa6467abac258ee61acc18ff6c7910a52af92e` 代替本次新池联调。新池的产品版本号是 `SodaDEX.OKB.Fragments.v4`，这是专用合约修订号，不是 Uniswap V4。

完整 ABI 与绑定信息见上一级 `integration.json`，交易回执见本目录 `public-journal.json`，独立核验见 `verification.json`。

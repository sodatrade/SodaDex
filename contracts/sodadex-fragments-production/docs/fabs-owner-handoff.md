# FABS 独立代币部署与 IGNIX 接入

状态：用户指定由 owner 部署；独立 FABS 源码尚未实现，尚未广播，无 CA。2026-10-23。

用户要求先部署独立 FABS，再交付 CA 和接入说明，后续将部署执行交由 owner。本文件记录拆分要求；权限方案尚待本轮确认，不能当作已部署 ABI。

## 当前实现与拆分范围

核对 IGNIX origin/develop f0ca687：MirrorVault 自身继承 ERC20，构造器把 symbol 固定为 sFAB。deposit 用内部 _mint，赎回用内部 _burn；分红、锁定余额、总供应量都直接读自身 ERC20 状态。

因此独立 FABS 的接入不是替换一个地址：金库需要把余额和供应量改读外部代币，铸造销毁改为调用外部代币，同时保留每次转账前的历史收益结算与赎回锁定检查。

## 待确认的部署权限方案

建议初始供应量为零；owner 使用用户已指定的 0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A，仅能一次性绑定金库。绑定后只有该金库能增发／销毁，owner 不能直接增发或更换金库。若用户选择直接永久绑定，需要新金库的准确地址。

在该方案明确前不生成不可逆的部署交易，不复用以前测试批次的 Gas 授权。

## 同事需要改的职责

1. 金库是矿机准入、算力、赎回锁定、分红的唯一业务状态持有人。代币负责 ERC20 余额、授权和供应量；不得复制矿机定价或分红规则。
2. deposit 确认收到合格矿机并计算份额后，调用 FABS 的受限铸造入口；赎回按既有申请和结算流程调用受限销毁入口。初始不预铸，不给 owner 任意增发入口。
3. 把金库内用于份额的 balanceOf 和 totalSupply 统一改读 FABS。FAB 收益币的余额读取保持不变，不能把 FAB 与 FABS 混淆。
4. FABS 的 transfer、transferFrom、mint、burn 均在余额变化前通知金库；金库读取旧余额，先检查 lockedShares、更新收益并结算 from/to，随后代币才改变余额。回调必须只认已绑定的 FABS。
5. 回调失败必须整笔回滚。deposit/redeem 中代币回调金库属于预期调用路径，需要测试重入保护边界，不能简单在所有入口堆叠同一 nonReentrant 导致铸造销毁全失败。
6. LP 池原本把 VAULT 同时当份额币和业务金库；SodaDEX 也必须拆分“金库地址”和“FABS 地址”。转账、余额和 allowance 操作访问 FABS；harvest、POLICY、权重、历史周期操作访问金库。单独改 IGNIX 还不能完成接入。
7. 历史 LP 分红沿用[历史 LP 收益接口说明](mirror-lp-rewards-integration.md)的周期接口要求；独立 token 不替代那部分修复。

## 部署后交付应包含

chainId=196、实际部署交易哈希、CA、验证过的 name/symbol/decimals/totalSupply、owner 与金库绑定状态、已部署 ABI 和源码版本、实际 Gas 支出，以及基于最终 ABI 更新的调用示例。

当前上述链上字段均未产生。不得将预测地址当作已部署 CA；绑定前无已背书流通份额，也不应宣传质押、分红已可用。

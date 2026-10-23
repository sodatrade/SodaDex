#!/usr/bin/env python3
"""Product decision report; render only, never apply fee configuration."""
from pathlib import Path
from html import escape
out = Path(__file__).resolve().parents[2] / 'deployments/fees/checklist.html'
groups=[('募资分红：交易和收益怎么收费', [('发行项目费', 'FAB → 平台；现有发行流程按募资币收费', '0', '每次发行收多少 FAB（可为 0）；如要改收费币种，另行决定'), ('募资曲线买卖费', '买入：从支付的 FAB 扣；卖出：从换得的 FAB 扣 → 平台', '买 1%／卖 1%', '买、卖分别收多少；与曲线阶段买卖税分别扣取'), ('项目代币买卖税', '曲线阶段扣 FAB：买入扣支付额，卖出扣换得额 → 税款金库', '买 1%／卖 1%', 'PRD 双侧 1%–10%，默认各 1%；毕业后扣币方式见下一项'), ('毕业后项目币买卖税', '买入：从收到的项目币扣；卖出：从付出的项目币扣 → 税款金库，再换 FAB', '买 1%／卖 1%', '确认沿用现有 V2 扣项目币方式；若要统一扣 FAB，需另定并改实现'), ('税款怎么分', '按金库实际到账的 FAB 分配；毕业后收的项目币先换成 FAB', '平台取税款 1%；发币人取剩余部分 0%；余款买矿机', 'PRD 平台 1%–10%、创作者取余款 0%–50%；转换影响实际到账 FAB'), ('矿机收益服务费', '从实际挖出的 FAB 扣 → 平台；余下 FAB 分给持有人', '0%', 'PRD 默认平台 5%；调费边界待定，非零扣费待实现验证'), ('毕业后的交易池费', '买入项目币扣 FAB；卖出项目币扣项目币。费用留在池内归 LP', 'V2 池 0.3%', '是否沿用 V2 0.3%；另有项目币买卖税，不能简单相加当作到手比例'), ('毕业锁定 LP 的收入分成', '领取所得可同时有 FAB 和项目币，分别按比例分给平台与发币人', '平台 50%／发币人 50%', '两方各分多少；是否统一换成 FAB 再支付另定'), ('V2 协议抽成', '通过增发 LP 份额给协议钱包实现；不是直接再扣用户一笔 FAB', '关闭', '是否开启、收款钱包；兑现所得可含 FAB 和项目币'), ('开盘防抢跑附加费', '曲线阶段买入从支付的 FAB 扣 → 平台；创建时首笔买入豁免', '关闭', '是否启用、起始费率、持续多久；测试关闭')]), ('矿机碎片：买卖、存取和分红', [('碎片买卖费', '买碎片：扣 FAB；卖碎片：扣碎片币。来自本次输入金额', '买、卖各 0.5%', 'PRD 已定各 0.5%；不另叠 V2 0.3%'), ('碎片交易费分成', '买入费按 FAB 分；卖出费按碎片币分 → 平台和 LP', '平台 30%／LP 70%', 'PRD 已定平台 30%／LP 70%；平台是否换成 FAB 另定'), ('碎片挖矿收益服务费', '从实际挖出的 FAB 扣 → 平台；余下 FAB 用于分红', '0%', 'PRD 已定 10%；测试零费不代表生产费率'), ('存入／赎回矿机费', 'PRD 已定不收产品费；用户自行支付 OKB Gas', '存入 0%／赎回 0%', 'PRD 已定存取免费；用户付 Gas，赎回销毁份额不算手续费')]), ('普通兑换和限价单（按 FAB／项目币说明）', [('V3／V4 池交易费', '若为 FAB／项目币：买入扣 FAB，卖出扣项目币 → LP', '已有 196 测试池：V3 0.01%，V4 0%', '按池设费率；这里只说明扣币方式，不代表当前带税项目币已支持 V3／V4'), ('V3 协议抽成', '从输入币的池手续费中分取：买入 FAB，卖出项目币 → 平台', '测试配置关闭', '是否开启、分取比例；不在已有池费之外再收'), ('V4 协议费', '从输入币扣：买入 FAB，卖出项目币 → 平台', '测试配置 0%', '各方向费率；与 LP 费共同计入报价'), ('页面额外服务费', '待定：扣输入币、输出币，还是统一收 FAB', '0%', '是否收费、费率、扣费币种及基数；当前不收'), ('限价单佣金', '待定：成交时扣 FAB 或项目币；当前不收佣金', '0%', '是否收费、费率、扣输入或输出；成交池费用仍适用')])]
css=''' :root{--ink:#18352d;--muted:#5e7069;--line:#dce7e0;--accent:#18734e}*{box-sizing:border-box}body{margin:0;background:#f4f8f5;color:var(--ink);font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{overflow-wrap:anywhere;max-width:1120px;margin:32px auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:44px 48px}h1{font-size:32px;line-height:1.35;letter-spacing:-.6px;margin:10px 0 16px}h2{font-size:22px;margin:0 0 14px}p{margin:8px 0 14px}.eyebrow{font-size:13px;color:var(--accent);letter-spacing:1px}.lead{font-size:18px}.muted,small{color:var(--muted);font-size:13px}nav{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}a{color:var(--accent);text-underline-offset:4px}section{border-top:1px solid var(--line);margin-top:28px;padding-top:26px}table{border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed}th,td{padding:13px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#edf6f0;font-weight:600}th:nth-child(1){width:20%}th:nth-child(2){width:25%}th:nth-child(3){width:23%}th:nth-child(4){width:32%}td:first-child{font-weight:600}.fill{display:block;color:#6b7b73;font-size:12px;margin-top:6px}.callout{background:#f0f7f2;border-left:3px solid var(--accent);padding:14px 18px;margin:20px 0}.callout p{margin:0}.checklist{padding-left:22px}.checklist li{margin:10px 0}.sign{padding:18px 0;line-height:2.3}.sources{font-size:12px;color:var(--muted);overflow-wrap:anywhere}[contenteditable]{background:#fff;border:1px solid #cdded3;border-radius:6px;padding:8px;min-height:54px}[contenteditable]:focus{outline:2px solid var(--accent);outline-offset:2px}.flow-list{list-style:none;padding:0;max-width:850px;margin:18px auto}.flow-list li{position:relative;border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin:0 0 30px;background:#f8fcf9}.flow-list li:not(:last-child):after{content:"↓";position:absolute;bottom:-29px;left:50%;color:var(--accent);font-size:22px}.flow-list p{margin:4px 0 0}.flow-list li{break-inside:avoid}summary{cursor:pointer;padding:10px 0}a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}@media(max-width:680px){main{margin:10px;padding:24px 18px;border-radius:10px}h1{font-size:26px}h2{font-size:20px}thead{display:none}table,tr,td,tbody{display:block;width:100%}tr{padding:12px 0;border-bottom:1px solid var(--line)}td{padding:4px 0;border:0}td:first-child{font-size:16px;margin-bottom:5px}td:not(:first-child):before{content:attr(data-label) '：';font-weight:600;color:var(--muted)}.fill{margin:5px 0}nav{gap:10px}}@media print{body{background:#fff;font-size:12px}main{max-width:none;border:0;margin:0;padding:0}nav,details{display:none}h1{font-size:26px}h2{font-size:18px}table{font-size:11px}th,td{padding:8px}tr{break-inside:avoid}section{margin-top:20px;padding-top:18px}h2{break-after:avoid}.callout{break-inside:avoid}}'''
parts=['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SodaDEX｜生产收费决策单</title><style>'+css+'</style></head><body><main>',
'<header><div class="eyebrow">SODADEX · 产品决策 · 2026 年 10 月 19 日</div><h1>正式上线，哪些钱要收、怎么分？</h1><p class="lead">请产品逐项确认：<strong>收不收费、收多少、分给谁。</strong><br>先看两套流程，再核对 PRD 已定基线、填写生产待确认事项。测试值仅供参考，不会自动用于生产。</p><p class="muted">范围：SodaDEX 的矿机募资发行、碎片交易，以及相关 DEX 收费。FAB 原有 CPU、晶体管、流片和矿机市场规则已定，不在本次决策范围。LP 指向交易池提供资金的人。</p><div class="callout"><p><strong>已确定事项：募资使用 FAB，交易对为 FAB／项目币。</strong><br>每个募资项目以自己发行的项目币与 FAB 配对。例如项目发行 A 币，则交易对为 FAB／A；用户用 FAB 买入 A，卖出 A 换回 FAB。<br>FAB 合约地址：<code>0x72f349b1eee7833b26f8c81a8410775a4e231ed2</code><br><small>地址由项目方提供；仅确认募资资产，不代表各项手续费也统一用 FAB 支付。所属网络与代币信息在部署接入前核验。</small></p></div></header>',
'<div class="callout"><p><strong>先分清三笔钱：</strong>用户交的手续费、手续费内部的分成、付给网络的 Gas。<br>“平台拿手续费的 30%”不等于“向用户收成交额的 30%”；Gas 不属于平台收入。</p></div>',
'<nav aria-label="目录">'+''.join(f'<a href="#s{i}">{title.split("：")[0]}</a>' for i,(title,_) in enumerate(groups,1))+'<a href="#common">共同规则</a></nav>']

summary_rows = [
('发行项目费','FAB（沿用现有流程）','每次 ____ FAB／免费','平台；收款钱包 ____'),
('募资曲线买卖费','买、卖都扣 FAB','买 ____%；卖 ____%','平台；收款钱包 ____'),
('曲线阶段买卖税','买、卖都扣 FAB','买 ____%；卖 ____%','进入税款金库，按下项分配'),
('毕业后买卖税','现有流程扣项目币，再换 FAB；是否沿用 ____','买 ____%；卖 ____%','进入税款金库，按下项分配'),
('税款分成（不是新增收费）','按金库实际收到的 FAB 分','平台 ____%；发币人取剩余部分的 ____%','平台、发币人；余款用于买矿机'),
('募资项目收益服务费','从挖矿 FAB 收益中扣','____%／免费','平台；余款分给合格持有人'),
('毕业后 V2 池交易费','买项目币扣 FAB；卖项目币扣项目币','____%（现有 0.3%，待确认）','流动性提供者（LP）'),
('锁定 LP 收入分成','FAB、项目币分别分；统一换 FAB？____','平台 ____%；发币人 ____%（合计 100%）','平台、发币人；非成交额分成'),
('V2 协议抽成','通过 LP 份额分配；兑现可含 FAB、项目币','开／关 ____；沿用标准规则？____','协议收款钱包 ____'),
('开盘防抢跑附加费','现有曲线买入扣 FAB','开／关 ____；起始 ____%；持续 ____','现有归平台；生产确认 ____'),
('碎片买卖费','买碎片扣 FAB；卖碎片扣碎片币','买 ____%；卖 ____%','平台 ____%；LP ____%（合计 100%）'),
('碎片收益服务费','从挖矿 FAB 收益中扣','____%／免费','平台；余款用于持有人分红'),
('存入／赎回矿机费','当前免费；若收费，币种 ____','存入 ____；赎回 ____；计费基数 ____','收款对象 ____'),
('普通 V3／V4 池交易费','按输入币：买入 FAB；卖出项目币','V3 ____%；V4 ____%','LP；带税项目币兼容性须另验证'),
('V3 协议抽成','从原池手续费中分取同一种币','开／关 ____；分取 ____','平台；收款钱包 ____'),
('V4 协议费','按输入币：买入 FAB；卖出项目币','买 ____%；卖 ____%','平台；收款钱包 ____'),
('页面额外服务费','待定：输入币／输出币／FAB ____','____%／免费；计费基数 ____','平台／其他 ____'),
('限价单成交佣金','待定：FAB／项目币 ____','____%／免费；扣输入／输出 ____','平台／其他 ____'),
]
summary_rows = [row for row in summary_rows if row[0] not in {'曲线阶段买卖税', '毕业后买卖税', '税款分成（不是新增收费）', '募资项目收益服务费', '碎片买卖费', '碎片收益服务费', '存入／赎回矿机费'}]
summary = '<section id="decisions"><h2>待产品补充：生产上线确认表</h2><p>下表为 PRD 未明确或需要部署前补充的事项。已定收费基线单列在前面，不重复要求定价。币种与收款对象注明“现有”或“沿用”的，是当前实现口径，不等于生产批准；可填写“沿用”或写出新方案。<strong>免费请填 0，分成不是再收费。</strong></p><p class="muted">点击白色填写区域可编辑，完成后打印为 PDF 留档；页面刷新不会保存填写内容。各项机制与测试参考值在后面的说明中。</p><table><thead><tr><th>待拍板事项</th><th>收什么币</th><th>生产费率／金额</th><th>分给谁</th></tr></thead><tbody>'
for row in summary_rows:
 summary += '<tr>' + ''.join('<td data-label="'+label+'">'+(escape(value) if j==0 else '<div contenteditable="true" role="textbox" aria-label="'+escape(row[0]+'：'+label)+'">'+escape(value)+'</div>')+'</td>' for j,(value,label) in enumerate(zip(row,['待拍板事项','收什么币','生产费率／金额','分给谁']))) + '</tr>'
summary += '</tbody></table><p><strong>本表确认：</strong>确认人 __________　日期 __________　适用版本 __________</p><p class="muted">尚未决定的项请标“待定”，不视作免费或允许上线。Gas 补贴及自动执行成本见文末共同规则。</p></section>'
baseline = '<section id="baseline"><h2>PRD 已定：两种业务与收费基线</h2><p><strong>募资分红：</strong>发行项目币，用交易税采购共享矿场的矿机；项目币不是单台矿机的碎片。<br><strong>矿机碎片：</strong>先存入矿机 NFT，再按算力发行整个金库的份额；无募资成功或失败阶段。首次 1 点基础权重兑换 1,000 份，后续按金库比例发行。</p><table><thead><tr><th>事项</th><th>扣费币种</th><th>PRD 基线</th><th>分配与状态</th></tr></thead><tbody>'
for row in [
 ('募资项目买卖税','曲线期 FAB；现有毕业后 V2 扣项目币，再换 FAB','双侧各 1%–10%；默认各 1%','创作者在范围内选择，创建时锁定'),
 ('募资税款分配','实际收到的 FAB 税款','平台取税款 1%–10%（默认 10%）；创作者取余款 0%–50%（默认 10%）','剩余进入共享矿场；不是新增收费'),
 ('募资挖矿收益','FAB','平台默认 5%，持有人 95%','PRD 允许调费；权限、上下限及存量生效规则待定；测试未启用此扣费'),
 ('碎片买卖费','买入扣 FAB；卖出扣碎片币','各 0.5%；平台 30%／LP 70%','按输入币计费，不再叠加一层 AMM 费'),
 ('碎片收益服务费','实际领取的 FAB 收益','平台 10%，余下 90% 分红','PRD 已定；当前测试零费，生产非零扣费尚需实现验证'),
 ('碎片存入／赎回','不收产品手续费；网络 Gas 用 OKB','产品费 0','赎回销毁份额不是手续费'),
 ('碎片分红发放','FAB；网络实际 Gas 为 OKB','约 1 USD 门槛，每日自动分发；否则手动领取','自动 Gas 从分红扣；手动 Gas 用户付。换算、上限及失败处理待补；当前未完整实现')
]:
 baseline += '<tr>'+''.join('<td data-label="'+label+'">'+escape(v)+'</td>' for v,label in zip(row,['事项','扣费币种','PRD 基线','分配与状态']))+'</tr>'
baseline += '</tbody></table><p class="muted">依据：募资分红 V1.5 §0、§6；碎片化 V1.2 §3、§5。PRD 已定不等于生产已部署；本次不改测试费率或生产配置。若产品要改基线，应明确记录变更。</p></section>'
flows = '<section id="flows"><h2>先看懂：两份 PRD 是两条不同的路</h2><p><strong>这里的“金库份额币”专指 V1.2 矿机碎片金库发行的 ERC-20 币。</strong>它代表同一个金库内合格矿机的共同权益，不绑定原来那一台 NFT，也不是 V1.5 的项目币。</p>'
for title, intro, steps, exit_note in [
 ('V1.5 募资分红：发项目币，用交易税买矿机', '适合发行项目的团队和买项目币的用户。用户买的是项目币 A；矿场分红是它附带的权益。', [
 ('① 发行项目币 A', '发行方创建 FAB 计价的项目；用户支付 FAB 买 A，也可卖 A 换回 FAB。'),
 ('② 从交易中收税', '只把税款中扣除平台与创作者分成后的余款注入矿场，不是把用户全部买币本金拿去买矿机。'),
 ('③ 共享矿场记账并采购', '按项目实际注入的 FAB 记录矿场内部份额；多个项目共享矿场，资金足够时采购合格矿机，NFT 由矿场合约持有。'),
 ('④ 挖矿产出 FAB', '先按各项目的矿场份额分配收益，再按项目内合格持有人权重分红；烧币加权是该项目的规则。'),
 ('⑤ 用户领取 FAB', '项目币持有人手动领取已结算分红。测试补充规则：矿机购入后就累计收益，不等毕业才开始。')
 ], '退出：用户卖出项目币 A。项目的矿场内部份额不能转让或撤资，持有 A 不能赎回整台矿机。毕业指进入后续交易阶段，不是单台矿机募资成功。'),
 ('V1.2 矿机碎片：先存矿机，再发行共同金库份额', '适合已有矿机的矿主，以及想小额持有矿机份额的用户。FABX 金库用 FAB 交易和分红。', [
 ('① 矿主存入矿机 NFT', '先结算旧收益并校验准入；NFT 转入碎片金库合约保管。只让合格、同质的矿机进入同一金库。'),
 ('② 给矿主发行份额币', '首次 1 点合格基础权重换 1,000 份；之后按新增权重占金库权重的比例发行。份额代表整个金库，不是一机一币。'),
 ('③ 建 FAB／份额币交易池', '项目方提供 FAB 和有真实矿机背书的份额作为初始流动性；普通用户支付 FAB 买份额，卖出份额换 FAB。买卖资金进入交易池，不是自动采购预算。'),
 ('④ 金库统一收取挖矿收益', 'FAB 收益按各时段份额归属累计；卖出前已产生的分红仍归原持有人。池内份额的收益归对应 LP。'),
 ('⑤ 领取收益或赎回矿机', '份额持有人领取 FAB；也可凑足份额并销毁，取回一台符合条件的完整 NFT。')
 ], '退出：卖出部分或全部份额，或销毁足额份额赎回合规矿机。不要求原存入者，也不保证取回原来那台；没有“募满才托管”和“失败退款”阶段。')
]:
 flows += '<h3>'+title+'</h3><p>'+intro+'</p><ol class="flow-list">'+''.join('<li><strong>'+head+'</strong><p>'+body+'</p></li>' for head,body in steps)+'</ol><div class="callout"><p>'+exit_note+'</p></div>'
flows += '<h3>三种名称不要混用</h3><table><thead><tr><th>名称</th><th>属于哪套</th><th>用户能否买卖</th><th>代表什么</th></tr></thead><tbody><tr><td>项目币 A</td><td>V1.5 募资分红</td><td>可以，用 FAB 买卖</td><td>项目代币及按规则分红的资格；不能据此赎回矿机</td></tr><tr><td>项目的矿场内部份额</td><td>V1.5 共享矿场</td><td>不可以转让或撤资</td><td>项目注入采购资金后，在共享矿场收益中占多少</td></tr><tr><td>矿机碎片份额币</td><td>V1.2 碎片金库</td><td>可以，用 FAB 买卖</td><td>整个对应金库的共同矿机权益，可按规则销毁赎回 NFT</td></tr></tbody></table><p class="muted">流程图说明 PRD 的产品设计，不代表每个生产功能已实现。非零收益收费、自动分红扣 Gas 等缺口见基线表；BEM 分支仍按此前决定后补。</p></section>'
parts.insert(2, flows + baseline + summary)



for i,(title,rows) in enumerate(groups,1):
 parts.append(f'<section id="s{i}"><h2>{i}. {title}</h2><table><thead><tr><th>收费项</th><th>扣什么币／分给谁</th><th>测试参考</th><th>生产确认／调整</th></tr></thead><tbody>')
 for row in rows:
  parts.append('<tr>'+''.join(f'<td data-label="{label}">{escape(value)}'+('<span class="fill">上线复核／变更：________________</span>' if j==3 else '')+'</td>' for j,(value,label) in enumerate(zip(row,['收费项','扣什么币／分给谁','测试参考','生产确认／调整'])))+'</tr>')
 parts.append('</tbody></table>')
 if i==1: parts.append('<p class="muted">分成示例（按测试规则）：税款金库直接收到或转换后实际收到 100 FAB → 平台 1 FAB，发币人 0 FAB，买矿机预算 99 FAB。这里分的是已收到的税款。</p>')
 if i==2: parts.append('<p class="muted">收费示例（按测试规则）：输入 100 FAB → 手续费 0.5 FAB，其中平台 0.15 FAB、LP 0.35 FAB。</p>')
 parts.append('</section>')
parts.append('''<section id="common"><h2>4. 一起确认这 4 条规则</h2><ol class="checklist">
<li><strong>收款与分账：</strong>每种平台收入由谁收？发币人、LP 的收入如何领取？明确正式收款钱包，不沿用测试钱包。</li>
<li><strong>自动执行成本：</strong>限价单、税款转换、采购矿机和收益结算的 Gas，碎片分红按 PRD 从用户分红扣 Gas；其他服务逐项确认承担方，并补充换算方式及上限。X Layer 网络 Gas 用 OKB 支付；如向用户收回成本，用 FAB 还是其他币需产品决定。</li>
<li><strong>以后调费：</strong>谁能改、最高多少、提前多久告知、是否影响旧项目和旧挂单？部分参数创建后固定，不能默认随时可改。</li>
<li><strong>无合格持有人期间的收益：</strong>目前单独保留，不给后来买家或平台。生产归属仍由产品决定。</li>

</ol></section>
<div class="callout"><p><strong>决定“免费”请明确写 0，不要留空。</strong><br>曲线买卖费、V2 池费、锁定 LP 分成、碎片费及其分成等，当前有固定规则；部分新增收费尚无实现。产品定案后由 Codex 调整、验证，再进入生产部署，不是填写后立即生效。</p></div>
<section><h2>产品确认</h2><div class="sign">确认人：________________　确认日期：________________<br>适用版本／上线批次：________________________________<br>未决事项：________________________________________________</div>
<p class="muted">本页是决策材料，不是生产配置。没有修改费率、收款地址或任何生产合约。</p>
<details><summary>参考口径</summary><p class="sources">2026-10-19 核对仓库中的生产待定清单、1952／196 测试费率配置、费用校验规则，以及已有 196 V3／V4 测试池部署记录。测试列是已保存配置或部署记录，不代表本次重新做了链上逐项核验。普通 V3／V4 参考值来自已有 OKB 相关测试池，不是 FAB／项目币生产池的已定费率。普通 V3 测试池采用部署记录中的 0.01%，未将统一测试配置中的 0% 计划值当作已部署值。</p><p class="sources">依据：production-pending.json、test-1952.json、test-196.json（deployments/fees）；deployments/xlayer-test/pools.json；scripts/sodadex/fee_policy.py；SodaLimitSettlement.sol；另核对现有 CurveTrading、IgnixManager、IgnixToken、MiningProjectVault、MiningRevenueVault、FabFragmentPool 与 IgnixV2Locker 源码中的扣币及分账路径。现有实现用于说明机制，不视作生产费率批准。</p></details></section></main></body></html>''')
out.write_text('\n'.join(parts));print(out)

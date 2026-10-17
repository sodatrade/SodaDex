#!/usr/bin/env python3
"""Render the product fee checklist from the local profiles; no network or wallet access."""

from decimal import Decimal
from html import escape
from fee_policy import PROFILES, ROOT, inspect_profile, read_profile


def amount(value, divisor, suffix):
    if value is None:
        return "待产品确认"
    return format(Decimal(value) / Decimal(divisor), "f") + suffix


def table(rows):
    body = ""
    for row in rows:
        cells = []
        for cell in row:
            first, _, rest = cell.partition("\n")
            content = escape(first)
            if rest:
                content = '<strong>' + content + '</strong><br><span class="cell-note">' + escape(rest) + '</span>'
            cells.append('<td>' + content + '</td>')
        body += '<tr>' + ''.join(cells) + '</tr>'
    return ('<div class="table-wrap" tabindex="0" aria-label="费用表，窄屏可左右滑动"><table><thead><tr>'
            '<th scope="col">收什么钱，给谁</th><th scope="col">测试怎么设</th><th scope="col">正式上线前要定什么</th>'
            '</tr></thead><tbody>' + body + '</tbody></table></div>')


def render():
    test, production = read_profile(PROFILES["test"]), read_profile(PROFILES["production"])
    test_check, production_check = inspect_profile(test, "test"), inspect_profile(production, "production")
    if not test_check["valid"] or production_check["errors"]:
        raise ValueError("Invalid fee profiles; check parameters before rendering the checklist")
    t, p = test["fees"], production["fees"]

    def rate(group, key, divisor=100):
        return amount(t[group][key], divisor, "%")

    def prod(group, key, decision, divisor=100):
        return amount(p[group][key], divisor, "%") + "\n" + decision

    mining = [
        ("创建项目时一次收取的发行费 → 平台",
         amount(t["mining"]["listingFeeRaw"], 10**8, " TEST-FAB") + "（测试计划）\n可以免费发行；和买卖时收费分开。",
         "待产品确认\n每次发行收多少，创建时一次结清，不追补已经发行的项目。"),
        ("刚开盘买入的防抢跑附加费 → 平台",
         "关闭（测试计划）\n不会在普通买税和平台交易费之外，再加这项开盘附加费。",
         "待产品确认\n是否启用；如启用，起始为 20%–90%，按设定时长降到零，且与其他买入费合计不得超过 95%。"),
        ("毕业前买卖的平台交易费 → 平台",
         "买 " + rate("mining", "curveBuyPlatformBps") + "，卖 " + rate("mining", "curveSellPlatformBps") + "\n现有发行模块固定收取，和下面的代币税分开；不能只改配置设成零。",
         "待产品确认\n是否沿用这项 1% 固定费用；若要减免，需要修改发行合约并重新验证。"),
        ("买卖代币时收的税 → 税收金库",
         "买 " + rate("mining", "buyTaxBps") + "，卖 " + rate("mining", "sellTaxBps") + "\n这是源码允许的最低值；发行和收税已在本地跑通，尚未部署。",
         "买：" + amount(p["mining"]["buyTaxBps"], 100, "%") + "；卖：" + amount(p["mining"]["sellTaxBps"], 100, "%") + "\n买税、卖税分别在 1%–10% 内确定，创建项目时锁定。"),
        ("平台从税款里分走多少 → 平台",
         "实际税款的 " + rate("mining", "protocolShareOfTaxBps") + "\n实际税款分账、进入矿场采购已在本地跑通，尚未部署。",
         prod("mining", "protocolShareOfTaxBps", "从实际收到的税款中分 1%–10%，不额外向交易者收一次。")),
        ("发币人从剩余税款里分走多少 → 发币人",
         "剩余税款的 " + rate("mining", "creatorShareOfNetTaxBps") + "\n先扣平台分成，再算发币人分成；最后的余款用于买矿机。",
         prod("mining", "creatorShareOfNetTaxBps", "可选 0%–50%；产品文档写的是 10%，尚未批准用于生产。")),
        ("矿机收益到账后，平台分多少 → 平台",
         rate("mining", "outputPlatformBps") + "\n本地测试不扣收益服务费；生产收费规则仍需产品决定。",
         prod("mining", "outputPlatformBps", "产品文档写的是 5%，是否采用待定；只对实际领取到账的收益计算。")),
        ("项目代币 A 与 FAB 的交易池手续费 → LP",
         rate("mining", "v2LpBps") + "（已确认的测试规则）\n这是 V2 池的交易费，和代币买卖税分开；已本地跑通，尚未部署。",
         prod("mining", "v2LpBps", "是否沿用 0.3%；这笔钱给 LP，不全归平台。修改费率需要改合约。")),
        ("毕业时锁定的 LP 赚到手续费后，平台分多少 → 平台 / 发币人",
         "平台 " + rate("mining", "graduationLpPlatformShareBps") + "，发币人 50%\n分的是该笔锁定 LP 的收入，不是再向所有交易者收 50%。",
         "待产品确认\n是否沿用各半分配；现有合约固定如此，调整需要改合约。"),
        ("V2 池是否再从 LP 收益中分协议收入 → 指定钱包",
         "关闭（测试计划）\n不在 0.3% 之外加收；测试不启用从 LP 收益中再分一份的开关。",
         "待产品确认\n是否启用及收款钱包；以后开关变化会影响同一工厂的旧池，不能承诺旧池永远关闭。"),
    ]
    fragmentation = [
        ("买卖矿机碎片的手续费 → 平台和 LP",
         "买、卖各 " + rate("fragmentation", "tradeBps") + "\n按每笔输入资产计算，只收这一层交易费；已本地实现，尚未部署。",
         prod("fragmentation", "tradeBps", "产品文档写的是 0.5%；是否采用待定，不能再叠加一层池子手续费。")),
        ("这笔交易费怎么分 → 平台 / LP",
         "平台 " + rate("fragmentation", "platformShareOfFeeBps") + "，LP 70%\n换算到交易输入额：平台 0.15%，LP 0.35%；分成计算已写好。",
         prod("fragmentation", "platformShareOfFeeBps", "是否沿用平台 30%、LP 70%；这两个比例分的是手续费。")),
        ("碎片对应的矿机收益到账后，平台分多少 → 平台",
         rate("fragmentation", "outputServiceBps") + "\n本地真实矿机集成已通过，测试不扣收益服务费；尚未部署。",
         prod("fragmentation", "outputServiceBps", "产品文档写的是 10%，是否采用待定；只对实际领取到账的收益计算。")),
        ("存入 / 赎回矿机 NFT 的产品手续费",
         "存入 " + rate("fragmentation", "depositBps") + "，赎回 " + rate("fragmentation", "redeemBps") + "\n本地存取测试已通过，尚未部署；用户发交易仍要付网络费。",
         "待产品确认\n是否继续免费；如果要收费，需先改产品规则和合约实现。"),
    ]
    setup_labels = [
        ("cpuCreationWei", "创建 CPU 的费用 → 平台协议钱包", "每次创建收多少 OKB。"),
        ("transistorUnitPriceWei", "晶体管的购买单价 → 创建者", "每个晶体管卖多少；这是售价，不是额外平台手续费。"),
        ("transistorMintProtocolWei", "领取晶体管时的额外手续费 → 平台协议钱包", "每笔领取收多少 OKB；不按晶体管个数重复收。"),
        ("tapeoutWei", "流片（制作电路）的费用 → 指定收款钱包", "每个电路收多少 OKB，以及收款钱包。"),
    ]
    setup = [(label, amount(t["setup"][key], 10**18, " 测试 OKB") + "（首组已设好）",
              amount(p["setup"][key], 10**18, " OKB") + "\n" + decision) for key, label, decision in setup_labels]
    setup.append(("买卖矿机 NFT 的市场手续费 → 平台市场钱包",
                  rate("setup", "nftMarketBps") + "（已设好）",
                  prod("setup", "nftMarketBps", "可选 0%–3%；费率按挂单时的设置计算。")))
    dex = [
        ("普通 V3 池的兑换手续费 → LP",
         rate("dex", "v3LpPips", 10_000) + "（1952 测试计划）\n还没接入；现有 196 测试池仍收 0.01%。",
         prod("dex", "v3LpPips", "每个池收多少；旧池不能直接改费率，需要另建池。", 10_000)),
        ("V3 从池子手续费中抽成 → 平台",
         "关闭（测试计划）\n它分的是 LP 的手续费，不是再按成交额收一次。",
         ("待产品确认" if p["dex"]["v3ProtocolDenominator"] is None else str(p["dex"]["v3ProtocolDenominator"])) + "\n是否抽成；开启后可分走 LP 手续费的 1/4–1/10。"),
        ("普通 V4 池的兑换手续费 → LP",
         rate("dex", "v4LpPips", 10_000) + "（1952 测试计划）\n还没接入；现有 196 的 V4 池也为 0%。",
         prod("dex", "v4LpPips", "每个池的 LP 费率。", 10_000)),
        ("V4 的平台协议费 → 平台",
         rate("dex", "v4ProtocolPips", 10_000) + "（测试计划）",
         prod("dex", "v4ProtocolPips", "是否收取；每个交易方向最高为输入资产的 0.1%。", 10_000)),
        ("兑换页面额外收的服务费 → 平台",
         rate("dex", "interfaceBps") + "\n当前兑换流程没有这项额外扣费。",
         prod("dex", "interfaceBps", "是否收费；如要收费，需要同时改报价、交易和页面展示。")),
        ("限价单成交佣金 → 平台",
         rate("dex", "limitOrderCommissionBps") + "\n现有 196 测试合约写死为 0；1952 限价单还没接入。",
         prod("dex", "limitOrderCommissionBps", "是否收费；现有合约不能调费，需要新合约版本。")),
    ]
    body = '''<header><p class="meta">SodaDEX × IGNIX · 2026-10-17 · 上线前费用清单</p>
<h1>测试少收费，正式上线前再定价</h1>
<p class="lead">这份表说明：收什么钱、给谁、测试收多少，以及正式上线前需要产品决定什么。</p>
<div class="reading-note"><strong>先记住三件事</strong><ul>
<li><strong>测试能免就免。</strong>不能设为零的，按源码最低值或此前已确认的测试规则执行。</li>
<li><strong>生产收费还没定。</strong>所有生产参数都留空，产品文档里的 5% 和 10% 只是候选值。</li>
<li><strong>有些是计划，还没生效。</strong>1952 已部署的首组矿机基础收费为零；两套矿机业务和 1952 DEX 的新收费仍有功能待实现或接入。</li>
</ul></div>
<p class="scope">生产合约暂不部署，测试按表中费用推进；本页会区分已部署、正在实现和待产品确认的事项。</p>
<nav aria-label="报告目录"><a href="#products">两套矿机业务</a><a href="#setup">制作和买卖矿机</a><a href="#dex">DEX 交易</a><a href="#decisions">产品要决定什么</a><a href="#verification">当前进度</a></nav></header>
<section><h2 id="products">1. 两套矿机业务，各收哪些钱</h2>
<p>LP 指给交易池提供资金的人。他们赚的池子手续费，和平台直接收的钱分开计算。</p>
<h3>募资买矿机、分配挖矿收益</h3>'''
    body += table(mining)
    body += '''<div class="example"><h4>例子：金库实际收到 1 FAB 交易税</h4>
<p class="formula">平台 0.01 FAB ＋ 发币人 0 FAB ＋ 买矿机资金 0.99 FAB</p>
<p>这里平台拿的是<strong>税款的 1%</strong>，不是再向用户收成交额的 1%。</p></div>
<p><strong>毕业后的保护期不是额外收费。</strong>测试采用最短 1 天，从毕业开始计时；期间和期后官方交易池仍按既定买卖税收费。税币换 FAB、FAB 换 OKB 买矿机时，也会有实际兑换池的交易费，不能把这些兑换费用说成免除。</p>
<h3>把矿机变成可交易的碎片</h3>'''
    body += table(fragmentation)
    body += '''<div class="example"><h4>例子：用 100 FAB 交易矿机碎片</h4>
<p class="formula">总手续费 0.5 FAB ＝ 平台 0.15 FAB ＋ LP 0.35 FAB</p>
<p>这条交易路径不再叠加上面 A/FAB 池的 0.3% 手续费。</p></div>
<p>两套业务的收益服务费都只按<strong>实际领取到账的收益</strong>计算，界面显示的“预计可领取”不直接扣费。测试设为零后，仍需另外验证非零收费时的分账是否正确。</p></section>'''
    body += '<section><h2 id="setup">2. 制作和买卖矿机时的费用</h2><p>下面五项在 1952 已部署的首组基础合约中都已设为零。用户自己发交易的网络费仍由用户支付。</p>' + table(setup)
    body += '''<p><strong>以后新建 CPU 还要单独设零：</strong>源码默认流片费仍是 0.0013 OKB，当前脚本只处理了第一个 CPU。以后每建一个，都要设置并核对一次；只检查工厂配置不够。</p>
<p>市场费率按<strong>挂单时</strong>锁定，收款钱包按<strong>成交时</strong>的设置取值。正式上线前，产品也要确认这两条规则。</p></section>'''
    body += '<section><h2 id="dex">3. 兑换和限价单的费用</h2><p>此处“1952 测试计划”还没部署接入，不会自动改变现有 196 测试池。</p>' + table(dex)
    body += '<p>如果平台自己给池子提供资金，也会按持有份额赚 LP 手续费。这部分收益要和平台协议费分开记账。</p></section>'
    body += '''<section><h2 id="decisions">4. 正式上线前，产品确认这四件事</h2>
<ol class="decisions"><li><strong>定价格：</strong>逐项确定上面各项费率或固定金额。测试的零费率不会自动成为生产价格，产品文档中的候选值也不会自动启用。</li>
<li><strong>定收款人：</strong>税款分成、挖矿收益分成、碎片交易费、碎片服务费、V3 / V4 协议费、市场费和流片费分别打给哪个钱包；发币人收入也要单独确定。可以使用同一钱包，但要明确决定，不能直接沿用测试管理员地址。</li>
<li><strong>定谁能改、什么时候生效：</strong>谁有调费权限，最高能调多少，是否影响已经创建的项目和旧挂单。矿机募资的税率、税款分成和税收金库收款地址在创建时锁定。发行平台费、曲线平台交易费和毕业锁定 LP 的平台收入，则付给领取时的管理员；更换管理员会改变这几项后续的收款人。</li>
<li><strong>定自动执行的网络费由谁出：</strong>自动分红和限价单成交的测试计划是由执行钱包补贴；现有 196 限价单已由专用钱包付费。生产要决定继续补贴，还是向用户收回实际成本。若从分红扣成本，还需定成本凭据、FAB 换算方式、扣款上限和余额不足时怎么办；这部分功能尚未实现。用户自己签名发交易的网络费仍由用户支付。</li></ol>
<h3>另外一笔要定的钱：FAB 初始分配</h3>
<p>当前源码会预先铸造总上限的 <strong>5%，即 1,050,000 FAB</strong>，测试时交给测试管理员。正式上线前，产品要决定这笔币给谁、做什么；想改 5% 比例需要改源码。这是初始代币分配，不是手续费。</p>
<h3>暂时没有合格持有人时，挖矿收益给谁</h3>
<p>矿机仍在矿场名下，但项目代币可能暂时全在交易池或其他不参与分红的合约里。测试时，这段时间的 FAB <strong>单独保留</strong>，不送给后来买家，也不转给平台。正式归属由产品决定，确认前不动用。</p>
<p>买矿机的本金、长期出资份额、份额的算力权重、毕业门槛，也都不应算成平台收费。</p></section>
<section><h2 id="verification">5. 当前进度</h2>
<p><strong>已完成：</strong>1952 的 FAB、矿机 NFT、挖矿和市场基础合约已部署，首组基础收费已设为零。</p>
<p><strong>本地已跑通：</strong>募资发行、曲线买卖、采购矿机、毕业前分红、毕业建池与池内兑换；碎片存取、交易、加减流动性和分红。烧币凭证到期和供应封顶时的分红，也已用真实矿机合约验证。</p>
<p><strong>正在推进：</strong>补齐完整验收、部署 1952 两套业务并接入前端。当前仍未在测试站开放这些新业务，标注“测试计划”的项目也不代表已经部署。</p>
<p><strong>上线前待定：</strong>生产费率、收款人、调费权限，以及自动执行成本由谁承担，均由产品最终确认。测试参数不会自动用于生产。</p>
<p class="note">本页依据两份矿机产品文档（募资分红 V1.5、碎片化 V1.2）和已确认的测试规则整理。基础合约零费依据 2026-10-17 已保存的链上核验；生产合约保持不动。</p></section>'''
    css = '''*{box-sizing:border-box}body{margin:0;background:#f6f5f1;color:#202c32;font:18px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1120px;margin:24px auto;padding:32px 44px;background:#fff;border:1px solid #d8dedc}h1{font-size:34px;line-height:1.4;margin:8px 0 18px}h2{font-size:25px;line-height:1.5;margin:0 0 14px}h3{font-size:21px;margin:26px 0 12px}h4{font-size:17px;margin:0 0 6px}p{margin:10px 0 16px}.meta,.note,.scope{font-size:15px;color:#526169}.lead{font-size:20px}.reading-note{background:#f1f6f3;border-left:3px solid #397360;padding:18px 22px;margin:24px 0 16px}.reading-note ul{padding-left:22px;margin:10px 0 0}.reading-note li+li{margin-top:8px}nav{display:flex;flex-wrap:wrap;gap:8px 22px;font-size:16px;margin-top:22px}section{border-top:1px solid #d8dedc;margin-top:30px;padding-top:28px}li+li{margin-top:12px}.decisions{padding-left:25px}.decisions li+li{margin-top:18px}a{color:#15665b;text-underline-offset:3px}.example{margin:18px 0 24px;padding:16px 20px;background:#faf8f1;border-left:3px solid #b9a66c}.example p{margin:6px 0 0}.formula{font-size:19px;font-weight:600}code{font:.85em/1.6 ui-monospace,monospace;background:#f3f2ef;border:1px solid #e8e6e0;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere}pre{padding:16px;border:1px solid #d8dedc;background:#fafaf8;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}pre code{background:none;border:0;padding:0}.table-wrap{overflow:auto}table{width:100%;min-width:680px;border-collapse:collapse;font-size:16px;line-height:1.7}th,td{text-align:left;vertical-align:top;padding:15px 14px;border-bottom:1px solid #d8dedc}th{background:#edf5f1}th:first-child{width:27%}th:nth-child(2){width:35%}.cell-note{color:#526169;font-size:15px}details{border-top:1px solid #d8dedc;margin-top:22px;padding-top:8px;font-size:16px}summary{cursor:pointer;padding:12px 0;font-weight:600}a:focus-visible,summary:focus-visible,.table-wrap:focus-visible{outline:3px solid #15665b;outline-offset:4px}.skip{position:absolute;top:-80px;background:white;padding:8px}.skip:focus{top:8px}@media(max-width:600px){body{font-size:17px}main{margin:10px;padding:24px 20px}h1{font-size:27px}h2{font-size:22px}h3{font-size:20px}.lead,.formula{font-size:18px}.reading-note{padding:16px}.table-wrap{margin-top:12px}}@media print{main{margin:0;border:0;padding:0}table{min-width:0}.skip{display:none}}'''
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="test-fee-configuration-sha256" content="' + escape(test_check["configurationSha256"]) + '">'
            '<title>SodaDEX 费用清单：测试与正式上线</title><style>' + css + '</style></head><body>'
            '<a class="skip" href="#main">跳到正文</a><main id="main">' + body + '</main></body></html>\n')


if __name__ == "__main__":
    output = ROOT / "deployments/fees/checklist.html"
    output.write_text(render())
    print(output)

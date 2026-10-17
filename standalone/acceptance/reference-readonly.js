async page => {
 const origin=new URL(page.url()).origin;if(!['http://localhost:8787','https://sodadex-preview.jsmsdx2025.workers.dev'].includes(origin))throw Error('Expected owned Worker')
 const checks=[],check=(v,label)=>{if(!v)throw Error(label);checks.push(label)}
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'探索',exact:true}).click()
 await page.getByRole('button',{name:'官方池 · 只读',exact:true}).click()
 await page.locator('.explore-reference-pools article').first().waitFor({timeout:60000})
 const count=await page.locator('.explore-reference-pools article').count();check(count>=3,'official candidate pools loaded from real RPC')
 const protocols=await page.locator('.explore-reference-row > span').allTextContents();for(const p of ['V2','V3','V4'])check(protocols.some(x=>x.startsWith(p)),p+' official candidates present')
 const row=page.locator('.explore-reference-pools article').filter({has:page.locator('.explore-reference-row > span').filter({hasText:'V4 · 0.01%'})}).first()
 await row.getByRole('button',{name:/查看只读报价/}).click();await page.getByLabel('查询数量 · OKB',{exact:true}).fill('0.000001')
 await page.getByLabel('预计收到',{exact:true}).filter({hasText:/USD/}).waitFor({timeout:60000})
 const quote=await page.getByLabel('预计收到',{exact:true}).textContent();check(quote!=='—','actual official V4 read-only quote')
 check(await page.locator('.explore-reference').getByRole('button',{name:/授权|确认兑换|提交交易/}).count()===0,'official reference has no approval or execution control')
 const calls=await page.evaluate(()=>window.sodaCalls);check(calls.every(m=>['eth_accounts','eth_requestAccounts','eth_chainId'].includes(m)),'official browsing never asks wallet to sign')
 await page.screenshot({path:'.playwright-cli/workspace-reference.png',fullPage:true})
 return {status:'passed',checks,poolCount:count,protocols,quote,walletMethods:calls,mainnetWrites:false}
}

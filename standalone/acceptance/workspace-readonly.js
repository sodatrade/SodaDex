async page => {
 const origin=new URL(page.url()).origin
 if(!['http://localhost:8787','https://sodadex-preview.jsmsdx2025.workers.dev'].includes(origin))throw Error('Expected owned read-only Worker')
 const checks=[],check=(v,label)=>{if(!v)throw Error(label);checks.push(label)}
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.context().addInitScript(()=>{window.sodaCalls=[];window.ethereum={on(){},removeListener(){},async request({method}){window.sodaCalls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return['0x6ecf746b078d46391f8C425B150153212F7C0545'];if(method==='eth_chainId')return'0xc4';throw Error('Read-only check blocked '+method)}}})
 await page.evaluate(()=>localStorage.removeItem('sodadex.preferences.v1'));await page.goto(origin);await page.getByText('X Layer 已连接',{exact:true}).waitFor({timeout:60000})
 check(await page.locator('html').getAttribute('data-theme')==='light','default light theme')
 await page.getByLabel('你将支付',{exact:true}).fill('0.000001')
 await page.getByLabel('预计接收数量',{exact:true}).filter({hasText:/0\./}).waitFor({timeout:60000})
 check(await page.getByLabel('预计接收数量',{exact:true}).textContent()!=='—','actual own-pool quote without wallet')
 await page.getByRole('banner').getByRole('button',{name:'连接钱包',exact:true}).click();await page.getByRole('button',{name:/浏览器钱包.*连接/}).click();await page.getByRole('dialog',{name:'我的钱包',exact:true}).waitFor();await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
 const screenshots=[]
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:960})
  for(const [nav,hash] of [['交易','swap'],['探索','explore'],['流动性','pools'],['投资组合','portfolio']]){
   await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:nav,exact:true}).click()
   await page.waitForURL('**/#'+hash)
   if(hash==='portfolio')await page.getByRole('tab',{name:'概览',exact:true}).waitFor()
   if(hash==='explore')await page.getByRole('table',{name:'代币',exact:true}).waitFor()
   if(hash==='pools')await page.getByRole('button',{name:'创建池 / 新仓位',exact:true}).waitFor()
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r})))})
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${hash} no overflow at ${width}`)
   const file=`.playwright-cli/workspace-${hash}-${width}.png`;await page.screenshot({path:file,fullPage:true});screenshots.push(file)
  }
 }
 await page.setViewportSize({width:1440,height:960})
 await page.getByRole('tab',{name:'代币',exact:true}).click();check(page.url().endsWith('#assets'),'portfolio tokens route');await page.reload();await page.getByRole('tab',{name:'代币',exact:true,selected:true}).waitFor();check(true,'tokens route survives reload')
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'交易',exact:true}).click();await page.getByLabel('你将支付',{exact:true}).fill('0.000001');await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByLabel('语言',{exact:true}).selectOption('en');await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByLabel('You pay',{exact:true}).waitFor();check(true,'English trading labels')
 await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByLabel('Language',{exact:true}).selectOption('yue-HK');await page.getByRole('button',{name:'關閉對話框',exact:true}).click();await page.getByLabel('你會支付',{exact:true}).waitFor();check(true,'Cantonese trading labels')
 check(await page.getByLabel('你會支付',{exact:true}).inputValue()==='0.000001','amount persists across navigation and locales')
 await page.getByRole('button',{name:'偏好設定',exact:true}).click();await page.getByLabel('語言',{exact:true}).selectOption('zh-CN');await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
 const calls=await page.evaluate(()=>window.sodaCalls);check(calls.every(m=>['eth_accounts','eth_requestAccounts','eth_chainId'].includes(m)),'no signing or transaction requests');check(errors.length===0,'no browser runtime errors')
 return {status:'passed',checks,screenshots,walletMethods:calls,runtimeErrors:errors,mainnetWrites:false}
}

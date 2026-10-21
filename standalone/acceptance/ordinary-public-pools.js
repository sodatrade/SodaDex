// Public TEST browser acceptance. Signing is confined to the exact approved plan.
// Run once per protocol on the preview site; never load this in a production site.
// oxlint-disable-next-line no-unused-expressions -- Playwright CLI executes this function expression.
async page => {
  const url = new URL(page.url()), origin = url.origin
  if (origin !== 'https://sodadex-preview.jsmsdx2025.workers.dev') throw Error('Exact preview site required')
  if (url.searchParams.has('tokenId') || url.searchParams.has('after')) throw Error('Public replay/resume requires explicit reconciliation')
  const bridge = async request => {
    const response = await page.request.post('http://127.0.0.1:18770/ordinary',{headers:{'X-Soda-Acceptance':'ordinary'},data:request,timeout:240000})
    const body = await response.json(); if(body.error)throw Error(body.error); return body.result
  }
  await page.exposeBinding('__sodaOrdinaryAcceptance', async (source, request) => {
    if (new URL(source.frame.url()).origin !== origin || source.frame !== page.mainFrame()) throw Error('Wallet origin rejected')
    return bridge(request)
  })
  await page.addInitScript(() => {
    if (location.origin !== 'https://sodadex-preview.jsmsdx2025.workers.dev') return
    localStorage.setItem('sodadex.preferences.v1', JSON.stringify({locale:'zh-CN',theme:'light',currency:'USD'}))
    const provider=Object.freeze({on(){},removeListener(){},request(request){return window.__sodaOrdinaryAcceptance(request)}})
    const info=Object.freeze({uuid:'bb2da9c7-61ce-4869-8cfa-237c7c17a196',name:'SodaDEX 验收钱包',rdns:'local.sodadex.acceptance',icon:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Ccircle cx="16" cy="16" r="15" fill="%23167a50"/%3E%3C/svg%3E'})
    const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info,provider}}))
    window.addEventListener('eip6963:requestProvider',announce);announce()
  })
  const protocol = url.searchParams.get('protocol') ?? 'v3'
  if (!['v3', 'v4'].includes(protocol)) throw Error('Unsupported acceptance protocol')
  const status = await bridge({method:'status'})
  if (status.mode !== 'approved-public-test-acceptance' || status.chainId !== 196 || status.pending || status.completed) throw Error('Approved incomplete public phase required')
  const fab = '0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab'
  const manager = status.contracts[protocol === 'v3' ? 'v3PositionManager' : 'v4PositionManager']
  let id = 0
  const read = async (method, params = []) => {
    const response = await page.request.post(origin + '/api/rpc', {headers:{Origin:origin},data:{jsonrpc:'2.0',id:++id,method,params}})
    const body = await response.json()
    if (!response.ok() || body.error) throw Error(`Read failed: ${method} ${JSON.stringify(body.error)}`)
    return body.result
  }
  const current = async () => (await bridge({method:'status'})).transactions
  const rows = []
  const receiptsAfter = async (start, action, end) => {
    const transactions = (await current()).slice(start, end)
    if (!transactions.length) throw Error(`No browser wallet transaction: ${action}`)
    const receipts = await Promise.all(transactions.map(async tx => {
      const receipt = await read('eth_getTransactionReceipt',[tx.hash])
      if (receipt?.status !== '0x1' || receipt.from.toLowerCase() !== status.owner.toLowerCase()) throw Error(`Failed ${action} receipt`)
      return {hash:tx.hash,to:tx.to,value:tx.value,selector:tx.selector,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,logs:receipt.logs}
    }))
    rows.push({action,receipts})
    return receipts
  }
  const balance = async (token) => BigInt(token === 'native' ? await read('eth_getBalance',[status.owner,'latest'])
    : await read('eth_call',[{to:token,data:'0x70a08231'+status.owner.slice(2).padStart(64,'0')},'latest']))
  const lp = async tokenId => {
    const result = await read('eth_call',[{to:manager,data:(protocol==='v3'?'0x99fbab88':'0x1efeed33')+tokenId.toString(16).padStart(64,'0')},'latest'])
    return protocol === 'v4' ? BigInt(result) : BigInt('0x'+result.slice(2+7*64,2+8*64))
  }
  const confirm = async () => {
    await page.getByRole('button',{name:'预览流动性操作',exact:true}).click()
    const dialog = page.getByRole('dialog',{name:'确认流动性操作',exact:true})
    await dialog.waitFor({timeout:60000})
    await dialog.getByRole('button',{name:'确认并打开钱包',exact:true}).click()
    await dialog.getByText('操作已确认，正在刷新仓位',{exact:true}).waitFor({timeout:120000})
    await dialog.getByRole('button',{name:'关闭',exact:true}).click()
  }
  await page.goto(origin + `/?protocol=${protocol}#pool`)
  await page.reload()
  await page.getByRole('navigation',{name:'SodaDEX',exact:true}).waitFor()
  if (await page.getByRole('button',{name:'连接钱包',exact:true}).count()) {
    await page.getByRole('button',{name:'连接钱包',exact:true}).click()
    await page.getByRole('dialog').locator('button').filter({hasText:'SodaDEX 验收钱包'}).click()
    await page.locator('.wallet-address').waitFor()
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
  }
  let dialog, tokenId, firstLiquidity
  const resumeId = url.searchParams.get('tokenId')
  if (!resumeId) {
  await page.getByRole('button',{name:'创建池 / 新仓位',exact:true}).click()
  dialog = page.getByRole('dialog',{name:'创建池 / 新仓位',exact:true})
  await dialog.getByRole('radio',{name:protocol.toUpperCase(),exact:true}).click()
  await dialog.getByText('导入 ERC-20',{exact:true}).click()
  await dialog.getByRole('textbox',{name:'合约地址',exact:true}).fill(fab)
  await dialog.getByRole('button',{name:'读取代币',exact:true}).click()
  await dialog.getByText('已读取代币',{exact:true}).waitFor({timeout:60000})
  await dialog.getByRole('textbox',{name:'池费率（%）',exact:true}).fill('0.05')
  if (protocol==='v4') await dialog.getByRole('textbox',{name:'Tick 间距',exact:true}).fill('10')
  await dialog.getByRole('button',{name:'查找 / 配置池子',exact:true}).click()
  const initial = dialog.getByRole('textbox',{name:/初始价格/})
  await initial.waitFor({timeout:60000})
  await initial.fill(protocol==='v3'?'0.00000001':'100000000')
  await dialog.getByRole('textbox',{name:'资产 0 数量 · '+(protocol==='v3'?'TEST-FAB':'OKB'),exact:true}).fill(protocol==='v3'?'90':'0.0000009')
  await dialog.getByRole('textbox',{name:'资产 1 数量 · '+(protocol==='v3'?'OKB':'TEST-FAB'),exact:true}).fill(protocol==='v3'?'0.0000009':'90')
  const start = (await current()).length
  await confirm()
  const minted = await receiptsAfter(start,'create-and-first-add')
  const transfer = minted.flatMap(r=>r.logs).find(l=>l.address.toLowerCase()===manager.toLowerCase() && l.topics.length===4 && BigInt(l.topics[1])===0n)
  if (!transfer) throw Error('Position mint event missing')
  tokenId=BigInt(transfer.topics[3]); firstLiquidity=await lp(tokenId)
  if(firstLiquidity<=0n)throw Error('No initial liquidity')
  } else { tokenId=BigInt(resumeId);firstLiquidity=await lp(tokenId);await receiptsAfter(0,'create-and-first-add',2) }
  await page.getByRole('button',{name:'我的仓位',exact:true}).click()
  const lookup = async () => {
    const section=page.locator('details').filter({has:page.getByText('查找仓位 NFT',{exact:true})});
    if((await section.getAttribute('open'))===null)await section.locator('summary').click();
    await section.getByRole('combobox').selectOption(protocol);
    await section.getByRole('textbox',{name:'NFT Token ID',exact:true}).fill(String(tokenId));
    await section.getByRole('button',{name:'查找',exact:true}).click();
  }
  await lookup()
  let card=page.locator('.lp-position').filter({hasText:`${protocol.toUpperCase()} · #${tokenId}`})
  await card.waitFor({timeout:120000})
  const increasedAlready = url.searchParams.get('after') === 'increase'
  if (!increasedAlready) {
  await card.getByRole('button',{name:'增加流动性',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'增加流动性',exact:true})
  await dialog.getByRole('textbox',{name:'资产 0 数量 · '+(protocol==='v3'?'TEST-FAB':'OKB'),exact:true}).fill(protocol==='v3'?'9':'0.00000009')
  await dialog.getByRole('textbox',{name:'资产 1 数量 · '+(protocol==='v3'?'OKB':'TEST-FAB'),exact:true}).fill(protocol==='v3'?'0.00000009':'9')
  const increaseStart=(await current()).length
  await confirm();await receiptsAfter(increaseStart,'increase')
  } else await receiptsAfter(2,'increase',4)
  const grown=await lp(tokenId)
  if(!increasedAlready && grown<=firstLiquidity)throw Error('Increase did not grow NFT liquidity')
  // The same published Swap component discovers the new pool via the Worker directory.
  await page.getByRole('button',{name:'Swap',exact:true}).click()
  await page.getByRole('button',{name:/选择接收资产/}).click()
  await page.getByRole('dialog').getByRole('textbox').fill(fab)
  const picker=page.getByRole('dialog')
  const choice=picker.locator('button.asset-option').filter({hasText:'TEST-FAB'})
  if (!await choice.count()) {await picker.getByRole('button',{name:'导入代币',exact:true}).click();await picker.locator('.swap-import-preview').waitFor();await picker.getByRole('button',{name:'导入代币',exact:true}).click()}
  else await choice.first().click()
  await page.getByRole('button',{name:'兑换设置',exact:true}).click()
  await page.getByRole('radio',{name:protocol.toUpperCase(),exact:true}).click()
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
  for(const reverse of [false,true]){
    if(reverse)await page.getByRole('button',{name:'切换支付与接收资产',exact:true}).click()
    await page.locator('#swap-sell-amount').fill(reverse?'0.1':'0.00000001')
    const action=page.getByRole('button',{name:'预览兑换',exact:true})
    await action.waitFor({timeout:60000});await action.click({timeout:60000})
    const review=page.getByRole('dialog',{name:'预览兑换',exact:true})
    await review.waitFor()
    const before=await balance(reverse?'native':fab),txStart=(await current()).length
    await review.getByRole('button',{name:'确认兑换',exact:true}).click()
    await review.getByText('兑换已确认，余额已刷新',{exact:true}).waitFor({timeout:120000})
    const receipts=await receiptsAfter(txStart,reverse?'token-to-okb':'okb-to-token')
    const gas=receipts.reduce((sum,r)=>sum+BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice),0n)
    if(await balance(reverse?'native':fab)+(reverse?gas:0n)<=before)throw Error('Swap output balance did not increase')
    await review.getByRole('button',{name:'关闭',exact:true}).click()
  }
  await page.getByRole('button',{name:'Pool',exact:true}).click()
  await page.getByRole('button',{name:'我的仓位',exact:true}).click()
  for(const percent of ['50','100']){
    await lookup()
    card=page.locator('.lp-position').filter({hasText:`${protocol.toUpperCase()} · #${tokenId}`})
    await card.waitFor({timeout:60000})
    await card.getByRole('button',{name:'减少流动性',exact:true}).click()
    dialog=page.getByRole('dialog',{name:`减少流动性 · #${tokenId}`,exact:true})
    await dialog.getByRole('textbox',{name:'移出比例（%）',exact:true}).fill(percent)
    const txStart=(await current()).length
    await confirm();await receiptsAfter(txStart,percent==='50'?'remove-half':'remove-all')
    const remaining=await lp(tokenId)
    if(percent==='50' ? remaining<=0n||remaining>=grown : remaining!==0n)throw Error('Removal invariant failed')
  }
  return {protocol,mode:'approved-public-test-acceptance',publicChainWrites:rows.reduce((sum,row)=>sum+row.receipts.length,0),tokenId:String(tokenId),manager,firstLiquidity:String(firstLiquidity),grownLiquidity:String(grown),remainingLiquidity:String(await lp(tokenId)),rows}
}

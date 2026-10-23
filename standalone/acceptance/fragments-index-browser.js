async page => {
  await page.goto('http://127.0.0.1:8791/');
  await page.getByRole('img',{name:'池内价格',exact:true}).waitFor();
  const live=await (await page.request.get('http://127.0.0.1:8791/api/fragments/market')).json();
  if(live.trades.length!==4)throw Error('Expected four verified public test swaps');
  const rows=Array.from({length:23},(_,i)=>({...live.trades[0],id:`fixture-${i}`,transactionHash:`0x${(i+1).toString(16).padStart(64,'0')}`}));
  const cursor='11111111-1111-1111-1111-111111111111',last='22222222-2222-2222-2222-222222222222';
  await page.route('**/api/fragments/market*',async route=>{
    const url=route.request().url(),offset=url.includes(last)?20:url.includes(cursor)?10:0;
    await route.fulfill({json:{...live,trades:rows.slice(offset,offset+10),nextCursor:offset===0?cursor:offset===10?last:null}});
  });
  await page.reload();
  await page.locator('tbody tr').nth(9).waitFor();
  const sizes=[await page.locator('tbody tr').count()];
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByRole('link',{name:/000000000000000000000000000000000000000000000000000000000000000b/}).waitFor();
  sizes.push(await page.locator('tbody tr').count());
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByRole('link',{name:/0000000000000000000000000000000000000000000000000000000000000017/}).waitFor();
  sizes.push(await page.locator('tbody tr').count());
  if(sizes.join(',')!=='10,10,3'||!await page.getByRole('button',{name:'下一页',exact:true}).isDisabled())throw Error('Bad pagination');
  await page.getByRole('button',{name:'上一页',exact:true}).click();
  await page.locator('tbody tr').nth(9).waitFor();
  await page.unroute('**/api/fragments/market*');
  await page.reload();
  await page.getByRole('textbox',{name:'支付',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'支付',exact:true}).fill('0.0000000001');
  await page.getByText('最低收到:',{exact:false}).waitFor();
  if(!await page.getByRole('button',{name:'预览交易',exact:true}).isDisabled())throw Error('Disconnected wallet can submit');
  return {paginationFixture:sizes,realPublicTrades:live.trades.length,quoteAvailable:true,noSigningOrBroadcast:true};
}

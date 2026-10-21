async page => {
  const site='https://sodadex-preview.jsmsdx2025.workers.dev';
  await page.exposeBinding('__poolV3Wallet',async(source,request)=>{
    if(source.frame!==page.mainFrame()||new URL(source.frame.url()).origin!==site)throw Error('Unexpected wallet origin');
    const response=await page.request.post('http://127.0.0.1:18769/pool-v3',{headers:{'x-soda-acceptance':'pool-v3'},data:request,timeout:250000});
    const out=await response.json();if(out.error)throw Error(out.error);return out.result;
  });
  await page.addInitScript(()=>{
    if(location.origin!=='https://sodadex-preview.jsmsdx2025.workers.dev')return;
    localStorage.setItem('sodadex.preferences.v1',JSON.stringify({locale:'en',theme:'light',currency:'USD'}));
    window.ethereum={on(){},removeListener(){},request(args){return window.__poolV3Wallet(args)}};
  });
  await page.goto(site+'/?acceptance=pool-v3#pool');
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
  await page.locator('.wallet-option').first().click();
  await page.getByRole('button',{name:/close/i}).click();
  await page.getByRole('button',{name:'OKB / sFAB · Miner pool',exact:true}).click();
  await page.getByRole('button',{name:/Manage liquidity/}).click();
  await page.getByRole('textbox',{name:'sFAB',exact:true}).waitFor();
  return {url:page.url(),content:await page.getByRole('dialog').innerText()};
}

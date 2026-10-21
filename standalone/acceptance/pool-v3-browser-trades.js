async page => {
 const transact=async()=>{
  await page.getByRole('button',{name:'Preview transaction',exact:true}).click();
  await page.getByRole('button',{name:'Confirm in wallet',exact:true}).click();
  await page.getByText('Transaction confirmed. Data refreshed.',{exact:false}).waitFor({timeout:210000});
 };
 // The first add is a separate, already-confirmed browser step.
 await page.getByRole('textbox',{name:'sFAB',exact:true}).fill('100');
 await page.getByRole('textbox',{name:'OKB',exact:true}).fill('0.00000003');
 await transact();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Swap',exact:true}).click();
 await page.getByRole('button',{name:'OKB / sFAB',exact:true}).click();
 await page.getByRole('textbox',{name:'Pay',exact:true}).fill('0.0000000001');
 await transact();
 await page.getByRole('button',{name:'Reverse direction',exact:true}).click();
 await page.getByRole('textbox',{name:'Pay',exact:true}).fill('0.1');
 await transact();
 await page.getByRole('button',{name:'Pool',exact:true}).click();
 await page.getByRole('button',{name:/Manage liquidity/}).click();
 await page.getByRole('button',{name:'Remove liquidity',exact:true}).click();
 await page.getByRole('textbox',{name:'LP amount',exact:true}).fill('0.009526279441628824');
 await transact();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 return {url:page.url(),content:await page.locator('main').innerText()};
}

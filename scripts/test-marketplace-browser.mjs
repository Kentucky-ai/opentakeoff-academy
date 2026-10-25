import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base=process.env.UNION_PREVIEW_URL||'http://127.0.0.1:8766';
const evidence=new URL('../docs/evidence/marketplace/',import.meta.url);
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/marketplace.html`);
 await page.waitForFunction(()=>document.querySelectorAll('.market-card').length===2);
 assert.match(await page.locator('#catalog-count').innerText(),/0 ready/);
 await page.screenshot({path:new URL('desktop.png',evidence).pathname,fullPage:true});
 await page.locator('#market-search').fill('indexing');assert.equal(await page.locator('.market-card').count(),1);
 await page.locator('#market-search').fill('nothing matches');assert.equal(await page.locator('.market-card').count(),0);
 await page.locator('#market-search').fill('');
 await page.locator('.market-card').first().getByRole('button').click();
 assert.equal(await page.locator('#connection-review').isVisible(),true);
 assert.equal(await page.locator('#download-connection').isDisabled(),true);
 assert.match(await page.locator('#review-details').innerText(),/Connection paused/);
 await page.screenshot({path:new URL('connection-paused.png',evidence).pathname});
 await page.getByRole('button',{name:'Close connection review'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:new URL('mobile.png',evidence).pathname,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 // Test-only review fixture verifies download behavior; it is never saved to
 // the catalog, represented as an actual approval, or shown in public screenshots.
 const fixture=JSON.parse(await readFile(new URL('../site/data/marketplace.json',import.meta.url)));
 fixture.listings[0].status='available';fixture.listings[0].security={status:'reviewed',note:'TEST FIXTURE — NOT AN ACTUAL APPROVAL'};
 await page.route('**/data/marketplace.json',route=>route.fulfill({json:fixture}));
 await page.reload();await page.locator('.market-card').first().getByRole('button').click();
 assert.equal(await page.locator('#download-connection').isDisabled(),true);
 await page.locator('#review-consent').check();
 const download=page.waitForEvent('download');await page.locator('#download-connection').click();
 const downloaded=await download;const bundle=JSON.parse(await readFile(await downloaded.path(),'utf8'));
 assert.equal(bundle.config.mcpServers['union-opentakeoff-mcp'].args[1],'opentakeoff-mcp@0.9.99');
 assert.equal(bundle.receipt.status,'configuration-prepared-not-executed');
 fixture.listings[0].status='revoked';await page.locator('#download-connection').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.includes('Listing changed'));
 assert.deepEqual(errors,[]);
 await writeFile(new URL('browser.json',evidence),JSON.stringify({checks:9,passed:9,pageErrors:errors,mobileWidth:390,liveCatalog:{listings:2,connectable:0},downloadTest:'test-only approved fixture; no packages executed',revocation:'download refused after status change'},null,2)+'\n');
 console.log('9 browser checks passed; actual catalog remains paused/preview.');
}finally{await browser.close();}

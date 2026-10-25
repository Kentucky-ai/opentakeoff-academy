import { validateCatalog, filterListings, connectionBundle, PERMISSIONS } from './marketplace-contract.js';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
let catalog, selected, opener;
const controls=['market-search','market-category','market-status'];
for(const id of controls) $(id).disabled=true;
function link(label,url){const a=node('a',label);a.href=url;a.rel='noopener noreferrer';return a;}
function render(){
  const visible=filterListings(catalog.listings,{query:$('market-search').value,category:$('market-category').value,status:$('market-status').value});
  $('market-list').replaceChildren();
  $('catalog-count').textContent=`${visible.length} ${visible.length===1?'listing':'listings'} · ${visible.filter(l=>l.status==='available').length} ready to connect`;
  $('market-message').textContent=visible.length?'':'No tools match. Try a different capability or availability.';
  for(const l of visible){
    const card=node('article',null,'market-card');
    const top=node('div',null,'market-card-top');top.append(node('span',l.kind==='agent'?'AGENT':'MCP TOOL'),node('span',l.status==='available'?'READY TO CONNECT':l.status==='paused'?'UPDATE NEEDED':'IN DEVELOPMENT',l.status==='available'?'status-ready':'status-preview'));
    card.append(top,node('span',l.publisher,'market-publisher'),node('h3',l.name),node('p',l.summary,'market-description'));
    const tags=node('div',null,'market-tags');for(const c of l.categories)tags.append(node('span',c));card.append(tags);
    const dl=node('dl');for(const [k,v] of [['Version',l.version],['Works with',l.platforms.join(', ')],['Cost',l.pricing.label],['Qualification','Not Academy-assessed']]){const row=node('div');row.append(node('dt',k),node('dd',v));dl.append(row);}card.append(dl);
    const actions=node('div',null,'market-actions');const b=node('button',l.status==='available'?'Review & connect ↗':'Inspect listing →','button');b.type='button';b.addEventListener('click',()=>review(l,b));actions.append(b);
    if(l.docsUrl)actions.append(link('Documentation ↗',l.docsUrl));card.append(actions);$('market-list').append(card);
  }
}
function review(l,button){
  selected=l;opener=button;$('review-title').textContent=`${l.name} · ${l.version}`;$('review-details').replaceChildren();$('review-consent').checked=false;$('download-connection').disabled=true;$('review-consent').disabled=l.status!=='available';$('download-status').textContent='';
  const details=$('review-details');details.append(node('p',l.pricing.label),node('h3','Security review'),node('p',l.security.note));
  details.append(node('h3','Requested access'));const ul=node('ul');for(const p of l.permissions)ul.append(node('li',PERMISSIONS[p]));details.append(ul,node('p',l.dataPolicy),node('p',l.certification.note));
  if(l.install){details.append(node('h3','Exact package'),node('code',`${l.install.package}@${l.install.version}`),node('p','This download prepares an MCP configuration and a review receipt. Importing the configuration into your client can install and start this process. It runs with your account’s access; these permissions are disclosures, not a sandbox.'));
    const integrity=node('details');integrity.append(node('summary','Package integrity and source'));integrity.append(node('code',l.install.integrity),node('p','The recorded npm hash is evidence for verification. The connection configuration does not enforce that hash.'));if(l.sourceUrl)integrity.append(link('Inspect source ↗',l.sourceUrl));details.append(integrity);
  }else details.append(node('p','This version is in development. Connection files will be offered after a release is available.'));
  $('connection-review').showModal();
}
$('connection-review').addEventListener('close',()=>opener?.focus());
$('review-consent').addEventListener('change',()=>{$('download-connection').disabled=!$('review-consent').checked||selected?.status!=='available';});
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download-connection').addEventListener('click',async()=>{
  try{
    // Recheck the published status/version just before generating install material.
    const response=await fetch('data/marketplace.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Catalog unavailable');
    const fresh=validateCatalog(await response.json()).listings.find(l=>l.id===selected.id);
    if(!fresh||JSON.stringify(fresh)!==JSON.stringify(selected))throw new Error('Listing changed. Close this review and refresh before connecting.');
    const bundle=connectionBundle(fresh,$('review-consent').checked);
    // One download avoids browsers suppressing a second automatic download.
    download(`union-${fresh.id}-${fresh.version}.json`,bundle);
    $('download-status').textContent='Downloaded configuration and review receipt in one file. Copy the config object into your MCP client. Nothing was installed or run by this page.';
  }catch(e){$('download-status').textContent=e.message||'Connection preparation failed. Refresh and retry.';}
});
for(const id of controls)$(id).addEventListener(id==='market-search'?'input':'change',render);
try{
  const response=await fetch('data/marketplace.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();
  catalog=validateCatalog(await response.json());
  for(const c of [...new Set(catalog.listings.flatMap(l=>l.categories))].sort())$('market-category').add(new Option(c,c));
  for(const id of controls)$(id).disabled=false;render();
}catch{$('catalog-count').textContent='Catalog unavailable';$('market-message').textContent='We could not load a valid catalog. Refresh to retry. Connection downloads are unavailable.';}

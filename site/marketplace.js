import { validateCatalog, filterListings, connectionBundle, PERMISSIONS } from './marketplace-contract.js';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
let catalog, selected, opener;
const controls=['market-search','market-category','market-status','market-kind','market-publisher','market-sort'];
for(const id of controls) $(id).disabled=true;
function link(label,url){const a=node('a',label);a.href=url;a.rel='noopener noreferrer';return a;}
const statusLabel=l=>({available:'Ready to connect',preview:'In development',paused:'Update needed',revoked:'Withdrawn'}[l.status]);
const typeLabel=l=>l.kind==='agent'?'Agent':'MCP tool';
function listingUrl(id){const u=new URL(location.href);u.searchParams.set('tool',id);u.hash='';return u.href;}
function badge(l){return node('span',statusLabel(l),l.status==='available'?'status-ready':'status-preview');}
function icon(l){return node('span',l.name.split(' ').map(x=>x[0]).join('').slice(0,2),'tool-icon');}
function reviewButton(l){const b=node('button',l.status==='available'?'Review & connect ↗':'Inspect access','button');b.type='button';b.addEventListener('click',()=>review(l,b));return b;}
function render(){
  let visible=filterListings(catalog.listings,{query:$('market-search').value,category:$('market-category').value,status:$('market-status').value});
  visible=visible.filter(l=>(!$('market-kind').value||l.kind===$('market-kind').value)&&(!$('market-publisher').value||l.publisher===$('market-publisher').value));
  visible.sort((a,b)=>($('market-sort').value==='ready'?(Number(b.status==='available')-Number(a.status==='available')):0)||a.name.localeCompare(b.name));
  const url=new URL(location.href);for(const id of controls){const key=id.replace('market-','');if($(id).value&&!(key==='sort'&&$(id).value==='ready'))url.searchParams.set(key,$(id).value);else url.searchParams.delete(key);}history.replaceState(null,'',url);
  $('market-list').replaceChildren();$('active-filters').replaceChildren();
  for(const id of controls.filter(id=>id!=='market-sort'))if($(id).value){const b=node('button',($(id).selectedOptions?.[0]?.textContent||$(id).value)+' ×','filter-chip');b.type='button';b.setAttribute('aria-label','Remove '+id.replace('market-','')+' filter');b.addEventListener('click',()=>{$(id).value='';render();});$('active-filters').append(b);}
  $('catalog-title').textContent=$('market-category').value||($('market-kind').value==='agent'?'Agents':'All agents & tools');
  $('catalog-count').textContent=`${visible.length} ${visible.length===1?'listing':'listings'} · ${visible.filter(l=>l.status==='available').length} ready to connect`;
  $('market-message').replaceChildren();
  if(!visible.length){$('market-message').append(node('h3','No listings here yet.'),node('p','Try another category or clear your filters. Have something useful for this work?'),link('Apply to list your agent ↗','publish.html'));}
  for(const l of visible){
    const card=node('article',null,'market-card');const top=node('div',null,'market-card-top');top.append(icon(l),badge(l));card.append(top);
    const h=node('h3');h.append(link(l.name,listingUrl(l.id)));card.append(h,node('span',`By ${l.publisher}`,'market-publisher'),node('p',l.summary,'market-description'));
    const tags=node('div',null,'market-tags');tags.append(node('span',typeLabel(l)));for(const c of l.categories)tags.append(node('span',c));card.append(tags);
    card.append(node('p',l.pricing.model==='free-software'?'Free software · model costs separate':'Development preview','card-price'));
    const actions=node('div',null,'market-actions');actions.append(link('View details →',listingUrl(l.id)),reviewButton(l));card.append(actions);$('market-list').append(card);
  }
}
function renderListing(id){
  $('browse-view').hidden=true;const root=$('listing-view');root.hidden=false;
  const back=new URL(location.href);back.searchParams.delete('tool');back.hash='catalog';root.append(link('← Back to marketplace',back.href));
  const l=catalog.listings.find(l=>l.id===id);
  if(!l){root.append(node('h1','Listing not found'),node('p','This listing may have been removed. Browse the current catalog for available tools.'));return;}
  document.title=`${l.name} — Union Marketplace`;
  const hero=node('header',null,'listing-hero');hero.append(icon(l));const intro=node('div');intro.append(node('span',typeLabel(l),'eyebrow'),node('h1',l.name),node('p',`By ${l.publisher}`,'market-publisher'),node('p',l.summary,'lede'));hero.append(intro,badge(l));root.append(hero);
  const nav=node('nav',null,'listing-nav');nav.setAttribute('aria-label','Listing sections');for(const [id,label] of [['overview','Overview'],['access','Access & data'],['pricing','Pricing'],['publisher','Publisher & evidence']])nav.append(link(label,'#'+id));root.append(nav);
  const layout=node('div',null,'listing-layout');const content=node('div');
  function section(id,title){const section=node('section',null,'listing-section');section.id=id;section.append(node('h2',title));content.append(section);return section;}
  const overview=section('overview','What it does');overview.append(node('p',l.summary));const tags=node('div',null,'market-tags');for(const c of l.categories)tags.append(node('span',c));overview.append(tags,node('h3','Works with'),node('p',l.platforms.join(', ')),node('h3','Getting started'),node('p',l.status==='available'?'Review the access and version, download the connection configuration, then add its config object to your MCP client. You choose the model and project files.':'This version is not offered for connection. Its listing describes work in development; check back for a reviewed release.'));
  const access=section('access','Access & data');const permissions=node('ul');for(const p of l.permissions)permissions.append(node('li',PERMISSIONS[p]));access.append(permissions,node('p',l.dataPolicy),node('h3','Security review'),node('p',l.security.note),node('h3','Academy qualification'),node('p',l.certification.note));
  const price=section('pricing','Pricing');price.append(node('p',l.pricing.label),node('p',`Software license: ${l.license}`));
  const publisher=section('publisher','Publisher & evidence');publisher.append(node('h3',l.publisher));const pubUrl=new URL('marketplace.html',location.href);pubUrl.searchParams.set('publisher',l.publisher);publisher.append(link('Browse this publisher’s listings →',pubUrl.href));
  const resources=node('ul');for(const e of l.evidence){const li=node('li');li.append(link(e.label+' ↗',e.url));resources.append(li);}if(l.docsUrl){const li=node('li');li.append(link('Documentation & setup ↗',l.docsUrl));resources.append(li);}if(l.sourceUrl){const li=node('li');li.append(link('Source repository ↗',l.sourceUrl));resources.append(li);}publisher.append(resources);if(!resources.children.length)publisher.append(node('p','Public release documentation has not been posted yet.'));
  const aside=node('aside',null,'connection-card');aside.append(badge(l),node('h2','Connect on your terms'),node('p',l.pricing.label),node('p',`Version ${l.version}`),reviewButton(l),node('p','Review before running. Connection files do not sandbox installed software.','small-copy'));if(l.status==='revoked')aside.append(node('p','This release has been withdrawn. Connection downloads are disabled.'));
  layout.append(content,aside);root.append(layout);
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
$('clear-filters').addEventListener('click',()=>{for(const id of controls)$(id).value=id==='market-sort'?'ready':'';render();});
try{
  const response=await fetch('data/marketplace.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();
  catalog=validateCatalog(await response.json());
  for(const c of [...new Set(catalog.listings.flatMap(l=>l.categories))].sort())$('market-category').add(new Option(c,c));
  for(const publisher of [...new Set(catalog.listings.map(l=>l.publisher))].sort())$('market-publisher').add(new Option(publisher,publisher));
  const params=new URLSearchParams(location.search);for(const id of controls){const value=params.get(id.replace('market-',''));if(value!==null)$(id).value=value;$(id).disabled=false;}
  for(const category of [...new Set(catalog.listings.flatMap(l=>l.categories))].sort()){const a=link('',`marketplace.html?category=${encodeURIComponent(category)}#catalog`);a.className='category-link';a.append(node('span',category),node('span',`${filterListings(catalog.listings,{category}).length} ${filterListings(catalog.listings,{category}).length===1?'listing':'listings'} ↗`));$('category-links').append(a);}
  if(params.has('tool'))renderListing(params.get('tool'));else render();
}catch{$('catalog-count').textContent='Catalog unavailable';$('market-message').textContent='We could not load a valid catalog. Refresh to retry. Connection downloads are unavailable.';}

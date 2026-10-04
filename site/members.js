// Approved public membership records only. Intake submissions never publish themselves.
const list=document.getElementById('member-list');
const count=document.getElementById('member-count');
const search=document.getElementById('member-search');
const trade=document.getElementById('member-trade');
const note=document.getElementById('directory-note');
let members=[];
search.disabled=true;trade.disabled=true;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function empty(title,copy,code='00'){
 const box=node('div',null,'member-empty');box.append(node('span',code,'empty-number'));
 const content=node('div');content.append(node('h2',title),node('p',copy));
 const actions=node('div',null,'actions'),join=node('a','Apply for membership ↗','button'),cert=node('a','Explore certification →');join.href='join.html';cert.href='certification.html';actions.append(join,cert);content.append(actions);box.append(content);list.append(box);
}
function render(){
 const q=search.value.trim().toLowerCase();const chosen=trade.value;
 const visible=members.filter(m=>(!chosen||m.trade===chosen)&&(!q||[m.name,m.version,m.trade].join(' ').toLowerCase().includes(q)));
 list.replaceChildren();
 if(!visible.length){empty(members.length?'No members match these filters.':'The first crew starts here.',members.length?'Try another agent name or trade.':'Applications are open. Approved public profiles will appear here after review. Our own reference run is not listed as a union member.');}
 for(const m of visible){
  const card=node('article',null,'member-card');card.append(node('span',m.memberId,'member-id'),node('h2',m.name),node('p',`${m.version} · ${m.trade}`),node('p','Membership approved. Check the linked credential record for assessed qualifications.'));
  const links=node('div',null,'member-links');const profile=safeUrl(m.profileUrl);
  if(profile){const a=node('a','Agent profile ↗');a.href=profile;a.rel='noopener noreferrer';links.append(a);}
  for(const id of Array.isArray(m.credentialIds)?m.credentialIds:[]){if(/^OTA-[A-Z0-9]{2,6}-[0-9]{4,6}$/.test(id)){const a=node('a',`Credential ${id} →`);a.href=`cert.html?id=${encodeURIComponent(id)}`;links.append(a);}}
  card.append(links);list.append(card);
 }
 note.textContent=`${visible.length} of ${members.length} approved public profiles shown. Membership does not award a certification tier or guarantee work.`;
}
search.addEventListener('input',render);trade.addEventListener('change',render);
async function load(){
 try{
  const response=await fetch('data/members.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();
  const data=await response.json();if(data.schemaVersion!=='1.0'||!Array.isArray(data.members))throw new Error();
  members=data.members.filter(m=>m&&m.status==='approved'&&m.publicListing===true&&typeof m.name==='string'&&typeof m.memberId==='string'&&typeof m.version==='string'&&typeof m.trade==='string');
  count.textContent=String(members.length).padStart(2,'0');
  for(const value of [...new Set(members.map(m=>m.trade))].sort()){trade.add(new Option(value,value));}
  search.disabled=false;trade.disabled=false;render();
 }catch{
  count.textContent='—';list.replaceChildren();empty('Directory temporarily unavailable.','We could not load the member records. Refresh to retry, or continue to the membership application.','—');note.textContent='Directory unavailable. No sample members are substituted.';
 }
}
load();

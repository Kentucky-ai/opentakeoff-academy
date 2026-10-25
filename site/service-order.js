const $=id=>document.getElementById(id);
let current,access;
$('order-id').value=new URLSearchParams(location.search).get('id')||'';
const status=message=>{$('order-status').textContent=message;};
async function call(action='',body) {
  const response=await fetch('/api/union/orders/'+encodeURIComponent(access.id)+(action?'/'+action:''),{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+access.token,'X-Union-Role':access.role,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Unable to complete this action.');return value;
}
function button(label,action) {
  const b=document.createElement('button');b.className='button';b.type='button';b.textContent=label;
  b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){status(e.message);}finally{b.disabled=false;}};
  $('order-actions').append(b);return b;
}
function field(label,type='text') {
  const wrap=document.createElement('label');wrap.className='stack-field';wrap.textContent=label;
  const input=document.createElement('input');input.type=type;wrap.append(input);$('order-actions').append(wrap);return input;
}
function render(order) {
  current=order;$('order-detail').hidden=false;$('order-title').textContent=order.title;
  $('order-fields').replaceChildren();$('order-actions').replaceChildren();
  const values={Status:order.state,Scope:order.scope,'Acceptance criteria':order.acceptanceCriteria,Provider:order.providerName,
    'Total USD':(order.amountCents/100).toFixed(2),Deadline:order.dueAt,'Agreement version':order.termsVersion};
  if(order.delivery){values['Delivery link']=order.delivery.url;values['Deliverable SHA-256']=order.delivery.sha256;}
  if(order.receipt)values['Acceptance receipt SHA-256']=order.receipt.sha256;
  if(order.anchor)values['Confirmed chain transaction']=order.anchor.txHash;
  for(const [label,value] of Object.entries(values)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('order-fields').append(dt,dd);}
  if(access.role==='customer'&&order.state==='quoted') {
    const consent=field('I approve this scope, price and the supplied agreement version','checkbox');
    button('Continue to secure payment',async()=>{
      if(!consent.checked)throw new Error('Review and approve the supplied agreement first.');
      const checkout=await call('checkout',{termsVersion:order.termsVersion});const u=new URL(checkout.url);
      if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw new Error('Unexpected checkout address.');location.assign(u.href);
    });
  }
  if(access.role==='provider'&&['funded','revision_requested'].includes(order.state)) {
    const url=field('Private HTTPS delivery link','url'),file=field('Select the delivered file to calculate its SHA-256','file');
    button('Submit delivery for customer review',async()=>{
      if(!file.files[0]||!url.value)throw new Error('Select the delivered file and provide its private link.');
      if(file.files[0].size>200*1024*1024)throw new Error('Use a file under 200 MB or contact Union for a large-deliverable manifest.');
      const digest=await crypto.subtle.digest('SHA-256',await file.files[0].arrayBuffer());
      const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      render(await call('delivery',{sha256,url:url.value}));status('Delivery submitted. Payment has not been released.');
    });
  }
  if(access.role==='customer'&&order.state==='submitted') {
    const downloaded=field('Select the downloaded deliverable to verify it before acceptance','file');
    const accept=field('I reviewed this deliverable against the agreement and authorize payment release','checkbox');
    button('Accept this delivery & authorize release',async()=>{
      if(!accept.checked||!downloaded.files[0])throw new Error('Select and review the delivered file, then confirm acceptance.');
      if(downloaded.files[0].size>200*1024*1024)throw new Error('Contact Union for a large-deliverable manifest.');
      const digest=await crypto.subtle.digest('SHA-256',await downloaded.files[0].arrayBuffer());
      const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      if(sha256!==order.delivery.sha256)throw new Error('This file does not match the submitted deliverable. Do not accept it.');
      render(await call('decision',{action:'accept',sha256,revision:order.revision}));status('Acceptance recorded. Transfer confirmation is pending.');
    });
    button('Request a revision',async()=>{render(await call('decision',{action:'revise',sha256:order.delivery.sha256,revision:order.revision}));status('Revision requested. Release remains blocked.');});
  }
  if(access.role==='customer'&&['funded','submitted','revision_requested','accepted'].includes(order.state)) {
    const reason=field('Describe an issue to dispute (at least 10 characters)');
    button('Open dispute & block release',async()=>{render(await call('decision',{action:'dispute',reason:reason.value}));status('Dispute recorded. Payment release is blocked.');});
  }
  if(order.receipt)button('Download acceptance receipt',async()=>{
    const blob=new Blob([JSON.stringify(order.receipt,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='union-receipt-'+order.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  button('Refresh order',async()=>{render(await call());status('Order refreshed.');});
}
$('access-form').onsubmit=async event=>{
  event.preventDefault();access={id:$('order-id').value.trim(),token:$('access-key').value.trim(),role:$('order-role').value};
  try{render(await call());status('Order loaded. Access keys stay in this tab and are not saved.');}
  catch(e){status(e.message);$('order-detail').hidden=true;}
};

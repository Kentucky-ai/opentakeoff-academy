import { SOURCE, emptyRow, parseDraft, checkDraft, makeDraft } from './lab-model.js';
const $=id=>document.getElementById(id);
const KEY='ota.real-plan.va-bldg28.draft.v1';
let draft={ agent:'', calibration:'', notes:'', quantities:[emptyRow()] }, zoom=100;
try { const saved=localStorage.getItem(KEY); if(saved) draft=parseDraft(JSON.parse(saved)); } catch { $('save-status').textContent='A saved draft could not be loaded. Start a new draft or import your exported JSON.'; }
function feedback(message,error=false) {
  const el=$('lab-feedback');el.textContent=message;el.hidden=false;el.className=error?'feedback':'lab-success';
}
function capture() {
  draft.agent=$('agent-name').value; draft.calibration=$('calibration').value; draft.notes=$('scope-notes').value;
  draft.quantities=[...document.querySelectorAll('.quantity-row')].map(row=>({roomId:row.querySelector('[data-field="roomId"]').value,finish:row.querySelector('[data-field="finish"]').value,value:row.querySelector('[data-field="value"]').value,unit:'sf',evidence:row.querySelector('[data-field="evidence"]').value}));
}
function save() {
  capture(); $('draft-state').textContent='Not submitted · Not scored'; $('lab-feedback').hidden=true;
  try { localStorage.setItem(KEY,JSON.stringify(makeDraft(draft))); $('save-status').textContent='Draft saved on this device. Nothing has been submitted.'; }
  catch { $('save-status').textContent='This browser cannot save locally. Export your draft before leaving.'; }
}
function render() {
  $('agent-name').value=draft.agent;$('calibration').value=draft.calibration;$('scope-notes').value=draft.notes;
  $('quantity-rows').replaceChildren();
  draft.quantities.forEach((q,i)=>{
    const row=document.createElement('div');row.className='quantity-row';
    const num=document.createElement('span');num.className='row-index';num.textContent=String(i+1).padStart(2,'0');row.append(num);
    for (const [key,title,placeholder] of [['roomId','Room / region','From the drawing'],['finish','Finish tag','From AF101 / AF600'],['value','Net area (SF)','Measured area'],['evidence','Source evidence','Sheet, room / region, geometry or trace reference']]) {
      const label=document.createElement('label');label.className='stack-field '+(key==='evidence'?'evidence-field':'');label.textContent=title;
      const input=document.createElement('input');input.dataset.field=key;input.value=q[key];input.placeholder=placeholder;input.maxLength=key==='evidence'?1500:100;
      if(key==='value'){input.type='number';input.min='0';input.step='any';input.inputMode='decimal';}
      label.append(input);row.append(label);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='remove-row';remove.textContent='×';remove.setAttribute('aria-label',`Remove quantity ${i+1}`);
    remove.addEventListener('click',()=>{capture();draft.quantities.splice(i,1);render();save();$('add-row').focus();});row.append(remove);$('quantity-rows').append(row);
  });
  $('quantity-count').textContent=`${draft.quantities.length} ROW${draft.quantities.length===1?'':'S'}`;
}
render();
for(const id of ['agent-name','calibration','scope-notes','quantity-rows']) $(id).addEventListener('input',save);
$('add-row').addEventListener('click',()=>{capture();if(draft.quantities.length>=200){feedback('The draft supports up to 200 rows.',true);return;}draft.quantities.push(emptyRow());render();save();$('quantity-rows').lastElementChild.querySelector('input').focus();});
$('import-btn').addEventListener('click',()=>$('quantity-file').click());
$('quantity-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try {
    if(file.size>2_000_000)throw new Error('Choose a JSON draft smaller than 2 MB.');
    const next=parseDraft(JSON.parse(await file.text()));
    capture();
    if((draft.agent||draft.quantities.some(q=>q.roomId||q.value))&&!confirm('Replace the local draft with this imported file? Export your current draft first if you need to keep it.'))return;
    draft=next;render();save();feedback('Draft imported. Quantities remain unverified and have not been submitted.');
  }catch(err){feedback(err instanceof SyntaxError?'That file is not valid JSON. Your current draft is unchanged.':err.message,true);}
  finally {e.target.value='';}
});
function downloadDraft(){
  const blob=new Blob([JSON.stringify(makeDraft(draft),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='va-building28-takeoff-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('check-submission').addEventListener('click',()=>{
  capture();const errors=checkDraft(draft);
  if(errors.length){feedback('Before review: '+errors.join(' '),true);$('lab-feedback').focus();return;}
  save();downloadDraft();feedback(`Draft exported with ${draft.quantities.length} quantity row${draft.quantities.length === 1 ? '' : 's'}. Completeness checked; accuracy has not been scored. Request a certification review when you are ready.`);$('draft-state').textContent='Exported · Not submitted · Not scored';
});
// Separate save action preserves unfinished work without pretending it is review-ready.
const saveButton=document.createElement('button');saveButton.type='button';saveButton.className='button secondary';saveButton.textContent='Export unfinished draft';saveButton.addEventListener('click',()=>{capture();downloadDraft();feedback('Unfinished draft exported. It has not been submitted or scored.');});$('check-submission').after(saveButton);
function setZoom(value){zoom=Math.max(100,Math.min(500,value));$('drawing-image').style.width=zoom+'%';$('zoom-value').textContent=zoom+'%';$('zoom-out').disabled=zoom===100;$('zoom-in').disabled=zoom===500;if(zoom===100){$('drawing-viewport').scrollTop=0;$('drawing-viewport').scrollLeft=0;}}
$('zoom-in').addEventListener('click',()=>setZoom(zoom+50));$('zoom-out').addEventListener('click',()=>setZoom(zoom-50));$('zoom-fit').addEventListener('click',()=>setZoom(100));
for(const button of document.querySelectorAll('[data-sheet]'))button.addEventListener('click',()=>{
  const sheet=button.dataset.sheet,plan=sheet==='af101';
  $('drawing-image').src=`plans/va-bldg28/${sheet}.jpg`;$('drawing-image').alt=plan?'Original AF101 first floor finish plan, VA St. Cloud Building 28':'Original AF600 material and room finish schedule, VA St. Cloud Building 28';
  $('sheet-title').textContent=plan?'AF101 / FIRST FLOOR FINISH PLAN':'AF600 / MATERIAL & ROOM FINISH SCHEDULE';
  document.querySelectorAll('[data-sheet]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));setZoom(100);
});
$('drawing-image').addEventListener('error',()=>feedback('The drawing preview could not load. Open the original PDF above to continue.',true));
setZoom(100);

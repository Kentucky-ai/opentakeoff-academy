// The public selector previews insignia; it never generates an issued credential.
const ranks = {
  apprentice: {name:'Apprentice',number:'01',scope:'Foundation / single-trade takeoffs'},
  journeyman: {name:'Journeyman',number:'02',scope:'Advanced / more demanding work'},
  master: {name:'Master',number:'03',scope:'Highest tier / complex assignments'}
};
const viewer=document.querySelector('[data-insignia-viewer]');
if(viewer){
  const buttons=[...viewer.querySelectorAll('[data-patch-tier]')];
  function show(tier){
    const rank=ranks[tier];if(!rank)return;
    const img=viewer.querySelector('[data-patch-image]');
    img.src=`assets/patch-${tier}-embroidered.webp`;
    img.alt=`OpenTakeoff Academy ${rank.name} mission patch — artwork preview`;
    viewer.querySelector('[data-patch-name]').textContent=`OTA–${rank.number} / ${rank.name.toUpperCase()}`;
    viewer.querySelector('[data-patch-scope]').textContent=rank.scope;
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.patchTier===tier)));
  }
  buttons.forEach(button=>button.addEventListener('click',()=>show(button.dataset.patchTier)));
}
const tierSelect=document.getElementById('assessment-tier');
const enrollmentPatch=document.getElementById('enrollment-patch');
if(tierSelect&&enrollmentPatch){
  function sync(){
    const tier=tierSelect.value;if(!ranks[tier])return;
    enrollmentPatch.src=`assets/patch-${tier}-embroidered.webp`;
    enrollmentPatch.alt=`${ranks[tier].name} qualification patch — earned after passing`;
  }
  const requested=new URLSearchParams(location.search).get('tier');
  if(ranks[requested])tierSelect.value=requested;
  tierSelect.addEventListener('change',sync);sync();
}

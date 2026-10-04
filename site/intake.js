// Show success only after the deployed form endpoint accepts the submission.
for (const form of document.querySelectorAll('[data-intake]')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button=form.querySelector('button[type="submit"]'),status=form.querySelector('.intake-status');
    const label=button.textContent;button.disabled=true;button.textContent='Sending…';status.textContent='';
    try {
      const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form)).toString(),signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('The request was not accepted.');
      form.reset();status.textContent=form.dataset.successMessage||'Proposal received for review. It has not been published as a bounty.';status.focus();
    } catch {status.textContent='We could not confirm receipt. Your entries are still here; please try again.';status.focus();}
    finally {button.disabled=false;button.textContent=label;}
  });
}

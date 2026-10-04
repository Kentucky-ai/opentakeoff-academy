// Browser drafts are unverified submissions, never grades or credentials.
export const SOURCE = Object.freeze({
  id: 'va-stcloud-bldg28', sheets: ['AF101', 'AF600'],
  sha256: '53aa2a44efc8f9a2e625ed223fcfbf9ee19d15eb8469ba57183874b6a8e2a56f',
  pdf: 'plans/va-bldg28/va-stcloud-bldg28-finish.pdf'
});
export const FORMAT = 'ota.real-plan-draft.v1';
const string = (v, limit = 1500) => typeof v === 'string' ? v.slice(0, limit) : '';
export const emptyRow = () => ({ roomId:'', finish:'', value:'', unit:'sf', evidence:'' });
export function parseDraft(raw) {
  if (!raw || raw.format !== FORMAT || raw.source?.sha256 !== SOURCE.sha256) throw new Error('Choose an Academy real-plan draft for this exact VA Building 28 PDF. Signed run bundles open in the Evidence inspector.');
  if (!Array.isArray(raw.quantities) || raw.quantities.length > 200) throw new Error('The draft must contain a quantities array with at most 200 rows.');
  const quantities = raw.quantities.map((q, i) => {
    if (!q || typeof q !== 'object' || q.unit !== 'sf' || !['string','number'].includes(typeof q.value)) throw new Error(`Row ${i+1} must contain an area value and unit "sf".`);
    return { roomId:string(q.roomId,100), finish:string(q.finish,100), value:string(String(q.value),40), unit:'sf', evidence:string(q.evidence) };
  });
  return { agent:string(raw.agent,100), calibration:string(raw.calibration), notes:string(raw.notes,3000), quantities };
}
export function checkDraft(draft) {
  const errors=[];
  if (!draft.agent.trim()) errors.push('Add your agent name and version.');
  if (!draft.calibration.trim()) errors.push('Record your scale calibration evidence.');
  if (!draft.notes.trim()) errors.push('Describe the measured scope, assumptions, and exclusions.');
  if (!draft.quantities.length) errors.push('Add at least one measured quantity.');
  const seen=new Set();
  for (const [i,q] of draft.quantities.entries()) {
    if (!q.roomId.trim() || !q.finish.trim() || !q.evidence.trim()) errors.push(`Row ${i+1}: add the room / region, finish tag, and source evidence.`);
    if (q.value.trim() === '' || !Number.isFinite(Number(q.value)) || Number(q.value) <= 0 || q.unit !== 'sf') errors.push(`Row ${i+1}: enter a positive measured area in SF.`);
    const key=(q.roomId.trim()+'|'+q.finish.trim()).toLowerCase();
    if (seen.has(key) && q.roomId.trim()) errors.push(`Row ${i+1}: duplicate room and finish. Combine the area or identify a distinct region.`);
    seen.add(key);
  }
  return errors;
}
export function makeDraft(draft, now=new Date().toISOString()) {
  const safe=parseDraft({ ...draft, format:FORMAT, source:SOURCE });
  return { format:FORMAT, source:SOURCE, ...safe, status:'unverified', assessment:{ accuracy:'not-scored', certification:'not-issued' }, exportedAt:now };
}

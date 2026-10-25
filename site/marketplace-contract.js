// Shared browser/CLI contract. Catalog data never supplies commands or secrets.
export const PERMISSIONS = Object.freeze({
  'files.read': 'Read plan files under your local account',
  'files.write': 'Write reports and marked-up files under your local account',
  'process.local': 'Run a local process with your account’s operating-system access',
  'network.install': 'Download the pinned software package from npm during setup',
});
const fields = ['id','name','publisher','kind','version','status','summary','categories','platforms','license','pricing','permissions','dataPolicy','certification','sourceUrl','docsUrl','install','evidence','security'];
const object = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const text = (v, max = 1000) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
export function safeUrl(value) {
  if (!text(value,2000)) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
export function validateListing(v) {
  if (!object(v, fields) || !fields.every(k => Object.hasOwn(v,k))) throw new Error('Invalid listing fields');
  if (!text(v.id,64) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(v.id) || !['agent','mcp-server'].includes(v.kind)
      || !['available','preview','paused','revoked'].includes(v.status) || !/^\d+\.\d+\.\d+$/.test(v.version)) throw new Error('Invalid listing identity');
  for (const k of ['name','publisher','summary','license','dataPolicy']) if (!text(v[k])) throw new Error('Invalid listing text');
  for (const k of ['categories','platforms','permissions']) if (!Array.isArray(v[k]) || !v[k].length || v[k].length > 20 || !v[k].every(x => text(x,100)) || new Set(v[k]).size !== v[k].length) throw new Error('Invalid listing list');
  if (!v.permissions.every(p => Object.hasOwn(PERMISSIONS,p))) throw new Error('Unknown permission');
  if (!object(v.pricing,['model','label']) || !['free-software','not-offered'].includes(v.pricing.model) || !text(v.pricing.label)) throw new Error('Invalid pricing');
  if (!object(v.certification,['status','note']) || v.certification.status !== 'not-assessed' || !text(v.certification.note)) throw new Error('Credential claims need a verified credential contract');
  for (const k of ['sourceUrl','docsUrl']) if (v[k] !== null && !safeUrl(v[k])) throw new Error('Invalid HTTPS link');
  if (!Array.isArray(v.evidence) || v.evidence.length > 10 || !v.evidence.every(e => object(e,['label','url']) && text(e.label) && safeUrl(e.url))) throw new Error('Invalid evidence');
  if (!object(v.security,['status','note']) || !['pending','blocked','reviewed'].includes(v.security.status) || !text(v.security.note)) throw new Error('Invalid security state');
  if (v.install !== null) {
    if (!['process.local','network.install'].every(p => v.permissions.includes(p))) throw new Error('Installation requires local process and package download disclosures');
    const i=v.install;
    if (!object(i,['type','package','version','integrity']) || i.type !== 'npm-stdio' || !text(i.package,150) || !text(i.integrity,100)
        || !/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]{0,100}$/.test(i.package)
        || i.version !== v.version || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(i.integrity)) throw new Error('Invalid pinned installation');
  }
  if (v.status === 'available' && (v.security.status !== 'reviewed' || !v.install || !v.docsUrl || !v.sourceUrl || !v.evidence.length || v.pricing.model !== 'free-software')) throw new Error('Available listings require source, docs, pin, evidence and known pricing');
  return v;
}
export function validateCatalog(v) {
  if (!object(v,['schemaVersion','updated','listings']) || v.schemaVersion !== 'union.marketplace.v1'
      || !/^\d{4}-\d{2}-\d{2}$/.test(v.updated) || !Array.isArray(v.listings) || v.listings.length > 500) throw new Error('Invalid catalog');
  const ids=new Set();
  for (const listing of v.listings) { validateListing(listing); if(ids.has(listing.id)) throw new Error('Duplicate listing'); ids.add(listing.id); }
  return v;
}
export function filterListings(listings, { query='', category='', status='' }={}) {
  const q=query.trim().toLowerCase();
  return listings.filter(v => v.status !== 'revoked' && (!category || v.categories.includes(category)) && (!status || v.status === status)
    && (!q || [v.name,v.publisher,v.summary,...v.categories].join(' ').toLowerCase().includes(q)));
}
export function connectionBundle(listing, reviewed = false) {
  validateListing(listing);
  if (reviewed !== true || listing.status !== 'available') throw new Error('Review an available version before preparing a connection');
  const i=listing.install;
  // Fixed launcher; no arbitrary shell, URL, env, or command from a manifest.
  return { config: { mcpServers: { [`union-${listing.id}`]: { command:'npx', args:['--yes',`${i.package}@${i.version}`] } } },
    receipt: { schemaVersion:'union.connection-review.v1', listingId:listing.id, version:listing.version,
      package:i.package, publishedIntegrity:i.integrity, permissions:[...listing.permissions],
      sourceUrl:listing.sourceUrl, certification:'not-assessed',
      status:'configuration-prepared-not-executed',
      notice:'This records the reviewed version, not a security certification or runtime sandbox. npm integrity is recorded for inspection; the MCP configuration itself does not enforce this hash. Review downloaded package integrity before execution.' } };
}

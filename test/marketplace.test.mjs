import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { validateCatalog, validateListing, filterListings, connectionBundle, safeUrl } from '../site/marketplace-contract.js';
const catalog=JSON.parse(await readFile(new URL('../site/data/marketplace.json',import.meta.url)));
const first=()=>{const l=structuredClone(catalog.listings[0]);l.status='available';l.security={status:'reviewed',note:'Test fixture only; not a published approval.'};return l;};
const schema=JSON.parse(await readFile(new URL('../schema/marketplace-listing.schema.json',import.meta.url)));
test('public JSON Schema validates the catalog and rejects undeclared access',()=>{
  const validate=new Ajv({strict:false}).compile(schema);
  for(const l of catalog.listings)assert.equal(validate(l),true,JSON.stringify(validate.errors));
  const l=first();l.permissions.push('shell.execute');assert.equal(validate(l),false);
});
test('published catalog validates; previews are never installable or certified',()=>{
  validateCatalog(catalog);
  assert.equal(catalog.listings.filter(l=>l.status==='available').length,1);
  assert.equal(connectionBundle(catalog.listings[0],true).receipt.version,'0.9.100');
  assert.throws(()=>connectionBundle(catalog.listings[1],true));
  assert.ok(catalog.listings.every(l=>l.certification.status==='not-assessed'));
});
test('discovery finds capabilities without a platform subscription',()=>{
  assert.equal(filterListings(catalog.listings,{query:'pdf'}).length,2);
  assert.equal(filterListings(catalog.listings,{category:'Estimating'}).length,1);
  assert.equal(filterListings(catalog.listings,{status:'preview'}).length,1);
  assert.equal(filterListings(catalog.listings,{query:'nonexistent'}).length,0);
});
test('connection requires review, pins version, exports no credentials and cannot execute',()=>{
  assert.throws(()=>connectionBundle(first(),false));
  assert.throws(()=>connectionBundle(first(),'false'));
  const bundle=connectionBundle(first(),true);
  assert.deepEqual(bundle.config.mcpServers['union-opentakeoff-mcp'],{command:'npx',args:['--yes','opentakeoff-mcp@0.9.100']});
  assert.equal(bundle.receipt.status,'configuration-prepared-not-executed');
  assert.equal(bundle.receipt.certification,'not-assessed');
  assert.equal(Object.keys(bundle.config.mcpServers['union-opentakeoff-mcp']).includes('env'),false);
});
test('revocation, command injection, unknown access, credential forgery and unsafe URLs fail closed',()=>{
  for(const mutate of [
    l=>l.install.command='sh', l=>l.install.package='x;touch /tmp/bad',
    l=>l.install.version='latest', l=>l.install.integrity='sha512-bad',
    l=>l.permissions.push('shell.execute'),l=>l.certification.status='certified',
    l=>l.docsUrl='javascript:alert(1)',l=>l.sourceUrl='https://user:secret@example.org',
    l=>l.evidence.push({label:'bad',url:'file:///tmp/secret'}),l=>l.ownerEmail='private@example.org',l=>l.id=null,l=>l.install.package=null,
  ]){const l=first();mutate(l);assert.throws(()=>validateListing(l));}
  const paused=first();paused.status='paused';assert.throws(()=>connectionBundle(paused,true));
  const l=first();l.status='revoked';assert.throws(()=>connectionBundle(l,true));
  assert.equal(filterListings([l]).length,0);
  assert.equal(safeUrl('data:text/html,bad'),null);
});
test('duplicate catalog identifiers are rejected',()=>{
  const c=structuredClone(catalog);c.listings.push(first());assert.throws(()=>validateCatalog(c));
});
test('installers cannot omit execution and package download access',()=>{
  const validate=new Ajv({strict:false}).compile(schema);
  for(const permission of ['process.local','network.install']){
    const l=first();l.permissions=l.permissions.filter(p=>p!==permission);
    assert.throws(()=>validateListing(l));assert.equal(validate(l),false);
  }
  assert.equal(safeUrl('https://example.org/\nmisleading'),null);
  assert.equal(safeUrl('https://example.org/'+ 'a'.repeat(2000)),null);
});

// Original, scalable Academy insignia. Artwork previews, never issued credentials.
// Regenerate with: node scripts/render-credential-patches.mjs
import {writeFileSync} from 'node:fs';
const out = new URL('../site/assets/', import.meta.url);
const tiers = [
  {id:'apprentice',name:'APPRENTICE',n:1,color:'#bbf685',dark:'#344632',mid:'#899c70',light:'#eaf5cb',shape:'M240 28C354 28 446 120 446 234S354 440 240 440 34 348 34 234 126 28 240 28Z'},
  {id:'journeyman',name:'JOURNEYMAN',n:2,color:'#a9e7f2',dark:'#1e3b49',mid:'#719baf',light:'#ecf5e8',shape:'M133 27H347L443 123V342L347 438H133L37 342V123Z'},
  {id:'master',name:'MASTER',n:3,color:'#ff9967',dark:'#46362b',mid:'#cd8f62',light:'#fff1c6',shape:'M240 22 435 83V275C435 353 339 412 240 451 141 412 45 353 45 275V83Z'}
];
for (const t of tiers) {
  const ticks=Array.from({length:72},(_,i)=>`<path d="M240 74v${i%6===0?14:6}" transform="rotate(${i*5} 240 232)"/>`).join('');
  const stars=Array.from({length:t.n},(_,i)=>`<path d="m${240+(i-(t.n-1)/2)*26} 98 2.3 6.2 6.6.3-5.2 4.1 1.7 6.4-5.4-3.6-5.4 3.6 1.7-6.4-5.2-4.1 6.6-.3Z"/>`).join('');
  const rank=Array.from({length:t.n},(_,i)=>`<path d="m${240+(i-(t.n-1)/2)*17-5} 381 5-5 5 5v9l-5-5-5 5Z"/>`).join('');
  const thermal=t.n===3?'<stop offset="0" stop-color="#eaf3e6"/><stop offset=".28" stop-color="#ffc685"/><stop offset=".53" stop-color="#f58a53"/><stop offset=".70" stop-color="#a25d51"/><stop offset=".86" stop-color="#77b9d0"/><stop offset="1" stop-color="#41588c"/>':`<stop stop-color="${t.light}"/><stop offset=".4" stop-color="${t.color}"/><stop offset=".62" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.light}"/>`;
  const secondOrbit=t.n>1?`<ellipse cx="240" cy="218" rx="113" ry="41" transform="rotate(35 240 218)" stroke="${t.color}" stroke-opacity=".4" stroke-width="1.5"/>`:'';
  const crown=t.n===3?'<path d="m214 134 26-22 26 22M225 134l15-12 15 12" fill="none" stroke="#ffc187" stroke-width="2"/>':'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480" role="img" aria-labelledby="title desc">
<title id="title">OpenTakeoff Academy — ${t.name} mission patch</title><desc id="desc">${t.n===1?'Circular lime seal':t.n===2?'Ice-blue octagonal patch':'Thermal-orange shield'} with an architectural A, orbital measurement rings and ${t.n} rank ${t.n===1?'mark':'marks'}. Commonwealth of Construction Agents. Insignia artwork; a credential is earned only after a passing proctored assessment.</desc>
<defs>
 <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${t.light}"/><stop offset=".23" stop-color="${t.mid}"/><stop offset=".52" stop-color="#171c1a"/><stop offset=".78" stop-color="${t.mid}"/><stop offset="1" stop-color="#dbe6cf"/></linearGradient>
 <linearGradient id="field" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${t.dark}"/><stop offset=".55" stop-color="#1b2425"/><stop offset="1" stop-color="#101615"/></linearGradient>
 <linearGradient id="metal" x1="0" y1="0" x2=".2" y2="1">${thermal}</linearGradient>
 <radialGradient id="halo"><stop stop-color="${t.color}" stop-opacity=".17"/><stop offset="1" stop-color="${t.color}" stop-opacity="0"/></radialGradient>
 <pattern id="weave" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1h4M1 0v4" stroke="#eeeadd" stroke-width=".5" opacity=".09"/><path d="m0 4 4-4" stroke="#080e0c" stroke-width="1" opacity=".5"/></pattern>
 <pattern id="engraving" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 0h3" stroke="#080e12" stroke-width=".6" opacity=".26"/></pattern>
 <filter id="shadow" x="-25%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity=".42"/></filter>
 <path id="outline" d="${t.shape}"/>
 <path id="top-arc" d="M86 228a154 154 0 0 1 308 0"/>
 <path id="bottom-arc" d="M70 244a170 170 0 0 0 340 0"/>
 <path id="monogram" d="m240 133 79 149h-35l-44-88-44 88h-35Zm-34 126h68v23h-68Z"/>
</defs>
<g filter="url(#shadow)">
 <use href="#outline" fill="#0c1110" stroke="#101310" stroke-width="12"/>
 <use href="#outline" fill="url(#field)" stroke="url(#edge)" stroke-width="7"/>
 <use href="#outline" fill="none" stroke="${t.color}" stroke-width="1.5" stroke-dasharray="1 4" transform="translate(240 240) scale(.962) translate(-240 -240)" opacity=".6"/>
 <use href="#outline" fill="url(#weave)" stroke="${t.mid}" stroke-width="1" transform="translate(240 240) scale(.936) translate(-240 -240)"/>
 <circle cx="240" cy="229" r="151" fill="none" stroke="${t.mid}" stroke-opacity=".4"/>
 <g stroke="${t.color}" stroke-opacity=".45" stroke-width="1">${ticks}</g>
 <text fill="${t.light}" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" letter-spacing="3"><textPath href="#top-arc" startOffset="50%" text-anchor="middle">OPENTAKEOFF ACADEMY</textPath></text>
 <text fill="${t.color}" font-family="Arial,Helvetica,sans-serif" font-size="8" font-weight="500" letter-spacing="1.5"><textPath href="#bottom-arc" startOffset="50%" text-anchor="middle">COMMONWEALTH OF CONSTRUCTION AGENTS</textPath></text>
 <circle cx="240" cy="218" r="108" fill="url(#halo)"/>
 <g fill="none"><circle cx="240" cy="218" r="105" stroke="${t.mid}" stroke-width=".6"/><circle cx="240" cy="218" r="98" stroke="${t.mid}" stroke-dasharray="1 5"/>
 <path d="M130 218h220M240 108v220" stroke="${t.color}" stroke-opacity=".13"/>
 <ellipse cx="240" cy="218" rx="117" ry="42" transform="rotate(-35 240 218)" stroke="${t.color}" stroke-width="1.5"/>${secondOrbit}</g>
 <g fill="${t.color}">${stars}</g>${crown}
 <use href="#monogram" transform="translate(0 4)" fill="#0a1011"/>
 <use href="#monogram" fill="url(#metal)" stroke="${t.light}" stroke-opacity=".45" stroke-width=".7"/>
 <use href="#monogram" fill="url(#engraving)"/>
 <path d="m179 272 61-119 61 119M216 270h48" fill="none" stroke="${t.light}" stroke-width=".6" opacity=".5"/>
 <circle cx="335" cy="153" r="4" fill="${t.color}" stroke="#1d2420" stroke-width="2"/>
 <g fill="${t.color}" font-family="monospace" font-size="8" letter-spacing="1.5"><text x="101" y="231" transform="rotate(-90 101 231)" text-anchor="middle">AEC / 09</text><text x="379" y="231" transform="rotate(90 379 231)" text-anchor="middle">OTA / 0${t.n}</text></g>
 <path d="M117 317h246v46H117Z" fill="#111b19" stroke="${t.mid}" stroke-width="1"/>
 <path d="M117 317h8m-8 0v8m246-8h-8m8 0v8m-246 30v8h8m238-8v8h-8" fill="none" stroke="${t.color}" stroke-width="2"/>
 <text x="240" y="347" text-anchor="middle" fill="${t.light}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${t.n===3?30:26}" letter-spacing="${t.n===3?6:1.5}">${t.name}</text>
 <g fill="${t.color}">${rank}</g>
 <text x="240" y="301" text-anchor="middle" fill="${t.color}" font-family="monospace" font-size="7" letter-spacing="2">KENTUCKY · USA</text>
</g></svg>`;
  writeFileSync(new URL(`patch-${t.id}.svg`,out),svg+'\n');
}
console.log('Rendered three original qualification insignia. No credentials issued.');

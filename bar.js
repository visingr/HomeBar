/* Home Bar logic – bar.js (Version 9)
   Fixes price=0 by normalising names in both Inventory and DrinkList before
   matching, so any trailing spaces or case differences no longer break the
   lookup.
*/

/* CONFIG */
const SHEET_ID   = '1Vi7W4YksMjIfuO5sqtzIZJwOTClXsG8GXg6rHBczOwI';
const SHEETS     = { INVENTORY:'Inventory', RECIPES:'DrinkList' };
const CURRENCY   = '€';
const REFRESH_MS = 5 * 60 * 1000;   // 5 min
const SHOT_ML    = 40;

/* Helpers */
const csvUrl = sheet =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;

const sanitise = s => (s||'').trim().replace(/\s+/g,' ').toLowerCase();

const slug = s => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s+/g,'_')
  .replace(/[^\w\-]/g,'');

const toNum = v => {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  return parseFloat(String(v)
    .replace(/[^0-9.,\-]/g,'')
    .replace(/\s+/g,'')
    .replace(',','.')) || 0;
};

/* ───────────────────────────────── DATA LAYER ─────────────────────────── */
async function fetchCsv(sheet){
  const r = await fetch(csvUrl(sheet));
  if(!r.ok) throw new Error(`Cannot load sheet “${sheet}” (${r.status})`);
  return Papa.parse((await r.text()).trim(), {header:true}).data;
}

function detectCol(row, regex){
  return Object.keys(row).find(k => regex.test(k.trim()));
}

async function loadBarData(){
  const [invRaw, recRaw] = await Promise.all([
    fetchCsv(SHEETS.INVENTORY),
    fetchCsv(SHEETS.RECIPES)
  ]);
  if(!invRaw.length || !recRaw.length) throw new Error('Google Sheet looks empty');

  /* Inventory */
  const abvKey   = detectCol(invRaw[0], /^(alkohol|abv|alcohol)/i);
  const priceKey = detectCol(invRaw[0], /(cena.*\/l|price.*\/l)/i);

  const inventory = invRaw
    .filter(r => r.Name)
    .map(r => {
      const cleanName = sanitise(r.Name);
      const abvVal    = toNum(r[abvKey]);
      const abv       = abvVal > 1 ? abvVal/100 : abvVal;
      const priceL    = toNum(r[priceKey]);
      return { key:cleanName, label:r.Name.trim(), abv, pricePerMl: priceL/1000 };
    });
  const invMap = Object.fromEntries(inventory.map(i=>[i.key,i]));

  /* Shots */
  const shots = inventory
    .filter(i => i.abv > 0.05)
    .map(i => ({ name:i.label, price:+(i.pricePerMl*SHOT_ML).toFixed(2) }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  /* Long-form recipe rows */
  const drinkNames = Object.keys(recRaw[0]).filter(k=>k!=='Name'&&k&&!k.startsWith('_')&&!/Unnamed/i.test(k));
  const longRows=[];
  recRaw.forEach(row=>{
    const ingKey = sanitise(row.Name);
    if(!ingKey||!invMap[ingKey]) return;
    drinkNames.forEach(drink=>{
      const ml=toNum(row[drink]);
      if(ml>0) longRows.push({Drink:drink, key:ingKey, Ml:ml});
    });
  });

  /* Merge & aggregate */
  const drinks={};
  longRows.forEach(r=>{
    const inv=invMap[r.key];
    const d=drinks[r.Drink]??={name:r.Drink,vol:0,alcPct:0,price:0};
    d.vol+=r.Ml;
    d.price+=r.Ml*inv.pricePerMl;
    d.alcPct+=r.Ml*inv.abv;
  });
  Object.values(drinks).forEach(d=>{
    d.alcPct = d.vol ? +(d.alcPct/d.vol*100).toFixed(2):0;
    d.price  = +d.price.toFixed(2);
  });

  return {drinks, shots};
}

/* ── UI RENDERERS (unchanged) ── */
function renderList(drinksMap, shots){
  const drinks=Object.values(drinksMap).sort((a,b)=>a.name.localeCompare(b.name));
  const app=document.getElementById('app');
  app.innerHTML='<h1>Drinks</h1>';
  const tbl=document.createElement('table');
  tbl.innerHTML='<thead><tr><th>Drink</th><th>Price</th></tr></thead>';
  const tbody=document.createElement('tbody');
  drinks.forEach(d=>{const tr=document.createElement('tr');tr.innerHTML=`<td><a href="?drink=${encodeURIComponent(d.name)}">${d.name}</a></td><td>${CURRENCY}${d.price.toFixed(2)}</td>`;tbody.appendChild(tr);});
  tbl.appendChild(tbody);app.appendChild(tbl);
  if(shots.length){app.insertAdjacentHTML('beforeend','<h2>Shots</h2>');const sTbl=document.createElement('table');sTbl.innerHTML='<thead><tr><th>Shot (40 ml)</th><th>Price</th></tr></thead>';const sBody=document.createElement('tbody');shots.forEach(s=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${s.name}</td><td>${CURRENCY}${s.price.toFixed(2)}</td>`;sBody.appendChild(tr);});sTbl.appendChild(sBody);app.appendChild(sTbl);}
}
function renderDetail(d){
  const app=document.getElementById('app');
  app.innerHTML=`<a class="back" href="./">← Back to list</a><h1>${d.name}</h1>`;
  const img=document.createElement('img');img.src=`images/${slug(d.name)}.jpg`;img.alt=d.name;img.onerror=()=>img.remove();app.appendChild(img);
  app.insertAdjacentHTML('beforeend',`<p>Volume: <strong>${d.vol} ml</strong><br>Alcohol: <strong>${d.alcPct}% ABV</strong><br>Price: <strong>${CURRENCY}${d.price.toFixed(2)}</strong></p>`);
}
/* ── BOOTSTRAP ── */
async function render(){try{const{drinks,shots}=await loadBarData();const qs=new URLSearchParams(location.search).get('drink');(qs&&drinks[qs])?renderDetail(drinks[qs]):renderList(drinks,shots);}catch(e){document.getElementById('app').innerHTML=`<p class="err">${e.message}</p>`;console.error(e);}}
render();setInterval(render,REFRESH_MS);

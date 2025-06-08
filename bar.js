/* Home Bar logic – bar.js (Version 11)
   ➜ Adds “in‑stock” tracking
   ▸ Inventory rows now read a checkbox/boolean column (any header containing
     “stock”, “have”, or the first column whose cells are TRUE/FALSE).
   ▸ Each drink is flagged Available = **all its ingredients are in stock**.
   ▸ List view shows a disabled checkbox so guests can see instantly whether
     you can make that drink right now; detail view shows the same.
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

const toBool = v => /^(true|1|yes|y)$/i.test(String(v).trim());

/* ───────────────────────────────── DATA LAYER ─────────────────────────── */
async function fetchCsv(sheet){
  const r = await fetch(csvUrl(sheet));
  if(!r.ok) throw new Error(`Cannot load sheet “${sheet}” (${r.status})`);
  return Papa.parse((await r.text()).trim(), {header:true}).data;
}

function detectCol(row, regex){
  return Object.keys(row).find(k => regex.test(k.trim()));
}

function detectStockCol(rows){
  const hdrMatch = detectCol(rows[0], /(stock|have|available)/i);
  if(hdrMatch) return hdrMatch;
  // fallback: first column where > half the cells are TRUE/FALSE strings
  const keys = Object.keys(rows[0]).filter(k => k !== 'Name');
  for(const k of keys){
    const boolCount = rows.slice(0,20).filter(r => /^(true|false)$/i.test(String(r[k]).trim())).length;
    if(boolCount > 10) return k;
  }
  return null;
}

async function loadBarData(){
  const [invRaw, recRaw] = await Promise.all([
    fetchCsv(SHEETS.INVENTORY),
    fetchCsv(SHEETS.RECIPES)
  ]);
  if(!invRaw.length || !recRaw.length) throw new Error('Google Sheet looks empty');

  /* Identify key columns */
  const abvKey    = detectCol(invRaw[0], /^(alkohol|abv|alcohol)/i);
  const priceKey  = detectCol(invRaw[0], /(cena.*\/l|price.*\/l)/i);
  const stockKey  = detectStockCol(invRaw) || null; // may be null

  /* Inventory */
  const inventory = invRaw
    .filter(r => r.Name)
    .map(r => {
      const key = sanitise(r.Name);
      const abvVal = toNum(r[abvKey]);
      const abv    = abvVal > 1 ? abvVal/100 : abvVal;
      const priceL = toNum(r[priceKey]);
      const inStock= stockKey ? toBool(r[stockKey]) : true; // assume true if no column
      return { key, label:r.Name.trim(), abv, pricePerMl: priceL/1000, inStock };
    });
  const invMap = Object.fromEntries(inventory.map(i => [i.key, i]));

  /* Shots list */
  const shots = inventory
    .filter(i => i.abv > 0.05)
    .map(i => ({ name:i.label, price:+(i.pricePerMl*SHOT_ML).toFixed(2) }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  /* Expand recipe sheet to long format */
  const drinkNames = Object.keys(recRaw[0]).filter(k=>k!=='Name'&&k&&!k.startsWith('_')&&!/Unnamed/i.test(k));
  const longRows=[];
  recRaw.forEach(row=>{
    const ingKey = sanitise(row.Name);
    if(!ingKey || !invMap[ingKey]) return;
    drinkNames.forEach(drink=>{
      const ml = toNum(row[drink]);
      if(ml>0) longRows.push({Drink:drink, key:ingKey, Ml:ml});
    });
  });

  /* Aggregate */
  const drinks={};
  longRows.forEach(r=>{
    const inv = invMap[r.key];

    const d = drinks[r.Drink] ??= {name:r.Drink, vol:0, alcPct:0, price:0, available:true};
    d.vol       += r.Ml;
    d.price     += r.Ml * inv.pricePerMl;
    d.alcPct    += r.Ml * inv.abv;
    d.available = d.available && inv.inStock;
  });
  Object.values(drinks).forEach(d=>{
    d.alcPct = d.vol ? +(d.alcPct/d.vol*100).toFixed(2) : 0;
    d.price  = +d.price.toFixed(2);
  });

  return { drinks, shots };
}

/* ─────────────────────────────── UI RENDERERS ─────────────────────────── */
function mkCheck(checked){
  return `<input type="checkbox" disabled ${checked?'checked':''}>`;
}

function renderList(drinksMap, shots){
  const drinks = Object.values(drinksMap).sort((a,b)=>a.name.localeCompare(b.name));
  const app = document.getElementById('app');
  app.innerHTML = '<h1>Drinks</h1>';

  const tbl = document.createElement('table');
  tbl.innerHTML = '<thead><tr><th>Drink</th><th>Price</th><th>Have?</th></tr></thead>';
  const tbody = document.createElement('tbody');
  drinks.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><a href="?drink=${encodeURIComponent(d.name)}">${d.name}</a></td><td>${CURRENCY}${d.price.toFixed(2)}</td><td style="text-align:center">${mkCheck(d.available)}</td>`;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  app.appendChild(tbl);

  if(shots.length){
    app.insertAdjacentHTML('beforeend','<h2>Shots</h2>');
    const sTbl = document.createElement('table');
    sTbl.innerHTML = '<thead><tr><th>Shot (40 ml)</th><th>Price</th></tr></thead>';
    const sBody = document.createElement('tbody');
    shots.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.name}</td><td>${CURRENCY}${s.price.toFixed(2)}</td>`;
      sBody.appendChild(tr);
    });
    sTbl.appendChild(sBody);
    app.appendChild(sTbl);
  }
}

function renderDetail(d){
  const app = document.getElementById('app');
  app.innerHTML = `<a class="back" href="./">← Back to list</a><h1>${d.name}</h1>`;

  const img = document.createElement('img');
  img.src = `images/${slug(d.name)}.jpg`;
  img.alt = d.name;
  img.onerror = () => img.remove();
  app.appendChild(img);

  app.insertAdjacentHTML('beforeend',`
    <p>${mkCheck(d.available)} Available<br>
    Volume: <strong>${d.vol} ml</strong><br>
    Alcohol: <strong>${d.alcPct}% ABV</strong><br>
    Price: <strong>${CURRENCY}${d.price.toFixed(2)}</strong></p>`);
}

/* ───────────────────────────── BOOTSTRAP ─────────────────────────────── */
async function render(){
  try{
    const { drinks, shots } = await loadBarData();
    const qs = new URLSearchParams(location.search).get('drink');
    if(qs && drinks[qs])
      renderDetail(drinks[qs]);
    else
      renderList(drinks, shots);
  }catch(e){
    document.getElementById('app').innerHTML = `<p class="err">${e.message}</p>`;
    console.error(e);
  }
}

render();
setInterval(render, REFRESH_MS);

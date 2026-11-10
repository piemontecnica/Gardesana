/* Sopralluogo 26_071 Gardesana — webapp statica (Leaflet + IndexedDB + Service Worker) */
'use strict';

const CFG = {
  commessa: '26_071',
  nome: 'Gardesana',
  center: [45.5419, 10.7199],
  zoom: 14,
  tavoleBounds: [[45.5150, 10.7070], [45.5690, 10.7330]],
  generaleBounds: [[45.5398, 10.7015], [45.5708, 10.7329]],
};

const CATEGORIE = [
  { id: 'interferenza', label: 'Interferenza / sottoservizio', color: '#e8590c' },
  { id: 'accesso', label: 'Accesso / area di cantiere', color: '#2b8a3e' },
  { id: 'viabilita', label: 'Viabilità e traffico', color: '#f08c00' },
  { id: 'manufatto', label: 'Manufatto / pozzetto / impianto', color: '#1971c2' },
  { id: 'ambiente', label: 'Ambiente / vegetazione / lago', color: '#0ca678' },
  { id: 'ricettore', label: 'Ricettore sensibile', color: '#9c36b5' },
  { id: 'criticita', label: 'Criticità', color: '#c92a2a' },
  { id: 'altro', label: 'Altro', color: '#495057' },
];
const catById = id => CATEGORIE.find(c => c.id === id) || CATEGORIE[CATEGORIE.length - 1];

/* ---------------- utilità ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m';
const pad = (n, l = 3) => String(n).padStart(l, '0');
const fmtDate = ts => new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}
function lineLength(latlngs) {
  let d = 0;
  for (let i = 1; i < latlngs.length; i++) d += L.latLng(latlngs[i - 1]).distanceTo(latlngs[i]);
  return d;
}
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

/* WGS84 -> UTM 32N (EPSG:32632) */
function toUTM32(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const lon0 = 9 * Math.PI / 180, phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const Nn = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [E, Nn];
}

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('sopralluogo_' + CFG.commessa, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('punti', { keyPath: 'id' });
        d.createObjectStore('tracce', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  put(store, v) { return this.tx(store, 'readwrite', s => s.put(v)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); },
};

/* ---------------- mappa ---------------- */
const map = L.map('map', { zoomControl: true, maxZoom: 22, attributionControl: true }).setView(CFG.center, CFG.zoom);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.createPane('tavole').style.zIndex = 250;
map.createPane('vett').style.zIndex = 420;

const basi = {
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 22, maxNativeZoom: 19, attribution: 'Ortofoto &copy; Esri, Maxar, Earthstar Geographics' }),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
};
let baseCur = null;
function setBase(k) {
  if (baseCur) map.removeLayer(baseCur);
  baseCur = basi[k] || null;
  if (baseCur) baseCur.addTo(map);
  document.querySelectorAll('#baseSeg button').forEach(b => b.classList.toggle('on', b.dataset.base === k));
  ls('base', k);
}
setBase(ls('base') || 'sat');

const tavole = L.tileLayer('tiles/tavole/{z}/{x}/{y}.webp', {
  pane: 'tavole', minZoom: 12, minNativeZoom: 13, maxNativeZoom: 20, maxZoom: 22, bounds: CFG.tavoleBounds,
  opacity: 0.85, attribution: 'Tavole di progetto B-14÷B-46', errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
const generale = L.tileLayer('tiles/generale/{z}/{x}/{y}.webp', {
  pane: 'tavole', minZoom: 11, minNativeZoom: 12, maxNativeZoom: 18, maxZoom: 22, bounds: CFG.generaleBounds,
  opacity: 0.9, errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
tavole.addTo(map);

/* layer vettoriali (simbologia dal progetto QGIS Gardesana.qgz) */
const POZZ_COL = {
  'Pozzetto di CALMA': '#30123b', 'Pozzetto di ISPEZIONE': '#4686fb', 'Pozzetto di MANOVRA CON SARACINESCA': '#1be5b5',
  'Pozzetto di SCARICO CON SARACINESCA': '#a4fc3c', 'Pozzetto di SCARICO SEMPLICE': '#fbb938',
  'Pozzetto di SFIATO CON SARACINESCA': '#e3440a', 'Pozzetto di SFIATO SEMPLICE': '#7a0403',
};
const CHIUS_COL = { 'chiusura completa strada comunale': '#ff0003' }; // altri: arancio
const VEC = [
  { id: 'tub_ghisa', file: 'tub_ghisa', label: 'Condotta in progetto – Ghisa DN600', type: 'line',
    styles: [{ color: '#000', weight: 6 }, { color: '#ff0000', weight: 3.5 }] },
  { id: 'tub_prfv', file: 'tub_prfv', label: 'Condotta in progetto – PRFV', type: 'line', styles: [{ color: '#1ce400', weight: 5 }] },
  { id: 'tub_pead', file: 'tub_pead', label: 'Condotta in progetto – PEAD', type: 'line', styles: [{ color: '#0043d1', weight: 5 }] },
  { id: 'tub_esistenti', file: 'tub_esistenti', label: 'Tubazioni esistenti', type: 'line', styles: [{ color: '#ff00e9', weight: 4.5 }] },
  { id: 'chiusure', file: 'chiusure', label: 'Chiusure e deviazioni', type: 'line', cat: 'Stato',
    styleFn: p => [{ color: CHIUS_COL[p.Stato] || '#ff9000', weight: 5 }],
    legend: [['chiusura completa strada comunale', '#ff0003'], ['senso unico / alternato', '#ff9000']] },
  { id: 'viab_alt', file: 'viab_alt', label: 'Viabilità alternativa', type: 'line',
    styles: [{ color: '#b2df8a', weight: 6 }, { color: '#0e9c43', weight: 2, dashArray: '8 4 2 4' }] },
  { id: 'pozzetti', file: 'pozzetti', label: 'Camere e pozzetti', type: 'point', cat: 'classificazione',
    legend: Object.entries(POZZ_COL).map(([k, v]) => [k.replace('Pozzetto di ', ''), v]) },
  { id: 'impianti', file: 'impianti', label: 'Impianti e vasche', type: 'point' },
];
const vecLayers = {};
const vecData = {};

function popupHtml(title, props, extra = '') {
  const rows = Object.entries(props).filter(([k, v]) => v !== null && v !== '' && k !== 'Lunghezza')
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('');
  return `<h4>${esc(title)}</h4><table>${rows}${extra}</table>`;
}

async function loadVectors() {
  for (const v of VEC) {
    try {
      const gj = await fetch(`data/${v.file}.geojson`).then(r => r.json());
      vecData[v.id] = gj;
      let lyr;
      if (v.type === 'line') {
        const groups = [];
        const sfn = v.styleFn || (() => v.styles);
        const nPass = Math.max(...gj.features.map(f => sfn(f.properties).length));
        for (let i = 0; i < nPass; i++) {
          groups.push(L.geoJSON(gj, {
            pane: 'vett',
            style: f => Object.assign({ lineCap: 'round', lineJoin: 'round', opacity: 1 }, sfn(f.properties)[i] || { opacity: 0, weight: 0 }),
            onEachFeature: (f, l) => {
              const len = lineLength(l.getLatLngs().flat(2));
              l.bindPopup(popupHtml(v.label, f.properties, `<tr><td>Lunghezza</td><td><b>${fmtM(len)}</b></td></tr>`));
            },
          }));
        }
        lyr = L.layerGroup(groups);
      } else if (v.id === 'pozzetti') {
        lyr = L.geoJSON(gj, {
          pane: 'vett',
          pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'vett', radius: 6, color: '#801119', weight: 1.5, fillColor: POZZ_COL[f.properties.classificazione] || '#999', fillOpacity: 1 }),
          onEachFeature: (f, l) => l.bindPopup(popupHtml(f.properties.classificazione || 'Pozzetto', { Tipologia: f.properties.Tipologia, Note: f.properties.Note })),
        });
      } else {
        lyr = L.geoJSON(gj, {
          pane: 'vett',
          pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'vett', radius: 9, color: '#232323', weight: 2, fillColor: '#a47158', fillOpacity: 1 })
            .bindTooltip(f.properties.Tipologia || '', { permanent: true, direction: 'right', offset: [10, 0], className: 'foglio-lbl' }),
          onEachFeature: (f, l) => l.bindPopup(popupHtml(f.properties.Tipologia || 'Impianto', { Note: f.properties.Note })),
        });
      }
      vecLayers[v.id] = lyr;
      if (ls('vis_' + v.id) !== '0') lyr.addTo(map);
    } catch (e) { console.warn('Layer non caricato', v.id, e); }
  }
  buildLegend();
}

function symSvg(v) {
  if (v.type === 'point') {
    const c = v.id === 'impianti' ? '#a47158' : '#4686fb';
    return `<svg width="34" height="16"><circle cx="17" cy="8" r="6" fill="${c}" stroke="${v.id === 'impianti' ? '#232323' : '#801119'}" stroke-width="1.5"/></svg>`;
  }
  const st = v.styles || v.styleFn({});
  return `<svg width="34" height="16">${st.map(s => `<line x1="2" y1="8" x2="32" y2="8" stroke="${s.color}" stroke-width="${Math.min(s.weight, 7)}" stroke-linecap="round" ${s.dashArray ? `stroke-dasharray="${s.dashArray}"` : ''}/>`).join('')}</svg>`;
}
function buildLegend() {
  const box = $('#legendVec'); box.innerHTML = '';
  for (const v of VEC) {
    if (!vecLayers[v.id]) continue;
    const on = map.hasLayer(vecLayers[v.id]);
    const row = document.createElement('label'); row.className = 'row';
    row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}><span class="sym">${symSvg(v)}</span><span>${esc(v.label)}</span>`;
    row.querySelector('input').onchange = e => {
      e.target.checked ? vecLayers[v.id].addTo(map) : map.removeLayer(vecLayers[v.id]);
      ls('vis_' + v.id, e.target.checked ? '1' : '0');
    };
    box.appendChild(row);
    if (v.legend) {
      const sub = document.createElement('div'); sub.className = 'sub';
      sub.innerHTML = v.legend.map(([l, c]) => `<div class="row"><span class="sym">${v.type === 'point'
        ? `<svg width="34" height="16"><circle cx="17" cy="8" r="5" fill="${c}" stroke="#801119" stroke-width="1.2"/></svg>`
        : `<svg width="34" height="16"><line x1="2" y1="8" x2="32" y2="8" stroke="${c}" stroke-width="5"/></svg>`}</span>${esc(l)}</div>`).join('');
      box.appendChild(sub);
    }
  }
}

/* fogli (quadro d'unione) */
let fogliGJ = null, fogliLyr = null;
async function loadFogli() {
  fogliGJ = await fetch('data/fogli.geojson').then(r => r.json());
  fogliGJ.features.sort((a, b) => a.properties.tavola.localeCompare(b.properties.tavola, 'it', { numeric: true }));
  fogliLyr = L.geoJSON(fogliGJ, {
    pane: 'vett', interactive: false,
    style: { color: '#fff', weight: 2, dashArray: '6 4', fill: false },
    onEachFeature: (f, l) => l.bindTooltip(f.properties.tavola, { permanent: true, direction: 'center', className: 'foglio-lbl' }),
  });
  const sel = $('#gotoFoglio');
  fogliGJ.features.forEach((f, i) => { const o = document.createElement('option'); o.value = i; o.textContent = 'Tavola ' + f.properties.tavola; sel.appendChild(o); });
  sel.onchange = () => {
    if (sel.value === '') return;
    const f = fogliGJ.features[+sel.value];
    map.fitBounds(L.geoJSON(f).getBounds(), { padding: [20, 20] });
    if (!map.hasLayer(tavole)) { tavole.addTo(map); $('#lyTavole').checked = true; }
    closePanels(); sel.value = '';
  };
  if (ls('vis_fogli') === '1') { fogliLyr.addTo(map); $('#lyFogli').checked = true; }
  updateCoordbar();
}
function pointInRing(pt, ring) {
  let x = pt[0], y = pt[1], inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function foglioAt(lat, lng) {
  if (!fogliGJ) return '';
  const hit = fogliGJ.features.filter(f => {
    const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.some(p => pointInRing([lng, lat], p[0]));
  }).map(f => f.properties.tavola);
  return hit.join(' / ');
}

/* ---------------- pannelli ---------------- */
function openPanel(id) { closePanels(); $(id).hidden = false; }
function closePanels() { document.querySelectorAll('.panel').forEach(p => (p.hidden = true)); }
document.querySelectorAll('[data-close]').forEach(b => (b.onclick = closePanels));
$('#btnLayers').onclick = () => openPanel('#panelLayers');
$('#btnList').onclick = () => { renderList(); openPanel('#panelList'); };
document.querySelectorAll('#baseSeg button').forEach(b => (b.onclick = () => setBase(b.dataset.base)));

function bindToggle(chk, lyr, key) {
  $(chk).onchange = e => { e.target.checked ? lyr().addTo(map) : map.removeLayer(lyr()); ls('vis_' + key, e.target.checked ? '1' : '0'); };
}
bindToggle('#lyTavole', () => tavole, 'tavole');
bindToggle('#lyGenerale', () => generale, 'generale');
bindToggle('#lyFogli', () => fogliLyr, 'fogli');
if (ls('vis_tavole') === '0') { map.removeLayer(tavole); $('#lyTavole').checked = false; }
if (ls('vis_generale') === '1') { generale.addTo(map); $('#lyGenerale').checked = true; }
function bindOpacity(inp, out, lyr, key) {
  const v0 = +(ls('op_' + key) || $(inp).value);
  $(inp).value = v0; $(out).textContent = v0 + '%'; lyr.setOpacity(v0 / 100);
  $(inp).oninput = e => { const v = +e.target.value; lyr.setOpacity(v / 100); $(out).textContent = v + '%'; ls('op_' + key, v); };
}
bindOpacity('#opTavole', '#opTavoleV', tavole, 'tavole');
bindOpacity('#opGenerale', '#opGeneraleV', generale, 'generale');

/* ---------------- GPS ---------------- */
let gpsWatch = null, gpsPos = null, gpsFollow = false, gpsMk = null, gpsCirc = null;
function startGps() {
  if (!('geolocation' in navigator)) { toast('GPS non disponibile su questo dispositivo'); return; }
  if (gpsWatch !== null) return;
  gpsWatch = navigator.geolocation.watchPosition(onGps, err => {
    toast('GPS: ' + (err.code === 1 ? 'permesso negato' : 'segnale non disponibile'));
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function onGps(p) {
  const ll = [p.coords.latitude, p.coords.longitude];
  const first = !gpsPos;
  gpsPos = { lat: ll[0], lng: ll[1], acc: p.coords.accuracy, ts: p.timestamp };
  if (!gpsMk) {
    gpsCirc = L.circle(ll, { radius: p.coords.accuracy, color: '#1c7ed6', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    gpsMk = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1c7ed6', fillOpacity: 1, interactive: false }).addTo(map);
  } else { gpsMk.setLatLng(ll); gpsCirc.setLatLng(ll).setRadius(p.coords.accuracy); }
  if (gpsFollow || first) map.setView(ll, Math.max(map.getZoom(), 18));
  if (tracking) addTrackPoint(gpsPos);
  updateCoordbar();
}
$('#btnGps').onclick = () => {
  startGps();
  if (!gpsPos) { gpsFollow = true; $('#btnGps').classList.add('follow'); toast('Ricerca posizione GPS…'); return; }
  gpsFollow = !gpsFollow;
  $('#btnGps').classList.toggle('follow', gpsFollow);
  if (gpsFollow) { map.setView([gpsPos.lat, gpsPos.lng], Math.max(map.getZoom(), 18)); toast('Mappa centrata sulla tua posizione'); }
};
map.on('dragstart', () => { if (gpsFollow) { gpsFollow = false; $('#btnGps').classList.remove('follow'); } });

function updateCoordbar() {
  const c = gpsPos && gpsFollow ? gpsPos : map.getCenter();
  const [E, N] = toUTM32(c.lat, c.lng);
  $('#cbCoord').textContent = `${gpsPos && gpsFollow ? 'GPS' : 'Centro'} · E ${E.toFixed(1)} N ${N.toFixed(1)}`;
  $('#cbFoglio').textContent = 'Foglio: ' + (foglioAt(c.lat, c.lng) || '–');
  $('#cbAcc').textContent = gpsPos ? `± ${Math.round(gpsPos.acc)} m` : '';
}
map.on('moveend', updateCoordbar);

/* ---------------- punti di sopralluogo ---------------- */
let punti = [];
const puntiLyr = L.layerGroup().addTo(map);
function nextNum() { return punti.reduce((m, p) => Math.max(m, p.n || 0), 0) + 1; }
function pIcon(p) {
  const c = catById(p.cat).color;
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
    html: `<div class="pmk" style="background:${c}"><span>${p.n}</span></div>` });
}
function drawPunti() {
  puntiLyr.clearLayers();
  punti.forEach(p => {
    L.marker([p.lat, p.lng], { icon: pIcon(p), zIndexOffset: 1000 }).on('click', () => openForm(p)).addTo(puntiLyr);
  });
}
async function loadPunti() { punti = (await DB.all('punti')).sort((a, b) => a.n - b.n); drawPunti(); }

/* posizionamento con mirino */
let placeCb = null;
function startPlace(cb, startLL) {
  placeCb = cb; closePanels();
  if (startLL) map.setView(startLL, Math.max(map.getZoom(), 18));
  else if (gpsPos) map.setView([gpsPos.lat, gpsPos.lng], Math.max(map.getZoom(), 18));
  $('#crosshair').hidden = false; $('#placebar').hidden = false; $('#fab').hidden = true;
  gpsFollow = false; $('#btnGps').classList.remove('follow');
}
function endPlace() { $('#crosshair').hidden = true; $('#placebar').hidden = true; $('#fab').hidden = false; placeCb = null; }
$('#placeCancel').onclick = () => { const cb = placeCb; endPlace(); if (cb && cb.cancel) cb.cancel(); };
$('#placeGps').onclick = () => {
  startGps();
  if (gpsPos) map.setView([gpsPos.lat, gpsPos.lng], Math.max(map.getZoom(), 18));
  else toast('Posizione GPS non ancora disponibile');
};
$('#placeOk').onclick = () => {
  const c = map.getCenter(); const cb = placeCb; endPlace();
  const useGps = gpsPos && map.latLngToContainerPoint([gpsPos.lat, gpsPos.lng]).distanceTo(map.latLngToContainerPoint(c)) < 3;
  cb && cb.ok({ lat: c.lat, lng: c.lng, acc: useGps ? gpsPos.acc : null, src: useGps ? 'GPS' : 'mappa' });
};
$('#fab').onclick = () => {
  startGps();
  startPlace({ ok: pos => openForm(null, pos) });
};

/* scheda */
let editing = null; // oggetto punto in modifica (copia)
function openForm(p, pos) {
  if (p) editing = JSON.parse(JSON.stringify({ ...p, photos: [] })), editing.photos = p.photos.slice();
  else {
    editing = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), n: nextNum(), cat: ls('lastCat') || 'interferenza',
      titolo: '', note: '', prio: 'media', photos: [], created: Date.now(), operatore: ls('operatore') || '' };
  }
  if (pos) Object.assign(editing, { lat: pos.lat, lng: pos.lng, acc: pos.acc, src: pos.src, foglio: foglioAt(pos.lat, pos.lng) });
  $('#formTitle').textContent = (p ? 'Punto ' : 'Nuovo punto ') + 'P' + pad(editing.n);
  $('#fTitolo').value = editing.titolo; $('#fNote').value = editing.note;
  $('#fDelete').hidden = !p;
  renderFormMeta(); renderCats(); renderPrio(); renderPhotos();
  openPanel('#panelForm');
}
function renderFormMeta() {
  const [E, N] = toUTM32(editing.lat, editing.lng);
  $('#fMeta').innerHTML = `<b>P${pad(editing.n)}</b> · ${fmtDate(editing.created)}<br>
    Foglio: <b>${esc(editing.foglio || 'fuori tavole')}</b> · posizione da ${esc(editing.src || 'mappa')}${editing.acc ? ' (± ' + Math.round(editing.acc) + ' m)' : ''}<br>
    UTM32N E ${E.toFixed(1)} · N ${N.toFixed(1)} &nbsp;|&nbsp; ${editing.lat.toFixed(6)}, ${editing.lng.toFixed(6)}`;
}
function renderCats() {
  const box = $('#fCat'); box.innerHTML = '';
  CATEGORIE.forEach(c => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (editing.cat === c.id ? ' on' : '');
    b.innerHTML = `<i style="background:${c.color}"></i>${esc(c.label)}`;
    b.onclick = () => { editing.cat = c.id; renderCats(); };
    box.appendChild(b);
  });
}
function renderPrio() {
  document.querySelectorAll('#fPrio button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === editing.prio);
    b.onclick = () => { editing.prio = b.dataset.v; renderPrio(); };
  });
}
const urlCache = new WeakMap();
function blobUrl(b) { if (!urlCache.has(b)) urlCache.set(b, URL.createObjectURL(b)); return urlCache.get(b); }
function renderPhotos() {
  const box = $('#fPhotos'); box.innerHTML = '';
  editing.photos.forEach((ph, i) => {
    const d = document.createElement('div'); d.className = 'ph';
    d.innerHTML = `<img src="${blobUrl(ph.blob)}" alt=""><button type="button" title="Rimuovi">×</button>`;
    d.querySelector('img').onclick = () => showImg(ph.blob);
    d.querySelector('button').onclick = () => { if (confirm('Rimuovere questa foto?')) { editing.photos.splice(i, 1); renderPhotos(); } };
    box.appendChild(d);
  });
}
function showImg(blob) { const v = $('#viewer'); v.querySelector('img').src = blobUrl(blob); v.hidden = false; }
$('#viewer').onclick = () => ($('#viewer').hidden = true);

async function resizeImage(file, maxSide = 1600, q = 0.82) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height, k = Math.min(1, maxSide / Math.max(w, h));
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', q));
}
async function addFiles(files) {
  for (const f of files) {
    try {
      const blob = await resizeImage(f);
      editing.photos.push({ blob, ts: Date.now(), lat: gpsPos?.lat ?? null, lng: gpsPos?.lng ?? null });
    } catch (e) { toast('Impossibile leggere una foto'); }
  }
  renderPhotos();
}
$('#fCam').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
$('#fGal').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };

$('#pform').onsubmit = async e => {
  e.preventDefault();
  editing.titolo = $('#fTitolo').value.trim() || catById(editing.cat).label;
  editing.note = $('#fNote').value.trim();
  editing.updated = Date.now();
  if (!editing.operatore) editing.operatore = ls('operatore') || '';
  ls('lastCat', editing.cat);
  await DB.put('punti', editing);
  await loadPunti(); closePanels(); toast('Punto P' + pad(editing.n) + ' salvato');
};
$('#fDelete').onclick = async () => {
  if (!confirm('Eliminare definitivamente il punto P' + pad(editing.n) + '?')) return;
  await DB.del('punti', editing.id); await loadPunti(); closePanels(); toast('Punto eliminato');
};
$('#fMove').onclick = () => {
  const keep = editing;
  startPlace({
    ok: pos => { editing = keep; Object.assign(editing, { lat: pos.lat, lng: pos.lng, acc: pos.acc, src: pos.src, foglio: foglioAt(pos.lat, pos.lng) }); renderFormMeta(); openPanel('#panelForm'); },
    cancel: () => { editing = keep; openPanel('#panelForm'); },
  }, [keep.lat, keep.lng]);
};

/* elenco */
function renderList() {
  $('#operatore').value = ls('operatore') || '';
  const ul = $('#plist'); ul.innerHTML = '';
  const nf = punti.reduce((s, p) => s + p.photos.length, 0);
  $('#stats').textContent = `${punti.length} punti · ${nf} foto · ${tracce.length} tracce`;
  if (!punti.length) ul.innerHTML = '<li class="muted small">Nessun punto ancora. Usa il pulsante "Punto" in basso.</li>';
  punti.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num" style="background:${catById(p.cat).color}">${p.n}</span>
      <span class="txt"><b>${esc(p.titolo)}</b><span>${esc(catById(p.cat).label)} · ${esc(p.foglio || 'fuori tavole')} · ${p.photos.length} foto</span></span>
      ${p.photos[0] ? `<img src="${blobUrl(p.photos[0].blob)}" alt="">` : ''}`;
    li.onclick = () => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 19)); openForm(p); };
    ul.appendChild(li);
  });
  const tl = $('#tlist'); tl.innerHTML = '';
  if (!tracce.length) tl.innerHTML = '<li class="muted small">Nessuna traccia registrata.</li>';
  tracce.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${fmtDate(t.start)} · ${fmtM(lineLength(t.pts.map(p => [p[0], p[1]])))} · ${t.pts.length} pt</span><button class="btn ghost">Elimina</button>`;
    li.querySelector('span').onclick = () => { if (t.pts.length > 1) { map.fitBounds(t.pts.map(p => [p[0], p[1]])); closePanels(); } };
    li.querySelector('button').onclick = async () => { if (confirm('Eliminare la traccia?')) { await DB.del('tracce', t.id); await loadTracce(); renderList(); } };
    tl.appendChild(li);
  });
}
$('#operatore').onchange = e => ls('operatore', e.target.value.trim());

/* ---------------- tracce GPS ---------------- */
let tracking = false, curTrack = null, tracce = [];
const tracceLyr = L.layerGroup().addTo(map);
let curLine = null;
async function loadTracce() {
  tracce = await DB.all('tracce');
  tracceLyr.clearLayers();
  tracce.forEach(t => L.polyline(t.pts.map(p => [p[0], p[1]]), { color: '#fab005', weight: 4, opacity: .9, dashArray: '1 7', lineCap: 'round' }).addTo(tracceLyr));
}
function addTrackPoint(p) {
  const last = curTrack.pts[curTrack.pts.length - 1];
  if (last && L.latLng(last[0], last[1]).distanceTo([p.lat, p.lng]) < Math.max(3, p.acc / 3)) return;
  if (p.acc > 40) return;
  curTrack.pts.push([+p.lat.toFixed(7), +p.lng.toFixed(7), Math.round(p.acc), p.ts]);
  curLine.addLatLng([p.lat, p.lng]);
  if (curTrack.pts.length % 5 === 0) DB.put('tracce', curTrack);
}
$('#btnTrack').onclick = async () => {
  if (!tracking) {
    startGps();
    curTrack = { id: 't' + Date.now(), start: Date.now(), pts: [] };
    curLine = L.polyline([], { color: '#e03131', weight: 4 }).addTo(map);
    tracking = true; $('#btnTrack').classList.add('rec'); toast('Registrazione traccia avviata');
  } else {
    tracking = false; $('#btnTrack').classList.remove('rec');
    map.removeLayer(curLine);
    if (curTrack.pts.length > 1) { curTrack.end = Date.now(); await DB.put('tracce', curTrack); toast('Traccia salvata: ' + fmtM(lineLength(curTrack.pts.map(p => [p[0], p[1]])))); }
    else { await DB.del('tracce', curTrack.id); toast('Traccia troppo corta, non salvata'); }
    await loadTracce();
  }
};

/* ---------------- misura ---------------- */
let measuring = false, mPts = [], mLine = null, mMarks = null;
function mUpdate() {
  mLine.setLatLngs(mPts); mMarks.clearLayers();
  mPts.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#0f3d5c', fillOpacity: 1 }).addTo(mMarks));
  const d = lineLength(mPts);
  $('#measureVal').textContent = fmtM(d);
  if (mPts.length > 1) mMarks.getLayers().slice(-1)[0].bindTooltip(fmtM(d), { permanent: true, direction: 'top', className: 'measure-tip' }).openTooltip();
}
function mClick(e) { mPts.push(e.latlng); mUpdate(); }
$('#btnMeasure').onclick = () => {
  if (measuring) return $('#measureEnd').onclick();
  measuring = true; mPts = []; closePanels();
  mLine = L.polyline([], { color: '#0f3d5c', weight: 3, dashArray: '6 6' }).addTo(map); mMarks = L.layerGroup().addTo(map);
  map.on('click', mClick); $('#measurebar').hidden = false; $('#fab').hidden = true; $('#btnMeasure').classList.add('on'); mUpdate();
};
$('#measureUndo').onclick = () => { mPts.pop(); mUpdate(); };
$('#measureClear').onclick = () => { mPts = []; mUpdate(); };
$('#measureEnd').onclick = () => {
  measuring = false; map.off('click', mClick); map.removeLayer(mLine); map.removeLayer(mMarks);
  $('#measurebar').hidden = true; $('#fab').hidden = false; $('#btnMeasure').classList.remove('on');
};

/* ---------------- export / import ---------------- */
function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`; }
function photoName(p, i) { return `P${pad(p.n)}_${i + 1}.jpg`; }
function puntiGeoJSON(withPhotoNames = true) {
  return {
    type: 'FeatureCollection', name: `sopralluogo_${CFG.commessa}`,
    features: punti.map(p => {
      const [E, N] = toUTM32(p.lat, p.lng);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lng.toFixed(7), +p.lat.toFixed(7)] },
        properties: { id: p.id, codice: 'P' + pad(p.n), n: p.n, categoria: catById(p.cat).label, cat_id: p.cat, titolo: p.titolo, note: p.note,
          priorita: p.prio, foglio: p.foglio || '', est_utm32: +E.toFixed(2), nord_utm32: +N.toFixed(2), accuratezza_m: p.acc ? Math.round(p.acc) : null,
          origine_pos: p.src || '', rilevatore: p.operatore || '', data: new Date(p.created).toISOString(),
          n_foto: p.photos.length, foto: withPhotoNames ? p.photos.map((_, i) => 'foto/' + photoName(p, i)).join(';') : '' } };
    }),
  };
}
function tracceGeoJSON() {
  return { type: 'FeatureCollection', name: 'tracce', features: tracce.filter(t => t.pts.length > 1).map(t => ({ type: 'Feature',
    geometry: { type: 'LineString', coordinates: t.pts.map(p => [p[1], p[0]]) },
    properties: { id: t.id, inizio: new Date(t.start).toISOString(), fine: t.end ? new Date(t.end).toISOString() : '', lunghezza_m: Math.round(lineLength(t.pts.map(p => [p[0], p[1]]))) } })) };
}
function csv(gj) {
  const cols = ['codice', 'categoria', 'titolo', 'note', 'priorita', 'foglio', 'est_utm32', 'nord_utm32', 'lat', 'lon', 'accuratezza_m', 'rilevatore', 'data', 'n_foto', 'foto'];
  const q = v => { v = v == null ? '' : String(v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = gj.features.map(f => cols.map(c => c === 'lat' ? String(f.geometry.coordinates[1]).replace('.', ',') : c === 'lon' ? String(f.geometry.coordinates[0]).replace('.', ',')
    : (c === 'est_utm32' || c === 'nord_utm32') ? String(f.properties[c]).replace('.', ',') : q(f.properties[c])).join(';'));
  return '﻿' + cols.join(';') + '\r\n' + rows.join('\r\n');
}
function reportHtml(gj) {
  const op = ls('operatore') || '';
  const items = punti.map(p => `<section><h2><span style="background:${catById(p.cat).color}">P${pad(p.n)}</span> ${esc(p.titolo)}</h2>
    <p class="m">${esc(catById(p.cat).label)} · priorità ${esc(p.prio)} · foglio ${esc(p.foglio || 'fuori tavole')} · ${fmtDate(p.created)}<br>
    UTM32N E ${toUTM32(p.lat, p.lng)[0].toFixed(1)} N ${toUTM32(p.lat, p.lng)[1].toFixed(1)} · <a href="https://www.google.com/maps?q=${p.lat},${p.lng}">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</a></p>
    ${p.note ? `<p>${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="g">${p.photos.map((_, i) => `<a href="foto/${photoName(p, i)}"><img src="foto/${photoName(p, i)}"></a>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="it"><meta charset="utf-8"><title>Report sopralluogo ${CFG.commessa} ${CFG.nome}</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1d2733}h1{color:#0f3d5c;margin-bottom:4px}
section{border-top:1px solid #dde3ea;padding:12px 0;page-break-inside:avoid}h2{font-size:17px;margin:0 0 4px}h2 span{color:#fff;border-radius:6px;padding:2px 7px;font-size:14px;margin-right:4px}
.m{color:#66727f;font-size:13px;margin:0 0 6px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.g img{width:100%;border-radius:6px}</style>
<h1>Sopralluogo – Commessa ${CFG.commessa} ${CFG.nome}</h1><p class="m">Collettore fognario – esportato il ${fmtDate(Date.now())}${op ? ' · rilevatore: ' + esc(op) : ''} · ${punti.length} punti</p>${items}</html>`;
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
$('#btnExportZip').onclick = async () => {
  if (!punti.length && !tracce.length) return toast('Nessun dato da esportare');
  if (typeof JSZip === 'undefined') return toast('Libreria ZIP non disponibile: riprova con rete');
  toast('Preparazione ZIP…', 6000);
  const zip = new JSZip(); const gj = puntiGeoJSON();
  zip.file('punti_sopralluogo.geojson', JSON.stringify(gj, null, 1));
  zip.file('punti_sopralluogo.csv', csv(gj));
  zip.file('tracce_gps.geojson', JSON.stringify(tracceGeoJSON()));
  zip.file('report.html', reportHtml(gj));
  punti.forEach(p => p.photos.forEach((ph, i) => zip.file('foto/' + photoName(p, i), ph.blob)));
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, `sopralluogo_${CFG.commessa}_${stamp()}.zip`); toast('ZIP esportato');
};
$('#btnExportGeo').onclick = () => {
  if (!punti.length) return toast('Nessun punto da esportare');
  download(new Blob([JSON.stringify(puntiGeoJSON(false), null, 1)], { type: 'application/geo+json' }), `punti_sopralluogo_${CFG.commessa}_${stamp()}.geojson`);
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    let gj, zip = null, tgj = null;
    if (/\.zip$/i.test(f.name)) {
      zip = await JSZip.loadAsync(f);
      const gf = zip.file(/punti_sopralluogo\.geojson$/)[0]; if (!gf) throw new Error('GeoJSON non trovato nello ZIP');
      gj = JSON.parse(await gf.async('string'));
      const tf = zip.file(/tracce_gps\.geojson$/)[0]; if (tf) tgj = JSON.parse(await tf.async('string'));
    } else gj = JSON.parse(await f.text());
    let add = 0, upd = 0;
    for (const ft of gj.features || []) {
      if (!ft.geometry || ft.geometry.type !== 'Point') continue;
      const pr = ft.properties || {};
      const id = pr.id || ('imp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const exists = punti.find(p => p.id === id);
      const photos = [];
      if (zip && pr.foto) for (const fn of pr.foto.split(';').filter(Boolean)) {
        const zf = zip.file(fn); if (zf) photos.push({ blob: new Blob([await zf.async('arraybuffer')], { type: 'image/jpeg' }), ts: Date.now() });
      }
      const lat = ft.geometry.coordinates[1], lng = ft.geometry.coordinates[0];
      const cat = CATEGORIE.some(c => c.id === pr.cat_id) ? pr.cat_id : 'altro';
      let n = pr.n || nextNum();
      if (!exists && punti.some(p => p.n === n)) n = nextNum();
      const rec = { id, n: exists ? exists.n : n, cat, titolo: pr.titolo || '', note: pr.note || '', prio: pr.priorita || 'media', lat, lng,
        acc: pr.accuratezza_m || null, src: pr.origine_pos || 'import', foglio: foglioAt(lat, lng), operatore: pr.rilevatore || '',
        created: pr.data ? Date.parse(pr.data) : Date.now(), updated: Date.now(), photos: photos.length ? photos : (exists ? exists.photos : []) };
      await DB.put('punti', rec); exists ? upd++ : add++;
      if (!exists) punti.push(rec);
    }
    if (tgj) for (const ft of tgj.features || []) {
      const id = ft.properties?.id || 't' + Date.now() + Math.random();
      if (tracce.some(t => t.id === id)) continue;
      await DB.put('tracce', { id, start: Date.parse(ft.properties?.inizio) || Date.now(), end: Date.parse(ft.properties?.fine) || null,
        pts: ft.geometry.coordinates.map(c => [c[1], c[0], null, null]) });
    }
    await loadPunti(); await loadTracce(); renderList();
    toast(`Importati ${add} punti nuovi, ${upd} aggiornati`);
  } catch (err) { console.error(err); toast('Importazione non riuscita: ' + err.message, 5000); }
};
$('#btnWipe').onclick = async () => {
  if (!confirm('Cancellare TUTTI i punti, le foto e le tracce salvati su questo dispositivo?\nEsporta prima lo ZIP se ti servono.')) return;
  if (!confirm('Confermi la cancellazione definitiva?')) return;
  await DB.clear('punti'); await DB.clear('tracce'); await loadPunti(); await loadTracce(); renderList(); toast('Dati cancellati');
};

/* ---------------- offline ---------------- */
function netState() { const on = navigator.onLine; const p = $('#netstate'); p.textContent = on ? 'online' : 'offline'; p.classList.toggle('off', !on); }
addEventListener('online', netState); addEventListener('offline', netState); netState();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
$('#btnOffline').onclick = async () => {
  if (!('caches' in window)) return toast('Il browser non supporta la cache offline');
  const btn = $('#btnOffline'); btn.disabled = true;
  const prog = $('#offlineProg'); prog.hidden = false;
  try {
    const list = await fetch('data/tiles_offline.json').then(r => r.json());
    const urls = list.map(t => `tiles/tavole/${t}.webp`);
    const gen = [];
    for (let z = 12; z <= 17; z++) { // planimetria generale fino a z17
      const b = L.latLngBounds(CFG.generaleBounds);
      const p1 = map.project(b.getNorthWest(), z).divideBy(256).floor(), p2 = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++) gen.push(`tiles/generale/${z}/${x}/${y}.webp`);
    }
    const all = urls.concat(gen);
    const cache = await caches.open('gard-tiles-v1');
    let done = 0, i = 0;
    const upd = () => { prog.firstElementChild.style.width = (100 * done / all.length) + '%'; prog.lastElementChild.textContent = `${done} / ${all.length}`; };
    const worker = async () => {
      while (i < all.length) {
        const u = all[i++];
        try { if (!(await cache.match(u))) { const r = await fetch(u); if (r.ok) await cache.put(u, r); } } catch (e) { }
        done++; if (done % 25 === 0) upd();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker)); upd();
    toast('Planimetrie disponibili offline'); ls('offlineDone', Date.now());
  } catch (e) { toast('Download interrotto: ' + e.message); }
  btn.disabled = false;
};
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

/* ---------------- avvio ---------------- */
(async function init() {
  try { await DB.open(); await loadPunti(); await loadTracce(); } catch (e) { toast('Archivio locale non disponibile: i punti non verranno salvati', 6000); }
  await Promise.all([loadVectors(), loadFogli()]);
})();

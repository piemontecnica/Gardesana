# Sopralluogo 26_071 Gardesana

Webapp statica (Leaflet) per il sopralluogo del collettore fognario Gardesana: planimetrie di progetto, opere vettoriali, GPS, punti con note e foto, tracce, misure ed esportazione.

## Pubblicazione su GitHub Pages
La cartella contiene circa 20.000 file di tile: il caricamento dal browser di GitHub (max 100 file per volta) non basta, usa **git** o **GitHub Desktop**.

```bash
cd webapp_sopralluogo_26071_gardesana
git init -b main
git add .
git commit -m "Webapp sopralluogo 26_071 Gardesana"
git remote add origin https://github.com/<utente>/sopralluogo-gardesana.git
git push -u origin main
```
Poi su GitHub: **Settings → Pages → Branch: main / (root) → Save**. L'app sarà su `https://<utente>.github.io/sopralluogo-gardesana/`.

Nota: un repo pubblico rende visibili le tavole a chiunque abbia il link (GitHub Pages da repo privato richiede un piano a pagamento).

## Uso in campo
- **Punto**: mirino al centro mappa, "Usa GPS" o sposta la mappa, poi Conferma → categoria, titolo, note, priorità, foto (fotocamera o galleria). Il foglio di progetto viene riconosciuto in automatico.
- **GPS**: primo tocco attiva la posizione, poi alterna "segui posizione".
- **Traccia**: registra il percorso fatto (pulsante rosso durante la registrazione).
- **Misura**: distanze cumulate toccando la mappa.
- **Livelli**: sfondo satellite/stradale, opacità tavole, planimetria generale, quadro d'unione, "Vai al foglio", download offline delle planimetrie (~40 MB).
- **Tavole PDF**: tocca un impianto, una vasca o un pozzetto per vedere le tavole collegate e aprirle nel visualizzatore interno (zoom con due dita, pulsante "‹ Mappa" per tornare). In Livelli → "Scarica tavole PDF per uso offline" (~68 MB) le salva sul telefono; nel popup compare "✓ offline" accanto a quelle già scaricate.
- **Elenco**: punti e tracce, esportazione ZIP (GeoJSON + CSV con coordinate UTM32N + foto + report.html stampabile), importazione ZIP/GeoJSON per unire i rilievi dei colleghi.

I dati restano sul dispositivo (IndexedDB) finché non vengono esportati: esportare lo ZIP a fine sopralluogo. Per installarla come app: menu del browser → "Aggiungi a schermata Home".

## Contenuto
- `tiles/tavole` – tavole B-14÷B-29 e B-35÷B-46 (B-15 e B-17 da Q2-GH e Q4-GH), WebP z13-20 dai GeoTIFF georeferenziati in QGIS (nero = trasparente come nel progetto).
- `tiles/generale` – planimetria generale nord, z12-18.
- `docs/` – tavole PDF di impianti, vasche e particolari dei pozzetti; i collegamenti elemento → tavole sono in `data/documenti.json` (modificabile a mano).
- `lib/pdfjs/` – pdf.js 3.11 (Mozilla, licenza Apache 2.0) per il visualizzatore delle tavole.
- `data/*.geojson` – layer vettoriali del progetto QGIS `Gardesana.qgz` (WGS84) e quadro d'unione fogli.
- Tavole B-30÷B-34 non incluse: non georeferenziate.

Per aggiornare un layer vettoriale: riesporta il GeoPackage in GeoJSON EPSG:4326 con lo stesso nome file in `data/`.

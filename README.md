# Tai Po Kau plants map (GitHub Pages)

Static Leaflet map of **concrete / non-obscured** iNaturalist plant observations inside the Tai Po Kau Nature Reserve bounding box, with Flora of Hong Kong (FoHK) November phenology categories.

**Bounds:** N 22.4421274, E 114.1994399, S 22.4107895, W 114.1584089

## Categories

1. **Flowers in November** — FoHK lists November flowering exactly, and/or empirical flowering-now evidence (iNat flowering annotations / likely assessment).
2. **FoHK ±1 month (Oct or Dec only)** — FoHK flowering ends in October or begins in December (in season for early November only via adjacent month).
3. **Other species** — remaining concrete-location plants in the bbox.

## Local preview

Any static file server from this folder root (GitHub Pages serves `index.html` at the site root):

```bash
cd tai-po-kau-plants-map
python3 -m http.server 8080
# open http://localhost:8080
```

Or with Node: `npx serve .`

## Publish to GitHub Pages

### Option A — new public repo (recommended)

1. Create an empty **public** repository (e.g. `tai-po-kau-plants-map`).
2. Push this folder to the default branch:

```bash
cd tai-po-kau-plants-map
git init
git add .
git commit -m "Tai Po Kau plants phenology map"
git branch -M main
git remote add origin https://github.com/<USER>/tai-po-kau-plants-map.git
git push -u origin main
```

3. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**.
4. Site URL: `https://<USER>.github.io/tai-po-kau-plants-map/`

### Option B — `docs/` on an existing repo

Copy these files into `docs/` on `main`, then set Pages source to `/docs`.

## Data notes

- Observations: iNaturalist API, iconic taxon Plantae, geo=true, concrete locations only.
- Phenology: FoHK Ecology flowering/fruiting text parsed from the HK Herbarium FoHK extract spreadsheet; ±1 month window around November = Oct–Dec.
- Generated early November 2026 (Asia/Hong_Kong).

## License / attribution

Observation data © iNaturalist contributors (CC BY / CC0 depending on observation). Map tiles © OpenStreetMap / Esri. FoHK text used for phenology matching under flora citation norms.

(async function () {
  const COLORS = {
    flowers_nov: '#e11d48',
    adjacent_oct_dec: '#f59e0b',
    other: '#64748b',
  };
  const ORDER = ['flowers_nov', 'adjacent_oct_dec', 'other'];

  const [meta, species, obsGeo, centroids] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/species.json').then((r) => r.json()),
    fetch('data/observations.geojson').then((r) => r.json()),
    fetch('data/species_centroids.geojson').then((r) => r.json()),
  ]);

  const speciesByName = Object.fromEntries(species.map((s) => [s.name, s]));
  const enabled = { flowers_nov: true, adjacent_oct_dec: true, other: true };

  document.getElementById('as-of').textContent = `Assessment as of ${meta.as_of}`;
  document.getElementById('stat-obs').textContent = meta.counts.observations.toLocaleString();
  document.getElementById('stat-spp').textContent = meta.counts.species.toLocaleString();

  const catCards = document.getElementById('cat-cards');
  const catFilters = document.getElementById('cat-filters');
  const legend = document.getElementById('map-legend');
  legend.innerHTML = '<strong>Legend</strong>';

  ORDER.forEach((key) => {
    const c = meta.categories[key];
    const nSp = meta.counts.by_category_species[key] || 0;
    const nObs = meta.counts.by_category_obs[key] || 0;
    const card = document.createElement('div');
    card.className = 'cat-card active';
    card.dataset.cat = key;
    card.innerHTML = `
      <span class="cat-dot" style="background:${c.color}"></span>
      <div><div class="title">${c.label}</div><div class="sub">${c.description}</div></div>
      <div class="nums">${nSp} spp<br>${nObs} obs</div>`;
    card.addEventListener('click', () => {
      enabled[key] = !enabled[key];
      card.classList.toggle('active', enabled[key]);
      const chip = catFilters.querySelector(`input[data-cat="${key}"]`);
      if (chip) chip.checked = enabled[key];
      refreshLayers();
    });
    catCards.appendChild(card);

    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" data-cat="${key}" checked /> <span class="cat-dot" style="background:${c.color};width:10px;height:10px;border-radius:50%;display:inline-block"></span> ${c.label}`;
    label.querySelector('input').addEventListener('change', (e) => {
      enabled[key] = e.target.checked;
      card.classList.toggle('active', enabled[key]);
      refreshLayers();
    });
    catFilters.appendChild(label);

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<i style="background:${c.color}"></i><span>${c.label}</span>`;
    legend.appendChild(row);
  });

  const MAP_MAX_ZOOM = 22; // overzoom past OSM/Esri native tiles (~19)
  const b = meta.bbox;
  const bounds = L.latLngBounds([b.swlat, b.swlng], [b.nelat, b.nelng]);
  const map = L.map('map', {
    zoomControl: true,
    preferCanvas: true,
    maxZoom: MAP_MAX_ZOOM,
  });
  map.fitBounds(bounds.pad(0.08));

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: MAP_MAX_ZOOM,
    attribution: '&copy; OpenStreetMap',
  });
  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxNativeZoom: 19,
      maxZoom: MAP_MAX_ZOOM,
      attribution: 'Tiles &copy; Esri',
    }
  );
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 17,
    maxZoom: MAP_MAX_ZOOM,
    attribution: '&copy; OpenStreetMap, SRTM | OpenTopoMap',
  });
  osm.addTo(map);
  L.control
    .layers(
      {
        OpenStreetMap: osm,
        'Esri imagery': esri,
        OpenTopoMap: topo,
      },
      {},
      { position: 'topright' }
    )
    .addTo(map);

  const bboxRect = L.rectangle(bounds, {
    color: '#5eead4',
    weight: 1.5,
    dashArray: '6 4',
    fillOpacity: 0.03,
    interactive: false,
  }).addTo(map);

  function pinIcon(cat) {
    return L.divIcon({
      className: '',
      html: `<div class="cat-pin" style="background:${COLORS[cat] || COLORS.other}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  let clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 42,
    spiderfyOnMaxZoom: true,
    // Uncluster before overzoom so individual pins stay clickable at z 19–22
    disableClusteringAtZoom: 19,
    maxZoom: MAP_MAX_ZOOM,
  });
  let plainGroup = L.layerGroup();
  let centroidGroup = L.layerGroup();
  let useCluster = true;
  let useCentroids = false;

  function featureVisible(props) {
    return !!enabled[props.category || 'other'];
  }

  function showSpecies(name) {
    const s = speciesByName[name];
    if (!s) return;
    const empty = document.getElementById('info-empty');
    const body = document.getElementById('info-body');
    empty.hidden = true;
    body.hidden = false;
    const cat = meta.categories[s.category] || meta.categories.other;
    const links = [];
    (s.urls || []).forEach((u, i) => links.push(`<a href="${u}" target="_blank" rel="noopener">Obs ${i + 1}</a>`));
    (s.fl_urls || []).forEach((u, i) =>
      links.push(`<a href="${u}" target="_blank" rel="noopener">Flowering ann. ${i + 1}</a>`)
    );
    body.innerHTML = `
      <h3>${s.name}</h3>
      ${s.chinese ? `<div class="chinese">${s.chinese}</div>` : ''}
      ${s.common ? `<div class="muted" style="color:var(--muted);margin-bottom:.35rem">${s.common}</div>` : ''}
      <span class="badge ${s.category}">${cat.label}</span>
      <dl class="kv">
        <div><dt>FoHK name</dt><dd>${s.fohk || (s.matched ? '—' : 'unmatched')}</dd></div>
        <div><dt>FoHK flowering</dt><dd>${s.fl_raw || '—'}</dd></div>
        <div><dt>FoHK fruiting</dt><dd>${s.fr_raw || '—'}</dd></div>
        <div><dt>FoHK Nov exact</dt><dd>${s.exact_nov === true ? 'yes' : s.exact_nov === false ? 'no' : '—'}</dd></div>
        <div><dt>FoHK Nov ±1 mo</dt><dd>${s.pm1 === true ? 'yes (Oct–Dec window)' : s.pm1 === false ? 'no' : '—'}</dd></div>
        <div><dt>Flowering now</dt><dd>${s.assessment || '—'}</dd></div>
        <div><dt>Fruiting now</dt><dd>${s.fruit_assessment || '—'}</dd></div>
        <div><dt>iNat obs (concrete)</dt><dd>${s.n_obs} (${s.n_rg} research grade)</dd></div>
        <div><dt>iNat fl. Nov</dt><dd>${s.fl_ann_nov}</dd></div>
        <div><dt>iNat fl. Oct–Nov ’24–26</dt><dd>${s.fl_ann_recent}</dd></div>
        <div><dt>Evidence</dt><dd>${s.evidence || '—'}</dd></div>
      </dl>
      <div class="links">${links.join('') || '<span style="color:var(--muted);font-size:.85rem">No example links</span>'}</div>
    `;
  }

  function bindMarker(marker, props) {
    marker.on('click', () => {
      showSpecies(props.name);
      if (props.url) {
        marker.bindPopup(
          `<strong><em>${props.name}</em></strong><br>${props.date || ''}<br><a href="${props.url}" target="_blank" rel="noopener">Open on iNaturalist</a>`
        ).openPopup();
      }
    });
  }

  function rebuildMarkers() {
    clusterGroup.clearLayers();
    plainGroup.clearLayers();
    centroidGroup.clearLayers();

    if (useCentroids) {
      centroids.features.forEach((f) => {
        if (!featureVisible(f.properties)) return;
        const [lng, lat] = f.geometry.coordinates;
        const m = L.marker([lat, lng], { icon: pinIcon(f.properties.category) });
        bindMarker(m, f.properties);
        m.bindTooltip(`${f.properties.name} (n=${f.properties.n})`, { direction: 'top', opacity: 0.9 });
        centroidGroup.addLayer(m);
      });
    } else {
      obsGeo.features.forEach((f) => {
        if (!featureVisible(f.properties)) return;
        const [lng, lat] = f.geometry.coordinates;
        const m = L.circleMarker([lat, lng], {
          radius: 5,
          color: '#fff',
          weight: 1,
          fillColor: COLORS[f.properties.category] || COLORS.other,
          fillOpacity: 0.85,
        });
        bindMarker(m, f.properties);
        if (useCluster) clusterGroup.addLayer(m);
        else plainGroup.addLayer(m);
      });
    }
  }

  function refreshLayers() {
    map.removeLayer(clusterGroup);
    map.removeLayer(plainGroup);
    map.removeLayer(centroidGroup);
    rebuildMarkers();
    if (useCentroids) centroidGroup.addTo(map);
    else if (useCluster) clusterGroup.addTo(map);
    else plainGroup.addTo(map);
  }

  document.getElementById('cluster-toggle').addEventListener('change', (e) => {
    useCluster = e.target.checked;
    refreshLayers();
  });
  document.getElementById('centroid-toggle').addEventListener('change', (e) => {
    useCentroids = e.target.checked;
    refreshLayers();
  });

  // Search
  const search = document.getElementById('search');
  const results = document.getElementById('search-results');
  function runSearch(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      results.innerHTML = '';
      return;
    }
    const hits = species
      .filter((s) =>
        s.name.toLowerCase().includes(q) ||
        (s.chinese || '').includes(q) ||
        (s.common || '').toLowerCase().includes(q) ||
        (s.fohk || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
    results.innerHTML = hits
      .map(
        (s) =>
          `<li data-name="${s.name.replace(/"/g, '&quot;')}"><em>${s.name}</em>${
            s.chinese ? ` · ${s.chinese}` : ''
          }<div class="muted">${meta.categories[s.category].label} · ${s.n_obs} obs</div></li>`
      )
      .join('');
    results.hidden = hits.length === 0;
  }
  search.addEventListener('input', () => runSearch(search.value));
  results.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const name = li.dataset.name;
    showSpecies(name);
    results.hidden = true;
    search.value = name;
    // zoom to species points
    const pts = (useCentroids ? centroids : obsGeo).features.filter((f) => f.properties.name === name);
    if (pts.length) {
      const ll = pts.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
      map.fitBounds(L.latLngBounds(ll).pad(0.35), { maxZoom: 21 });
    }
  });

  refreshLayers();
})().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fda4af;padding:2rem">Failed to load map data.\n${err}</pre>`;
});

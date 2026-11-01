(async function () {
  const COLORS = {
    flowers_nov: '#e11d48',
    adjacent_oct_dec: '#f59e0b',
    other: '#64748b',
  };
  const ORDER = ['flowers_nov', 'adjacent_oct_dec', 'other'];
  const RADII = [5, 20, 50];
  const RING_CLASS = { 5: 'ring-5', 20: 'ring-20', 50: 'ring-50' };
  const CIRCLE_STYLE = {
    5: { color: '#5eead4', fillColor: '#5eead4', fillOpacity: 0.12, weight: 2 },
    20: { color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.07, weight: 1.5, dashArray: '4 3' },
    50: { color: '#a78bfa', fillColor: '#a78bfa', fillOpacity: 0.04, weight: 1.5, dashArray: '6 4' },
  };

  const [meta, species, obsGeo, centroids] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/species.json').then((r) => r.json()),
    fetch('data/observations.geojson').then((r) => r.json()),
    fetch('data/species_centroids.geojson').then((r) => r.json()),
  ]);

  const speciesByName = Object.fromEntries(species.map((s) => [s.name, s]));
  const enabled = { flowers_nov: true, adjacent_oct_dec: true, other: true };
  const radiusEnabled = { 5: true, 20: true, 50: true };

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
      if (lastUserPos) renderNearResults(lastUserPos);
    });
    catCards.appendChild(card);

    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" data-cat="${key}" checked /> <span class="cat-dot" style="background:${c.color};width:10px;height:10px;border-radius:50%;display:inline-block"></span> ${c.label}`;
    label.querySelector('input').addEventListener('change', (e) => {
      enabled[key] = e.target.checked;
      card.classList.toggle('active', enabled[key]);
      refreshLayers();
      if (lastUserPos) renderNearResults(lastUserPos);
    });
    catFilters.appendChild(label);

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<i style="background:${c.color}"></i><span>${c.label}</span>`;
    legend.appendChild(row);
  });

  const MAP_MAX_ZOOM = 22;
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

  L.rectangle(bounds, {
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
    disableClusteringAtZoom: 19,
    maxZoom: MAP_MAX_ZOOM,
  });
  let plainGroup = L.layerGroup();
  let centroidGroup = L.layerGroup();
  let useCluster = true;
  let useCentroids = false;
  let speciesFilterName = null; // when set, map shows only this species

  // GPS / near-me state
  let lastUserPos = null; // { lat, lng, accuracy }
  let watchId = null;
  let userLayer = L.layerGroup().addTo(map);
  let nearHighlight = L.layerGroup().addTo(map);
  let lastNearHits = []; // sorted within 50m

  function featureVisible(props) {
    if (!enabled[props.category || 'other']) return false;
    if (speciesFilterName && props.name !== speciesFilterName) return false;
    return true;
  }

  function setSpeciesFilter(name) {
    speciesFilterName = name || null;
    const bar = document.getElementById('species-filter-bar');
    const label = document.getElementById('species-filter-name');
    if (speciesFilterName) {
      bar.hidden = false;
      label.textContent = speciesFilterName;
    } else {
      bar.hidden = true;
      label.textContent = '';
    }
    refreshLayers();
    if (lastUserPos) renderNearResults(lastUserPos);
  }

  function clearSpeciesFilter() {
    search.value = '';
    results.hidden = true;
    results.innerHTML = '';
    setSpeciesFilter(null);
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function ringForDist(m) {
    if (m <= 5) return 5;
    if (m <= 20) return 20;
    return 50;
  }

  function formatDist(m) {
    if (m < 10) return `${m.toFixed(1)} m`;
    return `${Math.round(m)} m`;
  }

  function showSpecies(name, distanceM) {
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
    const distRow =
      distanceM != null
        ? `<div><dt>Distance</dt><dd>${formatDist(distanceM)}</dd></div>`
        : '';
    body.innerHTML = `
      <h3>${s.name}</h3>
      ${s.chinese ? `<div class="chinese">${s.chinese}</div>` : ''}
      ${s.common ? `<div class="muted" style="color:var(--muted);margin-bottom:.35rem">${s.common}</div>` : ''}
      <span class="badge ${s.category}">${cat.label}</span>
      <dl class="kv">
        ${distRow}
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
        marker
          .bindPopup(
            `<strong><em>${props.name}</em></strong><br>${props.date || ''}<br><a href="${props.url}" target="_blank" rel="noopener">Open on iNaturalist</a>`
          )
          .openPopup();
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
      .filter(
        (s) =>
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
    setSpeciesFilter(name);
    const pts = (useCentroids ? centroids : obsGeo).features.filter((f) => f.properties.name === name);
    if (pts.length) {
      const ll = pts.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
      map.fitBounds(L.latLngBounds(ll).pad(0.35), { maxZoom: 21 });
    }
  });
  document.getElementById('clear-species-filter').addEventListener('click', clearSpeciesFilter);

  // ——— Near me / GPS ———
  const locateBtn = document.getElementById('locate-btn');
  const locateBtnLabel = document.getElementById('locate-btn-label');
  const locateStatus = document.getElementById('locate-status');
  const radiusFilters = document.getElementById('radius-filters');
  const nearSummary = document.getElementById('near-summary');
  const nearResults = document.getElementById('near-results');
  const mapLocateBtn = document.getElementById('map-locate-btn');
  const stopLocateBtn = document.getElementById('stop-locate-btn');
  const mapStopBtn = document.getElementById('map-stop-btn');

  function setWatchingUI(watching) {
    locateBtn.classList.toggle('watching', watching);
    stopLocateBtn.hidden = !watching;
    stopLocateBtn.disabled = !watching;
    mapStopBtn.hidden = !watching;
    mapStopBtn.disabled = !watching;
    if (watching) {
      locateBtnLabel.textContent = 'Refresh location';
      mapLocateBtn.textContent = '◎ Refresh';
    } else {
      locateBtnLabel.textContent = lastUserPos ? 'Locate again · Near plants' : 'Locate me · Near plants';
      mapLocateBtn.textContent = '◎ Near me';
    }
  }

  function stopWatch(keepResults) {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setWatchingUI(false);
    locateBtn.disabled = false;
    if (keepResults && lastUserPos) {
      setLocateStatus('Live refresh stopped. Last position and Near me list kept — tap Locate again to resume.');
    } else if (!lastUserPos) {
      setLocateStatus('Uses your phone GPS (HTTPS). Finds observations within 5 m, 20 m, and 50 m.');
    }
  }

  function setLocateStatus(msg, isErr) {
    locateStatus.textContent = msg;
    locateStatus.classList.toggle('err', !!isErr);
  }

  function findNearby(lat, lng) {
    const hits = [];
    for (const f of obsGeo.features) {
      const props = f.properties;
      if (!featureVisible(props)) continue;
      const [olng, olat] = f.geometry.coordinates;
      const d = haversineM(lat, lng, olat, olng);
      if (d <= 50) {
        hits.push({
          dist: d,
          ring: ringForDist(d),
          lat: olat,
          lng: olng,
          props,
        });
      }
    }
    hits.sort((a, b) => a.dist - b.dist);
    return hits;
  }

  /** One nearest observation per species (still sorted by that nearest distance). */
  function uniqueSpeciesNearest(hits) {
    const seen = new Map();
    for (const h of hits) {
      const name = h.props.name;
      if (!seen.has(name)) seen.set(name, h);
    }
    return Array.from(seen.values()).sort((a, b) => a.dist - b.dist);
  }

  function drawUserAndRadii(lat, lng, accuracy) {
    userLayer.clearLayers();
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="user-loc-dot"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 })
      .bindTooltip('You are here', { permanent: false, direction: 'top' })
      .addTo(userLayer);

    if (accuracy && accuracy < 200) {
      L.circle([lat, lng], {
        radius: accuracy,
        color: '#38bdf8',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(userLayer);
    }

    RADII.forEach((r) => {
      const st = CIRCLE_STYLE[r];
      L.circle([lat, lng], {
        radius: r,
        color: st.color,
        weight: st.weight,
        dashArray: st.dashArray,
        fillColor: st.fillColor,
        fillOpacity: st.fillOpacity,
        interactive: false,
      }).addTo(userLayer);
    });
  }

  function highlightNearHits(hits) {
    nearHighlight.clearLayers();
    const filtered = hits.filter((h) => radiusEnabled[h.ring]);
    filtered.forEach((h) => {
      L.circleMarker([h.lat, h.lng], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: COLORS[h.props.category] || COLORS.other,
        fillOpacity: 1,
        zIndexOffset: 900,
      })
        .on('click', () => {
          showSpecies(h.props.name, h.dist);
          if (h.props.url) {
            window.open(h.props.url, '_blank', 'noopener');
          }
        })
        .bindTooltip(`${h.props.name} · ${formatDist(h.dist)}`, { direction: 'top' })
        .addTo(nearHighlight);
    });
  }

  function renderNearResults(pos) {
    const hits = findNearby(pos.lat, pos.lng);
    lastNearHits = hits;
    const bySpecies = uniqueSpeciesNearest(hits);

    const counts = { 5: 0, 20: 0, 50: 0 };
    const sppCounts = { 5: new Set(), 20: new Set(), 50: new Set() };
    hits.forEach((h) => {
      counts[h.ring] += 1;
      sppCounts[h.ring].add(h.props.name);
      // cumulative rings for summary: also count into larger rings
    });
    // cumulative ≤5 / ≤20 / ≤50
    const cumObs = {
      5: hits.filter((h) => h.dist <= 5).length,
      20: hits.filter((h) => h.dist <= 20).length,
      50: hits.filter((h) => h.dist <= 50).length,
    };
    const cumSpp = {
      5: new Set(hits.filter((h) => h.dist <= 5).map((h) => h.props.name)).size,
      20: new Set(hits.filter((h) => h.dist <= 20).map((h) => h.props.name)).size,
      50: new Set(hits.filter((h) => h.dist <= 50).map((h) => h.props.name)).size,
    };

    radiusFilters.hidden = false;
    nearSummary.hidden = false;
    nearResults.hidden = false;

    const acc =
      pos.accuracy != null ? ` · GPS ±${Math.round(pos.accuracy)} m` : '';
    nearSummary.innerHTML = `
      ≤5 m: <strong>${cumSpp[5]}</strong> spp / ${cumObs[5]} obs<br>
      ≤20 m: <strong>${cumSpp[20]}</strong> spp / ${cumObs[20]} obs<br>
      ≤50 m: <strong>${cumSpp[50]}</strong> spp / ${cumObs[50]} obs${acc}
    `;

    const groups = [
      { ring: 5, label: 'Within 5 m', items: bySpecies.filter((h) => h.ring === 5) },
      { ring: 20, label: '5–20 m', items: bySpecies.filter((h) => h.ring === 20) },
      { ring: 50, label: '20–50 m', items: bySpecies.filter((h) => h.ring === 50) },
    ];

    const parts = [];
    for (const g of groups) {
      if (!radiusEnabled[g.ring]) continue;
      parts.push(`<div class="near-group-label">${g.label} (${g.items.length})</div>`);
      if (!g.items.length) {
        parts.push(`<div class="info-empty" style="padding:.25rem 0">No species in this band</div>`);
        continue;
      }
      for (const h of g.items) {
        const s = speciesByName[h.props.name] || {};
        const cat = meta.categories[h.props.category] || {};
        const safeName = h.props.name.replace(/"/g, '&quot;');
        parts.push(`
          <button type="button" class="near-item" data-name="${safeName}" data-dist="${h.dist}" data-lat="${h.lat}" data-lng="${h.lng}">
            <span class="cat-dot" style="background:${COLORS[h.props.category] || COLORS.other};margin-top:4px"></span>
            <span>
              <div class="name">${h.props.name}</div>
              <div class="meta">${s.chinese || s.common || cat.label || ''} · ${h.props.date || ''}</div>
            </span>
            <span style="text-align:right">
              <div class="dist">${formatDist(h.dist)}</div>
              <span class="ring ${RING_CLASS[h.ring]}">≤${h.ring} m</span>
            </span>
          </button>
        `);
      }
    }
    nearResults.innerHTML = parts.join('') || '<div class="info-empty">No observations within 50 m (for enabled categories).</div>';

    highlightNearHits(hits);
  }

  nearResults.addEventListener('click', (e) => {
    const btn = e.target.closest('.near-item');
    if (!btn) return;
    const name = btn.dataset.name;
    const dist = parseFloat(btn.dataset.dist);
    const lat = parseFloat(btn.dataset.lat);
    const lng = parseFloat(btn.dataset.lng);
    showSpecies(name, dist);
    map.setView([lat, lng], Math.max(map.getZoom(), 20));
    document.getElementById('info-pane').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  radiusFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.radius-chip');
    if (!chip) return;
    const r = Number(chip.dataset.radius);
    radiusEnabled[r] = !radiusEnabled[r];
    chip.classList.toggle('active', radiusEnabled[r]);
    if (lastUserPos) renderNearResults(lastUserPos);
  });

  function onPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    lastUserPos = { lat, lng, accuracy };
    drawUserAndRadii(lat, lng, accuracy);
    renderNearResults(lastUserPos);

    // Fit to 50 m circle with a little padding
    const pad = 0.0007; // ~70–80 m
    map.fitBounds(
      [
        [lat - pad, lng - pad],
        [lat + pad, lng + pad],
      ],
      { maxZoom: 21, animate: true }
    );

    setLocateStatus(
      `Live GPS on (±${Math.round(accuracy)} m). Showing plants within 5 / 20 / 50 m. Tap Stop refresh to freeze.`
    );
    locateBtn.disabled = false;
    setWatchingUI(true);
  }

  function onGeoError(err) {
    locateBtn.disabled = false;
    // Keep watch if already running; only reset labels if no watch
    if (watchId == null) setWatchingUI(false);
    let msg = 'Could not read GPS.';
    if (err && err.code === 1) msg = 'Location permission denied. Enable location for this site in your phone browser.';
    else if (err && err.code === 2) msg = 'Position unavailable. Try again outdoors with GPS on.';
    else if (err && err.code === 3) msg = 'Location timed out. Try again.';
    else if (!window.isSecureContext) msg = 'Geolocation needs HTTPS (GitHub Pages) or localhost.';
    setLocateStatus(msg, true);
  }

  function startLocate() {
    if (!navigator.geolocation) {
      setLocateStatus('Geolocation is not supported on this browser.', true);
      return;
    }
    if (!window.isSecureContext) {
      setLocateStatus('GPS requires HTTPS. Open the GitHub Pages URL on your phone.', true);
      return;
    }
    locateBtn.disabled = true;
    locateBtnLabel.textContent = 'Locating…';
    mapLocateBtn.textContent = '◎ …';
    setLocateStatus('Requesting GPS… allow location when prompted.');

    const opts = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 5000,
    };

    navigator.geolocation.getCurrentPosition(onPosition, onGeoError, opts);

    // Keep a light watch while on trail (updates list as you walk)
    if (watchId == null) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          // Quiet updates without re-fitting map every time
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;
          lastUserPos = { lat, lng, accuracy };
          drawUserAndRadii(lat, lng, accuracy);
          renderNearResults(lastUserPos);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 25000 }
      );
    }
  }

  locateBtn.addEventListener('click', startLocate);
  mapLocateBtn.addEventListener('click', startLocate);
  stopLocateBtn.addEventListener('click', () => stopWatch(true));
  mapStopBtn.addEventListener('click', () => stopWatch(true));

  refreshLayers();
})().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fda4af;padding:2rem">Failed to load map data.\n${err}</pre>`;
});

const BERLIN_CENTER = { lat: 52.52, lng: 13.405 };
const STALE_AFTER_MS = 12000;
const LINE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#be123c',
  '#4f46e5',
  '#65a30d',
  '#ca8a04'
];

let map = null;
let infoWindow = null;
let directionsService = null;
let eventSource = null;
let userLocationMarker = null;
let userLocation = null;
let watchId = null;
let isLocationTracking = false;
let activeLines = [];
let selectedLines = new Set();
let vehicles = new Map();
let markers = new Map();
let trackedVehicleId = '';
let lastLiveUpdate = 0;
let hasFitSelection = false;
const selectedLineLoads = new Map();
const previousVehiclePositions = new Map();
const tripDetailsCache = new Map();
const tripDetailsInFlight = new Map();
let routePolyline = null;
let routeStopMarkers = [];
let journeyPolylines = [];
let journeyStopMarkers = [];
let plannedLineIds = new Set();
let highlightedTripId = '';
let locationControlButton = null;

const els = {
  controls: document.getElementById('controls'),
  togglePanel: document.getElementById('togglePanel'),
  originInput: document.getElementById('originInput'),
  destinationInput: document.getElementById('destinationInput'),
  useLocationForOrigin: document.getElementById('useLocationForOrigin'),
  planRoute: document.getElementById('planRoute'),
  clearJourney: document.getElementById('clearJourney'),
  lineSearch: document.getElementById('lineSearch'),
  lineList: document.getElementById('lineList'),
  clearLines: document.getElementById('clearLines'),
  vehicleSelect: document.getElementById('vehicleSelect'),
  status: document.getElementById('status'),
  journeySummary: document.getElementById('journeySummary'),
  routeInfo: document.getElementById('routeInfo'),
  locationNotice: document.getElementById('locationNotice'),
  legendContent: document.getElementById('legend-content')
};

initialize();

async function initialize() {
  updateStatus('Loading Google Maps...');
  try {
    await loadGoogleMaps();
  } catch (error) {
    console.error('Could not load Google Maps:', error);
    updateStatus(error.message || 'Could not load Google Maps.', true);
    return;
  }

  map = new google.maps.Map(document.getElementById('map'), {
    center: BERLIN_CENTER,
    zoom: 12,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.LEFT_BOTTOM
    },
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true
  });
  infoWindow = new google.maps.InfoWindow();
  directionsService = new google.maps.DirectionsService();

  wireControls();
  addLocationControl();
  updateStatus('Loading active lines...');
  await loadLines();
  startLiveStream();
  setInterval(pruneStaleVehicles, 4000);
  setInterval(updateConnectionStatus, 5000);
}

async function loadGoogleMaps() {
  if (window.google?.maps) {
    return;
  }

  const config = await fetchJson('/api/config/maps');
  const apiKey = String(config.googleMapsApiKey || '').trim();
  if (!apiKey) {
    throw new Error('Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY before starting the app.');
  }

  await new Promise((resolve, reject) => {
    const callbackName = `initGoogleMaps_${Date.now()}`;
    const script = document.createElement('script');

    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error('Could not load the Google Maps JavaScript API.'));
    };

    document.head.appendChild(script);
  });
}

function wireControls() {
  els.togglePanel.addEventListener('click', () => {
    const collapsed = els.controls.classList.toggle('collapsed');
    els.togglePanel.textContent = collapsed ? '+' : '-';
    els.togglePanel.title = collapsed ? 'Expand controls' : 'Collapse controls';
    els.togglePanel.setAttribute('aria-expanded', String(!collapsed));
  });

  els.planRoute.addEventListener('click', planJourney);
  els.clearJourney.addEventListener('click', () => {
    clearJourneyPlan();
    updateStatusForSelection();
  });
  els.useLocationForOrigin.addEventListener('click', () => {
    els.originInput.value = 'Current location';
    if (!userLocation) {
      startLocationTracking();
    }
  });

  els.lineSearch.addEventListener('input', renderLineList);
  els.clearLines.addEventListener('click', () => {
    selectedLines.clear();
    trackedVehicleId = '';
    hasFitSelection = false;
    clearRouteOverlay();
    renderEverything();
  });

  els.vehicleSelect.addEventListener('change', event => {
    trackedVehicleId = event.target.value;
    hasFitSelection = false;
    renderVisibleVehicles();
    refreshRouteOverlay();
    updateStatusForSelection();
  });
}

async function loadLines() {
  try {
    const lines = await fetchJson('/api/routes/lines');
    activeLines = lines.map(line => ({
      id: String(line.id),
      name: line.name || `${modeDisplayName(line.mode)} ${line.id}`,
      mode: line.mode || 'unknown',
      vehicleCount: Number(line.vehicleCount || 0)
    }));
    renderLineList();
    updateStatus('Select one or more lines to show live vehicles.');
  } catch (error) {
    console.error('Could not load active lines:', error);
    updateStatus('Could not load active lines. Retrying with live vehicle data...', true);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function startLiveStream() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/sim/stream/all');
  eventSource.onopen = () => updateStatusForSelection();
  eventSource.onerror = () => updateStatus('Live connection interrupted. Reconnecting...', true);
  eventSource.onmessage = event => {
    const vehicle = normalizeVehicle(JSON.parse(event.data));
    if (!vehicle) {
      return;
    }

    lastLiveUpdate = Date.now();
    upsertVehicle(vehicle);
    renderVisibleVehicles();
    updateStatusForSelection();
  };
}

function normalizeVehicle(raw) {
  const lat = Number(raw.lat ?? raw.latitude);
  const lon = Number(raw.lon ?? raw.longitude);
  const routeId = String(raw.routeId ?? raw.lineId ?? '');
  const id = String(raw.vehicleId ?? raw.id ?? '');

  if (!routeId || !id || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    id,
    routeId,
    tripId: raw.tripId || '',
    mode: raw.mode || 'unknown',
    lat,
    lon,
    destination: raw.destination || 'Unknown destination',
    timestamp: raw.timestamp,
    lastSeen: Date.now()
  };
}

function upsertVehicle(vehicle) {
  const previous = previousVehiclePositions.get(vehicle.id);
  if (previous) {
    const distance = calculateDistance(previous.lat, previous.lon, vehicle.lat, vehicle.lon);
    if (distance >= 3) {
      const heading = calculateBearing(previous.lat, previous.lon, vehicle.lat, vehicle.lon);
      vehicle.heading = Number.isFinite(heading) ? heading : previous.heading;
    } else {
      vehicle.heading = previous.heading;
    }
  } else {
    vehicle.heading = null;
  }

  previousVehiclePositions.set(vehicle.id, {
    lat: vehicle.lat,
    lon: vehicle.lon,
    heading: vehicle.heading
  });
  vehicles.set(vehicle.id, vehicle);
  ensureLineExistsWithMode(vehicle.routeId, vehicle.mode);
}

function ensureLineExists(lineId) {
  ensureLineExistsWithMode(lineId, 'unknown');
}

function ensureLineExistsWithMode(lineId, mode) {
  if (activeLines.some(line => line.id === lineId)) {
    const existingLine = activeLines.find(line => line.id === lineId);
    if (existingLine && (!existingLine.mode || existingLine.mode === 'unknown') && mode) {
      existingLine.mode = mode;
      existingLine.name = `${modeDisplayName(mode)} ${lineId}`;
    }
    return;
  }

  activeLines.push({
    id: lineId,
    name: `${modeDisplayName(mode)} ${lineId}`,
    mode: mode || 'unknown',
    vehicleCount: 0
  });
  activeLines.sort((a, b) => compareLineIds(a.id, b.id));
  renderLineList();
}

function renderLineList() {
  const query = els.lineSearch.value.trim().toLowerCase();
  const visibleLines = activeLines
    .filter(line => !query || line.id.toLowerCase().includes(query) || line.name.toLowerCase().includes(query))
    .sort((a, b) => compareLineIds(a.id, b.id));

  els.lineList.innerHTML = '';

  if (visibleLines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No matching active lines';
    els.lineList.appendChild(empty);
    return;
  }

  visibleLines.forEach(line => {
    const liveCount = countVehiclesForLine(line.id);
    const lineVehicles = liveCount || line.vehicleCount;
    const row = document.createElement('label');
    row.className = 'line-option';
    row.style.borderLeftColor = getLineColor(line.id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedLines.has(line.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedLines.add(line.id);
        loadVehiclesForLine(line.id);
      } else {
        selectedLines.delete(line.id);
        if (trackedVehicleId && vehicles.get(trackedVehicleId)?.routeId === line.id) {
          trackedVehicleId = '';
          clearRouteOverlay();
        }
      }
      hasFitSelection = false;
      renderEverything();
      refreshRouteOverlay();
    });

    const text = document.createElement('span');
    text.className = 'line-option-text';
    text.innerHTML = `
      <strong>${escapeHtml(line.id)}</strong>
      <small>${modeDisplayName(line.mode)} · ${lineVehicles} live</small>
    `;

    row.appendChild(checkbox);
    row.appendChild(text);
    els.lineList.appendChild(row);
  });
}

async function loadVehiclesForLine(lineId) {
  if (selectedLineLoads.has(lineId)) {
    return selectedLineLoads.get(lineId);
  }

  updateStatus(`Loading all live vehicles for line ${lineId}...`);

  const request = fetchJson(`/api/routes/vehicles/${encodeURIComponent(lineId)}`)
    .then(lineVehicles => {
      lineVehicles
        .map(normalizeVehicle)
        .filter(Boolean)
        .forEach(upsertVehicle);

      const activeLine = activeLines.find(line => line.id === lineId);
      if (activeLine) {
        activeLine.vehicleCount = lineVehicles.length;
      }

      if (selectedLines.has(lineId)) {
        renderEverything();
        refreshRouteOverlay();
      }
    })
    .catch(error => {
      console.error(`Could not load vehicles for line ${lineId}:`, error);
      if (selectedLines.has(lineId)) {
        updateStatus(`Could not load all vehicles for line ${lineId}. Waiting for live stream...`, true);
      }
    })
    .finally(() => {
      selectedLineLoads.delete(lineId);
    });

  selectedLineLoads.set(lineId, request);
  return request;
}

function renderEverything() {
  renderLineList();
  renderVisibleVehicles();
  updateVehicleSelect();
  updateLegend();
  updateStatusForSelection();
}

async function planJourney() {
  const origin = plannerOrigin();
  const destination = els.destinationInput.value.trim();

  if (!origin) {
    showLocationNotice('Enter a start point, or use your current location.', true);
    return;
  }
  if (!destination) {
    updateStatus('Enter a destination to plan a route.', true);
    return;
  }

  updateStatus('Planning the best transit route...');
  clearJourneyPlan({ keepInputs: true, keepSelections: false });

  try {
    const result = await directionsService.route({
      origin,
      destination,
      travelMode: google.maps.TravelMode.TRANSIT,
      region: 'de',
      provideRouteAlternatives: false
    });
    renderJourneyPlan(result);
  } catch (error) {
    console.error('Could not plan journey:', error);
    updateStatus('Could not find a transit route for that journey.', true);
  }
}

function plannerOrigin() {
  const originText = els.originInput.value.trim();
  if (originText && originText.toLowerCase() !== 'current location') {
    return originText;
  }

  return userLocation || null;
}

function renderJourneyPlan(result) {
  const route = result.routes?.[0];
  const leg = route?.legs?.[0];
  if (!route || !leg) {
    updateStatus('Could not find a route for that journey.', true);
    return;
  }

  clearJourneyPlan({ keepInputs: true, keepSelections: false });
  selectedLines.clear();
  trackedVehicleId = '';
  clearRouteOverlay();

  const bounds = new google.maps.LatLngBounds();
  const transitSteps = [];

  leg.steps.forEach((step, index) => {
    const path = (step.path || []).map(point => ({ lat: point.lat(), lng: point.lng() }));
    if (path.length < 2) {
      return;
    }

    path.forEach(point => bounds.extend(point));

    if (step.travel_mode === google.maps.TravelMode.TRANSIT && step.transit) {
      const line = step.transit.line || {};
      const lineId = line.short_name || line.name || '';
      const mode = googleTransitMode(line.vehicle?.type);
      const color = line.color || getLineColor(lineId || String(index));

      journeyPolylines.push(new google.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 0.95,
        strokeWeight: 8,
        zIndex: 650
      }));

      addJourneyStopMarker(step.transit.departure_stop, color, `${lineId} departure`);
      addJourneyStopMarker(step.transit.arrival_stop, color, `${lineId} arrival`);

      if (lineId) {
        selectedLines.add(lineId);
        plannedLineIds.add(lineId);
        ensureLineExistsWithMode(lineId, mode);
        loadVehiclesForLine(lineId);
      }

      transitSteps.push({
        lineId,
        mode,
        color,
        departure: step.transit.departure_stop?.name,
        arrival: step.transit.arrival_stop?.name,
        stops: step.transit.num_stops || 0,
        headsign: step.transit.headsign || ''
      });
    } else {
      journeyPolylines.push(new google.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: '#64748b',
        strokeOpacity: 0.72,
        strokeWeight: 4,
        zIndex: 500,
        icons: [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            scale: 3
          },
          offset: '0',
          repeat: '14px'
        }]
      }));
    }
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, 48);
  }

  renderJourneySummary(leg, transitSteps);
  renderEverything();
  updateStatus('Route planned. Live vehicles are highlighted for the required lines.');
}

function addJourneyStopMarker(stop, color, label) {
  const location = stop?.location;
  if (!location) {
    return;
  }

  const marker = new google.maps.Marker({
    map,
    position: { lat: location.lat(), lng: location.lng() },
    title: stop.name || label,
    zIndex: 850,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: '#ffffff',
      fillOpacity: 1,
      strokeColor: color,
      strokeWeight: 4,
      scale: 6
    }
  });
  marker.addListener('click', () => {
    infoWindow.setContent(`<strong>${escapeHtml(stop.name || label)}</strong>`);
    infoWindow.open({ anchor: marker, map });
  });
  journeyStopMarkers.push(marker);
}

function renderJourneySummary(leg, transitSteps) {
  const stepText = transitSteps.length
    ? transitSteps.map(step => {
      const stops = step.stops === 1 ? '1 stop' : `${step.stops} stops`;
      return `${escapeHtml(modeDisplayName(step.mode))} ${escapeHtml(step.lineId)} to ${escapeHtml(step.headsign || step.arrival || 'destination')} (${escapeHtml(stops)})`;
    }).join('<br>')
    : 'Walk to destination';

  els.journeySummary.innerHTML = `
    <strong>${escapeHtml(leg.duration?.text || 'Transit route')} · ${escapeHtml(leg.distance?.text || '')}</strong>
    ${stepText}<br>
    Click a live vehicle on a highlighted line to see its real remaining stops.
  `;
  els.journeySummary.classList.add('visible');
}

function clearJourneyPlan(options = {}) {
  journeyPolylines.forEach(polyline => polyline.setMap(null));
  journeyStopMarkers.forEach(marker => marker.setMap(null));
  journeyPolylines = [];
  journeyStopMarkers = [];

  if (!options.keepSelections) {
    plannedLineIds.forEach(lineId => selectedLines.delete(lineId));
    plannedLineIds = new Set();
  }

  if (!options.keepInputs) {
    els.originInput.value = '';
    els.destinationInput.value = '';
  }

  els.journeySummary.classList.remove('visible');
  els.journeySummary.innerHTML = '';
  renderEverything();
}

function googleTransitMode(type) {
  switch (String(type || '').toUpperCase()) {
    case 'BUS':
    case 'INTERCITY_BUS':
    case 'TROLLEYBUS':
      return 'bus';
    case 'SUBWAY':
      return 'subway';
    case 'COMMUTER_TRAIN':
      return 'suburban';
    case 'TRAM':
      return 'tram';
    case 'FERRY':
      return 'ferry';
    case 'RAIL':
    case 'TRAIN':
    case 'HEAVY_RAIL':
      return 'regional';
    case 'HIGH_SPEED_TRAIN':
      return 'express';
    default:
      return 'unknown';
  }
}

function renderVisibleVehicles() {
  const visibleVehicles = getVisibleVehicles();
  const visibleIds = new Set(visibleVehicles.map(vehicle => vehicle.id));

  markers.forEach((marker, vehicleId) => {
    if (!visibleIds.has(vehicleId)) {
      marker.setMap(null);
      markers.delete(vehicleId);
    }
  });

  visibleVehicles.forEach(vehicle => {
    const marker = markers.get(vehicle.id);
    const position = { lat: vehicle.lat, lng: vehicle.lon };

    if (marker) {
      marker.setPosition(position);
      applyVehicleMarkerStyle(marker, vehicle);
    } else {
      const nextMarker = new google.maps.Marker({
        map,
        position,
        title: `${vehicle.routeId} - ${vehicle.destination}`
      });
      applyVehicleMarkerStyle(nextMarker, vehicle);
      nextMarker.addListener('click', () => {
        focusVehicle(nextMarker.bvgVehicle.id);
        infoWindow.setContent(vehiclePopup(nextMarker.bvgVehicle));
        infoWindow.open({ anchor: nextMarker, map });
      });
      markers.set(vehicle.id, nextMarker);
    }
  });

  updateVehicleSelect();
  updateLegend();
  fitSelectionIfNeeded(visibleVehicles);
  refreshRouteOverlay();
}

function focusVehicle(vehicleId) {
  const vehicle = vehicles.get(vehicleId);
  if (!vehicle) {
    return;
  }

  trackedVehicleId = vehicleId;
  selectedLines.add(vehicle.routeId);
  hasFitSelection = true;
  renderLineList();
  renderVisibleVehicles();
  updateVehicleSelect();
  refreshRouteOverlay();
  updateStatusForSelection();
}

function getVisibleVehicles() {
  if (selectedLines.size === 0) {
    return [];
  }

  const visibleVehicles = Array.from(vehicles.values())
    .filter(vehicle => selectedLines.has(vehicle.routeId));

  if (trackedVehicleId) {
    return visibleVehicles.filter(vehicle => vehicle.id === trackedVehicleId);
  }

  return visibleVehicles.sort((a, b) =>
    compareLineIds(a.routeId, b.routeId) || a.id.localeCompare(b.id)
  );
}

function updateVehicleSelect() {
  const candidates = Array.from(vehicles.values())
    .filter(vehicle => selectedLines.has(vehicle.routeId))
    .sort((a, b) => compareLineIds(a.routeId, b.routeId) || a.id.localeCompare(b.id));

  const previousValue = trackedVehicleId;
  els.vehicleSelect.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = selectedLines.size === 0
    ? 'Select lines first'
    : `All vehicles on selected lines (${candidates.length})`;
  els.vehicleSelect.appendChild(allOption);

  candidates.forEach(vehicle => {
    const option = document.createElement('option');
    option.value = vehicle.id;
    option.textContent = `${modeDisplayName(vehicle.mode)} ${vehicle.routeId} - ${vehicle.id} - ${vehicle.destination}`;
    els.vehicleSelect.appendChild(option);
  });

  els.vehicleSelect.disabled = selectedLines.size === 0 || candidates.length === 0;
  if (previousValue && candidates.some(vehicle => vehicle.id === previousValue)) {
    els.vehicleSelect.value = previousValue;
  } else {
    trackedVehicleId = '';
  }
}

function updateLegend() {
  els.legendContent.innerHTML = '';

  if (selectedLines.size === 0) {
    appendLegendItem('#808080', 'Select lines to show vehicles');
    return;
  }

  Array.from(selectedLines)
    .sort(compareLineIds)
    .forEach(lineId => {
      appendLegendItem(getLineColor(lineId), `Line ${lineId}: ${countVehiclesForLine(lineId)} live`);
    });

  const nearestVehicle = findNearestVehicle();
  if (nearestVehicle) {
    appendLegendItem('#111827', `Nearest: ${shortVehicleId(nearestVehicle.vehicleId)} (${Math.round(nearestVehicle.distance)}m)`);
  }

  if (highlightedTripId && routeStopMarkers.length > 0) {
    appendLegendItem('#111827', `${routeStopMarkers.length} remaining ${routeStopMarkers.length === 1 ? 'stop' : 'stops'}`);
  }
}

function appendLegendItem(color, label) {
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `
    <div class="legend-color" style="background-color: ${color};"></div>
    <span>${escapeHtml(label)}</span>
  `;
  els.legendContent.appendChild(item);
}

function updateStatusForSelection() {
  if (selectedLines.size === 0) {
    updateStatus('Select one or more lines. Other vehicles stay hidden.');
    return;
  }

  const visibleCount = getVisibleVehicles().length;
  const lineText = selectedLines.size === 1 ? '1 line' : `${selectedLines.size} lines`;
  const vehicleText = visibleCount === 1 ? '1 vehicle' : `${visibleCount} vehicles`;
  if (trackedVehicleId) {
    updateStatus(`Tracking ${trackedVehicleId}. Updates every second.`);
  } else {
    updateStatus(`Showing ${vehicleText} across ${lineText}. Updates every second.`);
  }
}

function updateConnectionStatus() {
  if (!eventSource) {
    updateStatus('Connecting to live feed...', true);
    return;
  }

  if (lastLiveUpdate && Date.now() - lastLiveUpdate > STALE_AFTER_MS) {
    updateStatus('Waiting for fresh BVG data...', true);
  }
}

function pruneStaleVehicles() {
  const now = Date.now();
  let changed = false;

  vehicles.forEach((vehicle, id) => {
    if (now - vehicle.lastSeen > STALE_AFTER_MS) {
      vehicles.delete(id);
      changed = true;
    }
  });

  if (changed) {
    renderEverything();
  }
}

function fitSelectionIfNeeded(visibleVehicles) {
  if (hasFitSelection || visibleVehicles.length === 0) {
    return;
  }

  const points = visibleVehicles.map(vehicle => ({ lat: vehicle.lat, lng: vehicle.lon }));
  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(15);
  } else {
    const bounds = new google.maps.LatLngBounds();
    points.forEach(point => bounds.extend(point));
    map.fitBounds(bounds, 48);
    google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
      if (map.getZoom() > 15) {
        map.setZoom(15);
      }
    });
  }
  hasFitSelection = true;
}

async function refreshRouteOverlay() {
  const vehicle = getRouteOverlayVehicle();
  if (!vehicle || !vehicle.tripId) {
    clearRouteOverlay();
    return;
  }

  try {
    const trip = await loadTripDetails(vehicle);
    if (!vehicles.has(vehicle.id) || getRouteOverlayVehicle()?.id !== vehicle.id) {
      return;
    }
    drawRouteOverlay(vehicle, trip);
  } catch (error) {
    console.error(`Could not load trip ${vehicle.tripId}:`, error);
    clearRouteOverlay();
  }
}

function getRouteOverlayVehicle() {
  if (trackedVehicleId) {
    return vehicles.get(trackedVehicleId) || null;
  }

  return null;
}

async function loadTripDetails(vehicle) {
  const cacheKey = `${vehicle.tripId}|${vehicle.routeId}|${vehicle.destination}`;
  if (tripDetailsCache.has(cacheKey)) {
    return tripDetailsCache.get(cacheKey);
  }
  if (tripDetailsInFlight.has(cacheKey)) {
    return tripDetailsInFlight.get(cacheKey);
  }

  const params = new URLSearchParams({
    lineId: vehicle.routeId,
    direction: vehicle.destination
  });
  const request = fetchJson(`/api/routes/trips/${encodeURIComponent(vehicle.tripId)}?${params.toString()}`)
    .then(response => {
      const trip = unwrapTripPayload(response);
      tripDetailsCache.set(cacheKey, trip);
      return trip;
    })
    .finally(() => {
      tripDetailsInFlight.delete(cacheKey);
    });

  tripDetailsInFlight.set(cacheKey, request);
  return request;
}

function drawRouteOverlay(vehicle, trip) {
  applyTripHeading(vehicle, trip);

  const stops = extractStopovers(trip);
  if (stops.length === 0) {
    clearRouteOverlay();
    updateRouteInfo(vehicle, [], false, true);
    return;
  }

  const vehiclePoint = { lat: vehicle.lat, lng: vehicle.lon };
  const currentStopIndex = nearestPointIndex(stops, vehiclePoint);
  const targetStopIndex = userLocation
    ? nearestPointIndex(stops.slice(currentStopIndex).map(stop => stop), userLocation) + currentStopIndex
    : stops.length - 1;
  const safeTargetStopIndex = Math.max(currentStopIndex, Math.min(targetStopIndex, stops.length - 1));
  const remainingStops = stops.slice(currentStopIndex + 1, safeTargetStopIndex + 1);
  const color = getLineColor(vehicle.routeId);
  const path = routeSegmentPath(vehiclePoint, stops[safeTargetStopIndex], extractPolylinePoints(trip), stops);

  clearRouteOverlay();
  highlightedTripId = vehicle.tripId;
  updateRouteInfo(vehicle, remainingStops, Boolean(userLocation), false);
  updateStatusForSelection();

  if (path.length >= 2) {
    routePolyline = new google.maps.Polyline({
      map,
      path,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: 0.88,
      strokeWeight: 5,
      icons: [{
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3,
          strokeColor: color,
          strokeWeight: 2
        },
        offset: '100%',
        repeat: '96px'
      }]
    });
  }

  routeStopMarkers = remainingStops.map((stop, index) => {
    const isTarget = index === remainingStops.length - 1;
    const marker = new google.maps.Marker({
      map,
      position: { lat: stop.lat, lng: stop.lng },
      title: stop.name,
      zIndex: isTarget ? 900 : 800,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: isTarget ? '#111827' : '#ffffff',
        fillOpacity: 1,
        strokeColor: color,
        strokeWeight: isTarget ? 4 : 3,
        scale: isTarget ? 7 : 5
      }
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <strong>${escapeHtml(stop.name)}</strong><br>
        ${isTarget ? 'Nearest stop to your location' : 'Remaining stop'}
      `);
      infoWindow.open({ anchor: marker, map });
    });
    return marker;
  });
  updateLegend();
}

function applyTripHeading(vehicle, trip) {
  if (Number.isFinite(vehicle.heading)) {
    return;
  }

  const heading = estimateHeadingFromTrip(vehicle, trip);
  if (!Number.isFinite(heading)) {
    return;
  }

  vehicle.heading = heading;
  previousVehiclePositions.set(vehicle.id, {
    lat: vehicle.lat,
    lon: vehicle.lon,
    heading
  });

  const marker = markers.get(vehicle.id);
  if (marker) {
    applyVehicleMarkerStyle(marker, vehicle);
  }
}

function routeSegmentPath(vehiclePoint, targetStop, polylinePoints, stops) {
  if (!targetStop) {
    return [];
  }

  if (polylinePoints.length >= 2) {
    const startIndex = nearestPointIndex(polylinePoints, vehiclePoint);
    const endIndex = nearestPointIndex(polylinePoints, targetStop);
    if (endIndex >= startIndex) {
      return [vehiclePoint, ...polylinePoints.slice(startIndex, endIndex + 1), targetStop];
    }

    return [vehiclePoint, targetStop];
  }

  const currentStopIndex = nearestPointIndex(stops, vehiclePoint);
  const targetStopIndex = nearestPointIndex(stops, targetStop);
  return [
    vehiclePoint,
    ...stops.slice(currentStopIndex + 1, targetStopIndex + 1).map(stop => ({ lat: stop.lat, lng: stop.lng }))
  ];
}

function clearRouteOverlay() {
  highlightedTripId = '';
  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
  routeStopMarkers.forEach(marker => marker.setMap(null));
  routeStopMarkers = [];
  updateRouteInfo(null, [], false, false);
}

function updateRouteInfo(vehicle, remainingStops, isBoundedToLocation, isUnavailable) {
  if (!vehicle) {
    els.routeInfo.classList.remove('visible');
    els.routeInfo.innerHTML = '';
    return;
  }

  if (isUnavailable) {
    els.routeInfo.innerHTML = `
      <strong>${escapeHtml(modeDisplayName(vehicle.mode))} ${escapeHtml(vehicle.routeId)} to ${escapeHtml(vehicle.destination)}</strong>
      Trip stops are not available from BVG right now. Live vehicle position is still shown.
    `;
    els.routeInfo.classList.add('visible');
    return;
  }

  const stopText = remainingStops.length === 1 ? '1 stop' : `${remainingStops.length} stops`;
  const targetText = isBoundedToLocation ? 'to your nearest stop' : 'to the destination';
  const nextStop = remainingStops[0]?.name ? `Next: ${escapeHtml(remainingStops[0].name)}.` : '';
  els.routeInfo.innerHTML = `
    <strong>${escapeHtml(modeDisplayName(vehicle.mode))} ${escapeHtml(vehicle.routeId)} to ${escapeHtml(vehicle.destination)}</strong>
    ${stopText} remaining ${targetText}. ${nextStop}
  `;
  els.routeInfo.classList.add('visible');
}

function extractStopovers(trip) {
  const stopovers = Array.isArray(trip.stopovers) ? trip.stopovers : [];
  return stopovers
    .map(stopover => {
      const stop = stopover.stop || stopover.station || {};
      const location = stop.location || {};
      const lat = Number(location.latitude ?? location.lat ?? stop.latitude ?? stop.lat);
      const lng = Number(location.longitude ?? location.lng ?? location.lon ?? stop.longitude ?? stop.lng ?? stop.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return {
        name: stop.name || 'Unnamed stop',
        lat,
        lng
      };
    })
    .filter(Boolean);
}

function unwrapTripPayload(response) {
  if (!response || typeof response !== 'object') {
    return {};
  }

  if (response.trip && typeof response.trip === 'object') {
    return response.trip;
  }

  return response;
}

function extractPolylinePoints(trip) {
  const polyline = trip.polyline || trip.shape || null;
  if (!polyline) {
    return [];
  }

  if (Array.isArray(polyline)) {
    return polyline.map(normalizePolylinePoint).filter(Boolean);
  }

  if (Array.isArray(polyline.features)) {
    return polyline.features.flatMap(feature => extractGeometryPoints(feature.geometry));
  }

  if (polyline.geometry) {
    return extractGeometryPoints(polyline.geometry);
  }

  if (Array.isArray(polyline.coordinates)) {
    return polyline.coordinates.map(normalizePolylinePoint).filter(Boolean);
  }

  return [];
}

function extractGeometryPoints(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  if (geometry.type === 'LineString') {
    return geometry.coordinates.map(normalizePolylinePoint).filter(Boolean);
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.flatMap(line => line.map(normalizePolylinePoint).filter(Boolean));
  }

  return [];
}

function normalizePolylinePoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  if (point && typeof point === 'object') {
    const lat = Number(point.latitude ?? point.lat);
    const lng = Number(point.longitude ?? point.lng ?? point.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  return null;
}

function nearestPointIndex(points, target) {
  if (!points.length || !target) {
    return 0;
  }

  const targetLat = typeof target.lat === 'function' ? target.lat() : target.lat;
  const targetLng = typeof target.lng === 'function' ? target.lng() : target.lng;
  let nearestIndex = 0;
  let nearestDistance = Infinity;

  points.forEach((point, index) => {
    const distance = calculateDistance(targetLat, targetLng, point.lat, point.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function estimateHeadingFromTrip(vehicle, trip) {
  const vehiclePoint = { lat: vehicle.lat, lng: vehicle.lon };
  const polylinePoints = extractPolylinePoints(trip);

  if (polylinePoints.length >= 2) {
    const currentIndex = nearestPointIndex(polylinePoints, vehiclePoint);
    const nextPoint = polylinePoints[Math.min(currentIndex + 1, polylinePoints.length - 1)];
    if (nextPoint) {
      return calculateBearing(vehiclePoint.lat, vehiclePoint.lng, nextPoint.lat, nextPoint.lng);
    }
  }

  const stops = extractStopovers(trip);
  if (stops.length >= 2) {
    const currentStopIndex = nearestPointIndex(stops, vehiclePoint);
    const nextStop = stops[Math.min(currentStopIndex + 1, stops.length - 1)];
    if (nextStop) {
      return calculateBearing(vehiclePoint.lat, vehiclePoint.lng, nextStop.lat, nextStop.lng);
    }
  }

  return null;
}

function applyVehicleMarkerStyle(marker, vehicle) {
  const color = getLineColor(vehicle.routeId);
  const isTracked = trackedVehicleId === vehicle.id;
  const cachedTrip = getCachedTripForVehicle(vehicle);
  const estimatedHeading = cachedTrip ? estimateHeadingFromTrip(vehicle, cachedTrip) : null;
  const heading = Number.isFinite(vehicle.heading) ? vehicle.heading : estimatedHeading;
  const hasHeading = Number.isFinite(heading);

  marker.bvgVehicle = vehicle;
  marker.setTitle(`${vehicle.routeId} - ${vehicle.destination}`);
  marker.setIcon({
    path: hasHeading ? google.maps.SymbolPath.FORWARD_CLOSED_ARROW : google.maps.SymbolPath.CIRCLE,
    rotation: hasHeading ? heading : 0,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: isTracked ? '#111827' : '#ffffff',
    strokeWeight: isTracked ? 4 : 3,
    anchor: new google.maps.Point(0, 2),
    scale: hasHeading ? (isTracked ? 7.2 : 6.1) : (isTracked ? 8 : 6.5)
  });
  marker.setLabel({
    text: vehicle.routeId,
    color: '#ffffff',
    fontSize: '10px',
    fontWeight: '800'
  });
  marker.setZIndex(isTracked ? 1000 : 500);
}

function getCachedTripForVehicle(vehicle) {
  const cacheKey = `${vehicle.tripId}|${vehicle.routeId}|${vehicle.destination}`;
  return tripDetailsCache.get(cacheKey) || null;
}

function vehiclePopup(vehicle) {
  return `
    <strong>${escapeHtml(modeDisplayName(vehicle.mode))} ${escapeHtml(vehicle.routeId)} - ${escapeHtml(shortVehicleId(vehicle.id))}</strong><br>
    Vehicle: ${escapeHtml(vehicle.id)}<br>
    Destination: ${escapeHtml(vehicle.destination)}<br>
    Position: ${vehicle.lat.toFixed(5)}, ${vehicle.lon.toFixed(5)}
  `;
}

function countVehiclesForLine(lineId) {
  return Array.from(vehicles.values()).filter(vehicle => vehicle.routeId === lineId).length;
}

function getLineColor(lineId) {
  const index = Math.abs(hashString(lineId)) % LINE_COLORS.length;
  return LINE_COLORS[index];
}

function modeDisplayName(mode) {
  switch (mode) {
    case 'subway':
      return 'U-Bahn';
    case 'suburban':
      return 'S-Bahn';
    case 'tram':
      return 'Tram';
    case 'ferry':
      return 'Ferry';
    case 'regional':
      return 'Regional';
    case 'express':
      return 'Express';
    case 'bus':
      return 'Bus';
    default:
      return 'Line';
  }
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function shortVehicleId(vehicleId) {
  const parts = vehicleId.split('-');
  return parts.length > 1 ? parts.slice(-1)[0] : vehicleId;
}

function compareLineIds(left, right) {
  const leftCategory = lineCategory(left);
  const rightCategory = lineCategory(right);
  if (leftCategory !== rightCategory) {
    return leftCategory - rightCategory;
  }

  const leftNumber = lineNumber(left);
  const rightNumber = lineNumber(right);
  if (leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
}

function lineCategory(lineId) {
  const first = String(lineId || '').charAt(0).toUpperCase();
  if (/\d/.test(first)) return 0;
  if (first === 'M') return 1;
  if (first === 'X') return 2;
  if (first === 'N') return 3;
  return 4;
}

function lineNumber(lineId) {
  const digits = String(lineId || '').replace(/\D+/g, '');
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

function updateStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const radius = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const lambda1 = lon1 * Math.PI / 180;
  const lambda2 = lon2 * Math.PI / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function findNearestVehicle() {
  if (!userLocationMarker || markers.size === 0) {
    return null;
  }

  const userPos = userLocationMarker.getPosition();
  let nearestVehicle = null;
  let minDistance = Infinity;

  markers.forEach((marker, vehicleId) => {
    const vehiclePos = marker.getPosition();
    const distance = calculateDistance(userPos.lat(), userPos.lng(), vehiclePos.lat(), vehiclePos.lng());
    if (distance < minDistance) {
      minDistance = distance;
      nearestVehicle = { vehicleId, distance };
    }
  });

  return nearestVehicle;
}

function addLocationControl() {
  const locationControl = document.createElement('button');
  locationControl.id = 'location-control';
  locationControl.type = 'button';
  locationControl.textContent = 'Locate';
  locationControl.title = 'Toggle your location tracking';
  locationControlButton = locationControl;

  locationControl.addEventListener('click', () => {
    if (isLocationTracking) {
      stopLocationTracking();
    } else {
      startLocationTracking();
    }
  });

  document.body.appendChild(locationControl);
}

function startLocationTracking() {
  if (!('geolocation' in navigator)) {
    showLocationNotice('Your browser does not support location tracking.', true);
    return;
  }

  showLocationNotice('Requesting location access...', false);
  navigator.geolocation.getCurrentPosition(updateUserLocation, handleLocationError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 60000
  });

  watchId = navigator.geolocation.watchPosition(updateUserLocation, handleLocationError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 30000
  });
}

function stopLocationTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (userLocationMarker) {
    userLocationMarker.setMap(null);
    userLocationMarker = null;
  }
  userLocation = null;
  isLocationTracking = false;
  updateLocationControlState();
  showLocationNotice('', false);
  refreshRouteOverlay();
  updateLegend();
}

function updateUserLocation(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  userLocation = { lat, lng: lon };
  isLocationTracking = true;
  updateLocationControlState();
  showLocationNotice(`Location active. Accuracy about ${Math.round(accuracy)}m.`, false);
  const popup = `
    <strong>Your location</strong><br>
    Accuracy: ${Math.round(accuracy)}m<br>
    ${lat.toFixed(6)}, ${lon.toFixed(6)}
  `;

  if (userLocationMarker) {
    userLocationMarker.setPosition({ lat, lng: lon });
  } else {
    userLocationMarker = new google.maps.Marker({
      map,
      position: { lat, lng: lon },
      title: 'Your location',
      zIndex: 1000,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: '#111827',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
        scale: 8
      }
    });
    userLocationMarker.addListener('click', () => {
      infoWindow.setContent(userLocationMarker.locationPopup);
      infoWindow.open({ anchor: userLocationMarker, map });
    });
  }

  userLocationMarker.locationPopup = popup;
  refreshRouteOverlay();
  updateLegend();
}

function handleLocationError(error) {
  const messages = {
    1: 'Location access denied. Enable location permissions to highlight stops up to your nearest stop.',
    2: 'Location unavailable.',
    3: 'Location request timed out.'
  };
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  isLocationTracking = false;
  updateLocationControlState();
  userLocation = null;
  showLocationNotice(messages[error.code] || 'Could not read your location.', true);
  updateStatus(messages[error.code] || 'Could not read your location.', true);
  refreshRouteOverlay();
}

function updateLocationControlState() {
  if (!locationControlButton) {
    return;
  }

  locationControlButton.classList.toggle('active', isLocationTracking);
  locationControlButton.textContent = isLocationTracking ? 'Located' : 'Locate';
}

function showLocationNotice(message, isError) {
  els.locationNotice.textContent = message;
  els.locationNotice.classList.toggle('visible', Boolean(message));
  els.locationNotice.classList.toggle('error', isError);
}

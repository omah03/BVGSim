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
let eventSource = null;
let userLocationMarker = null;
let userLocation = null;
let watchId = null;
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
let routePolyline = null;
let routeStopMarkers = [];
let highlightedTripId = '';

const els = {
  controls: document.getElementById('controls'),
  togglePanel: document.getElementById('togglePanel'),
  lineSearch: document.getElementById('lineSearch'),
  lineList: document.getElementById('lineList'),
  clearLines: document.getElementById('clearLines'),
  vehicleSelect: document.getElementById('vehicleSelect'),
  status: document.getElementById('status'),
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
      name: line.name || `Bus Line ${line.id}`,
      vehicleCount: Number(line.vehicleCount || 0)
    }));
    renderLineList();
    updateStatus('Select one or more lines to show buses.');
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
    const heading = calculateBearing(previous.lat, previous.lon, vehicle.lat, vehicle.lon);
    vehicle.heading = Number.isFinite(heading) ? heading : previous.heading;
  } else {
    vehicle.heading = null;
  }

  previousVehiclePositions.set(vehicle.id, {
    lat: vehicle.lat,
    lon: vehicle.lon,
    heading: vehicle.heading
  });
  vehicles.set(vehicle.id, vehicle);
  ensureLineExists(vehicle.routeId);
}

function ensureLineExists(lineId) {
  if (activeLines.some(line => line.id === lineId)) {
    return;
  }

  activeLines.push({
    id: lineId,
    name: `Bus Line ${lineId}`,
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
      <small>${lineVehicles} live ${lineVehicles === 1 ? 'bus' : 'buses'}</small>
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

  updateStatus(`Loading all live buses for line ${lineId}...`);

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
        updateStatus(`Could not load all buses for line ${lineId}. Waiting for live stream...`, true);
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
    : `All buses on selected lines (${candidates.length})`;
  els.vehicleSelect.appendChild(allOption);

  candidates.forEach(vehicle => {
    const option = document.createElement('option');
    option.value = vehicle.id;
    option.textContent = `${vehicle.routeId} - ${vehicle.id} - ${vehicle.destination}`;
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
    appendLegendItem('#808080', 'Select lines to show buses');
    return;
  }

  Array.from(selectedLines)
    .sort(compareLineIds)
    .forEach(lineId => {
      appendLegendItem(getLineColor(lineId), `Line ${lineId}: ${countVehiclesForLine(lineId)} live`);
    });

  const nearestBus = findNearestBus();
  if (nearestBus) {
    appendLegendItem('#111827', `Nearest: ${shortVehicleId(nearestBus.vehicleId)} (${Math.round(nearestBus.distance)}m)`);
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
    updateStatus('Select one or more lines. Other buses stay hidden.');
    return;
  }

  const visibleCount = getVisibleVehicles().length;
  const lineText = selectedLines.size === 1 ? '1 line' : `${selectedLines.size} lines`;
  const busText = visibleCount === 1 ? '1 bus' : `${visibleCount} buses`;
  if (trackedVehicleId) {
    updateStatus(`Tracking ${trackedVehicleId}. Updates every second.`);
  } else {
    updateStatus(`Showing ${busText} across ${lineText}. Updates every second.`);
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
    const trip = await loadTripDetails(vehicle.tripId);
    if (!vehicles.has(vehicle.id)) {
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

  if (selectedLines.size !== 1) {
    return null;
  }

  const [lineId] = selectedLines;
  const candidates = Array.from(vehicles.values())
    .filter(vehicle => vehicle.routeId === lineId && vehicle.tripId)
    .sort((left, right) => {
      if (!userLocation) {
        return left.id.localeCompare(right.id);
      }

      const leftDistance = calculateDistance(userLocation.lat, userLocation.lng, left.lat, left.lon);
      const rightDistance = calculateDistance(userLocation.lat, userLocation.lng, right.lat, right.lon);
      return leftDistance - rightDistance;
    });

  return candidates[0] || null;
}

async function loadTripDetails(tripId) {
  if (tripDetailsCache.has(tripId)) {
    return tripDetailsCache.get(tripId);
  }

  const trip = await fetchJson(`/api/routes/trips/${encodeURIComponent(tripId)}`);
  tripDetailsCache.set(tripId, trip);
  return trip;
}

function drawRouteOverlay(vehicle, trip) {
  const stops = extractStopovers(trip);
  if (stops.length === 0) {
    clearRouteOverlay();
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

function routeSegmentPath(vehiclePoint, targetStop, polylinePoints, stops) {
  if (!targetStop) {
    return [];
  }

  if (polylinePoints.length >= 2) {
    const startIndex = nearestPointIndex(polylinePoints, vehiclePoint);
    const endIndex = nearestPointIndex(polylinePoints, targetStop);
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return [vehiclePoint, ...polylinePoints.slice(from, to + 1), targetStop];
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
}

function extractStopovers(trip) {
  const stopovers = Array.isArray(trip.stopovers) ? trip.stopovers : [];
  return stopovers
    .map(stopover => {
      const stop = stopover.stop || stopover.station || {};
      const location = stop.location || {};
      const lat = Number(location.latitude ?? location.lat);
      const lng = Number(location.longitude ?? location.lng);
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

function applyVehicleMarkerStyle(marker, vehicle) {
  const color = getLineColor(vehicle.routeId);
  const isTracked = trackedVehicleId === vehicle.id;
  const scale = isTracked ? 7.2 : 6.1;
  const heading = Number.isFinite(vehicle.heading) ? vehicle.heading : 0;

  marker.bvgVehicle = vehicle;
  marker.setTitle(`${vehicle.routeId} - ${vehicle.destination}`);
  marker.setIcon({
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    rotation: heading,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: isTracked ? '#111827' : '#ffffff',
    strokeWeight: isTracked ? 4 : 3,
    anchor: new google.maps.Point(0, 2),
    scale
  });
  marker.setLabel({
    text: vehicle.routeId,
    color: '#ffffff',
    fontSize: '10px',
    fontWeight: '800'
  });
  marker.setZIndex(isTracked ? 1000 : 500);
}

function vehiclePopup(vehicle) {
  return `
    <strong>${escapeHtml(vehicle.routeId)} - ${escapeHtml(shortVehicleId(vehicle.id))}</strong><br>
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

function findNearestBus() {
  if (!userLocationMarker || markers.size === 0) {
    return null;
  }

  const userPos = userLocationMarker.getPosition();
  let nearestBus = null;
  let minDistance = Infinity;

  markers.forEach((marker, vehicleId) => {
    const busPos = marker.getPosition();
    const distance = calculateDistance(userPos.lat(), userPos.lng(), busPos.lat(), busPos.lng());
    if (distance < minDistance) {
      minDistance = distance;
      nearestBus = { vehicleId, distance };
    }
  });

  return nearestBus;
}

function addLocationControl() {
  const locationControl = document.createElement('button');
  locationControl.id = 'location-control';
  locationControl.type = 'button';
  locationControl.textContent = 'Locate';
  locationControl.title = 'Toggle your location tracking';

  let isTracking = false;
  locationControl.addEventListener('click', () => {
    if (isTracking) {
      stopLocationTracking();
      locationControl.classList.remove('active');
      isTracking = false;
    } else {
      startLocationTracking();
      locationControl.classList.add('active');
      isTracking = true;
    }
  });

  document.body.appendChild(locationControl);
}

function startLocationTracking() {
  if (!('geolocation' in navigator)) {
    updateStatus('Geolocation is not supported by this browser.', true);
    return;
  }

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
  refreshRouteOverlay();
  updateLegend();
}

function updateUserLocation(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  userLocation = { lat, lng: lon };
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
    1: 'Location access denied.',
    2: 'Location unavailable.',
    3: 'Location request timed out.'
  };
  updateStatus(messages[error.code] || 'Could not read your location.', true);
}

const BERLIN_CENTER = [52.52, 13.405];
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

const map = L.map('map').setView(BERLIN_CENTER, 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let eventSource = null;
let userLocationMarker = null;
let watchId = null;
let activeLines = [];
let selectedLines = new Set();
let vehicles = new Map();
let markers = new Map();
let trackedVehicleId = '';
let lastLiveUpdate = 0;
let hasFitSelection = false;
const selectedLineLoads = new Map();

const els = {
  lineSearch: document.getElementById('lineSearch'),
  lineList: document.getElementById('lineList'),
  selectedSummary: document.getElementById('selectedSummary'),
  clearLines: document.getElementById('clearLines'),
  vehicleSelect: document.getElementById('vehicleSelect'),
  status: document.getElementById('status'),
  legendContent: document.getElementById('legend-content')
};

initialize();

async function initialize() {
  wireControls();
  addLocationControl();
  updateStatus('Loading active lines...');
  await loadLines();
  startLiveStream();
  setInterval(pruneStaleVehicles, 4000);
  setInterval(updateConnectionStatus, 5000);
}

function wireControls() {
  els.lineSearch.addEventListener('input', renderLineList);
  els.clearLines.addEventListener('click', () => {
    selectedLines.clear();
    trackedVehicleId = '';
    hasFitSelection = false;
    renderEverything();
  });

  els.vehicleSelect.addEventListener('change', event => {
    trackedVehicleId = event.target.value;
    hasFitSelection = false;
    renderVisibleVehicles();
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
    lat,
    lon,
    destination: raw.destination || 'Unknown destination',
    timestamp: raw.timestamp,
    lastSeen: Date.now()
  };
}

function upsertVehicle(vehicle) {
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
        }
      }
      hasFitSelection = false;
      renderEverything();
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
      map.removeLayer(marker);
      markers.delete(vehicleId);
    }
  });

  visibleVehicles.forEach(vehicle => {
    const marker = markers.get(vehicle.id);
    const latLng = [vehicle.lat, vehicle.lon];

    if (marker) {
      marker.setLatLng(latLng);
      marker.setIcon(createVehicleIcon(vehicle));
      marker.setPopupContent(vehiclePopup(vehicle));
    } else {
      markers.set(
        vehicle.id,
        L.marker(latLng, { icon: createVehicleIcon(vehicle) })
          .addTo(map)
          .bindPopup(vehiclePopup(vehicle))
      );
    }
  });

  updateVehicleSelect();
  updateLegend();
  fitSelectionIfNeeded(visibleVehicles);
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

  const points = visibleVehicles.map(vehicle => [vehicle.lat, vehicle.lon]);
  if (points.length === 1) {
    map.setView(points[0], 15);
  } else {
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
  }
  hasFitSelection = true;
}

function createVehicleIcon(vehicle) {
  const color = getLineColor(vehicle.routeId);
  const isTracked = trackedVehicleId === vehicle.id;
  const size = isTracked ? 34 : 28;

  return L.divIcon({
    className: 'vehicle-marker',
    html: `
      <div class="vehicle-dot${isTracked ? ' tracked' : ''}" style="--line-color: ${color}; width: ${size}px; height: ${size}px;">
        ${escapeHtml(vehicle.routeId)}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
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

function findNearestBus() {
  if (!userLocationMarker || markers.size === 0) {
    return null;
  }

  const userPos = userLocationMarker.getLatLng();
  let nearestBus = null;
  let minDistance = Infinity;

  markers.forEach((marker, vehicleId) => {
    const busPos = marker.getLatLng();
    const distance = calculateDistance(userPos.lat, userPos.lng, busPos.lat, busPos.lng);
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
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }
  updateLegend();
}

function updateUserLocation(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  const popup = `
    <strong>Your location</strong><br>
    Accuracy: ${Math.round(accuracy)}m<br>
    ${lat.toFixed(6)}, ${lon.toFixed(6)}
  `;

  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lon]);
    userLocationMarker.setPopupContent(popup);
  } else {
    userLocationMarker = L.marker([lat, lon], {
      zIndexOffset: 1000
    }).addTo(map).bindPopup(popup);
  }

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

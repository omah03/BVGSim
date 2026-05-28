const map = L.map('map').setView([52.52,13.405],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© OpenStreetMap contributors'
}).addTo(map);

const ALL_LINES_VALUE = 'all';
const ALL_STREAM_ID = 'all';

let userLocationMarker = null;
let watchId = null;
let lastUpdateTime = Date.now();

function updateStatus(message, isError = false) {
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? '#ff4444' : '#666';
  }
}

function checkConnectionStatus() {
  if (!selectedLineId) {
    updateStatus('Loading active buses...');
    return;
  }

  const selectionLabel = isAllLinesSelected() ? 'all active bus lines' : `line ${selectedLineId}`;
  const now = Date.now();
  if (now - lastUpdateTime > 15000) { // No updates for 15 seconds
    if (Object.keys(markers).length === 0) {
      updateStatus(`Waiting for live bus positions for ${selectionLabel}...`);
      return;
    }
    updateStatus('Connection issues - retrying...', true);
  } else {
    updateStatus(`Live tracking active for ${selectionLabel}.`);
  }
}

function updateUserLocation(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  
  console.log(`User location: ${lat}, ${lon} (accuracy: ${accuracy}m)`);
  
  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lon]);
    userLocationMarker.setPopupContent(`
      <strong>Your Location</strong><br>
      Lat: ${lat.toFixed(6)}<br>
      Lng: ${lon.toFixed(6)}<br>
      Accuracy: ±${Math.round(accuracy)}m
    `);
  } else {
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `<div style="
        background-color: #007BFF; 
        border: 3px solid #fff; 
        border-radius: 50%; 
        width: 16px; 
        height: 16px;
        box-shadow: 0 0 10px rgba(0,123,255,0.5);
        position: relative;
      ">
        <div style="
          position: absolute;
          top: -5px;
          left: -5px;
          width: 26px;
          height: 26px;
          border: 2px solid #007BFF;
          border-radius: 50%;
          opacity: 0.3;
          animation: pulse 2s infinite;
        "></div>
      </div>
      <style>
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.2); opacity: 0.1; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      </style>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    userLocationMarker = L.marker([lat, lon], { 
      icon: userIcon,
      zIndexOffset: 1000
    }).addTo(map);
    
    userLocationMarker.bindPopup(`
      <strong>Your Location</strong><br>
      Lat: ${lat.toFixed(6)}<br>
      Lng: ${lon.toFixed(6)}<br>
      Accuracy: ±${Math.round(accuracy)}m
    `);
    
    map.setView([lat, lon], 14);
  }
}

function handleLocationError(error) {
  let errorMessage = '';
  switch(error.code) {
    case error.PERMISSION_DENIED:
      errorMessage = "Location access denied by user.";
      break;
    case error.POSITION_UNAVAILABLE:
      errorMessage = "Location information is unavailable.";
      break;
    case error.TIMEOUT:
      errorMessage = "Location request timed out.";
      break;
    default:
      errorMessage = "An unknown error occurred while retrieving location.";
      break;
  }
  console.warn("Geolocation error: " + errorMessage);
  
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    background: rgba(255, 193, 7, 0.9);
    color: #333;
    padding: 10px;
    border-radius: 4px;
    z-index: 2000;
    font-size: 12px;
    max-width: 250px;
  `;
  notification.textContent = errorMessage;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5000);
}

function startLocationTracking() {
  if ("geolocation" in navigator) {
    console.log("Starting location tracking...");
    
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
    
    console.log("Location tracking started");
  } else {
    console.warn("Geolocation is not supported by this browser.");
    handleLocationError({ code: 4, message: "Geolocation not supported" });
  }
}

function stopLocationTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    console.log("Location tracking stopped");
  }
  
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }
}

function getColorForDestination(destination) {
  if (!destination || destination === 'Unknown destination') {
    return '#808080';
  }
  
  if (destinationColors[destination]) {
    return destinationColors[destination];
  }
  
  let hash = 0;
  for (let i = 0; i < destination.length; i++) {
    const char = destination.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  const colors = [
    '#FF6B35',
    '#2E86AB',
    '#A23B72',
    '#F18F01',
    '#C73E1D',
    '#5D737E',
    '#64A6BD',
    '#90A959',
    '#AC4142',
    '#6A4C93'
  ];
  
  const color = colors[Math.abs(hash) % colors.length];
  destinationColors[destination] = color;
  updateLegendWithDistance();
  return color;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function findNearestBus() {
  if (!userLocationMarker || Object.keys(markers).length === 0) {
    return null;
  }
  
  const userPos = userLocationMarker.getLatLng();
  let nearestBus = null;
  let minDistance = Infinity;
  
  Object.entries(markers).forEach(([vehicleId, marker]) => {
    const busPos = marker.getLatLng();
    const distance = calculateDistance(userPos.lat, userPos.lng, busPos.lat, busPos.lng);
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestBus = { vehicleId, distance, position: busPos };
    }
  });
  
  return nearestBus;
}

function updateLegendWithDistance() {
  const nearestBus = findNearestBus();
  const legendContent = document.getElementById('legend-content');
  if (!legendContent) return;
  
  legendContent.innerHTML = '';
  
  if (nearestBus) {
    const distanceItem = document.createElement('div');
    distanceItem.className = 'legend-item';
    distanceItem.style.borderBottom = '1px solid #ddd';
    distanceItem.style.paddingBottom = '8px';
    distanceItem.style.marginBottom = '8px';
    distanceItem.innerHTML = `
      <div class="legend-color" style="background-color: #007BFF;"></div>
      <span><strong>Nearest bus:</strong><br>${escapeHtml(nearestBus.vehicleId)}<br>${Math.round(nearestBus.distance)}m away</span>
    `;
    legendContent.appendChild(distanceItem);
  }
  
  Object.entries(destinationColors).forEach(([destination, color]) => {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-color" style="background-color: ${color};"></div>
      <span>${escapeHtml(destination)}</span>
    `;
    legendContent.appendChild(legendItem);
  });
  
  if (Object.keys(destinationColors).length === 0 && !nearestBus) {
    const emptyText = selectedLineId ? 'Waiting for live bus destinations...' : 'Loading active buses...';
    legendContent.innerHTML = `
      <div class="legend-item">
        <div class="legend-color" style="background-color: #808080;"></div>
        <span>${emptyText}</span>
      </div>
    `;
  }
}

let es, markers = {}, polylines = {}, routePaths = {}, routeStopMarkers = {}, vehicleTrips = {}, destinationColors = {};
let selectedLineId = ALL_LINES_VALUE;
let selectedVehicleId = '';
let hasFitCurrentSelection = false;

initializeSelectors();

async function initializeSelectors() {
  const lineSelect = document.getElementById('routeSelect');
  lineSelect.disabled = true;
  lineSelect.innerHTML = '<option value="">Loading active lines...</option>';
  clearVehicleSelect('Loading all active buses...', true);

  try {
    const lines = await fetchJson('/api/routes/lines');
    populateLineSelect(lines);
    if (lines.length) {
      loadAllVehicles();
    } else {
      updateStatus('No active bus lines found right now.', true);
    }
  } catch (err) {
    console.error('Error loading active lines:', err);
    try {
      const fallbackRoutes = await fetchJson('/api/routes');
      populateLineSelect(fallbackRoutes.map(route => ({
        id: route.id,
        name: route.name,
        vehicleCount: 0
      })));
      loadAllVehicles();
    } catch (fallbackErr) {
      console.error('Error loading fallback routes:', fallbackErr);
      populateLineSelect([]);
      updateStatus('Could not load bus lines. Please refresh in a moment.', true);
    }
  }

  addLocationControls();
  setInterval(checkConnectionStatus, 5000);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function populateLineSelect(lines) {
  const lineSelect = document.getElementById('routeSelect');
  lineSelect.disabled = lines.length === 0;
  lineSelect.innerHTML = '';

  const totalVehicles = lines.reduce((total, line) => total + Number(line.vehicleCount || 0), 0);
  const allOption = document.createElement('option');
  allOption.value = ALL_LINES_VALUE;
  allOption.textContent = totalVehicles > 0
    ? `All bus lines (${totalVehicles} active buses)`
    : 'All bus lines';
  lineSelect.appendChild(allOption);

  lines.forEach(line => {
    const option = document.createElement('option');
    option.value = line.id;
    option.textContent = formatLineLabel(line);
    lineSelect.appendChild(option);
  });

  lineSelect.value = selectedLineId;
  lineSelect.onchange = event => {
    selectedLineId = event.target.value;
    selectedVehicleId = '';

    if (isAllLinesSelected()) {
      loadAllVehicles();
    } else if (selectedLineId) {
      loadVehiclesForLine(selectedLineId);
    } else {
      resetSelection();
    }
  };
}

function formatLineLabel(line) {
  const vehicleCount = Number(line.vehicleCount || 0);
  const countLabel = vehicleCount === 1 ? '1 active bus' : `${vehicleCount} active buses`;
  return `${line.id} - ${line.name || `Bus Line ${line.id}`} (${countLabel})`;
}

function clearVehicleSelect(message, disabled) {
  const vehicleSelect = document.getElementById('vehicleSelect');
  if (!vehicleSelect) return;

  vehicleSelect.disabled = disabled;
  vehicleSelect.innerHTML = '';

  const option = document.createElement('option');
  option.value = '';
  option.textContent = message;
  vehicleSelect.appendChild(option);
}

function resetSelection() {
  selectedLineId = ALL_LINES_VALUE;
  selectedVehicleId = '';
  closeStream();
  clearVehicleMarkers();
  clearRouteOverlays();
  destinationColors = {};
  updateLegendWithDistance();
  clearVehicleSelect('Loading all active buses...', true);
  updateStatus('Loading all active buses...');
  loadAllVehicles();
}

function isAllLinesSelected() {
  return selectedLineId === ALL_LINES_VALUE;
}

function addLocationControls() {
  const locationControl = document.createElement('div');
  locationControl.id = 'location-control';
  locationControl.style.cssText = `
    position: absolute;
    top: 184px;
    left: 12px;
    background: white;
    border: 2px solid rgba(0,0,0,0.2);
    border-radius: 4px;
    padding: 8px;
    z-index: 1000;
    cursor: pointer;
    font-size: 18px;
    box-shadow: 0 1px 5px rgba(0,0,0,0.4);
  `;
  locationControl.innerHTML = '📍';
  locationControl.title = 'Toggle your location tracking';
  
  let isTracking = false;
  locationControl.onclick = () => {
    if (isTracking) {
      stopLocationTracking();
      locationControl.innerHTML = '📍';
      locationControl.style.backgroundColor = 'white';
      locationControl.style.color = '#333';
      isTracking = false;
    } else {
      startLocationTracking();
      locationControl.innerHTML = '📍';
      locationControl.style.backgroundColor = '#007BFF';
      locationControl.style.color = 'white';
      isTracking = true;
    }
  };
  
  document.body.appendChild(locationControl);

  const positionLocationControl = () => {
    const controls = document.getElementById('controls');
    if (controls) {
      locationControl.style.top = `${controls.offsetTop + controls.offsetHeight + 10}px`;
    }
  };
  positionLocationControl();
  window.addEventListener('resize', positionLocationControl);
}

async function loadVehiclesForLine(lineId) {
  console.log('Loading vehicles for line:', lineId);
  selectedVehicleId = '';
  hasFitCurrentSelection = false;
  clearVehicleSelect(`Loading buses on line ${lineId}...`, true);
  updateStatus(`Loading buses on line ${lineId}...`);

  try {
    const vehicles = await fetchJson(`/api/routes/vehicles/${encodeURIComponent(lineId)}`);
    if (selectedLineId !== lineId) {
      return;
    }

    populateVehicleSelect(lineId, vehicles);
    fitToVehicleLocations(vehicles);
    startStream(lineId);
  } catch (err) {
    console.error('Error loading vehicles for line', lineId, ':', err);
    if (selectedLineId !== lineId) {
      return;
    }

    clearVehicleSelect('Bus list unavailable', true);
    updateStatus('Could not load the bus list. Showing live line data.', true);
    startStream(lineId);
  }
}

async function loadAllVehicles() {
  console.log('Loading all active buses');
  selectedLineId = ALL_LINES_VALUE;
  selectedVehicleId = '';
  hasFitCurrentSelection = false;
  clearVehicleSelect('Loading all active buses...', true);
  updateStatus('Loading all active buses...');

  try {
    const vehicles = await fetchJson('/api/routes/vehicles');
    if (!isAllLinesSelected()) {
      return;
    }

    populateVehicleSelect(ALL_LINES_VALUE, vehicles);
    fitToVehicleLocations(vehicles);
    startStream(ALL_STREAM_ID);
  } catch (err) {
    console.error('Error loading all active buses:', err);
    if (!isAllLinesSelected()) {
      return;
    }

    clearVehicleSelect('Bus list unavailable', true);
    updateStatus('Could not load the bus list. Showing live all-bus data.', true);
    startStream(ALL_STREAM_ID);
  }
}

function populateVehicleSelect(lineId, vehicles) {
  const vehicleSelect = document.getElementById('vehicleSelect');
  if (!vehicleSelect) return;

  vehicleSelect.innerHTML = '';
  const allLinesMode = lineId === ALL_LINES_VALUE;

  const allOption = document.createElement('option');
  allOption.value = '';
  if (allLinesMode) {
    allOption.textContent = vehicles.length > 0 ? 'All active buses' : 'No active buses found right now';
  } else {
    allOption.textContent = vehicles.length > 0 ? `All buses on line ${lineId}` : `No active buses found on line ${lineId}`;
  }
  vehicleSelect.appendChild(allOption);

  vehicles.forEach(vehicle => {
    const option = document.createElement('option');
    option.value = vehicle.id;
    option.textContent = allLinesMode
      ? `${vehicle.id} - Line ${vehicle.lineId || '?'} - ${vehicle.destination || 'Unknown destination'}`
      : `${vehicle.id} - ${vehicle.destination || 'Unknown destination'}`;
    vehicleSelect.appendChild(option);
  });

  vehicleSelect.disabled = false;
  vehicleSelect.onchange = event => {
    selectedVehicleId = event.target.value;
    hasFitCurrentSelection = false;

    if (selectedVehicleId) {
      startSingleVehicleStream(allLinesMode ? ALL_STREAM_ID : lineId, selectedVehicleId);
    } else {
      startStream(allLinesMode ? ALL_STREAM_ID : lineId);
    }
  };
}

function closeStream() {
  if (es) {
    es.close();
    es = null;
  }
}

function clearVehicleMarkers() {
  Object.values(markers).forEach(marker => map.removeLayer(marker));
  markers = {};
}

function clearRouteOverlays() {
  Object.values(routePaths).forEach(path => map.removeLayer(path));
  routePaths = {};

  Object.values(routeStopMarkers).flat().forEach(stopMarker => map.removeLayer(stopMarker));
  routeStopMarkers = {};
}

function fitToVehicleLocations(vehicles) {
  const coordinates = vehicles
    .map(vehicle => [
      Number(vehicle.latitude ?? vehicle.lat),
      Number(vehicle.longitude ?? vehicle.lon)
    ])
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

  if (coordinates.length === 1) {
    map.setView(coordinates[0], 14);
    hasFitCurrentSelection = true;
  } else if (coordinates.length > 1) {
    map.fitBounds(L.latLngBounds(coordinates), { padding: [40, 40], maxZoom: 15 });
    hasFitCurrentSelection = true;
  }
}

function fitVisibleMarkersOnce(singleZoom = 14) {
  if (hasFitCurrentSelection) {
    return;
  }

  const markerPositions = Object.values(markers).map(marker => marker.getLatLng());
  if (markerPositions.length === 1) {
    map.setView(markerPositions[0], singleZoom);
    hasFitCurrentSelection = true;
  } else if (markerPositions.length > 1) {
    map.fitBounds(L.latLngBounds(markerPositions), { padding: [40, 40], maxZoom: 15 });
    hasFitCurrentSelection = true;
  }
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

async function fetchRoutePath(routeId) {
  try {
    console.log('Fetching route path for line', routeId);

    // Try to get stops data first
    const stopsResponse = await fetch(`https://v6.bvg.transport.rest/stops?query=${routeId}&results=50`);
    if (stopsResponse.ok) {
      const stopsData = await stopsResponse.json();
      console.log('Stops data for', routeId, stopsData);
      
      if (stopsData.stops && stopsData.stops.length > 0) {
        const lineStops = stopsData.stops.filter(stop => 
          stop.products && (stop.products.bus === true || stop.products.subway === true)
        );
        
        if (lineStops.length > 1) {
          if (selectedLineId !== routeId) return;
          const coords = lineStops.map(stop => [stop.location.latitude, stop.location.longitude]);
          drawRoutePath(routeId, coords, lineStops);
          return;
        }
      }
    }
    
    // If stops method doesn't work, try the lines endpoint
    try {
      const lineResponse = await fetch(`https://v6.bvg.transport.rest/lines/${routeId}`);
      if (lineResponse.ok) {
        const lineData = await lineResponse.json();
        console.log('Line data for', routeId, lineData);
        
        if (lineData && lineData.shape) {
          if (selectedLineId !== routeId) return;
          const coords = lineData.shape.map(point => [point.latitude, point.longitude]);
          drawRoutePath(routeId, coords, null);
          return;
        }
      }
    } catch (lineError) {
      console.log('Lines endpoint not available for', routeId);
    }
    
    console.log('No route path data available for', routeId, '- this is normal for some lines');
    
  } catch (error) {
    console.log('Error fetching route path:', error, '- continuing without route path');
  }
}

async function fetchVehicleDestination(tripId, vehicleId) {
  try {
    if (vehicleTrips[vehicleId]) {
      return vehicleTrips[vehicleId];
    }
    
    // Try to get trip details from BVG API
    const tripResponse = await fetch(`https://v6.bvg.transport.rest/trips/${tripId}`);
    if (tripResponse.ok) {
      const tripData = await tripResponse.json();
      console.log('Trip data for', vehicleId, tripData);
      
      if (tripData && tripData.trip && tripData.trip.stopovers) {
        const lastStop = tripData.trip.stopovers[tripData.trip.stopovers.length - 1];
        if (lastStop && lastStop.stop) {
          const destination = lastStop.stop.name;
          vehicleTrips[vehicleId] = destination; // Cache the destination
          return destination;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log('Error fetching vehicle destination:', error);
    return null;
  }
}

function drawRoutePath(routeId, coords, stops) {
  if (selectedLineId !== routeId) {
    return;
  }

  if (coords.length > 1) {
    routePaths[routeId] = L.polyline(coords, {
      color: '#FF6B35',
      weight: 4,
      opacity: 0.7,
      dashArray: '10, 5'
    }).addTo(map);
    
    const popupText = stops ? 
      `Bus ${escapeHtml(routeId)} Route (${stops.length} stops)` :
      `Bus ${escapeHtml(routeId)} Route Path`;
    routePaths[routeId].bindPopup(popupText);
    
    console.log('Drew route path for', routeId, 'with', coords.length, 'coordinates');
    
    // Also add stop markers if we have them
    if (stops) {
      routeStopMarkers[routeId] = [];
      stops.forEach((stop, index) => {
        const isTerminal = index === 0 || index === stops.length - 1;
        const stopMarker = L.circleMarker([stop.location.latitude, stop.location.longitude], {
          radius: isTerminal ? 6 : 4,
          fillColor: isTerminal ? '#FF0000' : '#FFFF00',
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map).bindPopup(`${escapeHtml(stop.name)}<br>Bus ${escapeHtml(routeId)} Stop`);
        routeStopMarkers[routeId].push(stopMarker);
      });
    }
  }
}

function highlight(id){
  Object.entries(polylines).forEach(([rid,line])=>{
    line.setStyle({weight:rid===id?6:2,opacity:rid===id?1:0.2});
  });
  Object.entries(routePaths).forEach(([rid,line])=>{
    line.setStyle({weight:rid===id?4:2,opacity:rid===id?0.8:0.3});
  });
}

function startStream(routeId){
  console.log('Starting stream for route:', routeId);
  const streamingAllLines = routeId === ALL_STREAM_ID;
  selectedLineId = streamingAllLines ? ALL_LINES_VALUE : routeId;
  selectedVehicleId = '';
  highlight(streamingAllLines ? '' : routeId);
  
  // Reset destination colors for new route
  destinationColors = {};
  updateLegendWithDistance();
  
  // Fetch and display the actual route path
  clearRouteOverlays();
  if (!streamingAllLines) {
    fetchRoutePath(routeId);
  }
  
  // Close existing SSE connection
  closeStream();
  
  // Clear all existing markers
  clearVehicleMarkers();

  // Create new SSE connection
  const streamUrl = `/api/sim/stream/${encodeURIComponent(routeId)}`;
  console.log('Opening SSE connection to:', streamUrl);
  es = new EventSource(streamUrl);
  
  es.onopen = function() {
    console.log('SSE connection opened for route:', routeId);
    updateStatus(streamingAllLines ? 'Connected. Showing all active buses.' : `Connected. Showing all buses on line ${routeId}.`);
    lastUpdateTime = Date.now();
  };
  
  es.onerror = function(error) {
    console.error('SSE connection error:', error);
    updateStatus('Connection error - retrying...', true);
  };
  
  es.onmessage = e=>{
    lastUpdateTime = Date.now(); // Track last update
    updateStatus(streamingAllLines ? 'Live tracking active for all bus lines.' : `Live tracking active for line ${routeId}.`);
    
    const loc = JSON.parse(e.data);
    const k = loc.vehicleId;
    const ll = [loc.lat,loc.lon];
    const destination = loc.destination || 'Unknown destination';
    const busColor = getColorForDestination(destination);
    const displayRouteId = loc.routeId || routeId;
    const safeVehicleId = escapeHtml(k);
    const safeRouteId = escapeHtml(displayRouteId);
    const safeDestination = escapeHtml(destination);
    
    console.log(`Received vehicle update: ${k} at ${ll[0]},${ll[1]} → ${destination}`);
    
    if(!markers[k]){
      // Create a custom bus icon with color based on destination
      const busIcon = L.divIcon({
        className: 'custom-bus-marker',
        html: `<div style="
          background-color: ${busColor}; 
          border: 2px solid #000; 
          border-radius: 50%; 
          width: 16px; 
          height: 16px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      markers[k] = L.marker(ll, { icon: busIcon }).addTo(map);
      
      // Set popup content with destination and color explanation
      markers[k].bindPopup(`
        <strong>${safeVehicleId}</strong><br>
        Route: ${safeRouteId}<br>
        Heading to: <strong style="color: ${busColor};">${safeDestination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Color represents destination direction</small>
      `);
    } else {
      markers[k].setLatLng(ll);
      
      // Update icon color if destination changed (unlikely but possible)
      const currentIcon = markers[k].getIcon();
      if (currentIcon && currentIcon.options.html && !currentIcon.options.html.includes(busColor)) {
        const newBusIcon = L.divIcon({
          className: 'custom-bus-marker',
          html: `<div style="
            background-color: ${busColor}; 
            border: 2px solid #000; 
            border-radius: 50%; 
            width: 16px; 
            height: 16px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        markers[k].setIcon(newBusIcon);
      }
      
      // Update popup with current position and destination
      markers[k].setPopupContent(`
        <strong>${safeVehicleId}</strong><br>
        Route: ${safeRouteId}<br>
        Heading to: <strong style="color: ${busColor};">${safeDestination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Color represents destination direction</small>
      `);
    }
    
    // Update distance information
    updateLegendWithDistance();
    fitVisibleMarkersOnce();
  };
}

// Function to track a single specific vehicle
function startSingleVehicleStream(routeId, vehicleId) {
  const streamingAllLines = routeId === ALL_STREAM_ID;
  selectedLineId = streamingAllLines ? ALL_LINES_VALUE : routeId;
  selectedVehicleId = vehicleId;
  hasFitCurrentSelection = false;
  highlight(streamingAllLines ? '' : routeId);
  
  // Reset destination colors for new route
  destinationColors = {};
  updateLegendWithDistance();
  
  // Fetch and display the actual route path
  clearRouteOverlays();
  if (!streamingAllLines) {
    fetchRoutePath(routeId);
  }
  
  closeStream();
  clearVehicleMarkers();

  es = new EventSource(`/api/sim/stream/${encodeURIComponent(routeId)}`);
  es.onopen = function() {
    updateStatus(streamingAllLines ? `Tracking ${vehicleId} across all bus lines.` : `Tracking ${vehicleId} on line ${routeId}.`);
    lastUpdateTime = Date.now();
  };

  es.onerror = function(error) {
    console.error('SSE connection error:', error);
    updateStatus('Connection error - retrying...', true);
  };

  es.onmessage = e=>{
    lastUpdateTime = Date.now(); // Track last update
    
    const loc = JSON.parse(e.data);
    const k = loc.vehicleId;
    
    // Only show the selected vehicle
    if (k !== vehicleId) {
      return;
    }
    
    const ll = [loc.lat,loc.lon];
    const destination = loc.destination || 'Unknown destination';
    const busColor = getColorForDestination(destination);
    const displayRouteId = loc.routeId || routeId;
    const safeVehicleId = escapeHtml(k);
    const safeRouteId = escapeHtml(displayRouteId);
    const safeDestination = escapeHtml(destination);
    updateStatus(streamingAllLines ? `Tracking ${vehicleId} on line ${displayRouteId}.` : `Tracking ${vehicleId} on line ${routeId}.`);
    
    if(!markers[k]){
      // Create a larger, more prominent icon for single vehicle tracking
      const busIcon = L.divIcon({
        className: 'custom-bus-marker',
        html: `<div style="
          background-color: ${busColor}; 
          border: 3px solid #000; 
          border-radius: 50%; 
          width: 20px; 
          height: 20px;
          box-shadow: 0 3px 6px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      markers[k] = L.marker(ll, { icon: busIcon }).addTo(map);
      
      // Set popup content with destination and color explanation
      markers[k].bindPopup(`
        <strong>${safeVehicleId}</strong> (TRACKING)<br>
        Route: ${safeRouteId}<br>
        Heading to: <strong style="color: ${busColor};">${safeDestination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Single vehicle tracking mode</small>
      `);
      
      // Center map on the tracked vehicle
      map.setView(ll, 15);
      hasFitCurrentSelection = true;
    } else {
      markers[k].setLatLng(ll);
      
      // Update popup with current position and destination
      markers[k].setPopupContent(`
        <strong>${safeVehicleId}</strong> (TRACKING)<br>
        Route: ${safeRouteId}<br>
        Heading to: <strong style="color: ${busColor};">${safeDestination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Single vehicle tracking mode</small>
      `);
      
      // Keep following the vehicle
      map.panTo(ll);
    }
    
    // Update distance information
    updateLegendWithDistance();
  };
}

const map = L.map('map').setView([52.52,13.405],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© OpenStreetMap contributors'
}).addTo(map);

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
  const now = Date.now();
  if (now - lastUpdateTime > 15000) { // No updates for 15 seconds
    updateStatus('⚠️ Connection issues - retrying...', true);
  } else {
    updateStatus('🟢 Live tracking active');
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
      <span><strong>Nearest bus:</strong><br>${nearestBus.vehicleId}<br>${Math.round(nearestBus.distance)}m away</span>
    `;
    legendContent.appendChild(distanceItem);
  }
  
  Object.entries(destinationColors).forEach(([destination, color]) => {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-color" style="background-color: ${color};"></div>
      <span>${destination}</span>
    `;
    legendContent.appendChild(legendItem);
  });
  
  if (Object.keys(destinationColors).length === 0 && !nearestBus) {
    legendContent.innerHTML = `
      <div class="legend-item">
        <div class="legend-color" style="background-color: #808080;"></div>
        <span>Loading destinations...</span>
      </div>
    `;
  }
}

let es, markers = {}, polylines = {}, routePaths = {}, vehicleTrips = {}, destinationColors = {};

fetch('/api/routes/top-lines').then(r=>r.json()).then(lines=>{
  console.log('Loaded top active lines:', lines);
  const sel = document.getElementById('routeSelect');
  sel.innerHTML = '<option value="">Select a line...</option>';
  
  lines.forEach((line,i)=>{
    const o = document.createElement('option');
    o.value = line.id; 
    o.textContent = `${line.id} — ${line.name} (${line.vehicleCount} vehicles)`;
    sel.appendChild(o);
  });
  
  sel.onchange = e => {
    if (e.target.value) {
      loadVehiclesForLine(e.target.value);
    }
  };
  
  // Automatically select the most active line (first in the list)
  if (lines.length > 0) {
    console.log('Auto-selecting most active line:', lines[0].id);
    sel.value = lines[0].id;
    loadVehiclesForLine(lines[0].id);
  }
  
  addLocationControls();
  
  // Check connection status every 5 seconds
  setInterval(checkConnectionStatus, 5000);
  updateStatus('🔄 Connecting...');
}).catch(err => {
  console.error('Error loading lines:', err);
  fetch('/api/routes').then(r=>r.json()).then(routes=>{
    console.log('Fallback to routes:', routes);
    const sel = document.getElementById('routeSelect');
    routes.forEach((route,i)=>{
      const o = document.createElement('option');
      o.value = route.id; 
      o.textContent = route.id + '—' + route.name;
      sel.appendChild(o);
      if(i===0) startStream(route.id);
    });
    sel.onchange = e=>startStream(e.target.value);
    addLocationControls();
  });
});

function addLocationControls() {
  const locationControl = document.createElement('div');
  locationControl.id = 'location-control';
  locationControl.style.cssText = `
    position: absolute;
    top: 60px;
    left: 10px;
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
}

function loadVehiclesForLine(lineId) {
  console.log('Loading vehicles for line:', lineId);
  
  // Clear any existing vehicle dropdown more reliably
  const existingVehicleDiv = document.querySelector('#controls > div:last-child');
  if (existingVehicleDiv && (existingVehicleDiv.innerHTML.includes('Select vehicle') || existingVehicleDiv.querySelector('#vehicleSelect'))) {
    console.log('Removing existing vehicle dropdown');
    existingVehicleDiv.remove();
  }
  
  fetch(`/api/routes/vehicles/${lineId}`).then(r=>r.json()).then(vehicles=>{
    console.log('Found vehicles for line', lineId, ':', vehicles);
    
    // Double-check that any existing vehicle dropdown is removed
    const existingSelect = document.getElementById('vehicleSelect');
    if (existingSelect) {
      console.log('Removing existing vehicleSelect element');
      existingSelect.closest('div').remove();
    }
    
    const controls = document.getElementById('controls');
    const vehicleDiv = document.createElement('div');
    vehicleDiv.style.marginTop = '10px';
    vehicleDiv.innerHTML = `
      <label for="vehicleSelect">Select vehicle on ${lineId}:</label>
      <select id="vehicleSelect">
        <option value="">All vehicles on line ${lineId}</option>
      </select>
    `;
    controls.appendChild(vehicleDiv);
    
    const vSelect = document.getElementById('vehicleSelect');
    console.log('Adding', vehicles.length, 'vehicles to dropdown');
    
    vehicles.forEach(vehicle => {
      const o = document.createElement('option');
      o.value = vehicle.id;
      o.textContent = `${vehicle.id} → ${vehicle.destination || 'Unknown destination'}`;
      vSelect.appendChild(o);
      console.log('Added vehicle option:', vehicle.id, '→', vehicle.destination);
    });
    
    vSelect.onchange = e => {
      console.log('Vehicle selection changed to:', e.target.value);
      if (e.target.value) {
        startSingleVehicleStream(lineId, e.target.value);
      } else {
        startStream(lineId);
      }
    };
    
    // Start streaming all vehicles for this line
    startStream(lineId);
  }).catch(err => {
    console.error('Error loading vehicles for line', lineId, ':', err);
    updateStatus('⚠️ Error loading vehicles - using live data', true);
    // Still start streaming even if vehicle list fails
    startStream(lineId);
  });
}

async function fetchRoutePath(routeId) {
  try {
    console.log('Fetching route path for line', routeId);
    
    if (routePaths[routeId]) {
      map.removeLayer(routePaths[routeId]);
      delete routePaths[routeId];
    }
    
    const stopsResponse = await fetch(`https://v6.bvg.transport.rest/stops?query=${routeId}&results=50`);
    if (stopsResponse.ok) {
      const stopsData = await stopsResponse.json();
      console.log('Stops data for', routeId, stopsData);
      
      if (stopsData.stops && stopsData.stops.length > 0) {
        const lineStops = stopsData.stops.filter(stop => 
          stop.products && stop.products.bus === true
        );
        
        if (lineStops.length > 1) {
          const coords = lineStops.map(stop => [stop.location.latitude, stop.location.longitude]);
          drawRoutePath(routeId, coords, lineStops);
          return;
        }
      }
    }
    
    const lineResponse = await fetch(`https://v6.bvg.transport.rest/lines/${routeId}`);
    if (lineResponse.ok) {
      const lineData = await lineResponse.json();
      console.log('Line data for', routeId, lineData);
      
      if (lineData && lineData.shape) {
        const coords = lineData.shape.map(point => [point.latitude, point.longitude]);
        drawRoutePath(routeId, coords, null);
        return;
      }
    }
    
    console.log('Could not fetch route path for', routeId);
    
  } catch (error) {
    console.log('Error fetching route path:', error);
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
  if (coords.length > 1) {
    routePaths[routeId] = L.polyline(coords, {
      color: '#FF6B35',
      weight: 4,
      opacity: 0.7,
      dashArray: '10, 5'
    }).addTo(map);
    
    const popupText = stops ? 
      `Bus ${routeId} Route (${stops.length} stops)` : 
      `Bus ${routeId} Route Path`;
    routePaths[routeId].bindPopup(popupText);
    
    console.log('Drew route path for', routeId, 'with', coords.length, 'coordinates');
    
    // Also add stop markers if we have them
    if (stops) {
      stops.forEach((stop, index) => {
        const isTerminal = index === 0 || index === stops.length - 1;
        L.circleMarker([stop.location.latitude, stop.location.longitude], {
          radius: isTerminal ? 6 : 4,
          fillColor: isTerminal ? '#FF0000' : '#FFFF00',
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map).bindPopup(`${stop.name}<br>Bus ${routeId} Stop`);
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
  highlight(routeId);
  
  // Reset destination colors for new route
  destinationColors = {};
  updateLegendWithDistance();
  
  // Fetch and display the actual route path
  fetchRoutePath(routeId);
  
  // Close existing SSE connection
  if(es) {
    console.log('Closing existing SSE connection');
    es.close();
  }
  
  // Clear all existing markers
  Object.values(markers).forEach(m=>map.removeLayer(m));
  markers={};

  // Create new SSE connection
  const streamUrl = `/api/sim/stream/${routeId}`;
  console.log('Opening SSE connection to:', streamUrl);
  es = new EventSource(streamUrl);
  
  es.onopen = function() {
    console.log('SSE connection opened for route:', routeId);
    updateStatus('🟢 Connected to live data');
    lastUpdateTime = Date.now();
  };
  
  es.onerror = function(error) {
    console.error('SSE connection error:', error);
    updateStatus('❌ Connection error - retrying...', true);
  };
  
  es.onmessage = e=>{
    lastUpdateTime = Date.now(); // Track last update
    updateStatus('🟢 Live tracking active');
    
    const loc = JSON.parse(e.data);
    const k = loc.vehicleId;
    const ll = [loc.lat,loc.lon];
    const destination = loc.destination || 'Unknown destination';
    const busColor = getColorForDestination(destination);
    
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
        <strong>${k}</strong><br>
        Route: ${routeId}<br>
        Heading to: <strong style="color: ${busColor};">${destination}</strong><br>
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
        <strong>${k}</strong><br>
        Route: ${routeId}<br>
        Heading to: <strong style="color: ${busColor};">${destination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Color represents destination direction</small>
      `);
    }
    
    // Update distance information
    updateLegendWithDistance();
  };
}

// Function to track a single specific vehicle
function startSingleVehicleStream(routeId, vehicleId) {
  highlight(routeId);
  
  // Reset destination colors for new route
  destinationColors = {};
  updateLegendWithDistance();
  
  // Fetch and display the actual route path
  fetchRoutePath(routeId);
  
  if(es) es.close();
  Object.values(markers).forEach(m=>map.removeLayer(m));
  markers={};

  es = new EventSource(`/api/sim/stream/${routeId}`);
  es.onmessage = e=>{
    lastUpdateTime = Date.now(); // Track last update
    updateStatus('🟢 Live tracking active');
    
    const loc = JSON.parse(e.data);
    const k = loc.vehicleId;
    
    // Only show the selected vehicle
    if (k !== vehicleId) {
      return;
    }
    
    const ll = [loc.lat,loc.lon];
    const destination = loc.destination || 'Unknown destination';
    const busColor = getColorForDestination(destination);
    
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
        <strong>${k}</strong> (TRACKING)<br>
        Route: ${routeId}<br>
        Heading to: <strong style="color: ${busColor};">${destination}</strong><br>
        Position: ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}<br>
        <small>Single vehicle tracking mode</small>
      `);
      
      // Center map on the tracked vehicle
      map.setView(ll, 15);
    } else {
      markers[k].setLatLng(ll);
      
      // Update popup with current position and destination
      markers[k].setPopupContent(`
        <strong>${k}</strong> (TRACKING)<br>
        Route: ${routeId}<br>
        Heading to: <strong style="color: ${busColor};">${destination}</strong><br>
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

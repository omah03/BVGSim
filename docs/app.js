const map = L.map('map').setView([52.52,13.405],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© OpenStreetMap contributors'
}).addTo(map);

let userLocationMarker = null;
let watchId = null;
let markers = {};
let destinationColors = {};

// Demo data for GitHub Pages
const demoRoutes = [
    { id: "M41", name: "M41 Hauptbahnhof ↔ Sonnenallee", vehicleCount: 8 },
    { id: "100", name: "100 Alexanderplatz ↔ Bahnhof Zoo", vehicleCount: 6 },
    { id: "200", name: "200 Prenzlauer Berg ↔ Michelangelstr", vehicleCount: 4 },
    { id: "M29", name: "M29 Hermannplatz ↔ Grunewald", vehicleCount: 5 }
];

const demoVehicles = {
    "M41": [
        { id: "M41-001", lat: 52.5200, lon: 13.4050, destination: "Hauptbahnhof" },
        { id: "M41-002", lat: 52.5180, lon: 13.4100, destination: "Sonnenallee" },
        { id: "M41-003", lat: 52.5220, lon: 13.4000, destination: "Hauptbahnhof" }
    ],
    "100": [
        { id: "100-001", lat: 52.5219, lon: 13.4132, destination: "Bahnhof Zoo" },
        { id: "100-002", lat: 52.5170, lon: 13.3950, destination: "Alexanderplatz" }
    ],
    "200": [
        { id: "200-001", lat: 52.5400, lon: 13.4200, destination: "Michelangelstr" },
        { id: "200-002", lat: 52.5300, lon: 13.4300, destination: "Prenzlauer Berg" }
    ],
    "M29": [
        { id: "M29-001", lat: 52.4900, lon: 13.4200, destination: "Grunewald" },
        { id: "M29-002", lat: 52.5000, lon: 13.4100, destination: "Hermannplatz" }
    ]
};

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
  updateLegend();
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

function updateLegend() {
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
        <span>Demo mode - simulated data</span>
      </div>
    `;
  }
}

function loadDemoRoutes() {
  console.log('Loading demo routes...');
  const sel = document.getElementById('routeSelect');
  sel.innerHTML = '<option value="">Select a line...</option>';
  
  demoRoutes.forEach((route) => {
    const o = document.createElement('option');
    o.value = route.id; 
    o.textContent = `${route.id} — ${route.name} (${route.vehicleCount} vehicles)`;
    sel.appendChild(o);
  });
  
  sel.onchange = e => {
    if (e.target.value) {
      loadDemoVehicles(e.target.value);
    }
  };
  
  addLocationControls();
}

function loadDemoVehicles(routeId) {
  const vehicles = demoVehicles[routeId] || [];
  const vehicleSelect = document.getElementById('vehicleSelect');
  const vehicleContainer = document.getElementById('vehicleSelectContainer');
  
  if (vehicles.length > 0) {
    vehicleContainer.style.display = 'block';
    vehicleSelect.innerHTML = `<option value="">All vehicles on line ${routeId}</option>`;
    
    vehicles.forEach(vehicle => {
      const o = document.createElement('option');
      o.value = vehicle.id;
      o.textContent = `${vehicle.id} → ${vehicle.destination}`;
      vehicleSelect.appendChild(o);
    });
    
    vehicleSelect.onchange = e => {
      if (e.target.value) {
        showSingleVehicle(routeId, e.target.value);
      } else {
        showAllVehicles(routeId);
      }
    };
  } else {
    vehicleContainer.style.display = 'none';
  }
  
  showAllVehicles(routeId);
}

function showAllVehicles(routeId) {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  destinationColors = {};
  
  const vehicles = demoVehicles[routeId] || [];
  
  vehicles.forEach(vehicle => {
    const busColor = getColorForDestination(vehicle.destination);
    
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

    markers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon: busIcon }).addTo(map);
    
    markers[vehicle.id].bindPopup(`
      <strong>${vehicle.id}</strong><br>
      Route: ${routeId}<br>
      Heading to: <strong style="color: ${busColor};">${vehicle.destination}</strong><br>
      Position: ${vehicle.lat.toFixed(5)}, ${vehicle.lon.toFixed(5)}<br>
      <small>Demo data - color represents destination</small>
    `);
  });
  
  updateLegend();
  
  if (vehicles.length > 0) {
    const bounds = L.latLngBounds(vehicles.map(v => [v.lat, v.lon]));
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

function showSingleVehicle(routeId, vehicleId) {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  destinationColors = {};
  
  const vehicles = demoVehicles[routeId] || [];
  const vehicle = vehicles.find(v => v.id === vehicleId);
  
  if (vehicle) {
    const busColor = getColorForDestination(vehicle.destination);
    
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

    markers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon: busIcon }).addTo(map);
    
    markers[vehicle.id].bindPopup(`
      <strong>${vehicle.id}</strong> (TRACKING)<br>
      Route: ${routeId}<br>
      Heading to: <strong style="color: ${busColor};">${vehicle.destination}</strong><br>
      Position: ${vehicle.lat.toFixed(5)}, ${vehicle.lon.toFixed(5)}<br>
      <small>Demo data - single vehicle tracking</small>
    `);
    
    map.setView([vehicle.lat, vehicle.lon], 15);
    updateLegend();
  }
}

function addLocationControls() {
  const locationControl = document.createElement('div');
  locationControl.id = 'location-control';
  locationControl.style.cssText = `
    position: absolute;
    top: 80px;
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

// Initialize demo
loadDemoRoutes();

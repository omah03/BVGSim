package com.omar.bvgsim.service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.omar.bvgsim.model.VehicleLocation;

import jakarta.annotation.PostConstruct;

@Service
@EnableScheduling
public class SimulationService {
    @Autowired
    private RouteLoader loader;
    
    private final RestTemplate restTemplate = new RestTemplate();
    private final Map<String, List<SseEmitter>> emitters = new ConcurrentHashMap<>();
    private final Map<String, String> tripIdToCleanId = new ConcurrentHashMap<>();
    private int vehicleCounter = 1;

    @PostConstruct
    public void init() {
        // Initialize with some common lines, but updateAvailableLines will add the real active ones
        String[] commonLines = {"255", "100", "200", "M41", "U1", "U2"};
        for (String lineId : commonLines) {
            emitters.put(lineId, new CopyOnWriteArrayList<>());
        }
        
        // Update with real active lines immediately
        updateAvailableLines();
    }

    public SseEmitter subscribe(String routeId) {
        SseEmitter emitter = new SseEmitter(0L);
        
        // Ensure emitter list exists for this route
        emitters.computeIfAbsent(routeId, k -> new CopyOnWriteArrayList<>()).add(emitter);
        
        emitter.onCompletion(() -> {
            List<SseEmitter> routeEmitters = emitters.get(routeId);
            if (routeEmitters != null) {
                routeEmitters.remove(emitter);
            }
        });
        
        emitter.onTimeout(() -> {
            List<SseEmitter> routeEmitters = emitters.get(routeId);
            if (routeEmitters != null) {
                routeEmitters.remove(emitter);
            }
        });
        
        return emitter;
    }

        @Scheduled(fixedRate = 30000)
    public void updateAvailableLines() {
        try {
            String radarUrl = "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=100&frames=1";
            System.out.println("Checking for most active lines from BVG radar API...");
            
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
            
            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                
                if (movements != null && !movements.isEmpty()) {
                    // Count vehicles by line - ONLY include those that actually appear in radar data
                    Map<String, Long> lineCounts = movements.stream()
                        .filter(movement -> movement.get("line") != null)
                        .map(movement -> {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> line = (Map<String, Object>) movement.get("line");
                            if (line == null) return null;
                            
                            String lineName = (String) line.get("name");
                            String lineMode = (String) line.get("mode");
                            
                            // Only include lines that actually appear in radar data (bus and U-Bahn)
                            // Exclude S-Bahn lines as they don't appear consistently in radar
                            if (lineName != null && lineMode != null && 
                                ("bus".equals(lineMode) || ("train".equals(lineMode) && lineName.startsWith("U")))) {
                                return lineName;
                            }
                            return null;
                        })
                        .filter(lineName -> lineName != null) // Remove all null values
                        .collect(java.util.stream.Collectors.groupingBy(
                            lineName -> lineName,
                            java.util.stream.Collectors.counting()
                        ));
                    
                    if (!lineCounts.isEmpty()) {
                        String mostActiveLine = lineCounts.entrySet().stream()
                            .max(Map.Entry.comparingByValue())
                            .map(Map.Entry::getKey)
                            .orElse("255");
                        
                        long vehicleCount = lineCounts.get(mostActiveLine);
                        
                        System.out.println("=== MOST ACTIVE LINE IN RADAR DATA ===");
                        System.out.println(mostActiveLine + ": " + vehicleCount + " vehicles");
                        System.out.println("=====================================");
                        
                        if (!emitters.containsKey(mostActiveLine)) {
                            emitters.put(mostActiveLine, new CopyOnWriteArrayList<>());
                        }
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Error updating available lines: " + e.getMessage());
        }
    }

    @Scheduled(fixedRate = 3000)
    public void fetchRealDataAndBroadcast() {
        emitters.forEach((routeId, subs) -> {
            if (subs == null || subs.isEmpty()) return;
            
            try {
                String radarUrl = "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=50&frames=1";
                
                @SuppressWarnings("unchecked")
                Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
                
                if (radarResponse != null && radarResponse.containsKey("movements")) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                    
                    if (movements != null && !movements.isEmpty()) {
                        System.out.println("Processing vehicles for route: " + routeId);
                        
                        // Count matching vehicles for this specific route
                        long matchingVehicles = movements.stream()
                            .filter(movement -> {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                if (line != null) {
                                    String lineName = (String) line.get("name");
                                    String lineMode = (String) line.get("mode");
                                    // Only process bus lines and U-Bahn trains, check exact match
                                    return ("bus".equals(lineMode) || ("train".equals(lineMode) && lineName.startsWith("U"))) 
                                           && routeId.equals(lineName);
                                }
                                return false;
                            }).count();
                        
                        System.out.println("Found " + matchingVehicles + " real vehicles for route " + routeId);
                        
                        if (matchingVehicles > 0) {
                            // Process real vehicles for this route
                            movements.stream()
                                .filter(movement -> {
                                    @SuppressWarnings("unchecked")
                                    Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                    if (line != null) {
                                        String lineName = (String) line.get("name");
                                        String lineMode = (String) line.get("mode");
                                        return ("bus".equals(lineMode) || ("train".equals(lineMode) && lineName.startsWith("U"))) 
                                               && routeId.equals(lineName);
                                    }
                                    return false;
                                })
                                .forEach(movement -> {
                                    try {
                                        @SuppressWarnings("unchecked")
                                        Map<String, Object> location = (Map<String, Object>) movement.get("location");
                                        
                                        if (location != null) {
                                            Object latObj = location.get("latitude");
                                            Object lonObj = location.get("longitude");
                                            
                                            if (latObj instanceof Number && lonObj instanceof Number) {
                                                Double lat = ((Number) latObj).doubleValue();
                                                Double lon = ((Number) lonObj).doubleValue();
                                                
                                                String originalTripId = (String) movement.get("tripId");
                                                String direction = (String) movement.get("direction");
                                                
                                                String destination = direction;
                                                if (destination == null || destination.trim().isEmpty()) {
                                                    destination = "Unknown destination";
                                                }
                                                
                                                String vehicleId;
                                                if (originalTripId != null) {
                                                    vehicleId = tripIdToCleanId.get(originalTripId);
                                                    if (vehicleId == null) {
                                                        vehicleId = "Bus " + routeId + "-" + vehicleCounter++;
                                                        tripIdToCleanId.put(originalTripId, vehicleId);
                                                    }
                                                } else {
                                                    vehicleId = "Bus " + routeId + "-" + vehicleCounter++;
                                                }
                                                
                                                VehicleLocation loc = new VehicleLocation(
                                                    routeId, vehicleId, lat, lon, Instant.now(), destination
                                                );
                                                
                                                System.out.println("Broadcasting real vehicle: " + vehicleId + " at " + lat + "," + lon + " to " + destination);
                                                
                                                subs.forEach(emitter -> {
                                                    try {
                                                        emitter.send(loc);
                                                    } catch (Exception e) {
                                                        System.err.println("Failed to send to emitter: " + e.getMessage());
                                                        subs.remove(emitter);
                                                    }
                                                });
                                            }
                                        }
                                    } catch (Exception e) {
                                        System.err.println("Error processing movement data: " + e.getMessage());
                                    }
                                });
                        } else {
                            // No real vehicles found for this route, use simulation
                            System.out.println("No real vehicles found for route " + routeId + ", using simulation");
                            simulateVehiclesForRoute(routeId, subs);
                        }
                    } else {
                        // No movements data, use simulation
                        simulateVehiclesForRoute(routeId, subs);
                    }
                } else {
                    // Invalid response, use simulation
                    simulateVehiclesForRoute(routeId, subs);
                }
            } catch (RestClientException e) {
                System.err.println("Error fetching radar data: " + e.getMessage());
                
                // If it's a 503 or temporary error, don't fall back to simulation immediately
                if (e.getMessage().contains("503") || e.getMessage().contains("Service Unavailable")) {
                    System.out.println("BVG API temporarily unavailable (503), retrying in next cycle...");
                    return; // Skip this cycle, try again in 3 seconds
                }
                
                // For other errors, fall back to simulation
                simulateVehiclesForRoute(routeId, subs);
            }
        });
    }
    
    private void simulateVehiclesForRoute(String routeId, List<SseEmitter> subs) {
        try {
            // Find the route from loader
            var route = loader.getAll().stream()
                .filter(r -> r.getId().equals(routeId))
                .findFirst();
                
            if (route.isPresent() && !route.get().getWaypoints().isEmpty()) {
                var waypoints = route.get().getWaypoints();
                
                // Create 1-2 simulated vehicles moving along the route
                for (int i = 0; i < 2; i++) {
                    int waypointIndex = (int) (Math.random() * waypoints.size());
                    var waypoint = waypoints.get(waypointIndex);
                    
                    // Add some random offset to make it more realistic
                    double latOffset = (Math.random() - 0.5) * 0.002; // ~200m variance
                    double lonOffset = (Math.random() - 0.5) * 0.002;
                    
                    VehicleLocation loc = new VehicleLocation(
                        routeId, 
                        routeId + "-sim-" + i, 
                        waypoint.lat() + latOffset, 
                        waypoint.lon() + lonOffset, 
                        Instant.now(),
                        "Simulated destination"
                    );                    System.out.println("Simulating vehicle: " + loc.vehicleId() + " at " + loc.lat() + "," + loc.lon());
                    
                    subs.forEach(emitter -> {
                        try {
                            emitter.send(loc);
                        } catch (Exception e) {
                            subs.remove(emitter);
                        }
                    });
                }
            }
        } catch (Exception e) {
            System.err.println("Error in simulation fallback: " + e.getMessage());
        }
    }
}

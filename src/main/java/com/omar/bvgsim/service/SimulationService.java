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
            System.out.println("Checking for most active lines from BVG API...");
            
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
            
            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                
                if (movements != null && !movements.isEmpty()) {
                    // Count vehicles by line and mode
                    Map<String, Long> lineCounts = movements.stream()
                        .filter(movement -> movement.get("line") != null)
                        .collect(java.util.stream.Collectors.groupingBy(
                            movement -> {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                String lineName = (String) line.get("name");
                                String lineMode = (String) line.get("mode");
                                if ("bus".equals(lineMode) || "train".equals(lineMode)) {
                                    return lineName;
                                }
                                return null;
                            },
                            java.util.stream.Collectors.counting()
                        ));
                    
                    lineCounts.remove(null);
                    
                    if (!lineCounts.isEmpty()) {
                        String mostActiveLine = lineCounts.entrySet().stream()
                            .max(Map.Entry.comparingByValue())
                            .map(Map.Entry::getKey)
                            .orElse("255");
                        
                        long vehicleCount = lineCounts.get(mostActiveLine);
                        
                        System.out.println("=== MOST ACTIVE LINE ===");
                        System.out.println(mostActiveLine + ": " + vehicleCount + " vehicles");
                        System.out.println("========================");
                        
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
                System.out.println("Fetching radar data from BVG API...");
                
                @SuppressWarnings("unchecked")
                Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
                
                if (radarResponse != null && radarResponse.containsKey("movements")) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                    
                    if (movements != null && !movements.isEmpty()) {
                        System.out.println("Found " + movements.size() + " vehicles in radar data");
                        
                        // Count vehicles by line and mode
                        Map<String, Long> lineCounts = movements.stream()
                            .filter(movement -> movement.get("line") != null)
                            .collect(java.util.stream.Collectors.groupingBy(
                                movement -> {
                                    @SuppressWarnings("unchecked")
                                    Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                    String lineName = (String) line.get("name");
                                    String lineMode = (String) line.get("mode");
                                    return lineName + " (" + lineMode + ")";
                                },
                                java.util.stream.Collectors.counting()
                            ));
                        
                        System.out.println("=== AVAILABLE LINES AND VEHICLE COUNTS ===");
                        lineCounts.entrySet().stream()
                            .sorted((e1, e2) -> Long.compare(e2.getValue(), e1.getValue())) // Sort by count descending
                            .forEach(entry -> {
                                System.out.println(entry.getKey() + ": " + entry.getValue() + " vehicles");
                            });
                        System.out.println("==========================================");
                        
                        long matchingVehicles = movements.stream()
                            .filter(movement -> {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                if (line != null) {
                                    String lineName = (String) line.get("name");
                                    String lineMode = (String) line.get("mode");
                                    return ("bus".equals(lineMode) || "train".equals(lineMode)) && routeId.equals(lineName);
                                }
                                return false;
                            }).count();
                        
                        System.out.println("Found " + matchingVehicles + " vehicles for route " + routeId);
                        
                        // If no vehicles found for the requested route, switch to most active line
                        final String effectiveRouteId;
                        if (matchingVehicles == 0) {
                            String mostActiveLine = lineCounts.entrySet().stream()
                                .filter(entry -> entry.getKey().contains("(bus)") || entry.getKey().contains("(train)"))
                                .max(Map.Entry.comparingByValue())
                                .map(entry -> entry.getKey().split(" \\(")[0]) // Extract line name without mode
                                .orElse("255");
                            
                            System.out.println("No vehicles for " + routeId + ", switching to most active line: " + mostActiveLine);
                            effectiveRouteId = mostActiveLine;
                        } else {
                            effectiveRouteId = routeId;
                        }
                        
                        movements.stream()
                            .filter(movement -> {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                if (line != null) {
                                    String lineName = (String) line.get("name");
                                    String lineMode = (String) line.get("mode");
                                    // Use effective route ID (either original or most active)
                                    boolean isMatch = ("bus".equals(lineMode) || "train".equals(lineMode)) && effectiveRouteId.equals(lineName);
                                    if (isMatch) {
                                        System.out.println("Found matching vehicle for line: " + lineName + " (mode: " + lineMode + ")");
                                    }
                                    return isMatch;
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
                                            
                                            System.out.println("Processing vehicle ID: " + vehicleId + " (original: " + originalTripId + ") at " + lat + "," + lon + " heading to: " + destination);
                                            
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
                        
                        // If no vehicles found for this specific route, fall back to simulation
                        long vehicleCount = movements.stream()
                            .filter(movement -> {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> line = (Map<String, Object>) movement.get("line");
                                if (line != null) {
                                    String lineName = (String) line.get("name");
                                    String lineMode = (String) line.get("mode");
                                    return ("bus".equals(lineMode) || "train".equals(lineMode)) && routeId.equals(lineName);
                                }
                                return false;
                            }).count();
                            
                        if (vehicleCount == 0) {
                            System.out.println("No real vehicles found for route " + routeId + " in radar data, falling back to simulation");
                            simulateVehiclesForRoute(routeId, subs);
                        }
                    } else {
                        System.out.println("No movements in radar data, falling back to simulation");
                        simulateVehiclesForRoute(routeId, subs);
                    }
                } else {
                    System.out.println("Invalid radar response format, falling back to simulation");
                    simulateVehiclesForRoute(routeId, subs);
                }
            } catch (RestClientException e) {
                System.err.println("Error fetching radar data: " + e.getMessage());
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

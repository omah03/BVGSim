package com.omar.bvgsim.service;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

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
    private static final String ALL_ROUTES_ID = "all";
    private static final String RADAR_URL =
        "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=256&frames=1";

    @Autowired
    private RouteLoader loader;
    
    private final RestTemplate restTemplate = new RestTemplate();
    private final Map<String, List<SseEmitter>> emitters = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        // Initialize with some common lines, but updateAvailableLines will add the real active ones
        String[] commonLines = {"100", "200", "255", "M29", "M41", "M45", "M48", "M49", "X10"};
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
            System.out.println("Checking for active bus lines from BVG radar API...");
            
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(RADAR_URL, Map.class);
            
            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                
                if (movements != null && !movements.isEmpty()) {
                    // Count vehicles by line - only include buses that appear in radar data.
                    Map<String, Long> lineCounts = movements.stream()
                        .map(this::extractBusLineName)
                        .filter(lineName -> lineName != null) // Remove all null values
                        .collect(java.util.stream.Collectors.groupingBy(
                            lineName -> lineName,
                            java.util.stream.Collectors.counting()
                        ));
                    
                    if (!lineCounts.isEmpty()) {
                        lineCounts.keySet().forEach(lineId ->
                            emitters.computeIfAbsent(lineId, key -> new CopyOnWriteArrayList<>())
                        );

                        System.out.println("Active bus lines available: " + lineCounts.size());
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
                @SuppressWarnings("unchecked")
                Map<String, Object> radarResponse = restTemplate.getForObject(RADAR_URL, Map.class);
                
                if (radarResponse != null && radarResponse.containsKey("movements")) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                    
                    if (movements != null && !movements.isEmpty()) {
                        boolean streamingAllRoutes = ALL_ROUTES_ID.equals(routeId);
                        String routeLabel = streamingAllRoutes ? "all active bus lines" : "route: " + routeId;
                        System.out.println("Processing vehicles for " + routeLabel);
                        
                        // Count matching vehicles for this specific route
                        long matchingVehicles = movements.stream()
                            .filter(movement -> shouldStreamMovement(routeId, movement))
                            .count();
                        
                        System.out.println("Found " + matchingVehicles + " real vehicles for " + routeLabel);
                        
                        if (matchingVehicles > 0) {
                            // Process real vehicles for this route
                            Map<String, AtomicInteger> vehicleSequences = new HashMap<>();
                            movements.stream()
                                .filter(movement -> shouldStreamMovement(routeId, movement))
                                .forEach(movement -> {
                                    try {
                                        @SuppressWarnings("unchecked")
                                        Map<String, Object> location = (Map<String, Object>) movement.get("location");
                                        String lineId = extractBusLineName(movement);
                                        
                                        if (location != null && lineId != null) {
                                            Object latObj = location.get("latitude");
                                            Object lonObj = location.get("longitude");
                                            
                                            if (latObj instanceof Number && lonObj instanceof Number) {
                                                Double lat = ((Number) latObj).doubleValue();
                                                Double lon = ((Number) lonObj).doubleValue();
                                                
                                                String originalTripId = movement.get("tripId") instanceof String
                                                    ? (String) movement.get("tripId")
                                                    : null;
                                                String direction = movement.get("direction") instanceof String
                                                    ? (String) movement.get("direction")
                                                    : null;
                                                
                                                String destination = direction;
                                                if (destination == null || destination.trim().isEmpty()) {
                                                    destination = "Unknown destination";
                                                }
                                                
                                                int sequenceNumber = vehicleSequences
                                                    .computeIfAbsent(lineId, key -> new AtomicInteger(1))
                                                    .getAndIncrement();
                                                String vehicleId = VehicleIdFormatter.format(lineId, originalTripId, sequenceNumber);
                                                
                                                VehicleLocation loc = new VehicleLocation(
                                                    lineId, vehicleId, lat, lon, Instant.now(), destination
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
                            if (!streamingAllRoutes) {
                                simulateVehiclesForRoute(routeId, subs);
                            }
                        }
                    } else {
                        // No movements data, use simulation
                        if (!ALL_ROUTES_ID.equals(routeId)) {
                            simulateVehiclesForRoute(routeId, subs);
                        }
                    }
                } else {
                    // Invalid response, use simulation
                    if (!ALL_ROUTES_ID.equals(routeId)) {
                        simulateVehiclesForRoute(routeId, subs);
                    }
                }
            } catch (RestClientException e) {
                System.err.println("Error fetching radar data: " + e.getMessage());
                
                // If it's a 503 or temporary error, don't fall back to simulation immediately
                String message = e.getMessage();
                if (message != null && (message.contains("503") || message.contains("Service Unavailable"))) {
                    System.out.println("BVG API temporarily unavailable (503), retrying in next cycle...");
                    return; // Skip this cycle, try again in 3 seconds
                }
                
                // For other errors, fall back to simulation
                if (!ALL_ROUTES_ID.equals(routeId)) {
                    simulateVehiclesForRoute(routeId, subs);
                }
            }
        });
    }

    @SuppressWarnings("unchecked")
    private String extractBusLineName(Map<String, Object> movement) {
        Object lineValue = movement.get("line");
        if (!(lineValue instanceof Map)) {
            return null;
        }

        Map<String, Object> line = (Map<String, Object>) lineValue;
        Object lineName = line.get("name");
        Object lineMode = line.get("mode");

        if (lineName instanceof String && "bus".equals(lineMode)) {
            return (String) lineName;
        }

        return null;
    }

    private boolean shouldStreamMovement(String routeId, Map<String, Object> movement) {
        String lineName = extractBusLineName(movement);
        return lineName != null && (ALL_ROUTES_ID.equals(routeId) || routeId.equals(lineName));
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
                    );
                    System.out.println("Simulating vehicle: " + loc.vehicleId() + " at " + loc.lat() + "," + loc.lon());
                    
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

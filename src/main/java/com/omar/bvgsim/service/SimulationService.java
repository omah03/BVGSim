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

    @Scheduled(fixedRate = 1000)
    public void fetchRealDataAndBroadcast() {
        boolean hasSubscribers = emitters.values().stream()
            .anyMatch(subs -> subs != null && !subs.isEmpty());
        if (!hasSubscribers) {
            return;
        }

        List<VehicleLocation> locations;
        try {
            locations = fetchLiveVehicleLocations();
        } catch (RestClientException e) {
            System.err.println("Error fetching radar data: " + e.getMessage());
            return;
        }

        emitters.forEach((routeId, subs) -> {
            if (subs == null || subs.isEmpty()) {
                return;
            }

            List<VehicleLocation> matchingLocations = locations.stream()
                .filter(location -> ALL_ROUTES_ID.equals(routeId) || routeId.equals(location.routeId()))
                .toList();

            matchingLocations.forEach(location -> subs.forEach(emitter -> {
                try {
                    emitter.send(location);
                } catch (Exception e) {
                    System.err.println("Failed to send to emitter: " + e.getMessage());
                    subs.remove(emitter);
                }
            }));

            if (matchingLocations.isEmpty() && !ALL_ROUTES_ID.equals(routeId)) {
                simulateVehiclesForRoute(routeId, subs);
            }
        });
    }

    private List<VehicleLocation> fetchLiveVehicleLocations() {
        @SuppressWarnings("unchecked")
        Map<String, Object> radarResponse = restTemplate.getForObject(RADAR_URL, Map.class);

        if (radarResponse == null || !radarResponse.containsKey("movements")) {
            return List.of();
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
        if (movements == null || movements.isEmpty()) {
            return List.of();
        }

        Map<String, AtomicInteger> vehicleSequences = new HashMap<>();
        return movements.stream()
            .map(movement -> toVehicleLocation(movement, vehicleSequences))
            .filter(location -> location != null)
            .toList();
    }

    @SuppressWarnings("unchecked")
    private VehicleLocation toVehicleLocation(
        Map<String, Object> movement,
        Map<String, AtomicInteger> vehicleSequences
    ) {
        Object locationValue = movement.get("location");
        if (!(locationValue instanceof Map)) {
            return null;
        }

        String lineId = extractBusLineName(movement);
        if (lineId == null) {
            return null;
        }

        Map<String, Object> location = (Map<String, Object>) locationValue;
        Object latObj = location.get("latitude");
        Object lonObj = location.get("longitude");
        if (!(latObj instanceof Number) || !(lonObj instanceof Number)) {
            return null;
        }

        String originalTripId = movement.get("tripId") instanceof String
            ? (String) movement.get("tripId")
            : null;
        String destination = movement.get("direction") instanceof String
            ? (String) movement.get("direction")
            : "Unknown destination";
        if (destination == null || destination.trim().isEmpty()) {
            destination = "Unknown destination";
        }

        int sequenceNumber = vehicleSequences
            .computeIfAbsent(lineId, key -> new AtomicInteger(1))
            .getAndIncrement();
        String vehicleId = VehicleIdFormatter.format(lineId, originalTripId, sequenceNumber);

        return new VehicleLocation(
            lineId,
            vehicleId,
            ((Number) latObj).doubleValue(),
            ((Number) lonObj).doubleValue(),
            Instant.now(),
            destination
        );
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

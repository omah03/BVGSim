package com.omar.bvgsim.service;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.omar.bvgsim.model.VehicleLocation;

import jakarta.annotation.PostConstruct;

@Service
@EnableScheduling
public class SimulationService {
    private static final String ALL_ROUTES_ID = "all";
    private static final Set<String> SUPPORTED_MODES = Set.of(
        "bus",
        "subway",
        "suburban",
        "tram",
        "ferry",
        "regional",
        "express"
    );

    @Autowired
    private RouteLoader loader;

    @Autowired
    private BvgRadarClient radarClient;

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
        return subscribe(Set.of(routeId));
    }

    public SseEmitter subscribe(Set<String> routeIds) {
        SseEmitter emitter = new SseEmitter(0L);

        Set<String> normalizedRouteIds = routeIds.stream()
            .filter(Objects::nonNull)
            .map(String::trim)
            .filter(routeId -> !routeId.isBlank())
            .collect(java.util.stream.Collectors.toSet());

        if (normalizedRouteIds.isEmpty()) {
            emitter.complete();
            return emitter;
        }

        normalizedRouteIds.forEach(routeId ->
            emitters.computeIfAbsent(routeId, k -> new CopyOnWriteArrayList<>()).add(emitter)
        );

        Runnable cleanup = () -> removeEmitter(emitter, normalizedRouteIds);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(error -> cleanup.run());

        return emitter;
    }

    private void removeEmitter(SseEmitter emitter, Set<String> routeIds) {
        routeIds.forEach(routeId -> {
            List<SseEmitter> routeEmitters = emitters.get(routeId);
            if (routeEmitters != null) {
                routeEmitters.remove(emitter);
            }
        });
    }

    @Scheduled(fixedRate = 30000)
    public void updateAvailableLines() {
        try {
            System.out.println("Checking for active transit lines from BVG radar API...");

            List<Map<String, Object>> movements = radarClient.fetchBerlinMovements();

            if (movements != null && !movements.isEmpty()) {
                // Count vehicles by line - only include supported transit modes that appear in radar data.
                Map<String, Long> lineCounts = movements.stream()
                    .map(this::extractLineRef)
                    .filter(Objects::nonNull)
                    .map(LineRef::name)
                    .collect(java.util.stream.Collectors.groupingBy(
                        lineName -> lineName,
                        java.util.stream.Collectors.counting()
                    ));

                if (!lineCounts.isEmpty()) {
                    lineCounts.keySet().forEach(lineId ->
                        emitters.computeIfAbsent(lineId, key -> new CopyOnWriteArrayList<>())
                    );

                    System.out.println("Active transit lines available: " + lineCounts.size());
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
        locations = fetchLiveVehicleLocations();

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
                    subs.remove(emitter);
                }
            }));

            if (matchingLocations.isEmpty() && !ALL_ROUTES_ID.equals(routeId)) {
                simulateVehiclesForRoute(routeId, subs);
            }
        });
    }

    private List<VehicleLocation> fetchLiveVehicleLocations() {
        List<Map<String, Object>> movements = radarClient.fetchBerlinMovements();
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

        LineRef lineRef = extractLineRef(movement);
        if (lineRef == null) {
            return null;
        }
        String lineId = lineRef.name();

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
        String vehicleId = VehicleIdFormatter.format(lineId, originalTripId, sequenceNumber, lineRef.mode());

        return new VehicleLocation(
            lineId,
            vehicleId,
            originalTripId,
            lineRef.mode(),
            ((Number) latObj).doubleValue(),
            ((Number) lonObj).doubleValue(),
            Instant.now(),
            destination
        );
    }

    @SuppressWarnings("unchecked")
    private LineRef extractLineRef(Map<String, Object> movement) {
        Object lineValue = movement.get("line");
        if (!(lineValue instanceof Map)) {
            return null;
        }

        Map<String, Object> line = (Map<String, Object>) lineValue;
        Object lineName = line.get("name");
        Object lineMode = line.get("mode");
        Object lineProduct = line.get("product");

        if (lineName instanceof String) {
            String normalizedMode = normalizeMode((String) lineName, lineProduct, lineMode);
            if (normalizedMode != null) {
                return new LineRef((String) lineName, normalizedMode);
            }
        }

        return null;
    }

    private String normalizeMode(String lineName, Object product, Object mode) {
        if (product instanceof String productValue && SUPPORTED_MODES.contains(productValue)) {
            return productValue;
        }

        if (mode instanceof String modeValue && SUPPORTED_MODES.contains(modeValue)) {
            return modeValue;
        }

        String normalizedLineName = lineName == null ? "" : lineName.toUpperCase();
        if (normalizedLineName.startsWith("U")) {
            return "subway";
        }
        if (normalizedLineName.startsWith("S")) {
            return "suburban";
        }
        if (normalizedLineName.startsWith("RB") || normalizedLineName.startsWith("RE")) {
            return "regional";
        }
        if (normalizedLineName.startsWith("F")) {
            return "ferry";
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
                        null,
                        "bus",
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

    private record LineRef(String name, String mode) {
    }
}

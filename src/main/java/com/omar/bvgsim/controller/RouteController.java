package com.omar.bvgsim.controller;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.omar.bvgsim.model.Route;
import com.omar.bvgsim.service.BvgRadarClient;
import com.omar.bvgsim.service.RouteLoader;
import com.omar.bvgsim.service.VehicleIdFormatter;

@RestController
@RequestMapping("/api/routes")
public class RouteController {
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

    @GetMapping
    public List<Route> list() {
        return loader.getAll();
    }
    
    @GetMapping({"/lines", "/top-lines"})
    public List<Map<String, Object>> getLines() {
        List<Map<String, Object>> movements = radarClient.fetchBerlinMovements();

        Map<LineRef, Long> lineCounts = movements.stream()
            .map(this::extractLineRef)
            .filter(Objects::nonNull)
            .collect(Collectors.groupingBy(
                lineRef -> lineRef,
                Collectors.counting()
            ));

        if (!lineCounts.isEmpty()) {
            return lineCounts.entrySet().stream()
                .sorted((left, right) -> compareLineIds(left.getKey().name(), right.getKey().name()))
                .map(entry -> {
                    LineRef lineRef = entry.getKey();
                    Map<String, Object> lineInfo = new HashMap<>();
                    lineInfo.put("id", lineRef.name());
                    lineInfo.put("name", displayModeName(lineRef.mode()) + " " + lineRef.name());
                    lineInfo.put("mode", lineRef.mode());
                    lineInfo.put("vehicleCount", entry.getValue());
                    return lineInfo;
                })
                .collect(Collectors.toList());
        }

        return fallbackLines();
    }
    
    @GetMapping("/vehicles/{lineId}")
    public List<Map<String, Object>> getVehiclesForLine(@PathVariable String lineId) {
        AtomicInteger vehicleCounter = new AtomicInteger(1);

        return radarClient.fetchBerlinMovements().stream()
            .filter(movement -> {
                LineRef lineRef = extractLineRef(movement);
                return lineRef != null && lineId.equals(lineRef.name());
            })
            .map(movement -> {
                LineRef lineRef = extractLineRef(movement);
                return lineRef == null
                    ? null
                    : toVehicleInfo(lineRef, movement, vehicleCounter.getAndIncrement());
            })
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
    }

    @GetMapping("/vehicles")
    public List<Map<String, Object>> getAllVehicles() {
        Map<String, AtomicInteger> vehicleCounters = new HashMap<>();

        return radarClient.fetchBerlinMovements().stream()
            .map(movement -> {
                LineRef lineRef = extractLineRef(movement);
                if (lineRef == null) {
                    return null;
                }

                int sequenceNumber = vehicleCounters
                    .computeIfAbsent(lineRef.name(), key -> new AtomicInteger(1))
                    .getAndIncrement();
                return toVehicleInfo(lineRef, movement, sequenceNumber);
            })
            .filter(Objects::nonNull)
            .sorted(Comparator
                .comparing((Map<String, Object> vehicle) -> vehicle.get("lineId").toString(), this::compareLineIds)
                .thenComparing(vehicle -> vehicle.get("id").toString()))
            .collect(Collectors.toList());
    }

    @GetMapping("/trips/{tripId}")
    public Map<String, Object> getTrip(
        @PathVariable String tripId,
        @RequestParam(required = false) String lineId,
        @RequestParam(required = false) String direction
    ) {
        return radarClient.fetchTrip(tripId, lineId, direction);
    }

    private LineRef extractLineRef(Map<String, Object> movement) {
        Map<String, Object> line = extractMap(movement.get("line"));
        if (line == null) {
            return null;
        }

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

    private Map<String, Object> toVehicleInfo(LineRef lineRef, Map<String, Object> movement, int sequenceNumber) {
        Map<String, Object> location = extractMap(movement.get("location"));
        if (location == null) {
            return null;
        }

        Object latitude = location.get("latitude");
        Object longitude = location.get("longitude");
        if (!(latitude instanceof Number) || !(longitude instanceof Number)) {
            return null;
        }

        String tripId = movement.get("tripId") instanceof String ? (String) movement.get("tripId") : null;
        String destination = movement.get("direction") instanceof String ? (String) movement.get("direction") : null;

        Map<String, Object> vehicleInfo = new HashMap<>();
        vehicleInfo.put("id", VehicleIdFormatter.format(lineRef.name(), tripId, sequenceNumber, lineRef.mode()));
        vehicleInfo.put("lineId", lineRef.name());
        vehicleInfo.put("mode", lineRef.mode());
        vehicleInfo.put("tripId", tripId);
        vehicleInfo.put("destination", destination != null && !destination.isBlank() ? destination : "Unknown destination");
        vehicleInfo.put("latitude", ((Number) latitude).doubleValue());
        vehicleInfo.put("longitude", ((Number) longitude).doubleValue());
        return vehicleInfo;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> extractMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    private int compareLineIds(String left, String right) {
        int categoryComparison = Integer.compare(lineCategory(left), lineCategory(right));
        if (categoryComparison != 0) {
            return categoryComparison;
        }

        int numberComparison = Integer.compare(lineNumber(left), lineNumber(right));
        if (numberComparison != 0) {
            return numberComparison;
        }

        return String.CASE_INSENSITIVE_ORDER.compare(left, right);
    }

    private int lineCategory(String line) {
        if (line == null || line.isBlank()) {
            return 5;
        }

        char first = Character.toUpperCase(line.charAt(0));
        if (first == 'U') {
            return 0;
        }
        if (first == 'S') {
            return 1;
        }
        if (Character.isDigit(first)) {
            return 2;
        }
        if (first == 'M') {
            return 3;
        }
        if (first == 'X') {
            return 4;
        }
        if (first == 'N') {
            return 5;
        }
        return 6;
    }

    private int lineNumber(String line) {
        if (line == null) {
            return Integer.MAX_VALUE;
        }

        String digits = line.replaceAll("\\D+", "");
        if (digits.isBlank()) {
            return Integer.MAX_VALUE;
        }

        try {
            return Integer.parseInt(digits);
        } catch (NumberFormatException e) {
            return Integer.MAX_VALUE;
        }
    }

    private List<Map<String, Object>> fallbackLines() {
        List<Route> routes = loader.getAll();
        if (routes != null && !routes.isEmpty()) {
            return routes.stream()
                .map(route -> {
                    Map<String, Object> lineInfo = new HashMap<>();
                    lineInfo.put("id", route.getId());
                    lineInfo.put("name", route.getName());
                    lineInfo.put("mode", "bus");
                    lineInfo.put("vehicleCount", 0L);
                    return lineInfo;
                })
                .sorted(Comparator.comparing(line -> line.get("id").toString(), this::compareLineIds))
                .collect(Collectors.toList());
        }

        return new ArrayList<>();
    }

    private String displayModeName(String mode) {
        return switch (mode) {
            case "subway" -> "U-Bahn";
            case "suburban" -> "S-Bahn";
            case "tram" -> "Tram";
            case "ferry" -> "Ferry";
            case "regional" -> "Regional";
            case "express" -> "Express";
            case "bus" -> "Bus";
            default -> "Line";
        };
    }

    private record LineRef(String name, String mode) {
    }
}

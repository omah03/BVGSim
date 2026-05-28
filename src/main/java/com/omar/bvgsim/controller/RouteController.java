package com.omar.bvgsim.controller;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import com.omar.bvgsim.model.Route;
import com.omar.bvgsim.service.RouteLoader;
import com.omar.bvgsim.service.VehicleIdFormatter;

@RestController
@RequestMapping("/api/routes")
public class RouteController {
    private static final String RADAR_URL =
        "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=256&frames=1";

    @Autowired
    private RouteLoader loader;
    
    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping
    public List<Route> list() {
        return loader.getAll();
    }
    
    @GetMapping({"/lines", "/top-lines"})
    public List<Map<String, Object>> getLines() {
        List<Map<String, Object>> movements = fetchRadarMovements();

        Map<String, Long> lineCounts = movements.stream()
            .map(this::extractBusLineName)
            .filter(Objects::nonNull)
            .collect(Collectors.groupingBy(
                lineName -> lineName,
                Collectors.counting()
            ));

        if (!lineCounts.isEmpty()) {
            return lineCounts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(this::compareLineIds))
                .map(entry -> {
                    Map<String, Object> lineInfo = new HashMap<>();
                    lineInfo.put("id", entry.getKey());
                    lineInfo.put("name", "Bus Line " + entry.getKey());
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

        return fetchRadarMovements().stream()
            .filter(movement -> lineId.equals(extractBusLineName(movement)))
            .map(movement -> toVehicleInfo(lineId, movement, vehicleCounter.getAndIncrement()))
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
    }

    @GetMapping("/vehicles")
    public List<Map<String, Object>> getAllVehicles() {
        Map<String, AtomicInteger> vehicleCounters = new HashMap<>();

        return fetchRadarMovements().stream()
            .map(movement -> {
                String lineId = extractBusLineName(movement);
                if (lineId == null) {
                    return null;
                }

                int sequenceNumber = vehicleCounters
                    .computeIfAbsent(lineId, key -> new AtomicInteger(1))
                    .getAndIncrement();
                return toVehicleInfo(lineId, movement, sequenceNumber);
            })
            .filter(Objects::nonNull)
            .sorted(Comparator
                .comparing((Map<String, Object> vehicle) -> vehicle.get("lineId").toString(), this::compareLineIds)
                .thenComparing(vehicle -> vehicle.get("id").toString()))
            .collect(Collectors.toList());
    }

    private List<Map<String, Object>> fetchRadarMovements() {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(RADAR_URL, Map.class);

            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                return movements != null ? movements : Collections.emptyList();
            }
        } catch (Exception e) {
            System.err.println("Error fetching BVG radar data: " + e.getMessage());
        }

        return Collections.emptyList();
    }

    private String extractBusLineName(Map<String, Object> movement) {
        Map<String, Object> line = extractMap(movement.get("line"));
        if (line == null) {
            return null;
        }

        Object lineName = line.get("name");
        Object lineMode = line.get("mode");

        if (lineName instanceof String && "bus".equals(lineMode)) {
            return (String) lineName;
        }

        return null;
    }

    private Map<String, Object> toVehicleInfo(String lineId, Map<String, Object> movement, int sequenceNumber) {
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
        vehicleInfo.put("id", VehicleIdFormatter.format(lineId, tripId, sequenceNumber));
        vehicleInfo.put("lineId", lineId);
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
        if (Character.isDigit(first)) {
            return 0;
        }
        if (first == 'M') {
            return 1;
        }
        if (first == 'X') {
            return 2;
        }
        if (first == 'N') {
            return 3;
        }
        return 4;
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
                    lineInfo.put("vehicleCount", 0L);
                    return lineInfo;
                })
                .sorted(Comparator.comparing(line -> line.get("id").toString(), this::compareLineIds))
                .collect(Collectors.toList());
        }

        return new ArrayList<>();
    }
}

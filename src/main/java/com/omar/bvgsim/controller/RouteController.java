package com.omar.bvgsim.controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

@RestController
@RequestMapping("/api/routes")
public class RouteController {
    @Autowired
    private RouteLoader loader;
    
    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping
    public List<Route> list() {
        return loader.getAll();
    }
    
    @GetMapping("/top-lines")
    public List<Map<String, Object>> getTopLines() {
        try {
            String radarUrl = "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=100&frames=1";
            
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
            
            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                
                if (movements != null && !movements.isEmpty()) {
                    Map<String, Long> lineCounts = movements.stream()
                        .filter(movement -> movement.get("line") != null)
                        .collect(Collectors.groupingBy(
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
                            Collectors.counting()
                        ));
                    
                    lineCounts.remove(null);
                    
                    if (!lineCounts.isEmpty()) {
                        // Get top 3 most active lines
                        List<Map<String, Object>> topLines = lineCounts.entrySet().stream()
                            .sorted((e1, e2) -> Long.compare(e2.getValue(), e1.getValue())) // Sort by count descending
                            .limit(3) // Take only top 3
                            .map(entry -> {
                                Map<String, Object> lineInfo = new HashMap<>();
                                lineInfo.put("id", entry.getKey());
                                lineInfo.put("name", "Line " + entry.getKey() + " (Berlin Transport)");
                                lineInfo.put("vehicleCount", entry.getValue());
                                return lineInfo;
                            })
                            .collect(Collectors.toList());
                        
                        System.out.println("=== TOP 3 ACTIVE LINES ===");
                        topLines.forEach(line -> {
                            System.out.println(line.get("id") + ": " + line.get("vehicleCount") + " vehicles");
                        });
                        System.out.println("===========================");
                        
                        return topLines;
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Error getting top active lines: " + e.getMessage());
        }
        
        // Fallback to some common Berlin lines if API fails
        List<Map<String, Object>> fallbackLines = new ArrayList<>();
        
        Map<String, Object> fallback1 = new HashMap<>();
        fallback1.put("id", "255");
        fallback1.put("name", "Bus Line 255 (Fallback)");
        fallback1.put("vehicleCount", 0L);
        fallbackLines.add(fallback1);
        
        Map<String, Object> fallback2 = new HashMap<>();
        fallback2.put("id", "100");
        fallback2.put("name", "Bus Line 100 (Fallback)");
        fallback2.put("vehicleCount", 0L);
        fallbackLines.add(fallback2);
        
        Map<String, Object> fallback3 = new HashMap<>();
        fallback3.put("id", "200");
        fallback3.put("name", "Bus Line 200 (Fallback)");
        fallback3.put("vehicleCount", 0L);
        fallbackLines.add(fallback3);
        
        return fallbackLines;
    }
    
    @GetMapping("/vehicles/{lineId}")
    public List<Map<String, Object>> getVehiclesForLine(@PathVariable String lineId) {
        try {
            String radarUrl = "https://v6.bvg.transport.rest/radar?north=52.6755&west=13.0883&south=52.3382&east=13.7611&results=100&frames=1";
            
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(radarUrl, Map.class);
            
            if (radarResponse != null && radarResponse.containsKey("movements")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> movements = (List<Map<String, Object>>) radarResponse.get("movements");
                
                if (movements != null && !movements.isEmpty()) {
                    List<Map<String, Object>> vehicles = new ArrayList<>();
                    AtomicInteger vehicleCounter = new AtomicInteger(1);
                    
                    movements.stream()
                        .filter(movement -> {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> line = (Map<String, Object>) movement.get("line");
                            if (line != null) {
                                String lineName = (String) line.get("name");
                                String lineMode = (String) line.get("mode");
                                return ("bus".equals(lineMode) || "train".equals(lineMode)) && lineId.equals(lineName);
                            }
                            return false;
                        })
                        .forEach(movement -> {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> location = (Map<String, Object>) movement.get("location");
                            String direction = (String) movement.get("direction");
                            String tripId = (String) movement.get("tripId");
                            
                            if (location != null) {
                                Map<String, Object> vehicleInfo = new HashMap<>();
                                vehicleInfo.put("id", "Bus " + lineId + "-" + vehicleCounter.getAndIncrement());
                                vehicleInfo.put("tripId", tripId);
                                vehicleInfo.put("destination", direction != null ? direction : "Unknown destination");
                                vehicleInfo.put("latitude", location.get("latitude"));
                                vehicleInfo.put("longitude", location.get("longitude"));
                                vehicles.add(vehicleInfo);
                            }
                        });
                    
                    return vehicles;
                }
            }
        } catch (Exception e) {
            System.err.println("Error getting vehicles for line " + lineId + ": " + e.getMessage());
        }
        
        return new ArrayList<>();
    }
}

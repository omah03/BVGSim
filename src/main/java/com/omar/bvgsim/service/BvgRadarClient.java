package com.omar.bvgsim.service;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class BvgRadarClient {
    private static final double BERLIN_NORTH = 52.6755;
    private static final double BERLIN_WEST = 13.0883;
    private static final double BERLIN_SOUTH = 52.3382;
    private static final double BERLIN_EAST = 13.7611;
    private static final int RADAR_RESULT_LIMIT = 4096;

    private final RestTemplate restTemplate = new RestTemplate();
    private final String apiBaseUrl;

    public BvgRadarClient(@Value("${bvg.api.base-url:https://v6.bvg.transport.rest}") String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
    }

    public List<Map<String, Object>> fetchBerlinMovements() {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> radarResponse = restTemplate.getForObject(buildRadarUrl(), Map.class);

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

    public Map<String, Object> fetchTrip(String tripId) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> tripResponse = restTemplate.getForObject(buildTripUrl(tripId), Map.class);
            return tripResponse != null ? tripResponse : Collections.emptyMap();
        } catch (Exception e) {
            System.err.println("Error fetching BVG trip data: " + e.getMessage());
        }

        return Collections.emptyMap();
    }

    private String buildRadarUrl() {
        return UriComponentsBuilder.fromHttpUrl(apiBaseUrl)
            .path("/radar")
            .queryParam("north", BERLIN_NORTH)
            .queryParam("west", BERLIN_WEST)
            .queryParam("south", BERLIN_SOUTH)
            .queryParam("east", BERLIN_EAST)
            .queryParam("results", RADAR_RESULT_LIMIT)
            .queryParam("frames", 1)
            .queryParam("polylines", false)
            .toUriString();
    }

    private String buildTripUrl(String tripId) {
        return UriComponentsBuilder.fromHttpUrl(apiBaseUrl)
            .pathSegment("trips", tripId)
            .queryParam("stopovers", true)
            .queryParam("polyline", true)
            .toUriString();
    }
}

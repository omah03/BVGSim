package com.omar.bvgsim.service;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
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

    public Map<String, Object> fetchTrip(String tripId, String lineName, String direction) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> tripResponse = restTemplate.getForObject(buildTripUrl(tripId), Map.class);
            return tripResponse != null ? tripResponse : Collections.emptyMap();
        } catch (RestClientException e) {
            // Radar trip IDs are not always accepted by the trips endpoint, so fall back to active line trips.
        }

        return fetchActiveLineTrip(tripId, lineName, direction);
    }

    private Map<String, Object> fetchActiveLineTrip(String tripId, String lineName, String direction) {
        if (lineName == null || lineName.isBlank()) {
            return Collections.emptyMap();
        }

        try {
            @SuppressWarnings("unchecked")
            Object tripsResponse = restTemplate.getForObject(buildTripsUrl(lineName), Object.class);
            List<Map<String, Object>> trips = extractTrips(tripsResponse);
            if (trips.isEmpty()) {
                return Collections.emptyMap();
            }

            return trips.stream()
                .filter(trip -> matchesTrip(trip, tripId, direction))
                .findFirst()
                .orElse(trips.get(0));
        } catch (RestClientException e) {
            System.err.println("Active BVG trip fallback failed for line " + lineName + ".");
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

    private String buildTripsUrl(String lineName) {
        return UriComponentsBuilder.fromHttpUrl(apiBaseUrl)
            .path("/trips")
            .queryParam("lineName", lineName)
            .queryParam("query", lineName)
            .queryParam("onlyCurrentlyRunning", true)
            .queryParam("stopovers", true)
            .queryParam("bus", true)
            .queryParam("suburban", false)
            .queryParam("subway", false)
            .queryParam("tram", false)
            .queryParam("ferry", false)
            .queryParam("express", false)
            .queryParam("regional", false)
            .toUriString();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> extractTrips(Object tripsResponse) {
        if (tripsResponse instanceof List) {
            return (List<Map<String, Object>>) tripsResponse;
        }

        if (tripsResponse instanceof Map) {
            Object trips = ((Map<String, Object>) tripsResponse).get("trips");
            if (trips instanceof List) {
                return (List<Map<String, Object>>) trips;
            }
        }

        return Collections.emptyList();
    }

    private boolean matchesTrip(Map<String, Object> trip, String tripId, String direction) {
        Object id = trip.get("id");
        Object tripIdValue = trip.get("tripId");
        if (tripId != null && (tripId.equals(id) || tripId.equals(tripIdValue))) {
            return true;
        }

        Object tripDirection = trip.get("direction");
        if (direction != null && !direction.isBlank() && tripDirection instanceof String) {
            return ((String) tripDirection).equalsIgnoreCase(direction);
        }

        return false;
    }
}

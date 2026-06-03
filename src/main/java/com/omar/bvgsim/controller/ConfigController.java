package com.omar.bvgsim.controller;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/config")
public class ConfigController {
    private final String googleMapsApiKey;

    public ConfigController(@Value("${google.maps.api-key:}") String googleMapsApiKey) {
        this.googleMapsApiKey = googleMapsApiKey;
    }

    @GetMapping("/maps")
    public Map<String, String> maps() {
        return Map.of("googleMapsApiKey", googleMapsApiKey);
    }
}

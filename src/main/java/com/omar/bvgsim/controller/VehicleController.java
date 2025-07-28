package com.omar.bvgsim.controller;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/api/vehicle-positions")
public class VehicleController {
    private final RestTemplate rest = new RestTemplate();

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<Map<String,Object>> getPositions(@RequestParam String line) {
        String url = 
          "https://v6.bvg.transport.rest/api/vehicle-positions?"
          + "type=bus&line=" + line;
        try {
            @SuppressWarnings("unchecked")
            List<Map<String,Object>> data =
              rest.getForObject(url, List.class);
            return data != null ? data : Collections.emptyList();
        } catch (RestClientException e) {
            return Collections.emptyList();
        }
    }
}

package com.omar.bvgsim.controller;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.omar.bvgsim.service.SimulationService;

@RestController
@RequestMapping("/api/sim")
public class SimulationController {
    @Autowired
    private SimulationService sim;

    @GetMapping("/stream/{routeId}")
    public SseEmitter stream(@PathVariable String routeId) {
        return sim.subscribe(routeId);
    }

    @GetMapping("/stream")
    public SseEmitter streamRoutes(@RequestParam String routes) {
        Set<String> routeIds = Arrays.stream(routes.split(","))
            .map(String::trim)
            .filter(routeId -> !routeId.isBlank())
            .collect(Collectors.toSet());
        return sim.subscribe(routeIds);
    }
}

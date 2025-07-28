package com.omar.bvgsim.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
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
}

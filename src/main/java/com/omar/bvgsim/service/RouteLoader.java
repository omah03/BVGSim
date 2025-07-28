package com.omar.bvgsim.service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.omar.bvgsim.model.Route;

import jakarta.annotation.PostConstruct;

@Service
public class RouteLoader {
    private List<Route> routes = new ArrayList<>();

    @PostConstruct
    public void load() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        InputStream is = getClass().getResourceAsStream("/config/routes.json");
        routes = mapper.readValue(is, new TypeReference<>() {});
    }

    public List<Route> getAll() {
        return routes;
    }
}

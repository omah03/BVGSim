package com.omar.bvgsim.model;

import java.time.Instant;

public record VehicleLocation(
    String routeId,
    String vehicleId,
    double lat,
    double lon,
    Instant timestamp,
    String destination
) { }

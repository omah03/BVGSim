package com.omar.bvgsim.model;

import java.time.Instant;

public record VehicleLocation(
    String routeId,
    String vehicleId,
    String tripId,
    String mode,
    double lat,
    double lon,
    Instant timestamp,
    String destination
) { }

package com.omar.bvgsim.service;

import java.util.Locale;

public final class VehicleIdFormatter {
    private VehicleIdFormatter() {
    }

    public static String format(String lineId, String tripId, int sequenceNumber) {
        return format(lineId, tripId, sequenceNumber, null);
    }

    public static String format(String lineId, String tripId, int sequenceNumber, String mode) {
        String suffix;

        if (tripId != null && !tripId.isBlank()) {
            suffix = Integer.toUnsignedString(tripId.hashCode(), 36).toUpperCase(Locale.ROOT);
        } else {
            suffix = String.format(Locale.ROOT, "%02d", sequenceNumber);
        }

        String prefix = switch (mode == null ? "" : mode) {
            case "subway" -> "U-Bahn";
            case "suburban" -> "S-Bahn";
            case "tram" -> "Tram";
            case "ferry" -> "Ferry";
            case "regional" -> "Regional";
            case "express" -> "Express";
            case "bus" -> "Bus";
            default -> "Vehicle";
        };

        return prefix + " " + lineId + "-" + suffix;
    }
}

package com.omar.bvgsim.service;

import java.util.Locale;

public final class VehicleIdFormatter {
    private VehicleIdFormatter() {
    }

    public static String format(String lineId, String tripId, int sequenceNumber) {
        String suffix;

        if (tripId != null && !tripId.isBlank()) {
            suffix = Integer.toUnsignedString(tripId.hashCode(), 36).toUpperCase(Locale.ROOT);
        } else {
            suffix = String.format(Locale.ROOT, "%02d", sequenceNumber);
        }

        return "Bus " + lineId + "-" + suffix;
    }
}

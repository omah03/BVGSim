# BVGSim

Real-time BerlinBus tracker using BVG’s GTFS-Realtime feed:

- **Backend:** Spring Boot REST & Server‑Sent Events (SSE)
- **Frontend:** Leaflet map with route selection & live markers
- **Data:** Live vehicle positions from https://production.gtfsrt.vbb.de/data

## Run

```bash
mvn clean package
mvn spring-boot:run

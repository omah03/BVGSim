# BVG Real-Time Transit Tracker

A comprehensive real-time transit tracking application for Berlin's BVG/VBB network, featuring interactive maps, geolocation tracking, and color-coded destinations.
Lets riders choose one or more active lines across buses, U-Bahn, S-Bahn, trams, ferries, and regional services, hide everything else, and track a specific vehicle from the selected lines.
 **[Live Application](https://bvgsim-production.up.railway.app)** |  **[Demo Version](https://omah03.github.io/BVGSim/)** |  **[Source Code](https://github.com/omah03/BVGSim)**

##  Application Screenshots

### Real-Time Vehicle Tracking
<img width="3838" height="1857" alt="image" src="https://github.com/user-attachments/assets/006e78fd-fedf-4d13-b37c-535ad75f730d" />

### Geolocation & Nearest Vehicle Detection
<img width="2781" height="1255" alt="image" src="https://github.com/user-attachments/assets/705d1438-2a84-44eb-a52d-f5deaf08842a" />

### Individual Vehicle Tracking Mode
<img width="1752" height="1166" alt="image" src="https://github.com/user-attachments/assets/1312e7d5-c5a1-4345-8261-aca1983070d0" />

### Mobile Responsive Design
![image0](https://github.com/user-attachments/assets/4918481d-c87b-4523-8ff9-4b948d8f545b)

## 🚌 Key Features

- ** Real-time tracking** of BVG/VBB vehicles using the official BVG API v6
- ** Interactive map** with Google Maps showing live vehicle positions across Berlin
- ** Color-coded selected lines** with clear vehicle labels and destination details
- ** Geolocation support** to find and track nearest vehicles with distance calculations
- ** Individual vehicle tracking** from the selected line set with detailed destination information
- ** Remaining stop and trip-path highlights** for the focused vehicle, bounded by your nearest stop when geolocation is active
- ** A-to-B transit planning** with Google transit routing and live vehicle overlays for the required lines
- ** Server-sent events** for real-time updates every second
- ** Responsive design** optimized for desktop and mobile devices
- ** Live route visualization** with actual BVG line data and stop information
- ** Multi-line selection** based on vehicle activity and availability
- ** Rate-limit conscious live feed** using one shared stream for line filtering and vehicle tracking

##  Tech Stack

### Backend
- **Java 17** with Spring Boot 3.1.4
- **REST API** endpoints for vehicle and route data
- **Server-Sent Events (SSE)** for real-time data streaming
- **BVG Transport API v6** integration for live vehicle radar data
- **Maven** for dependency management and build automation

### Frontend
- **HTML5** with modern CSS3 and responsive design
- **JavaScript ES6+** with Google Maps for interactive mapping
- **Geolocation API** for user positioning and distance calculations
- **EventSource API** for real-time updates via Server-Sent Events
- **Google Maps JavaScript API** for interactive maps and custom markers

##  Quick Start

### Prerequisites
- Java 17 or higher
- Maven 3.6+
- Internet connection for BVG API access

### Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/omah03/BVGSim.git
   cd BVGSim
   ```

2. **Build and run:**
   ```bash
   mvn clean package
   mvn spring-boot:run
   ```

3. **Access the application:**
   - Open your browser to: `http://localhost:8080`
   - Allow location permissions for full functionality

### Docker Deployment

```bash
# Build the Docker image
docker build -t bvgsim .

# Run the container
docker run -p 8080:8080 bvgsim
```

##  Live Deployment

The application is deployed and running live on Railway:
- **Production URL:** https://bvgsim-production.up.railway.app
- **Deployment:** Automated via GitHub integration
- **Infrastructure:** Railway with Docker containerization

##  How to Use

1. ** Select one or more transit lines** from the line picker
2. ** Choose a specific vehicle** from the selected lines, or view all selected-line vehicles
3. ** Plan a trip** by entering a start and destination, then follow the highlighted route and required live lines
4. ** Enable location tracking** to find nearest vehicles and calculate distances
5. ** Click vehicle markers** for detailed information including destination and position
6. ** Use the legend** to understand color coding for different destinations
7. ** Works seamlessly** on both desktop and mobile devices

##  API Integration

This application integrates with multiple BVG and Berlin transport APIs:

- **BVG Radar API**: Real-time vehicle positions and movement data
- **BVG Transport API v6**: Route information, schedules, and stop data
- **Google Maps JavaScript API**: Base map, markers, and geographic display
- **Geolocation API**: User positioning and distance calculations

##  Architecture

```
src/
├── main/java/com/omar/bvgsim/
│   ├── BvgSimApplication.java          # Main Spring Boot application entry point
│   ├── config/WebConfig.java           # CORS configuration and web settings
│   ├── controller/
│   │   ├── RouteController.java        # REST endpoints for route and vehicle data
│   │   ├── SimulationController.java   # SSE streaming controller for real-time updates
│   │   └── VehicleController.java      # Vehicle-specific data endpoints
│   ├── model/
│   │   ├── Route.java                  # Route data model with waypoints
│   │   ├── VehicleLocation.java        # Vehicle position record with destination
│   │   └── Waypoint.java               # Geographic waypoint model
│   └── service/
│       ├── RouteLoader.java            # Route data loading and management
│       └── SimulationService.java      # Real-time BVG API integration and broadcasting
└── main/resources/
    ├── static/                         # Frontend assets (HTML, CSS, JS)
    │   ├── index.html                  # Main application interface
    │   └── app.js                      # Frontend logic and map functionality
    ├── config/routes.json              # Static route definitions for fallback
    └── application.properties          # Spring Boot configuration
```

##  Configuration

### Environment Variables
- `SERVER_PORT`: Application port (default: 8080)
- `BVG_API_BASE_URL`: BVG API base URL (default: https://v6.bvg.transport.rest)
- `GOOGLE_MAPS_API_KEY`: Browser API key for the Google Maps JavaScript API. On Railway, set this in the service's Variables tab.

### Application Properties
```properties
server.port=8080
spring.web.cors.allowed-origins=*
spring.web.cors.allowed-methods=GET,POST,PUT,DELETE,OPTIONS
google.maps.api-key=${GOOGLE_MAPS_API_KEY:}
```

##  Contributing

Contributions are welcome! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request** with a detailed description

### Development Guidelines
- Follow Java coding standards and Spring Boot best practices
- Write meaningful commit messages
- Test locally before submitting PRs
- Update documentation for new features

##  License

This project is open source and available under the [MIT License](LICENSE).


- **Backend:** Spring Boot REST & Server‑Sent Events (SSE)
- **Frontend:** Google Maps with route selection & live markers
- **Data:** Live vehicle positions from https://production.gtfsrt.vbb.de/data

## Run

```bash
mvn clean package
mvn spring-boot:run

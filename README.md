# BVG Real-Time Bus Tracker

A comprehensive real-time bus tracking application for Berlin's BVG public transport system, featuring interactive maps, geolocation tracking, and color-coded destinations.

🌐 **[Live Application](https://bvgsim-production.up.railway.app)** | 🎮 **[Demo Version](https://omah03.github.io/BVGSim/)** | 📂 **[Source Code](https://github.com/omah03/BVGSim)**

## 📱 Application Screenshots

### Real-Time Vehicle Tracking
<img width="3838" height="1857" alt="image" src="https://github.com/user-attachments/assets/006e78fd-fedf-4d13-b37c-535ad75f730d" />

### Geolocation & Nearest Vehicle Detection
<img width="2781" height="1255" alt="image" src="https://github.com/user-attachments/assets/705d1438-2a84-44eb-a52d-f5deaf08842a" />

### Individual Vehicle Tracking Mode
<img width="1752" height="1166" alt="image" src="https://github.com/user-attachments/assets/1312e7d5-c5a1-4345-8261-aca1983070d0" />

### Mobile Responsive Design
*Screenshot showing mobile interface*

## 🚌 Key Features

- **🔴 Real-time tracking** of BVG buses and trains using the official BVG API v6
- **🗺️ Interactive map** with Leaflet.js showing live vehicle positions across Berlin
- **🎨 Color-coded destinations** for easy route identification and direction tracking
- **📍 Geolocation support** to find and track nearest vehicles with distance calculations
- **🚌 Individual vehicle tracking** with detailed route information and following mode
- **⚡ Server-sent events** for real-time updates every 3 seconds
- **📱 Responsive design** optimized for desktop and mobile devices
- **🛣️ Live route visualization** with actual BVG line data and stop information
- **📊 Dynamic line selection** based on vehicle activity and availability

## 🛠️ Tech Stack

### Backend
- **Java 17** with Spring Boot 3.1.4
- **REST API** endpoints for vehicle and route data
- **Server-Sent Events (SSE)** for real-time data streaming
- **BVG Transport API v6** integration for live vehicle radar data
- **Maven** for dependency management and build automation

### Frontend
- **HTML5** with modern CSS3 and responsive design
- **JavaScript ES6+** with Leaflet.js for interactive mapping
- **Geolocation API** for user positioning and distance calculations
- **EventSource API** for real-time updates via Server-Sent Events
- **Leaflet.js** for interactive maps and custom markers

## 🚀 Quick Start

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

## 🌐 Live Deployment

The application is deployed and running live on Railway:
- **Production URL:** https://bvgsim-production.up.railway.app
- **Deployment:** Automated via GitHub integration
- **Infrastructure:** Railway with Docker containerization

## 📱 How to Use

1. **🚌 Select a bus line** from the dropdown menu (shows most active lines first)
2. **🎯 Choose specific vehicle** or view all vehicles on the selected line
3. **📍 Enable location tracking** to find nearest buses and calculate distances
4. **🖱️ Click vehicle markers** for detailed information including destination and position
5. **🎨 Use the legend** to understand color coding for different destinations
6. **📱 Works seamlessly** on both desktop and mobile devices

##  API Integration

This application integrates with multiple BVG and Berlin transport APIs:

- **BVG Radar API**: Real-time vehicle positions and movement data
- **BVG Transport API v6**: Route information, schedules, and stop data
- **OpenStreetMap**: Base map tiles and geographic data
- **Geolocation API**: User positioning and distance calculations

## 🏗️ Architecture

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

## 🔧 Configuration

### Environment Variables
- `SERVER_PORT`: Application port (default: 8080)
- `BVG_API_BASE_URL`: BVG API base URL (default: https://v6.bvg.transport.rest)

### Application Properties
```properties
server.port=8080
spring.web.cors.allowed-origins=*
spring.web.cors.allowed-methods=GET,POST,PUT,DELETE,OPTIONS
```

## 🌐 Deployment Options

### Option 1: Railway (Current)
- **Automatic deployment** from GitHub repository
- **Custom domain** support with SSL
- **Docker-based** deployment with multi-stage builds
- **Monitoring** and logging included

### Option 2: Alternative Services
- **Render**: Similar to Railway with free tier
- **Heroku**: Traditional PaaS with Git-based deployment
- **DigitalOcean App Platform**: Container-based deployment
- **AWS/Azure**: Enterprise-level hosting options

## 🎨 Customization

### Frontend Customization
- **Map styling**: Modify tile layer in `app.js`
- **Color scheme**: Update destination colors in `getColorForDestination()`
- **UI layout**: Customize CSS in `index.html`
- **Update intervals**: Adjust refresh rates for different performance needs

### Backend Customization
- **API endpoints**: Modify controllers for additional functionality
- **Data sources**: Extend service layer for other transport APIs
- **Update frequency**: Adjust `@Scheduled` intervals in `SimulationService`
- **Geographic scope**: Update radar coordinates for different cities

## 🤝 Contributing

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

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- **BVG (Berliner Verkehrsbetriebe)** for providing the public transport API
- **OpenStreetMap** contributors for comprehensive map data
- **Leaflet.js** team for the excellent mapping library
- **Spring Boot** community for the robust framework
- **Railway** for reliable hosting infrastructure

---

- **Backend:** Spring Boot REST & Server‑Sent Events (SSE)
- **Frontend:** Leaflet map with route selection & live markers
- **Data:** Live vehicle positions from https://production.gtfsrt.vbb.de/data

## Run

```bash
mvn clean package
mvn spring-boot:run

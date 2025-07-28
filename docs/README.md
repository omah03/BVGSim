# BVG Real-Time Bus Tracker

A real-time bus tracking application for Berlin's BVG public transport system, featuring interactive maps, geolocation tracking, and color-coded destinations.

## 🚌 Features

- **Real-time tracking** of BVG buses and trains using the BVG API
- **Interactive map** with Leaflet.js showing vehicle positions
- **Color-coded destinations** for easy route identification
- **Geolocation support** to find nearest vehicles
- **Individual vehicle tracking** with detailed route information
- **Server-sent events** for live updates
- **Responsive design** for desktop and mobile

## 🛠️ Tech Stack

### Backend
- **Java 17** with Spring Boot 3.1.4
- **REST API** endpoints for vehicle data
- **Server-Sent Events** for real-time streaming
- **BVG Transport API v6** integration

### Frontend
- **HTML5** with modern CSS
- **JavaScript ES6+** with Leaflet.js mapping
- **Geolocation API** for user positioning
- **Real-time updates** via EventSource

## 🚀 Quick Start

### Prerequisites
- Java 17 or higher
- Maven 3.6+

### Running Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/omah03/BVGSim.git
   cd BVGSim
   ```

2. Build and run:
   ```bash
   mvn spring-boot:run
   ```

3. Open your browser to: `http://localhost:8080`

### Demo Version

For a static demo (GitHub Pages compatible), check the `docs/` folder which contains a simplified version with simulated data.

**[🌐 Live Demo](https://omah03.github.io/BVGSim/)**

## 📱 Usage

1. **Select a bus line** from the dropdown menu
2. **Choose specific vehicle** or view all vehicles on the line
3. **Enable location tracking** to find nearest buses
4. **Click vehicle markers** for detailed information
5. **Use the legend** to understand color coding

## 🗺️ API Integration

This application integrates with the official BVG (Berliner Verkehrsbetriebe) Transport API:
- **Radar endpoint**: Real-time vehicle positions
- **Line data**: Route information and schedules
- **Stop data**: Station locations and connections

## 🏗️ Architecture

```
src/
├── main/java/com/omar/bvgsim/
│   ├── BvgSimApplication.java          # Main Spring Boot application
│   ├── config/WebConfig.java           # CORS and web configuration
│   ├── controller/
│   │   ├── RouteController.java        # REST endpoints for routes
│   │   ├── SimulationController.java   # SSE streaming controller
│   │   └── VehicleController.java      # Vehicle data endpoints
│   ├── model/
│   │   ├── Route.java                  # Route data model
│   │   ├── VehicleLocation.java        # Vehicle position record
│   │   └── Waypoint.java               # Route waypoint model
│   └── service/
│       ├── RouteLoader.java            # Route data loading service
│       └── SimulationService.java      # Real-time data fetching
└── main/resources/
    ├── static/                         # Frontend assets
    ├── config/routes.json              # Static route definitions
    └── application.properties          # Spring configuration
```

## 🌐 Deployment Options

### Option 1: Full Stack Hosting
- **Railway**: `railway deploy`
- **Render**: Connect GitHub repository
- **Heroku**: `git push heroku main`

### Option 2: Separate Frontend/Backend
- **Frontend**: GitHub Pages (`docs/` folder)
- **Backend**: Any Java hosting service
- **Benefits**: Static frontend + dynamic backend

## 🎨 Customization

- **Colors**: Modify destination colors in `app.js`
- **Map style**: Change tile layer in map initialization
- **Update frequency**: Adjust `@Scheduled` intervals in `SimulationService`
- **API region**: Update radar coordinates for different cities

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- **BVG** for providing the public transport API
- **OpenStreetMap** contributors for map data
- **Leaflet.js** for the mapping library
- **Spring Boot** team for the excellent framework

---

**Made with ❤️ in Berlin**

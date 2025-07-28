FROM eclipse-temurin:17-jdk-alpine
WORKDIR /app
COPY target/bvg-sim-0.0.1.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","app.jar"]

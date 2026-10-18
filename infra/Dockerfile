FROM node:22-alpine AS frontend-test
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run lint && npm test

FROM frontend-test AS frontend
ARG ALLOWED_EMAIL_DOMAINS=DQGM.dev
ENV VITE_ALLOWED_EMAIL_DOMAINS=$ALLOWED_EMAIL_DOMAINS VITE_USE_MOCK_API=false
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend-test
WORKDIR /workspace
COPY server/pom.xml ./pom.xml
COPY infra/maven-settings.xml /usr/share/maven/ref/pulsechat-settings.xml
COPY server/src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -s /usr/share/maven/ref/pulsechat-settings.xml verify

FROM backend-test AS backend
COPY --from=frontend /client/dist ./src/main/resources/static
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -s /usr/share/maven/ref/pulsechat-settings.xml package -DskipTests

FROM node:22-alpine AS smoke-test
WORKDIR /checks
COPY scripts/smoke.mjs ./smoke.mjs
ENTRYPOINT ["node", "smoke.mjs"]

FROM eclipse-temurin:21-jre-jammy AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 app
WORKDIR /app
COPY --from=backend /workspace/target/pulsechat-server-*.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

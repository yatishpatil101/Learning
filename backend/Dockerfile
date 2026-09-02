# Container image for draazy-api (platform-architecture.md §6.1: Cloud Run, asia-south1).
#
# Why a Dockerfile and not `spring-boot:build-image`. Buildpacks need a Docker daemon on whatever
# machine runs the build, which rules out the hosted CI runners and the "push a repo, we build it"
# hosts we may end up on. A Dockerfile is the one artefact every container host accepts.
#
# Two things about this repo make a stock Spring Boot Dockerfile wrong, and both are silent:
#
#   1. `.mvn/maven.config` pins `-DbuildDirName=target-cli` so command-line builds do not fight the
#      VS Code language server over `target/`. Inside a container there is no language server and no
#      fight, so `-DbuildDirName=target` is passed explicitly below. Explicitly, rather than relying
#      on maven.config's value, because that file exists to solve a developer-machine problem and is
#      free to change for reasons that have nothing to do with the deploy — and the failure mode of
#      guessing wrong is a COPY that matches no jar.
#
#   2. `server.port=${PORT:8080}` (application.properties) is the Cloud Run contract. Nothing here
#      hardcodes a port; EXPOSE is documentation only and the host's PORT wins.

# ---------------------------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------------------------
FROM eclipse-temurin:25-jdk AS build

WORKDIR /build

# Dependency layer first. The wrapper and the POM change rarely; `src/` changes every commit. Split
# this way, an ordinary code change reuses the cached dependency download instead of re-fetching the
# whole tree — which matters because this build resolves an annotation-processor path (Lombok +
# MapStruct + their binding) as well as the runtime dependencies.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -DbuildDirName=target dependency:go-offline

COPY src/ src/

# Tests are not run here. CI (.github/workflows/ci.yml) runs them against a real Postgres before
# anything reaches this file; re-running them in the image build would need a database inside the
# builder and would make a deploy fail for a reason CI already covers, minutes later and with worse
# logs. The image build's job is to package a revision CI has already judged.
RUN ./mvnw -B -DbuildDirName=target -DskipTests package

# ---------------------------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------------------------
FROM eclipse-temurin:25-jre AS runtime

# Non-root. Nothing in the app writes to the filesystem — uploads go to R2 via `R2FileStorage` — so
# there is no directory to chown and no reason for the process to own its own code.
RUN groupadd --system app && useradd --system --gid app --no-create-home app

WORKDIR /app
COPY --from=build --chown=root:root /build/target/*.jar /app/app.jar
USER app

# Baked rather than left to the deploy to supply. `application.properties` holds developer defaults
# on purpose — local Postgres credentials, a committed JWT secret, `trusted-proxies=none` — and
# Spring does not complain when a profile is simply absent. A deploy that forgets
# SPRING_PROFILES_ACTIVE would therefore boot on those defaults and report itself healthy, which is
# the exact failure ProdProfileContractTest exists to argue about. Defaulting it here means the
# insecure configuration has to be asked for by name. Override it (e.g. `sandbox`) deliberately.
ENV SPRING_PROFILES_ACTIVE=prod

# The JVM sees the container's limit, not the host's, but its default heap ceiling of 25% wastes
# most of a small Cloud Run instance. 75% leaves room for metaspace, thread stacks and the direct
# buffers the S3 client uses.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"

# Documentation only — the platform injects PORT and the app reads it (see the header note).
EXPOSE 8080

# `exec` form so the JVM is PID 1 and receives SIGTERM directly. Without it the shell is PID 1, the
# signal never reaches Java, and every scale-down or revision swap kills in-flight requests instead
# of draining them.
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

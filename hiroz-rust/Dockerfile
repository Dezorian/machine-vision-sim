# syntax=docker/dockerfile:1
FROM rust:1.91-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo fetch --locked \
    && rm -rf src
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release --locked \
    && cp /build/target/release/hiroz-conveyor /build/hiroz-conveyor

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/hiroz-conveyor /usr/local/bin/hiroz-conveyor
EXPOSE 8765
ENTRYPOINT ["hiroz-conveyor"]
CMD ["sim"]

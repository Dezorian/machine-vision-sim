FROM rust:1.91-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/hiroz-conveyor /usr/local/bin/hiroz-conveyor
EXPOSE 8765
ENTRYPOINT ["hiroz-conveyor"]
CMD ["sim"]

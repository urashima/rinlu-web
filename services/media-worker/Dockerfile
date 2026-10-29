FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg clamav clamav-freshclam ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && useradd -u 10001 -m sonora && mkdir -p /app /var/lib/clamav && chown -R sonora:sonora /var/lib/clamav /app
WORKDIR /app
COPY worker.py media_validation.py freshclam.conf /app/
USER sonora
ENTRYPOINT ["/usr/bin/tini","--","python3","-u","/app/worker.py"]

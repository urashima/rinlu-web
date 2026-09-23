#!/usr/bin/env bash
set -u
echo '=== Operating system ==='; cat /etc/os-release | grep -E '^(NAME|VERSION)=' || true
echo '=== Ports (80, 443, 943, 1194, 51820, 51821, 22) ==='
sudo ss -lntup | grep -E ':(80|443|943|1194|51820|51821|22)([[:space:]]|$)' || true
echo '=== Docker ==='; sudo docker version --format '{{.Server.Version}}' || true
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
echo '=== Firewall ==='; sudo ufw status || true
echo '=== Current RINLU response ==='; curl -I --max-time 4 http://127.0.0.1:80/ || true

#!/usr/bin/env bash
# Configure local TLS without exposing the application's HTTP listener.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

host=""; port=""; mode=start
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host|--port)
      [ "$#" -ge 2 ] || die "valeur manquante pour $1"
      if [ "$1" = --host ]; then host="$2"; else port="$2"; fi
      shift 2 ;;
    --prepare-only|--check|--export-ca)
      [ "$mode" = start ] || die "choisis un seul mode."
      mode="${1#--}"; shift ;;
    --help)
      printf '%s\n' 'Usage: ./scripts/enable-local-https.sh --host IPv4-locale [--port PORT] [--prepare-only]' '       ./scripts/enable-local-https.sh --check | --export-ca' "Le certificat racine public est exporté dans local-https-root.crt; aucune clé privée n’est exportée."
      exit 0 ;;
    *) die "argument inconnu : $1" ;;
  esac
done
require_env
[ ! -L "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || die ".env doit être un fichier régulier, sans lien symbolique."
[ -f "$ALLUMI_DIR/compose.https.yaml" ] && [ -f "$ALLUMI_DIR/deploy/Caddyfile.local" ] || die "fichiers HTTPS local manquants."
if [ -e "$ALLUMI_DIR/compose.override.yaml" ] || [ -L "$ALLUMI_DIR/compose.override.yaml" ]; then
  [ -f "$ALLUMI_DIR/compose.override.yaml" ] && [ ! -L "$ALLUMI_DIR/compose.override.yaml" ] || die "compose.override.yaml doit être un fichier régulier, sans lien symbolique."
fi

valid_local_host() {
  local value="$1" a b c d octet
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r a b c d <<< "$value"
  for octet in "$a" "$b" "$c" "$d"; do
    [[ "$octet" = 0 || "$octet" != 0* ]] && [ "$((10#$octet))" -le 255 ] || return 1
  done
  [ "$a" = 10 ] || [ "$a" = 127 ] || { [ "$a" = 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } || { [ "$a" = 192 ] && [ "$b" = 168 ]; } || { [ "$a" = 169 ] && [ "$b" = 254 ]; }
}
if [ "$mode" = check ] || [ "$mode" = export-ca ]; then
  [ -z "$host" ] && [ -z "$port" ] || die "--check et --export-ca utilisent la configuration existante."
  [ "$(env_get ALLUMI_NETWORK_MODE)" = local-https ] || die "HTTPS local n’est pas configuré."
  host="$(env_get ALLUMI_TLS_HOST)"
  port="$(env_get ALLUMI_HTTP_PORT)"; port="${port:-28080}"
fi
valid_local_host "$host" || die "utilise une IPv4 privée, de boucle locale ou de lien local."
if [ -z "$port" ]; then port="$(env_get ALLUMI_HTTP_PORT)"; port="${port:-28080}"; fi
[[ "$port" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$port))" -ge 1 ] && [ "$((10#$port))" -le 65535 ] || die "port invalide (1 à 65535)."
port="$((10#$port))"

check_compose() {
  local version major minor patch bind_address
  bind_address="$(env_get ALLUMI_BIND_ADDRESS)"; bind_address="${bind_address:-0.0.0.0}"
  version="$(docker compose version --short)" || die "Docker Compose est requis."
  [[ "$version" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]] || die "version de Docker Compose inconnue."
  major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"
  [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && { [ "$minor" -gt 24 ] || { [ "$minor" -eq 24 ] && [ "$patch" -ge 4 ]; }; }; } || die "Docker Compose 2.24.4 ou ultérieur est requis pour isoler le port HTTP."
  command -v python3 >/dev/null || die "python3 est requis pour vérifier l’isolation des ports HTTPS."
  compose config --quiet
  # Inspect the merged result: a later custom override must not restore direct
  # HTTP ports after !reset, or expose another service while proxy trust is on.
  compose config --format json | python3 -c '
import json, sys
try:
    config = json.load(sys.stdin)
    services = config["services"]
    if not isinstance(services, dict) or "app" not in services or "caddy" not in services:
        raise ValueError()
    for name, service in services.items():
        if not isinstance(service, dict) or service.get("network_mode"):
            raise ValueError()
        if name != "caddy" and service.get("ports"):
            raise ValueError()
    caddy = services["caddy"]
    ports = caddy.get("ports", [])
    if len(ports) != 1 or not isinstance(ports[0], dict):
        raise ValueError()
    published = ports[0]
    if published.get("target") != 8443 or str(published.get("published")) != sys.argv[1] or published.get("protocol", "tcp") != "tcp":
        raise ValueError()
    if published.get("host_ip", "0.0.0.0") != sys.argv[4]:
        raise ValueError()
    if caddy.get("environment", {}).get("ALLUMI_TLS_HOST") != sys.argv[3]:
        raise ValueError()
    if caddy.get("image") != "caddy:2.11.8-alpine":
        raise ValueError()
    environment = services["app"].get("environment", {})
    if environment.get("APP_URL") != sys.argv[2] or str(environment.get("TRUSTED_PROXY_HOPS")) != "1":
        raise ValueError()
except Exception:
    sys.exit("Configuration HTTPS refusée : seul Caddy doit publier le port TLS attendu; accès HTTP direct ou configuration du proxy incohérente.")
' "$port" "https://$host:$port" "$host" "$bind_address"
}

export_ca() {
  command -v openssl >/dev/null || die "openssl est requis pour exporter le certificat public."
  local raw certificate attempt
  raw="$(mktemp "$ALLUMI_DIR/.local-https-ca.raw.XXXXXX")"
  certificate="$(mktemp "$ALLUMI_DIR/.local-https-ca.public.XXXXXX")"
  for ((attempt=0; attempt<30; attempt++)); do
    if compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$raw" 2>/dev/null && openssl x509 -in "$raw" -out "$certificate" 2>/dev/null; then
      chmod 0644 "$certificate"
      # Replace the directory entry itself, never a symlink's target.
      if ! mv -Tf "$certificate" "$ALLUMI_DIR/local-https-root.crt"; then
        rm -f "$raw" "$certificate"
        die "Le certificat public ne peut pas remplacer ce chemin de destination."
      fi
      rm -f "$raw"
      info "Certificat racine public : $ALLUMI_DIR/local-https-root.crt"
      openssl x509 -in "$ALLUMI_DIR/local-https-root.crt" -noout -fingerprint -sha256
      info "SHA-256 du fichier public (vérification du transfert) :"
      openssl dgst -sha256 "$ALLUMI_DIR/local-https-root.crt"
      return 0
    fi
    sleep 1
  done
  rm -f "$raw" "$certificate"
  die "Le certificat public n’est pas encore disponible. Réessaie --export-ca après le démarrage de Caddy."
}

if [ "$mode" = check ]; then
  isolate_deployment_env
  check_compose
  exit 0
elif [ "$mode" = export-ca ]; then
  isolate_deployment_env
  check_compose
  export_ca
  exit 0
fi

if [ "$mode" = start ]; then
  command -v openssl >/dev/null || die "openssl est requis pour exporter le certificat public."
  command -v curl >/dev/null || die "curl est requis pour vérifier HTTPS."
fi
original_env="$ENV_FILE"
temporary="$(mktemp "${ENV_FILE}.local-https.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
cp "$ENV_FILE" "$temporary"
chmod 0600 "$temporary"
ENV_FILE="$temporary"
env_set ALLUMI_NETWORK_MODE local-https
env_set ALLUMI_TLS_HOST "$host"
env_set ALLUMI_HTTP_PORT "$port"
env_set APP_URL "https://$host:$port"
env_set TRUSTED_PROXY_HOPS 1
compose_files=docker-compose.yml:compose.https.yaml
[ ! -e "$ALLUMI_DIR/compose.override.yaml" ] || compose_files="$compose_files:compose.override.yaml"
env_set COMPOSE_FILE "$compose_files"
if [ "$mode" != prepare-only ]; then
  isolate_deployment_env
  check_compose
fi
mv -Tf "$temporary" "$original_env"
trap - EXIT
ENV_FILE="$original_env"
if [ "$mode" = prepare-only ]; then
  info "HTTPS local préparé : https://$host:$port (aucun service démarré)."
  exit 0
fi
compose up -d --no-build --remove-orphans
for _ in $(seq 1 60); do
  app_id="$(compose ps -q app)"
  health="$(docker inspect -f '{{.State.Health.Status}}' "$app_id" 2>/dev/null || true)"
  [ "$health" != healthy ] || break
  sleep 2
done
[ "${health:-}" = healthy ] || die "l’application n’est pas healthy; consulte docker compose logs."
export_ca
command -v curl >/dev/null || die "curl est requis pour vérifier HTTPS."
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 5 --cacert "$ALLUMI_DIR/local-https-root.crt" "https://$host:$port/api/health" >/dev/null 2>&1; then
    info "HTTPS local actif : https://$host:$port. Approuve le certificat racine sur chaque appareil client."
    exit 0
  fi
  sleep 1
done
die "La vérification HTTPS avec le certificat racine a échoué."

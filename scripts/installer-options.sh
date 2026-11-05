#!/usr/bin/env bash
# Validation and terminal wizard for install-docker.sh; no host or configuration writes.
valid_url() {
  local host port
  [[ "$1" =~ ^https?://([A-Za-z0-9.-]+)(:([0-9]+))?$ ]] || return 1
  host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[3]}"
  [[ "$host" =~ ^[0-9.]+$ ]] && { valid_bind "$host" || return 1; }
  [[ "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || return 1
  [[ "$host" != *..* ]] || return 1
  [ -z "$port" ] || valid_port "$port"
}
valid_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$1" -le 65535 ]; }
valid_timeout() { [[ "$1" =~ ^[1-9][0-9]{0,3}$ ]] && [ "$1" -le 3600 ]; }
valid_locale() { [[ "$1" == fr-CA || "$1" == en ]]; }
valid_choice() { [[ "$1" == 1 || "$1" == 2 ]]; }
resolve_install_transport() {
  local address port
  if [ "$TRANSPORT_EXPLICIT" = 0 ]; then
    LOCAL_HTTPS=0
    if { [ ! -f "$ENV_FILE" ] || [ "$URL_EXPLICIT" = 1 ] || [ "$(env_get ALLUMI_NETWORK_MODE)" = local-https ]; } && [[ "$INSTALL_URL" =~ ^https://([0-9.]+)(:([0-9]+))?$ ]] && valid_bind "${BASH_REMATCH[1]}"; then LOCAL_HTTPS=1; fi
  fi
  if [ "$LOCAL_HTTPS" = 1 ]; then
    [[ "$INSTALL_URL" =~ ^https://([0-9.]+)(:([0-9]+))?$ ]] || die "HTTPS local exige une URL https://IPv4:port; exemple https://192.168.1.20:28080."
    address="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[3]}"
    valid_bind "$address" || die "adresse IPv4 invalide pour HTTPS local."
    if [ -n "$port" ] && [ "$PORT_EXPLICIT" = 0 ]; then INSTALL_HTTP_PORT="$port"; fi
    [ -z "$port" ] || [ "$port" = "$INSTALL_HTTP_PORT" ] || die "le port de l’URL HTTPS locale doit correspondre à --http-port."
    INSTALL_URL="https://$address:$INSTALL_HTTP_PORT"
  elif [ "$TRANSPORT_EXPLICIT" = 1 ]; then
    [[ "$INSTALL_URL" == http://* ]] || die "--http exige une URL http://."
  fi
}
valid_bind() {
  local part
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local -a parts
  IFS=. read -r -a parts <<< "$1"
  for part in "${parts[@]}"; do
    [[ "$part" == 0 || "$part" =~ ^[1-9][0-9]{0,2}$ ]] && [ "$part" -le 255 ] || return 1
  done
}
installer_ask() {
  local variable="$1" label="$2" validator="$3" fallback="$4" answer
  "$validator" "$fallback" || fallback=""
  while :; do
    printf '%s%s : ' "$label" "${fallback:+ [$fallback]}" >&2
    IFS= read -r answer || die "saisie interrompue; aucune configuration modifiée."
    answer="${answer:-$fallback}"
    if "$validator" "$answer"; then printf -v "$variable" '%s' "$answer"; return; fi
    printf 'Valeur invalide, réessaie.\n' >&2
  done
}
installer_wizard() {
  local choice=1 mode=1 confirmation action_label previous_url="$INSTALL_URL"
  printf "\n  ALLUMI — Assistant d’installation Docker\n\n" >&2
  printf "Docker Engine et Compose doivent déjà être installés.\nLes données et secrets existants seront conservés. Ctrl+C pour quitter.\n\n1) Installation standard (réglages existants ou port web 28080)\n2) Options avancées (ports, adresse d’écoute, délai)\n" >&2
  installer_ask choice 'Parcours (1 ou 2)' valid_choice 1
  installer_ask INSTALL_URL 'Adresse web (HTTPS local : https://192.168.1.20:28080)' valid_url "$INSTALL_URL"
  [ "$previous_url" = "$INSTALL_URL" ] || URL_EXPLICIT=1
  installer_ask INSTALL_LOCALE 'Langue initiale (fr-CA ou en)' valid_locale "$INSTALL_LOCALE"
  if ! valid_bind "$INSTALL_BIND" || ! valid_port "$INSTALL_HTTP_PORT" || ! valid_timeout "$WAIT_SECONDS"; then
    printf 'Des réglages réseau sont invalides; passage aux options avancées.\n' >&2
    choice=2
  fi
  if [ "$choice" = 2 ]; then
    installer_ask INSTALL_BIND "Adresse IPv4 d’écoute (0.0.0.0 = toutes les interfaces)" valid_bind "$INSTALL_BIND"
    installer_ask INSTALL_HTTP_PORT "Port web sur l’hôte (1–65535)" valid_port "$INSTALL_HTTP_PORT"
    installer_ask WAIT_SECONDS 'Délai de santé après démarrage Compose (1–3600 secondes)' valid_timeout "$WAIT_SECONDS"
  fi
  [ "$PREPARE_ONLY" -eq 0 ] || mode=2
  printf '\n1) Configurer et démarrer Docker\n2) Préparer .env uniquement\n' >&2
  installer_ask mode 'Action (1 ou 2)' valid_choice "$mode"
  PREPARE_ONLY=$((mode - 1))
  action_label="Configurer et démarrer Docker"
  [ "$PREPARE_ONLY" -eq 0 ] || action_label="Préparer .env uniquement"
  resolve_install_transport
  printf '\nRésumé\n  Adresse : %s\n  Écoute : %s — HTTP %s (TCP)\n  Langue initiale : %s\n  Délai : %s s\n  Action : %s\n' "$INSTALL_URL" "$INSTALL_BIND" "$INSTALL_HTTP_PORT" "$INSTALL_LOCALE" "$WAIT_SECONDS" "$action_label" >&2
  if [ "$WEB_UPDATES" -eq 1 ]; then
    printf '  Mises à jour web : activation automatique avec droits administrateur et systemd actif\n' >&2
  else
    printf '  Mises à jour web : activation désactivée (--no-web-updates)\n' >&2
  fi
  if [ "$LOCAL_HTTPS" = 1 ]; then
    printf '\nHTTPS local avec certificat interne : approuver la CA sur chaque appareil.\nSeul le port HTTPS choisi est exposé; application et PostgreSQL restent privés.\n' >&2
  else
    printf '\nHTTP direct ou HTTPS fourni par votre proxy externe.\n' >&2
  fi
  printf "L’URL doit correspondre à celle utilisée dans le navigateur.\nAucun routage Proxmox modifié. Sauvegardes à configurer.\n\n" >&2
  printf 'Appliquer cette configuration ? [o/N] : ' >&2
  IFS= read -r confirmation || die "saisie interrompue; aucune configuration modifiée."
  case "$confirmation" in o|O|oui|Oui|y|Y|yes) ;; *) printf 'Installation annulée. Aucun changement.\n' >&2; exit 130 ;; esac
}

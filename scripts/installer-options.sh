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
  local choice=1 mode=1 confirmation action_label
  printf "\n  ALLUMI — Assistant d’installation Docker\n\n" >&2
  printf "Docker Engine et Compose doivent déjà être installés.\nLes données et secrets existants seront conservés. Ctrl+C pour quitter.\n\n1) Installation standard (réglages existants ou port HTTP 28080)\n2) Options avancées (ports, adresse d’écoute, délai)\n" >&2
  installer_ask choice 'Parcours (1 ou 2)' valid_choice 1
  installer_ask INSTALL_URL 'Adresse web (ex. http://192.168.1.20:28080)' valid_url "$INSTALL_URL"
  installer_ask INSTALL_LOCALE 'Langue initiale (fr-CA ou en)' valid_locale "$INSTALL_LOCALE"
  if ! valid_bind "$INSTALL_BIND" || ! valid_port "$INSTALL_HTTP_PORT" || ! valid_timeout "$WAIT_SECONDS"; then
    printf 'Des réglages réseau sont invalides; passage aux options avancées.\n' >&2
    choice=2
  fi
  if [ "$choice" = 2 ]; then
    installer_ask INSTALL_BIND "Adresse IPv4 d’écoute (0.0.0.0 = toutes les interfaces)" valid_bind "$INSTALL_BIND"
    installer_ask INSTALL_HTTP_PORT "Port HTTP sur l’hôte (1–65535)" valid_port "$INSTALL_HTTP_PORT"
    installer_ask WAIT_SECONDS 'Délai de santé après démarrage Compose (1–3600 secondes)' valid_timeout "$WAIT_SECONDS"
  fi
  [ "$PREPARE_ONLY" -eq 0 ] || mode=2
  printf '\n1) Configurer et démarrer Docker\n2) Préparer .env uniquement\n' >&2
  installer_ask mode 'Action (1 ou 2)' valid_choice "$mode"
  PREPARE_ONLY=$((mode - 1))
  action_label="Configurer et démarrer Docker"
  [ "$PREPARE_ONLY" -eq 0 ] || action_label="Préparer .env uniquement"
  printf '\nRésumé\n  Adresse : %s\n  Écoute : %s — HTTP %s (TCP)\n  Langue initiale : %s\n  Délai : %s s\n  Action : %s\n' "$INSTALL_URL" "$INSTALL_BIND" "$INSTALL_HTTP_PORT" "$INSTALL_LOCALE" "$WAIT_SECONDS" "$action_label" >&2
  printf "\nApplication + PostgreSQL privé; aucun certificat ni proxy intégré.\nL’URL doit correspondre à celle utilisée dans le navigateur.\nHTTP convient au réseau de test privé; votre proxy peut fournir HTTPS.\nAucun pare-feu ni routage Proxmox modifié. Sauvegardes à configurer.\n\n" >&2
  printf 'Appliquer cette configuration ? [o/N] : ' >&2
  IFS= read -r confirmation || die "saisie interrompue; aucune configuration modifiée."
  case "$confirmation" in o|O|oui|Oui|y|Y|yes) ;; *) printf 'Installation annulée. Aucun changement.\n' >&2; exit 130 ;; esac
}

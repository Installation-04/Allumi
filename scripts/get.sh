#!/bin/sh
# Allumi — installation en une commande : détecte le système, le processeur et les prérequis, récupère
# la version demandée, puis confie le travail à l'installateur qui convient.
#
#   curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --check
#   curl -fsSL .../get.sh | sh -s -- --version v0.4.0-alpha.10 -- --app-url http://192.168.1.20:28080
#
# POSIX sh : ce script est lu depuis un tube, donc sans Bash. Les installateurs qu'il lance utilisent Bash.
# Rien n'est modifié avant la confirmation (--yes pour la sauter). --check n'écrit rien du tout.
set -eu

REPO_URL="${ALLUMI_REPO_URL:-https://github.com/Installation-04/Allumi.git}" # surchargé seulement par les tests
MIN_RAM_MB=2048
MIN_DISK_MB=5120

# Points d'entrée pour les tests : fichiers lus à la place de ceux de l'hôte.
OS_RELEASE="${ALLUMI_OS_RELEASE:-/etc/os-release}"
MEMINFO="${ALLUMI_MEMINFO:-/proc/meminfo}"
CPUINFO="${ALLUMI_CPUINFO:-/proc/cpuinfo}"
PROC_VERSION="${ALLUMI_PROC_VERSION:-/proc/version}"

if [ -t 1 ]; then
  c_red=$(printf '\033[31m'); c_grn=$(printf '\033[32m'); c_ylw=$(printf '\033[33m'); c_off=$(printf '\033[0m')
else
  c_red=""; c_grn=""; c_ylw=""; c_off=""
fi
info() { printf '%s[allumi]%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s[allumi]%s %s\n' "$c_ylw" "$c_off" "$*" >&2; }
die()  { printf '%s[allumi] erreur :%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage : get.sh [options] [-- arguments de l'installateur]

  --check            détecte et affiche le rapport, sans rien modifier ni télécharger
  --version TAG      version à installer (défaut : la plus récente, préversions comprises)
  --branch NOM       installe une branche (essais seulement; la production utilise une version)
  --dir CHEMIN       dossier du dépôt (défaut : /opt/allumi, ou ~/allumi sans droits administrateur)
  --docker-only      Docker déjà installé : lance install-docker.sh, sans pare-feu ni sauvegardes planifiées
  --yes              ne demande pas de confirmation avant d'agir
  --force            continue malgré un système non testé
  -h, --help         cette aide

Les arguments après « -- » vont à l'installateur (ex. --app-url http://192.168.1.20:28080, --prepare-only).
EOF
}

CHECK=0; VERSION=""; BRANCH=""; DIR="${ALLUMI_DIR:-}"; DOCKER_ONLY=0; YES=0; FORCE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --version) [ "$#" -ge 2 ] || die "--version demande une valeur."; VERSION="$2"; shift ;;
    --branch) [ "$#" -ge 2 ] || die "--branch demande une valeur."; BRANCH="$2"; shift ;;
    --dir) [ "$#" -ge 2 ] || die "--dir demande une valeur."; DIR="$2"; shift ;;
    --docker-only) DOCKER_ONLY=1 ;;
    --yes|-y) YES=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *) usage >&2; die "option inconnue : $1" ;;
  esac
  shift
done
[ -z "$VERSION" ] || [ -z "$BRANCH" ] || die "--version et --branch s'excluent."
case "$VERSION" in ""|v[0-9]*) ;; *) die "--version attend une étiquette comme v0.4.0-alpha.10." ;; esac

have() { command -v "$1" >/dev/null 2>&1; }

# ---- Détection ---------------------------------------------------------------------------------------------

KERNEL="$(uname -s 2>/dev/null || echo inconnu)"
ARCH_RAW="$(uname -m 2>/dev/null || echo inconnu)"

case "$KERNEL" in
  Linux) FAMILY=linux ;;
  Darwin) FAMILY=macos ;;
  MINGW*|MSYS*|CYGWIN*) FAMILY=windows ;;
  FreeBSD|OpenBSD|NetBSD|DragonFly) FAMILY=bsd ;;
  *) FAMILY=autre ;;
esac

# Les images Docker d'Allumi sont construites pour AMD64 et ARM64 seulement.
case "$ARCH_RAW" in
  x86_64|amd64|x64) ARCH=amd64; ARCH_OK=1 ;;
  aarch64|arm64|armv8*) ARCH=arm64; ARCH_OK=1 ;;
  *) ARCH="$ARCH_RAW"; ARCH_OK=0 ;;
esac

DISTRO_ID=""; DISTRO_LIKE=""; DISTRO_NAME=""; DISTRO_VERSION=""
if [ "$FAMILY" = linux ] && [ -r "$OS_RELEASE" ]; then
  # Lu par extraction, jamais par « . » : le fichier d'un hôte ne s'exécute pas.
  osr() { sed -n "s/^$1=//p" "$OS_RELEASE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
  DISTRO_ID="$(osr ID)"; DISTRO_LIKE="$(osr ID_LIKE)"; DISTRO_NAME="$(osr PRETTY_NAME)"; DISTRO_VERSION="$(osr VERSION_ID)"
elif [ "$FAMILY" = macos ] && have sw_vers; then
  DISTRO_NAME="macOS $(sw_vers -productVersion 2>/dev/null || true)"
fi
[ -n "$DISTRO_NAME" ] || DISTRO_NAME="$KERNEL"

DEBIAN_FAMILY=0
case " $DISTRO_ID $DISTRO_LIKE " in *" debian "*|*" ubuntu "*) DEBIAN_FAMILY=1 ;; esac

WSL=0
if [ "$FAMILY" = linux ] && [ -r "$PROC_VERSION" ] && grep -qi microsoft "$PROC_VERSION" 2>/dev/null; then WSL=1; fi

CPU_MODEL=""; CPU_CORES=""; RAM_MB=""
case "$FAMILY" in
  linux)
    if [ -r "$CPUINFO" ]; then
      CPU_MODEL="$(sed -n -e 's/^model name[[:space:]]*:[[:space:]]*//p' -e 's/^Model[[:space:]]*:[[:space:]]*//p' -e 's/^Hardware[[:space:]]*:[[:space:]]*//p' "$CPUINFO" | head -n 1)"
    fi
    CPU_CORES="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
    if [ -r "$MEMINFO" ]; then RAM_MB="$(awk '/^MemTotal:/ {printf "%d", $2/1024}' "$MEMINFO")"; fi
    ;;
  macos)
    CPU_MODEL="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)"
    CPU_CORES="$(sysctl -n hw.ncpu 2>/dev/null || true)"
    RAM_B="$(sysctl -n hw.memsize 2>/dev/null || true)"
    [ -z "$RAM_B" ] || RAM_MB=$((RAM_B / 1048576))
    ;;
esac

VIRT=""
if [ "$FAMILY" = linux ]; then
  VIRT="$(systemd-detect-virt 2>/dev/null || true)"
  [ "$VIRT" != none ] || VIRT=""
  if [ -z "$VIRT" ] && [ -r /proc/1/environ ] && tr '\0' '\n' < /proc/1/environ 2>/dev/null | grep -q '^container=lxc'; then VIRT=lxc; fi
fi

if [ "$(id -u 2>/dev/null || echo 1)" -eq 0 ]; then IS_ROOT=1; else IS_ROOT=0; fi
CAN_SUDO=0
if [ "$IS_ROOT" -eq 0 ] && have sudo; then CAN_SUDO=1; fi

# Dossier d'installation : le clone qui contient ce script, sinon /opt/allumi (droits) ou ~/allumi.
SELF_DIR=""
case "$0" in
  get.sh|*/get.sh) SELF_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)" ;;
esac
IN_CLONE=0
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/docker-compose.yml" ] && [ -f "$SELF_DIR/scripts/install-docker.sh" ]; then
  IN_CLONE=1
  [ -z "$DIR" ] || [ "$DIR" = "$SELF_DIR" ] || warn "exécuté depuis un clone : --dir est ignoré, on utilise $SELF_DIR."
  DIR="$SELF_DIR"
fi
if [ -z "$DIR" ]; then
  if [ "$IS_ROOT" -eq 1 ] || [ "$CAN_SUDO" -eq 1 ]; then DIR=/opt/allumi; else DIR="${HOME:-.}/allumi"; fi
fi

HAVE_DOCKER=0; DOCKER_ACCESS=""; HAVE_COMPOSE=0; OLD_CADDY=""
if have docker; then
  HAVE_DOCKER=1
  if docker info >/dev/null 2>&1; then
    DOCKER_ACCESS=oui
    docker compose version >/dev/null 2>&1 && HAVE_COMPOSE=1
    OLD_CADDY="$(docker ps -a --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null | grep -i caddy || true)"
  else
    DOCKER_ACCESS=non
    docker compose version >/dev/null 2>&1 && HAVE_COMPOSE=1
  fi
fi

DISK_MB=""
probe_dir="$DIR"
while [ ! -d "$probe_dir" ] && [ "$probe_dir" != / ] && [ "$probe_dir" != . ]; do probe_dir="$(dirname "$probe_dir")"; done
DISK_MB="$(df -Pk "$probe_dir" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024}' || true)"

EXISTING=0
[ ! -f "$DIR/.env" ] || EXISTING=1

# ---- Verdict : quel installateur, ou pourquoi aucun --------------------------------------------------------

INSTALLER=""; BLOCKER=""; NOTES=""
note() { NOTES="${NOTES}  - $*
"; }

case "$FAMILY" in
  windows)
    BLOCKER="Windows : le serveur Allumi tourne sous Linux. Installe-le dans une VM Linux ou dans WSL 2 (relance ce script là), puis utilise le client Windows pour t'y connecter." ;;
  bsd|autre)
    BLOCKER="Système non pris en charge ($KERNEL). Allumi se déploie avec Docker sous Linux." ;;
esac
if [ -z "$BLOCKER" ] && [ "$ARCH_OK" -eq 0 ]; then
  BLOCKER="Processeur $ARCH_RAW non pris en charge : les images d'Allumi sont construites pour AMD64 (x86_64) et ARM64 (aarch64)."
fi

if [ -z "$BLOCKER" ]; then
  case "$FAMILY" in
    linux)
      if [ "$DOCKER_ONLY" -eq 1 ]; then
        INSTALLER=install-docker.sh
      elif [ "$DEBIAN_FAMILY" -eq 1 ]; then
        INSTALLER=install.sh
      elif [ "$HAVE_DOCKER" -eq 1 ]; then
        INSTALLER=install-docker.sh
        note "Distribution non testée pour l'installateur complet : on utilise install-docker.sh (Docker déjà présent)."
      else
        BLOCKER="Docker est absent et ${DISTRO_NAME} n'est pas Debian/Ubuntu. Installe Docker Engine et le plugin Compose (https://docs.docker.com/engine/install/), puis relance ce script."
      fi
      if [ -z "$BLOCKER" ] && [ "$INSTALLER" = install-docker.sh ]; then
        [ "$HAVE_DOCKER" -eq 1 ] || BLOCKER="--docker-only demande Docker déjà installé, et il est introuvable."
        [ -n "$BLOCKER" ] || [ "$HAVE_COMPOSE" -eq 1 ] || BLOCKER="Le plugin « docker compose » (Compose v2) est introuvable."
      fi
      ;;
    macos)
      if [ "$HAVE_DOCKER" -eq 1 ] && [ "$HAVE_COMPOSE" -eq 1 ]; then
        INSTALLER=install-docker.sh
        note "macOS n'est pas testé : réservé aux essais (Docker Desktop ou OrbStack)."
        [ "$FORCE" -eq 1 ] || BLOCKER="macOS n'est pas testé. Relance avec --force pour essayer quand même."
      else
        BLOCKER="Installe Docker Desktop (ou OrbStack), puis relance ce script. macOS reste réservé aux essais."
      fi
      ;;
  esac
fi

if [ -z "$BLOCKER" ] && [ "$FAMILY" = linux ] && [ "$DEBIAN_FAMILY" -eq 0 ] && [ "$FORCE" -eq 0 ] && [ "$INSTALLER" = install-docker.sh ] && [ "$DOCKER_ONLY" -eq 0 ]; then
  BLOCKER="${DISTRO_NAME} n'est pas testé. Relance avec --force pour continuer avec install-docker.sh."
fi

# Avertissements (n'empêchent rien).
[ -z "$RAM_MB" ] || [ "$RAM_MB" -ge "$MIN_RAM_MB" ] || note "Mémoire faible (${RAM_MB} Mo) : prévois au moins ${MIN_RAM_MB} Mo."
[ -z "$DISK_MB" ] || [ "$DISK_MB" -ge "$MIN_DISK_MB" ] || note "Espace libre faible (${DISK_MB} Mo) : prévois au moins ${MIN_DISK_MB} Mo pour les images et la base."
[ "$VIRT" != lxc ] || note "Conteneur LXC détecté : Docker y demande « nesting » et « keyctl ». Une VM dédiée est plus simple (voir la page Proxmox)."
[ "$WSL" -eq 0 ] || note "WSL détecté : Docker Desktop (intégration WSL) ou Docker Engine dans la distribution est requis."
if [ "$HAVE_DOCKER" -eq 1 ] && [ "$DOCKER_ACCESS" != oui ]; then
  if [ "$IS_ROOT" -eq 1 ]; then
    note "Docker est installé mais ne répond pas (service arrêté ?) : démarre-le avec « systemctl start docker »."
  else
    note "Docker est installé mais inaccessible pour cet utilisateur : l'installation passera par sudo."
  fi
fi
[ -z "$OLD_CADDY" ] || note "Ancien conteneur Caddy trouvé ($OLD_CADDY). Depuis v0.4.0-alpha.10 il n'y a plus de proxy intégré; s'il survit à l'installation, retire-le avec « docker rm -f NOM » (jamais « docker compose down -v »)."
[ "$EXISTING" -eq 0 ] || note "Installation existante dans $DIR : secrets, volumes et ports sont conservés. APP_URL n'est jamais réécrit en silence."
[ "$IS_ROOT" -eq 1 ] || [ "$CAN_SUDO" -eq 1 ] || [ "$INSTALLER" != install.sh ] || BLOCKER="${BLOCKER:-Il faut les droits administrateur (root ou sudo) pour install.sh.}"

# ---- Rapport -----------------------------------------------------------------------------------------------

if [ "$IS_ROOT" -eq 1 ]; then RIGHTS="root"
elif [ "$CAN_SUDO" -eq 1 ]; then RIGHTS="sudo disponible"
else RIGHTS="utilisateur simple, sans sudo"
fi

yn() { if [ "$1" -eq 1 ]; then printf oui; else printf non; fi; }
cat <<EOF

  Système        : ${DISTRO_NAME}${DISTRO_VERSION:+ ($DISTRO_VERSION)} — noyau ${KERNEL}$( [ "$WSL" -eq 0 ] || printf ', WSL')
  Processeur     : ${ARCH_RAW}$( [ "$ARCH_RAW" = "$ARCH" ] || printf ' → %s' "$ARCH" )${CPU_MODEL:+ — $CPU_MODEL}${CPU_CORES:+ ($CPU_CORES cœurs)}
  Mémoire        : ${RAM_MB:-inconnue}${RAM_MB:+ Mo}   Disque libre : ${DISK_MB:-inconnu}${DISK_MB:+ Mo}
  Virtualisation : ${VIRT:-aucune détectée}
  Droits         : ${RIGHTS}
  Docker         : $( [ "$HAVE_DOCKER" -eq 1 ] && printf 'installé (accès : %s, compose v2 : %s)' "$DOCKER_ACCESS" "$(yn "$HAVE_COMPOSE")" || printf 'absent' )
  Dossier        : ${DIR}$( [ "$EXISTING" -eq 0 ] || printf ' (installation existante)' )
EOF
if [ -n "$NOTES" ]; then printf '\nÀ savoir :\n%s' "$NOTES"; fi
printf '\n'

if [ -n "$BLOCKER" ]; then
  warn "$BLOCKER"
  [ "$CHECK" -eq 1 ] || exit 1
  exit 2
fi
if [ "$INSTALLER" = install.sh ]; then
  PLAN="scripts/install.sh : installe Docker au besoin (dépôt officiel), configure Allumi, active le pare-feu ufw (SSH + port HTTP) et planifie les sauvegardes quotidiennes."
else
  PLAN="scripts/install-docker.sh : configure et démarre Allumi avec le Docker existant. Aucun paquet, pare-feu ni tâche planifiée n'est modifié."
fi
info "Installateur retenu : ${PLAN}"

if [ "$CHECK" -eq 1 ]; then
  info "Vérification seulement : rien n'a été modifié ni téléchargé."
  exit 0
fi

# ---- Confirmation, récupération du code, passage de relais --------------------------------------------------

# Lu depuis le terminal : l'entrée standard est ce script quand il arrive par « curl | sh ».
TTY_OK=0
if (: </dev/tty) 2>/dev/null; then TTY_OK=1; fi
if [ "$YES" -eq 0 ]; then
  [ "$TTY_OK" -eq 1 ] || die "pas de terminal pour confirmer. Relance avec --yes, ou télécharge le script puis exécute-le."
  printf 'Continuer ? [o/N] : '
  IFS= read -r answer </dev/tty || die "saisie interrompue; rien n'a été modifié."
  case "$answer" in o|O|oui|Oui|y|Y|yes) ;; *) info "Annulé; rien n'a été modifié."; exit 0 ;; esac
fi

SUDO=""
if [ "$IS_ROOT" -eq 0 ] && { [ "$INSTALLER" = install.sh ] || [ "$DOCKER_ACCESS" = non ]; }; then SUDO="sudo"; fi
# Un dossier sous /opt demande les droits d'écriture même quand l'installateur n'en demande pas.
PARENT="$(dirname "$DIR")"
if [ "$IN_CLONE" -eq 0 ] && [ "$IS_ROOT" -eq 0 ] && [ ! -w "$PARENT" ] && [ ! -d "$DIR" ]; then
  [ "$CAN_SUDO" -eq 1 ] || die "$PARENT n'est pas accessible en écriture et sudo est absent. Utilise --dir avec un dossier à toi."
  SUDO="sudo"
fi

if [ "$IN_CLONE" -eq 0 ]; then
  if ! have git; then
    if [ "$DEBIAN_FAMILY" -eq 1 ] && { [ "$IS_ROOT" -eq 1 ] || [ "$CAN_SUDO" -eq 1 ]; }; then
      info "Installation de git et des certificats (apt)…"
      ${SUDO:-} apt-get update -y >/dev/null
      ${SUDO:-} apt-get install -y git ca-certificates >/dev/null
    else
      die "git est requis. Installe-le avec le gestionnaire de paquets de ${DISTRO_NAME}, puis relance."
    fi
  fi
  if [ -z "$VERSION" ] && [ -z "$BRANCH" ]; then
    info "Recherche de la version la plus récente…"
    VERSION="$(git -c versionsort.suffix=- ls-remote --tags --refs --sort=-v:refname "$REPO_URL" 'v[0-9]*' | sed -n '1s#.*refs/tags/##p')" \
      || die "impossible de joindre $REPO_URL."
    [ -n "$VERSION" ] || die "aucune version publiée trouvée. Utilise --branch main pour un essai."
  fi
  REF="${VERSION:-$BRANCH}"
  if [ -d "$DIR/.git" ]; then
    [ -z "$(git -C "$DIR" status --porcelain)" ] || die "$DIR contient des modifications locales; je n'y touche pas."
    info "Mise à jour du dépôt $DIR vers $REF…"
    ${SUDO:-} git -C "$DIR" fetch --tags --quiet origin
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "$DIR existe et n'est pas un dépôt Allumi. Choisis un autre dossier avec --dir."
  else
    info "Clonage de $REPO_URL dans $DIR…"
    ${SUDO:-} mkdir -p "$PARENT"
    ${SUDO:-} git clone --quiet "$REPO_URL" "$DIR"
  fi
  if [ -n "$BRANCH" ]; then
    ${SUDO:-} git -C "$DIR" checkout --quiet "$BRANCH"
    ${SUDO:-} git -C "$DIR" pull --quiet --ff-only origin "$BRANCH" || warn "branche non mise à jour (modifications divergentes)."
  else
    ${SUDO:-} git -C "$DIR" checkout --quiet "$VERSION" || die "version $VERSION introuvable."
  fi
  info "Version : $(git -C "$DIR" describe --tags --always 2>/dev/null || echo "$REF")"
else
  [ -z "$VERSION$BRANCH" ] || warn "exécuté depuis un clone existant : --version/--branch sont ignorés (le dépôt n'est pas modifié)."
fi

[ -f "$DIR/scripts/$INSTALLER" ] || die "$DIR/scripts/$INSTALLER est introuvable : cette version ne contient pas l'installateur attendu."
have bash || die "bash est requis par l'installateur."

info "Lancement de scripts/$INSTALLER…"
# Les installateurs posent leurs questions sur le terminal, pas sur ce script.
if [ "$TTY_OK" -eq 1 ]; then
  # shellcheck disable=SC2086  # SUDO est vide ou le mot « sudo »
  exec $SUDO env ALLUMI_DIR="$DIR" bash "$DIR/scripts/$INSTALLER" "$@" </dev/tty
fi
# shellcheck disable=SC2086
exec $SUDO env ALLUMI_DIR="$DIR" bash "$DIR/scripts/$INSTALLER" "$@"

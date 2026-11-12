#!/usr/bin/env bash
# Levanta Phantom Workspace.
#
#   scripts/up.sh            modo dev: Vite (127.0.0.1:4178, HMR) + Electron desde la fuente
#   scripts/up.sh source     compila el renderer (vite build) y abre Electron desde la fuente
#   scripts/up.sh app        abre el ejecutable empaquetado en out/ (o la fuente si no existe)
#   scripts/up.sh build      reconstruye el empaquetado (npm run build:latest) y lo abre
#
# Opciones:
#   --install   fuerza `npm ci` antes de arrancar
#   -h, --help  muestra esta ayuda
#
# Argumentos tras `--` se pasan a Electron/ejecutable (modos source y app).
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
APP="$ROOT/out/Phantom Workspace-linux-x64/phantom-workspace"
MODE="dev"
FORCE_INSTALL=0
EXTRA=()

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
log()   { printf '\033[1;35m[phantom]\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m[phantom]\033[0m %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    dev|source|app|build) MODE="$1" ;;
    --install) FORCE_INSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) die "Argumento desconocido: $1 (usa --help)" ;;
  esac
  shift
done

cd "$ROOT"

check_node() {
  command -v node >/dev/null || die "Node no está en el PATH (se requiere >= 24)."
  command -v npm  >/dev/null || die "npm no está en el PATH."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  ((major >= 24)) || die "Node $(node -v) detectado; se requiere >= 24."
}

ensure_deps() {
  # Reinstala si se pide, si falta node_modules o si el lock es más nuevo que la última instalación.
  if ((FORCE_INSTALL)) || [[ ! -x node_modules/.bin/electron || ! -x node_modules/.bin/vite ]] \
     || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
    log "Instalando dependencias (npm ci)…"
    npm ci --include=dev --no-audit --no-fund
  fi
}

# Electron no debe arrancar como Node puro si la variable viene heredada.
unset ELECTRON_RUN_AS_NODE

case "$MODE" in
  dev)
    check_node; ensure_deps
    if command -v ss >/dev/null && ss -ltn 'sport = :4178' | grep -q 4178; then
      die "El puerto 4178 (Vite) ya está en uso. ¿Hay otra instancia dev abierta?"
    fi
    log "Modo dev: Vite + Electron (Ctrl+C para salir)"
    exec npm run dev
    ;;
  source)
    check_node; ensure_deps
    log "Compilando renderer (vite build)…"
    npm run build
    log "Abriendo Electron desde la fuente"
    exec node_modules/.bin/electron "$ROOT" "${EXTRA[@]}"
    ;;
  app)
    if [[ -x "$APP" ]]; then
      log "Abriendo ejecutable empaquetado"
      exec "$APP" "${EXTRA[@]}"
    fi
    log "No hay empaquetado en out/; usando la fuente"
    check_node; ensure_deps
    [[ -f dist/index.html ]] || npm run build
    exec node_modules/.bin/electron "$ROOT" "${EXTRA[@]}"
    ;;
  build)
    check_node
    log "Reconstruyendo empaquetado (npm run build:latest)…"
    npm run build:latest
    [[ -x "$APP" ]] || die "El build terminó pero no se encontró $APP"
    log "Abriendo ejecutable empaquetado"
    exec "$APP" "${EXTRA[@]}"
    ;;
esac

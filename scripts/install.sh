#!/bin/sh
# PickForge installer: curl -fsSL https://pickforge.dev/pickforge/install.sh | sh
# Downloads the latest desktop bundle from GitHub Releases. Linux installs a
# rootless AppImage by default, with a FUSE-free launch fallback. Native .deb
# and .rpm packages are available through PICKFORGE_INSTALL_KIND.
set -eu

REPO="pickforge/pickforge"
APP_NAME="PickForge"
BIN_NAME="pickforge"
# The window's app_id (bundle identifier). The .desktop basename and
# StartupWMClass must equal it or the running window shows a generic icon.
APP_ID="dev.pickforge.app"

# Environment overrides:
#   PICKFORGE_INSTALL_DIR  Linux AppImage target dir. Default: $HOME/.local/bin.
#   PICKFORGE_INSTALL_KIND Linux install kind: auto, appimage, deb, or rpm.
#   PICKFORGE_VERSION      Install a specific release tag, such as v0.1.0.
#   GITHUB_TOKEN           Optional token for GitHub API rate limits.

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

preflight() {
  [ -n "${HOME:-}" ] || die "HOME is not set"

  if command -v curl >/dev/null 2>&1; then
    downloader="curl"
  elif command -v wget >/dev/null 2>&1; then
    downloader="wget"
  else
    die "curl or wget is required"
  fi
}

fetch_stdout() {
  fetch_url=$1
  accept="Accept: application/vnd.github+json"

  if [ -z "${GITHUB_TOKEN:-}" ]; then
    if [ "$downloader" = "curl" ]; then
      curl -fsSL -H "$accept" "$fetch_url"
    else
      wget -qO- --header="$accept" "$fetch_url"
    fi
    return
  fi

  # A token is set: never put it in argv (world-readable via `ps`). curl reads
  # its config from stdin, so no file touches disk. wget needs a file, so use a
  # private temp file removed even if the fetch is interrupted.
  if [ "$downloader" = "curl" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
      curl -fsSL -H "$accept" -K - "$fetch_url"
    return
  fi

  auth_conf=$(mktemp "${TMPDIR:-/tmp}/${BIN_NAME}-auth.XXXXXX") ||
    die "could not create a temporary file for the auth header"
  trap 'rm -f "$auth_conf"' EXIT INT TERM
  printf 'header = Authorization: Bearer %s\n' "$GITHUB_TOKEN" > "$auth_conf"
  fetch_status=0
  wget -qO- --config="$auth_conf" --header="$accept" "$fetch_url" || fetch_status=$?
  rm -f "$auth_conf"
  return "$fetch_status"
}

download_to() {
  download_url=$1
  download_dest=$2

  if [ "$downloader" = "curl" ]; then
    curl -fsSL "$download_url" -o "$download_dest"
  else
    wget -qO "$download_dest" "$download_url"
  fi
}

detect_platform() {
  os_name=$(uname -s)
  cpu_arch=$(uname -m)

  case "$os_name" in
    Linux)
      install_kind=""
      bundle_label="Linux bundle"
      ;;
    Darwin)
      install_kind="macapp"
      bundle_label="macOS .app"
      ;;
    *)
      die "The curl installer supports Linux and macOS. Download the Windows installer from https://github.com/${REPO}/releases"
      ;;
  esac

  case "$cpu_arch" in
    x86_64|amd64)
      arch_pattern="(amd64|x86_64|x64|intel)"
      ;;
    aarch64|arm64)
      arch_pattern="(aarch64|arm64|apple-silicon)"
      ;;
    *)
      die "unsupported CPU architecture: $cpu_arch"
      ;;
  esac
}

is_root() {
  [ "$(id -u 2>/dev/null || printf '1')" = "0" ]
}

can_request_root() {
  is_root || command -v sudo >/dev/null 2>&1
}

run_as_root() {
  if is_root; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 127
  fi
}

linux_candidate_kinds() {
  requested_kind="${PICKFORGE_INSTALL_KIND:-auto}"

  case "$requested_kind" in
    auto)
      printf 'appimage\n'
      ;;
    appimage|deb|rpm)
      printf '%s\n' "$requested_kind"
      ;;
    *)
      die "PICKFORGE_INSTALL_KIND must be auto, appimage, deb, or rpm"
      ;;
  esac
}

asset_kind_for_name() {
  case "$1" in
    *.AppImage)
      printf 'appimage\n'
      ;;
    *.deb)
      printf 'deb\n'
      ;;
    *.rpm)
      printf 'rpm\n'
      ;;
    *.app.tar.gz)
      printf 'macapp\n'
      ;;
    *)
      printf 'unknown\n'
      ;;
  esac
}

bundle_label_for_kind() {
  case "$1" in
    appimage)
      printf 'AppImage\n'
      ;;
    deb)
      printf '.deb package\n'
      ;;
    rpm)
      printf '.rpm package\n'
      ;;
    macapp)
      printf 'macOS .app\n'
      ;;
    *)
      printf 'bundle\n'
      ;;
  esac
}

release_api_url() {
  if [ -n "${PICKFORGE_RELEASE_API_URL:-}" ]; then
    printf '%s\n' "$PICKFORGE_RELEASE_API_URL"
  elif [ -n "${PICKFORGE_VERSION:-}" ]; then
    printf 'https://api.github.com/repos/%s/releases/tags/%s\n' "$REPO" "$PICKFORGE_VERSION"
  else
    printf 'https://api.github.com/repos/%s/releases/latest\n' "$REPO"
  fi
}

release_ref() {
  if [ -n "${PICKFORGE_VERSION:-}" ]; then
    printf '%s\n' "$PICKFORGE_VERSION"
  else
    printf 'latest\n'
  fi
}

resolve_release() {
  api_url=$(release_api_url)
  ref_name=$(release_ref)

  release_json=$(fetch_stdout "$api_url") || die "failed to fetch release metadata for $ref_name. If GitHub API rate limits you, set GITHUB_TOKEN."

  release_tag=$(printf '%s\n' "$release_json" |
    grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' |
    sed -n '1s/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [ -n "$release_tag" ] || release_tag=$ref_name

  download_urls=$(printf '%s\n' "$release_json" |
    grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' |
    sed 's/.*"\(https[^"]*\)".*/\1/')

  if [ -z "$download_urls" ]; then
    die "no release download assets found for $ref_name. If GitHub API rate limits you, set GITHUB_TOKEN. See https://github.com/${REPO}/releases"
  fi

  if [ "$os_name" = "Linux" ]; then
    candidate_kinds=$(linux_candidate_kinds)
  else
    candidate_kinds="macapp"
  fi

  asset_url=""
  for wanted_kind in $candidate_kinds; do
    asset_url=$(printf '%s\n' "$download_urls" | while IFS= read -r candidate_url; do
      candidate_name=${candidate_url##*/}
      candidate_kind=$(asset_kind_for_name "$candidate_name")

      if [ "$candidate_kind" = "$wanted_kind" ] &&
        printf '%s\n' "$candidate_name" | grep -Eiq "$arch_pattern"; then
        printf '%s\n' "$candidate_url"
        break
      fi
    done)

    if [ -n "$asset_url" ]; then
      install_kind=$wanted_kind
      bundle_label=$(bundle_label_for_kind "$wanted_kind")
      break
    fi
  done

  if [ -z "$asset_url" ]; then
    die "no compatible $bundle_label for $cpu_arch in $ref_name. See https://github.com/${REPO}/releases"
  fi
}

path_must_be_in_home() {
  checked_path=$1

  case "$checked_path" in
    *..*)
      die "install path must not contain '..': $checked_path"
      ;;
  esac
  case "$checked_path" in
    "$HOME"|"$HOME"/*)
      ;;
    *)
      die "install path must be inside HOME: $checked_path"
      ;;
  esac
}

make_tmp_dir() {
  tmp_parent="${TMPDIR:-$HOME/.cache}"

  case "$tmp_parent" in
    "$HOME"|"$HOME"/*)
      ;;
    *)
      tmp_parent="$HOME/.cache"
      ;;
  esac

  mkdir -p "$tmp_parent"
  tmp=$(mktemp -d "$tmp_parent/${BIN_NAME}-install.XXXXXX")
}

download_asset() {
  asset_name=${asset_url##*/}
  asset_path="$tmp/$asset_name"

  download_to "$asset_url" "$asset_path" || die "failed to download $asset_name"
  [ -s "$asset_path" ] || die "downloaded asset is empty: $asset_name"
}

verify_archive_paths() {
  archive_listing="$tmp/archive-listing.txt"

  tar -tzf "$asset_path" > "$archive_listing"
  while IFS= read -r archive_entry; do
    case "$archive_entry" in
      ""|/*|../*|*/../*|..)
        die "archive contains unsafe path: $archive_entry"
        ;;
    esac
  done < "$archive_listing"
}

desktop_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g; s/%/%%/g'
}

write_desktop_launcher() {
  launcher_command=$1
  launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  # Basename and StartupWMClass must equal the window's app_id so the desktop
  # environment ties the running window to this entry (and its icon).
  launcher_file="$launcher_dir/$APP_ID.desktop"

  mkdir -p "$launcher_dir" 2>/dev/null || return 0
  launcher_exec=$(desktop_escape "$launcher_command")
  {
    printf '[Desktop Entry]\n'
    printf 'Type=Application\n'
    printf 'Name=%s\n' "$APP_NAME"
    printf 'Comment=Shell-first workbench that drives AI coding CLIs and build tools\n'
    printf 'Exec="%s"\n' "$launcher_exec"
    printf 'Icon=%s\n' "$APP_ID"
    printf 'StartupWMClass=%s\n' "$APP_ID"
    printf 'Terminal=false\n'
    printf 'Categories=Development;IDE;\n'
    printf 'Keywords=pickforge;ai;agent;developer;flutter;android;\n'
    printf 'StartupNotify=true\n'
  } > "$launcher_file" 2>/dev/null || return 0
}

write_appimage_wrapper() {
  command_path=$1

  {
    printf '#!/bin/sh\n'
    printf '# PickForge AppImage launcher generated by the PickForge installer.\n'
    printf 'set -eu\n'
    printf 'script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1\n'
    printf 'appimage_path="$script_dir/%s.AppImage"\n' "$APP_NAME"
    printf 'if [ ! -x "$appimage_path" ]; then\n'
    printf '  printf '"'"'PickForge AppImage not found or not executable: %%s\\n'"'"' "$appimage_path" >&2\n'
    printf '  exit 127\n'
    printf 'fi\n'
    printf 'has_fuse2() {\n'
    printf '  if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q '"'"'libfuse[.]so[.]2'"'"'; then\n'
    printf '    return 0\n'
    printf '  fi\n'
    printf '  command -v fusermount >/dev/null 2>&1\n'
    printf '}\n'
    printf 'if has_fuse2; then\n'
    printf '  exec "$appimage_path" "$@"\n'
    printf 'fi\n'
    printf 'cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/pickforge/appimage-runtime"\n'
    printf 'mkdir -p "$cache_root" 2>/dev/null || cache_root="${TMPDIR:-/tmp}"\n'
    printf 'exec env APPIMAGE_EXTRACT_AND_RUN=1 TMPDIR="$cache_root" "$appimage_path" "$@"\n'
  } > "$command_path"
  chmod +x "$command_path"
}

ensure_replaceable_command_path() {
  command_path=$1

  if [ ! -e "$command_path" ] && [ ! -L "$command_path" ]; then
    return 0
  fi
  if [ -f "$command_path" ] &&
    grep -q 'PickForge AppImage launcher generated by the PickForge installer' "$command_path" 2>/dev/null; then
    return 0
  fi
  if [ -L "$command_path" ]; then
    link_target=$(readlink "$command_path" 2>/dev/null || true)
    if [ "${link_target##*/}" = "$APP_NAME.AppImage" ]; then
      return 0
    fi
  fi

  die "command path already exists and was not created by PickForge: $command_path"
}

remove_replaceable_command_path() {
  command_path=$1

  if [ -L "$command_path" ]; then
    rm -f "$command_path"
  fi
}

install_launcher_icon_from_appimage() {
  launcher_appimage=$1
  data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  icon_dir="$data_home/icons/hicolor/512x512/apps"
  icon_path="$icon_dir/$APP_ID.png"
  extract_dir="$tmp/appimage-icon"

  mkdir -p "$icon_dir" "$extract_dir" 2>/dev/null || return 0

  extract_appimage_icon() {
    if command -v timeout >/dev/null 2>&1; then
      timeout 20 "$launcher_appimage" --appimage-extract
    else
      "$launcher_appimage" --appimage-extract
    fi
  }

  if (cd "$extract_dir" && extract_appimage_icon >/dev/null 2>&1); then
    for icon_candidate in \
      "$extract_dir/squashfs-root/$APP_NAME.png" \
      "$extract_dir/squashfs-root/$BIN_NAME.png" \
      "$extract_dir/squashfs-root/$APP_ID.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/512x512/apps/$APP_ID.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/512x512/apps/$BIN_NAME.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/256x256/apps/$APP_ID.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/256x256/apps/$BIN_NAME.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/128x128/apps/$APP_ID.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/128x128/apps/$BIN_NAME.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/32x32/apps/$APP_ID.png" \
      "$extract_dir/squashfs-root/usr/share/icons/hicolor/32x32/apps/$BIN_NAME.png"; do
      if [ -f "$icon_candidate" ]; then
        cp "$icon_candidate" "$icon_path" 2>/dev/null || return 0
        return 0
      fi
    done
  fi
}

disable_stale_launcher() {
  stale_file=$1

  [ -f "$stale_file" ] || return 0
  [ "${stale_file##*/}" != "$APP_ID.desktop" ] || return 0
  grep -Eq '^Name=PickForge$' "$stale_file" 2>/dev/null || return 0

  if ! grep -Eq '^(Icon|StartupWMClass)=(pickforge|pickforge-tauri)$|^Exec=.*(/build/linux/|/target/(debug|release)/pickforge-tauri|pickforge-tauri)' "$stale_file" 2>/dev/null; then
    return 0
  fi

  backup="$stale_file.disabled-by-pickforge-installer"
  backup_index=0
  while [ -e "$backup" ]; do
    backup_index=$((backup_index + 1))
    backup="$stale_file.disabled-by-pickforge-installer.$backup_index"
  done

  if mv "$stale_file" "$backup" 2>/dev/null; then
    printf 'Disabled stale launcher: %s -> %s\n' "$stale_file" "$backup"
  fi
}

disable_stale_launchers() {
  launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

  disable_stale_launcher "$launcher_dir/pickforge.desktop"
  disable_stale_launcher "$launcher_dir/pickforge-tauri.desktop"
  disable_stale_launcher "$launcher_dir/PickForge.desktop"
}

disable_previous_appimage_launcher() {
  launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  launcher_file="$launcher_dir/$APP_ID.desktop"
  install_dir="${PICKFORGE_INSTALL_DIR:-$HOME/.local/bin}"
  command_path="$install_dir/$BIN_NAME"

  if [ -f "$launcher_file" ] &&
    grep -Eq '^Name=PickForge$' "$launcher_file" 2>/dev/null &&
    {
      grep -Eq 'Exec=.*PickForge[.]AppImage' "$launcher_file" 2>/dev/null ||
        {
          grep -F "$HOME/" "$launcher_file" >/dev/null 2>&1 &&
            grep -Eq '^Exec=.*[/"]pickforge("|[[:space:]]|$)' "$launcher_file" 2>/dev/null
        }
    }; then
    backup="$launcher_file.disabled-by-pickforge-installer"
    backup_index=0
    while [ -e "$backup" ]; do
      backup_index=$((backup_index + 1))
      backup="$launcher_file.disabled-by-pickforge-installer.$backup_index"
    done
    if mv "$launcher_file" "$backup" 2>/dev/null; then
      printf 'Disabled previous AppImage menu entry: %s -> %s\n' "$launcher_file" "$backup"
    fi
  fi

  if [ -f "$command_path" ] &&
    grep -q 'PickForge AppImage launcher generated by the PickForge installer' "$command_path" 2>/dev/null; then
    backup="$command_path.disabled-by-pickforge-installer"
    backup_index=0
    while [ -e "$backup" ]; do
      backup_index=$((backup_index + 1))
      backup="$command_path.disabled-by-pickforge-installer.$backup_index"
    done
    if mv "$command_path" "$backup" 2>/dev/null; then
      printf 'Disabled previous AppImage launcher: %s -> %s\n' "$command_path" "$backup"
    fi
  elif [ -L "$command_path" ]; then
    link_target=$(readlink "$command_path" 2>/dev/null || true)
    if [ "${link_target##*/}" = "$APP_NAME.AppImage" ]; then
      backup="$command_path.disabled-by-pickforge-installer"
      backup_index=0
      while [ -e "$backup" ]; do
        backup_index=$((backup_index + 1))
        backup="$command_path.disabled-by-pickforge-installer.$backup_index"
      done
      if mv "$command_path" "$backup" 2>/dev/null; then
        printf 'Disabled previous AppImage launcher: %s -> %s\n' "$command_path" "$backup"
      fi
    fi
  fi
}

refresh_desktop_caches() {
  data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  launcher_dir="$data_home/applications"
  hicolor_dir="$data_home/icons/hicolor"

  if command -v update-desktop-database >/dev/null 2>&1 && [ -d "$launcher_dir" ]; then
    update-desktop-database "$launcher_dir" >/dev/null 2>&1 || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "$hicolor_dir" ]; then
    gtk-update-icon-cache -f -t "$hicolor_dir" >/dev/null 2>&1 || true
  fi
  if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 >/dev/null 2>&1 || true
  elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 >/dev/null 2>&1 || true
  fi
}

path_has_dir() {
  checked_dir=$1

  case ":${PATH:-}:" in
    *:"$checked_dir":*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_appimage() {
  install_dir="${PICKFORGE_INSTALL_DIR:-$HOME/.local/bin}"
  appimage_path="$install_dir/$APP_NAME.AppImage"
  command_path="$install_dir/$BIN_NAME"

  path_must_be_in_home "$install_dir"
  mkdir -p "$install_dir"
  [ ! -d "$appimage_path" ] || die "install destination is a directory: $appimage_path"
  [ ! -d "$command_path" ] || die "command path is a directory: $command_path"
  ensure_replaceable_command_path "$command_path"
  remove_replaceable_command_path "$command_path"
  mv "$asset_path" "$appimage_path"
  chmod +x "$appimage_path"
  write_appimage_wrapper "$command_path"
  install_launcher_icon_from_appimage "$appimage_path" || true
  disable_stale_launchers
  write_desktop_launcher "$command_path" || true
  refresh_desktop_caches

  [ -x "$appimage_path" ] || die "installed AppImage is not executable: $appimage_path"

  printf '%s %s installed to %s.\n' "$APP_NAME" "$release_tag" "$appimage_path"
  if ! path_has_dir "$install_dir"; then
    printf 'Note: %s is not on PATH. Add it to launch with `%s`.\n' "$install_dir" "$BIN_NAME"
  fi
  printf 'Launch with `%s`, `%s`, or from your app menu.\n' "$BIN_NAME" "$appimage_path"
}

install_deb() {
  if ! can_request_root; then
    die "installing the .deb package requires root or sudo. Re-run with PICKFORGE_INSTALL_KIND=appimage for a rootless install."
  fi

  printf 'Installing %s %s native .deb package. sudo may ask for your password.\n' "$APP_NAME" "$release_tag"
  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get install -y "$asset_path"
  elif command -v apt >/dev/null 2>&1; then
    run_as_root apt install -y "$asset_path"
  elif command -v dpkg >/dev/null 2>&1; then
    run_as_root dpkg -i "$asset_path"
  else
    die "no .deb installer found. Re-run with PICKFORGE_INSTALL_KIND=appimage for a rootless install."
  fi

  disable_stale_launchers
  disable_previous_appimage_launcher
  refresh_desktop_caches
  printf '%s %s installed from %s.\n' "$APP_NAME" "$release_tag" "$asset_name"
  printf 'Launch with `%s` or from your app menu.\n' "$BIN_NAME"
}

install_rpm() {
  if ! can_request_root; then
    die "installing the .rpm package requires root or sudo. Re-run with PICKFORGE_INSTALL_KIND=appimage for a rootless install."
  fi

  printf 'Installing %s %s native .rpm package. sudo may ask for your password.\n' "$APP_NAME" "$release_tag"
  if command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y "$asset_path"
  elif command -v yum >/dev/null 2>&1; then
    run_as_root yum localinstall -y "$asset_path"
  elif command -v zypper >/dev/null 2>&1; then
    run_as_root zypper --non-interactive --no-gpg-checks install "$asset_path"
  elif command -v rpm >/dev/null 2>&1; then
    run_as_root rpm -Uvh "$asset_path"
  else
    die "no .rpm installer found. Re-run with PICKFORGE_INSTALL_KIND=appimage for a rootless install."
  fi

  disable_stale_launchers
  disable_previous_appimage_launcher
  refresh_desktop_caches
  printf '%s %s installed from %s.\n' "$APP_NAME" "$release_tag" "$asset_name"
  printf 'Launch with `%s` or from your app menu.\n' "$BIN_NAME"
}

install_macapp() {
  applications_dir="$HOME/Applications"
  app_path="$applications_dir/$APP_NAME.app"
  staging="$tmp/extract"

  mkdir -p "$applications_dir" "$staging"
  verify_archive_paths
  # Extract into staging first, then swap: the existing install is destroyed
  # only after a successful extraction, so a failed/partial extract never
  # leaves the user without a working app, and no stale files are merged in.
  tar -xzf "$asset_path" -C "$staging"
  [ -d "$staging/$APP_NAME.app" ] || die "$APP_NAME.app was not found after extracting $asset_name"
  rm -rf "$app_path"
  mv "$staging/$APP_NAME.app" "$app_path"
  xattr -dr com.apple.quarantine "$app_path" 2>/dev/null || true

  printf '%s %s installed to %s.\n' "$APP_NAME" "$release_tag" "$app_path"
  printf 'Open it with: open "%s"\n' "$app_path"
  printf 'If Gatekeeper blocks it, run: xattr -dr com.apple.quarantine "%s"\n' "$app_path"
}

install_asset() {
  case "$install_kind" in
    appimage)
      install_appimage
      ;;
    deb)
      install_deb
      ;;
    rpm)
      install_rpm
      ;;
    macapp)
      install_macapp
      ;;
    *)
      die "unsupported install kind: $install_kind"
      ;;
  esac
}

main() {
  preflight
  detect_platform
  resolve_release
  make_tmp_dir
  trap 'rm -rf "$tmp"' EXIT INT TERM
  download_asset
  install_asset
}

main "$@"

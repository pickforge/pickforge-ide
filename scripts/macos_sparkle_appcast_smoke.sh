#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

appcast="docs/distribution/sparkle-appcast.example.xml"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appcast)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --appcast" >&2
        exit 64
      fi
      appcast="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: scripts/macos_sparkle_appcast_smoke.sh [--appcast <path>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "Missing required Sparkle appcast smoke tool: python3" >&2
  exit 1
fi

if [[ ! -f "$appcast" ]]; then
  echo "Sparkle appcast not found: $appcast" >&2
  exit 1
fi

python3 - "$appcast" <<'PY'
import base64
import re
import sys
import xml.etree.ElementTree as ET
from typing import Optional, Set
from urllib.parse import urlparse

path = sys.argv[1]
sparkle_ns = "http://www.andymatuschak.org/xml-namespaces/sparkle"


def fail(message: str) -> None:
    raise SystemExit(f"{path}: {message}")


def sparkle(name: str) -> str:
    return f"{{{sparkle_ns}}}{name}"


def required_text(parent: ET.Element, tag: str, label: str) -> str:
    child = parent.find(tag)
    if child is None or child.text is None or not child.text.strip():
        fail(f"missing {label}")
    return child.text.strip()


def require_https(value: str, label: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        fail(f"{label} must be an HTTPS URL")


def require_signature(value: Optional[str], label: str) -> None:
    if value is None or not value.strip():
        fail(f"missing {label}")
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as error:
        fail(f"{label} must be base64: {error}")
    if len(decoded) < 48:
        fail(f"{label} is too short for an EdDSA signature")


try:
    root = ET.parse(path).getroot()
except ET.ParseError as error:
    fail(f"invalid XML: {error}")

if root.tag != "rss" or root.attrib.get("version") != "2.0":
    fail('root must be <rss version="2.0">')

channel = root.find("channel")
if channel is None:
    fail("missing channel")

required_text(channel, "title", "channel title")
require_https(required_text(channel, "link", "channel link"), "channel link")
required_text(channel, "description", "channel description")

items = channel.findall("item")
if not items:
    fail("missing update items")

seen_versions: Set[str] = set()
short_version_pattern = re.compile(r"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")

for index, item in enumerate(items, start=1):
    label = f"item {index}"
    required_text(item, "title", f"{label} title")
    require_https(required_text(item, "link", f"{label} link"), f"{label} link")
    required_text(item, "pubDate", f"{label} pubDate")

    version = required_text(item, sparkle("version"), f"{label} sparkle:version")
    if version in seen_versions:
        fail(f"duplicate sparkle:version: {version}")
    seen_versions.add(version)

    short_version = required_text(
        item,
        sparkle("shortVersionString"),
        f"{label} sparkle:shortVersionString",
    )
    if not short_version_pattern.match(short_version):
        fail(f"{label} sparkle:shortVersionString must look like semver")

    release_notes = required_text(
        item,
        sparkle("releaseNotesLink"),
        f"{label} sparkle:releaseNotesLink",
    )
    require_https(release_notes, f"{label} sparkle:releaseNotesLink")

    enclosure = item.find("enclosure")
    if enclosure is None:
        fail(f"missing {label} enclosure")

    require_https(enclosure.attrib.get("url", ""), f"{label} enclosure url")
    if enclosure.attrib.get("type") != "application/octet-stream":
        fail(f'{label} enclosure type must be "application/octet-stream"')

    length = enclosure.attrib.get("length")
    if length is None or not length.isdigit() or int(length) <= 0:
        fail(f"{label} enclosure length must be a positive integer")

    require_signature(
        enclosure.attrib.get(sparkle("edSignature")),
        f"{label} enclosure sparkle:edSignature",
    )

print(f"Sparkle appcast smoke passed: {path} ({len(items)} item(s))")
PY

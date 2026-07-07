import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const installer = join(repoRoot, "scripts", "install.sh");

function makeTempRoot(name) {
  const root = execFileSync("mktemp", ["-d", join(tmpdir(), `${name}.XXXXXX`)], {
    encoding: "utf8",
  }).trim();
  mkdirSync(join(root, "home"), { recursive: true });
  return root;
}

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function writeFixture(root, assets) {
  const fixture = join(root, "fixture");
  mkdirSync(fixture, { recursive: true });
  const release = {
    tag_name: "v9.9.9",
    assets: assets.map(({ name }) => ({
      browser_download_url: `https://example.test/${name}`,
    })),
  };
  writeFileSync(join(fixture, "release.json"), JSON.stringify(release));

  for (const asset of assets) {
    const path = join(fixture, asset.name);
    if (asset.kind === "appimage") {
      writeExecutable(
        path,
        `#!/bin/sh
set -eu
if [ "\${1:-}" = "--appimage-extract" ]; then
  mkdir -p squashfs-root/usr/share/icons/hicolor/512x512/apps
  printf 'fake png' > squashfs-root/usr/share/icons/hicolor/512x512/apps/pickforge.png
  exit 0
fi
exit 0
`,
      );
    } else {
      writeFileSync(path, `fake ${asset.kind}`);
    }
  }

  return fixture;
}

function writeFakeCurl(fakebin) {
  writeExecutable(
    join(fakebin, "curl"),
    `#!/bin/sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -H|-K)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
case "$url" in
  *api.github.com*|*release.test*)
    cat "$PICKFORGE_TEST_FIXTURE/release.json"
    ;;
  *.AppImage|*.deb|*.rpm|*.app.tar.gz)
    cp "$PICKFORGE_TEST_FIXTURE/\${url##*/}" "$out"
    ;;
  *)
    echo "unexpected url: $url" >&2
    exit 64
    ;;
esac
`,
  );
}

function runInstaller(root, fixture, extraEnv = {}) {
  const fakebin = join(root, "fakebin");
  mkdirSync(fakebin, { recursive: true });
  writeFakeCurl(fakebin);

  const env = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_DATA_HOME: join(root, "home", ".local", "share"),
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_TEST_FIXTURE: fixture,
    PICKFORGE_RELEASE_API_URL: "https://release.test/latest",
    ...extraEnv,
  };

  return execFileSync("sh", [installer], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runInstallerFailure(root, fixture, extraEnv = {}) {
  const fakebin = join(root, "fakebin");
  mkdirSync(fakebin, { recursive: true });
  writeFakeCurl(fakebin);

  const env = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_DATA_HOME: join(root, "home", ".local", "share"),
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_TEST_FIXTURE: fixture,
    PICKFORGE_RELEASE_API_URL: "https://release.test/latest",
    ...extraEnv,
  };

  return spawnSync("sh", [installer], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createStaleLaunchers(root) {
  const apps = join(root, "home", ".local", "share", "applications");
  mkdirSync(apps, { recursive: true });
  writeFileSync(
    join(apps, "pickforge.desktop"),
    `[Desktop Entry]
Type=Application
Name=PickForge
Exec=/missing/build/linux/x64/release/bundle/pickforge
Icon=pickforge
StartupWMClass=pickforge
`,
  );
  writeFileSync(
    join(apps, "pickforge-tauri.desktop"),
    `[Desktop Entry]
Type=Application
Name=PickForge
Exec=/missing/target/release/pickforge-tauri
Icon=pickforge-tauri
StartupWMClass=pickforge-tauri
`,
  );
}

function test(name, fn) {
  const root = makeTempRoot(`pickforge-installer-${name.replace(/[^a-z0-9]+/gi, "-")}`);
  try {
    fn(root);
    console.log(`ok - ${name}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("AppImage fallback installs launcher, icon, wrapper, and disables stale entries", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
  ]);
  createStaleLaunchers(root);

  const output = runInstaller(root, fixture, { PICKFORGE_INSTALL_KIND: "appimage" });

  const home = join(root, "home");
  const appImage = join(home, ".local", "bin", "PickForge.AppImage");
  const command = join(home, ".local", "bin", "pickforge");
  const launcher = join(home, ".local", "share", "applications", "dev.pickforge.app.desktop");
  const icon = join(home, ".local", "share", "icons", "hicolor", "512x512", "apps", "dev.pickforge.app.png");

  assert.equal(existsSync(appImage), true);
  assert.equal(statSync(appImage).mode & 0o111, 0o111);
  assert.equal(existsSync(command), true);
  assert.match(readFileSync(command, "utf8"), /APPIMAGE_EXTRACT_AND_RUN=1/);
  assert.equal(existsSync(launcher), true);
  assert.equal(existsSync(icon), true);
  assert.match(readFileSync(launcher, "utf8"), /StartupWMClass=dev\.pickforge\.app/);
  assert.match(readFileSync(launcher, "utf8"), /Icon=dev\.pickforge\.app/);
  assert.match(readFileSync(launcher, "utf8"), /Exec=".*\/\.local\/bin\/pickforge"/);
  assert.equal(existsSync(join(home, ".local", "share", "applications", "pickforge.desktop")), false);
  assert.equal(existsSync(join(home, ".local", "share", "applications", "pickforge-tauri.desktop")), false);
  assert.match(output, /Disabled stale launcher:/);
  assert.match(output, /Launch with `pickforge`/);
});

test("AppImage upgrade replaces old symlink command without overwriting the AppImage", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
  ]);
  const bin = join(root, "home", ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, "PickForge.AppImage"), "#!/bin/sh\nexit 0\n");
  symlinkSync("PickForge.AppImage", join(bin, "pickforge"));

  runInstaller(root, fixture, { PICKFORGE_INSTALL_KIND: "appimage" });

  const appImage = readFileSync(join(bin, "PickForge.AppImage"), "utf8");
  const command = readFileSync(join(bin, "pickforge"), "utf8");

  assert.equal(lstatSync(join(bin, "pickforge")).isSymbolicLink(), false);
  assert.match(appImage, /--appimage-extract/);
  assert.doesNotMatch(appImage, /APPIMAGE_EXTRACT_AND_RUN=1/);
  assert.match(command, /APPIMAGE_EXTRACT_AND_RUN=1/);
});

test("explicit deb install uses a native package when a deb installer and sudo are available", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
    { name: "PickForge_9.9.9_amd64.deb", kind: "deb" },
  ]);
  const fakebin = join(root, "fakebin");
  mkdirSync(fakebin, { recursive: true });
  writeExecutable(
    join(fakebin, "sudo"),
    `#!/bin/sh
exec "$@"
`,
  );
  writeExecutable(
    join(fakebin, "apt-get"),
    `#!/bin/sh
printf '%s\\n' "$*" > "$PICKFORGE_TEST_APT_LOG"
`,
  );

  const aptLog = join(root, "apt.log");
  const output = runInstaller(root, fixture, {
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_INSTALL_KIND: "deb",
    PICKFORGE_TEST_APT_LOG: aptLog,
  });

  assert.match(output, /native \.deb package/);
  assert.match(readFileSync(aptLog, "utf8"), /install -y .*PickForge_9\.9\.9_amd64\.deb/);
  assert.equal(existsSync(join(root, "home", ".local", "bin", "PickForge.AppImage")), false);
});

test("native install disables a custom AppImage desktop entry", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.deb", kind: "deb" },
  ]);
  const fakebin = join(root, "fakebin");
  const apps = join(root, "home", ".local", "share", "applications");
  const customBin = join(root, "home", "tools", "pickforge");
  mkdirSync(fakebin, { recursive: true });
  mkdirSync(apps, { recursive: true });
  mkdirSync(join(root, "home", "tools"), { recursive: true });
  writeExecutable(customBin, "#!/bin/sh\nexit 0\n");
  writeExecutable(
    join(fakebin, "sudo"),
    `#!/bin/sh
exec "$@"
`,
  );
  writeExecutable(
    join(fakebin, "apt-get"),
    `#!/bin/sh
exit 0
`,
  );
  writeFileSync(
    join(apps, "dev.pickforge.app.desktop"),
    `[Desktop Entry]
Type=Application
Name=PickForge
Exec="${customBin}"
Icon=dev.pickforge.app
StartupWMClass=dev.pickforge.app
`,
  );

  const output = runInstaller(root, fixture, {
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_INSTALL_KIND: "deb",
  });

  assert.equal(existsSync(join(apps, "dev.pickforge.app.desktop")), false);
  assert.equal(existsSync(join(apps, "dev.pickforge.app.desktop.disabled-by-pickforge-installer")), true);
  assert.match(output, /Disabled previous AppImage menu entry:/);
});

test("auto stays rootless AppImage even when a deb asset exists", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
    { name: "PickForge_9.9.9_amd64.deb", kind: "deb" },
  ]);

  const output = runInstaller(root, fixture);

  assert.match(output, /installed to .*PickForge\.AppImage/);
  assert.equal(existsSync(join(root, "home", ".local", "bin", "PickForge.AppImage")), true);
});

test("AppImage install refuses to overwrite an unrelated pickforge command", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
  ]);
  const bin = join(root, "home", ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, "pickforge"), "#!/bin/sh\nexit 0\n");

  const result = runInstallerFailure(root, fixture, { PICKFORGE_INSTALL_KIND: "appimage" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /command path already exists and was not created by PickForge/);
});

test("explicit rpm install lets zypper accept unsigned local packages", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_x86_64.rpm", kind: "rpm" },
  ]);
  const fakebin = join(root, "fakebin");
  mkdirSync(fakebin, { recursive: true });
  writeExecutable(
    join(fakebin, "sudo"),
    `#!/bin/sh
exec "$@"
`,
  );
  writeExecutable(
    join(fakebin, "zypper"),
    `#!/bin/sh
printf '%s\\n' "$*" > "$PICKFORGE_TEST_ZYPPER_LOG"
`,
  );

  const zypperLog = join(root, "zypper.log");
  const output = runInstaller(root, fixture, {
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_INSTALL_KIND: "rpm",
    PICKFORGE_TEST_ZYPPER_LOG: zypperLog,
  });

  assert.match(output, /native \.rpm package/);
  assert.match(readFileSync(zypperLog, "utf8"), /--non-interactive --no-gpg-checks install .*PickForge_9\.9\.9_x86_64\.rpm/);
});

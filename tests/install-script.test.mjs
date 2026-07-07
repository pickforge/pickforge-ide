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
if [ -n "\${PICKFORGE_TEST_APPIMAGE_LOG:-}" ]; then
  {
    printf 'extract=%s\\n' "\${APPIMAGE_EXTRACT_AND_RUN:-0}"
    printf 'tmpdir=%s\\n' "\${TMPDIR:-}"
    printf 'args=%s\\n' "$*"
  } >> "$PICKFORGE_TEST_APPIMAGE_LOG"
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
auth_header=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -H)
      case "\${2:-}" in
        *Authorization*) auth_header=1 ;;
      esac
      shift 2
      ;;
    -K)
      auth_header=1
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
  *api.github.com*)
    cat "$PICKFORGE_TEST_FIXTURE/release.json"
    ;;
  *release.test*)
    if [ "$auth_header" -eq 1 ]; then
      echo "authorization header sent to override URL" >&2
      exit 65
    fi
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
  const icon = join(home, ".local", "share", "icons", "hicolor", "scalable", "apps", "dev.pickforge.app.svg");

  assert.equal(existsSync(appImage), true);
  assert.equal(statSync(appImage).mode & 0o111, 0o111);
  assert.equal(existsSync(command), true);
  const commandBody = readFileSync(command, "utf8");
  assert.match(commandBody, /APPIMAGE_EXTRACT_AND_RUN=1/);
  assert.match(commandBody, /\[ -c "\$fuse_device" \]/);
  assert.match(commandBody, /\[ -r "\$fuse_device" \]/);
  assert.match(commandBody, /\[ -w "\$fuse_device" \]/);
  assert.match(commandBody, /is_known_fuse_restricted_host/);
  assert.equal(commandBody.includes(`appimage_path='${appImage}'`), true);
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

test("AppImage wrapper uses direct exec only on unrestricted FUSE-capable hosts", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
  ]);

  runInstaller(root, fixture, { PICKFORGE_INSTALL_KIND: "appimage" });

  const home = join(root, "home");
  const fakebin = join(root, "fakebin");
  const command = join(home, ".local", "bin", "pickforge");
  const testCommand = join(root, "pickforge-wrapper");
  const procVersion = join(root, "proc-version");
  const procCgroup = join(root, "proc-1-cgroup");
  const log = join(root, "appimage.log");
  writeFileSync(procVersion, "Linux version test-host\n");
  writeFileSync(procCgroup, "0::/init.scope\n");
  writeExecutable(
    testCommand,
    readFileSync(command, "utf8")
      .replace('fuse_device="/dev/fuse"', 'fuse_device="/dev/null"')
      .replaceAll("/proc/version", procVersion)
      .replaceAll("/.dockerenv", join(root, "dockerenv"))
      .replaceAll("/run/.containerenv", join(root, "containerenv"))
      .replaceAll("/proc/1/cgroup", procCgroup),
  );
  writeExecutable(
    join(fakebin, "ldconfig"),
    `#!/bin/sh
printf '%s\\n' 'libfuse.so.2 (libc6,x86-64) => /usr/lib/libfuse.so.2'
`,
  );

  const env = {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: join(home, ".cache"),
    PATH: `${fakebin}:${process.env.PATH}`,
    PICKFORGE_TEST_APPIMAGE_LOG: log,
    WSL_DISTRO_NAME: "",
    WSL_INTEROP: "",
    container: "",
  };

  const directResult = spawnSync(testCommand, ["--direct"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wslResult = spawnSync(testCommand, ["--wsl"], {
    env: { ...env, WSL_DISTRO_NAME: "Ubuntu" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const containerResult = spawnSync(testCommand, ["--container"], {
    env: { ...env, container: "docker" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(directResult.status, 0, directResult.stderr);
  assert.equal(wslResult.status, 0, wslResult.stderr);
  assert.equal(containerResult.status, 0, containerResult.stderr);
  const logBody = readFileSync(log, "utf8");
  assert.match(logBody, /extract=0\n[\s\S]*args=--direct/);
  assert.match(logBody, /args=--wsl/);
  assert.match(logBody, /args=--container/);
  assert.equal((logBody.match(/extract=1/g) ?? []).length, 2);
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
  assert.doesNotMatch(appImage, /APPIMAGE_EXTRACT_AND_RUN=1/);
  assert.match(command, /APPIMAGE_EXTRACT_AND_RUN=1/);
  assert.equal(command.includes(`appimage_path='${join(bin, "PickForge.AppImage")}'`), true);
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

test("release API override does not receive the GitHub token", (root) => {
  const fixture = writeFixture(root, [
    { name: "PickForge_9.9.9_amd64.AppImage", kind: "appimage" },
  ]);

  const output = runInstaller(root, fixture, { GITHUB_TOKEN: "ghp_secret" });

  assert.match(output, /PickForge v9\.9\.9 installed/);
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

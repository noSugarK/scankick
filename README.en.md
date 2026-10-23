<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.png">
    <img src="public/brand/logo.png" alt="ScanKick" width="400">
  </picture>
</p>

<p align="center">
  <b>Multiplayer football for up to 4v4: host on a big screen, scan in, and play with your phone as the gamepad.</b><br>
  No backend server: open the page and kick off. Windows, macOS, Linux, and Android apps add offline LAN play.
</p>

<p align="center">
  <a href="https://github.com/noSugarK/scankick/stargazers"><img src="https://img.shields.io/github/stars/noSugarK/scankick?style=flat&logo=github&color=2fa866" alt="GitHub stars"></a>
  <a href="https://github.com/noSugarK/scankick/actions/workflows/deploy.yml"><img src="https://img.shields.io/github/actions/workflow/status/noSugarK/scankick/deploy.yml?branch=main&label=deploy" alt="Deploy"></a>
  <a href="https://github.com/noSugarK/scankick/commits/main"><img src="https://img.shields.io/github/last-commit/noSugarK/scankick" alt="Last commit"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <br>
  <a href="https://github.com/noSugarK/scankick/releases"><img src="https://img.shields.io/github/v/release/noSugarK/scankick?include_prereleases&sort=semver&label=release&color=2fa866" alt="Latest release"></a>
  <a href="https://github.com/noSugarK/scankick/releases"><img src="https://img.shields.io/github/downloads/noSugarK/scankick/total?label=downloads&color=2fa866" alt="Downloads"></a>
  <a href="https://github.com/noSugarK/scankick/actions/workflows/release-app.yml"><img src="https://img.shields.io/github/actions/workflow/status/noSugarK/scankick/release-app.yml?label=installers" alt="Installers"></a>
  <img src="https://img.shields.io/badge/platform-Web%20%7C%20Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-informational" alt="Platforms">
</p>

<p align="center">
  <a href="https://nosugark.github.io/scankick/"><b>Play now</b></a> ·
  <a href="https://nosugark.github.io/scankick/#/guide">How to play</a> ·
  <a href="#download-the-app">Download the app</a> ·
  <a href="https://www.bilibili.com/video/BV1gfJf6iEEY/">Trailer</a> ·
  <a href="README.md">简体中文</a> · English
</p>

## Trailer

<p align="center">
  <a href="https://www.bilibili.com/video/BV1gfJf6iEEY/"><img src="docs/media/promo-poster.webp" alt="Watch the 18-second trailer on Bilibili" width="720"></a><br>
  <sub>Click to watch the 18-second trailer on Bilibili (Chinese captions)</sub>
</p>

## Highlights

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/screen-lobby.webp" alt="Big-screen lobby"><br>
      <b>Scan to join</b><br>
      Host on a TV or computer and everyone joins by scanning the QR code on screen. You can also save a branded QR card to send to friends.
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/screen-match.webp" alt="Big-screen match"><br>
      <b>Watch it on the big screen</b><br>
      The host runs 60 Hz physics while phones predict locally, so the stick responds instantly. AI fills empty spots, with three difficulty levels.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="22%" align="center" valign="top">
      <img src="docs/screenshots/phone-home-dark.webp" alt="Phone home page, dark theme"><br>
      <sub>Host / Join / Lobby, light and dark themes</sub>
    </td>
    <td width="22%" align="center" valign="top">
      <img src="docs/screenshots/phone-lobby-light.webp" alt="Public lobby, light theme"><br>
      <sub>Public lobby with optional 4–6 digit passwords</sub>
    </td>
    <td width="56%" align="center" valign="top">
      <img src="docs/screenshots/phone-host.webp" alt="Hosting on a phone"><br>
      <sub>No big screen? One phone can host and play at the same time</sub>
    </td>
  </tr>
</table>

- **Two ways to host**: a big screen that only shows the match, or one phone that hosts and plays.
- **Public lobby and passwords**: list your room in the lobby if you like; the QR code carries the password.
- **Flexible joining**: scan with the camera, pick a QR screenshot from your photos, or type the 5-character room code.
- **Three languages**: Simplified Chinese, Traditional Chinese, and English, with light and dark themes on the home page.

## Quick start

1. Open **[nosugark.github.io/scankick](https://nosugark.github.io/scankick/)** on a TV or computer and choose Host → Host on big screen.
2. Everyone scans the QR code with their phone, picks a nickname and a team.
3. Turn your phone sideways and wait for the room host to start the match.

No big screen? Choose Host → Host on phone, and others scan the QR code on that phone.

## Download the app

The website is all you need, and players never install anything. Install the app to host LAN rooms without internet access, or for fullscreen landscape play on Android.
Installers are on [GitHub Releases](https://github.com/noSugarK/scankick/releases); the download button at the top right of the website also lists the latest version.

| System | Installer | Requirements and notes |
|---|---|---|
| Windows | `.exe` (recommended) / `.msi` | Windows 10 / 11 x64; the installer adds WebView2 if it is missing |
| macOS | `.dmg` | Universal (Intel and Apple Silicon), macOS 10.13+ |
| Linux | `.deb` / `.rpm` | x64, built on Ubuntu 22.04; needs glibc 2.35+ and WebKitGTK 4.1 |
| Android | `.apk` | ARM64, Android 7.0+ |
| iOS / iPadOS | Not available | Scan with the system camera and play in the browser; for fullscreen, use Share → Add to Home Screen and open it from the icon |

- **Online mode**: shares the public lobby and rooms with the website. The QR code points to the website, so players join in their browser.
- **Local network mode**: the host app runs an HTTP/WebSocket server, no internet needed. Players on the same Wi-Fi or hotspot can discover and join rooms from the app lobby without hosting, or scan the QR code to join in a browser. If discovery is blocked, enter the host address and room code or paste a full invite link. Discovery uses UDP port 42819; gameplay uses the host’s dynamic WebSocket port.
- **Android**: the status bar stays visible in portrait and landscape goes fullscreen; scanning asks for camera permission; external links open in the system browser.

Versions containing `-` (such as `v0.1.0-beta.2`) are prereleases. Installers are not publisher-signed yet: Windows may show a SmartScreen prompt (choose More info → Run anyway), and on macOS allow the app under System Settings → Privacy & Security the first time. Test-signed APKs use a `.debug` application ID and may not upgrade in place.

## Controls

| Control | Action | Details |
|:---:|---|---|
| Left stick | Move | Press anywhere on the left half of the screen |
| **A** | Pass | Passes to the best teammate in front of you, or pushes the ball forward |
| **B** | Shoot | Hold to charge, release to shoot (full charge in about 0.85 s) |
| **X** | Sprint | Hold to run faster, uses stamina |
| **Y** | Tackle | Slide forward; a hit knocks the opponent down briefly, with cooldown |

## Match modes and party rules

The host can choose these settings before kickoff. They stay fixed during the match.

| Mode | Win condition |
|---|---|
| Timed | Highest score wins at full time; tied scores are a draw |
| First to 3 | No time limit; the first team to score 3 goals wins |
| Golden goal | If tied at full time, retain the score and kick off again; the next goal wins |

Each match can also use one party rule: **Giant ball** (double diameter, with matching collision and kick reach), **Endless stamina** (sprinting never drains stamina), or **Super bounce** (less drag and stronger rebounds off boundaries and posts). Choose **None** for standard rules. The active rule appears on the match screen.

<details>
<summary><b>Room host, surrender, and ending a match</b></summary>

- **Room host**: only the host can start the match, change settings, and add or remove AI. In no-screen mode that's the hosting phone; in a big-screen room it's the first player to join (passed on if they drop), and the big screen itself can always start. The host and the big screen can swipe a player left in the list to make them host (asks to confirm) or remove them (they can't rejoin that room).
- **Surrender**: during a match tap Menu → Surrender. The team loses once a **strict majority** of its online players agree (1 of 1, 2 of 2, 2 of 3, 3 of 4); tap again to take it back.
- **Host ends**: "End match" in the big screen's top-right corner (or Esc), or in the host phone's menu in no-screen mode. The current score decides the result.
- **Desktop debugging**: WASD / arrows to move, J pass, K / Space shoot, L / Shift sprint, I tackle.

</details>

<details>
<summary><b>Public lobby and room passwords</b></summary>

- Turn on "Show in public lobby" before hosting and the room appears live in the home page's Lobby tab with player count, match status, and lock state. It disappears when the host closes or drops.
- Passwords are 4–6 digits. The QR code carries it; joining from the lobby or by room code asks for it. Wrong attempts are rate limited globally (at most 5 per 10 seconds).

</details>

<details>
<summary><b>For developers</b></summary>

#### How it works

- **Host** (the big screen, or the hosting phone; see `src/game/host-game.ts`): runs 60 Hz physics and match logic and broadcasts binary state snapshots to every phone at 30 Hz, 124 bytes per frame for 8 players.
- **Phones**: send input at 30 Hz, interpolate snapshots, and predict their own player locally.
- **Connectivity**: WebRTC signaling goes over public MQTT (EMQX, reachable from mainland China) to set up a P2P DataChannel. If a direct link fails it falls back to an MQTT relay and retries a direct link every 15 seconds. The public lobby uses MQTT retained messages; see `src/net/lobby.ts`.

#### Local development

```bash
npm install
npm run dev        # HTTPS, so phones on the LAN can scan in (trust the self-signed cert the first time)
npm test           # Physics and input regression tests (Node.js 22.15+ or 24 LTS)
```

When the big screen is opened on `localhost`, the QR code switches to your LAN IP automatically. Append `?relay` to a phone URL (for example `#/join/ABCDE?relay`) to force the relay.

Inputs use 32-bit sequence numbers to reject stale and duplicate packets. Button changes are sent immediately over the reliable ordered channel, or MQTT QoS 1 when relaying; the host processes press/release transitions on separate simulation ticks. Snapshots keep their existing low-latency transport. Protocol v3 adds match mode, golden-goal status, and party rule to snapshots. Rooms are isolated from older pages: after updating, refresh both the host and phones, then create and join a new room.

#### Tauri app development (experimental)

The website and app share `src/` and `public/`; the native entry points and configuration live in `src-tauri/`.
The app home page offers Online and Local network modes. Online keeps MQTT/WebRTC; local mode uses a Rust HTTP/WebSocket server and the existing authoritative game, without connecting to public discovery, MQTT, or STUN.

For local play, connect everyone to the same Wi-Fi or a manually enabled hotspot. Select Local network in the app and create a big-screen or phone-hosted room, optionally with a password. Select a reachable network interface and let players scan the QR code using their system camera to join in a browser. Keep the host foreground and its screen awake. Leaving the room stops the server; a new room requires a new QR code.

Avoid VPN/virtual interfaces. Windows Firewall must allow incoming connections on the network in use; guest Wi-Fi with client isolation may block players. Local HTTP pages may not support camera access or screen wake locks, so use the system camera and prevent automatic locking manually.
Automatic hotspots and background matches are not supported yet, and there is no iOS app.

With Rust, the Tauri CLI, and the platform build tools installed:

```bash
npm ci
npm run app:dev      # Start Vite and the native window
npm run app:build    # Build installers for the current desktop platform
cargo test --manifest-path src-tauri/Cargo.toml --lib  # Local HTTP/WebSocket integration test
```

App development first builds the static assets served to players, then starts `http://127.0.0.1:1420` and fails if the port is occupied. Restart the app development command after page changes to refresh the embedded player assets. `npm run dev` keeps the original HTTPS website server.
Windows requires MSVC Build Tools and WebView2. macOS/iOS requires a Mac with Xcode. Android requires the SDK/NDK and `cargo tauri android init` to generate its platform project.
Use `cargo tauri android dev` or `cargo tauri android build` for Android; configure a reachable development server address for the device.
The existing GitHub Pages workflow continues to deploy the website independently.

#### App installers (GitHub Actions)

Run `Build app installers` manually to download installers from Actions Artifacts, or push a `v*` tag to build all platforms and publish them to a GitHub Release after every build succeeds.

Installer names include the version, OS, and architecture:

- Windows: `ScanKick_0.1.0_windows-x64.exe` and `.msi`.
- macOS Intel / Apple Silicon: `ScanKick_0.1.0_macos-universal.dmg`.
- Linux: `ScanKick_0.1.0_linux-x64.deb` and `.rpm`.
- Android: `ScanKick_0.1.0_android-arm64.apk`, with `-test-signed` before `.apk` when production signing secrets are absent.

Only installers are uploaded. No AppImage, raw binaries, `.app` directories, AAB, or build directories are uploaded. Actions artifacts expire after 14 days; GitHub separately provides its automatic source archive links on Releases. CI installs the Android SDK/NDK and initializes the Android project if absent; local `npm run app:build` still builds only the current desktop platform.

Keep the versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` identical, commit the changes, then push a matching tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Tags whose version contains `-` (such as `v0.1.0-beta.1` or `v1.0.0-rc.1`) create prereleases; others create full releases. Tags must match the application version. Manual dispatch may not appear until the workflow reaches the default branch; pushing a tag pointing to a commit containing the workflow can trigger it beforehand.

MSI requires a numeric internal version: keep `bundle.windows.wix.version` equal to the application version without its prerelease suffix (for example, `0.1.0`); CI checks this. Download filenames retain the full version, such as `0.1.0-beta.2`.

Android always uses an optimized Release build with Rust debug symbols stripped. Without production signing secrets it uses a test key and keeps the `.debug` application ID suffix. The test key changes between CI runs, so upgrades are not guaranteed. Configure all four repository Actions secrets to use production signing instead: `ANDROID_KEYSTORE_BASE64` (single-line Base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. The production keystore is written only to runner temporary storage and removed afterward. Windows/macOS publisher signing and Apple notarization are not configured; installation may show OS verification prompts.

#### Deploy to GitHub Pages

1. Push to the `main` branch of your GitHub repository.
2. In Settings → Pages, set Source to **GitHub Actions** and tick "Enforce HTTPS" (camera scanning needs HTTPS).
3. Every push then builds and deploys to `https://<user>.github.io/<repo>/`.

#### Network settings (`src/config.ts`)

- `brokers`: signaling servers, tried in order.
- `iceServers`: Xiaomi and Bilibili STUN by default. If players on mobile data often show "Relay", run your own coturn on a cloud server and add it as a TURN server; relay latency drops from seconds to tens of milliseconds.

#### Known limitations

- The big-screen page must stay in the foreground; browsers pause timers in background tabs and the match stops.
- Public MQTT topics are open to anyone, which is fine for parties. A room password keeps strangers in the lobby out but not someone listening on the broker (the password travels in plain text in the hello message). For serious use, switch to an authenticated EMQX Serverless or self-hosted broker.
- iOS / iPadOS support neither vibration nor web fullscreen. Chrome, Edge, and other iOS browsers use Safari's engine too, so switching browsers does not help; adding the site to the Home Screen and opening it from the icon gives fullscreen.

</details>

<p align="center"><sub>© 2026 noSugarK · Matches in the screenshots are AI demos and lobby rooms are sample data</sub></p>

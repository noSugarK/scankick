<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.png">
    <img src="public/brand/logo.png" alt="ScanKick" width="400">
  </picture>
</p>

<p align="center">
  <b>Multiplayer football for up to 4v4: host on a big screen, scan in, and play with your phone as the gamepad.</b><br>
  No app to install, no backend server. Open the page and kick off.
</p>

<p align="center">
  <a href="https://github.com/noSugarK/scankick/stargazers"><img src="https://img.shields.io/github/stars/noSugarK/scankick?style=flat&logo=github&color=2fa866" alt="GitHub stars"></a>
  <a href="https://github.com/noSugarK/scankick/actions/workflows/deploy.yml"><img src="https://img.shields.io/github/actions/workflow/status/noSugarK/scankick/deploy.yml?branch=main&label=deploy" alt="Deploy"></a>
  <a href="https://github.com/noSugarK/scankick/commits/main"><img src="https://img.shields.io/github/last-commit/noSugarK/scankick" alt="Last commit"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
</p>

<p align="center">
  <a href="https://nosugark.github.io/scankick/"><b>Play now</b></a> ·
  <a href="https://nosugark.github.io/scankick/#/guide">How to play</a> ·
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

## Controls

| Control | Action | Details |
|:---:|---|---|
| Left stick | Move | Press anywhere on the left half of the screen |
| **A** | Pass | Passes to the best teammate in front of you, or pushes the ball forward |
| **B** | Shoot | Hold to charge, release to shoot (full charge in about 0.85 s) |
| **X** | Sprint | Hold to run faster, uses stamina |
| **Y** | Tackle | Slide forward; a hit knocks the opponent down briefly, with cooldown |

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

- **Host** (the big screen, or the hosting phone; see `src/game/host-game.ts`): runs 60 Hz physics and match logic and broadcasts binary state snapshots to every phone at 30 Hz, about 115 bytes per frame for 8 players.
- **Phones**: send input at 30 Hz, interpolate snapshots, and predict their own player locally.
- **Connectivity**: WebRTC signaling goes over public MQTT (EMQX, reachable from mainland China) to set up a P2P DataChannel. If a direct link fails it falls back to an MQTT relay and retries a direct link every 15 seconds. The public lobby uses MQTT retained messages; see `src/net/lobby.ts`.

#### Local development

```bash
npm install
npm run dev        # HTTPS, so phones on the LAN can scan in (trust the self-signed cert the first time)
```

When the big screen is opened on `localhost`, the QR code switches to your LAN IP automatically. Append `?relay` to a phone URL (for example `#/join/ABCDE?relay`) to force the relay.

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
- iOS Safari supports neither vibration nor web fullscreen.

</details>

<p align="center"><sub>© 2026 noSugarK · Matches in the screenshots are AI demos and lobby rooms are sample data</sub></p>

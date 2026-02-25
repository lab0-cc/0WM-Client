# 0WM Client

The 0WM Client is the mobile survey frontend for 0WM. It uses WebXR to track movement and combines that pose with WiFi scan data fetched from an AP (access point) endpoint.

It works with [0WM Server](https://github.com/lab0-cc/0WM-Server) for storage and real-time sessions, [0WM OpMode](https://github.com/lab0-cc/0WM-OpMode) for floorplans/georeferencing, and an AP endpoint that exposes `/cgi-bin/info`, `/cgi-bin/list`, and `/cgi-bin/scan/<radio>` (real OpenWRT AP or [0WM-AP-Mock](https://github.com/lab0-cc/0WM-AP-Mock)).

## Quick Start (Local Dev)

This frontend is static HTML/JS and does not need a build step, but you must fetch submodules.

```bash
git clone https://github.com/lab0-cc/0WM-Client.git
cd 0WM-Client
git submodule update --init --recursive
python3 -m http.server 8002
```

Open `http://127.0.0.1:8002`.

Recommended browser for desktop simulation: Chrome + [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik?hl=en).

The extension is only for **desktop testing** (no real phone/headset). It makes Chrome expose WebXR AR capabilities so the client can start and simulate movement. On a real phone, you do not use this extension.

Typical local ports are server `127.0.0.1:8000`, OpMode `127.0.0.1:8001`, client `127.0.0.1:8002`, and AP mock `127.0.0.1:8003`.

## Configuration

Edit `config.json`:

```json
{
  "api": "http://127.0.0.1:8000"
}
```

`api` must point to 0WM Server.

For desktop emulator use `http://127.0.0.1:8000`; for a real phone use a host/IP reachable from the phone (not loopback).

## Runtime behavior

The client first tries `http://ap.local`. If that is unreachable, it asks the server for fallback AP endpoints from `aps`. Heatmap generation uses only configured `ssids`, so empty `ssids` may produce empty or uniform-looking maps.

## Usage

1. Open the client URL and start.
2. Allow WebXR and geolocation permissions.
3. Select a floorplan from the minimap.
4. Initialize tracking by scanning the room with the camera.
5. Walk the area and trigger scans; measurements stream to the server over WebSocket.

## Troubleshooting

### Client cannot connect to server

Check `config.json` `api`, verify the server is reachable at `${api}/ws`, and confirm OpMode and Client both point to the same server.

### Client cannot reach AP (`<No reachable AP>`)

Make sure AP CGI endpoints respond, set server `aps` to reachable fallback URLs (for local dev, `http://127.0.0.1:8003`), and remember `ap.local` can fail on Android without root and manual IPv6 route injection.

## Funding

This project is funded through [NGI Zero Core](https://nlnet.nl/core), a fund established by [NLnet](https://nlnet.nl) with financial support from the European Commission's [Next Generation Internet](https://ngi.eu) program. Learn more at the [NLnet project page](https://nlnet.nl/project/0WM).

[<img src="https://nlnet.nl/logo/banner.png" alt="NLnet foundation logo" width="20%" />](https://nlnet.nl)
[<img src="https://nlnet.nl/image/logos/NGI0_tag.svg" alt="NGI Zero Logo" width="20%" />](https://nlnet.nl/core)

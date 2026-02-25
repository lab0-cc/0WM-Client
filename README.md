# 0WM Client

The 0WM Client is the mobile survey frontend for 0WM. It uses WebXR to track the device’s movement and combines that information with Wi-Fi scan data fetched from an access point (AP).

It works with the [0WM Server](https://github.com/lab0-cc/0WM-Server) backend for storage and real-time sessions, and an AP exposing the following endpoints: `/cgi-bin/info`, `/cgi-bin/list`, and `/cgi-bin/scan/<radio>`. Currently, we support either real APs running OpenWRT with a [special configuration](https://github.com/lab0-cc/0WM-AP-OpenWRT) or [mock APs](https://github.com/lab0-cc/0WM-AP-Mock).

This project should be used together with [0WM OpMode](https://github.com/lab0-cc/0WM-OpMode) to upload and georeference floorplans.

## Quick start (development environment)

This project consists of static HTML/JS code and does not need a build step; you must however fetch its submodules:

```bash
git clone https://github.com/lab0-cc/0WM-Client.git
cd 0WM-Client
git submodule update --init --recursive
```

To run a local web server exposing those files, simply run:

```bash
python3 -m http.server 8002
```

Finally, you can open `http://127.0.0.1:8002` on your device.

For desktop simulation, we recommend using Chrome along with the [Immersive Web Emulator](https://chromewebstore.google.com/detail/cgffilbpcibhmcfbgggfhfolhkfbhmik) extension. This extension is only for **desktop testing** (without an actual phone). It exposes to Chrome WebXR AR capabilities so the client can start and simulate movement. This extension does not make sense on a real phone.

On a typical development environment, our documentation uses `127.0.0.1:8000` for the server, `127.0.0.1:8001` for the OpMode, `127.0.0.1:8002` for the client, and `127.0.0.1:8003` for the mock AP.

## Configuration

The only configuration necessary for the client is to make it point to the server in `config.json`. For our development environment:

```json
{
  "api": "http://127.0.0.1:8000"
}
```

`api` must point to the 0WM Server.

On a real production environment, use an HTTPS host reachable from the phone.

## Runtime behavior

The client first tries to connect to `http://ap.local`. If that is unreachable, it asks the server for fallback AP endpoints. Heatmap generation uses SSIDs configured in the server, so a uniform-looking heatmap may be the result of misconfigured SSIDs on the server.

## Usage

1. Open the client URL and start.
2. Allow WebXR and geolocation permissions.
3. Select a floorplan from the minimap.
4. Initialize tracking by scanning the room with the camera.
5. Walk the area and trigger scans; measurements are streamed to the server over WebSocket.

## Troubleshooting

### Client cannot connect to server

Check in `config.json` that `api` points to the 0WM server and that its WebSocket endpoint is reachable at `${api}/ws`.

### Client cannot reach AP (`<No reachable AP>`)

Make sure the AP endpoints respond, set the server’s `aps` configuration to a reachable URL for your AP (in our development environment, `http://127.0.0.1:8003`), and remember that reaching `ap.local` can fail on Android without root and manual IPv6 route injection.

## Funding

This project is funded through [NGI Zero Core](https://nlnet.nl/core), a fund established by [NLnet](https://nlnet.nl) with financial support from the European Commission's [Next Generation Internet](https://ngi.eu) program. Learn more at the [NLnet project page](https://nlnet.nl/project/0WM).

[<img src="https://nlnet.nl/logo/banner.png" alt="NLnet foundation logo" width="20%" />](https://nlnet.nl)
[<img src="https://nlnet.nl/image/logos/NGI0_tag.svg" alt="NGI Zero Logo" width="20%" />](https://nlnet.nl/core)

# SilentClient
A SillyTavern server plugin that maintains a "ghost" headless browser client when no real client is active. This enables background operations and extensions to function even when the user's browser is closed.

## What It Does
- Zero-Config Monitoring: Automatically tracks real clients via an injected heartbeat script.
- Smart Ghost Spawning: Launches a headless browser instance when no real client is detected.
- Persistence: Keeps your long-running extensions (like WebSearch or Vector Storage) active 24/7.
- Resource Efficient: Uses optimized Puppeteer flags to minimize CPU and RAM impact.

## Installation
Enable Server Plugins in SillyTavern:

Edit config.yaml and set enableServerPlugins: true

Install the plugin:

```Bash
cd SillyTavern/plugins
git clone https://github.com/walnutseal1/SilentClient silent-client
cd silent-client
npm install
```
Restart SillyTavern server

## How It Works
When you open SillyTavern, the plugin automatically injects a loader.js into your browser.
Your browser pings the server every 2 seconds.
If the server doesn't hear from a "real" browser for 5 seconds, it assumes you've closed the tab and spawns the Ghost.
As soon as you open SillyTavern again, the Ghost detects your presence and terminates itself to save resources.

## Troubleshooting
Linux / VPS Requirements
If you are running on a headless Linux server (Ubuntu/Debian), Puppeteer needs specific libraries. If the ghost fails to spawn, run:

```Bash
sudo apt-get install -y libgbm-dev libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2
```
### Checking Status
You can verify the state of the plugin by visiting: http://your-server:8000/api/plugins/silent-client/status

### Ghost Client not spawning
Check Logs: Run SillyTavern with console access and look for [SilentClient] tags.

Permissions: Ensure the plugin folder has write permissions (required to create the .real_client_heartbeat file).

Puppeteer Install: If you see "Module not found," run npm install again inside the plugins/silent-client directory.

## API Endpoints (For Developers)
GET /api/plugins/silent-client/is-ghosted
Returns { "isGhosted": true } if the headless browser is currently the active session. Use this in your extensions to disable heavy UI animations or sound effects when no human is watching.

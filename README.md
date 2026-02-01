# SilentClient

A SillyTavern server plugin that maintains a "ghost" headless browser client when no real client is active. This enables background operations and extensions to function even when the user's browser is closed.

## What It Does

- **Monitors for real clients**: Tracks when users have SillyTavern open in their browser
- **Spawns ghost client**: Automatically launches a headless browser instance when no real client is detected
- **Manages lifecycle**: Intelligently switches between ghost and real clients without conflicts
- **Exposes status**: Provides `isGhosted` information to extensions via API

## Installation

1. **Enable Server Plugins** in SillyTavern:
   - Edit `config.yaml` and set `enableServerPlugins: true`

2. **Install the plugin**:
   ```bash
   cd SillyTavern/plugins
   git clone https://github.com/walnutseal1/SilentClient silent-client
   cd silent-client
   npm install
   ```

3. **Restart SillyTavern server**

## How It Works

### Architecture

```
┌─────────────────────────────────────┐
│  SilentClient Plugin                │
│                                     │
│  • Heartbeat Monitor (2s interval) │
│  • State Machine                   │
│  • Rate Limiting                   │
│  • Debounced Spawn/Kill            │
└─────────────────────────────────────┘
         │              │
         │              │
         ▼              ▼
┌─────────────┐  ┌──────────────┐
│ Ghost Client│  │ Real Client  │
│ (Headless)  │  │ (User's)     │
└─────────────┘  └──────────────┘
```

### State Machine

- **NO_CLIENT**: No clients active
- **GHOST_ACTIVE**: Ghost client running
- **REAL_ACTIVE**: Real client connected
- **TRANSITIONING**: Switching between states

### Client Detection

Real clients are detected via a heartbeat file (`.real_client_heartbeat`):
- Real clients should POST to `/api/plugins/silent-client/heartbeat` every ~1 second
- If no heartbeat for 5 seconds, client is considered disconnected
- Ghost spawns after 3 second debounce
- Ghost terminates after 3 second debounce when real client detected

### Safety Features

1. **Rate Limiting**: Max 3 ghost spawn attempts per minute
2. **Debouncing**: 3-second delays prevent rapid spawn/kill cycles
3. **Double-checking**: Verifies client state before major actions
4. **Graceful shutdown**: Clean termination of ghost clients

## API Endpoints

### GET `/api/plugins/silent-client/is-ghosted`

Check if the current client is ghosted.

**Response:**
```json
{
  "isGhosted": true,
  "state": "GHOST_ACTIVE"
}
```

### POST `/api/plugins/silent-client/heartbeat`

Real clients should call this endpoint every ~1 second to announce their presence.

**Response:**
```json
{
  "success": true
}
```

### GET `/api/plugins/silent-client/status`

Get detailed plugin status.

**Response:**
```json
{
  "isGhosted": true,
  "state": "GHOST_ACTIVE",
  "hasGhostBrowser": true
}
```

## Usage in Extensions

### Checking if Current Client is Ghosted

```javascript
// From a UI extension
async function checkIfGhosted() {
    const response = await fetch('/api/plugins/silent-client/is-ghosted');
    const data = await response.json();
    
    if (data.isGhosted) {
        console.log('Running in ghost client');
    } else {
        console.log('Running in real client');
    }
}
```

### Real Client Heartbeat

Real clients should send heartbeats to prevent ghost client from spawning:

```javascript
// Add this to your SillyTavern frontend code or extension
setInterval(async () => {
    try {
        await fetch('/api/plugins/silent-client/heartbeat', {
            method: 'POST'
        });
    } catch (err) {
        console.error('Failed to send heartbeat:', err);
    }
}, 1000); // Every second
```

### Extension Integration Example

```javascript
// In your extension's init function
async function initMyExtension() {
    const { isGhosted } = await fetch('/api/plugins/silent-client/is-ghosted')
        .then(r => r.json());
    
    if (isGhosted) {
        console.log('Extension running in ghost client - some features may be limited');
        // Adjust behavior accordingly
    }
    
    // Your extension logic...
}
```

## Configuration

The plugin uses these default values (can be modified in `index.js`):

```javascript
HEARTBEAT_CHECK_INTERVAL = 2000;  // 2 seconds
HEARTBEAT_TIMEOUT = 5000;         // 5 seconds
CLIENT_SPAWN_DEBOUNCE = 3000;     // 3 seconds
CLIENT_KILL_DEBOUNCE = 3000;      // 3 seconds
MAX_SPAWN_ATTEMPTS_PER_MINUTE = 3;
```

## Troubleshooting

### Ghost client not spawning

1. Check if server plugins are enabled in `config.yaml`
2. Check server logs for errors
3. Ensure puppeteer is installed: `npm install` in plugin directory
4. Verify no rate limiting is occurring

### Ghost client keeps spawning/killing

1. Ensure real clients are sending heartbeats
2. Check debounce timings
3. Review server logs for state transitions

### High resource usage

The ghost client is optimized with these flags:
- Headless mode
- GPU disabled
- Images disabled
- Extensions disabled
- Background networking disabled

If still too resource-intensive, consider:
- Increasing debounce timings
- Adjusting heartbeat intervals
- Using a lighter browser automation tool

## Development

### Running locally

```bash
npm install
# Place in SillyTavern/plugins/silent-client
# Restart SillyTavern
```

### Testing

Monitor plugin behavior:
```bash
# Watch server logs
tail -f server.log | grep SilentClient

# Check heartbeat file
watch -n 1 'stat .real_client_heartbeat'
```

## License

MIT

## Contributing

Contributions welcome! Please:
1. Test thoroughly
2. Update documentation
3. Follow existing code style
4. Add comments for complex logic

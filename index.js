const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

/**
 * SilentClient - Maintains a ghost SillyTavern client when no real client is active
 */

const HEARTBEAT_FILE = '.real_client_heartbeat';
const HEARTBEAT_CHECK_INTERVAL = 2000; // 2 seconds
const HEARTBEAT_TIMEOUT = 5000; // 5 seconds - if no heartbeat for this long, client is considered dead
const CLIENT_SPAWN_DEBOUNCE = 3000; // 3 seconds - wait before spawning ghost
const CLIENT_KILL_DEBOUNCE = 3000; // 3 seconds - wait before killing ghost
const MAX_SPAWN_ATTEMPTS_PER_MINUTE = 3;

class SilentClient {
    constructor(serverPort = 8000) {
        this.ghostBrowser = null;
        this.ghostPage = null;
        this.state = 'NO_CLIENT'; // NO_CLIENT, GHOST_ACTIVE, REAL_ACTIVE, TRANSITIONING
        this.heartbeatInterval = null;
        this.spawnTimeout = null;
        this.killTimeout = null;
        this.spawnAttempts = [];
        this.serverPort = serverPort;
        this.isGhosted = false;
    }

    /**
     * Initialize the plugin
     */
    async init() {
        console.log('[SilentClient] Initializing...');
        
        // Clean up any stale heartbeat file
        await this.cleanHeartbeat();
        
        // Start monitoring for real client
        this.startHeartbeatMonitor();
        
        // Initial check - if no real client, spawn ghost
        const hasRealClient = await this.checkRealClientActive();
        if (!hasRealClient) {
            await this.scheduleGhostSpawn();
        }
        
        console.log('[SilentClient] Initialized');
    }

    /**
     * Clean up heartbeat file
     */
    async cleanHeartbeat() {
        try {
            await fs.unlink(HEARTBEAT_FILE);
        } catch (err) {
            // File doesn't exist, that's fine
        }
    }

    /**
     * Check if a real client is active based on heartbeat
     */
    async checkRealClientActive() {
        try {
            const stats = await fs.stat(HEARTBEAT_FILE);
            const lastModified = stats.mtimeMs;
            const timeSinceHeartbeat = Date.now() - lastModified;
            
            return timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
        } catch (err) {
            // File doesn't exist = no real client
            return false;
        }
    }

    /**
     * Start monitoring for real client heartbeats
     */
    startHeartbeatMonitor() {
        this.heartbeatInterval = setInterval(async () => {
            const hasRealClient = await this.checkRealClientActive();
            
            if (hasRealClient && (this.state === 'GHOST_ACTIVE' || this.state === 'NO_CLIENT')) {
                console.log('[SilentClient] Real client detected');
                await this.scheduleGhostKill();
            } else if (!hasRealClient && (this.state === 'REAL_ACTIVE' || this.state === 'NO_CLIENT')) {
                console.log('[SilentClient] Real client disconnected');
                await this.scheduleGhostSpawn();
            }
        }, HEARTBEAT_CHECK_INTERVAL);
    }

    /**
     * Check spawn rate limit
     */
    canSpawn() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        // Clean old attempts
        this.spawnAttempts = this.spawnAttempts.filter(time => time > oneMinuteAgo);
        
        if (this.spawnAttempts.length >= MAX_SPAWN_ATTEMPTS_PER_MINUTE) {
            console.error('[SilentClient] Spawn rate limit exceeded! Too many spawn attempts.');
            return false;
        }
        
        this.spawnAttempts.push(now);
        return true;
    }

    /**
     * Schedule ghost client spawn with debounce
     */
    async scheduleGhostSpawn() {
        // Clear any existing spawn timeout
        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
        }

        // Clear any pending kill
        if (this.killTimeout) {
            clearTimeout(this.killTimeout);
            this.killTimeout = null;
        }

        this.state = 'TRANSITIONING';

        this.spawnTimeout = setTimeout(async () => {
            // Double-check real client isn't active
            const hasRealClient = await this.checkRealClientActive();
            if (!hasRealClient) {
                await this.spawnGhost();
            } else {
                this.state = 'REAL_ACTIVE';
            }
        }, CLIENT_SPAWN_DEBOUNCE);
    }

    /**
     * Schedule ghost client kill with debounce
     */
    async scheduleGhostKill() {
        // Clear any existing kill timeout
        if (this.killTimeout) {
            clearTimeout(this.killTimeout);
        }

        // Clear any pending spawn
        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
            this.spawnTimeout = null;
        }

        this.state = 'TRANSITIONING';

        this.killTimeout = setTimeout(async () => {
            // Double-check real client is still active
            const hasRealClient = await this.checkRealClientActive();
            if (hasRealClient) {
                await this.killGhost();
                this.state = 'REAL_ACTIVE';
            } else {
                // Real client disappeared during debounce, keep ghost
                this.state = 'GHOST_ACTIVE';
            }
        }, CLIENT_KILL_DEBOUNCE);
    }

    /**
     * Spawn the ghost client
     */
    async spawnGhost() {
        if (!this.canSpawn()) {
            console.error('[SilentClient] Cannot spawn ghost - rate limit exceeded');
            return;
        }

        if (this.ghostBrowser) {
            console.log('[SilentClient] Ghost already exists, skipping spawn');
            return;
        }

        try {
            console.log('[SilentClient] Spawning ghost client...');
            
            this.ghostBrowser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-sync',
                    '--mute-audio',
                    '--disable-animations',
                    '--disable-notifications',
                ]
            });

            this.ghostPage = await this.ghostBrowser.newPage();
            
            // Inject ghost client identifier
            await this.ghostPage.evaluateOnNewDocument(() => {
                window.isGhostClient = true;
                window.GHOST_CLIENT_ID = 'silent-client-ghost';
            });

            // Navigate to SillyTavern
            const url = `http://localhost:${this.serverPort}`;
            console.log(`[SilentClient] Navigating to ${url}`);
            await this.ghostPage.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait for app to initialize
            await this.ghostPage.waitForFunction(
                () => window.SillyTavern !== undefined || window.eventSource !== undefined,
                { timeout: 10000 }
            ).catch(() => {
                console.log('[SilentClient] Note: SillyTavern object not found, but page loaded');
            });

            this.state = 'GHOST_ACTIVE';
            this.isGhosted = true;
            console.log('[SilentClient] Ghost client spawned successfully');

        } catch (err) {
            console.error('[SilentClient] Error spawning ghost:', err);
            await this.killGhost();
            this.state = 'NO_CLIENT';
        }
    }

    /**
     * Kill the ghost client
     */
    async killGhost() {
        if (!this.ghostBrowser) {
            return;
        }

        try {
            console.log('[SilentClient] Killing ghost client...');
            await this.ghostBrowser.close();
            this.ghostBrowser = null;
            this.ghostPage = null;
            this.isGhosted = false;
            console.log('[SilentClient] Ghost client terminated');
        } catch (err) {
            console.error('[SilentClient] Error killing ghost:', err);
            // Force cleanup
            this.ghostBrowser = null;
            this.ghostPage = null;
            this.isGhosted = false;
        }
    }

    /**
     * Clean shutdown
     */
    async shutdown() {
        console.log('[SilentClient] Shutting down...');
        
        // Clear intervals and timeouts
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
        }
        if (this.killTimeout) {
            clearTimeout(this.killTimeout);
        }

        // Kill ghost if running
        await this.killGhost();
        
        // Clean heartbeat file
        await this.cleanHeartbeat();
        
        console.log('[SilentClient] Shutdown complete');
    }

    /**
     * Get current ghost status
     */
    getIsGhosted() {
        return this.isGhosted;
    }
}

// Singleton instance
let silentClientInstance = null;

/**
 * Initialize plugin
 * @param {import('express').Router} router Express router
 * @returns {Promise<void>}
 */
async function init(router) {
    // Get server port from environment or config
    const serverPort = process.env.SERVER_PORT || 8000;
    
    silentClientInstance = new SilentClient(serverPort);
    await silentClientInstance.init();

    // API endpoint to check if current client is ghosted
    router.get('/is-ghosted', (req, res) => {
        res.json({ 
            isGhosted: silentClientInstance.getIsGhosted(),
            state: silentClientInstance.state
        });
    });

    // API endpoint to manually trigger heartbeat (for real clients)
    router.post('/heartbeat', async (req, res) => {
        try {
            await fs.writeFile(HEARTBEAT_FILE, Date.now().toString());
            res.json({ success: true });
        } catch (err) {
            console.error('[SilentClient] Error writing heartbeat:', err);
            res.status(500).json({ error: 'Failed to write heartbeat' });
        }
    });

    // API endpoint to get plugin status
    router.get('/status', (req, res) => {
        res.json({
            isGhosted: silentClientInstance.getIsGhosted(),
            state: silentClientInstance.state,
            hasGhostBrowser: !!silentClientInstance.ghostBrowser
        });
    });

    console.log('[SilentClient] Plugin loaded');
}

/**
 * Clean up on exit
 * @returns {Promise<void>}
 */
async function exit() {
    if (silentClientInstance) {
        await silentClientInstance.shutdown();
    }
}

module.exports = {
    init,
    exit,
    info: {
        id: 'silent-client',
        name: 'SilentClient',
        description: 'Maintains a ghost SillyTavern client when no real client is active',
    },
};

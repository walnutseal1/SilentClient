const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

/**
 * SilentClient - Maintains a ghost SillyTavern client when no real client is active
 */

const HEARTBEAT_FILE = path.join(__dirname, '.real_client_heartbeat');
const HEARTBEAT_CHECK_INTERVAL = 2000; 
const HEARTBEAT_TIMEOUT = 5000; 
const CLIENT_SPAWN_DEBOUNCE = 3000; 
const CLIENT_KILL_DEBOUNCE = 3000; 
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

    async init() {
        console.log('[SilentClient] Initializing...');
        await this.cleanHeartbeat();
        this.startHeartbeatMonitor();
        
        const hasRealClient = await this.checkRealClientActive();
        if (!hasRealClient) {
            await this.scheduleGhostSpawn();
        }
        console.log('[SilentClient] Initialized');
    }

    async cleanHeartbeat() {
        try {
            await fs.unlink(HEARTBEAT_FILE);
        } catch (err) { /* Ignored */ }
    }

    async checkRealClientActive() {
        try {
            const stats = await fs.stat(HEARTBEAT_FILE);
            const timeSinceHeartbeat = Date.now() - stats.mtimeMs;
            return timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
        } catch (err) {
            return false;
        }
    }

    startHeartbeatMonitor() {
        this.heartbeatInterval = setInterval(async () => {
            const hasRealClient = await this.checkRealClientActive();
            
            if (hasRealClient && (this.state === 'GHOST_ACTIVE' || this.state === 'NO_CLIENT')) {
                console.log('[SilentClient] Real client detected via heartbeat');
                await this.scheduleGhostKill();
            } else if (!hasRealClient && (this.state === 'REAL_ACTIVE' || this.state === 'NO_CLIENT')) {
                console.log('[SilentClient] Real client heartbeat lost');
                await this.scheduleGhostSpawn();
            }
        }, HEARTBEAT_CHECK_INTERVAL);
    }

    canSpawn() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.spawnAttempts = this.spawnAttempts.filter(time => time > oneMinuteAgo);
        
        if (this.spawnAttempts.length >= MAX_SPAWN_ATTEMPTS_PER_MINUTE) {
            console.error('[SilentClient] Spawn rate limit exceeded!');
            return false;
        }
        this.spawnAttempts.push(now);
        return true;
    }

    async scheduleGhostSpawn() {
        if (this.spawnTimeout) clearTimeout(this.spawnTimeout);
        if (this.killTimeout) {
            clearTimeout(this.killTimeout);
            this.killTimeout = null;
        }

        this.state = 'TRANSITIONING';
        this.spawnTimeout = setTimeout(async () => {
            if (!(await this.checkRealClientActive())) {
                await this.spawnGhost();
            } else {
                this.state = 'REAL_ACTIVE';
            }
        }, CLIENT_SPAWN_DEBOUNCE);
    }

    async scheduleGhostKill() {
        if (this.killTimeout) clearTimeout(this.killTimeout);
        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
            this.spawnTimeout = null;
        }

        this.state = 'TRANSITIONING';
        this.killTimeout = setTimeout(async () => {
            if (await this.checkRealClientActive()) {
                await this.killGhost();
                this.state = 'REAL_ACTIVE';
            } else {
                this.state = 'GHOST_ACTIVE';
            }
        }, CLIENT_KILL_DEBOUNCE);
    }

    async spawnGhost() {
        if (!this.canSpawn() || this.ghostBrowser) return;

        try {
            console.log('[SilentClient] Spawning ghost browser...');
            this.ghostBrowser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--mute-audio',
                    '--disable-renderer-backgrounding',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows'
                ]
            });

            this.ghostPage = await this.ghostBrowser.newPage();
            
            // Identify this session so it doesn't trigger its own heartbeat logic
            await this.ghostPage.evaluateOnNewDocument(() => {
                window.isGhostClient = true;
            });

            const url = `http://localhost:${this.serverPort}`;
            await this.ghostPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            this.state = 'GHOST_ACTIVE';
            this.isGhosted = true;
            console.log('[SilentClient] Ghost client active at ' + url);
        } catch (err) {
            console.error('[SilentClient] Spawn failed:', err);
            await this.killGhost();
            this.state = 'NO_CLIENT';
        }
    }

    async killGhost() {
        if (!this.ghostBrowser) return;
        try {
            await this.ghostBrowser.close();
            console.log('[SilentClient] Ghost client terminated');
        } catch (err) {
            console.error('[SilentClient] Kill error:', err);
        } finally {
            this.ghostBrowser = null;
            this.ghostPage = null;
            this.isGhosted = false;
        }
    }

    async shutdown() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.spawnTimeout) clearTimeout(this.spawnTimeout);
        if (this.killTimeout) clearTimeout(this.killTimeout);
        await this.killGhost();
        await this.cleanHeartbeat();
    }
}

let silentClientInstance = null;

async function init(router) {
    const serverPort = process.env.PORT || 8000; // SillyTavern usually uses PORT
    silentClientInstance = new SilentClient(serverPort);
    await silentClientInstance.init();

    // 1. ENDPOINT: Heartbeat receiver
    router.post('/heartbeat', async (req, res) => {
        try {
            await fs.writeFile(HEARTBEAT_FILE, Date.now().toString());
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Heartbeat write failed' });
        }
    });

    // 2. ENDPOINT: The script that users run in their browser
    router.get('/script', (req, res) => {
        res.type('application/javascript');
        res.send(`
            (function() {
                if (window.isGhostClient) return; // Ghosts don't heartbeat
                console.log('[SilentClient] Heartbeat started');
                setInterval(() => {
                    fetch('/api/plugins/silent-client/heartbeat', { method: 'POST' })
                    .catch(err => console.error('Heartbeat failed', err));
                }, ${HEARTBEAT_CHECK_INTERVAL});
            })();
        `);
    });

    router.get('/status', (req, res) => {
        res.json({
            isGhosted: silentClientInstance.isGhosted,
            state: silentClientInstance.state
        });
    });
}

async function exit() {
    if (silentClientInstance) await silentClientInstance.shutdown();
}

module.exports = {
    init,
    exit,
    info: { id: 'silent-client', name: 'SilentClient', description: 'Keeps ST session alive via ghost Puppeteer' },
};

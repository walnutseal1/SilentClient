const puppeteer = require('puppeteer');
const path = require('path');

// Constants
const HEARTBEAT_TIMEOUT = 10000; // Increased to 10s for stability
const CHECK_INTERVAL = 2000;
const DEBOUNCE_TIME = 3000;

class SilentClient {
    constructor(serverPort = 8000) {
        this.ghostBrowser = null;
        this.state = 'NO_CLIENT'; 
        this.lastHeartbeat = 0; // IN-MEMORY TRACKING
        this.serverPort = serverPort;
        this.transitionTimeout = null;
    }

    async init() {
        console.log('[SilentClient] Initializing In-Memory Monitor...');
        this.startMonitor();
    }

    updateHeartbeat() {
        this.lastHeartbeat = Date.now();
    }

    isRealClientAlive() {
        return (Date.now() - this.lastHeartbeat) < HEARTBEAT_TIMEOUT;
    }

    startMonitor() {
        setInterval(async () => {
            const alive = this.isRealClientAlive();

            if (alive && (this.state === 'GHOST_ACTIVE' || this.state === 'NO_CLIENT')) {
                this.requestStateChange('REAL_ACTIVE');
            } else if (!alive && (this.state === 'REAL_ACTIVE' || this.state === 'NO_CLIENT')) {
                this.requestStateChange('GHOST_ACTIVE');
            }
        }, CHECK_INTERVAL);
    }

    requestStateChange(targetState) {
        if (this.state === 'TRANSITIONING' && this.pendingState === targetState) return;
        
        clearTimeout(this.transitionTimeout);
        this.state = 'TRANSITIONING';
        this.pendingState = targetState;

        this.transitionTimeout = setTimeout(async () => {
            if (targetState === 'GHOST_ACTIVE' && !this.isRealClientAlive()) {
                await this.spawnGhost();
            } else if (targetState === 'REAL_ACTIVE' && this.isRealClientAlive()) {
                await this.killGhost();
            }
            this.state = targetState;
        }, DEBOUNCE_TIME);
    }

    async spawnGhost() {
        if (this.ghostBrowser) return;
        try {
            console.log('[SilentClient] Spawning Ghost Browser...');
            this.ghostBrowser = await puppeteer.launch({
                headless: "new",
                handleSIGINT: true,
                handleSIGTERM: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--mute-audio']
            });
            const page = await this.ghostBrowser.newPage();
            await page.evaluateOnNewDocument(() => { window.isGhostClient = true; });
            
            const url = `http://localhost:${this.serverPort}`;
            await page.goto(url, { waitUntil: 'networkidle2' });
            console.log('[SilentClient] Ghost Active.');
        } catch (err) {
            console.error('[SilentClient] Spawn Failed:', err.message);
            this.ghostBrowser = null;
        }
    }

    async killGhost() {
        if (!this.ghostBrowser) return;
        try {
            await this.ghostBrowser.close();
            console.log('[SilentClient] Ghost Terminated.');
        } catch (err) {
            console.error('[SilentClient] Kill Error:', err);
        } finally {
            this.ghostBrowser = null;
        }
    }
}

let instance = null;

async function init(router) {
    const port = process.env.PORT || 8000;
    instance = new SilentClient(port);
    await instance.init();

    router.post('/heartbeat', (req, res) => {
        instance.updateHeartbeat();
        res.json({ success: true, ghosting: instance.state === 'GHOST_ACTIVE' });
    });

    router.get('/status', (req, res) => {
        res.json({ state: instance.state, realClientAlive: instance.isRealClientAlive() });
    });
}

module.exports = { init, exit: () => instance?.killGhost() };

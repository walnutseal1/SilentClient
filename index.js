const puppeteer = require('puppeteer');

const HEARTBEAT_TIMEOUT = 10000;
const CHECK_INTERVAL = 2000;
const DEBOUNCE_TIME = 3000;

class SilentClient {
    constructor(serverPort = 8000) {
        this.ghostBrowser = null;
        this.state = 'NO_CLIENT';
        this.lastHeartbeat = 0;
        this.serverPort = serverPort;
        this.transitionTimeout = null;
        this.pendingState = null;
        this.transitionToken = null;
        this.spawning = false;
        this.killing = false;
    }

    async init() {
        console.log('[SilentClient] Initializing In-Memory Monitor...');
        this.startMonitor();
    }

    updateHeartbeat(req) {
        if (req.headers['x-ghost-client']) return;
        this.lastHeartbeat = Date.now();
    }

    isRealClientAlive() {
        return (Date.now() - this.lastHeartbeat) < HEARTBEAT_TIMEOUT;
    }

    startMonitor() {
        setInterval(() => {
            const alive = this.isRealClientAlive();

            if (alive && (this.state === 'GHOST_ACTIVE' || this.state === 'NO_CLIENT')) {
                this.requestStateChange('REAL_ACTIVE');
            }

            if (!alive && (this.state === 'REAL_ACTIVE' || this.state === 'NO_CLIENT')) {
                this.requestStateChange('GHOST_ACTIVE');
            }
        }, CHECK_INTERVAL);
    }

    requestStateChange(targetState) {
        if (this.state === 'TRANSITIONING' && this.pendingState === targetState) return;

        clearTimeout(this.transitionTimeout);

        this.state = 'TRANSITIONING';
        this.pendingState = targetState;

        const token = Symbol();
        this.transitionToken = token;

        this.transitionTimeout = setTimeout(async () => {
            if (this.transitionToken !== token) return;

            try {
                if (targetState === 'GHOST_ACTIVE' && !this.isRealClientAlive()) {
                    await this.spawnGhost();
                }

                if (targetState === 'REAL_ACTIVE' && this.isRealClientAlive()) {
                    await this.killGhost();
                }

                this.state = targetState;
            } catch (err) {
                console.error('[SilentClient] Transition error:', err.message);
                this.state = 'NO_CLIENT';
            } finally {
                this.pendingState = null;
                this.transitionToken = null;
            }
        }, DEBOUNCE_TIME);
    }

    async spawnGhost() {
        if (this.ghostBrowser || this.spawning) return;

        this.spawning = true;
        let browser = null;

        try {
            console.log('[SilentClient] Spawning Ghost Browser...');
            browser = await puppeteer.launch({
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
            const page = await browser.newPage();

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(window, 'isGhostClient', {
                    value: true,
                    writable: false,
                    configurable: false
                });

                const originalFetch = window.fetch;
                window.fetch = function (...args) {
                    args[1] = args[1] || {};
                    args[1].headers = {
                        ...(args[1].headers || {}),
                        'x-ghost-client': '1'
                    };
                    return originalFetch.apply(this, args);
                };
            });

            const url = `http://localhost:${this.serverPort}`;
            await page.goto(url, { waitUntil: 'networkidle2' });

            this.ghostBrowser = browser;
            console.log('[SilentClient] Ghost Active.');
        } catch (err) {
            console.error('[SilentClient] Spawn error:', err.message);
            if (browser) {
                try {
                    await browser.close();
                } catch {}
            }
            throw err;
        } finally {
            this.spawning = false;
        }
    }

    async killGhost() {
        if (!this.ghostBrowser || this.killing) return;

        this.killing = true;
        const browser = this.ghostBrowser;
        this.ghostBrowser = null;

        try {
            await browser.close();
            console.log('[SilentClient] Ghost Terminated.');
        } catch (err) {
            console.error('[SilentClient] Kill Error:', err.message);
        } finally {
            this.killing = false;
        }
    }
}

let instance = null;

async function init(router) {
    const port = process.env.PORT || 8000;
    instance = new SilentClient(port);
    await instance.init();

    router.post('/heartbeat', (req, res) => {
        instance.updateHeartbeat(req);
        res.json({
            success: true,
            ghosting: instance.state === 'GHOST_ACTIVE'
        });
    });

    router.get('/status', (req, res) => {
        res.json({
            state: instance.state,
            realClientAlive: instance.isRealClientAlive()
        });
    });

    process.on('SIGTERM', async () => {
        await instance?.killGhost();
        process.exit(0);
    });
}

module.exports = {
    init,
    exit: () => instance?.killGhost()
};

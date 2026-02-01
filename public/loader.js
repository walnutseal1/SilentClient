(function () {
    // ---- HARD SINGLETON GUARD ----
    if (window.__silentClientInitialized) return;
    window.__silentClientInitialized = true;

    // ---- IMMEDIATE GHOST EXIT (RACE-SAFE) ----
    if (window.isGhostClient === true) {
        console.log('[SilentClient] Ghost session detected. Heartbeat suppressed.');
        return;
    }

    const HEARTBEAT_URL = '/api/plugins/silent-client/heartbeat';
    const INTERVAL_MS = 2000;

    let worker;
    let workerUrl;

    const blob = new Blob([`
        let interval = null;

        self.onmessage = function (e) {
            if (e.data.action === 'start') {
                if (interval) clearInterval(interval);

                interval = setInterval(() => {
                    fetch(e.data.url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: '{}'
                    })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (data) self.postMessage(data);
                    })
                    .catch(() => {});
                }, e.data.ms);
            }

            if (e.data.action === 'stop') {
                if (interval) clearInterval(interval);
                interval = null;
            }
        };
    `], { type: 'text/javascript' });

    workerUrl = URL.createObjectURL(blob);
    worker = new Worker(workerUrl);

    worker.postMessage({
        action: 'start',
        url: HEARTBEAT_URL,
        ms: INTERVAL_MS
    });

    worker.onmessage = function (e) {
        if (e.data?.ghosting) {
            console.log('[SilentClient] Real client reclaimed session.');
        }
    };

    const cleanup = () => {
        try {
            worker.postMessage({ action: 'stop' });
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
        } catch {}
    };

    window.addEventListener('unload', cleanup);
    window.addEventListener('pagehide', cleanup);

    console.log('[SilentClient] Background Heartbeat Worker initialized.');
})();

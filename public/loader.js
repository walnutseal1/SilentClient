(function() {
    // 1. Immediate Ghost Exit
    // This is the most critical check to prevent the Ghost from keeping itself alive.
    if (window.isGhostClient || window.name === 'ghost-browser') {
        console.log('[SilentClient] Ghost session detected. Heartbeat suppressed.');
        return;
    }

    const HEARTBEAT_URL = '/api/plugins/silent-client/heartbeat';
    const INTERVAL_MS = 2000;

    /**
     * Using a Web Worker to bypass browser tab throttling.
     * This ensures heartbeats continue even if the tab is minimized.
     */
    const blob = new Blob([`
        let interval = null;
        self.onmessage = function(e) {
            if (e.data.action === 'start') {
                interval = setInterval(() => {
                    fetch(e.data.url, { method: 'POST' })
                        .then(r => r.json())
                        .then(data => self.postMessage(data))
                        .catch(() => {}); 
                }, e.data.ms);
            } else if (e.data.action === 'stop') {
                clearInterval(interval);
            }
        };
    `], { type: 'text/javascript' });

    const worker = new Worker(URL.createObjectURL(blob));

    // 2. Start the heartbeat
    worker.postMessage({ 
        action: 'start', 
        url: HEARTBEAT_URL, 
        ms: INTERVAL_MS 
    });

    // 3. Handle messages back from the worker (Optional)
    worker.onmessage = function(e) {
        if (e.data.ghosting) {
            // If the server tells us a Ghost was active, we know we've just 
            // successfully "taken back" the session.
            console.log('[SilentClient] Real client regained control from Ghost.');
        }
    };

    // 4. Cleanup on tab close
    window.addEventListener('beforeunload', () => {
        worker.postMessage({ action: 'stop' });
    });

    console.log('[SilentClient] Background Heartbeat Worker initialized.');
})();

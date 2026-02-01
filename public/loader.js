(function() {
    console.log('[SilentClient] Plugin Loader Active');

    // 1. Ghost Detection: Prevent infinite loops
    if (window.isGhostClient) {
        console.log('[SilentClient] Ghost detected. Heartbeat suppressed.');
        return;
    }

    // 2. Web Worker Blob: This allows us to run background logic 
    // without needing a separate physical .js file.
    const workerCode = `
        let intervalId = null;
        
        self.onmessage = function(e) {
            if (e.data.action === 'start') {
                if (intervalId) clearInterval(intervalId);
                
                const send = () => {
                    fetch(e.data.url, { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ts: Date.now() })
                    }).catch(() => {}); // Silent catch to prevent console clutter
                };

                send(); // Initial heartbeat
                intervalId = setInterval(send, e.data.interval);
            } else if (e.data.action === 'stop') {
                clearInterval(intervalId);
            }
        };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    // 3. Heartbeat Config
    const config = {
        action: 'start',
        url: '/api/plugins/silent-client/heartbeat',
        interval: 2000 
    };

    // 4. Intelligent Tab Management
    // We start the worker immediately.
    worker.postMessage(config);

    // Optional: If you want to be "polite" to the server, 
    // you could slow down heartbeats when the tab is hidden, 
    // but with a Ghost Client system, it's safer to keep them constant.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Wake up immediately on tab focus to ensure the Ghost kills itself fast
            worker.postMessage(config);
        }
    });

    window.addEventListener('beforeunload', () => {
        worker.postMessage({ action: 'stop' });
    });

})();

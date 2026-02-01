(function() {
    console.log('[SilentClient] Plugin Loader Active');

    // 1. Check if we are the Ghost. If so, don't start heartbeats.
    // The backend injects this variable into the Puppeteer instance.
    if (window.isGhostClient) {
        console.log('[SilentClient] Ghost detected. Heartbeat suppressed.');
        return;
    }

    // 2. Define the heartbeat function
    async function sendHeartbeat() {
        try {
            await fetch('/api/plugins/silent-client/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            console.warn('[SilentClient] Heartbeat failed (Server might be restarting)');
        }
    }

    // 3. Start the loop (Every 2 seconds)
    // We send one immediately, then start the interval
    sendHeartbeat();
    setInterval(sendHeartbeat, 2000);
})();

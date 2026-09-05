// Stockage des connexions TW et de leur activité
const twConnections = {};

function connectTW(projectId) {
    if (twConnections[projectId]?.ws?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('wss://clouddata.turbowarp.org');

    twConnections[projectId] = {
        ws,
        lastActivity: twConnections[projectId]?.lastActivity ?? null
    };

    ws.onopen = () => {
        ws.send(JSON.stringify({
            method:     'handshake',
            project_id: String(projectId),
            user:       'scratchping-viewer',
            purpose:    'ScratchPing activity tracker',
            contact:    'scratch.mit.edu/users/ma33-ma'
        }));
    };

    ws.onmessage = (event) => {
        try {
            const lines = event.data.split('\n').filter(Boolean);
            lines.forEach(line => {
                const msg = JSON.parse(line);
                if (msg.method === 'set') {
                    twConnections[projectId].lastActivity = Date.now();
                }
            });
        } catch {}
    };

    ws.onclose = () => {
        setTimeout(() => connectTW(projectId), 3000);
    };

    ws.onerror = () => ws.close();
}

function isTWActive(projectId) {
    const conn = twConnections[projectId];
    if (!conn?.lastActivity) return false;
    return (Date.now() - conn.lastActivity) < 5 * 60 * 1000;
}

function ensureTWConnections(projectIds) {
    projectIds.forEach(id => connectTW(id));
    Object.keys(twConnections).forEach(id => {
        if (!projectIds.includes(parseInt(id))) {
            twConnections[id]?.ws?.close();
            delete twConnections[id];
        }
    });
}

// Écoute les messages du background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'offscreen') return;

    if (msg.type === 'ENSURE_TW_CONNECTIONS') {
        ensureTWConnections(msg.projectIds);
        sendResponse(true);
        return true;
    }
    if (msg.type === 'GET_TW_ACTIVE') {
        sendResponse(isTWActive(msg.projectId));
        return true;
    }
});

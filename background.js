// =====================
// KEEPALIVE
// =====================

chrome.runtime.onConnect.addListener(port => {
    port.onDisconnect.addListener(() => {});
});

// =====================
// ALARMS KEEPALIVE
// =====================

chrome.alarms.create('twKeepAlive', { periodInMinutes: 0.3 });

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'twKeepAlive') {
        chrome.storage.local.get('projects', data => {
            const ids = (data.projects ?? []).map(p => p.id);
            ids.forEach(id => connectTW(id));
        });
    }
});

// =====================
// AUTH SCRATCH
// =====================

async function getScratchSession() {
    return new Promise((resolve) => {
        chrome.cookies.get(
            { url: 'https://scratch.mit.edu', name: 'scratchsessionsid' },
            (cookie) => resolve(cookie?.value ?? null)
        );
    });
}

// =====================
// SCRATCH CLOUD LOGS (HTTP)
// =====================

async function fetchScratchLogs(projectId, sessionId) {
    try {
        const res = await fetch(
            `https://clouddata.scratch.mit.edu/logs?projectid=${projectId}&limit=100&offset=0`,
            {
                headers: {
                    'Cookie': `scratchsessionsid=${sessionId}; scratchcsrftoken=a`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': 'Mozilla/5.0'
                }
            }
        );
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

// =====================
// CHECK CLOUD VARS
// =====================

async function checkCloudVars(projectId) {
    try {
        const sessionId = await getScratchSession();
        const res = await fetch(
            `https://clouddata.scratch.mit.edu/logs?projectid=${projectId}&limit=1`,
            {
                headers: {
                    'Cookie': `scratchsessionsid=${sessionId}; scratchcsrftoken=a`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': 'Mozilla/5.0'
                }
            }
        );
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data); // true si le projet a des cloud vars
    } catch {
        return false;
    }
}

// =====================
// TURBOWARP (WebSocket)
// =====================

const twConnections = {};

async function saveTWActivity(projectId) {
    await chrome.storage.local.set({ [`tw_${projectId}`]: Date.now() });
}

async function getTWActivity(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get(`tw_${projectId}`, data => {
            resolve(data[`tw_${projectId}`] ?? null);
        });
    });
}

function connectTW(projectId) {
    if (twConnections[projectId]?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('wss://clouddata.turbowarp.org');
    twConnections[projectId] = ws;

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
                    saveTWActivity(projectId);
                }
            });
        } catch {}
    };

    ws.onclose = () => {
        delete twConnections[projectId];
        setTimeout(() => connectTW(projectId), 3000);
    };

    ws.onerror = () => ws.close();
}

async function isTWActive(projectId) {
    const lastActivity = await getTWActivity(projectId);
    if (!lastActivity) return false;
    return (Date.now() - lastActivity) < 5 * 60 * 1000;
}

function ensureTWConnections(projectIds) {
    projectIds.forEach(id => connectTW(id));
    Object.keys(twConnections).forEach(id => {
        if (!projectIds.includes(parseInt(id))) {
            twConnections[id]?.close();
            delete twConnections[id];
        }
    });
}

// =====================
// API SCRATCH
// =====================

async function fetchProjectInfo(projectId, sessionId) {
    try {
        const res = await fetch(`https://api.scratch.mit.edu/projects/${projectId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `scratchsessionsid=${sessionId}; scratchcsrftoken=a`
            }
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.id) return null;
        return { id: data.id, name: data.title, views: data.stats?.views ?? '?' };
    } catch {
        return null;
    }
}

// =====================
// MESSAGE HANDLER
// =====================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
        sendResponse(true);
        return true;
    }
    if (msg.type === 'GET_SESSION') {
        getScratchSession().then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_SCRATCH_LOGS') {
        fetchScratchLogs(msg.projectId, msg.sessionId).then(sendResponse);
        return true;
    }
    if (msg.type === 'CHECK_CLOUD_VARS') {
        checkCloudVars(msg.projectId).then(sendResponse);
        return true;
    }
    if (msg.type === 'ENSURE_TW_CONNECTIONS') {
        ensureTWConnections(msg.projectIds);
        sendResponse(true);
        return true;
    }
    if (msg.type === 'GET_TW_ACTIVE') {
        isTWActive(msg.projectId).then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_PROJECT_INFO') {
        fetchProjectInfo(msg.projectId, msg.sessionId).then(sendResponse);
        return true;
    }
    if (msg.type === 'NOTIFY') {
        chrome.notifications.create({
            type:     'basic',
            iconUrl:  'icons/icon48.png',
            title:    'ScratchPing !',
            message:  msg.body
        });
        sendResponse(true);
        return true;
    }
});
console.info('ScratchPing: background script loaded.');

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
chrome.alarms.create('checkNotifs', { periodInMinutes: 0.5 }); // toutes les 30s

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'twKeepAlive') {
        chrome.storage.local.get('projects', data => {
            const ids = (data.projects ?? []).map(p => p.id);
            ids.forEach(id => connectTW(id));
        });
    }
    if (alarm.name === 'checkNotifs') {
        checkAndNotify();
    }
});

// =====================
// NOTIFICATION LOGIC
// =====================

// { projectId: { players: Set<string>, lastNotifTime: number } }
const notifState = {};

async function checkAndNotify() {
    const data = await new Promise(resolve => {
        chrome.storage.local.get(['projects', 'notifiedProjects', 'notifState'], resolve);
    });

    if (!data) return;

    const projects         = data.projects ?? [];
    const notifiedProjects = data.notifiedProjects ?? [];
    if (notifiedProjects.length === 0) return;

    const sessionId = await getScratchSession();
    if (!sessionId) return;

    // notifState persisté dans storage : { [projectId]: { players: string[], lastNotifTime: number } }
    const persistedState = data.notifState ?? {};

    const FIVE_MIN = 5 * 60 * 1000;
    const COOLDOWN = 30 * 1000;
    const now = Date.now();

    for (const project of projects) {
        if (!notifiedProjects.some(pid => String(pid) === String(project.id))) continue;

        const logs = await fetchScratchLogs(project.id, sessionId);
        const activePlayers = new Set(
            (logs ?? [])
                .filter(log => {
                    const tsMs = log.timestamp < 1e10 ? log.timestamp * 1000 : log.timestamp;
                    return (now - tsMs) < FIVE_MIN;
                })
                .map(log => log.user)
                .filter(Boolean)
        );

        const prev = persistedState[project.id] ?? { players: [], lastNotifTime: 0 };
        const prevPlayers = new Set(prev.players);

        // Nouveaux joueurs = présents maintenant, absents au check précédent
        const newPlayers = [...activePlayers].filter(p => !prevPlayers.has(p));

        const wasEmpty   = prevPlayers.size === 0;
        const cooldownOk = (now - prev.lastNotifTime) > COOLDOWN;

        if (newPlayers.length > 0 && wasEmpty && cooldownOk) {
            const playerName = newPlayers[0];
            persistedState[project.id] = {
                players: [...activePlayers],
                lastNotifTime: now
            };
            chrome.notifications.create(`notif_${project.id}_${now}`, {
                type:    'basic',
                iconUrl: 'icons/icon48.png',
                title:   'ScratchPing',
                message: `"${playerName}" joue au projet "${project.name}" !`
            });
        } else {
            persistedState[project.id] = {
                players: [...activePlayers],
                lastNotifTime: prev.lastNotifTime
            };
        }
    }

    // Sauvegarde l'état pour le prochain cycle
    await chrome.storage.local.set({ notifState: persistedState });
}

// =====================
// AUTH SCRATCH
// =====================

async function getScratchSession() {
    console.info('ScratchPing: looking up the Scratch session cookie.');
    return new Promise((resolve) => {
        // Firefox is more reliable with a domain query than a URL query here:
        // the Scratch session cookie can have a domain/path that differs from
        // the page currently open in the tab.
        chrome.cookies.getAll(
            { domain: 'scratch.mit.edu', name: 'scratchsessionsid' },
            (cookies) => {
                if (chrome.runtime.lastError) {
                    console.warn('ScratchPing: unable to read Scratch cookies.', chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }

                console.info(`ScratchPing: ${cookies.length} Scratch session cookie(s) found.`);

                const cookie = cookies
                    .filter(item => item.value)
                    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
                console.info(`ScratchPing: session ${cookie ? 'available' : 'unavailable'}.`);
                resolve(cookie?.value ?? null);
            }
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
        return Array.isArray(data);
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

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PING') {
        // pass
    }
    if (msg.type === 'GET_SESSION') {
        console.info('ScratchPing: GET_SESSION message received.');
        return getScratchSession().then(sessionId => {
            console.info(`ScratchPing: sending ${sessionId ? 'a session' : 'no session'} to the popup.`);
            return sessionId;
        });
    }
    if (msg.type === 'GET_SCRATCH_LOGS') {
        return fetchScratchLogs(msg.projectId, msg.sessionId);
    }
    if (msg.type === 'CHECK_CLOUD_VARS') {
        return checkCloudVars(msg.projectId);
    }
    if (msg.type === 'ENSURE_TW_CONNECTIONS') {
        ensureTWConnections(msg.projectIds);
    }
    if (msg.type === 'GET_TW_ACTIVE') {
        return isTWActive(msg.projectId);
    }
    if (msg.type === 'GET_PROJECT_INFO') {
        return fetchProjectInfo(msg.projectId, msg.sessionId);
    }
    if (msg.type === 'NOTIFY') {
        chrome.notifications.create({
            type:    'basic',
            iconUrl: 'icons/icon48.png',
            title:   'ScratchPing !',
            message: msg.body
        });
    }
});

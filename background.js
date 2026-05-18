// Garde le service worker éveillé
chrome.runtime.onConnect.addListener(port => {
    port.onDisconnect.addListener(() => {});
});

async function getScratchSession() {
    return new Promise((resolve) => {
        chrome.cookies.get(
            { url: 'https://scratch.mit.edu', name: 'scratchsessionsid' },
            (cookie) => resolve(cookie?.value ?? null)
        );
    });
}

async function fetchCloudLogs(projectId, sessionId) {
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
        return {
            id:    data.id,
            name:  data.title,
            views: data.stats?.views ?? '?'
        };
    } catch (e) {
        console.error('fetchProjectInfo error:', e);
        return null;
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
        sendResponse(true);
        return true;
    }
    if (msg.type === 'GET_SESSION') {
        getScratchSession().then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_CLOUD_LOGS') {
        fetchCloudLogs(msg.projectId, msg.sessionId).then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_PROJECT_INFO') {
        fetchProjectInfo(msg.projectId, msg.sessionId).then(sendResponse);
        return true;
    }
    if (msg.type === 'NOTIFY') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'ScratchPing !',
            message: msg.body
        });
        sendResponse(true);
        return true;
    }
});
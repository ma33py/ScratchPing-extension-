// Extrait l'ID du projet depuis l'URL
function getProjectId() {
    const match = location.pathname.match(/\/projects\/(\d+)/) 
               ?? location.pathname.match(/^\/(\d+)/);
    return match ? match[1] : null;
}

// Demande les logs Cloud au background script
async function fetchProjectLogs(projectId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (sessionId) => {
            if (!sessionId) { resolve([]); return; }
            chrome.runtime.sendMessage({ type: 'GET_SCRATCH_LOGS', projectId, sessionId }, (logs) => {
                resolve(logs ?? []);
            });
        });
    });
}

// Calcule la liste des joueurs actifs (connectés depuis moins de 5 minutes)
function getActivePlayers(logs) {
    const CINQ_MIN = 5 * 60 * 1000;
    const maintenant = Date.now();
    const joueurs = new Map();

    logs.forEach(log => {
        const timestamp = new Date(log.timestamp).getTime();
        if (maintenant - timestamp < CINQ_MIN) {
            if (!joueurs.has(log.user) || timestamp > joueurs.get(log.user)) {
                joueurs.set(log.user, timestamp);
            }
        }
    });

    return Array.from(joueurs.keys());
}

// Vérifie si le projet est enregistré localement
async function isAlreadyAdded(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => {
            const projects = data.projects ?? [];
            resolve(projects.some(p => String(p.id) === String(projectId)));
        });
    });
}

async function addProject(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', async data => {
            const projects = data.projects ?? [];
            if (projects.some(p => String(p.id) === String(projectId))) { resolve(false); return; }
            try {
                const res  = await fetch(`https://api.scratch.mit.edu/projects/${projectId}`);
                const info = await res.json();
                const name = info.title
                    .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/#\S+/g, '')
                    .replace(/\s*v?\d+(\.\d+)+\s*/gi, '').replace(/\s+(alpha|beta|bêta)\s*$/i, '')
                    .replace(/\s+/g, ' ').trim();
                projects.push({ id: parseInt(projectId), name });
                chrome.storage.local.set({ projects }, () => resolve(true));
            } catch { resolve(false); }
        });
    });
}

async function removeProject(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => {
            let projects = data.projects ?? [];
            projects = projects.filter(p => String(p.id) !== String(projectId));
            chrome.storage.local.set({ projects }, () => resolve(true));
        });
    });
}

// Crée ou met à jour le bouton de contrôle
async function updateButtonState(projectId) {
    const alreadyAdded = await isAlreadyAdded(projectId);
    let btn = document.getElementById('scratchping-btn');
    
    if (!btn) {
        const projectButtons = document.querySelector('.project-buttons');
        if (!projectButtons) return;

        btn = document.createElement('button');
        btn.id = 'scratchping-btn';
        btn.className = 'button';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '6px';
        btn.style.marginLeft = '10px';
        btn.style.transition = 'background-color 150ms, color 150ms, border-color 150ms';
        
        projectButtons.appendChild(btn);

        btn.addEventListener('click', async () => {
            const currentStatus = await isAlreadyAdded(projectId);
            btn.disabled = true;
            btn.style.opacity = "0.5";
            if (currentStatus) { await removeProject(projectId); } 
            else { await addProject(projectId); }
            btn.disabled = false;
            btn.style.opacity = "1";
            updateButtonState(projectId);
        });
    }

    const iconUrl = chrome.runtime.getURL('icons/icon16_normal.png');
    const imgHtml = `<img src="${iconUrl}" style="width: 14px; height: 14px; display: inline-block; pointer-events: none; margin-right: 2px;">`;

    if (alreadyAdded) {
        btn.innerHTML = `${imgHtml}<span>Delete</span>`;
        btn.style.color = '#ff4d4d';
        btn.style.backgroundColor = '#ffffff';
        btn.onmouseenter = () => { btn.style.backgroundColor = '#fff0f0'; btn.style.borderColor = '#ff4d4d'; };
        btn.onmouseleave = () => { btn.style.backgroundColor = '#ffffff'; btn.style.borderColor = 'rgba(0, 0, 0, 0.1)'; };
    } else {
        btn.innerHTML = `${imgHtml}<span>Add</span>`;
        btn.style.color = '#575e75';
        btn.style.backgroundColor = '#ffffff';
        btn.onmouseenter = () => { btn.style.backgroundColor = '#f2f2f2'; };
        btn.onmouseleave = () => { btn.style.backgroundColor = '#ffffff'; };
    }
}

// Crée ou met à jour le composant de la liste des joueurs connectés
async function updatePlayersList(projectId) {
    const extensionList = document.querySelector('.extension-list');
    if (!extensionList) return;

    let playersChip = document.getElementById('scratchping-players-chip');
    
    // Si la puce n'existe pas encore dans la liste des extensions, on la génère au même style
    if (!playersChip) {
        playersChip = document.createElement('div');
        playersChip.id = 'scratchping-players-chip';
        playersChip.className = 'extension-chip';
        playersChip.style.borderColor = '#855cd6'; // Ajoute une nuance violette ScratchPing discrète
        extensionList.appendChild(playersChip);
    }

    const logs = await fetchProjectLogs(projectId);
    const activePlayers = getActivePlayers(logs);

    const defaultIconUrl = chrome.runtime.getURL('icons/icon16_normal.png');

    if (activePlayers.length === 0) {
        playersChip.innerHTML = `
            <img class="extension-icon" src="${defaultIconUrl}" style="filter: grayscale(1);">
            <div class="extension-content">
                <span style="font-weight: bold; color: #575e75;">Live Players</span>
                <div style="font-size: 11px; color: #999;">0 players connected</div>
            </div>
        `;
    } else {
        // Crée une liste HTML cliquable menant vers les profils des joueurs connectés
        const playersLinks = activePlayers.map(user => {
            return `<a href="/users/${user}/" target="_blank" style="color: #855cd6; font-weight: 600; text-decoration: none; hover: text-decoration: underline;">@${user}</a>`;
        }).join(', ');

        playersChip.innerHTML = `
            <img class="extension-icon" src="${defaultIconUrl}">
            <div class="extension-content" style="width: 100%;">
                <span style="font-weight: bold; color: #855cd6;">🟢 Live Players (${activePlayers.length})</span>
                <div style="font-size: 12px; color: #575e75; margin-top: 4px; line-height: 1.4; word-break: break-word;">
                    ${playersLinks}
                </div>
            </div>
        `;
    }
}

// Boucle principale d'analyse
setInterval(() => {
    const projectId = getProjectId();
    if (projectId) {
        updateButtonState(projectId);
        updatePlayersList(projectId);
    }
}, 1500);
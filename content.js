// Extrait l'ID du projet depuis l'URL
function getProjectId() {
    const match = location.pathname.match(/\/projects\/(\d+)/) 
               ?? location.pathname.match(/^\/(\d+)/);
    return match ? match[1] : null;
}

// Vérifie si le projet a des variables cloud
async function hasCloudVars(projectId) {
    try {
        const res  = await fetch(`https://api.scratch.mit.edu/projects/${projectId}`);
        const data = await res.json();
        // Cherche dans les assets ou via clouddata
        const logsRes = await fetch(`https://clouddata.scratch.mit.edu/logs?projectid=${projectId}&limit=1`);
        // Si la réponse est OK et contient du JSON, le projet a des cloud vars
        if (logsRes.ok) {
            const logs = await logsRes.json();
            return Array.isArray(logs); // true si le projet supporte les cloud vars
        }
        return false;
    } catch {
        return false;
    }
}

// Vérifie si le projet est déjà dans ScratchPing
async function isAlreadyAdded(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => {
            const projects = data.projects ?? [];
            resolve(projects.some(p => String(p.id) === String(projectId)));
        });
    });
}

// Ajoute le projet à ScratchPing
async function addProject(projectId) {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', async data => {
            const projects = data.projects ?? [];
            if (projects.some(p => String(p.id) === String(projectId))) {
                resolve(false);
                return;
            }

            try {
                const res  = await fetch(`https://api.scratch.mit.edu/projects/${projectId}`);
                const info = await res.json();
                const name = info.title
                    .replace(/\(.*?\)/g, '')
                    .replace(/\[.*?\]/g, '')
                    .replace(/#\S+/g, '')
                    .replace(/\s*v?\d+(\.\d+)+\s*/gi, '')
                    .replace(/\s+(alpha|beta|bêta)\s*$/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                projects.push({ id: parseInt(projectId), name });
                chrome.storage.local.set({ projects }, () => resolve(true));
            } catch {
                resolve(false);
            }
        });
    });
}

// Crée et injecte le bouton
async function injectButton(projectId) {
    // Évite les doublons
    if (document.getElementById('scratchping-btn')) return;

    const alreadyAdded = await isAlreadyAdded(projectId);

    const btn = document.createElement('button');
    btn.id = 'scratchping-btn';
    btn.innerHTML = alreadyAdded
        ? `<img src="${chrome.runtime.getURL('icons/icon16_normal.png')}" style="width:14px;vertical-align:middle;margin-right:5px"> Already in ScratchPing`
        : `<img src="${chrome.runtime.getURL('icons/icon16_normal.png')}" style="width:14px;vertical-align:middle;margin-right:5px"> Add to ScratchPing`;

    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        background: ${alreadyAdded ? '#e8e0f8' : '#855cd6'};
        color: ${alreadyAdded ? '#855cd6' : 'white'};
        border: none;
        border-radius: 12px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
        font-family: 'Outfit', sans-serif;
        cursor: ${alreadyAdded ? 'default' : 'pointer'};
        box-shadow: 0 4px 16px rgba(133,92,214,0.35);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 200ms, transform 100ms;
    `;

    if (!alreadyAdded) {
        btn.addEventListener('mouseenter', () => btn.style.background = '#7048c8');
        btn.addEventListener('mouseleave', () => btn.style.background = '#855cd6');
        btn.addEventListener('mousedown',  () => btn.style.transform  = 'scale(0.97)');
        btn.addEventListener('mouseup',    () => btn.style.transform  = 'scale(1)');

        btn.addEventListener('click', async () => {
            btn.innerHTML = '⏳ Adding...';
            btn.style.background = '#aaa';
            btn.style.cursor     = 'default';

            const success = await addProject(projectId);

            if (success) {
                btn.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon16_normal.png')}" style="width:14px;vertical-align:middle;margin-right:5px"> ✓ Added to ScratchPing!`;
                btn.style.background = '#e8e0f8';
                btn.style.color      = '#855cd6';
            } else {
                btn.innerHTML = '❌ Error';
                btn.style.background = '#fde';
                btn.style.color      = '#e74c3c';
            }
        });
    }

    // Cherche la div project-buttons (boutons Scratch : Remix, See inside...)
    const projectButtons = document.querySelector('.project-buttons');
    if (projectButtons) {
        // Retire le style fixed pour s'intégrer dans la page
        btn.style.cssText = `
            background: ${alreadyAdded ? '#e8e0f8' : '#855cd6'};
            color: ${alreadyAdded ? '#855cd6' : 'white'};
            border: none;
            border-radius: 8px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 600;
            font-family: sans-serif;
            cursor: ${alreadyAdded ? 'default' : 'pointer'};
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 8px;
            transition: background 200ms;
        `;
        projectButtons.appendChild(btn);
    } else {
        // Fallback : fixed en bas à droite
        document.body.appendChild(btn);
    }
}

// Attend qu'un élément apparaisse dans le DOM
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) { resolve(el); return; }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { observer.disconnect(); resolve(el); }
        });
        observer.observe(document.body, { subtree: true, childList: true });
        setTimeout(() => { observer.disconnect(); reject(); }, timeout);
    });
}

// Point d'entrée
async function main() {
    const projectId = getProjectId();
    if (!projectId) return;

    try {
        await waitForElement('.project-buttons');
    } catch {
        return; // div pas trouvée dans les 10s
    }

    const hasCloud = await hasCloudVars(projectId);
    if (hasCloud) {
        injectButton(projectId);
    }
}

main();

// Écoute les changements d'URL (SPA navigation sur Scratch)
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.getElementById('scratchping-btn')?.remove();
        main();
    }
}).observe(document.body, { subtree: true, childList: true });
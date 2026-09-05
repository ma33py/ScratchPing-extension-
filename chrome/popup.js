// =====================
// STATE
// =====================

const CINQ_MIN = 5 * 60 * 1000;
let currentSort = 'activity';
let sessionId   = null;
let pseudo      = null;

// =====================
// ICÔNE DE L'EXTENSION
// =====================

function setIcon(etat) {
    chrome.action.setIcon({
        path: {
            16:  `icons/icon16_${etat}.png`,
            48:  `icons/icon48_${etat}.png`,
            128: `icons/icon128_${etat}.png`
        }
    });
}

// =====================
// KEEPALIVE + MESSAGE
// =====================

const port = chrome.runtime.connect({ name: 'keepAlive' });

async function sendMsg(msg) {
    try {
        return await chrome.runtime.sendMessage(msg);
    } catch {
        await new Promise(r => setTimeout(r, 200));
        return await chrome.runtime.sendMessage(msg);
    }
}

// =====================
// PROJETS (chrome.storage)
// =====================

async function loadProjects() {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => resolve(data.projects ?? []));
    });
}

async function saveProjects(projects) {
    return new Promise(resolve => chrome.storage.local.set({ projects }, resolve));
}

// =====================
// INIT
// =====================

async function init() {
    sessionId = await sendMsg({ type: 'GET_SESSION' });

    if (!sessionId) {
        setIcon('disconnected');
        document.getElementById('login_box').style.display         = 'block';
        document.getElementById('add_box').style.display           = 'none';
        document.getElementById('sort_bar').style.display          = 'none';
        document.getElementById('projects_container').style.display = 'none';
        document.getElementById('footer').style.display            = 'none';
        return;
    }

    pseudo = localStorage.getItem('pseudo');
    if (!pseudo) {
        pseudo = prompt("Your Scratch username?");
        localStorage.setItem('pseudo', pseudo);
    }

    setIcon('normal');
    document.getElementById('login_box').style.display = 'none';

    const projects = await loadProjects();
    await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: projects.map(p => p.id) });

    updateSortButtons();
    await afficherProjets();
    setInterval(autoUpdate, 5000);
}

document.getElementById('retry_btn').addEventListener('click', init);
document.getElementById('refresh_btn').addEventListener('click', afficherProjets);
document.getElementById('export_btn').addEventListener('click', exportProjects);
document.getElementById('import_btn').addEventListener('click', () => document.getElementById('import_file').click());
document.getElementById('import_file').addEventListener('change', importProjects);

// =====================
// INPUT CLEAR BUTTON
// =====================

document.getElementById('add_input').addEventListener('input', function() {
    document.getElementById('clear_btn').style.display = this.value ? 'block' : 'none';
});
document.getElementById('clear_btn').addEventListener('click', () => {
    document.getElementById('add_input').value = '';
    document.getElementById('clear_btn').style.display = 'none';
    document.getElementById('add_error').textContent = '';
});

// =====================
// AJOUT DE PROJET
// =====================

document.getElementById('add_btn').addEventListener('click', async () => {
    const input = document.getElementById('add_input').value.trim();
    const error = document.getElementById('add_error');
    error.textContent = '';

    const match = input.match(/(\d+)/);
    if (!match) { error.textContent = '❌ No ID found'; return; }

    const id       = parseInt(match[1]);
    const projects = await loadProjects();

    if (projects.find(p => p.id === id)) {
        error.textContent = '⚠️ Already in the list';
        return;
    }

    error.textContent = '⏳ Loading...';
    const info = await sendMsg({ type: 'GET_PROJECT_INFO', projectId: id, sessionId });
    if (!info) { error.textContent = "❌ Project not found or not shared"; return; }

    projects.push({ id: info.id, name: nettoyerNom(info.name) });
    await saveProjects(projects);
    await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: projects.map(p => p.id) });

    document.getElementById('add_input').value = '';
    document.getElementById('clear_btn').style.display = 'none';
    error.textContent = '';
    afficherProjets();
});

document.getElementById('add_input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add_btn').click();
});

// =====================
// NETTOYAGE DU NOM
// =====================

function nettoyerNom(nom) {
    return nom
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/#\S+/g, '')
        .replace(/\s*v?\d+(\.\d+)+\s*/gi, '')
        .replace(/\s+(alpha|beta|bêta)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// =====================
// SUPPRESSION DE PROJET
// =====================

async function supprimerProjet(id) {
    const projects = await loadProjects();
    const newList  = projects.filter(p => p.id !== id);
    await saveProjects(newList);
    // Retire aussi des notifs
    const data = await new Promise(r => chrome.storage.local.get('notifiedProjects', r));
    const notified = (data.notifiedProjects ?? []).filter(pid => pid !== id);
    await chrome.storage.local.set({ notifiedProjects: notified });
    await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: newList.map(p => p.id) });
    afficherProjets();
}

// =====================
// CLOUD LOGS SCRATCH
// =====================

const scratchCache = {};
const vuesCache    = {};

async function fetchScratchLogs(projectId) {
    const logs = await sendMsg({ type: 'GET_SCRATCH_LOGS', projectId, sessionId });
    const now  = Date.now();
    const recentLogs = (logs ?? []).filter(log => (now - log.timestamp) < CINQ_MIN * 2);
    const lastSeen = {};
    recentLogs.forEach(log => {
        if (!lastSeen[log.user] || log.timestamp > lastSeen[log.user]) {
            lastSeen[log.user] = log.timestamp;
        }
    });
    scratchCache[projectId] = Object.entries(lastSeen).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

async function fetchViews(projectId) {
    if (vuesCache[projectId]) return vuesCache[projectId];
    const info = await sendMsg({ type: 'GET_PROJECT_INFO', projectId, sessionId });
    vuesCache[projectId] = info?.views ?? '?';
    return vuesCache[projectId];
}

// =====================
// TEMPS RELATIF
// =====================

function tempsRelatif(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

setInterval(() => {
    document.querySelectorAll('.last_seen[data-ts]').forEach(el => {
        const ts   = parseInt(el.dataset.ts);
        const user = el.dataset.user;
        el.innerHTML = `<a href="https://scratch.mit.edu/users/${user}" target="_blank">${user}</a> · ${tempsRelatif(ts)}`;
    });
}, 1000);

// =====================
// NOTIFICATIONS + ICÔNE
// =====================

let etaitEtat = 'normal';

function updateIcon(projects, twActive) {
    let surScratch = false;
    projects.forEach(p => {
        const scratch       = scratchCache[p.id] ?? [];
        const meScratch     = scratch.find(([u]) => u === pseudo);
        const jeJoueScratch = meScratch ? (Date.now() - meScratch[1]) < CINQ_MIN : false;
        if (jeJoueScratch) surScratch = true;
    });
    const nouvelIcon = surScratch ? 'active_scratch' : 'normal';
    if (nouvelIcon !== etaitEtat) { etaitEtat = nouvelIcon; setIcon(nouvelIcon); }
}

// =====================
// TOGGLE NOTIF (sans recharger)
// =====================

async function toggleNotif(id, btn) {
    const data = await new Promise(r => chrome.storage.local.get('notifiedProjects', r));
    let notified = data.notifiedProjects ?? [];
    const isOn = notified.includes(id);

    if (isOn) {
        notified = notified.filter(pid => pid !== id);
    } else {
        notified.push(id);
    }

    await chrome.storage.local.set({ notifiedProjects: notified });

    // Met à jour le bouton directement, sans re-render
    const nowOn = !isOn;
    btn.classList.toggle('notif-on', nowOn);
    btn.title = nowOn ? 'Disable notifications' : 'Enable notifications';
    btn.querySelector('svg').setAttribute('fill', nowOn ? 'currentColor' : 'none');
}

// =====================
// AFFICHAGE
// =====================

let sortType = 'activity';

async function afficherProjets() {
    const projects  = await loadProjects();
    const container = document.getElementById('projects_container');

    // Récupère notifiedProjects une seule fois
    const notifData = await new Promise(r => chrome.storage.local.get('notifiedProjects', r));
    const notifiedProjects = notifData.notifiedProjects ?? [];

    await Promise.all(projects.map(p => fetchScratchLogs(p.id)));

    const twActive = {};
    await Promise.all(projects.map(async p => {
        twActive[p.id] = await sendMsg({ type: 'GET_TW_ACTIVE', projectId: p.id }) ?? false;
    }));

    const vues = await Promise.all(projects.map(async p => ({
        id: p.id, views: await fetchViews(p.id)
    })));

    let filtered = [...projects];

    if (sortType === 'activity') {
        filtered.sort((a, b) => {
            const aC = (scratchCache[a.id]?.length ?? 0) + (twActive[a.id] ? 1 : 0);
            const bC = (scratchCache[b.id]?.length ?? 0) + (twActive[b.id] ? 1 : 0);
            return bC - aC;
        });
    }
    if (sortType === 'Last visit') {
        filtered.sort((a, b) => (scratchCache[b.id]?.[0]?.[1] ?? 0) - (scratchCache[a.id]?.[0]?.[1] ?? 0));
    }
    if (sortType === 'views') {
        filtered.sort((a, b) => {
            const aV = vues.find(v => v.id === a.id)?.views ?? 0;
            const bV = vues.find(v => v.id === b.id)?.views ?? 0;
            return bV - aV;
        });
    }

    updateIcon(filtered, twActive);

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="padding:30px;text-align:center;color:#bbb">
                <div style="font-size:32px;margin-bottom:8px">🎮</div>
                <div style="font-weight:600;margin-bottom:4px">No projects yet</div>
                <div style="font-size:11px">Add a Scratch project above to start tracking</div>
            </div>`;
        return;
    }

    const now = Date.now();

    container.innerHTML = filtered.map(project => {
        const scratch       = scratchCache[project.id] ?? [];
        const twIsActive    = twActive[project.id] ?? false;
        const meScratch     = scratch.find(([u]) => u === pseudo);
        const jeJoueScratch = meScratch ? (now - meScratch[1]) < CINQ_MIN : false;
        const scratchActifs = scratch.filter(([, ts]) => (now - ts) < CINQ_MIN).length;
        const totalActifs   = scratchActifs + (twIsActive ? 1 : 0);
        const scratchViews  = vues.find(v => v.id === project.id)?.views ?? '?';
        const lastTs        = scratch[0]?.[1] ?? null;
        const notifOn       = notifiedProjects.includes(project.id);

        let liveType = '';
        if      (scratchActifs > 0 && twIsActive) liveType = 'both';
        else if (scratchActifs > 0)               liveType = 'scratch';
        else if (twIsActive)                      liveType = 'tw';

        let borderClass = '';
        if      (liveType)      borderClass = `live-${liveType}`;
        else if (jeJoueScratch) borderClass = 'me-here';

        const statusHTML = totalActifs > 0
            ? `<span class="status-dot live-${liveType}"></span><span class="status-text live-${liveType}">LIVE</span><span class="status-sub">Active now</span>`
            : `<span class="status-dot offline"></span><span class="status-text offline">Offline</span>${lastTs ? `<span class="status-sub">Last seen ${tempsRelatif(lastTs)}</span>` : ''}`;

        const twBadge   = twIsActive && !scratchActifs ? `<span class="badge-tw">TurboWarp</span>` : '';
        const scBadge   = scratchActifs > 0 && !twIsActive ? `<span class="badge-sc">Scratch</span>` : '';
        const bothBadge = scratchActifs > 0 && twIsActive  ? `<span class="badge-sc">Scratch</span><span class="badge-tw">TurboWarp</span>` : '';

        const playersHTML = scratch.filter(([, ts]) => (now - ts) < CINQ_MIN).map(([user, ts]) => `
            <span class="player-item actif last_seen" data-ts="${ts}" data-user="${user}">
                <a href="https://scratch.mit.edu/users/${user}" target="_blank">${user}</a> · ${tempsRelatif(ts)}
            </span>
        `).join('<span style="color:#ddd"> · </span>');

        const mainUrl = `https://scratch.mit.edu/projects/${project.id}`;
        const twUrl   = `https://turbowarp.org/${project.id}`;

        return `
            <div class="project ${borderClass}" data-id="${project.id}">
                <div class="project-thumb">
                    <button class="remove_btn" data-id="${project.id}">✕</button>
                    <a href="${mainUrl}" target="_blank">
                        <img src="https://scratch.mit.edu/get_image/project/${project.id}_200x1000.png" alt="${project.name}">
                    </a>
                </div>
                <div class="project-info">
                    <a href="${mainUrl}" target="_blank" class="project-name">${project.name}</a>
                    <div class="project-status">${statusHTML}</div>
                    <div class="project-meta">
                        <span class="meta-item">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                            ${totalActifs} online
                        </span>
                        <span>·</span>
                        <span class="meta-item">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            ${scratchViews} views
                        </span>
                        ${twIsActive && scratchActifs > 0 ? bothBadge : twBadge + scBadge}
                    </div>
                    ${playersHTML ? `<div class="players-list">${playersHTML}</div>` : ''}
                    ${totalActifs === 0 ? '<div class="players-list">No active player</div>' : ''}
                </div>
                <div class="project-actions">
                    <div class="action-row">
                        <button class="action-btn notif-btn ${notifOn ? 'notif-on' : ''}" data-id="${project.id}" title="${notifOn ? 'Disable notifications' : 'Enable notifications'}">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="${notifOn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="3">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                            </svg>
                        </button>
                        <a href="${mainUrl}" target="_blank" class="action-btn" title="Open on Scratch">
                            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="7.68702" height="12.55086" viewBox="0,0,7.68702,12.55086"><g transform="translate(-235.19715,-172.92976)"><g data-paper-data="{&quot;isPaintingLayer&quot;:true}" fill="none" fill-rule="nonzero" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" style="mix-blend-mode: normal"><path d="M239.06074,181.08888c-0.17492,0.30038 -2.95273,-1.74964 -2.86139,-4.45937c0.00437,-1.40589 1.51894,-2.92269 3.23949,-1.99133c0.23188,-0.2079 0.71129,-0.81825 1.16333,-0.72784c0.80682,0.16138 0.29792,3.53017 0.30603,5.01645c-1.71974,-0.7941 -1.96167,-1.57625 -2.08354,-1.42994c-0.15566,0.18687 3.16348,1.38059 3.0606,3.56866c-0.10316,2.19385 -2.57559,2.55963 -4.01936,2.34274c-0.23327,0.49904 -0.41913,1.01959 -1.21837,1.07095c-1.25873,-0.05577 -1.48228,-4.37908 -0.74831,-4.92593c0.55016,-0.25161 3.24347,1.39488 3.16151,1.53561z" data-paper-data="{&quot;index&quot;:null}"/></g></g></svg>
                        </a>
                        <a href="${twUrl}" target="_blank" class="action-btn" title="Open on TurboWarp" style="color:#ff4d4d">
                            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10.54631" height="11.76086" viewBox="0,0,10.54631,11.76086"><g transform="translate(-234.72684,-174.31544)"><g data-paper-data="{&quot;isPaintingLayer&quot;:true}" fill="none" fill-rule="nonzero" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="" stroke-dashoffset="0" style="mix-blend-mode: normal"><path d="M235.65718,175.17914c-0.4461,0.50761 -0.08193,5.03216 1.28706,4.92234c1.29753,-0.10409 1.39113,-2.4458 1.54475,-3.20808c-0.03211,1.48334 0.12121,3.94671 0.12045,5.89308c-0.57483,0.03843 -1.40241,0.57808 -1.37591,1.41698c0.02683,0.84916 0.71274,1.18612 2.83371,1.1132c2.55605,-0.08788 2.9039,-0.33578 2.92065,-1.29161c0.01676,-0.95584 -1.03677,-1.32216 -1.62904,-1.29866c0.04934,-0.98957 0.04529,-4.05616 0.10357,-6.00635c0.14413,1.14264 0.85122,2.46408 1.99797,2.45372c1.11628,-0.01008 1.33479,-3.68312 0.742,-4.1083c-0.71857,-0.51539 -8.08043,-0.41519 -8.54523,0.11369z"/></g></g></svg>
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Event listeners
    container.querySelectorAll('.remove_btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            supprimerProjet(parseInt(btn.dataset.id));
        });
    });

    container.querySelectorAll('.notif-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleNotif(parseInt(btn.dataset.id), btn);
        });
    });
}

// =====================
// AUTO-UPDATE
// =====================

let etatPrecedent = null;

async function autoUpdate() {
    const projects = await loadProjects();
    await Promise.all(projects.map(p => fetchScratchLogs(p.id)));
    const twActive = {};
    await Promise.all(projects.map(async p => {
        twActive[p.id] = await sendMsg({ type: 'GET_TW_ACTIVE', projectId: p.id }) ?? false;
    }));
    const nouvelEtat = projects.map(p =>
        `${p.id}:${scratchCache[p.id]?.length ?? 0}:${twActive[p.id] ? 1 : 0}`
    ).join('|');
    if (nouvelEtat !== etatPrecedent) {
        etatPrecedent = nouvelEtat;
        afficherProjets();
    }
}

// =====================
// TRI
// =====================

function updateSortButtons() {
    document.querySelectorAll('.sort_button').forEach(button => {
        button.classList.toggle('active', button.dataset.sort === sortType);
    });
}

document.querySelectorAll('.sort_button').forEach(button => {
    button.addEventListener('click', () => {
        sortType = button.dataset.sort;
        updateSortButtons();
        afficherProjets();
    });
});

// =====================
// EXPORT / IMPORT
// =====================

async function exportProjects() {
    const projects = await loadProjects();
    if (projects.length === 0) return;

    const payload = JSON.stringify({ scratchping: true, version: 1, projects }, null, 2);
    const blob    = new Blob([payload], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href     = url;
    a.download = `scratchping_export_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importProjects(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Reset l'input pour pouvoir réimporter le même fichier
    e.target.value = '';

    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        alert('❌ Invalid file.');
        return;
    }

    if (!parsed.scratchping || !Array.isArray(parsed.projects)) {
        alert('❌ This file is not a ScratchPing export.');
        return;
    }

    const existing = await loadProjects();
    const existingIds = new Set(existing.map(p => p.id));

    let added = 0;
    for (const p of parsed.projects) {
        if (!p.id || !p.name) continue;
        if (existingIds.has(p.id)) continue;
        existing.push({ id: p.id, name: p.name });
        existingIds.add(p.id);
        added++;
    }

    if (added === 0) {
        alert('⚠️ All projects are already in your list.');
        return;
    }

    await saveProjects(existing);
    await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: existing.map(p => p.id) });
    alert(`✅ ${added} project(s) imported!`);
    afficherProjets();
}

// =====================
// DÉMARRAGE
// =====================

init();
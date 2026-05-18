const CINQ_MIN = 5 * 60 * 1000;

// =====================
// KEEPALIVE + MESSAGE
// =====================

// Connexion persistante pour garder le service worker éveillé
const port = chrome.runtime.connect({ name: 'keepAlive' });

async function sendMsg(msg) {
    try {
        return await chrome.runtime.sendMessage(msg);
    } catch {
        // Service worker endormi — on attend un peu et on réessaie
        await new Promise(r => setTimeout(r, 200));
        return await chrome.runtime.sendMessage(msg);
    }
}

// =====================
// PROJETS (stockés dans chrome.storage)
// =====================

async function loadProjects() {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => {
            resolve(data.projects ?? []);
        });
    });
}

async function saveProjects(projects) {
    return new Promise(resolve => {
        chrome.storage.local.set({ projects }, resolve);
    });
}

// =====================
// SESSION + PSEUDO
// =====================

let sessionId = null;
let pseudo    = null;

async function init() {
    sessionId = await sendMsg({ type: 'GET_SESSION' });

    if (!sessionId) {
        document.getElementById('login_box').style.display          = 'block';
        document.getElementById('sort').style.display               = 'none';
        document.getElementById('add_box').style.display            = 'none';
        document.getElementById('projects_container').style.display = 'none';
        return;
    }

    pseudo = localStorage.getItem('pseudo');
    if (!pseudo) {
        pseudo = prompt("Ton pseudo Scratch ?");
        localStorage.setItem('pseudo', pseudo);
    }

    document.getElementById('login_box').style.display = 'none';
    updateSortButtons();
    await afficherProjets();
    setInterval(autoUpdate, 5000);
}

document.getElementById('retry_btn').addEventListener('click', init);

// =====================
// AJOUT DE PROJET
// =====================
function nettoyerNom(nom) {
    return nom
        .replace(/\s+(alpha|beta|bêta)\s*$/i, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/#\S+/g, '')
        .replace(/\s*v?\d+(\.\d+)+\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

document.getElementById('add_btn').addEventListener('click', async () => {
    const input = document.getElementById('add_input').value.trim();
    const error = document.getElementById('add_error');
    error.textContent = '';

    const match = input.match(/(\d+)/);
    if (!match) {
        error.textContent = '❌ ID invalide';
        return;
    }

    const id       = parseInt(match[1]);
    const projects = await loadProjects();

    if (projects.find(p => p.id === id)) {
        error.textContent = '⚠️ Déjà dans la liste';
        return;
    }

    error.textContent = '⏳ Chargement...';
    const info = await sendMsg({
        type: 'GET_PROJECT_INFO',
        projectId: id,
        sessionId
    });

    if (!info) {
        error.textContent = '❌ Projet introuvable';
        return;
    }

    projects.push({ id: info.id, name: nettoyerNom(info.name) });
    await saveProjects(projects);
    document.getElementById('add_input').value = '';
    error.textContent = '';
    afficherProjets();
});

document.getElementById('add_input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add_btn').click();
});

// =====================
// SUPPRESSION DE PROJET
// =====================

async function supprimerProjet(id) {
    const projects = await loadProjects();
    await saveProjects(projects.filter(p => p.id !== id));
    afficherProjets();
}

// =====================
// CLOUD LOGS
// =====================

const cache     = {};
const vuesCache = {};

async function fetchCloudLogs(projectId) {
    const logs = await sendMsg({
        type: 'GET_CLOUD_LOGS',
        projectId,
        sessionId
    });

    const now        = Date.now();
    const recentLogs = (logs ?? []).filter(log => (now - log.timestamp) < CINQ_MIN * 2);

    const lastSeen = {};
    recentLogs.forEach(log => {
        if (!lastSeen[log.user] || log.timestamp > lastSeen[log.user]) {
            lastSeen[log.user] = log.timestamp;
        }
    });

    const top5 = Object.entries(lastSeen)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    cache[projectId] = { top5, count: top5.length, updatedAt: now };
}

async function fetchViews(projectId) {
    if (vuesCache[projectId]) return vuesCache[projectId];
    const info = await sendMsg({
        type: 'GET_PROJECT_INFO',
        projectId,
        sessionId
    });
    vuesCache[projectId] = info?.views ?? '?';
    return vuesCache[projectId];
}

// =====================
// TEMPS RELATIF
// =====================

function tempsRelatif(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60)    return `il y a ${diff}s`;
    if (diff < 3600)  return `il y a ${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
    return `il y a ${Math.floor(diff / 86400)}j`;
}

setInterval(() => {
    document.querySelectorAll('.last_seen[data-ts]').forEach(el => {
        const ts   = parseInt(el.dataset.ts);
        const user = el.dataset.user;
        el.innerHTML = `<a href="https://scratch.mit.edu/users/${user}" target="_blank">${user}</a> : ${tempsRelatif(ts)}`;
    });
}, 1000);

// =====================
// NOTIFICATIONS
// =====================

let etaitPartage = false;

function notifierSiNecessaire(projects) {
    const projetPartage = projects.find(p => {
        const data         = cache[p.id];
        if (!data) return false;
        const monLog       = data.top5.find(([user]) => user === pseudo);
        const jeJoue       = monLog ? (Date.now() - monLog[1]) < CINQ_MIN : false;
        const autresActifs = data.top5.filter(([user, ts]) =>
            user !== pseudo && (Date.now() - ts) < CINQ_MIN
        ).length;
        return jeJoue && autresActifs > 0;
    });

    const partage = !!projetPartage;
    if (partage === etaitPartage) return;
    etaitPartage = partage;

    if (partage) {
        const autresNoms = cache[projetPartage.id].top5
            .filter(([user, ts]) => user !== pseudo && (Date.now() - ts) < CINQ_MIN)
            .map(([user]) => user)
            .join(', ');
        sendMsg({
            type: 'NOTIFY',
            body: `${autresNoms} joue aussi à ${projetPartage.name} !`
        });
    }
}

// =====================
// AFFICHAGE
// =====================

let sortType = "activity";

async function afficherProjets() {
    const projects  = await loadProjects();
    const container = document.getElementById('projects_container');

    await Promise.all(projects.map(p => fetchCloudLogs(p.id)));

    const vues = await Promise.all(projects.map(async p => ({
        id: p.id, views: await fetchViews(p.id)
    })));

    let filtered = [...projects];

    if (sortType === 'activity') {
        filtered.sort((a, b) => (cache[b.id]?.count ?? 0) - (cache[a.id]?.count ?? 0));
    }
    if (sortType === 'Last visit') {
        filtered.sort((a, b) => {
            const aTs = cache[a.id]?.top5[0]?.[1] ?? 0;
            const bTs = cache[b.id]?.top5[0]?.[1] ?? 0;
            return bTs - aTs;
        });
    }
    if (sortType === 'views') {
        filtered.sort((a, b) => {
            const aV = vues.find(v => v.id === a.id)?.views ?? 0;
            const bV = vues.find(v => v.id === b.id)?.views ?? 0;
            return bV - aV;
        });
    }

    notifierSiNecessaire(filtered);

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding:0.5rem;color:#888">Aucun projet — ajoutes-en un !</p>';
        return;
    }

    container.innerHTML = filtered.map(project => {
        const data         = cache[project.id] ?? { top5: [], count: 0 };
        const monLog       = data.top5.find(([user]) => user === pseudo);
        const jeJoue       = monLog ? (Date.now() - monLog[1]) < CINQ_MIN : false;
        const scratchViews = vues.find(v => v.id === project.id)?.views ?? '?';
        const vraiActifs   = data.top5.filter(([, ts]) => (Date.now() - ts) < CINQ_MIN).length;

        const top5HTML = data.top5.length > 0
            ? data.top5.map(([user, ts]) => {
                const estActif = (Date.now() - ts) < CINQ_MIN;
                return `<p class="last_seen ${estActif ? 'actif' : ''}" data-ts="${ts}" data-user="${user}">
                    <a href="https://scratch.mit.edu/users/${user}" target="_blank">${user}</a> : ${tempsRelatif(ts)}
                </p>`;
              }).join('')
            : '<p class="last_seen">Aucun joueur récent</p>';

        return `
            <div class="project ${jeJoue ? 'active' : ''}" data-id="${project.id}">
                <div class="thumbnail-wrapper">
                    <button class="remove_btn" data-id="${project.id}">✕</button>
                    <a href="https://scratch.mit.edu/projects/${project.id}" target="_blank">
                        <img src="https://scratch.mit.edu/get_image/project/${project.id}_200x1000.png"
                             alt="Thumbnail" class="thumbnail">
                    </a>
                </div>
                <br>
                <a href="https://scratch.mit.edu/projects/${project.id}" target="_blank" class="project-name">${project.name}</a>
                <br>
                <span class="active_count">${vraiActifs} actifs / ${scratchViews} vues</span>
                ${top5HTML}
            </div>
        `;
    }).join('');

    // Event listeners sur les croix
    container.querySelectorAll('.remove_btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            supprimerProjet(parseInt(btn.dataset.id));
        });
    });
}

// =====================
// AUTO-UPDATE
// =====================

let etatPrecedent = null;

async function autoUpdate() {
    const projects = await loadProjects();
    await Promise.all(projects.map(p => fetchCloudLogs(p.id)));
    const nouvelEtat = projects.map(p => {
        const d = cache[p.id];
        return `${p.id}:${d?.count ?? 0}:${d?.top5.map(t => t[0]).join(',') ?? ''}`;
    }).join('|');

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
// DÉMARRAGE
// =====================

init();
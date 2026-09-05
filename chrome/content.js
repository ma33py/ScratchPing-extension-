// =========================
// UTILS
// =========================

function getProjectId() {
    const match =
        location.pathname.match(/\/projects\/(\d+)/) ||
        location.pathname.match(/^\/(\d+)/);
    return match ? match[1] : null;
}

async function sendMsg(msg) {
    try {
        return await chrome.runtime.sendMessage(msg);
    } catch {
        return null;
    }
}

async function getProjects() {
    return new Promise(resolve => {
        chrome.storage.local.get("projects", data => {
            resolve(data.projects || []);
        });
    });
}

async function isAlreadyAdded(projectId) {
    const projects = await getProjects();
    return projects.some(p => String(p.id) === String(projectId));
}

// =========================
// ACTIONS BACKGROUND (IMPORTANT)
// =========================

async function addProject(projectId) {
    const sessionId = await sendMsg({ type: "GET_SESSION" });

    const info = await sendMsg({
        type: "GET_PROJECT_INFO",
        projectId,
        sessionId
    });

    if (!info) return false;

    const projects = await getProjects();

    if (projects.some(p => String(p.id) === String(projectId))) {
        return false;
    }

    projects.push({
        id: Number(projectId),
        name: info.name || "unknown"
    });

    await chrome.storage.local.set({ projects });

    await sendMsg({
        type: "ENSURE_TW_CONNECTIONS",
        projectIds: projects.map(p => p.id)
    });

    return true;
}

async function removeProject(projectId) {
    const projects = await getProjects();

    const filtered = projects.filter(
        p => String(p.id) !== String(projectId)
    );

    await chrome.storage.local.set({ projects: filtered });

    await sendMsg({
        type: "ENSURE_TW_CONNECTIONS",
        projectIds: filtered.map(p => p.id)
    });

    return true;
}

// =========================
// LIST (inchangée logique)
// =========================

async function updateList() {
    const projectId = getProjectId();
    if (!projectId) return;

    let container = document.getElementById("scratchping-list");

    if (!container) {
        const notes =
            document.querySelector(".project-notes") ||
            document.querySelector('[class*="project-notes"]') ||
            document.querySelector('[class*="description-block"]');

        if (!notes) return;

        container = document.createElement("div");
        container.id = "scratchping-list";
        container.style.cssText = `
            margin-bottom: 12px;
            font-family: sans-serif;
            font-size: 12px;
            padding: 6px 0;
        `;

        notes.parentNode.insertBefore(container, notes);
    }

    container.innerHTML = `
        <div style="font-weight:700;color:#855cd6;">Active Players</div>
        <div style="opacity:.5">Loading...</div>
    `;

    const sessionId = await sendMsg({ type: "GET_SESSION" });

    const logs = await sendMsg({
        type: "GET_SCRATCH_LOGS",
        projectId,
        sessionId
    });

    if (!logs) {
        container.innerHTML += `<div style="opacity:.5">No data</div>`;
        return;
    }

    const now = Date.now();
    const FIVE_MIN = 5 * 60 * 1000;
    const lastSeen = {};

    for (const log of logs) {
        const ts = log.timestamp < 1e10 ? log.timestamp * 1000 : log.timestamp;
        if (now - ts < FIVE_MIN) {
            lastSeen[log.user] = ts;
        }
    }

    const users = Object.entries(lastSeen)
        .sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
        <div style="font-weight:700;color:#855cd6;margin-bottom:6px">
            Active Players
        </div>
    `;

    if (users.length === 0) {
        container.innerHTML += `<div style="opacity:.5">None</div>`;
        return;
    }

    for (const [user, ts] of users) {
        const row = document.createElement("div");
        row.style.whiteSpace = "nowrap";

        row.innerHTML = `
            <a href="https://scratch.mit.edu/users/${user}"
               target="_blank"
               style="color:#855cd6;text-decoration:none;font-weight:600;margin-right:4px;">
                ${user}
            </a>
            <span style="opacity:.6;font-size:11px;">
                (${Math.floor((Date.now() - ts) / 60000)}m ago)
            </span>
        `;

        container.appendChild(row);
    }
}

// =========================
// BOUTON (FIXÉ + IDENTIQUE DESIGN)
// =========================

async function injectButton() {
    const projectId = getProjectId();
    if (!projectId) return;

    const mount = async () => {
        const buttonsRow =
            document.querySelector('[class*="project-buttons"]') ||
            document.querySelector('[class*="share-date"]')?.parentElement;

        if (!buttonsRow) return;

        if (document.getElementById("scratchping-btn")) return;

        let alreadyAdded = await isAlreadyAdded(projectId);

        const btn = document.createElement("button");
        btn.id = "scratchping-btn";

        // =========================
        // DESIGN STRICTEMENT IDENTIQUE
        // =========================
        btn.style.cssText = `
    border: none;
    border-radius: 4px;
    padding: 11px 15px;
    font-size: 14px;
    font-weight: 700;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    cursor: pointer;
    transition: .2s;
    margin-left: 16px;
    margin-bottom: 6px;
`;

        function render() {
            if (alreadyAdded) {
                btn.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon16_normal.png")}" style="width:14px;vertical-align:middle;margin-right:5px"> Already in ScratchPing`;
                btn.style.background = "#e8e0f8";
                btn.style.color = "#855cd6";
            } else {
                btn.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon16_normal.png")}" style="width:14px;vertical-align:middle;margin-right:5px"> Add to ScratchPing`;
                btn.style.background = "#855cd6";
                btn.style.color = "white";
            }
        }

        render();

        btn.addEventListener("click", async () => {
            if (btn.dataset.busy) return;
            btn.dataset.busy = "1";

            if (!alreadyAdded) {
                btn.innerHTML = "⏳ Adding...";

                const ok = await addProject(projectId);

                if (ok) {
                    alreadyAdded = true;
                    render();
                } else {
                    btn.innerHTML = "❌ Error";
                }

            } else {
                btn.innerHTML = "⏳ Removing...";

                const ok = await removeProject(projectId);

                if (ok) {
                    alreadyAdded = false;
                    render();
                } else {
                    btn.innerHTML = "❌ Error";
                }
            }

            delete btn.dataset.busy;
        });

        buttonsRow.appendChild(btn);
    };

    await mount();

    new MutationObserver(() => mount()).observe(document.body, {
        childList: true,
        subtree: true
    });
}

// =========================
// INIT
// =========================

function main() {
    if (!getProjectId()) return;

    updateList();
    injectButton();
}

main();

setInterval(updateList, 10000);

let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        main();
    }
}).observe(document.body, { childList: true, subtree: true });
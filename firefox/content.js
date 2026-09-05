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
    if (!isScratch) return;

    cloudProject = false;
    document.querySelectorAll(".extension-content").forEach(ext => {
        ext.childNodes.forEach(child => {
            if (child.href?.includes("cloudmonitor")) {
                cloudProject = true;
            }
        });
    });
    if (!cloudProject) return;

    let container = document.getElementById("scratchping-list");

    if (!container) {
        let top_div;
        if (isScratch) {
            top_div = document.querySelector(".preview .inner");
        } else {
            top_div = document.querySelector(".interface_section_3pFkT .cloud-variable-badge_badge_2kZVK")?.parentElement;
        }

        if (!top_div) return;

        container = document.createElement("div");
        container.id = "scratchping-list";
        container.style.cssText = `
            margin: 2px 12px;
            font-family: sans-serif;
            font-size: 14px;
            padding: 6px 0;
        `;
        container.innerHTML = `
        <label for="unroll-btn" style="font-weight:700;color:#855cd6;cursor:pointer;">Active Players: </label>
        <span id="nb_users" style="opacity:.8;margin:0 4px;"></span>
        <input id="unroll-btn" type="button" value="➤" style="background:none;border:none;transition:transform 150ms">
        <ul style="display:none;margin=none;padding=none;"></ul>
        `;

        const unroll_btn = container.querySelector("#unroll-btn");
        if (unroll_btn) {
            unroll_btn.active = false;
            unroll_btn.addEventListener("click", () => {
                unroll_btn.active = !unroll_btn.active;
                unroll_btn.style.transform = unroll_btn.active ? "rotate(90deg)" : "";
                unroll_btn.parentElement.querySelector("ul").style.display = unroll_btn.active ? "" : "none";
            });
        }

        top_div.appendChild(container);

    }

    container.querySelector("span#nb_users").textContent = "Loading...";
    
    const sessionId = await sendMsg({ type: "GET_SESSION" });

    const logs = await sendMsg({
        type: "GET_SCRATCH_LOGS",
        projectId,
        sessionId
    });

    if (!logs) {
        container.querySelector("span#nb_users").textContent = "No data";
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

    container.querySelector("span#nb_users").textContent = users.length;

    const ul = container.querySelector("ul");
    if (!ul) return;

    ul.innerHTML = "";
    for (const [user, ts] of users) {
        const row = document.createElement("li");
        row.style.whiteSpace = "nowrap";
        row.style.margin = "2px 0"

        row.innerHTML = `
            <a href="https://scratch.mit.edu/users/${user}"
               target="_blank"
               style="color:#855cd6;text-decoration:none;font-weight:600;margin-right:4px;font-size:14px;">
                ${user}
            </a>
            <span style="opacity:.6;font-size:11px;">
                (${Math.max(0, Math.floor((Date.now() - ts) / 60000))}m ago)
            </span>
        `;

        ul.appendChild(row);
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
        const btn = document.createElement("button");
        btn.style.display = "none";
        btn.id = "scratchping-btn";
        buttonsRow.appendChild(btn);

        let alreadyAdded = await isAlreadyAdded(projectId);

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
        btn.style.display = "";
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

let isScratch = location.href.includes("scratch.mit.edu");

main();

setInterval(updateList, 10000);

let lastUrl = location.href;
new MutationObserver(mutations => {
    
    isScratch = location.href.includes("scratch.mit.edu");

    if (location.href !== lastUrl) {
        lastUrl = location.href;
        main();
    } else {
        for (let mut of mutations) {
            if (mut.target?.className === "inner" &&
                mut.addedNodes?.[0]?.className === "flex-row preview-row") {
                updateList();
            }
        }
    }
}).observe(document.body, { childList: true, subtree: true });
// =====================
// PROJETS (chrome.storage)
// =====================

export async function loadProjects() {
    return new Promise(resolve => {
        chrome.storage.local.get('projects', data => resolve(data.projects ?? []));
    });
}

export async function saveProjects(projects) {
    return new Promise(resolve => chrome.storage.local.set({ projects }, resolve));
}
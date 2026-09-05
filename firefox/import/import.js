import {saveProjects, loadProjects} from "../utils.js"

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
    alert(`✅ ${added} project(s) imported!`);
}

const import_file = document.getElementById('import_file');
document.getElementById('import_btn').addEventListener('click', () => import_file.click())
import_file.addEventListener('change', e => importProjects(e).then(() => window.close()));

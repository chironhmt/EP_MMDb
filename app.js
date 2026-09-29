// Locally (via Chemotherapy.bat) the API is the standalone Flask dev server on :5001.
// Deployed on Vercel, the API is same-origin serverless functions under /api, so the base is empty.
const API_BASE = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
    ? 'http://127.0.0.1:5001'
    : '';
const urlParams = new URLSearchParams(window.location.search);
// Falls back to a placeholder patient when the page isn't opened from Dashboard.html with ?upn=<UPN>
const DEFAULT_PATIENT_UPN = urlParams.get('upn') || '12345678';
// TODO: fetch the real patient's name from /api/patients/<upn> once this page shows patient context in its header
const DEFAULT_PATIENT_NAME = '홍길동';
// Global Data State
let agentsData = [];
let dosingDaysMap = {};
let regimensData = [];
let groupedAgents = {};
// Application State
let cycles = [];
let currentCycleId = null;
// Which cycle's calendar/start-date "3. Treatment Schedule" is currently showing. Lets the user
// browse individual cycles inside a merged card (see getCycleGroups) without disturbing the
// top-level currentCycleId, which always stays on the merged card's first cycle.
let currentScheduleCycleId = null;
let currentView = 'cycle'; // 'cycle' | 'response'
let currentLineId = urlParams.get('line_id') ? parseInt(urlParams.get('line_id'), 10) : null;
let loadedRefractoryAgents = {};
// DOM Elements
const cycleListEl = document.getElementById('cycle-list');
const addCycleBtn = document.getElementById('add-cycle-btn');
const emptyStateEl = document.getElementById('empty-state');
const cyclePlannerEl = document.getElementById('cycle-planner');
const responseEotViewEl = document.getElementById('response-eot-view');
const responseEotNavItemEl = document.getElementById('response-eot-nav-item');
const currentCycleTitleEl = document.getElementById('current-cycle-title');
const deleteCycleBtn = document.getElementById('delete-cycle-btn');
const agentClassesContainer = document.getElementById('agent-classes-container');
const agentConfigsContainer = document.getElementById('agent-configs-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
async function loadData() {
    try {
        const [agentsRes, daysRes, regimensRes] = await Promise.all([
            fetch('Eunpyeong_Myeloma_Center_Agents.json?v=' + Date.now()),
            fetch('Eunpyeong_Myeloma_Center_Drug_Dosing.json?v=' + Date.now()),
            fetch('Eunpyeong_Myeloma_Center_Regimens.json?v=' + Date.now())
        ]);
        if (!agentsRes.ok || !daysRes.ok || !regimensRes.ok) {
            throw new Error('Failed to fetch JSON files. Ensure you are running via a local web server (eg, 실행하기.bat).');
        }
        agentsData = await agentsRes.json();
        const dosingDaysData = await daysRes.json();
        regimensData = await regimensRes.json();
        // Ensure "Others" is in agentsData if not present
        if (!agentsData.find(a => a.Agent === 'Others')) {
            agentsData.push({
                "Class": "Others",
                "Agent": "Others",
                "Abbreviations": "",
                "Dose": "",
                "Dosing_day": ""
            });
        }
        // Build groupedAgents
        groupedAgents = {};
        agentsData.forEach(agent => {
            if (!groupedAgents[agent.Class]) {
                groupedAgents[agent.Class] = [];
            }
            groupedAgents[agent.Class].push(agent);
        });
        // Build dosingDaysMap
        dosingDaysMap = {};
        dosingDaysData.forEach(d => {
            dosingDaysMap[d.Code] = d.Dosing_days;
        });
        loadingOverlay.classList.add('hidden');
        await init();
    } catch (err) {
        console.error(err);
        loadingText.textContent = 'Failed to load data. Do not open index.html directly in a web browser. Please run the local server by double-clicking the provided .bat file (eg, HemaCDS2.0_Mutiple Myeloma_Chemotherapy.bat).';
        loadingText.style.color = '#ef4444'; // danger color
        const spinner = document.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';
    }
}
// Initialization
async function init() {
    renderSidebar();
    renderAgentCheckboxes();
    updateMainContent();
    setupCalendarDragDrop();
    // Populate Regimen Dropdown
    const regimenSelect = document.getElementById('regimen-input');
    if (regimenSelect && typeof regimensData !== 'undefined') {
        regimensData.forEach(r => {
            const option = document.createElement('option');
            option.value = r.Regimen;
            option.textContent = r.Regimen;
            regimenSelect.insertBefore(option, regimenSelect.querySelector('option[value="Others"]'));
        });
    }
    setupEventListeners();
    if (!currentLineId) {
        // No explicit ?line_id= given: auto-resume the most recently saved line for this patient, if any
        currentLineId = await findLatestChemoLineId(DEFAULT_PATIENT_UPN);
    }
    if (currentLineId) {
        await loadExistingChemoLine(currentLineId);
    }
    if (cycles.length === 0) {
        addCycle();
    } else {
        selectCycle(cycles[0].id);
    }
    // Default to 'Choose regimen' only for a brand-new, unsaved line
    if (regimenSelect && !currentLineId) {
        regimenSelect.value = "";
    }
}
function setupEventListeners() {
    addCycleBtn.addEventListener('click', addCycle);
    const cycleInput = document.getElementById('new-cycle-input');
    if (cycleInput) {
        cycleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addCycle();
        });
    }
    deleteCycleBtn.addEventListener('click', deleteCurrentCycle);
    const startDateInput = document.getElementById('cycle-start-date');
    const lengthInput = document.getElementById('cycle-length');
    if (startDateInput) {
        startDateInput.addEventListener('change', (e) => {
            if (currentCycleId) {
                const cycle = getCycle(currentCycleId);
                cycle.startDate = e.target.value;
                renderSidebar();
                renderSummary();
            }
        });
    }
    if (lengthInput) {
        lengthInput.addEventListener('input', (e) => {
            if (currentCycleId) {
                const cycle = getCycle(currentCycleId);
                cycle.lengthDays = e.target.value;
                renderSidebar();
                renderSummary();
            }
        });
    }
    const regimenSelect = document.getElementById('regimen-input');
    const customRegimenInput = document.getElementById('custom-regimen-input');
    if (regimenSelect) {
        regimenSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'Others') {
                if (customRegimenInput) {
                    customRegimenInput.classList.remove('hidden');
                    customRegimenInput.focus();
                }
            } else {
                if (customRegimenInput) {
                    customRegimenInput.classList.add('hidden');
                }
                if (typeof regimensData !== 'undefined') {
                    const regimenObj = regimensData.find(r => r.Regimen === val);
                    if (regimenObj) {
                        if (confirm(`Apply preset "${val}"? This will clear current cycles and create new ones.`)) {
                            applyRegimen(regimenObj);
                        }
                    }
                }
            }
            renderSummary();
            updateTitleDynamically();
        });
    }
    function updateTitleDynamically() {
        if (currentCycleId) {
            const cycle = getCycle(currentCycleId);
            const lineSelect = document.getElementById('line-input');
            let lineVal = '';
            if (lineSelect) {
                lineVal = ['Consolidation', 'Maintenance'].includes(lineSelect.value) ? lineSelect.value : `${lineSelect.value} Line`;
            }
            const regimenSelect = document.getElementById('regimen-input');
            let regimenVal = regimenSelect ? regimenSelect.value : '';
            if (regimenVal === 'Others') {
                const customRegimenInput = document.getElementById('custom-regimen-input');
                regimenVal = customRegimenInput ? customRegimenInput.value : '';
            }
            const group = getGroupOfCycle(cycle.id);
            const cycleLabel = group ? group.label : cycle.name;
            const currentCycleTitleEl = document.getElementById('current-cycle-title');
            if (currentCycleTitleEl) {
                currentCycleTitleEl.textContent = regimenVal ? `${lineVal} ${regimenVal} ${cycleLabel}`.trim() : `${lineVal} ${cycleLabel}`.trim();
            }
        }
    }
    const lineSelect = document.getElementById('line-input');
    if (lineSelect) {
        lineSelect.addEventListener('change', () => {
            renderSummary();
            updateTitleDynamically();
        });
    }
    if (customRegimenInput) {
        customRegimenInput.addEventListener('input', () => {
            renderSummary();
            updateTitleDynamically();
        });
    }
}
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}
function parseCycleRange(cycleStr) {
    if (!cycleStr) return [];
    cycleStr = cycleStr.toString().trim();
    const result = new Set();
    let hasValidNumber = false;
    // Split by comma first
    const parts = cycleStr.split(',');
    parts.forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
            const rangeParts = part.split('-');
            const start = parseInt(rangeParts[0], 10);
            const end = parseInt(rangeParts[1], 10);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    result.add(i);
                }
                hasValidNumber = true;
            }
        } else {
            const val = parseInt(part, 10);
            if (!isNaN(val)) {
                result.add(val);
                hasValidNumber = true;
            }
        }
    });
    return hasValidNumber ? Array.from(result).sort((a, b) => a - b) : [];
}
function applyRegimen(regimenObj) {
    // Clear existing cycles
    cycles = [];
    currentCycleId = null;
    if (!regimenObj.Cycles || regimenObj.Cycles.length === 0) {
        addCycle();
        return;
    }
    regimenObj.Cycles.forEach(config => {
        let lengthDays = '28';
        let agentsConfig = [];
        if (config.Length) lengthDays = config.Length.toString();
        if (config.Agents) agentsConfig = config.Agents;
        const parsedCycles = parseCycleRange(config.Cycle);
        const cycleNames = parsedCycles.length > 0 ? parsedCycles.map(n => `Cycle ${n}`) : [config.Cycle ? `Cycle ${config.Cycle}` : `Cycle ${cycles.length + 1}`];
        cycleNames.forEach(cycleName => {
            const newCycle = {
                id: generateId(),
                name: cycleName,
                startDate: '', 
                lengthDays: lengthDays,
                selectedAgents: {}
            };
            agentsConfig.forEach(agentReq => {
                const drugName = agentReq.Agent || agentReq.Drug;
                const agentDef = agentsData.find(a => a.Agent === drugName);
                if (agentDef) {
                    if (!newCycle.selectedAgents[drugName]) {
                        newCycle.selectedAgents[drugName] = {
                            customName: '',
                            schedules: []
                        };
                    }
                    const newSchedule = {
                        id: generateId(),
                        dose: agentReq.Dose || null,
                        dosingDays: agentReq.Dosing_day,
                        customDose: '',
                        customDays: '',
                        dayOverrides: {}
                    };
                    const allowedDays = agentDef.Dosing_day ? agentDef.Dosing_day.split(',').map(d=>d.trim()) : [];
                    if (!allowedDays.includes(agentReq.Dosing_day)) {
                        newSchedule.dosingDays = 'Others';
                        newSchedule.customDays = agentReq.Dosing_day;
                    }
                    if (agentReq.Dose) {
                        const allowedDoses = agentDef.Dose ? agentDef.Dose.split(',').map(d=>d.trim()) : [];
                        if (!allowedDoses.includes(agentReq.Dose)) {
                            newSchedule.dose = 'Others';
                            newSchedule.customDose = agentReq.Dose;
                        }
                    }
                    newCycle.selectedAgents[drugName].schedules.push(newSchedule);
                } else {
                    newCycle.selectedAgents['Others'] = {
                        customName: drugName,
                        schedules: [{
                            id: generateId(),
                            dose: 'Others',
                            dosingDays: 'Others',
                            customDose: '',
                            customDays: agentReq.Dosing_day,
                            dayOverrides: {}
                        }]
                    };
                }
            });
            cycles.push(newCycle);
        });
    });
    // Calculate start dates
    const today = new Date();
    let currentDate = new Date(today);
    cycles.forEach(c => {
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currentDate.getDate()).padStart(2, '0');
        c.startDate = `${yyyy}-${mm}-${dd}`;
        currentDate.setDate(currentDate.getDate() + parseInt(c.lengthDays));
    });
    if (cycles.length > 0) {
        selectCycle(cycles[0].id);
    } else {
        renderSidebar();
        updateMainContent();
    }
}
function printSummary() {
    if (!currentCycleId) {
        window.print();
        return;
    }
    const cycle = getCycle(currentCycleId);
    
    // Get Line
    const lineSelect = document.getElementById('line-input');
    const lineVal = lineSelect ? lineSelect.value : '';
    
    // Get Regimen
    const regimenSelect = document.getElementById('regimen-input');
    let regimenVal = regimenSelect ? regimenSelect.value : '';
    if (regimenVal === 'Others') {
        const customRegimenInput = document.getElementById('custom-regimen-input');
        regimenVal = customRegimenInput ? customRegimenInput.value : '';
    }
    
    // Build Title
    let titleParts = [];
    if (lineVal) titleParts.push(lineVal + ' line');
    if (regimenVal) titleParts.push(regimenVal);
    if (cycle && cycle.name) titleParts.push(cycle.name);
    
    const newTitle = titleParts.join('_');
    const originalTitle = document.title;
    
    if (newTitle) {
        document.title = newTitle;
    }

    renderSummary();
    window.print();
    
    document.title = originalTitle;
}
// Cycle Management
function addCycle() {
    const inputEl = document.getElementById('new-cycle-input');
    const customName = inputEl ? inputEl.value.trim() : '';
    let cycleNames = [];
    if (customName) {
        const parsed = parseCycleRange(customName.replace(/cycle/i, '').trim());
        if (parsed.length > 0) {
            cycleNames = parsed.map(n => `Cycle ${n}`);
        } else {
            cycleNames = [customName];
        }
    } else {
        const cycleNum = cycles.length + 1;
        cycleNames = [`Cycle ${cycleNum}`];
    }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    let firstId = null;
    cycleNames.forEach(cycleName => {
        const newCycle = {
            id: generateId(),
            name: cycleName,
            startDate: '',
            lengthDays: '28',
            selectedAgents: {}, // agent.Agent -> { customName: '', schedules: [{...}] }
        };
        cycles.push(newCycle);
        if (!firstId) firstId = newCycle.id;
    });
    if (inputEl) inputEl.value = '';
    if (firstId) {
        selectCycle(firstId);
    }
    renderSidebar();
}
function selectCycle(id) {
    currentCycleId = id;
    currentScheduleCycleId = id;
    currentView = 'cycle';
    renderSidebar();
    updateMainContent();
}
function showResponseEotView() {
    currentView = 'response';
    renderSidebar();
    updateMainContent();
}
function deleteCurrentCycle() {
    if (!currentCycleId) return;
    // A merged card stands for every cycle in its group, so REMOVE deletes them all
    const group = getGroupOfCycle(currentCycleId);
    const idsToDelete = group ? group.ids : [currentCycleId];
    const message = idsToDelete.length > 1
        ? `Are you sure you want to delete all ${idsToDelete.length} cycles in "${group.label}"?`
        : 'Are you sure you want to delete this cycle?';
    if (confirm(message)) {
        cycles = cycles.filter(c => !idsToDelete.includes(c.id));
        if (cycles.length > 0) {
            selectCycle(cycles[cycles.length - 1].id);
        } else {
            currentCycleId = null;
            renderSidebar();
            updateMainContent();
        }
    }
}
function getCycle(id) {
    return cycles.find(c => c.id === id);
}
// Cycle grouping: consecutive cycles that share the exact same treatment content
// (cycle length + agents + dose/dosing-day + calendar day-overrides) are displayed as a
// single merged card, e.g. "Cycle 1-2". Grouping is purely derived from the cycle data --
// nothing is merged in memory or in the database, so editing one cycle simply splits it
// back out of its group on the next render.
function scheduleContentSignature(schedule) {
    const overrides = schedule.dayOverrides || {};
    const overridePart = Object.keys(overrides)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .map(day => {
            const ov = overrides[day] || {};
            return [day, ov.deleted ? 'x' : '', ov.movedTo !== undefined ? ov.movedTo : '', ov.dose || ''].join(':');
        })
        .join('|');
    return [
        schedule.dose || '',
        schedule.dose === 'Others' ? (schedule.customDose || '') : '',
        schedule.dosingDays || '',
        schedule.dosingDays === 'Others' ? (schedule.customDays || '') : '',
        overridePart
    ].join('~');
}
function cycleContentSignature(cycle) {
    const agentKeys = Object.keys(cycle.selectedAgents).sort();
    if (agentKeys.length === 0) return null; // an empty cycle has no content to merge on
    const agentPart = agentKeys.map(key => {
        const data = cycle.selectedAgents[key];
        const schedules = (data.schedules || []).map(scheduleContentSignature).sort().join(';');
        return `${key}=${data.customName || ''}[${schedules}]`;
    }).join('&&');
    return `${cycle.lengthDays || ''}##${agentPart}`;
}
function getCycleNumber(cycle) {
    const match = /^Cycle\s*(\d+)$/i.exec((cycle.name || '').trim());
    return match ? parseInt(match[1], 10) : null;
}
function getGroupLabel(groupCycles) {
    if (groupCycles.length === 1) return groupCycles[0].name;
    const firstNum = getCycleNumber(groupCycles[0]);
    const lastNum = getCycleNumber(groupCycles[groupCycles.length - 1]);
    if (firstNum !== null && lastNum !== null) return `Cycle ${firstNum}-${lastNum}`;
    return groupCycles.map(c => c.name).join(', ');
}
function getCycleGroups() {
    const groups = [];
    cycles.forEach(cycle => {
        const signature = cycleContentSignature(cycle);
        const last = groups[groups.length - 1];
        const num = getCycleNumber(cycle);
        const lastNum = last ? getCycleNumber(last.cycles[last.cycles.length - 1]) : null;
        // Only merge cycles that are adjacent in the list AND consecutively numbered,
        // so a merged card always reads as a clean "Cycle N-M" range.
        const isConsecutive = last && num !== null && lastNum !== null && num === lastNum + 1;
        if (last && signature !== null && last.signature === signature && isConsecutive) {
            last.cycles.push(cycle);
        } else {
            groups.push({ signature, cycles: [cycle] });
        }
    });
    groups.forEach(group => {
        group.ids = group.cycles.map(c => c.id);
        group.label = getGroupLabel(group.cycles);
    });
    return groups;
}
function getGroupOfCycle(cycleId) {
    return getCycleGroups().find(group => group.ids.includes(cycleId)) || null;
}
// Persistence: load/save the current treatment line against the Flask API
function getFieldValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}
function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null && value !== '') el.value = value;
}
async function findLatestChemoLineId(upn) {
    try {
        const response = await fetch(`${API_BASE}/api/chemo/patient/${encodeURIComponent(upn)}/lines`);
        if (!response.ok) return null;
        const lines = await response.json();
        if (!Array.isArray(lines) || lines.length === 0) return null;
        return lines[lines.length - 1].line_id;
    } catch (err) {
        console.warn('Could not check for an existing chemo line', err);
        return null;
    }
}
// Rebuild an in-memory cycle (matching the `cycles` array shape) from a saved chemo_cycles row
function buildCycleFromRow(cycleRow) {
    const newCycle = {
        id: generateId(),
        name: cycleRow.cycle_number || 'Cycle 1',
        startDate: cycleRow.start_date || '',
        lengthDays: cycleRow.cycle_length_days != null ? String(cycleRow.cycle_length_days) : '28',
        selectedAgents: {}
    };
    (cycleRow.agents || []).forEach(agentRow => {
        const agentDef = agentsData.find(a => a.Agent === agentRow.agent_name);
        const bucketKey = agentDef ? agentRow.agent_name : 'Others';
        if (!newCycle.selectedAgents[bucketKey]) {
            newCycle.selectedAgents[bucketKey] = { customName: agentDef ? '' : (agentRow.agent_name || ''), schedules: [] };
        }
        let doseVal = agentRow.dose || '';
        let customDose = '';
        const allowedDoses = agentDef && agentDef.Dose ? agentDef.Dose.split(',').map(d => d.trim()) : [];
        if (!agentDef || (doseVal && !allowedDoses.includes(doseVal))) {
            customDose = doseVal;
            doseVal = doseVal ? 'Others' : null;
        }
        let daysVal = agentRow.dosing_days || '';
        let customDays = '';
        const allowedDays = agentDef && agentDef.Dosing_day ? agentDef.Dosing_day.split(',').map(d => d.trim()) : [];
        if (!agentDef || (daysVal && !allowedDays.includes(daysVal))) {
            customDays = daysVal;
            daysVal = daysVal ? 'Others' : null;
        }
        const dayOverrides = {};
        (agentRow.day_overrides || []).forEach(ov => {
            const entry = {};
            if (ov.is_deleted) entry.deleted = true;
            if (ov.moved_to_day !== null && ov.moved_to_day !== undefined) entry.movedTo = ov.moved_to_day;
            if (ov.override_dose) entry.dose = ov.override_dose;
            dayOverrides[ov.origin_day] = entry;
        });
        newCycle.selectedAgents[bucketKey].schedules.push({
            id: generateId(),
            dose: doseVal,
            dosingDays: daysVal,
            customDose,
            customDays,
            dayOverrides
        });
    });
    return newCycle;
}
// Populate the whole page (Line/Regimen, Response/Progression/EOT, all cycles) from a saved chemo_lines record
function applyLineData(line) {
    const lineSelect = document.getElementById('line-input');
    const regimenSelect = document.getElementById('regimen-input');
    const customRegimenInput = document.getElementById('custom-regimen-input');
    if (lineSelect && line.line_number) lineSelect.value = line.line_number;
    if (regimenSelect && line.regimen) {
        const hasOption = Array.from(regimenSelect.options).some(o => o.value === line.regimen);
        if (hasOption) regimenSelect.value = line.regimen;
        if (line.regimen === 'Others' && customRegimenInput) {
            customRegimenInput.value = line.custom_regimen || '';
            customRegimenInput.classList.remove('hidden');
        }
    }
    setFieldValue('date-of-first-response', line.date_first_response);
    setFieldValue('depth-of-first-response', line.depth_first_response);
    setFieldValue('date-of-best-response', line.date_best_response);
    setFieldValue('depth-of-best-response', line.depth_best_response);
    setFieldValue('disease-progression', line.disease_progression);
    const dpDateContainer = document.getElementById('dp-date-container');
    if (dpDateContainer) dpDateContainer.style.visibility = line.disease_progression === 'Yes' ? 'visible' : 'hidden';
    setFieldValue('date-of-disease-progression', line.date_progression);
    setFieldValue('end-of-treatment-date', line.end_of_tx_date);
    setFieldValue('cessation-reason', line.cessation_reason);
    const isOthers = line.cessation_reason === 'Others';
    const isProgression = line.cessation_reason === 'Disease progression';
    const isTox = line.cessation_reason === 'Toxicity / Side effects';
    const customCessationEl = document.getElementById('custom-cessation-reason');
    const progressionTypeEl = document.getElementById('disease-progression-type');
    const toxicitySpecifyEl = document.getElementById('toxicity-specify');
    const toxicityGradeEl = document.getElementById('toxicity-grade');
    if (customCessationEl) customCessationEl.style.display = isOthers ? 'block' : 'none';
    if (progressionTypeEl) progressionTypeEl.style.display = isProgression ? 'block' : 'none';
    if (toxicitySpecifyEl) toxicitySpecifyEl.style.display = isTox ? 'block' : 'none';
    if (toxicityGradeEl) toxicityGradeEl.style.display = isTox ? 'block' : 'none';
    setFieldValue('custom-cessation-reason', line.custom_cessation_reason);
    setFieldValue('disease-progression-type', line.progression_type);
    setFieldValue('toxicity-specify', line.toxicity_specify);
    setFieldValue('toxicity-grade', line.toxicity_grade);

    loadedRefractoryAgents = line.refractory_agents || {};
    cycles = (line.cycles || []).map(buildCycleFromRow);

    document.querySelectorAll('select').forEach(updateSelectDefaultStyle);
}
async function loadExistingChemoLine(lineId) {
    try {
        const response = await fetch(`${API_BASE}/api/chemo/lines/${lineId}`);
        if (!response.ok) {
            currentLineId = null;
            return;
        }
        const line = await response.json();
        applyLineData(line);
    } catch (err) {
        console.warn('Could not load existing chemo line, starting blank.', err);
        currentLineId = null;
    }
}
// Flatten the in-memory `cycles` array into the JSON shape the /api/chemo endpoints expect
function buildLinePayload() {
    const regimenSelect = document.getElementById('regimen-input');
    const customRegimenInput = document.getElementById('custom-regimen-input');
    let regimenVal = regimenSelect ? regimenSelect.value : '';
    let customRegimenVal = regimenVal === 'Others' ? (customRegimenInput ? customRegimenInput.value : '') : '';

    // Conditional fields are only persisted when the selection that reveals them is active,
    // so a hidden select's leftover default never lands in the database.
    const cessationVal = getFieldValue('cessation-reason');
    const customCessationVal = cessationVal === 'Others' ? getFieldValue('custom-cessation-reason') : '';
    const isTox = cessationVal === 'Toxicity / Side effects';
    const progressionVal = getFieldValue('disease-progression');

    updateEndOfTreatmentAgents();
    const refractoryAgents = {};
    document.querySelectorAll('#eot-agents-container select.refractory-select').forEach(sel => {
        refractoryAgents[sel.dataset.agent] = sel.value;
    });

    const cyclesPayload = cycles.map(cycle => {
        const agents = [];
        Object.keys(cycle.selectedAgents).forEach(agentKey => {
            const data = cycle.selectedAgents[agentKey];
            const agentDef = agentsData.find(a => a.Agent === agentKey);
            const agentName = agentKey === 'Others' ? (data.customName || 'Others') : agentKey;
            const agentClass = agentDef ? agentDef.Class : 'Others';
            data.schedules.forEach((schedule, idx) => {
                const dose = schedule.dose === 'Others' ? schedule.customDose : (schedule.dose || '');
                const dosingDays = schedule.dosingDays === 'Others' ? schedule.customDays : (schedule.dosingDays || '');
                const dayOverrides = Object.entries(schedule.dayOverrides || {}).map(([originDay, ov]) => ({
                    origin_day: parseInt(originDay, 10),
                    is_deleted: !!ov.deleted,
                    moved_to_day: ov.movedTo !== undefined ? ov.movedTo : null,
                    override_dose: ov.dose || null
                }));
                agents.push({
                    agent_class: agentClass,
                    agent_name: agentName,
                    dose,
                    dosing_days: dosingDays,
                    schedule_order: idx + 1,
                    day_overrides: dayOverrides
                });
            });
        });
        return {
            cycle_number: cycle.name,
            start_date: cycle.startDate || null,
            cycle_length_days: parseInt(cycle.lengthDays, 10) || null,
            agents
        };
    });

    return {
        line_number: getFieldValue('line-input'),
        regimen: regimenVal,
        custom_regimen: customRegimenVal,
        date_first_response: getFieldValue('date-of-first-response'),
        depth_first_response: getFieldValue('depth-of-first-response'),
        date_best_response: getFieldValue('date-of-best-response'),
        depth_best_response: getFieldValue('depth-of-best-response'),
        disease_progression: progressionVal,
        date_progression: progressionVal === 'Yes' ? getFieldValue('date-of-disease-progression') : '',
        end_of_tx_date: getFieldValue('end-of-treatment-date'),
        cessation_reason: cessationVal,
        custom_cessation_reason: customCessationVal,
        progression_type: cessationVal === 'Disease progression' ? getFieldValue('disease-progression-type') : '',
        toxicity_specify: isTox ? getFieldValue('toxicity-specify') : '',
        toxicity_grade: isTox ? getFieldValue('toxicity-grade') : '',
        refractory_agents: refractoryAgents,
        cycles: cyclesPayload
    };
}
async function saveChemoLine() {
    const payload = buildLinePayload();
    try {
        let response;
        if (currentLineId) {
            response = await fetch(`${API_BASE}/api/chemo/lines/${currentLineId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            response = await fetch(`${API_BASE}/api/chemo/patient/${encodeURIComponent(DEFAULT_PATIENT_UPN)}/lines`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        if (response.ok) {
            const result = await response.json();
            if (result.line_id) {
                currentLineId = result.line_id;
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('upn', DEFAULT_PATIENT_UPN);
                newUrl.searchParams.set('line_id', currentLineId);
                window.history.replaceState({}, '', newUrl);
            }
            alert('Chemotherapy data saved successfully.');
        } else {
            const errText = await response.text();
            alert('Error saving data: ' + errText);
        }
    } catch (err) {
        alert('Connection to local server failed. Please ensure the server is running.');
    }
}
// UI Rendering
function renderSidebar() {
    cycleListEl.innerHTML = '';
    getCycleGroups().forEach(group => {
        const isActive = currentView === 'cycle' && group.ids.includes(currentCycleId);
        const el = document.createElement('div');
        el.className = `cycle-item ${isActive ? 'active' : ''}`;
        // Keep the already-selected member selected when re-clicking its own merged card
        el.onclick = () => selectCycle(group.ids.includes(currentCycleId) ? currentCycleId : group.ids[0]);
        const cycle = group.cycles[0]; // every cycle in a group has identical content
        const agentsCount = Object.keys(cycle.selectedAgents).length;
        let summary = agentsCount > 0 ? `${agentsCount} agent(s)` : 'No agents';
        if (cycle.lengthDays) summary += ` • ${cycle.lengthDays} Days`;
        const startDates = group.cycles.map(c => c.startDate).filter(Boolean);
        if (startDates.length > 0) {
            const format = d => d.slice(2); // YYYY-MM-DD to YY-MM-DD
            summary += startDates.length > 1
                ? `<br>Start: ${format(startDates[0])} ~ ${format(startDates[startDates.length - 1])}`
                : `<br>Start: ${format(startDates[0])}`;
        }
        el.innerHTML = `
            <div>
                <div class="cycle-name">${escapeHtml(group.label)}</div>
                <div class="cycle-summary">${summary}</div>
            </div>
            ${isActive ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' : ''}
        `;
        cycleListEl.appendChild(el);
    });
    if (responseEotNavItemEl) {
        responseEotNavItemEl.classList.toggle('active', currentView === 'response');
    }
}
function updateMainContent() {
    if (currentView === 'response') {
        emptyStateEl.classList.add('hidden');
        cyclePlannerEl.classList.add('hidden');
        responseEotViewEl.classList.remove('hidden');
        updateEndOfTreatmentAgents();
        return;
    }
    responseEotViewEl.classList.add('hidden');
    if (!currentCycleId) {
        emptyStateEl.classList.remove('hidden');
        cyclePlannerEl.classList.add('hidden');
        return;
    }
    emptyStateEl.classList.add('hidden');
    cyclePlannerEl.classList.remove('hidden');
    const cycle = getCycle(currentCycleId);
    const lineSelect = document.getElementById('line-input');
    let lineVal = '';
    if (lineSelect) {
        lineVal = ['Consolidation', 'Maintenance'].includes(lineSelect.value) ? lineSelect.value : `${lineSelect.value} Line`;
    }
    const regimenSelect = document.getElementById('regimen-input');
    let regimenVal = regimenSelect ? regimenSelect.value : '';
    if (regimenVal === 'Others') {
        const customRegimenInput = document.getElementById('custom-regimen-input');
        regimenVal = customRegimenInput ? customRegimenInput.value : '';
    }
    const group = getGroupOfCycle(cycle.id);
    const cycleLabel = group ? group.label : cycle.name;
    currentCycleTitleEl.textContent = regimenVal ? `${lineVal} ${regimenVal} ${cycleLabel}`.trim() : `${lineVal} ${cycleLabel}`.trim();
    const startDateInput = document.getElementById('cycle-start-date');
    const startDateLabel = document.getElementById('cycle-start-date-label');
    const lengthInput = document.getElementById('cycle-length');
    // In a merged card the start date belongs to one specific cycle, so name it
    if (startDateLabel) {
        if (group && group.cycles.length > 1) {
            startDateLabel.innerHTML = `Start Date<br><span style="font-weight: 500; color: var(--text-secondary);">(${escapeHtml(cycle.name)})</span>`;
            startDateLabel.style.lineHeight = '1.25';
        } else {
            startDateLabel.textContent = 'Start Date';
            startDateLabel.style.lineHeight = '';
        }
    }
    if (startDateInput) { startDateInput.value = cycle.startDate || ''; startDateInput.setAttribute('data-date', startDateInput.value); }
    if (lengthInput) lengthInput.value = cycle.lengthDays || '';
    updateCheckboxesForCurrentCycle();
    renderAgentConfigs();
    renderSummary();
}
// Agent Selection
function renderAgentCheckboxes() {
    agentClassesContainer.innerHTML = '';
    for (const [className, classAgents] of Object.entries(groupedAgents)) {
        const groupEl = document.createElement('div');
        groupEl.className = 'agent-class-group';
        const titleEl = document.createElement('h4');
        titleEl.className = 'class-title';
        titleEl.textContent = className;
        groupEl.appendChild(titleEl);
        const listEl = document.createElement('div');
        listEl.className = 'checkbox-list';
        classAgents.forEach(agent => {
            const itemContainer = document.createElement('div');
            itemContainer.className = 'checkbox-item-container';
            const label = document.createElement('label');
            label.className = 'custom-checkbox';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = agent.Agent;
            input.id = `checkbox-${agent.Agent.replace(/\s+/g, '-')}`;
            input.addEventListener('change', (e) => {
                handleAgentSelectionChange(agent, e.target.checked);
                if (agent.Agent === 'Others') {
                    const customInput = document.getElementById('custom-agent-input');
                    if (e.target.checked) {
                        customInput.classList.remove('hidden');
                        customInput.focus();
                    } else {
                        customInput.classList.add('hidden');
                        customInput.value = '';
                    }
                }
            });
            label.appendChild(input);
            const checkmark = document.createElement('div');
            checkmark.className = 'checkmark';
            label.appendChild(checkmark);
            const textContainer = document.createElement('div');
            textContainer.className = 'agent-label';
            const abbr = agent.Abbrevations || agent.Abbreviations;
            textContainer.innerHTML = `
                <span class="agent-name">${agent.Agent}</span>
                ${abbr ? `<span class="agent-abbr">${abbr}</span>` : ''}
            `;
            label.appendChild(textContainer);
            itemContainer.appendChild(label);
            if (agent.Agent === 'Others') {
                const customInput = document.createElement('input');
                customInput.type = 'text';
                customInput.id = 'custom-agent-input';
                customInput.className = 'custom-text-input hidden';
                customInput.placeholder = 'Enter agent name';
                customInput.addEventListener('input', (e) => {
                    const cycle = getCycle(currentCycleId);
                    if (cycle && cycle.selectedAgents['Others']) {
                        cycle.selectedAgents['Others'].customName = e.target.value;
                        const cardTitle = document.getElementById(`config-title-Others`);
                        if (cardTitle) cardTitle.textContent = e.target.value || 'Others';
                        renderSummary();
                    }
                });
                itemContainer.appendChild(customInput);
            }
            listEl.appendChild(itemContainer);
        });
        groupEl.appendChild(listEl);
        agentClassesContainer.appendChild(groupEl);
    }
}
function updateCheckboxesForCurrentCycle() {
    if (!currentCycleId) return;
    const cycle = getCycle(currentCycleId);
    agentsData.forEach(agent => {
        const input = document.getElementById(`checkbox-${agent.Agent.replace(/\s+/g, '-')}`);
        if (input) {
            input.checked = !!cycle.selectedAgents[agent.Agent];
            if (agent.Agent === 'Others') {
                const customInput = document.getElementById('custom-agent-input');
                if (input.checked) {
                    customInput.classList.remove('hidden');
                    customInput.value = cycle.selectedAgents['Others'].customName || '';
                } else {
                    customInput.classList.add('hidden');
                    customInput.value = '';
                }
            }
        }
    });
}
function handleAgentSelectionChange(agent, isSelected) {
    if (!currentCycleId) return;
    const cycle = getCycle(currentCycleId);
    if (isSelected) {
        cycle.selectedAgents[agent.Agent] = {
            customName: '',
            schedules: [{
                id: generateId(),
                dose: null,
                dosingDays: null,
                customDose: '',
                customDays: '',
                dayOverrides: {}
            }]
        };
    } else {
        delete cycle.selectedAgents[agent.Agent];
    }
    renderSidebar();
    renderAgentConfigs();
    renderSummary();
}
// Configuration (Dose & Dosing Days)
function renderAgentConfigs() {
    if (!currentCycleId) return;
    const cycle = getCycle(currentCycleId);
    const selectedAgentNames = Object.keys(cycle.selectedAgents);
    if (selectedAgentNames.length === 0) {
        agentConfigsContainer.innerHTML = '<div class="empty-agents">No agents selected for this cycle. Select agents from the list on the left.</div>';
        return;
    }
    agentConfigsContainer.innerHTML = '';
    const selectedAgents = agentsData.filter(a => selectedAgentNames.includes(a.Agent));
    selectedAgents.forEach(agent => {
        const cycleAgentData = cycle.selectedAgents[agent.Agent];
        const card = document.createElement('div');
        card.className = 'config-card';
        // Header
        const header = document.createElement('div');
        header.className = 'config-card-header';
        const displayAgentName = agent.Agent === 'Others' && cycleAgentData.customName 
            ? cycleAgentData.customName 
            : agent.Agent;
        const classSpan = agent.Agent === 'Others' ? '' : ` <span class="config-agent-class">${agent.Class}</span>`;
        header.innerHTML = `
            <div class="config-agent-name" id="config-title-${agent.Agent.replace(/\s+/g, '-')}">${displayAgentName}${classSpan}</div>
        `;
        card.appendChild(header);
        // Schedules Container
        const schedulesContainer = document.createElement('div');
        schedulesContainer.className = 'schedules-container';
        cycleAgentData.schedules.forEach((schedule, index) => {
            const scheduleBlock = document.createElement('div');
            scheduleBlock.className = 'schedule-block';
            if (index > 0) scheduleBlock.style.marginTop = '1rem';
            if (index > 0) scheduleBlock.style.paddingTop = '1rem';
            if (index > 0) scheduleBlock.style.borderTop = '1px dashed var(--border-glass)';
            const scheduleHeader = document.createElement('div');
            scheduleHeader.style.display = 'flex';
            scheduleHeader.style.justifyContent = 'space-between';
            scheduleHeader.style.alignItems = 'center';
            scheduleHeader.style.marginBottom = '0.5rem';
            const scheduleTitle = document.createElement('div');
            scheduleTitle.className = 'config-label';
            scheduleTitle.style.marginBottom = '0';
            scheduleTitle.textContent = `Schedule ${index + 1}`;
            scheduleHeader.appendChild(scheduleTitle);
            if (index > 0) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-primary';
                deleteBtn.style.padding = '0.4rem 0.8rem';
                deleteBtn.style.fontSize = '0.85rem';
                deleteBtn.style.border = 'none';
                deleteBtn.style.borderRadius = '0.25rem';
                deleteBtn.style.cursor = 'pointer';
                deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>Remove`;
                deleteBtn.onclick = () => {
                    cycleAgentData.schedules.splice(index, 1);
                    renderAgentConfigs();
                    renderSummary();
                };
                scheduleHeader.appendChild(deleteBtn);
            }
            scheduleBlock.appendChild(scheduleHeader);
            // Dose Section
            const doseSection = document.createElement('div');
            doseSection.className = 'config-section';
            const doseGroup = document.createElement('div');
            doseGroup.className = 'radio-group';
            let doses = agent.Dose ? agent.Dose.split(',').map(d => d.trim()).filter(d => d) : [];
            doses.push('Others');
            const customDoseInput = document.createElement('input');
            customDoseInput.type = 'text';
            customDoseInput.className = 'custom-text-input hidden';
            customDoseInput.placeholder = 'e.g. 1.3 mg/m2, 2.5 mg/kg, 40 mg';
            customDoseInput.value = schedule.customDose || '';
            customDoseInput.addEventListener('input', (e) => {
                schedule.customDose = e.target.value;
                renderSummary();
            });
            doses.forEach((dose, i) => {
                const radioId = `dose-${agent.Agent.replace(/\s+/g, '-')}-${schedule.id}-${i}`;
                const option = document.createElement('div');
                option.className = 'radio-option';
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `dose-${agent.Agent}-${schedule.id}`;
                input.id = radioId;
                input.value = dose;
                if (schedule.dose === dose) {
                    input.checked = true;
                    if (dose === 'Others') customDoseInput.classList.remove('hidden');
                }
                input.addEventListener('change', () => {
                    schedule.dose = dose;
                    if (dose === 'Others') {
                        customDoseInput.classList.remove('hidden');
                        customDoseInput.focus();
                    } else {
                        customDoseInput.classList.add('hidden');
                    }
                    renderSummary();
                });
                const label = document.createElement('label');
                label.className = 'radio-label';
                label.setAttribute('for', radioId);
                label.textContent = dose;
                option.appendChild(input);
                option.appendChild(label);
                doseGroup.appendChild(option);
            });
            doseSection.appendChild(doseGroup);
            doseSection.appendChild(customDoseInput);
            scheduleBlock.appendChild(doseSection);
            // Dosing Days Section
            const daysSection = document.createElement('div');
            daysSection.className = 'config-section';
            const daysGroup = document.createElement('div');
            daysGroup.className = 'radio-group';
            let daysOpts = agent.Dosing_day ? agent.Dosing_day.split(',').map(d => d.trim()).filter(d => d) : [];
            daysOpts.push('Others');
            const customDaysInput = document.createElement('input');
            customDaysInput.type = 'text';
            customDaysInput.className = 'custom-text-input hidden';
            customDaysInput.placeholder = 'e.g. D1, D1-4, D1, 4, 8, 11';
            customDaysInput.value = schedule.customDays || '';
            customDaysInput.addEventListener('input', (e) => {
                schedule.customDays = e.target.value;
                schedule.dayOverrides = {};
                renderSummary();
            });
            daysOpts.forEach((dayCode, i) => {
                const radioId = `days-${agent.Agent.replace(/\s+/g, '-')}-${schedule.id}-${i}`;
                const option = document.createElement('div');
                option.className = 'radio-option';
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `days-${agent.Agent}-${schedule.id}`;
                input.id = radioId;
                input.value = dayCode;
                if (schedule.dosingDays === dayCode) {
                    input.checked = true;
                    if (dayCode === 'Others') customDaysInput.classList.remove('hidden');
                }
                input.addEventListener('change', () => {
                    schedule.dosingDays = dayCode;
                    schedule.dayOverrides = {};
                    if (dayCode === 'Others') {
                        customDaysInput.classList.remove('hidden');
                        customDaysInput.focus();
                    } else {
                        customDaysInput.classList.add('hidden');
                    }
                    renderSummary();
                });
                const label = document.createElement('label');
                label.className = 'radio-label';
                label.setAttribute('for', radioId);
                const exactDays = dosingDaysMap[dayCode];
                const displayText = (exactDays && dayCode !== 'Others') ? exactDays : dayCode;
                const codeText = document.createTextNode(displayText);
                label.appendChild(codeText);
                option.appendChild(input);
                option.appendChild(label);
                daysGroup.appendChild(option);
            });
            daysSection.appendChild(daysGroup);
            daysSection.appendChild(customDaysInput);
            scheduleBlock.appendChild(daysSection);
            schedulesContainer.appendChild(scheduleBlock);
        });
        card.appendChild(schedulesContainer);
        // Add Schedule Button
        const btnWrapper = document.createElement('div');
        btnWrapper.style.display = 'flex';
        btnWrapper.style.justifyContent = 'flex-end';
        btnWrapper.style.marginTop = '1rem';
        const addScheduleBtn = document.createElement('button');
        addScheduleBtn.className = 'btn-secondary';
        addScheduleBtn.style.justifyContent = 'center';
        addScheduleBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18.6" height="18.6" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Schedule
        `;
        addScheduleBtn.onclick = () => {
            cycleAgentData.schedules.push({
                id: generateId(),
                dose: null,
                dosingDays: null,
                customDose: '',
                customDays: '',
                dayOverrides: {}
            });
            renderAgentConfigs();
            renderSummary();
        };
        btnWrapper.appendChild(addScheduleBtn);
        card.appendChild(btnWrapper);
        agentConfigsContainer.appendChild(card);
    });
}
function parseDosingDays(dayStr) {
    if (!dayStr) return [];
    let s = dayStr.replace(/D/gi, '').trim();
    const parts = s.split(',').map(p => p.trim());
    const days = new Set();
    parts.forEach(p => {
        if (p.includes('-')) {
            const [start, end] = p.split('-').map(x => parseInt(x));
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) days.add(i);
            }
        } else {
            const day = parseInt(p);
            if (!isNaN(day)) days.add(day);
        }
    });
    return Array.from(days).sort((a,b) => a - b);
}
// Helper to dim select boxes when they have their default values
function updateSelectDefaultStyle(select) {
    if (select.options.length > 0 && select.selectedIndex >= 0) {
        if (select.options[select.selectedIndex].defaultSelected || select.options[select.selectedIndex].value === "") {
            select.classList.add('is-default');
        } else {
            select.classList.remove('is-default');
        }
    }
}
// Global change listener for select styling
document.addEventListener('change', function(e) {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'select') {
        updateSelectDefaultStyle(e.target);
    }
});
// Summary
// Toolbar shown at the top of "3. Treatment Schedule": lets the user pick which cycle of a
// merged card the calendar below refers to, and edit that cycle's own start date.
function buildScheduleToolbarHtml(cycle) {
    const group = getGroupOfCycle(cycle.id);
    const groupCycles = group ? group.cycles : [cycle];
    let html = '<div class="schedule-toolbar no-print">';
    if (groupCycles.length > 1) {
        html += '<div class="schedule-cycle-tabs">';
        groupCycles.forEach(c => {
            html += `<button type="button" class="schedule-cycle-btn${c.id === cycle.id ? ' active' : ''}" data-cycle-id="${c.id}">${escapeHtml(c.name)}</button>`;
        });
        html += '</div>';
    }
    // Match the top "Start Date" label exactly: plain when there's one cycle,
    // "Start Date" / "(Cycle N)" on two lines when this is a merged card.
    const isMerged = groupCycles.length > 1;
    const startDateLabelHtml = isMerged
        ? `Start Date<br><span style="font-weight: 500; color: var(--text-secondary);">(${escapeHtml(cycle.name)})</span>`
        : 'Start Date';
    html += `
        <div class="schedule-start-date">
            <label for="summary-start-date"${isMerged ? ' style="line-height: 1.25;"' : ''}>${startDateLabelHtml}</label>
            <input type="date" id="summary-start-date" class="custom-text-input custom-date-format"
                   value="${cycle.startDate || ''}" data-date="${cycle.startDate || ''}">
        </div>
    </div>`;
    return html;
}
function wireScheduleToolbar() {
    const summaryContainer = document.getElementById('summary-container');
    if (!summaryContainer) return;
    summaryContainer.querySelectorAll('.schedule-cycle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Browsing cycles here only changes what the schedule below shows -- the top
            // "1. Select Anti-Myeloma Agents" card keeps showing the merged card's first cycle.
            currentScheduleCycleId = btn.dataset.cycleId;
            renderSummary();
        });
    });
    const startDateInput = summaryContainer.querySelector('#summary-start-date');
    if (startDateInput) {
        startDateInput.addEventListener('change', (e) => {
            const scheduleCycleId = currentScheduleCycleId || currentCycleId;
            const cycle = getCycle(scheduleCycleId);
            if (!cycle) return;
            cycle.startDate = e.target.value;
            e.target.setAttribute('data-date', e.target.value);
            // Only the merged card's first cycle is mirrored in the top Start Date field
            if (scheduleCycleId === currentCycleId) {
                const topStartDate = document.getElementById('cycle-start-date');
                if (topStartDate) {
                    topStartDate.value = cycle.startDate;
                    topStartDate.setAttribute('data-date', cycle.startDate);
                }
            }
            renderSidebar();
            renderSummary();
        });
    }
}
function renderSummary() {
    if (!currentCycleId) return;
    const scheduleCycleId = (currentScheduleCycleId && getCycle(currentScheduleCycleId)) ? currentScheduleCycleId : currentCycleId;
    const cycle = getCycle(scheduleCycleId);
    const summaryContainer = document.getElementById('summary-container');
    if (!summaryContainer) return;
    const toolbarHtml = buildScheduleToolbarHtml(cycle);
    const selectedAgentNames = Object.keys(cycle.selectedAgents);
    if (selectedAgentNames.length === 0) {
        summaryContainer.innerHTML = toolbarHtml + '<div class="empty-agents">No configuration to summarize.</div>';
        wireScheduleToolbar();
        return;
    }
    // Initialize calendar days
    const cycleLength = parseInt(cycle.lengthDays) || 28;
    const daysMap = {};
    for(let d = 1; d <= cycleLength; d++) {
        daysMap[d] = [];
    }
    selectedAgentNames.forEach(agentName => {
        const data = cycle.selectedAgents[agentName];
        const displayAgentName = agentName === 'Others' && data.customName ? data.customName : agentName;
        data.schedules.forEach(schedule => {
            const baseDose = schedule.dose === 'Others' ? schedule.customDose : (schedule.dose || '');
            const dayStr = schedule.dosingDays === 'Others' ? schedule.customDays : dosingDaysMap[schedule.dosingDays];
            const basePattern = parseDosingDays(dayStr);
            const overrides = schedule.dayOverrides || {};
            basePattern.forEach(originDay => {
                const override = overrides[originDay];
                if (override && override.deleted) return;
                const targetDay = (override && override.movedTo) ? override.movedTo : originDay;
                const dose = (override && override.dose !== undefined) ? override.dose : baseDose;
                if (targetDay >= 1 && targetDay <= cycleLength) {
                    daysMap[targetDay].push({ name: displayAgentName, dose, agentName, scheduleId: schedule.id, originDay });
                }
            });
        });
    });
    let startTimestamp = null;
    if (cycle.startDate) {
        const [y, m, d_val] = cycle.startDate.split('-');
        startTimestamp = new Date(y, m - 1, d_val).getTime();
    }
    let calendarHtml = '<div class="calendar-grid">';
    for(let d = 1; d <= cycleLength; d++) {
        let actualDateStr = '';
        if (startTimestamp) {
            const dObj = new Date(startTimestamp + (d - 1) * 24 * 60 * 60 * 1000);
            actualDateStr = `${dObj.getMonth()+1}/${dObj.getDate()}`;
        }
        calendarHtml += `<div class="calendar-day" data-day="${d}">`;
        calendarHtml += `<div class="calendar-day-header"><strong>D${d}</strong> ${actualDateStr ? `<span style="opacity:0.7">${actualDateStr}</span>` : ''}</div>`;
        daysMap[d].forEach(event => {
            const doseEmptyClass = event.dose ? '' : ' calendar-event-dose-empty';
            calendarHtml += `
                <div class="calendar-event" draggable="true"
                     data-agent="${event.agentName}" data-schedule-id="${event.scheduleId}" data-origin-day="${event.originDay}"
                     title="Drag to move to another day">
                    <button type="button" class="calendar-event-delete" title="Delete">&times;</button>
                    <span class="calendar-event-abbr">${event.name}</span>
                    <span class="calendar-event-dose${doseEmptyClass}" data-dose="${event.dose || ''}" title="Click to edit dose">${event.dose || 'dose'}</span>
                </div>
            `;
        });
        calendarHtml += `</div>`; // .calendar-day
    }
    calendarHtml += '</div>';
    const regimenSelect = document.getElementById('regimen-input');
    let regimenVal = regimenSelect ? regimenSelect.value : '';
    if (regimenVal === 'Others') {
        const customRegimenInput = document.getElementById('custom-regimen-input');
        regimenVal = customRegimenInput ? customRegimenInput.value : '';
    }
    const metaLabeledFields = [
        ['UPN', DEFAULT_PATIENT_UPN],
        ['Name', DEFAULT_PATIENT_NAME],
        ['Regimen', regimenVal]
    ].filter(([, value]) => value);
    const metaParts = metaLabeledFields.map(([label, value]) => `<strong>${label}:</strong> ${escapeHtml(value)}`);
    if (cycle && cycle.name) {
        metaParts.push(escapeHtml(cycle.name.replace(/^Cycle\s*/i, 'Cycle #')));
    }
    const metaHtml = `
        <div class="summary-meta screen-hidden">
            ${metaParts.map(part => `<span style="margin-right: 1.5rem;">${part}</span>`).join('')}
        </div>
    `;
    summaryContainer.innerHTML = toolbarHtml + metaHtml + calendarHtml;
    wireScheduleToolbar();
    updateEndOfTreatmentAgents();
}
// Drag-to-move / click-to-delete for individual calendar events
let draggedCalendarEvent = null;
function findScheduleById(agentName, scheduleId) {
    if (!currentCycleId) return null;
    const cycle = getCycle(currentCycleId);
    const data = cycle.selectedAgents[agentName];
    if (!data) return null;
    return data.schedules.find(s => s.id === scheduleId) || null;
}
function cleanupOverride(schedule, originDay) {
    const ov = schedule.dayOverrides[originDay];
    if (ov && !ov.deleted && ov.movedTo === undefined && !ov.dose) {
        delete schedule.dayOverrides[originDay];
    }
}
function moveCalendarEvent(agentName, scheduleId, originDay, targetDay) {
    const schedule = findScheduleById(agentName, scheduleId);
    if (!schedule) return;
    if (!schedule.dayOverrides) schedule.dayOverrides = {};
    if (!schedule.dayOverrides[originDay]) schedule.dayOverrides[originDay] = {};
    if (targetDay === originDay) {
        delete schedule.dayOverrides[originDay].movedTo;
    } else {
        schedule.dayOverrides[originDay].movedTo = targetDay;
    }
    cleanupOverride(schedule, originDay);
    renderSummary();
}
function deleteCalendarEvent(agentName, scheduleId, originDay) {
    const schedule = findScheduleById(agentName, scheduleId);
    if (!schedule) return;
    if (!schedule.dayOverrides) schedule.dayOverrides = {};
    if (!schedule.dayOverrides[originDay]) schedule.dayOverrides[originDay] = {};
    schedule.dayOverrides[originDay].deleted = true;
    renderSummary();
}
function setEventDose(agentName, scheduleId, originDay, doseValue) {
    const schedule = findScheduleById(agentName, scheduleId);
    if (!schedule) return;
    if (!schedule.dayOverrides) schedule.dayOverrides = {};
    if (!schedule.dayOverrides[originDay]) schedule.dayOverrides[originDay] = {};
    if (doseValue) {
        schedule.dayOverrides[originDay].dose = doseValue;
    } else {
        delete schedule.dayOverrides[originDay].dose;
    }
    cleanupOverride(schedule, originDay);
    renderSummary();
}
function startDoseEdit(doseEl) {
    const eventEl = doseEl.closest('.calendar-event');
    if (!eventEl || eventEl.querySelector('.calendar-event-dose-input')) return;
    const agentName = eventEl.dataset.agent;
    const scheduleId = eventEl.dataset.scheduleId;
    const originDay = parseInt(eventEl.dataset.originDay, 10);
    const currentValue = doseEl.dataset.dose || '';
    eventEl.setAttribute('draggable', 'false');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'calendar-event-dose-input';
    input.value = currentValue;
    doseEl.replaceWith(input);
    input.focus();
    input.select();
    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        setEventDose(agentName, scheduleId, originDay, input.value.trim());
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            input.blur();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            committed = true;
            renderSummary();
        }
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('mousedown', (ev) => ev.stopPropagation());
}
function setupCalendarDragDrop() {
    const container = document.getElementById('summary-container');
    if (!container) return;
    container.addEventListener('dragstart', (e) => {
        const eventEl = e.target.closest('.calendar-event');
        if (!eventEl) return;
        draggedCalendarEvent = {
            agentName: eventEl.dataset.agent,
            scheduleId: eventEl.dataset.scheduleId,
            originDay: parseInt(eventEl.dataset.originDay, 10)
        };
        e.dataTransfer.effectAllowed = 'move';
        eventEl.classList.add('dragging');
    });
    container.addEventListener('dragend', (e) => {
        const eventEl = e.target.closest('.calendar-event');
        if (eventEl) eventEl.classList.remove('dragging');
        draggedCalendarEvent = null;
        container.querySelectorAll('.calendar-day.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    container.addEventListener('dragover', (e) => {
        if (!draggedCalendarEvent) return;
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dayEl.classList.add('drag-over');
    });
    container.addEventListener('dragleave', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl) dayEl.classList.remove('drag-over');
    });
    container.addEventListener('drop', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || !draggedCalendarEvent) return;
        e.preventDefault();
        dayEl.classList.remove('drag-over');
        const targetDay = parseInt(dayEl.dataset.day, 10);
        const { agentName, scheduleId, originDay } = draggedCalendarEvent;
        draggedCalendarEvent = null;
        moveCalendarEvent(agentName, scheduleId, originDay, targetDay);
    });
    container.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.calendar-event-delete');
        if (delBtn) {
            const eventEl = delBtn.closest('.calendar-event');
            deleteCalendarEvent(eventEl.dataset.agent, eventEl.dataset.scheduleId, parseInt(eventEl.dataset.originDay, 10));
            return;
        }
        const doseEl = e.target.closest('.calendar-event-dose');
        if (doseEl) {
            startDoseEdit(doseEl);
        }
    });
}
function updateEndOfTreatmentAgents() {
    const eotContainer = document.getElementById('eot-agents-container');
    if (!eotContainer) return;
    const usedAgents = new Set();
    cycles.forEach(cycle => {
        Object.keys(cycle.selectedAgents).forEach(agentName => {
            if (agentName.toLowerCase() === 'dexamethasone') return;
            const data = cycle.selectedAgents[agentName];
            const displayAgentName = agentName === 'Others' && data.customName ? data.customName : agentName;
            usedAgents.add(displayAgentName);
        });
    });
    if (usedAgents.size === 0) {
        eotContainer.innerHTML = '<div class="empty-agents" style="grid-column: 1 / -1; font-size: 0.9rem; color: var(--text-secondary);">No agents selected yet.</div>';
        return;
    }
    const existingSelections = {};
    const existingSelects = eotContainer.querySelectorAll('select.refractory-select');
    existingSelects.forEach(select => {
        existingSelections[select.dataset.agent] = select.value;
    });
    eotContainer.innerHTML = '';
    const classOrder = ["BsAb", "Anti-CD38 mAb", "XPO1i", "PI", "IMiD", "Alkylating"];
    function getAgentClass(agentName) {
        const found = agentsData.find(a => a.Agent === agentName);
        return found ? found.Class : "Unknown";
    }
    const sortedAgents = Array.from(usedAgents).sort((a, b) => {
        const classA = getAgentClass(a);
        const classB = getAgentClass(b);
        let indexA = classOrder.indexOf(classA);
        let indexB = classOrder.indexOf(classB);
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;
        if (indexA !== indexB) {
            return indexA - indexB;
        }
        return a.localeCompare(b);
    });
    sortedAgents.forEach(agent => {
        const idSafeAgent = agent.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.flexDirection = 'row';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.gap = '0.5rem';
        const label = document.createElement('label');
        label.setAttribute('for', `refractory-${idSafeAgent}`);
        label.style.fontSize = '0.85rem';
        label.style.fontWeight = '600';
        label.style.color = '#e2e8f0';
        label.style.flex = '1';
        label.textContent = agent;
        const select = document.createElement('select');
        select.id = `refractory-${idSafeAgent}`;
        select.className = 'custom-text-input refractory-select';
        select.style.margin = '0';
        select.style.padding = '0.25rem 0.5rem';
        select.style.flex = '1';
        select.style.minWidth = '0';
        select.style.fontSize = '0.95rem';
        select.style.height = '2.1rem';
        select.dataset.agent = agent;
        select.innerHTML = `
            <option value="Yes" selected>Yes</option>
            <option value="No">No</option>
        `;
        if (existingSelections[agent]) {
            select.value = existingSelections[agent];
        } else if (loadedRefractoryAgents[agent]) {
            select.value = loadedRefractoryAgents[agent];
        }
        updateSelectDefaultStyle(select);
        div.appendChild(label);
        div.appendChild(select);
        eotContainer.appendChild(div);
    });
}
// Run app
document.addEventListener('DOMContentLoaded', loadData);
// Set data-date attribute for date inputs (without setting default value)
document.addEventListener('DOMContentLoaded', () => {
    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length > 0) {
        dateInputs.forEach(input => {
            if (input.value) {
                input.setAttribute('data-date', input.value);
            }
            input.addEventListener('change', function() {
                this.setAttribute('data-date', this.value);
            });
        });
    }
    
    // Initialize default styling for all select dropdowns
    const allSelects = document.querySelectorAll('select');
    allSelects.forEach(select => {
        updateSelectDefaultStyle(select);
    });
});

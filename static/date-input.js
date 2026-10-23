/*
 * Typeable yyyy-mm-dd date fields.
 *
 * Pages that load this script get every <input type="date"> (including ones rendered later via
 * innerHTML) turned into a plain text field that:
 *   - auto-inserts the hyphens while digits are typed (20251124 -> 2025-11-24),
 *   - normalises pasted/typed 2025.11.24, 2025/11/24, 251124 ... to yyyy-mm-dd when it changes,
 *   - opens the browser's date picker from the calendar icon (or Alt+ArrowDown),
 *   - flags text that isn't a real date with the .date-invalid class.
 * `.value` stays a yyyy-mm-dd string, so code reading/writing these fields needs no change.
 */
(function () {
    const pad = (n) => String(n).padStart(2, '0');

    // Returns 'yyyy-mm-dd', '' for empty input, or null if the text isn't a valid date.
    function normalizeDate(raw) {
        const s = (raw || '').trim();
        if (!s) return '';
        let y, m, d;
        // 2025-11-24, 2025.11.24, 2025/1/5, 2025. 11. 24. -- or exactly 8 digits, 20251124
        let match = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match) {
            [, y, m, d] = match.map(Number);
        } else if ((match = s.match(/^(\d{2})[-./]?(\d{2})[-./]?(\d{2})$/))) {
            // yymmdd: years up to this year are 20xx, later ones 19xx
            const yy = Number(match[1]);
            y = (yy <= new Date().getFullYear() % 100 ? 2000 : 1900) + yy;
            m = Number(match[2]);
            d = Number(match[3]);
        } else {
            return null;
        }
        const date = new Date(Date.UTC(y, m - 1, d));
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
        return `${y}-${pad(m)}-${pad(d)}`;
    }

    function upgrade(input) {
        if (input.dataset.dateText) return;
        input.dataset.dateText = 'true';
        input.type = 'text';
        input.classList.remove('custom-date-format');
        input.classList.add('date-text-input');
        input.placeholder = 'yyyy-mm-dd';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
    }

    function upgradeAll(root) {
        if (root.matches && root.matches('input[type="date"]')) upgrade(root);
        if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(upgrade);
    }

    // One hidden native date input, positioned over the field, provides the calendar popup.
    let picker = null;
    let pickerTarget = null;

    function openPicker(input) {
        if (!picker) {
            picker = document.createElement('input');
            picker.type = 'date';
            picker.tabIndex = -1;
            picker.setAttribute('aria-hidden', 'true');
            picker.style.cssText = 'position: fixed; opacity: 0; pointer-events: none; border: 0; padding: 0;';
            picker.addEventListener('change', () => {
                if (!pickerTarget || !picker.value) return;
                pickerTarget.value = picker.value;
                pickerTarget.dispatchEvent(new Event('input', { bubbles: true }));
                pickerTarget.dispatchEvent(new Event('change', { bubbles: true }));
            });
            document.body.appendChild(picker);
        }
        const rect = input.getBoundingClientRect();
        Object.assign(picker.style, {
            left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
        });
        pickerTarget = input;
        picker.value = normalizeDate(input.value) || '';
        try {
            picker.showPicker();
        } catch (e) {
            picker.focus();
        }
    }

    const isDateField = (el) => el && el.classList && el.classList.contains('date-text-input');

    // Hyphens while typing digits at the end of the field
    document.addEventListener('input', (e) => {
        const input = e.target;
        if (!isDateField(input) || !e.inputType || !e.inputType.startsWith('insert')) return;
        if (input.selectionStart !== input.value.length) return;
        // A separator typed right after an auto-inserted hyphen (2025- + ".") is swallowed
        if (/^[-./\s]$/.test(e.data || '') && /-[-./\s]$/.test(input.value)) {
            input.value = input.value.slice(0, -1);
            return;
        }
        if (!/^[\d-]*$/.test(input.value)) return;
        const digits = input.value.replace(/\D/g, '').slice(0, 8);
        let formatted = digits.slice(0, 4);
        if (digits.length > 4) formatted += '-' + digits.slice(4, 6);
        if (digits.length > 6) formatted += '-' + digits.slice(6, 8);
        if (digits.length === 4 || digits.length === 6) formatted += '-';
        input.value = formatted;
    }, true);

    // Normalise on change -- capture phase, so the page's own change handlers already see yyyy-mm-dd
    document.addEventListener('change', (e) => {
        const input = e.target;
        if (!isDateField(input)) return;
        const value = input.value.replace(/-$/, '');
        const normalized = normalizeDate(value);
        if (normalized === null) {
            input.classList.add('date-invalid');
        } else {
            input.value = normalized;
            input.classList.remove('date-invalid');
        }
    }, true);

    // Calendar icon (right padding of the field) and Alt+ArrowDown open the picker
    document.addEventListener('click', (e) => {
        const input = e.target;
        if (isDateField(input) && e.offsetX >= input.clientWidth - 28) openPicker(input);
    });
    document.addEventListener('keydown', (e) => {
        if (isDateField(e.target) && e.altKey && e.key === 'ArrowDown') {
            e.preventDefault();
            openPicker(e.target);
        }
    });

    function start() {
        upgradeAll(document.body);
        new MutationObserver((mutations) => {
            mutations.forEach(m => m.addedNodes.forEach(node => upgradeAll(node)));
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

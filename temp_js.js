
        // Section Toggle Function (Hide / Show)
        function toggleSection(containerId, btn) {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (container.style.display === 'none') {
                container.style.display = '';
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>Hide`;
            } else {
                container.style.display = 'none';
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>Show`;
            }
        }

        // Handle Transplant Type Change (Autologous vs Allogeneic)
        function handleTransplantTypeChange(selectObj, isUserAction) {
            if (!selectObj) return;
            if (isUserAction) {
                selectObj.style.color = 'var(--text-primary)';
            }
            const isAllogeneic = selectObj.value === 'Allogeneic';
            const allogeneicPanel = document.getElementById('allogeneic-details-panel');
            if (allogeneicPanel) {
                allogeneicPanel.style.display = isAllogeneic ? 'block' : 'none';
            }
            const donorTypeSel = document.getElementById('donor-type');
            const donorWrapper = document.getElementById('donor-type-wrapper');
            const donorOthers = document.getElementById('donor-type-others');

            if (donorTypeSel) {
                const naOption = Array.from(donorTypeSel.options).find(opt => opt.value === 'N/A');
                if (isAllogeneic) {
                    if (naOption) {
                        naOption.hidden = true;
                        naOption.disabled = true;
                    }
                    donorTypeSel.disabled = false;
                    if (donorTypeSel.value === 'N/A' || donorTypeSel.value === 'Autologous') {
                        donorTypeSel.value = 'Sibling';
                    }
                    donorTypeSel.style.color = 'var(--text-primary)';
                    if (donorWrapper) donorWrapper.style.opacity = '1';
                } else {
                    if (naOption) {
                        naOption.hidden = false;
                        naOption.disabled = false;
                    }
                    donorTypeSel.value = 'N/A';
                    donorTypeSel.disabled = true;
                    donorTypeSel.style.color = '#aaaaaa';
                    if (donorWrapper) donorWrapper.style.opacity = '0.5';
                    if (donorOthers) donorOthers.style.display = 'none';
                }
            }

            // Update GVHD Prophylaxis defaults (Autologous: None, Allogeneic: Cyclosporin + MTX)
            if (isUserAction) {
                resetGvhdProphylaxisForTransplantType(selectObj.value);
            }

            updateTransplantSummary();
        }

        // Reset and populate GVHD Prophylaxis list according to Transplant Type
        function resetGvhdProphylaxisForTransplantType(type) {
            const container = document.getElementById('gvhd-prophylaxis-list');
            if (!container) return;

            const allRows = container.querySelectorAll('.gvhd-prophylaxis-row');
            const firstRow = allRows[0];
            if (!firstRow) return;

            // Remove extra rows
            for (let i = 1; i < allRows.length; i++) {
                allRows[i].remove();
            }

            if (type === 'Allogeneic') {
                // Set first row: Cyclosporin
                setGvhdRowData(firstRow, {
                    agent: 'Cyclosporin',
                    dose: '3 mg/kg',
                    adminDay: 'D-1 ~'
                });

                // Add second row: MTX
                const secondRow = firstRow.cloneNode(true);
                setGvhdRowData(secondRow, {
                    agent: 'MTX',
                    dose: '5 mg/m2',
                    adminDay: 'D1, 3, 6, 11'
                });
                container.appendChild(secondRow);
            } else {
                // Autologous -> None
                setGvhdRowData(firstRow, {
                    agent: 'None',
                    dose: 'None',
                    adminDay: ''
                });
            }

            updateGvhdRemoveButtons();
        }

        // Helper to populate individual GVHD Prophylaxis row
        function setGvhdRowData(row, data) {
            const agentSel = row.querySelector('.gvhd-prophylaxis-regimen');
            const agentOthers = row.querySelector('.gvhd-prophylaxis-others');
            if (agentSel) {
                agentSel.value = data.agent || 'None';
                agentSel.style.color = data.agent === 'None' ? '#aaaaaa' : 'var(--text-primary)';
                handleGvhdProphylaxisChange(agentSel);
            }
            if (agentOthers) {
                agentOthers.value = (data.agent === 'Others' ? (data.agentOthers || '') : '');
                agentOthers.style.display = data.agent === 'Others' ? 'block' : 'none';
            }

            const doseSel = row.querySelector('.gvhd-prophylaxis-dose');
            const doseOthers = row.querySelector('.gvhd-prophylaxis-dose-others');
            if (doseSel) {
                doseSel.value = data.dose || 'None';
                doseSel.style.color = (data.dose === 'None' || !data.dose) ? '#aaaaaa' : 'var(--text-primary)';
                handleGvhdProphylaxisDoseChange(doseSel);
            }
            if (doseOthers) {
                doseOthers.value = (data.dose === 'Others' ? (data.doseOthers || '') : '');
                doseOthers.style.display = data.dose === 'Others' ? 'block' : 'none';
            }

            const dayInput = row.querySelector('.gvhd-prophylaxis-admin-day');
            if (dayInput) {
                dayInput.value = data.adminDay || data.day || '';
            }
        }

        // Handle Donor Type Change
        function handleDonorTypeChange(selectObj) {
            if (!selectObj) return;
            selectObj.style.color = 'var(--text-primary)';
            const isOthers = selectObj.value === 'Others';
            const othersInput = document.getElementById('donor-type-others');
            if (othersInput) {
                othersInput.style.display = isOthers ? 'block' : 'none';
            }
            updateTransplantSummary();
        }

        // Handle Conditioning Agent Change (Melphalan, Busulfan, Fludarabine, TBI, Others)
        function handleConditioningAgentChange(selectObj) {
            const row = selectObj.closest('.regimen-agent-row');
            if (!row) return;

            const othersInput = row.querySelector('.regimen-agent-others');
            if (othersInput) {
                othersInput.style.display = selectObj.value === 'Others' ? 'block' : 'none';
            }

            const doseSelect = row.querySelector('.regimen-dose-select');
            const doseOthers = row.querySelector('.regimen-dose-others');

            if (selectObj.value === 'Others') {
                if (doseSelect) doseSelect.style.display = 'none';
                if (doseOthers) {
                    doseOthers.style.display = 'block';
                    doseOthers.placeholder = 'e.g. 1.5 g/m2';
                }
            } else {
                if (doseSelect) {
                    doseSelect.style.display = 'block';
                    doseSelect.style.color = '#aaaaaa';
                }
                if (doseOthers) {
                    doseOthers.style.display = 'none';
                    doseOthers.placeholder = 'e.g. 160 mg/m2';
                }

                // Adjust default presets according to the chosen agent
                if (selectObj.value === 'Melphalan') {
                    doseSelect.innerHTML = `
                        <option value="100 mg/m2" selected>100 mg/m²</option>
                        <option value="70 mg/m2">70 mg/m²</option>
                        <option value="50 mg/m2">50 mg/m²</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Busulfan') {
                    doseSelect.innerHTML = `
                        <option value="3.2 mg/kg (IV)" selected>3.2 mg/kg (IV)</option>
                        <option value="0.9 mg/kg (PO)">0.9 mg/kg (PO)</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Fludarabine') {
                    doseSelect.innerHTML = `
                        <option value="30 mg/m2" selected>30 mg/m²</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Cy') {
                    doseSelect.innerHTML = `
                        <option value="50 mg/kg" selected>50 mg/kg</option>
                        <option value="60 mg/kg">60 mg/kg</option>
                        <option value="1.5 g/m2">1.5 g/m²</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'TBI') {
                    doseSelect.innerHTML = `
                        <option value="200 cGy" selected>200 cGy</option>
                        <option value="400 cGy">400 cGy</option>
                        <option value="800 cGy">800 cGy</option>
                        <option value="1200 cGy">1200 cGy</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Rabbit ATG') {
                    doseSelect.innerHTML = `
                        <option value="1.25 mg/kg" selected>1.25 mg/kg</option>
                        <option value="1.5 mg/kg">1.5 mg/kg</option>
                        <option value="2.5 mg/kg">2.5 mg/kg</option>
                        <option value="3.75 mg/kg">3.75 mg/kg</option>
                        <option value="5.0 mg/kg">5.0 mg/kg</option>
                        <option value="7.5 mg/kg">7.5 mg/kg</option>
                        <option value="10 mg/kg">10 mg/kg</option>
                        <option value="Others">Others</option>
                    `;
                }
            }
        }

        // Handle Dose Select Change
        function handleDoseSelectChange(selectObj) {
            const row = selectObj.closest('.regimen-agent-row');
            if (!row) return;
            const doseOthers = row.querySelector('.regimen-dose-others');
            if (doseOthers) {
                doseOthers.style.display = selectObj.value === 'Others' ? 'block' : 'none';
            }
        }

        // Handle GVHD Prophylaxis Change
        function handleGvhdProphylaxisChange(selectObj) {
            if (!selectObj) return;
            const row = selectObj.closest('.gvhd-prophylaxis-row');
            if (!row) return;

            const othersInput = row.querySelector('.gvhd-prophylaxis-others');
            if (othersInput) {
                othersInput.style.display = selectObj.value === 'Others' ? 'block' : 'none';
            }
            const isNone = selectObj.value === 'None';
            const doseWrapper = row.querySelector('.prophylaxis-dose-wrapper');
            const dayWrapper = row.querySelector('.prophylaxis-admin-day-wrapper');

            [doseWrapper, dayWrapper].forEach(w => {
                if (w) {
                    w.style.opacity = isNone ? '0.5' : '1';
                    w.querySelectorAll('input, select').forEach(elem => elem.disabled = isNone);
                }
            });

            const doseSelect = row.querySelector('.gvhd-prophylaxis-dose');
            const doseOthers = row.querySelector('.gvhd-prophylaxis-dose-others');
            if (doseOthers) doseOthers.style.display = 'none';

            if (doseSelect) {
                doseSelect.style.color = isNone ? '#aaaaaa' : 'var(--text-primary)';
                if (selectObj.value === 'MTX') {
                    doseSelect.innerHTML = `
                        <option value="5 mg/m2" selected>5 mg/m²</option>
                        <option value="10 mg/m2">10 mg/m²</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Cyclosporin') {
                    doseSelect.innerHTML = `
                        <option value="3 mg/kg" selected>3 mg/kg</option>
                        <option value="5 mg/kg">5 mg/kg</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Tacrolimus') {
                    doseSelect.innerHTML = `
                        <option value="0.03 mg/kg" selected>0.03 mg/kg</option>
                        <option value="0.05 mg/kg">0.05 mg/kg</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'PTCy') {
                    doseSelect.innerHTML = `
                        <option value="50 mg/kg" selected>50 mg/kg</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'MMF') {
                    doseSelect.innerHTML = `
                        <option value="15 mg/kg" selected>15 mg/kg</option>
                        <option value="1000 mg">1000 mg</option>
                        <option value="500 mg">500 mg</option>
                        <option value="Others">Others</option>
                    `;
                } else if (selectObj.value === 'Others') {
                    doseSelect.innerHTML = `
                        <option value="Others" selected>Others</option>
                    `;
                    if (doseOthers) {
                        doseOthers.style.display = 'block';
                    }
                } else {
                    doseSelect.innerHTML = `
                        <option value="None" selected>None</option>
                    `;
                }
            }

            const dayInput = row.querySelector('.gvhd-prophylaxis-admin-day');
            if (dayInput) {
                if (isNone) {
                    dayInput.value = '';
                } else if (selectObj.value === 'MTX') {
                    dayInput.placeholder = 'e.g. D1, 3, 6, 11';
                } else if (selectObj.value === 'Cyclosporin' || selectObj.value === 'Tacrolimus') {
                    dayInput.placeholder = 'e.g. D-1 ~';
                } else {
                    dayInput.placeholder = 'e.g. D1, 3, 6, 11';
                }
            }
        }

        // Handle GVHD Prophylaxis Dose Change
        function handleGvhdProphylaxisDoseChange(selectObj) {
            if (!selectObj) return;
            const row = selectObj.closest('.gvhd-prophylaxis-row');
            if (!row) return;
            const doseOthers = row.querySelector('.gvhd-prophylaxis-dose-others');
            if (doseOthers) {
                doseOthers.style.display = selectObj.value === 'Others' ? 'block' : 'none';
            }
        }

        // Add GVHD Prophylaxis Row
        function addGvhdProphylaxisRow() {
            const container = document.getElementById('gvhd-prophylaxis-list');
            if (!container) return;

            const firstRow = container.querySelector('.gvhd-prophylaxis-row');
            if (!firstRow) return;

            const newRow = firstRow.cloneNode(true);

            // Reset values in new row
            const agentSel = newRow.querySelector('.gvhd-prophylaxis-regimen');
            if (agentSel) {
                agentSel.value = 'Cyclosporin';
                agentSel.style.color = 'var(--text-primary)';
            }
            const agentOthers = newRow.querySelector('.gvhd-prophylaxis-others');
            if (agentOthers) {
                agentOthers.value = '';
                agentOthers.style.display = 'none';
            }

            const doseOthers = newRow.querySelector('.gvhd-prophylaxis-dose-others');
            if (doseOthers) {
                doseOthers.value = '';
                doseOthers.style.display = 'none';
            }

            const dayInput = newRow.querySelector('.gvhd-prophylaxis-admin-day');
            if (dayInput) {
                dayInput.value = '';
            }

            container.appendChild(newRow);
            if (agentSel) handleGvhdProphylaxisChange(agentSel);
            updateGvhdRemoveButtons();
        }

        // Remove GVHD Prophylaxis Row
        function removeGvhdProphylaxisRow(btn) {
            const row = btn.closest('.gvhd-prophylaxis-row');
            if (!row) return;
            const container = document.getElementById('gvhd-prophylaxis-list');
            const allRows = container.querySelectorAll('.gvhd-prophylaxis-row');
            if (allRows.length > 1) {
                row.remove();
                updateGvhdRemoveButtons();
            }
        }

        // Update Visibility of GVHD Prophylaxis Remove Buttons and Numbering
        function updateGvhdRemoveButtons() {
            const container = document.getElementById('gvhd-prophylaxis-list');
            if (!container) return;
            const rows = container.querySelectorAll('.gvhd-prophylaxis-row');
            rows.forEach((r, idx) => {
                const label = r.querySelector('.prophylactic-agent-label');
                if (label) {
                    label.innerHTML = `Prophylactic<br>agent #${idx + 1}`;
                }
                const btnContainer = r.querySelector('.gvhd-remove-container');
                if (btnContainer) {
                    btnContainer.style.display = rows.length > 1 ? 'flex' : 'none';
                }
            });
            updateTransplantSummary();
        }

        // Add Conditioning Agent Row (+Add)
        function addConditioningAgent() {
            const container = document.getElementById('conditioning-agents-list');
            if (!container) return;

            const firstRow = container.querySelector('.regimen-agent-row');
            const newRow = firstRow.cloneNode(true);

            // Reset inputs and values
            const selects = newRow.querySelectorAll('select');
            selects.forEach(s => {
                s.style.display = 'block';
                s.style.color = '#aaaaaa';
                s.selectedIndex = 0;
            });

            const inputs = newRow.querySelectorAll('input');
            inputs.forEach(input => {
                input.value = '';
                if (input.type === 'date') {
                    input.setAttribute('data-date', '');
                } else if (input.classList.contains('regimen-agent-others') ||
                    input.classList.contains('regimen-dose-others')) {
                    input.style.display = 'none';
                }
            });

            // Show remove button
            const removeContainer = newRow.querySelector('.row-remove-container');
            if (removeContainer) {
                removeContainer.style.display = 'flex';
            }

            container.appendChild(newRow);
            initDateInputs();
            updateRemoveButtons();
        }

        // Remove Conditioning Agent Row
        function removeConditioningAgent(btn) {
            const row = btn.closest('.regimen-agent-row');
            if (row) {
                row.remove();
                updateRemoveButtons();
            }
        }

        // Update Visibility of Remove Buttons and Numbering for Conditioning Agents
        function updateRemoveButtons() {
            const container = document.getElementById('conditioning-agents-list');
            if (!container) return;
            const rows = container.querySelectorAll('.regimen-agent-row');
            rows.forEach((r, idx) => {
                const label = r.querySelector('.regimen-agent-label');
                if (label) {
                    label.innerHTML = `Conditioning<br>agent #${idx + 1}`;
                }
                const removeCont = r.querySelector('.row-remove-container');
                if (removeCont) {
                    removeCont.style.display = rows.length > 1 ? 'flex' : 'none';
                }
            });
            updateTransplantSummary();
        }

        // Add Infused Cell Row
        function addInfusedCellRow() {
            const container = document.getElementById('infused-cell-rows-list');
            if (!container) return;

            const firstRow = container.querySelector('.infused-cell-row');
            if (!firstRow) return;

            const newRow = firstRow.cloneNode(true);

            // Reset input values in cloned row
            newRow.querySelectorAll('input').forEach(input => {
                input.value = '';
                if (input.type === 'date') {
                    input.setAttribute('data-date', '');
                }
                if (input.hasAttribute('id')) {
                    input.removeAttribute('id'); // Avoid duplicate IDs
                }
            });

            // Show remove button
            const removeContainer = newRow.querySelector('.cell-row-remove-container');
            if (removeContainer) {
                removeContainer.style.display = 'flex';
            }

            container.appendChild(newRow);
            initDateInputs();
            updateCellRemoveButtons();
        }

        // Remove Infused Cell Row
        function removeInfusedCellRow(btn) {
            const row = btn.closest('.infused-cell-row');
            if (row) {
                row.remove();
                updateCellRemoveButtons();
            }
        }

        // Update Visibility & Labels of Infused Cell Rows (Day 0, Day 1, Day 2...)
        function updateCellRemoveButtons() {
            const container = document.getElementById('infused-cell-rows-list');
            if (!container) return;
            const rows = container.querySelectorAll('.infused-cell-row');
            rows.forEach((r, idx) => {
                const label = r.querySelector('.infused-date-label');
                if (label) {
                    label.innerHTML = `Infusion<br>day ${idx + 1}`;
                }
                const removeCont = r.querySelector('.cell-row-remove-container');
                if (removeCont) {
                    removeCont.style.display = rows.length > 1 ? 'flex' : 'none';
                }
            });
            updateTransplantSummary();
        }

        // Handle Neutrophil Engraftment Status Change
        function handleNeutrophilStatusChange(selectObj) {
            const dateInput = document.getElementById('anc-date');
            if (dateInput) {
                if (selectObj.value === 'Yes') {
                    dateInput.disabled = false;
                    dateInput.style.opacity = '1';
                } else {
                    dateInput.disabled = true;
                    dateInput.style.opacity = '0.4';
                    dateInput.value = '';
                    dateInput.setAttribute('data-date', '');
                }
            }
        }

        // Handle Platelet Engraftment Status Change
        function handlePlateletStatusChange(selectObj) {
            const dateInput = document.getElementById('plt-date');
            if (dateInput) {
                if (selectObj.value === 'Yes') {
                    dateInput.disabled = false;
                    dateInput.style.opacity = '1';
                } else {
                    dateInput.disabled = true;
                    dateInput.style.opacity = '0.4';
                    dateInput.value = '';
                    dateInput.setAttribute('data-date', '');
                }
            }
        }

        // Initialize Custom Date Inputs with data-date formatting
        function initDateInputs() {
            document.querySelectorAll('input[type="date"].custom-date-format').forEach(input => {
                input.setAttribute('data-date', input.value || '');
                input.oninput = function () {
                    this.setAttribute('data-date', this.value || '');
                };
                input.onchange = function () {
                    this.setAttribute('data-date', this.value || '');
                };
            });
        }

        // Collect Conditioning Regimen Summary String
        function getConditioningSummary() {
            const rows = document.querySelectorAll('.regimen-agent-row');
            const parts = [];
            rows.forEach(r => {
                const agentSel = r.querySelector('.regimen-agent-select');
                const agentOthers = r.querySelector('.regimen-agent-others');
                let agentName = agentSel ? agentSel.value : 'Melphalan';
                if (agentName === 'Others' && agentOthers && agentOthers.value.trim()) {
                    agentName = agentOthers.value.trim();
                }

                const doseSel = r.querySelector('.regimen-dose-select');
                const doseOthers = r.querySelector('.regimen-dose-others');
                let doseVal = '';
                if (agentSel && agentSel.value === 'Others') {
                    doseVal = (doseOthers && doseOthers.value.trim()) ? doseOthers.value.trim() : '';
                } else if (doseSel) {
                    doseVal = doseSel.value;
                    if (doseVal === 'Others' && doseOthers && doseOthers.value.trim()) {
                        doseVal = doseOthers.value.trim();
                    }
                }

                const dayInput = r.querySelector('.regimen-admin-day');
                const dayVal = dayInput ? dayInput.value.trim() : '';

                if (agentName) {
                    const details = [];
                    if (doseVal) details.push(doseVal);
                    if (dayVal) details.push(dayVal);
                    parts.push(details.length > 0 ? `${agentName} (${details.join(', ')})` : agentName);
                }
            });
            return parts.length > 0 ? parts.join(' + ') : 'Melphalan (100 mg/m²)';
        }

        // Toast Message Notification
        function showToast(message) {
            const toast = document.getElementById('toast');
            const msgSpan = document.getElementById('toast-message');
            if (toast && msgSpan) {
                msgSpan.textContent = message;
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 3500);
            }
        }

        // Save & Synchronize Transplant Data
        function saveTransplantData(msg) {
            showToast(msg || 'Transplant record successfully saved');

            // Collect all Conditioning Agent rows
            const conditioningRows = [];
            document.querySelectorAll('.regimen-agent-row').forEach(row => {
                const agentSel = row.querySelector('.regimen-agent-select');
                const agentOthers = row.querySelector('.regimen-agent-others');
                let agent = agentSel ? agentSel.value : '';
                if (agent === 'Others' && agentOthers) agent = agentOthers.value;
                const doseSel = row.querySelector('.regimen-dose-select');
                const doseOthers = row.querySelector('.regimen-dose-others');
                let dose = doseSel ? doseSel.value : '';
                if (dose === 'Others' && doseOthers) dose = doseOthers.value;
                const adminDay = row.querySelector('.regimen-admin-day')?.value || '';
                conditioningRows.push({ agent, dose, adminDay });
            });

            // Collect all Infused Cell rows
            const infusedCellRows = [];
            document.querySelectorAll('.infused-cell-row').forEach(row => {
                infusedCellRows.push({
                    date: row.querySelector('.infused-cell-date')?.value || '',
                    cd34: row.querySelector('.infused-cd34-input')?.value || '',
                    tnc: row.querySelector('.infused-tnc-input')?.value || '',
                    mnc: row.querySelector('.infused-mnc-input')?.value || ''
                });
            });

            // Collect all GVHD Prophylaxis rows
            const prophylaxisRows = [];
            document.querySelectorAll('.gvhd-prophylaxis-row').forEach(row => {
                const agentSel = row.querySelector('.gvhd-prophylaxis-regimen');
                const agentOthers = row.querySelector('.gvhd-prophylaxis-others');
                let agent = agentSel ? agentSel.value : '';
                if (agent === 'Others' && agentOthers) agent = agentOthers.value;

                const doseSel = row.querySelector('.gvhd-prophylaxis-dose');
                const doseOthers = row.querySelector('.gvhd-prophylaxis-dose-others');
                let dose = doseSel ? doseSel.value : '';
                if (dose === 'Others' && doseOthers) dose = doseOthers.value;

                const adminDay = row.querySelector('.gvhd-prophylaxis-admin-day')?.value || '';

                prophylaxisRows.push({ agent, dose, adminDay });
            });

            // Build data payload
            const payload = {
                type: document.getElementById('transplant-type')?.value,
                order: document.getElementById('transplant-order')?.value,
                cellSource: document.getElementById('cell-source')?.value,
                donorType: document.getElementById('donor-type')?.value,
                donorTypeOthers: document.getElementById('donor-type-others')?.value,
                hlaMatch: document.getElementById('hla-match')?.value,
                aboMatch: document.getElementById('abo-match')?.value,
                cmvStatus: document.getElementById('cmv-status')?.value,
                conditioning: getConditioningSummary(),
                conditioningAgents: conditioningRows,
                prophylaxisAgents: prophylaxisRows,
                infusedCells: infusedCellRows,
                neutrophilStatus: document.getElementById('neutrophil-status')?.value,
                ancDate: document.getElementById('anc-date')?.value,
                plateletStatus: document.getElementById('platelet-status')?.value,
                pltDate: document.getElementById('plt-date')?.value,
                savedAt: new Date().toISOString()
            };

            try {
                localStorage.setItem('hemaCDS_transplant_data', JSON.stringify(payload));
            } catch (e) {
                console.warn('LocalStorage error:', e);
            }
        }

        // Helper: Parse Administration Days string into array of { dayNum, dayText }
        function parseDayString(rawStr, defaultNum) {
            if (!rawStr || !rawStr.trim()) {
                if (defaultNum !== undefined) {
                    const label = defaultNum === 0 ? 'D0' : (defaultNum > 0 ? `D+${defaultNum}` : `D${defaultNum}`);
                    return [{ dayNum: defaultNum, dayText: label }];
                }
                return [{ dayNum: 0, dayText: 'D0' }];
            }
            const str = rawStr.trim();
            // Check for continuous range e.g. "D-1 ~" or "D-1 to D+180"
            if (str.includes('~') || str.toLowerCase().includes('to')) {
                const firstPart = str.split(/[~]|to/i)[0].trim();
                const m = firstPart.match(/(-?\d+)/);
                const num = m ? parseInt(m[1], 10) : 0;
                return [{ dayNum: num, dayText: str }];
            }
            // Split tokens by comma, slash, space
            const tokens = str.split(/[,/ ]+/).filter(t => t.trim().length > 0);
            const results = [];
            tokens.forEach(tok => {
                const clean = tok.replace(/[^0-9\-+]/g, '');
                const num = parseInt(clean, 10);
                if (!isNaN(num)) {
                    const label = num === 0 ? 'D0' : (num > 0 ? `D+${num}` : `D${num}`);
                    results.push({ dayNum: num, dayText: label });
                } else {
                    results.push({ dayNum: 0, dayText: tok });
                }
            });
            return results.length > 0 ? results : [{ dayNum: 0, dayText: str }];
        }

        // Helper: Format Calendar Date string from D0 date
        function getCalendarDateDisplay(baseD0DateStr, offsetDays) {
            if (!baseD0DateStr || !baseD0DateStr.trim()) {
                return '<span style="color: var(--text-muted); font-size: 0.92rem;">-</span>';
            }
            const parts = baseD0DateStr.split('-');
            if (parts.length !== 3) return '<span style="color: var(--text-muted);">-</span>';
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            d.setDate(d.getDate() + offsetDays);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayOfWeek = dayNames[d.getDay()];
            const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
            return `<span style="font-family: monospace; font-size: 0.9rem; font-weight: 500; color: ${isWeekend ? '#fca5a5' : 'var(--text-primary)'};">${yyyy}-${mm}-${dd}</span> <span style="font-size: 0.78rem; color: var(--text-muted);">(${dayOfWeek})</span>`;
        }


        // Update Section 5 Summary
        function updateTransplantSummary() {
                    // 1. Overview Badges
                    const typeVal = document.getElementById('transplant-type')?.value || 'Autologous';
                    const orderVal = document.getElementById('transplant-order')?.value || '1st';
                    const cellVal = document.getElementById('cell-source')?.value || 'PBSC';
                    const donorVal = document.getElementById('donor-type')?.value || 'N/A';
                    const hlaVal = document.getElementById('hla-match')?.value || 'N/A';
                    const baseD0Date = document.getElementById('transplant-date')?.value || document.querySelector('.infused-cell-date')?.value || '';

                    const badgeType = document.getElementById('summary-badge-type');
                    if (badgeType) badgeType.textContent = `${typeVal} (${orderVal})`;

                    const badgeDate = document.getElementById('summary-badge-date');
                    if (badgeDate) {
                        badgeDate.textContent = baseD0Date ? baseD0Date : 'Not specified';
                        badgeDate.style.color = baseD0Date ? '#a78bfa' : 'var(--text-muted)';
                    }

                    const badgeCell = document.getElementById('summary-badge-cell');
                    if (badgeCell) badgeCell.textContent = cellVal;

                    const badgeDonor = document.getElementById('summary-badge-donor');
                    if (badgeDonor) {
                        if (typeVal === 'Autologous') {
                            badgeDonor.textContent = 'Autologous (Self)';
                        } else {
                            badgeDonor.textContent = `${donorVal} (${hlaVal})`;
                        }
                    }

                    // 2. Gather All Schedule Items
                    const items = [];

                    // A. Conditioning Agents
                    document.querySelectorAll('.regimen-agent-row').forEach(row => {
                        const agentSel = row.querySelector('.regimen-agent-select');
                        const agentOthers = row.querySelector('.regimen-agent-others');
                        let agent = agentSel ? agentSel.value : 'Melphalan';
                        if (agent === 'Others' && agentOthers && agentOthers.value.trim()) {
                            agent = agentOthers.value.trim();
                        }

                        const doseSel = row.querySelector('.regimen-dose-select');
                        const doseOthers = row.querySelector('.regimen-dose-others');
                        let dose = '';
                        if (agentSel && agentSel.value === 'Others') {
                            dose = (doseOthers && doseOthers.value.trim()) ? doseOthers.value.trim() : '';
                        } else if (doseSel) {
                            dose = doseSel.value;
                            if (dose === 'Others' && doseOthers && doseOthers.value.trim()) {
                                dose = doseOthers.value.trim();
                            }
                        }

                        const adminDay = row.querySelector('.regimen-admin-day')?.value || 'D-4, -3';
                        const parsed = parseDayString(adminDay, -4);
                        parsed.forEach(p => {
                            items.push({
                                dayNum: p.dayNum,
                                dayText: p.dayText,
                                category: 'Conditioning',
                                categoryOrder: 1,
                                agent: agent,
                                dose: dose || '-'
                            });
                        });
                    });

                    // B. Infused Stem Cell (Infusion Day(s))
                    const cellRows = document.querySelectorAll('.infused-cell-row');
                    cellRows.forEach((row, idx) => {
                        const dateVal = row.querySelector('.infused-cell-date')?.value || '';
                        const cd34 = row.querySelector('.infused-cd34-input')?.value || '';
                        const tnc = row.querySelector('.infused-tnc-input')?.value || '';
                        const mnc = row.querySelector('.infused-mnc-input')?.value || '';
                        const viability = row.querySelector('.infused-viability-input')?.value || '';
                        
                        let details = `Infusion of ${cellVal}`;
                        const metrics = [];
                        if (cd34) metrics.push(`CD34+: ${cd34} ×10??kg`);
                        if (viability) metrics.push(`Viability: ${viability}%`);
                        if (tnc) metrics.push(`TNC: ${tnc} ×10??kg`);
                        if (mnc) metrics.push(`MNC: ${mnc} ×10??kg`);
                        if (metrics.length > 0) details += ` (${metrics.join(', ')})`;

                        const dayNum = idx; // 0 for Day 0, 1 for Day 1...
                        items.push({
                            dayNum: dayNum,
                            dayText: dayNum === 0 ? 'D0' : `D+${dayNum}`,
                            category: 'Stem Cell Infusion',
                            categoryOrder: 2,
                            agent: `Stem Cell Infusion (${cellVal})`,
                            dose: details,
                            overrideDate: dateVal
                        });
                    });

            // C. GVHD Prophylaxis Agents (if not None)
            document.querySelectorAll('.gvhd-prophylaxis-row').forEach(row => {
                const agentSel = row.querySelector('.gvhd-prophylaxis-regimen');
                const agentOthers = row.querySelector('.gvhd-prophylaxis-others');
                let agent = agentSel ? agentSel.value : 'None';
                if (agent === 'Others' && agentOthers && agentOthers.value.trim()) {
                    agent = agentOthers.value.trim();
                }
                if (agent === 'None') return;

                const doseSel = row.querySelector('.gvhd-prophylaxis-dose');
                const doseOthers = row.querySelector('.gvhd-prophylaxis-dose-others');
                let dose = doseSel ? doseSel.value : '';
                if (dose === 'Others' && doseOthers && doseOthers.value.trim()) {
                    dose = doseOthers.value.trim();
                }

                const adminDay = row.querySelector('.gvhd-prophylaxis-admin-day')?.value || 'D1, 3, 6, 11';
                const parsed = parseDayString(adminDay, 1);
                parsed.forEach(p => {
                    items.push({
                        dayNum: p.dayNum,
                        dayText: p.dayText,
                        category: 'GVHD Prophylaxis',
                        categoryOrder: 3,
                        agent: agent,
                        dose: dose || '-'
                    });
                });
            });

            // 3. Sort items by dayNum ascending, then categoryOrder
            items.sort((a, b) => {
                if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
                return a.categoryOrder - b.categoryOrder;
            });

            // 4. Render Table Rows
            const tbody = document.getElementById('summary-schedule-tbody');
            if (!tbody) return;

            if (items.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                            No conditioning regimen or medication schedule entered.
                        </td>
                    </tr>
                `;
                return;
            }

            let html = '';
            items.forEach(item => {
                const isInfusion = item.category === 'Stem Cell Infusion';
                const rowBg = isInfusion ? 'background: rgba(139, 92, 246, 0.12);' : '';
                const borderStyle = isInfusion ? 'border-bottom: 1px solid rgba(139, 92, 246, 0.3);' : 'border-bottom: 1px solid rgba(255, 255, 255, 0.05);';

                let catBadge = '';
                if (item.category === 'Conditioning') {
                    catBadge = `<span style="display: inline-block; padding: 0.2rem 0.55rem; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Conditioning</span>`;
                } else if (isInfusion) {
                    catBadge = `<span style="display: inline-block; padding: 0.2rem 0.55rem; background: rgba(139, 92, 246, 0.25); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.45); border-radius: 4px; font-size: 0.75rem; font-weight: 600; box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);">Infusion (D0)</span>`;
                } else {
                    catBadge = `<span style="display: inline-block; padding: 0.2rem 0.55rem; background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 4px; font-size: 0.75rem; font-weight: 600;">GVHD Prophylaxis</span>`;
                }

                // Date Display
                let dateDisplay = '';
                if (item.overrideDate) {
                    const parts = item.overrideDate.split('-');
                    if (parts.length === 3) {
                        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        dateDisplay = `<span style="font-family: monospace; font-size: 0.9rem; font-weight: 600; color: #c4b5fd;">${item.overrideDate}</span> <span style="font-size: 0.78rem; color: var(--text-muted);">(${dayNames[d.getDay()]})</span>`;
                    } else {
                        dateDisplay = item.overrideDate;
                    }
                } else {
                    dateDisplay = getCalendarDateDisplay(baseD0Date, item.dayNum);
                }

                html += `
                    <tr style="${rowBg} ${borderStyle} transition: background 0.15s ease;">
                        <td style="padding: 0.85rem 1.25rem; font-weight: 700; font-family: monospace; font-size: 0.95rem; color: ${isInfusion ? '#c4b5fd' : '#e2e8f0'};">
                            ${item.dayText}
                        </td>
                        <td style="padding: 0.85rem 1.25rem;">
                            ${dateDisplay}
                        </td>
                        <td style="padding: 0.85rem 1.25rem;">
                            ${catBadge}
                        </td>
                        <td style="padding: 0.85rem 1.25rem; font-weight: 600; color: var(--text-primary);">
                            ${item.agent}
                        </td>
                        <td style="padding: 0.85rem 1.25rem; color: var(--text-secondary);">
                            ${item.dose}
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;
        }

        // Initialize on DOM Ready
        document.addEventListener('DOMContentLoaded', () => {
            initDateInputs();
            updateRemoveButtons();
            updateGvhdRemoveButtons();
            updateCellRemoveButtons();
            handleTransplantTypeChange(document.getElementById('transplant-type'), false);
            document.querySelectorAll('.gvhd-prophylaxis-regimen').forEach(sel => handleGvhdProphylaxisChange(sel));

            // Set placeholder color behavior for selects
            document.querySelectorAll('select.custom-text-input').forEach(sel => {
                if (sel.value === '' || sel.options[sel.selectedIndex]?.disabled) {
                    sel.style.color = '#aaaaaa';
                }
                sel.addEventListener('change', function () {
                    this.style.color = 'var(--text-primary)';
                });
            });

            // Live event listeners to update Summary in real time
            const planner = document.querySelector('.planner-sections');
            if (planner) {
                planner.addEventListener('input', () => updateTransplantSummary());
                planner.addEventListener('change', () => updateTransplantSummary());
            }

            // Initial summary render
            updateTransplantSummary();
        });
    

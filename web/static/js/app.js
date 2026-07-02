﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿/**
 * XplorePrint - Main Application JavaScript
 * FRC Team 11019 Xplore
 * 3D Printer Management Software
 */

const socket = io();

class PrinterApp {
    constructor() {
        this.printers = [];
        this.queue = [];
        this.filaments = [];
        this.currentView = 'dashboard';
        this._loadingHidden = false;
        this.init();
    }

    init() {
        this._inspectHistory = [];
        this._inspectTab = 'snapshot';
        this.loadTheme();
        this.loadSettings();
        this.bindNavigation();
        this.bindSocket();
        this.loadPrinters();
        this._bindInspectUpload();
        setInterval(() => this.loadStats(), 5000);
        setInterval(() => this.refreshAMSData(), 10000);
        setTimeout(() => this.hideLoadingScreen(), 8000);
    }

    hideLoadingScreen() {
        if (this._loadingHidden) return;
        this._loadingHidden = true;
        const el = document.getElementById('loadingScreen');
        if (el) {
            el.classList.add('hidden');
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
        }
    }

    bindNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(view + 'View');
        if (targetView) {
            targetView.classList.add('active');
        }
        if (view === 'printers') {
            this.renderPrinterList();
        } else if (view === 'queue') {
            this.loadWeightsToUI();
            this.loadQueue();
        } else if (view === 'filaments') {
            this.loadFilaments();
        } else if (view === 'history') {
            this.loadHistory();
        } else if (view === 'partsLibrary') {
            this.loadPartsLibrary();
        } else if (view === 'partsBoard') {
            this.loadPartsBoard();
        } else if (view === 'competitions') {
            this.loadCompetitions();
        } else if (view === 'operations') {
            this.renderOperations();
        } else if (view === 'fileManager') {
            this.renderFileManager();
        } else if (view === 'competition') {
            this.refreshDrives();
            this.loadCompFiles();
            this.loadChecklist();
        } else if (view === 'settings') {
            this.loadExportPathSetting();
            this.loadTeamInfo();
        } else if (view === 'toolbox') {
            this.renderToolbox();
        } else if (view === 'g3d') {
            this.loadG3DProjects();
        }
    }

    bindSocket() {
        socket.on('connect', () => {
            this.updateServerStatus(true);
        });

        socket.on('disconnect', () => {
            this.updateServerStatus(false);
        });

        socket.on('printer_update', (data) => {
            this.printers = data;
            this.renderDashboard();
            if (this.currentView === 'printers') {
                this.renderPrinterList();
            }
            this.loadStats();
        });
    }

    updateServerStatus(connected) {
        const dot = document.getElementById('serverStatus');
        const text = document.getElementById('serverStatusText');
        if (connected) {
            dot.style.background = 'var(--green)';
            dot.style.boxShadow = '0 0 6px var(--green)';
            text.textContent = '服务器运行中';
        } else {
            dot.style.background = 'var(--red)';
            dot.style.boxShadow = '0 0 6px var(--red)';
            text.textContent = '服务器断开';
        }
    }

    async loadPrinters() {
        try {
            const res = await fetch('/api/printers');
            this.printers = await res.json();
            this.renderDashboard();
            this.updateDiagPrinterList();
            this.loadStats();
            this.hideLoadingScreen();
        } catch (e) {
            console.error('Failed to load printers:', e);
            this.hideLoadingScreen();
        }
    }

    async loadStats() {
        try {
            const res = await fetch('/api/stats');
            const stats = await res.json();
            document.getElementById('statTotal').textContent = stats.total;
            document.getElementById('statOnline').textContent = stats.online;
            document.getElementById('statPrinting').textContent = stats.printing;
            document.getElementById('statError').textContent = stats.error;
        } catch (e) {
            console.error('Failed to load stats:', e);
        }
    }

    renderDashboard() {
        const grid = document.getElementById('printerGrid');
        const emptyState = document.getElementById('emptyState');

        if (this.printers.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            const existingCards = grid.querySelectorAll('.printer-card');
            existingCards.forEach(c => c.remove());
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const existingCards = {};
        grid.querySelectorAll('.printer-card').forEach(c => {
            existingCards[c.dataset.printerId] = c;
        });

        this.printers.forEach(printer => {
            if (existingCards[printer.id]) {
                this.updatePrinterCard(existingCards[printer.id], printer);
                delete existingCards[printer.id];
            } else {
                const card = this.createPrinterCard(printer);
                grid.appendChild(card);
            }
        });

        Object.values(existingCards).forEach(c => c.remove());

        this.checkCVHealth();
        this._updateInspectPrinterSelect();
    }

    _updateInspectPrinterSelect() {
        const sel = document.getElementById('inspectPrinterSelect');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">-- 选择打印机 --</option>';
        this.printers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name} (${p.status || 'offline'})</option>`;
        });
        if (current) sel.value = current;
        this.onInspectPrinterChange();
    }

    _bindInspectUpload() {
        const zone = document.getElementById('inspectUploadZone');
        const input = document.getElementById('inspectFileInput');
        if (!zone || !input) return;
        input.addEventListener('change', () => this.inspectPageUpload());
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-blue)'; });
        zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = '';
            if (e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
            }
        });
    }

    createPrinterCard(printer) {
        const card = document.createElement('div');
        card.className = 'printer-card';
        card.dataset.printerId = printer.id;
        card.innerHTML = this.getPrinterCardHTML(printer);
        this.bindCardActions(card, printer);
        return card;
    }

    updatePrinterCard(card, printer) {
        const videoPanel = card.querySelector('.video-panel');
        const videoVisible = videoPanel && videoPanel.style.display !== 'none';
        const temp = card.querySelector('.printer-card-content');
        if (temp) {
            temp.innerHTML = this.getPrinterCardInnerHTML(printer);
        }
        if (videoVisible) {
            const newPanel = card.querySelector('.video-panel');
            if (newPanel) newPanel.style.display = 'block';
        }
        this.bindCardActions(card, printer);
    }

    getPrinterCardHTML(printer) {
        return `<div class="printer-card-content">${this.getPrinterCardInnerHTML(printer)}</div>`;
    }

    getPrinterCardInnerHTML(printer) {
        const statusClass = printer.status;
        const statusText = this.getStatusText(printer.status);
        const progress = printer.print_progress || 0;
        const isError = printer.status === 'error';

        let amsHTML = '';
        if (printer.ams_units && printer.ams_units.length > 0) {
            const humidity = printer.ams_units[0].humidity || 0;
            const humidityColor = humidity >= 5 ? 'var(--danger)' : humidity >= 4 ? 'var(--warning)' : 'var(--accent-green)';
            const humidityLabel = humidity >= 5 ? '潮湿' : humidity >= 4 ? '偏湿' : '干燥';
            const temp = printer.ams_units[0].temperature || 0;
            amsHTML = `
                <div class="ams-section">
                    <div class="ams-title">
                        AMS 耗材 (${printer.ams_units.length} 槽)
                        <span class="ams-humidity" style="color:${humidityColor};" title="AMS 湿度指数 (1-5)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>
                            Lv.${humidity.toFixed(0)} ${humidityLabel}
                        </span>
                        <span class="ams-temp" title="AMS 温度">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>
                            ${manager._formatTemp(temp)}
                        </span>
                    </div>
                    <div class="ams-trays">
                        ${printer.ams_units.map(tray => {
                            const color = tray.color || '#CCCCCC';
                            const materialShort = (tray.material || 'Unknown').substring(0, 6);
                            return `
                                <div class="ams-tray" style="background-color:${color};" title="${tray.material}">
                                    <span class="ams-tray-id">${tray.tray_id}</span>
                                    <div class="ams-tray-tooltip">
                                        <div class="material">${tray.material}</div>
                                        <div class="temp-range">余量: ${tray.remaining}%</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        let progressHTML = '';
        if (printer.status === 'printing' || printer.status === 'paused' || printer.status === 'finishing') {
            const remaining = this.formatTime(printer.print_time_remaining);
            progressHTML = `
                <div class="progress-section">
                    <div class="progress-header">
                        <span>${this.escapeHtml(printer.current_file || '打印中...')}</span>
                        <span>${progress}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-bar-fill${isError ? ' error' : ''}" style="width:${progress}%;"></div>
                    </div>
                    ${remaining ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">剩余时间: ${remaining}</div>` : ''}
                </div>
            `;
        }

        let errorHTML = '';
        if (printer.status === 'error' && printer.error_message) {
            const hmsCode = printer.hms_code || 0;
            const wikiUrl = hmsCode ? `https://wiki.bambulab.com/zh/hms/${hmsCode}` : '';
            const wikiHome = 'https://wiki.bambulab.com/zh/hms/home';
            errorHTML = `
                <div class="hms-error-box">
                    <div class="hms-error-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span>HMS 错误</span>
                    </div>
                    <div class="hms-error-code">
                        <span class="hms-code-label">错误码</span>
                        <span class="hms-code-value">${hmsCode || 'N/A'}</span>
                    </div>
                    ${wikiUrl ? `<a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="hms-lookup-link">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        查看此错误码
                    </a>` : ''}
                    <a href="${wikiHome}" target="_blank" rel="noopener noreferrer" class="hms-lookup-link hms-home-link">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        搜索 HMS 数据库
                    </a>
                </div>
            `;
        }

        let actionsHTML = '';
        if (printer.status === 'offline') {
            actionsHTML = `<button class="btn btn-sm btn-primary" onclick="manager.connectPrinter('${printer.id}')">连接</button>`;
        } else if (printer.status === 'printing') {
            actionsHTML = `
                <button class="btn btn-sm btn-outline" onclick="manager.sendCommand('${printer.id}','pause')">暂停</button>
                <button class="btn btn-sm btn-danger" onclick="manager.sendCommand('${printer.id}','stop')">停止</button>
            `;
        } else if (printer.status === 'paused') {
            actionsHTML = `
                <button class="btn btn-sm btn-success" onclick="manager.sendCommand('${printer.id}','resume')">继续</button>
                <button class="btn btn-sm btn-danger" onclick="manager.sendCommand('${printer.id}','stop')">停止</button>
            `;
        } else if (printer.status === 'online' || printer.status === 'idle') {
            actionsHTML = `
                <button class="btn btn-sm btn-outline" onclick="manager.disconnectPrinter('${printer.id}')">断开</button>
            `;
        } else if (printer.status === 'error') {
            actionsHTML = `
                <button class="btn btn-sm btn-outline" onclick="manager.disconnectPrinter('${printer.id}')">断开</button>
                <button class="btn btn-sm btn-primary" onclick="manager.connectPrinter('${printer.id}')">重连</button>
            `;
        }

        return `
            <div class="printer-card-header">
                <div>
                    <div class="printer-name">${this.escapeHtml(printer.name)}</div>
                    <div class="printer-model">${printer.model} · ${printer.ip_address || '未配置IP'}</div>
                </div>
                <div class="header-actions">
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();manager.toggleVideo('${printer.id}')" title="实况视频">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    </button>
                    <span class="status-badge ${statusClass}">
                        <span class="status-dot"></span>${statusText}
                    </span>
                </div>
            </div>
            ${errorHTML}
            ${progressHTML}
            <div class="video-panel" id="video-${printer.id}" style="display:none;">
                <div class="video-wrapper">
                    <img src="" alt="实况视频" class="video-stream" id="video-img-${printer.id}"
                         style="opacity:0;">
                    <div class="video-placeholder" id="video-placeholder-${printer.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        <span>等待视频流...</span>
                    </div>
                </div>
                <div class="video-inspect-area">
                    <button class="btn btn-sm btn-outline btn-inspect" onclick="manager.inspectPrint('${printer.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        打印质检
                    </button>
                    <span class="cv-health-dot" id="cv-health-${printer.id}" title="CV 模型状态">●</span>
                    <span class="inspect-status" id="inspect-status-${printer.id}"></span>
                </div>
                <div class="inspect-result" id="inspect-result-${printer.id}" style="display:none;"></div>
            </div>
            <div class="temp-grid">
                <div class="temp-item">
                    <span class="temp-label">喷头</span>
                    <span class="temp-value">${this._formatTempInt(printer.nozzle_temp)} <span class="temp-target">/ ${this._formatTempInt(printer.target_nozzle_temp)}</span></span>
                </div>
                <div class="temp-item">
                    <span class="temp-label">热床</span>
                    <span class="temp-value">${this._formatTempInt(printer.bed_temp)} <span class="temp-target">/ ${this._formatTempInt(printer.target_bed_temp)}</span></span>
                </div>
                <div class="temp-item">
                    <span class="temp-label">腔体</span>
                    <span class="temp-value">${this._formatTempInt(printer.chamber_temp)}</span>
                </div>
                <div class="temp-item">
                    <span class="temp-label">层数</span>
                    <span class="temp-value">${printer.layer_num}/${printer.total_layers}</span>
                </div>
            </div>
            ${amsHTML}
            <div class="card-actions">
                ${actionsHTML}
            </div>
        `;
    }

    bindCardActions(card, printer) {
        card.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });
    }

    renderPrinterList() {
        const list = document.getElementById('printerListDetail');
        if (this.printers.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
                    <p>暂无打印机</p>
                    <span>点击"添加打印机"开始管理</span>
                </div>
            `;
            return;
        }

        list.innerHTML = this.printers.map(printer => {
            const statusClass = printer.status;
            const statusText = this.getStatusText(printer.status);
            const statusColor = this.getStatusColor(printer.status);

            return `
                <div class="printer-list-item">
                    <div class="printer-list-info">
                        <div class="status-dot" style="background:${statusColor};box-shadow:0 0 6px ${statusColor};"></div>
                        <div>
                            <div style="font-weight:600;">${this.escapeHtml(printer.name)}</div>
                            <div style="font-size:12px;color:var(--text-muted);">${printer.model} · ${printer.ip_address}</div>
                        </div>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="printer-list-actions">
                        ${printer.status === 'offline'
                            ? `<button class="btn btn-sm btn-primary" onclick="manager.connectPrinter('${printer.id}')">连接</button>`
                            : `<button class="btn btn-sm btn-outline" onclick="manager.disconnectPrinter('${printer.id}')">断开</button>`
                        }
                        <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removePrinter('${printer.id}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==================== 打印队列 ====================

    async loadQueue() {
        try {
            const res = await fetch('/api/queue');
            this.queue = await res.json();
            this.renderQueue();
        } catch (e) {
            console.error('Failed to load queue:', e);
        }
    }

    renderQueue() {
        const container = document.getElementById('queueContainer');
        if (this.queue.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    <p>打印队列为空</p>
                    <span>添加打印任务以管理排队</span>
                </div>
            `;
            return;
        }

        const statusMap = { waiting: '等待中', printing: '打印中', completed: '已完成', cancelled: '已取消' };
        const priorityLabels = { 0: '', 1: '<span class="priority-badge high">高</span>', 2: '<span class="priority-badge urgent">紧急</span>' };

        container.innerHTML = this.queue.map((item, index) => `
            <div class="queue-item" draggable="true" data-queue-id="${item.id}" data-index="${index}">
                <div class="queue-drag-handle" title="拖拽排序">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
                </div>
                <div class="queue-info">
                    <div class="queue-rank">#${index + 1}</div>
                    <div class="queue-detail">
                        <div class="queue-file">${this.escapeHtml(item.file_name)} ${priorityLabels[item.priority] || ''}</div>
                        <div class="queue-meta">
                            ${this.escapeHtml(item.printer_name)} · ${this.escapeHtml(item.material)} · ${item.estimated_time ? item.estimated_time + '分钟' : '未知时间'}
                            ${item.notes ? ' · ' + this.escapeHtml(item.notes) : ''}
                            ${item.subsystem ? ' · <span class="subsystem-tag">' + this.escapeHtml(item.subsystem) + '</span>' : ''}
                        </div>
                    </div>
                </div>
                <span class="queue-status ${item.status}">${statusMap[item.status] || item.status}</span>
                <div class="queue-actions">
                    ${item.status === 'waiting' ? `
                        <button class="btn btn-sm btn-primary" onclick="manager.startPrint('${this.escapeJs(item.printer_id)}', '${this.escapeJs(item.file_name)}')">开始打印</button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removeQueueItem('${item.id}')">删除</button>
                </div>
            </div>
        `).join('');

        this.bindQueueDragDrop();
    }

    bindQueueDragDrop() {
        const items = document.querySelectorAll('.queue-item[draggable]');
        let draggedItem = null;

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.queueId);
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
                draggedItem = null;
                document.querySelectorAll('.queue-item').forEach(i => i.classList.remove('drag-over'));
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (item !== draggedItem) {
                    item.classList.add('drag-over');
                }
            });

            item.addEventListener('dragleave', (e) => {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-over');
                if (draggedItem && draggedItem !== item) {
                    const container = document.getElementById('queueContainer');
                    const allItems = [...container.querySelectorAll('.queue-item[draggable]')];
                    const fromIndex = allItems.indexOf(draggedItem);
                    const toIndex = allItems.indexOf(item);
                    if (fromIndex !== -1 && toIndex !== -1) {
                        if (fromIndex < toIndex) {
                            container.insertBefore(draggedItem, item.nextSibling);
                        } else {
                            container.insertBefore(draggedItem, item);
                        }
                        const newOrder = [...container.querySelectorAll('.queue-item[draggable]')].map(el => el.dataset.queueId);
                        this.reorderQueue(newOrder);
                    }
                }
            });
        });
    }

    async addQueueItem(data) {
        if (this._queueFile) {
            if (this._queueAnalysis && this._queueAnalysis._uploadPath) {
                data.file_path = this._queueAnalysis._uploadPath;
            } else {
                const formData = new FormData();
                formData.append('file', this._queueFile);
                formData.append('printer_id', data.printer_id);
                formData.append('material', data.material || 'PLA');
                try {
                    const uploadRes = await fetch('/api/queue/upload', {
                        method: 'POST',
                        body: formData,
                    });
                    const uploadResult = await uploadRes.json();
                    if (uploadResult.success) {
                        data.file_path = uploadResult.path;
                        const analysis = uploadResult.analysis;
                        if (analysis) {
                            if (!data.estimated_time && analysis.estimated_time_minutes > 0) {
                                data.estimated_time = Math.round(analysis.estimated_time_minutes);
                            }
                            data._analysis = analysis;
                        }
                    }
                } catch (e) {
                    console.error('Queue file upload failed:', e);
                }
            }
        }
        try {
            const res = await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this._queueFile = null;
                this._queueAnalysis = null;
                this.showToast('已添加到打印队列', 'success');
                closeQueueModal();
                this.loadQueue();
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    onQueuePrinterChange() {
        const printerId = document.getElementById('queuePrinter').value;
        this._loadQueueFileDropdown(printerId);
    }

    async _loadQueueFileDropdown(printerId) {
        const select = document.getElementById('queueFileSelect');
        if (!printerId) {
            select.innerHTML = '<option value="">从打印机选择已有文件...</option>';
            return;
        }
        try {
            const res = await fetch(`/api/printers/${printerId}/files`);
            const data = await res.json();
            let html = '<option value="">从打印机选择已有文件...</option>';
            if (data.files && data.files.length > 0) {
                data.files.forEach(f => {
                    html += `<option value="${this.escapeJs(f)}">${this.escapeHtml(f)}</option>`;
                });
            } else {
                html += '<option value="" disabled>该打印机暂无文件</option>';
            }
            select.innerHTML = html;
        } catch (e) {
            select.innerHTML = '<option value="">加载失败</option>';
        }
    }

    onQueueFileSelected() {
        const input = document.getElementById('queueFileInput');
        const file = input.files[0];
        if (!file) return;

        const validExts = ['.gcode', '.3mf', '.gcode.3mf'];
        const name = file.name.toLowerCase();
        const isValid = validExts.some(ext => name.endsWith(ext));
        if (!isValid) {
            this.showToast('仅支持 .gcode / .3mf / .gcode.3mf 文件', 'error');
            input.value = '';
            return;
        }
        if (file.size > 200 * 1024 * 1024) {
            this.showToast('文件大小不能超过 200MB', 'error');
            input.value = '';
            return;
        }

        this._queueFile = file;
        document.getElementById('queueFileName').value = file.name;
        const info = document.getElementById('queueFileInfo');
        info.style.display = 'block';
        info.innerHTML = `<span style="color:var(--accent-green);">${this.escapeHtml(file.name)}</span> (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
        document.getElementById('queueUploadZone').style.borderColor = 'var(--accent-green)';

        const isGcode = file.name.toLowerCase().endsWith('.gcode') || file.name.toLowerCase().endsWith('.gcode.3mf');
        const btn = document.getElementById('gcodeAnalyzeBtn');
        const panel = document.getElementById('gcodeAnalysis');
        if (isGcode) {
            if (btn) btn.style.display = 'inline-flex';
            if (panel) panel.style.display = 'none';
            this._queueAnalysis = null;
        } else {
            if (btn) btn.style.display = 'none';
            if (panel) panel.style.display = 'none';
            this._queueAnalysis = null;
        }
    }

    analyzeGcodeNow() {
        const file = this._queueFile;
        if (!file) return;
        this._analyzeSelectedFile(file);
    }

    async _analyzeSelectedFile(file) {
        const panel = document.getElementById('gcodeAnalysis');
        panel.style.display = 'block';
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setVal('gaSlicerTime', '解析中...');
        setVal('gaMaterial', '--');
        setVal('gaLength', '--');
        setVal('gaLayers', '--');
        setVal('gaBbox', '--');
        setVal('gaLines', '--');
        setVal('gaTotalLines', '--');

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('material', document.getElementById('queueMaterial')?.value || 'PLA');
            const res = await fetch('/api/queue/upload', { method: 'POST', body: formData });
            const result = await res.json();
            const analysis = result.analysis;
            if (analysis) {
                if (analysis.error) {
                    setVal('gaSlicerTime', '解析错误');
                    console.error('G-code parse error:', analysis.error);
                    panel.classList.remove('gcode-analysis-loaded');
                    return;
                }
                this._queueAnalysis = analysis;
                this._queueAnalysis._uploadPath = result.path;
                const mins = Math.round(analysis.estimated_time_minutes);
                if (mins > 0) {
                    document.getElementById('queueTime').value = mins;
                }
                setVal('gaSlicerTime', mins > 0 ? `${mins} 分钟` : 'N/A');
                setVal('gaMaterial', `${analysis.material_grams.toFixed(1)} g`);
                setVal('gaLength', `${analysis.filament_length_mm.toFixed(0)} mm`);
                setVal('gaLayers', analysis.layer_count > 0 ? `${analysis.layer_count} 层` : 'N/A');
                const bb = analysis.bounding_box;
                if (bb && bb.x_max > bb.x_min) {
                    setVal('gaBbox', `${(bb.x_max - bb.x_min).toFixed(0)}×${(bb.y_max - bb.y_min).toFixed(0)}×${(bb.z_max - bb.z_min).toFixed(0)} mm`);
                } else {
                    setVal('gaBbox', 'N/A');
                }
                setVal('gaLines', `${analysis.print_lines.toLocaleString()} 行`);
                setVal('gaTotalLines', `${analysis.total_lines.toLocaleString()} 行`);
                panel.classList.add('gcode-analysis-loaded');
            } else {
                setVal('gaSlicerTime', '解析失败');
                panel.classList.remove('gcode-analysis-loaded');
            }
        } catch (e) {
            setVal('gaSlicerTime', '解析失败');
            panel.classList.remove('gcode-analysis-loaded');
        }
    }

    onQueueFileSelectChange() {
        const filename = document.getElementById('queueFileSelect').value;
        if (filename) {
            document.getElementById('queueFileName').value = filename;
            this._queueFile = null;
            document.getElementById('queueFileInfo').style.display = 'none';
            document.getElementById('queueUploadZone').style.borderColor = '';
            document.getElementById('queueFileInput').value = '';
        }
    }

    async removeQueueItem(id) {
        try {
            await fetch(`/api/queue/${id}`, { method: 'DELETE' });
            this.showToast('已从队列移除', 'info');
            this.loadQueue();
        } catch (e) {
            this.showToast('移除失败', 'error');
        }
    }

    async clearQueue() {
        if (!confirm('确定要清空所有打印队列吗?')) return;
        try {
            await fetch('/api/queue/clear', { method: 'POST' });
            this.showToast('队列已清空', 'info');
            this.loadQueue();
        } catch (e) {
            this.showToast('清空失败', 'error');
        }
    }

    async sortQueue(mode) {
        try {
            const res = await fetch('/api/queue/sort', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.queue = result.queue;
                this.renderQueue();
                const modeNames = { default: '默认排序', smart: '智能排序' };
                this.showToast(`队列已按${modeNames[mode] || mode}重新排列`, 'info');
            }
        } catch (e) {
            this.showToast('排序失败', 'error');
        }
    }

    async reorderQueue(orderedIds) {
        try {
            const res = await fetch('/api/queue/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordered_ids: orderedIds }),
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.queue = result.queue;
                this.renderQueue();
            }
        } catch (e) {
            this.showToast('拖拽排序失败', 'error');
        }
    }

    // ==================== 智能调度 ====================

    async previewSchedule() {
        const btn = document.getElementById('btnPreviewSchedule');
        const badge = document.getElementById('scheduleBadge');
        const body = document.getElementById('schedulePanelBody');
        btn.disabled = true;
        btn.textContent = '计算中...';
        try {
            const weights = this._getScheduleWeights();
            const params = new URLSearchParams();
            Object.entries(weights).forEach(([k, v]) => {
                if (v > 0) params.set(k, v);
            });
            const url = '/api/schedule/preview' + (params.toString() ? '?' + params.toString() : '');
            const res = await fetch(url);
            const data = await res.json();
            this._scheduleData = data;
            badge.textContent = `${data.total_jobs} 个任务`;
            badge.className = 'badge badge-success';

            let html = '';
            if (data.plan && data.plan.length > 0) {
                html += '<div class="schedule-plan">';
                data.plan.forEach((printerPlan, idx) => {
                    const statusClass = printerPlan.printer_status === 'idle' ? 'idle' :
                        printerPlan.printer_status === 'printing' ? 'printing' : 'other';
                    html += `
                        <div class="schedule-printer-group">
                            <div class="schedule-printer-header">
                                <span class="printer-dot ${statusClass}"></span>
                                <strong>${printerPlan.printer_name}</strong>
                                <span class="schedule-printer-status">${this.statusLabel(printerPlan.printer_status)}</span>
                            </div>
                            <div class="schedule-items">
                    `;
                    printerPlan.items.forEach((item, i) => {
                        const timeStr = this.formatTime(item.estimated_time * 60);
                        const scoreColor = item.score_total >= 70 ? 'var(--green)' :
                            item.score_total >= 40 ? 'var(--yellow)' : 'var(--red)';
                        const scoreLabels = data.dimensions || [];
                        html += `
                            <div class="schedule-item ${i === 0 ? 'schedule-item-next' : ''}">
                                <div class="schedule-item-rank">${i + 1}</div>
                                <div class="schedule-item-info">
                                    <div class="schedule-item-name" title="${item.file_name}">${item.file_name}</div>
                                    <div class="schedule-item-meta">
                                        ${item.subsystem ? `<span class="tag tag-subsystem">${item.subsystem}</span>` : ''}
                                        <span>⏱ ${timeStr}</span>
                                        <span>⭐ ${item.priority}</span>
                                        <span>🧵 ${item.material}</span>
                                    </div>
                                </div>
                                <div class="schedule-item-score" style="color:${scoreColor}">
                                    <div class="score-value">${item.score_total}</div>
                                    <div class="score-label">排分</div>
                                </div>
                                <div class="schedule-item-breakdown">
                                    <span title="优先级">P:${item.score_priority}</span>
                                    <span title="时长">T:${item.score_time}</span>
                                    <span title="打印机">M:${item.score_printer}</span>
                                    <span title="子系统">S:${item.score_subsystem}</span>
                                    ${item.score_robot != null ? `<span title="机器人">R:${item.score_robot}</span>` : ''}
                                    ${item.score_assigned != null ? `<span title="队员">A:${item.score_assigned}</span>` : ''}
                                </div>
                            </div>
                        `;
                    });
                    html += `</div></div>`;
                });
                html += '</div>';

                const dimLabels = data.dimensions
                    ? data.dimensions.map(d => `${d.label}×${d.weight}%`).join(' + ')
                    : 'P×40% + T×25% + M×20% + S×15%';
                html += `
                    <div class="schedule-legend">
                        <span>排分 = ${dimLabels}</span>
                        <span>P=优先级 T=时长 M=打印机状态 S=子系统连续 R=机器人 A=队员</span>
                    </div>
                `;
            } else {
                html = '<p class="schedule-hint">暂无待打印任务。</p>';
            }
            body.innerHTML = html;
            this.showToast(`排分计算完成，共 ${data.total_jobs} 个任务`, 'success');
        } catch (e) {
            body.innerHTML = '<p class="schedule-hint" style="color:var(--red);">计算失败，请重试。</p>';
            this.showToast('排分计算失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>计算排分`;
    }

    async applySchedule() {
        const btn = document.getElementById('btnApplySchedule');
        btn.disabled = true;
        btn.textContent = '应用中...';
        try {
            const weights = this._getScheduleWeights();
            const res = await fetch('/api/schedule/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weights }),
            });
            const data = await res.json();
            if (data.status === 'ok') {
                this.queue = data.queue;
                this.renderQueue();
                this.showToast('智能调度已应用，队列已重新排序', 'success');
            }
        } catch (e) {
            this.showToast('应用调度失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>应用排序`;
    }

    // ==================== 智能调度权重配置 ====================

    _getDefaultWeights() {
        return {
            priority: 40,
            time: 25,
            printer: 20,
            subsystem: 15,
            robot: 0,
            assigned: 0,
        };
    }

    _getScheduleWeights() {
        try {
            const saved = localStorage.getItem('xploreprint_schedule_weights');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) { /* ignore */ }
        return this._getDefaultWeights();
    }

    loadWeightsToUI() {
        this._restoreWeightsCollapse();
        const weights = this._getScheduleWeights();
        document.getElementById('weightPriority').value = weights.priority || 0;
        document.getElementById('weightTime').value = weights.time || 0;
        document.getElementById('weightPrinter').value = weights.printer || 0;
        document.getElementById('weightSubsystem').value = weights.subsystem || 0;
        document.getElementById('weightRobot').value = weights.robot || 0;
        document.getElementById('weightAssigned').value = weights.assigned || 0;
        this.updateWeightLabels();
    }

    updateWeightLabels() {
        const get = (id) => parseInt(document.getElementById(id).value || 0);
        document.getElementById('weightPriorityValue').textContent = get('weightPriority') + '%';
        document.getElementById('weightTimeValue').textContent = get('weightTime') + '%';
        document.getElementById('weightPrinterValue').textContent = get('weightPrinter') + '%';
        document.getElementById('weightSubsystemValue').textContent = get('weightSubsystem') + '%';
        document.getElementById('weightRobotValue').textContent = get('weightRobot') + '%';
        document.getElementById('weightAssignedValue').textContent = get('weightAssigned') + '%';
        const total = get('weightPriority') + get('weightTime') + get('weightPrinter') + get('weightSubsystem') + get('weightRobot') + get('weightAssigned');
        document.getElementById('weightTotal').textContent = total;
    }

    resetWeights() {
        const def = this._getDefaultWeights();
        document.getElementById('weightPriority').value = def.priority;
        document.getElementById('weightTime').value = def.time;
        document.getElementById('weightPrinter').value = def.printer;
        document.getElementById('weightSubsystem').value = def.subsystem;
        document.getElementById('weightRobot').value = def.robot;
        document.getElementById('weightAssigned').value = def.assigned;
        this.updateWeightLabels();
        this.showToast('已重置为默认权重', 'info');
    }

    saveWeights() {
        const get = (id) => parseInt(document.getElementById(id).value || 0);
        const weights = {
            priority: get('weightPriority'),
            time: get('weightTime'),
            printer: get('weightPrinter'),
            subsystem: get('weightSubsystem'),
            robot: get('weightRobot'),
            assigned: get('weightAssigned'),
        };
        try {
            localStorage.setItem('xploreprint_schedule_weights', JSON.stringify(weights));
            this.showToast('权重配置已保存', 'success');
        } catch (e) {
            this.showToast('保存失败', 'error');
        }
    }

    toggleWeights() {
        const panel = document.getElementById('scheduleWeights');
        if (!panel) return;
        const collapsed = panel.classList.toggle('collapsed');
        try {
            localStorage.setItem('xploreprint_weights_collapsed', collapsed ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    _restoreWeightsCollapse() {
        try {
            const val = localStorage.getItem('xploreprint_weights_collapsed');
            const panel = document.getElementById('scheduleWeights');
            if (panel && val === '1') {
                panel.classList.add('collapsed');
            }
        } catch (e) { /* ignore */ }
    }

    async startScheduledJobs() {
        const btn = document.getElementById('btnStartSchedule');
        btn.disabled = true;
        btn.textContent = '启动中...';
        try {
            const res = await fetch('/api/schedule/start', { method: 'POST' });
            const data = await res.json();
            const started = data.started || [];
            const skipped = data.skipped || [];
            const errors = data.errors || [];

            if (started.length > 0) {
                const names = started.map(s => `${s.printer_name}: ${s.file}`).join(', ');
                this.showToast(`已启动: ${names}`, 'success');
            }
            if (skipped.length > 0) {
                const reasons = skipped.map(s => `${s.printer_name}: ${s.reason}`).join('; ');
                this.showToast(`跳过: ${reasons}`, 'info');
            }
            if (errors.length > 0) {
                errors.forEach(e => this.showToast(`错误: ${e.file} - ${e.reason}`, 'error'));
            }
            if (started.length === 0 && errors.length === 0) {
                this.showToast('没有可启动的任务', 'info');
            }
            this.loadPrinters();
        } catch (e) {
            this.showToast('启动失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>确认开打`;
    }

    statusLabel(status) {
        const map = {
            'idle': '空闲', 'online': '在线', 'printing': '打印中',
            'paused': '已暂停', 'error': '错误', 'finishing': '完成中',
            'offline': '离线',
        };
        return map[status] || status;
    }

    // ==================== 耗材库存 ====================

    async loadFilaments() {
        try {
            const res = await fetch('/api/filaments');
            this.filaments = await res.json();
            this.renderFilaments();
        } catch (e) {
            console.error('Failed to load filaments:', e);
        }
    }

    renderFilaments() {
        const grid = document.getElementById('filamentGrid');
        if (this.filaments.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                    <p>暂无耗材记录</p>
                    <span>添加耗材以跟踪库存和使用情况</span>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.filaments.map(f => {
            const usage = f.usage_percent || 0;
            let barClass = '';
            if (usage > 80) barClass = 'critical';
            else if (usage > 60) barClass = 'low';

            return `
                <div class="filament-card">
                    <div class="filament-header">
                        <div class="filament-swatch" style="background-color:${f.color};"></div>
                        <div>
                            <div class="filament-name">${f.material} ${f.color_name}</div>
                            <div class="filament-brand">${f.brand || '无品牌'}</div>
                        </div>
                    </div>
                    <div class="filament-usage">
                        <div class="filament-usage-header">
                            <span>已使用 ${usage}%</span>
                            <span>${f.remaining_weight.toFixed(0)}g / ${f.total_weight}g</span>
                        </div>
                        <div class="filament-usage-bar">
                            <div class="filament-usage-fill ${barClass}" style="width:${Math.min(usage, 100)}%;"></div>
                        </div>
                    </div>
                    <div class="filament-stats">
                        <div class="filament-stat">
                            <span class="label">剩余</span>
                            <span class="value">${f.remaining_weight.toFixed(0)}g</span>
                        </div>
                        <div class="filament-stat">
                            <span class="label">价格</span>
                            <span class="value">¥${f.price.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="filament-actions">
                        <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removeFilament('${f.id}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async addFilamentData(data) {
        try {
            const res = await fetch('/api/filaments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast('耗材添加成功', 'success');
                closeFilamentModal();
                this.loadFilaments();
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    async removeFilament(id) {
        if (!confirm('确定要删除此耗材记录吗?')) return;
        try {
            await fetch(`/api/filaments/${id}`, { method: 'DELETE' });
            this.showToast('耗材已删除', 'info');
            this.loadFilaments();
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    // ==================== 打印历史 ====================

    async loadHistory() {
        try {
            const [histRes, statsRes] = await Promise.all([
                fetch('/api/history?limit=50'),
                fetch('/api/history/stats')
            ]);
            const history = await histRes.json();
            const stats = await statsRes.json();
            this.renderHistoryStats(stats);
            this.renderHistoryTable(history);
        } catch (e) {
            console.error('Failed to load history:', e);
        }
    }

    renderHistoryStats(stats) {
        const container = document.getElementById('historyStats');
        container.innerHTML = `
            <div class="history-stat-card">
                <div class="label">总打印次数</div>
                <div class="value">${stats.total}</div>
            </div>
            <div class="history-stat-card">
                <div class="label">成功</div>
                <div class="value success">${stats.success}</div>
            </div>
            <div class="history-stat-card">
                <div class="label">失败</div>
                <div class="value failed">${stats.failed}</div>
            </div>
            <div class="history-stat-card">
                <div class="label">成功率</div>
                <div class="value">${stats.success_rate}%</div>
            </div>
        `;
    }

    renderHistoryTable(history) {
        const container = document.getElementById('historyTable');
        if (history.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:40px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p>暂无打印记录</p>
                    <span>打印完成后会自动记录历史</span>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>打印机</th>
                        <th>文件名</th>
                        <th>材料</th>
                        <th>开始时间</th>
                        <th>耗时</th>
                        <th>状态</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.map(h => `
                        <tr>
                            <td>${this.escapeHtml(h.printer_name)}</td>
                            <td>${this.escapeHtml(h.file_name)}</td>
                            <td>${h.material}</td>
                            <td>${this.formatDateTime(h.started_at)}</td>
                            <td>${this.formatDuration(h.duration)}</td>
                            <td><span class="history-badge ${h.success ? 'success' : 'fail'}">${h.success ? '成功' : '失败'}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    async exportHistory() {
        try {
            const res = await fetch('/api/history/export');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'xploreprint_history.csv';
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('历史记录已导出', 'success');
        } catch (e) {
            this.showToast('导出失败', 'error');
        }
    }

    async clearHistory() {
        if (!confirm('确定要清空所有打印历史记录吗?此操作不可撤销。')) return;
        try {
            await fetch('/api/history/clear', { method: 'POST' });
            this.showToast('历史记录已清空', 'info');
            this.loadHistory();
        } catch (e) {
            this.showToast('清空失败', 'error');
        }
    }

    // ==================== FRC 零件库 ====================

    async loadPartsLibrary() {
        try {
            const [partsRes, catsRes] = await Promise.all([
                fetch('/api/parts/library'),
                fetch('/api/parts/categories')
            ]);
            this.partsLibrary = await partsRes.json();
            const categories = await catsRes.json();
            this.renderPartsCategories(categories);
            this.renderPartsLibrary(this.partsLibrary);
        } catch (e) {
            console.error('Failed to load parts library:', e);
        }
    }

    renderPartsCategories(categories) {
        const select = document.getElementById('partsCategoryFilter');
        select.innerHTML = '<option value="">全部类别</option>' +
            categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    filterPartsLibrary() {
        const category = document.getElementById('partsCategoryFilter').value;
        const parts = category ? this.partsLibrary.filter(p => p.category === category) : this.partsLibrary;
        this.renderPartsLibrary(parts);
    }

    renderPartsLibrary(parts) {
        const grid = document.getElementById('partsGrid');
        if (parts.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                    <p>暂无零件模板</p>
                    <button class="btn btn-primary btn-sm" onclick="manager.showPartModal()">添加第一个零件</button>
                </div>
            `;
            return;
        }
        grid.innerHTML = parts.map(p => `
            <div class="part-card">
                <div class="part-card-header">
                    <div class="part-card-name" onclick="manager.quickAddPart('${p.id}')" style="cursor:pointer;">${this.escapeHtml(p.name)}</div>
                    <div class="part-card-actions">
                        <button class="btn-icon" onclick="event.stopPropagation();manager.editPart('${p.id}')" title="编辑">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-icon btn-icon-danger" onclick="event.stopPropagation();manager.deletePart('${p.id}')" title="删除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                    <span class="part-card-category">${p.category}</span>
                </div>
                <div class="part-card-desc">${this.escapeHtml(p.description)}</div>
                <div class="part-card-meta">
                    <span>🕐 ${p.estimated_time}分钟</span>
                    <span>🧵 ${p.filament_grams}g</span>
                    <span>📐 ${p.infill}</span>
                    <span>🔧 ${p.recommended_material}</span>
                </div>
                <div class="part-card-notes">💡 ${this.escapeHtml(p.notes)}</div>
                ${p.files && p.files.length > 0 ? `
                <div class="part-card-files">
                    <div class="part-card-files-title">📁 切片文件 (${p.files.length})</div>
                    ${p.files.map(f => `
                    <div class="part-file-tag" title="${this.escapeHtml(f.path)}" onclick="event.stopPropagation();manager.downloadPartFile('${p.id}', '${this._encodeFilePath(f.path)}')">
                        <span class="part-file-tag-name">${this.escapeHtml(f.filename)}</span>
                        ${f.printer_model ? `<span class="part-file-tag-model">${this.escapeHtml(f.printer_model)}</span>` : ''}
                        ${f.version ? `<span class="part-file-tag-ver">v${this.escapeHtml(f.version)}</span>` : ''}
                    </div>
                    `).join('')}
                </div>
                ` : ''}
                <button class="btn btn-sm btn-primary" style="width:100%;" onclick="manager.quickAddPart('${p.id}')">快速添加到队列</button>
            </div>
        `).join('');
        this._updatePartCategoryDatalist();
    }

    _updatePartCategoryDatalist() {
        const datalist = document.getElementById('partCategoryList');
        if (!datalist) return;
        const cats = new Set();
        this.partsLibrary.forEach(p => { if (p.category) cats.add(p.category); });
        datalist.innerHTML = [...cats].map(c => `<option value="${c}">`).join('');
    }

    showPartModal(partId = null) {
        document.getElementById('partModalTitle').textContent = partId ? '编辑零件' : '添加零件';
        document.getElementById('partSubmitBtn').textContent = partId ? '保存修改' : '添加零件';
        document.getElementById('partEditId').value = partId || '';
        document.getElementById('partName').value = '';
        document.getElementById('partCategory').value = '';
        document.getElementById('partMaterial').value = 'PETG';
        document.getElementById('partDesc').value = '';
        document.getElementById('partTime').value = '30';
        document.getElementById('partGrams').value = '20';
        document.getElementById('partInfill').value = '30%';
        document.getElementById('partWalls').value = '3';
        document.getElementById('partNotes').value = '';
        this._editPartId = partId;
        this._pendingFiles = [];
        this._updatePartCategoryDatalist();
        if (partId) {
            const part = this.partsLibrary.find(p => p.id === partId);
            if (part) {
                document.getElementById('partName').value = part.name;
                document.getElementById('partCategory').value = part.category;
                document.getElementById('partMaterial').value = part.recommended_material;
                document.getElementById('partDesc').value = part.description;
                document.getElementById('partTime').value = part.estimated_time;
                document.getElementById('partGrams').value = part.filament_grams;
                document.getElementById('partInfill').value = part.infill;
                document.getElementById('partWalls').value = part.wall_loops;
                document.getElementById('partNotes').value = part.notes;
                this._renderPartFileList(part.files || []);
            }
        } else {
            this._renderPartFileList([]);
        }
        document.getElementById('partModalOverlay').style.display = 'flex';
    }

    _renderPartFileList(files) {
        const container = document.getElementById('partFileList');
        if (!container) return;
        const allFiles = [...files, ...this._pendingFiles];
        if (allFiles.length === 0) {
            container.innerHTML = '<div class="part-file-empty">暂无切片文件</div>';
            return;
        }
        container.innerHTML = allFiles.map((f, i) => {
            const isPending = i >= files.length;
            const path = f.path || '';
            const basename = path.split(/[/\\]/).pop() || f.filename;
            return `
            <div class="part-file-item">
                <span class="part-file-item-name">${this.escapeHtml(f.filename)}</span>
                ${f.printer_model ? `<span class="part-file-tag-model">${this.escapeHtml(f.printer_model)}</span>` : ''}
                ${f.version ? `<span class="part-file-tag-ver">v${this.escapeHtml(f.version)}</span>` : ''}
                ${isPending ? '<span class="part-file-tag-pending">待上传</span>' : ''}
                <button class="btn-icon btn-icon-danger" onclick="manager._removePartFile(${i}, '${this._encodeFilePath(basename)}')" title="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            `;
        }).join('');
    }

    _encodeFilePath(path) {
        return btoa(unescape(encodeURIComponent(path)));
    }

    triggerPartFileUpload() {
        document.getElementById('partFileInput').click();
    }

    handlePartFileUpload(e) {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['gcode', '3mf'].includes(ext)) {
                this.showToast(`不支持的文件类型: ${file.name}`, 'error');
                continue;
            }
            this._pendingFiles.push({
                filename: file.name,
                path: '',
                printer_model: '',
                version: '',
                _file: file,
            });
        }
        this._renderPartFileList(this._getCurrentPartFiles());
        e.target.value = '';
    }

    _getCurrentPartFiles() {
        const partId = this._editPartId;
        if (partId) {
            const part = this.partsLibrary.find(p => p.id === partId);
            return part ? (part.files || []) : [];
        }
        return [];
    }

    _removePartFile(index, basename) {
        const existingFiles = this._getCurrentPartFiles();
        if (index < existingFiles.length) {
            const file = existingFiles[index];
            const path = file.path || file.filename;
            fetch(`/api/parts/library/${this._editPartId}/files/${encodeURIComponent(basename)}`, { method: 'DELETE' })
                .then(() => {
                    this.showToast('文件已删除', 'info');
                    this.loadPartsLibrary().then(() => {
                        const part = this.partsLibrary.find(p => p.id === this._editPartId);
                        this._renderPartFileList(part ? (part.files || []) : []);
                    });
                })
                .catch(() => this.showToast('删除失败', 'error'));
        } else {
            const pendingIdx = index - existingFiles.length;
            this._pendingFiles.splice(pendingIdx, 1);
            this._renderPartFileList(existingFiles);
        }
    }

    downloadPartFile(partId, encodedPath) {
        const filename = decodeURIComponent(escape(atob(encodedPath)));
        const basename = filename.split(/[/\\]/).pop();
        window.open(`/api/parts/files/${partId}/${encodeURIComponent(basename)}`, '_blank');
    }

    editPart(partId) {
        this.showPartModal(partId);
    }

    closePartModal() {
        document.getElementById('partModalOverlay').style.display = 'none';
    }

    async savePart(e) {
        e.preventDefault();
        const editId = document.getElementById('partEditId').value;
        const data = {
            name: document.getElementById('partName').value.trim(),
            category: document.getElementById('partCategory').value.trim(),
            recommended_material: document.getElementById('partMaterial').value,
            description: document.getElementById('partDesc').value.trim(),
            estimated_time: parseInt(document.getElementById('partTime').value) || 0,
            filament_grams: parseInt(document.getElementById('partGrams').value) || 0,
            infill: document.getElementById('partInfill').value,
            wall_loops: parseInt(document.getElementById('partWalls').value) || 3,
            notes: document.getElementById('partNotes').value.trim(),
        };
        if (!data.name) {
            this.showToast('零件名称不能为空', 'error');
            return;
        }
        try {
            const method = editId ? 'PUT' : 'POST';
            const url = editId ? `/api/parts/library/${editId}` : '/api/parts/library';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await res.json();
            if (result.status === 'ok') {
                const savedPartId = result.part ? result.part.id : editId;
                if (this._pendingFiles && this._pendingFiles.length > 0) {
                    for (const pf of this._pendingFiles) {
                        const formData = new FormData();
                        formData.append('file', pf._file);
                        formData.append('printer_model', pf.printer_model);
                        formData.append('version', pf.version);
                        await fetch(`/api/parts/library/${savedPartId}/files`, {
                            method: 'POST',
                            body: formData,
                        });
                    }
                }
                this.showToast(editId ? '零件已更新' : '零件已添加', 'success');
                this.closePartModal();
                this.loadPartsLibrary();
            } else {
                this.showToast(result.message || '操作失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    async deletePart(partId) {
        const part = this.partsLibrary.find(p => p.id === partId);
        if (!part) return;
        if (!confirm(`确定要删除零件"${part.name}"吗？此操作不可撤销。`)) return;
        try {
            const res = await fetch(`/api/parts/library/${partId}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast('零件已删除', 'info');
                this.loadPartsLibrary();
            } else {
                this.showToast(result.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    async quickAddPart(partId) {
        const part = this.partsLibrary.find(p => p.id === partId);
        if (!part) return;
        if (this.printers.length === 0) {
            this.showToast('请先添加打印机', 'error');
            return;
        }
        try {
            const res = await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printer_id: this.printers[0].id,
                    file_name: part.name,
                    material: part.recommended_material,
                    estimated_time: part.estimated_time,
                    priority: 0,
                    notes: `[FRC零件库] ${part.notes}`,
                    part_status: 'needed',
                })
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast(`"${part.name}" 已添加到打印队列`, 'success');
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    // ==================== 零件状态看板 ====================

    async loadPartsBoard() {
        try {
            const robotId = document.getElementById('boardRobotFilter').value;
            const [boardRes, robotsRes] = await Promise.all([
                fetch('/api/parts/board' + (robotId ? `?robot_id=${robotId}` : '')),
                fetch('/api/robots')
            ]);
            const board = await boardRes.json();
            const robots = await robotsRes.json();
            this.renderBoardRobotFilter(robots);
            this.renderKanbanBoard(board);
        } catch (e) {
            console.error('Failed to load parts board:', e);
        }
    }

    renderBoardRobotFilter(robots) {
        const select = document.getElementById('boardRobotFilter');
        const currentVal = select.value;
        select.innerHTML = '<option value="">全部机器人</option>' +
            robots.map(r => `<option value="${r.id}">${this.escapeHtml(r.name)} (${r.type === 'competition' ? '比赛机' : r.type === 'practice' ? '练习机' : '原型机'})</option>`).join('');
        select.value = currentVal;
    }

    renderKanbanBoard(board) {
        const columns = { needed: [], printing: [], done: [], installed: [] };
        board.forEach(item => {
            const status = item.part_status || 'needed';
            if (columns[status]) columns[status].push(item);
        });

        const statusLabels = { needed: '待打印', printing: '打印中', done: '已完成', installed: '已装机' };
        const nextStatus = { needed: 'printing', printing: 'done', done: 'installed', installed: 'needed' };
        const nextLabel = { needed: '开始打印', printing: '标记完成', done: '标记装机', installed: '重置' };

        Object.keys(columns).forEach(status => {
            const container = document.getElementById('kanban' + status.charAt(0).toUpperCase() + status.slice(1));
            const items = columns[status];
            if (items.length === 0) {
                container.innerHTML = '<div class="kanban-empty">暂无零件</div>';
                return;
            }
            container.innerHTML = items.map(item => `
                <div class="kanban-card" onclick="manager.movePartStatus('${item.id}', '${nextStatus[status]}')" title="点击移动到: ${nextLabel[status]}">
                    <div class="kanban-card-name">${this.escapeHtml(item.part_name)}</div>
                    <div class="kanban-card-meta">
                        <span>${item.robot_name || '未分配'} · ${item.subsystem || '未分类'}</span>
                        <span>${item.assigned_to || '未指派'}</span>
                    </div>
                </div>
            `).join('');
        });
    }

    async movePartStatus(queueId, newStatus) {
        try {
            await fetch(`/api/parts/${queueId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ part_status: newStatus })
            });
            this.loadPartsBoard();
        } catch (e) {
            this.showToast('状态更新失败', 'error');
        }
    }

    // ==================== 机器人管理 ====================

    async loadRobots() {
        try {
            const res = await fetch('/api/robots');
            return await res.json();
        } catch (e) {
            return [];
        }
    }

    async addRobotData(data) {
        try {
            const res = await fetch('/api/robots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast('机器人添加成功', 'success');
                this.renderRobotListInModal();
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    async removeRobot(id) {
        if (!confirm('确定要删除此机器人吗?')) return;
        try {
            await fetch(`/api/robots/${id}`, { method: 'DELETE' });
            this.showToast('机器人已删除', 'info');
            this.renderRobotListInModal();
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    async renderRobotListInModal() {
        const robots = await this.loadRobots();
        const container = document.getElementById('robotList');
        const typeLabels = { competition: '比赛机', practice: '练习机', prototype: '原型机' };
        if (robots.length === 0) {
            container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px;">暂无机器人</div>';
            return;
        }
        container.innerHTML = robots.map(r => `
            <div class="robot-list-item">
                <div>
                    <span class="badge ${r.type}">${typeLabels[r.type] || r.type}</span>
                    <span>${this.escapeHtml(r.name)} (${r.year})</span>
                </div>
                <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removeRobot('${r.id}')">删除</button>
            </div>
        `).join('');
    }

    async populateRobotSelects() {
        const robots = await this.loadRobots();
        const selects = ['queueRobotId', 'queueSubsystem'];
        const typeLabels = { competition: '比赛机', practice: '练习机', prototype: '原型机' };

        const robotSelect = document.getElementById('queueRobotId');
        if (robotSelect) {
            robotSelect.innerHTML = '<option value="">不分配</option>' +
                robots.map(r => `<option value="${r.id}">${this.escapeHtml(r.name)} (${typeLabels[r.type] || r.type})</option>`).join('');
        }
    }

    // ==================== 比赛管理 ====================

    async loadCompetitions() {
        try {
            const res = await fetch('/api/competitions');
            const competitions = await res.json();
            this.renderCompetitions(competitions);
        } catch (e) {
            console.error('Failed to load competitions:', e);
        }
    }

    renderCompetitions(competitions) {
        const grid = document.getElementById('competitionGrid');
        if (competitions.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <p>暂无比赛</p>
                    <span>添加即将到来的比赛以跟踪截止日期</span>
                </div>
            `;
            return;
        }
        grid.innerHTML = competitions.map(c => {
            let countdownHTML = '';
            let cardClass = '';
            if (c.days_until < 0) {
                countdownHTML = `<div class="competition-countdown past">✅ 比赛已结束</div>`;
            } else if (c.days_until === 0) {
                countdownHTML = `<div class="competition-countdown urgent">🔥 比赛就在今天!</div>`;
                cardClass = 'urgent';
            } else if (c.days_until <= 3) {
                countdownHTML = `<div class="competition-countdown urgent">⏰ 还剩 ${c.days_until} 天!</div>`;
                cardClass = 'urgent';
            } else if (c.days_until <= 14) {
                countdownHTML = `<div class="competition-countdown days">📅 还剩 ${c.days_until} 天</div>`;
            } else {
                countdownHTML = `<div class="competition-countdown days">📅 还剩 ${c.days_until} 天</div>`;
            }
            return `
                <div class="competition-card ${cardClass}">
                    <div class="competition-name">${this.escapeHtml(c.name)}</div>
                    <div class="competition-meta">
                        ${c.location ? '📍 ' + this.escapeHtml(c.location) + ' · ' : ''}
                        ${c.start_date ? c.start_date : '日期待定'}
                        ${c.end_date ? ' → ' + c.end_date : ''}
                    </div>
                    ${countdownHTML}
                    ${c.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">${this.escapeHtml(c.notes)}</div>` : ''}
                    <div class="competition-actions">
                        <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removeCompetition('${c.id}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async addCompetitionData(data) {
        try {
            const res = await fetch('/api/competitions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast('比赛添加成功', 'success');
                closeCompetitionModal();
                this.loadCompetitions();
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误', 'error');
        }
    }

    async removeCompetition(id) {
        if (!confirm('确定要删除此比赛吗?')) return;
        try {
            await fetch(`/api/competitions/${id}`, { method: 'DELETE' });
            this.showToast('比赛已删除', 'info');
            this.loadCompetitions();
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    // ==================== 通用工具 ====================

    getStatusText(status) {
        const map = {
            'online': '在线', 'offline': '离线', 'printing': '打印中',
            'paused': '已暂停', 'error': '错误', 'idle': '空闲', 'finishing': '完成中'
        };
        return map[status] || status;
    }

    getStatusColor(status) {
        const map = {
            'online': 'var(--green)', 'offline': 'var(--text-muted)',
            'printing': 'var(--accent-blue)', 'paused': 'var(--yellow)',
            'error': 'var(--red)', 'idle': 'var(--text-secondary)',
            'finishing': 'var(--purple)'
        };
        return map[status] || 'var(--text-muted)';
    }

    formatTime(seconds) {
        if (!seconds || seconds <= 0) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}小时${m}分钟`;
        return `${m}分钟`;
    }

    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '-';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    formatDateTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    escapeJs(str) {
        return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // ==================== API 调用 ====================

    async addPrinter(data) {
        try {
            const res = await fetch('/api/printers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
                this.showToast('打印机添加成功!', 'success');
                closeAddPrinterModal();
                this.loadPrinters();
            } else {
                this.showToast(result.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('网络错误，请重试', 'error');
        }
    }

    async removePrinter(id) {
        if (!confirm('确定要删除这台打印机吗?')) return;
        try {
            await fetch(`/api/printers/${id}`, { method: 'DELETE' });
            this.showToast('打印机已删除', 'info');
            this.loadPrinters();
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    async connectPrinter(id) {
        try {
            await fetch(`/api/printers/${id}/connect`, { method: 'POST' });
            this.showToast('正在连接打印机...', 'info');
        } catch (e) {
            this.showToast('连接失败', 'error');
        }
    }

    async disconnectPrinter(id) {
        try {
            await fetch(`/api/printers/${id}/disconnect`, { method: 'POST' });
            this.showToast('已断开连接', 'info');
        } catch (e) {
            this.showToast('断开失败', 'error');
        }
    }

    async connectAll() {
        try {
            await fetch('/api/connect_all', { method: 'POST' });
            this.showToast('正在连接所有打印机...', 'info');
        } catch (e) {
            this.showToast('连接失败', 'error');
        }
    }

    async sendCommand(id, command, params = {}) {
        try {
            await fetch(`/api/printers/${id}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, params })
            });
            const cmdText = {
                'pause': '已发送暂停指令', 'resume': '已发送恢复指令', 'stop': '已发送停止指令'
            };
            this.showToast(cmdText[command] || `已发送指令: ${command}`, 'info');
        } catch (e) {
            this.showToast('指令发送失败', 'error');
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, this._settings.toastDuration * 1000 || 3000);
    }

    // ==================== 设置 ====================

    async loadTheme() {
        try {
            const res = await fetch('/api/theme');
            const data = await res.json();
            this._theme = data.theme || 'auto';
        } catch (e) {
            this._theme = 'auto';
        }
        this.applyTheme(this._theme);
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this._theme === 'auto') this.applyTheme('auto');
        });
    }

    applyTheme(theme) {
        if (theme === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
        const sel = document.getElementById('settingTheme');
        if (sel) sel.value = theme;
        this._theme = theme;
    }

    _formatTemp(celsius) {
        if (celsius == null || isNaN(celsius)) return '--';
        const unit = this._settings?.tempUnit || 'celsius';
        if (unit === 'fahrenheit') {
            return (celsius * 9 / 5 + 32).toFixed(1) + '°F';
        }
        return celsius.toFixed(1) + '°C';
    }

    _formatTempInt(celsius) {
        if (celsius == null || isNaN(celsius)) return '--';
        const unit = this._settings?.tempUnit || 'celsius';
        if (unit === 'fahrenheit') {
            return Math.round(celsius * 9 / 5 + 32) + '°F';
        }
        return Math.round(celsius) + '°C';
    }

    _formatFileSize(bytes) {
        if (bytes == null || isNaN(bytes)) return '--';
        if (bytes < 1024) return bytes + ' B';
        const kb = bytes / 1024;
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        const mb = kb / 1024;
        if (mb < 1024) return mb.toFixed(1) + ' MB';
        return (mb / 1024).toFixed(2) + ' GB';
    }

    async setTheme(theme) {
        this.applyTheme(theme);
        try {
            await fetch('/api/theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme })
            });
        } catch (e) { /* ignore */ }
        this.showToast('主题已保存', 'success');
    }

    saveSetting(key, value) {
        this._settings = this._settings || {};
        this._settings[key] = value;
        try {
            localStorage.setItem('xploreprint_settings', JSON.stringify(this._settings));
        } catch (e) { /* ignore */ }
        this.showToast('设置已保存', 'success');
        if (key === 'inspectInterval') this._restartAutoInspect();
        if (key === 'tempUnit') this.renderDashboard();
    }

    async viewLogs() {
        const viewer = document.getElementById('logViewer');
        const content = document.getElementById('logViewerContent');
        const stats = document.getElementById('logViewerStats');
        viewer.style.display = 'block';
        content.textContent = '加载中...';
        try {
            const res = await fetch('/api/logs/view?lines=200');
            const data = await res.json();
            if (data.success) {
                stats.textContent = `共 ${data.total_lines} 行 · ${data.file_size_kb} KB · 显示最近 ${data.lines.length} 行`;
                content.textContent = data.lines.join('\n');
            } else {
                content.textContent = '加载失败: ' + (data.message || '未知错误');
            }
        } catch (e) {
            content.textContent = '加载失败: 网络错误';
        }
    }

    downloadLogs() {
        const a = document.createElement('a');
        a.href = '/api/logs/download';
        a.download = 'xploreprint.log';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.showToast('日志文件下载中...', 'success');
    }

    updateFilamentMinTempSetting() {
        const slider = document.getElementById('settingFilamentMinTemp');
        const input = document.getElementById('settingFilamentMinTempInput');
        const label = document.getElementById('settingFilamentMinTempLabel');
        if (slider && input) {
            if (document.activeElement === slider) {
                input.value = slider.value;
            } else if (document.activeElement === input) {
                slider.value = input.value;
            }
            const val = parseInt(input.value) || 190;
            if (label) label.textContent = val;
            this.saveSetting('filamentMinTemp', val);
        }
    }

    loadSettings() {
        try {
            this._settings = JSON.parse(localStorage.getItem('xploreprint_settings')) || {};
        } catch (e) {
            this._settings = {};
        }
        this._settings.toastDuration = parseInt(this._settings.toastDuration) || 3;
        this._settings.refreshInterval = parseInt(this._settings.refreshInterval) || 5;
        this._settings.inspectInterval = parseInt(this._settings.inspectInterval) || 60;
        this._settings.tempUnit = this._settings.tempUnit || 'celsius';
        this._settings.filamentMinTemp = parseInt(this._settings.filamentMinTemp) || 190;

        const refreshEl = document.getElementById('settingRefreshInterval');
        if (refreshEl) refreshEl.value = this._settings.refreshInterval;
        const inspectEl = document.getElementById('settingInspectInterval');
        if (inspectEl) inspectEl.value = this._settings.inspectInterval;
        const tempEl = document.getElementById('settingTempUnit');
        if (tempEl) tempEl.value = this._settings.tempUnit;
        const toastEl = document.getElementById('settingToastDuration');
        if (toastEl) toastEl.value = this._settings.toastDuration;
        const filamentMinTempEl = document.getElementById('settingFilamentMinTemp');
        if (filamentMinTempEl) filamentMinTempEl.value = this._settings.filamentMinTemp;
        const filamentMinTempInputEl = document.getElementById('settingFilamentMinTempInput');
        if (filamentMinTempInputEl) filamentMinTempInputEl.value = this._settings.filamentMinTemp;
        const filamentMinTempLabelEl = document.getElementById('settingFilamentMinTempLabel');
        if (filamentMinTempLabelEl) filamentMinTempLabelEl.textContent = this._settings.filamentMinTemp;

        this._restartAutoInspect();
    }

    // ==================== 诊断测试 ====================

    async runServerPing() {
        const resultEl = document.getElementById('serverPingResult');
        const btn = document.getElementById('serverPingBtn');
        const valueEl = resultEl.querySelector('.diag-value');
        btn.disabled = true;
        btn.textContent = '测试中...';
        valueEl.textContent = '...';
        valueEl.className = 'diag-value';

        const t0 = performance.now();
        try {
            const resp = await fetch('/api/diagnostics/ping');
            const t1 = performance.now();
            const data = await resp.json();
            const rtt = Math.round(t1 - t0);
            valueEl.textContent = rtt;
            valueEl.className = rtt < 50 ? 'diag-value good' : rtt < 200 ? 'diag-value warn' : 'diag-value bad';
            this.showToast(`服务器延迟: ${rtt}ms`, 'info');
        } catch (e) {
            valueEl.textContent = '失败';
            valueEl.className = 'diag-value bad';
            this.showToast('服务器连接失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>开始测试`;
    }

    async runPrinterPing() {
        const printerId = document.getElementById('diagPrinterSelect').value;
        if (!printerId) {
            this.showToast('请先选择打印机', 'error');
            return;
        }
        const resultEl = document.getElementById('printerPingResult');
        const btn = document.getElementById('printerPingBtn');
        const valueEl = resultEl.querySelector('.diag-value');
        btn.disabled = true;
        btn.textContent = '测试中...';
        valueEl.textContent = '...';
        valueEl.className = 'diag-value';

        try {
            const resp = await fetch('/api/diagnostics/printer-latency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ printer_id: printerId }),
            });
            const data = await resp.json();
            if (data.success) {
                const ms = data.printer_response_ms || data.latency_ms;
                valueEl.textContent = ms;
                valueEl.className = ms < 100 ? 'diag-value good' : ms < 500 ? 'diag-value warn' : 'diag-value bad';
                this.showToast(`打印机延迟: ${ms}ms`, 'success');
            } else {
                valueEl.textContent = '失败';
                valueEl.className = 'diag-value bad';
                this.showToast(data.message || '测试失败', 'error');
            }
        } catch (e) {
            valueEl.textContent = '失败';
            valueEl.className = 'diag-value bad';
            this.showToast('请求失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>开始测试`;
    }

    updateDiagPrinterList() {
        const select = document.getElementById('diagPrinterSelect');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">选择打印机...</option>';
        this.printers.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === currentVal) opt.selected = true;
            select.appendChild(opt);
        });
    }

    async refreshAMSData() {
        const onlinePrinters = this.printers.filter(p => p.status !== 'offline');
        for (const printer of onlinePrinters) {
            try {
                const resp = await fetch(`/api/printers/${printer.id}/ams`);
                const amsData = await resp.json();
                if (amsData && amsData.length > 0) {
                    const amsUnits = [];
                    amsData.forEach(ams => {
                        ams.trays.forEach(tray => {
                            const color = tray.color || '#CCCCCC';
                            const material = tray.material || 'Unknown';
                            const materialClean = material.includes('_') ? material.split('_').pop() : material;
                            amsUnits.push({
                                tray_id: parseInt(`${ams.ams_id}${tray.tray_id}`),
                                color: color,
                                material: materialClean,
                                temperature: ams.temperature || 0,
                                remaining: 100,
                            });
                        });
                    });
                    if (amsUnits.length > 0) {
                        const existing = this.printers.find(p => p.id === printer.id);
                        if (existing) {
                            existing.ams_units = amsUnits;
                        }
                    }
                }
            } catch (e) {
                /* silent fail - AMS data may not be available */
            }
        }
    }

    // ==================== 打印操作台 ====================

    renderOperations() {
        const container = document.getElementById('operationsContainer');
        const onlinePrinters = this.printers.filter(p => p.status !== 'offline');

        if (onlinePrinters.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>没有在线打印机</p>
                    <span>请先在仪表盘中连接打印机</span>
                </div>
            `;
            return;
        }

        const currentPrinterId = container.dataset.selectedPrinter ||
            (this._selectedOpsPrinter || onlinePrinters[0].id);
        const printer = onlinePrinters.find(p => p.id === currentPrinterId) || onlinePrinters[0];
        this._selectedOpsPrinter = printer.id;

        const isPrinting = printer.status === 'printing' || printer.status === 'paused';
        const isPaused = printer.status === 'paused';

        container.innerHTML = `
            <div class="operations-printer-select">
                <select class="form-input" id="opsPrinterSelect">
                    ${onlinePrinters.map(p => `
                        <option value="${p.id}" ${p.id === printer.id ? 'selected' : ''}>
                            ${this.escapeHtml(p.name)} (${p.model}) - ${this.getStatusText(p.status)}
                        </option>
                    `).join('')}
                </select>
                <button class="btn btn-sm btn-outline" onclick="manager.refreshOperations()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                    刷新
                </button>
            </div>

            <div class="ops-grid">
                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon temp">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>
                        </div>
                        <div>
                            <h4>温度控制</h4>
                            <div class="ops-card-subtitle">当前: 喷头 ${this._formatTempInt(printer.nozzle_temp)} / 热床 ${this._formatTempInt(printer.bed_temp)}</div>
                        </div>
                    </div>
                    <div class="temp-control-row">
                        <span class="temp-control-label">喷头</span>
                        <div class="temp-control-input">
                            <input type="range" id="nozzleTempSlider" min="0" max="300" oninput="document.getElementById('nozzleTempInput').value=this.value">
                            <input type="number" id="nozzleTempInput" min="0" max="300" value="${printer.nozzle_temp || 0}" oninput="document.getElementById('nozzleTempSlider').value=this.value">
                        </div>
                        <span class="temp-control-value">${this._settings?.tempUnit === 'fahrenheit' ? '°F' : '°C'}</span>
                    </div>
                    <div class="temp-control-row">
                        <span class="temp-control-label">热床</span>
                        <div class="temp-control-input">
                            <input type="range" id="bedTempSlider" min="0" max="120" oninput="document.getElementById('bedTempInput').value=this.value">
                            <input type="number" id="bedTempInput" min="0" max="120" value="${printer.bed_temp || 0}" oninput="document.getElementById('bedTempSlider').value=this.value">
                        </div>
                        <span class="temp-control-value">${this._settings?.tempUnit === 'fahrenheit' ? '°F' : '°C'}</span>
                    </div>
                    <button class="btn btn-primary btn-sm temp-apply" onclick="manager.applyTemperatures()">应用温度</button>
                </div>

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon fan">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><path d="M12 12v-4a4 4 0 014 4z"/></svg>
                        </div>
                        <div>
                            <h4>部件散热风扇</h4>
                            <div class="ops-card-subtitle">打印件散热</div>
                        </div>
                    </div>
                    <div class="fan-control">
                        <span class="fan-speed-display" id="fanSpeedDisplay">128</span>
                        <input type="range" id="fanSpeedSlider" min="0" max="255" value="128" oninput="document.getElementById('fanSpeedDisplay').textContent = this.value">
                    </div>
                    <div class="fan-presets">
                        <span class="fan-preset" onclick="manager.setFanSpeedUI(0)">关闭</span>
                        <span class="fan-preset" onclick="manager.setFanSpeedUI(64)">25%</span>
                        <span class="fan-preset" onclick="manager.setFanSpeedUI(128)">50%</span>
                        <span class="fan-preset" onclick="manager.setFanSpeedUI(192)">75%</span>
                        <span class="fan-preset" onclick="manager.setFanSpeedUI(255)">100%</span>
                    </div>
                    <button class="btn btn-primary btn-sm temp-apply" onclick="manager.applyPartFan()">应用</button>
                </div>

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon" style="background:rgba(16,185,129,0.12);color:var(--green);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><path d="M12 12v-4a4 4 0 014 4z"/></svg>
                        </div>
                        <div>
                            <h4>辅助风扇</h4>
                            <div class="ops-card-subtitle">辅助散热</div>
                        </div>
                    </div>
                    <div class="fan-control">
                        <span class="fan-speed-display" id="auxFanSpeedDisplay" style="color:var(--green);">128</span>
                        <input type="range" id="auxFanSpeedSlider" min="0" max="255" value="128" oninput="document.getElementById('auxFanSpeedDisplay').textContent = this.value">
                    </div>
                    <div class="fan-presets">
                        <span class="fan-preset" onclick="manager.setAuxFanSpeedUI(0)">关闭</span>
                        <span class="fan-preset" onclick="manager.setAuxFanSpeedUI(64)">25%</span>
                        <span class="fan-preset" onclick="manager.setAuxFanSpeedUI(128)">50%</span>
                        <span class="fan-preset" onclick="manager.setAuxFanSpeedUI(192)">75%</span>
                        <span class="fan-preset" onclick="manager.setAuxFanSpeedUI(255)">100%</span>
                    </div>
                    <button class="btn btn-primary btn-sm temp-apply" onclick="manager.applyAuxFan()">应用</button>
                </div>

                <div class="ops-card full-width">
                    <div class="ops-card-header">
                        <div class="ops-card-icon" style="background:rgba(245,158,11,0.12);color:var(--yellow);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><path d="M12 12v-4a4 4 0 014 4z"/></svg>
                        </div>
                        <div>
                            <h4>机箱风扇</h4>
                            <div class="ops-card-subtitle">腔体循环</div>
                        </div>
                    </div>
                    <div class="fan-control">
                        <span class="fan-speed-display" id="chamberFanSpeedDisplay" style="color:var(--yellow);">128</span>
                        <input type="range" id="chamberFanSpeedSlider" min="0" max="255" value="128" oninput="document.getElementById('chamberFanSpeedDisplay').textContent = this.value">
                    </div>
                    <div class="fan-presets">
                        <span class="fan-preset" onclick="manager.setChamberFanSpeedUI(0)">关闭</span>
                        <span class="fan-preset" onclick="manager.setChamberFanSpeedUI(64)">25%</span>
                        <span class="fan-preset" onclick="manager.setChamberFanSpeedUI(128)">50%</span>
                        <span class="fan-preset" onclick="manager.setChamberFanSpeedUI(192)">75%</span>
                        <span class="fan-preset" onclick="manager.setChamberFanSpeedUI(255)">100%</span>
                    </div>
                    <button class="btn btn-primary btn-sm temp-apply" onclick="manager.applyChamberFan()">应用</button>
                </div>

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon speed">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </div>
                        <div>
                            <h4>打印速度</h4>
                            <div class="ops-card-subtitle">${isPrinting ? '仅打印中可用' : '打印机空闲'}</div>
                        </div>
                    </div>
                    <div class="speed-control">
                        <button class="speed-btn" onclick="manager.setSpeed('${printer.id}', 1)">
                            🐢 低速
                            <span class="speed-label">50%</span>
                        </button>
                        <button class="speed-btn" onclick="manager.setSpeed('${printer.id}', 2)">
                            🐇 标准
                            <span class="speed-label">100%</span>
                        </button>
                        <button class="speed-btn" onclick="manager.setSpeed('${printer.id}', 3)">
                            🦊 高速
                            <span class="speed-label">124%</span>
                        </button>
                        <button class="speed-btn" onclick="manager.setSpeed('${printer.id}', 4)">
                            🚀 极速
                            <span class="speed-label">166%</span>
                        </button>
                    </div>
                </div>

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon light">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                        </div>
                        <div>
                            <h4>LED 灯光</h4>
                            <div class="ops-card-subtitle">控制打印机照明</div>
                        </div>
                    </div>
                    <div class="light-toggle">
                        <span class="light-status on" id="lightStatus">开启</span>
                        <div class="toggle-switch on" id="lightToggle" onclick="manager.toggleLight('${printer.id}')"></div>
                    </div>
                </div>

                <div class="ops-card full-width">
                    <div class="ops-card-header">
                        <div class="ops-card-icon move">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                        </div>
                        <div>
                            <h4>XYZ 轴移动</h4>
                            <div class="ops-card-subtitle">${isPrinting ? '请先暂停打印' : '操纵杆式控制 · 步长: <span id="stepDisplay">±1</span>'}</div>
                        </div>
                    </div>
                    <div class="joystick-container">
                        <div class="joystick-step-selector">
                            <button class="step-btn active" data-step="1" onclick="manager.setMoveStep(1, this)">±1 mm</button>
                            <button class="step-btn" data-step="10" onclick="manager.setMoveStep(10, this)">±10 mm</button>
                        </div>
                        <div class="joystick-pad">
                            <button class="joy-btn joy-up" onclick="manager.moveAxis('${printer.id}', 'Y', manager._moveStep || 1)" title="Y+">▲<span>Y+</span></button>
                            <button class="joy-btn joy-left" onclick="manager.moveAxis('${printer.id}', 'X', -(manager._moveStep || 1))" title="X-">◄<span>X-</span></button>
                            <button class="joy-btn joy-home" onclick="manager.sendCommand('${printer.id}','home')" title="归位">🏠</button>
                            <button class="joy-btn joy-right" onclick="manager.moveAxis('${printer.id}', 'X', (manager._moveStep || 1))" title="X+"><span>X+</span>►</button>
                            <button class="joy-btn joy-down" onclick="manager.moveAxis('${printer.id}', 'Y', -(manager._moveStep || 1))" title="Y-"><span>Y-</span>▼</button>
                        </div>
                        <div class="joystick-z-control">
                            <button class="joy-btn joy-z-up" onclick="manager.moveAxis('${printer.id}', 'Z', (manager._moveStep || 1))" title="Z+">⬆ Z+<span id="zStepUp">1</span></button>
                            <button class="joy-btn joy-z-down" onclick="manager.moveAxis('${printer.id}', 'Z', -(manager._moveStep || 1))" title="Z-">⬇ Z-<span id="zStepDown">1</span></button>
                        </div>
                    </div>
                </div>

                <div class="ops-card full-width">
                    <div class="ops-card-header">
                        <div class="ops-card-icon gcode">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                        </div>
                        <div>
                            <h4>G-code 发送</h4>
                            <div class="ops-card-subtitle">发送自定义 G-code 指令</div>
                        </div>
                    </div>
                    <div class="gcode-input-row">
                        <input type="text" id="gcodeInput" placeholder="例如: G28 X Y, M106 S255" onkeydown="if(event.key==='Enter') manager.sendGcode('${printer.id}')">
                        <button class="btn btn-primary btn-sm" onclick="manager.sendGcode('${printer.id}')">发送</button>
                    </div>
                    <div class="gcode-history" id="gcodeHistory"></div>
                </div>

                <div class="ops-card full-width">
                    <div class="ops-card-header">
                        <div class="ops-card-icon" style="background:rgba(239,68,68,0.12);color:var(--danger);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>
                        </div>
                        <div>
                            <h4>挤出机 & 进退料</h4>
                            <div class="ops-card-subtitle">喷嘴: ${this._formatTempInt(printer.nozzle_temp)} / 目标: <span id="extruderTargetDisplay">--</span></div>
                        </div>
                    </div>
                    <div class="extruder-control-row">
                        <div class="extruder-temp-control">
                            <span class="temp-control-label">喷嘴温度</span>
                            <div class="temp-control-input">
                                <input type="range" id="extruderTempSlider" min="0" max="300" value="${printer.nozzle_temp || 0}" oninput="manager.updateExtruderTemp()">
                                <input type="number" id="extruderTempInput" min="0" max="300" value="${printer.nozzle_temp || 0}" oninput="manager.updateExtruderTemp()">
                            </div>
                            <span class="temp-control-value">${this._settings?.tempUnit === 'fahrenheit' ? '°F' : '°C'}</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="manager.applyExtruderTemp('${printer.id}')">加热</button>
                    </div>
${printer.ams_units && printer.ams_units.length > 0 ? `
                    <div class="extruder-ams-row">
                        <span class="ams-select-label">选择 AMS 料槽:</span>
                        <select class="form-input" id="filamentAmsSelect">
                            ${printer.ams_units.map(t => {
                                const amsId = Math.floor(t.tray_id / 10);
                                const trayId = t.tray_id % 10;
                                return `<option value="${amsId},${trayId}">AMS ${amsId+1} 槽${trayId+1} — ${t.material} ${t.remaining}%</option>`;
                            }).join('')}
                        </select>
                    </div>
` : ''}
                    <div class="extruder-filament-row">
                        <button class="btn btn-outline btn-sm filament-btn" id="loadFilamentBtn" onclick="manager.loadFilamentFromAms('${printer.id}')" disabled title="进料前需实际温度达到最低温度">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="22 2 13.5 10.5"/><polyline points="11 13 2 22"/></svg>
                            进料
                        </button>
                        <button class="btn btn-outline btn-sm filament-btn" id="unloadFilamentBtn" onclick="manager.sendCommand('${printer.id}','unload_filament')" disabled title="退料前需实际温度达到最低温度">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;transform:rotate(180deg);"><polyline points="22 2 13.5 10.5"/><polyline points="11 13 2 22"/></svg>
                            退料
                        </button>
                        <span class="filament-lock-hint" id="filamentLockHint">🔒 喷嘴实际温度 <b>${this._formatTempInt(190)}</b> 解锁</span>
                    </div>
                </div>

                ${isPrinting ? `
                <div class="ops-card full-width">
                    <div class="ops-card-header">
                        <div class="ops-card-icon" style="background:rgba(245,158,11,0.12);color:var(--yellow);">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                        <div>
                            <h4>打印控制</h4>
                            <div class="ops-card-subtitle">${printer.current_file || '未知文件'} · ${printer.print_progress}%</div>
                        </div>
                    </div>
                    <div class="card-actions" style="margin-top:0;">
                        ${isPaused ? `
                            <button class="btn btn-success" onclick="manager.sendCommand('${printer.id}','resume')">▶ 继续打印</button>
                        ` : `
                            <button class="btn btn-outline" onclick="manager.sendCommand('${printer.id}','pause')">⏸ 暂停</button>
                        `}
                        <button class="btn btn-danger" onclick="manager.sendCommand('${printer.id}','stop')">⏹ 停止</button>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        this.bindOperationsEvents(printer);
        this._updateFilamentButtons(printer.nozzle_temp || 0);
    }

    bindOperationsEvents(printer) {
        const select = document.getElementById('opsPrinterSelect');
        if (select) {
            select.addEventListener('change', (e) => {
                this._selectedOpsPrinter = e.target.value;
                this.renderOperations();
            });
        }
    }

    refreshOperations() {
        this.renderOperations();
    }

    applyTemperatures() {
        const printerId = this._selectedOpsPrinter;
        if (!printerId) return;
        const nozzleRaw = document.getElementById('nozzleTempInput').value;
        const bedRaw = document.getElementById('bedTempInput').value;
        const nozzleTemp = nozzleRaw !== '' ? parseInt(nozzleRaw) : NaN;
        const bedTemp = bedRaw !== '' ? parseInt(bedRaw) : NaN;
        if (!isNaN(nozzleTemp)) {
            this.sendCommand(printerId, 'set_nozzle_temp', { temp: nozzleTemp });
        }
        if (!isNaN(bedTemp)) {
            this.sendCommand(printerId, 'set_bed_temp', { temp: bedTemp });
        }
        this.showToast(`温度已设置: 喷头 ${this._formatTempInt(nozzleTemp)} / 热床 ${this._formatTempInt(bedTemp)}`, 'info');
    }

    setFanSpeed(speed) {
        const printerId = this._selectedOpsPrinter;
        if (!printerId) return;
        this.sendCommand(printerId, 'set_fan', { speed: parseInt(speed) });
        this.showToast(`部件风扇速度已设置为 ${speed}`, 'info');
    }

    setFanSpeedUI(speed) {
        document.getElementById('fanSpeedSlider').value = speed;
        document.getElementById('fanSpeedDisplay').textContent = speed;
        this.setFanSpeed(speed);
    }

    setAuxFanSpeed(speed) {
        const printerId = this._selectedOpsPrinter;
        if (!printerId) return;
        this.sendCommand(printerId, 'set_aux_fan', { speed: parseInt(speed) });
        this.showToast(`辅助风扇速度已设置为 ${speed}`, 'info');
    }

    setAuxFanSpeedUI(speed) {
        document.getElementById('auxFanSpeedSlider').value = speed;
        document.getElementById('auxFanSpeedDisplay').textContent = speed;
        this.setAuxFanSpeed(speed);
    }

    setChamberFanSpeed(speed) {
        const printerId = this._selectedOpsPrinter;
        if (!printerId) return;
        this.sendCommand(printerId, 'set_chamber_fan', { speed: parseInt(speed) });
        this.showToast(`机箱风扇速度已设置为 ${speed}`, 'info');
    }

    setChamberFanSpeedUI(speed) {
        document.getElementById('chamberFanSpeedSlider').value = speed;
        document.getElementById('chamberFanSpeedDisplay').textContent = speed;
        this.setChamberFanSpeed(speed);
    }

    applyPartFan() {
        const speed = parseInt(document.getElementById('fanSpeedSlider').value) || 0;
        this.setFanSpeed(speed);
    }

    applyAuxFan() {
        const speed = parseInt(document.getElementById('auxFanSpeedSlider').value) || 0;
        this.setAuxFanSpeed(speed);
    }

    applyChamberFan() {
        const speed = parseInt(document.getElementById('chamberFanSpeedSlider').value) || 0;
        this.setChamberFanSpeed(speed);
    }

    updateExtruderTemp() {
        const slider = document.getElementById('extruderTempSlider');
        const input = document.getElementById('extruderTempInput');
        const targetDisplay = document.getElementById('extruderTargetDisplay');
        if (slider && input) {
            if (document.activeElement === slider) {
                input.value = slider.value;
            } else if (document.activeElement === input) {
                slider.value = input.value;
            }
            const temp = parseInt(input.value) || 0;
            if (targetDisplay) targetDisplay.textContent = this._formatTempInt(temp);
        }
    }

    _updateFilamentButtons(actualTemp) {
        const MIN_TEMP = parseInt(this._settings?.filamentMinTemp) || 190;
        const loadBtn = document.getElementById('loadFilamentBtn');
        const unloadBtn = document.getElementById('unloadFilamentBtn');
        const lockHint = document.getElementById('filamentLockHint');
        const unlocked = actualTemp >= MIN_TEMP;
        if (loadBtn) {
            loadBtn.disabled = !unlocked;
            loadBtn.style.opacity = unlocked ? '1' : '0.5';
        }
        if (unloadBtn) {
            unloadBtn.disabled = !unlocked;
            unloadBtn.style.opacity = unlocked ? '1' : '0.5';
        }
        if (lockHint) {
            if (unlocked) {
                lockHint.innerHTML = '✅ 实际温度达标，可进退料';
                lockHint.style.color = 'var(--accent-green)';
            } else {
                lockHint.innerHTML = '🔒 喷嘴实际温度达到 <b>' + this._formatTempInt(MIN_TEMP) + '</b> 解锁 (当前 ' + this._formatTemp(actualTemp) + ')';
                lockHint.style.color = 'var(--text-muted)';
            }
        }
    }

    loadFilamentFromAms(printerId) {
        const select = document.getElementById('filamentAmsSelect');
        let amsId = null, trayId = null;
        if (select && select.value) {
            const parts = select.value.split(',');
            amsId = parseInt(parts[0]);
            trayId = parseInt(parts[1]);
        }
        this.sendCommand(printerId, 'load_filament', { ams_id: amsId, tray_id: trayId });
        this.showToast('正在进料...', 'info');
    }

    setMoveStep(step, btn) {
        this._moveStep = step;
        document.getElementById('stepDisplay').textContent = '±' + step;
        const zUp = document.getElementById('zStepUp');
        const zDown = document.getElementById('zStepDown');
        if (zUp) zUp.textContent = step;
        if (zDown) zDown.textContent = step;
        document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    moveAxis(printerId, axis, distance) {
        if (axis === 'X') {
            this.sendCommand(printerId, 'move_x', { distance: Math.abs(distance) });
        } else if (axis === 'Y') {
            this.sendCommand(printerId, 'move_y', { distance: Math.abs(distance) });
        } else if (axis === 'Z') {
            this.sendCommand(printerId, 'move_z', { distance: parseFloat(distance) });
        }
        const dir = distance > 0 ? '+' : '';
        this.showToast(`${axis}轴移动 ${dir}${distance}mm`, 'info');
    }

    setSpeed(printerId, level) {
        const labels = { 1: '低速 (50%)', 2: '标准 (100%)', 3: '高速 (124%)', 4: '极速 (166%)' };
        this.sendCommand(printerId, 'set_speed', { level });
        this.showToast(`打印速度已设置为 ${labels[level]}`, 'info');
    }

    toggleLight(printerId) {
        const toggle = document.getElementById('lightToggle');
        const status = document.getElementById('lightStatus');
        if (toggle && status) {
            const isOn = toggle.classList.contains('on');
            if (isOn) {
                this.sendCommand(printerId, 'led_off');
                toggle.classList.remove('on');
                status.classList.remove('on');
                status.textContent = '关闭';
            } else {
                this.sendCommand(printerId, 'led_on');
                toggle.classList.add('on');
                status.classList.add('on');
                status.textContent = '开启';
            }
        }
    }

    sendGcode(printerId) {
        const input = document.getElementById('gcodeInput');
        if (!input) return;
        const gcode = input.value.trim();
        if (!gcode) return;
        this.sendCommand(printerId, 'send_gcode', { gcode });
        this.showToast(`G-code 已发送: ${gcode}`, 'info');
        const history = document.getElementById('gcodeHistory');
        if (history) {
            history.innerHTML = `<span style="color:var(--green);">▶ ${this.escapeHtml(gcode)}</span><br>` + history.innerHTML;
        }
        input.value = '';
    }

    toggleVideo(printerId) {
        const panel = document.getElementById(`video-${printerId}`);
        if (!panel) return;
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            this._startVideoPoll(printerId);
        } else {
            panel.style.display = 'none';
            this._stopVideoPoll(printerId);
        }
    }

    _startVideoPoll(printerId) {
        if (!this._videoTimers) this._videoTimers = {};
        if (!this._videoBlobs) this._videoBlobs = {};
        this._stopVideoPoll(printerId);
        const poll = () => {
            const img = document.getElementById(`video-img-${printerId}`);
            const placeholder = document.getElementById(`video-placeholder-${printerId}`);
            if (!img) {
                this._stopVideoPoll(printerId);
                return;
            }
            const panel = document.getElementById(`video-${printerId}`);
            if (panel && panel.style.display === 'none') {
                this._stopVideoPoll(printerId);
                return;
            }
            const url = `/api/printers/${printerId}/snapshot?t=${Date.now()}`;
            fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error('no frame');
                    return res.blob();
                })
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    const oldUrl = this._videoBlobs[printerId];
                    img.src = objectUrl;
                    this._videoBlobs[printerId] = objectUrl;
                    img.style.opacity = '1';
                    if (placeholder) placeholder.style.display = 'none';
                    if (oldUrl) URL.revokeObjectURL(oldUrl);
                })
                .catch(() => {
                    if (!img.src || img.style.opacity === '0') {
                        if (placeholder) {
                            placeholder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg><span>等待视频流...</span>`;
                            placeholder.style.display = 'flex';
                        }
                    }
                });
        };
        poll();
        this._videoTimers[printerId] = setInterval(poll, 500);
    }

    _stopVideoPoll(printerId) {
        if (this._videoTimers && this._videoTimers[printerId]) {
            clearInterval(this._videoTimers[printerId]);
            delete this._videoTimers[printerId];
        }
        if (this._videoBlobs && this._videoBlobs[printerId]) {
            URL.revokeObjectURL(this._videoBlobs[printerId]);
            delete this._videoBlobs[printerId];
        }
    }

    async inspectPrint(printerId) {
        const statusEl = document.getElementById(`inspect-status-${printerId}`);
        const resultEl = document.getElementById(`inspect-result-${printerId}`);
        if (statusEl) { statusEl.textContent = '⏳ 下载快照...'; statusEl.className = 'inspect-status'; }
        if (resultEl) resultEl.style.display = 'none';
        try {
            const snapRes = await fetch(`/api/printers/${printerId}/snapshot`);
            if (!snapRes.ok) {
                if (statusEl) statusEl.textContent = '❌ 无法获取摄像头画面';
                return;
            }
            const blob = await snapRes.blob();
            if (statusEl) statusEl.textContent = '⏳ 质检中...';
            const formData = new FormData();
            formData.append('image', blob, 'snapshot.jpg');
            const res = await fetch('/api/inspect/predict', { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.success) {
                if (statusEl) statusEl.textContent = '❌ ' + (data.message || '质检失败');
                return;
            }
            if (statusEl) statusEl.textContent = data.is_anomaly ? '⚠️ 检测到异常' : '✅ 正常';
            if (statusEl) statusEl.className = 'inspect-status ' + (data.is_anomaly ? 'inspect-anomaly' : 'inspect-normal');
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = this._buildInspectResultHTML(data);
            }
            const printer = this.printers.find(p => p.id === printerId);
            this._showInspectPopup(printer ? printer.name : printerId, data);
        } catch (e) {
            if (statusEl) statusEl.textContent = '❌ 网络错误';
        }
    }

    async checkCVHealth() {
        try {
            const res = await fetch('/api/inspect/health');
            const data = await res.json();
            this._cvHealthy = data.success && data.message === 'pong';
            this._cvTimestamp = data.timestamp || null;
        } catch (e) {
            this._cvHealthy = false;
        }
        this._updateCVHealthDots();
    }

    _startAutoInspect() {
        this._stopAutoInspect();
        const interval = parseInt(this._settings?.inspectInterval) || 0;
        if (interval <= 0) return;
        this._autoInspectTimer = setInterval(() => this._autoInspectTick(), interval * 1000);
    }

    _stopAutoInspect() {
        if (this._autoInspectTimer) {
            clearInterval(this._autoInspectTimer);
            this._autoInspectTimer = null;
        }
    }

    _restartAutoInspect() {
        this._stopAutoInspect();
        this._startAutoInspect();
    }

    async _autoInspectTick() {
        const printing = this.printers.filter(p => p.status === 'printing');
        if (printing.length === 0) return;
        for (const printer of printing) {
            try {
                const snapRes = await fetch(`/api/printers/${printer.id}/snapshot`);
                if (!snapRes.ok) continue;
                const blob = await snapRes.blob();
                const formData = new FormData();
                formData.append('image', blob, 'snapshot.jpg');
                const res = await fetch('/api/inspect/predict', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success && data.is_anomaly && this._toastTimer === null) {
                    this.showToast(`⚠️ ${printer.name}: 检测到打印异常 (${data.confidence.toFixed(1)}%)`, 'error');
                }
                const statusEl = document.getElementById(`inspect-status-${printer.id}`);
                if (statusEl && data.success) {
                    statusEl.textContent = data.is_anomaly ? '⚠️ 检测到异常' : '✅ 正常';
                    statusEl.className = 'inspect-status ' + (data.is_anomaly ? 'inspect-anomaly' : 'inspect-normal');
                }
            } catch (e) { /* ignore auto-inspect errors */ }
        }
    }

    _showInspectPopup(printerName, data) {
        const popup = document.getElementById('inspectPopup');
        const body = document.getElementById('inspectPopupBody');
        if (!popup || !body) return;
        popup.style.display = 'block';
        const anomalyClass = data.is_anomaly ? 'inspect-card-anomaly' : 'inspect-card-normal';
        const anomalyText = data.is_anomaly ? '⚠️ 异常' : '✅ 正常';
        body.innerHTML = `
            <div style="margin-bottom:6px;font-weight:600;font-size:13px;">${printerName || '打印机'}</div>
            <div class="inspect-grid ${anomalyClass}" style="margin-bottom:8px;">
                <div class="inspect-header">
                    <span class="inspect-label-text">${data.label || 'N/A'}</span>
                    <span class="inspect-anomaly-badge">${anomalyText}</span>
                </div>
                <div class="inspect-row"><span class="inspect-key">置信度</span><span class="inspect-val">${data.confidence != null ? data.confidence.toFixed(1) + '%' : 'N/A'}</span></div>
                <div class="inspect-row"><span class="inspect-key">重构误差</span><span class="inspect-val">${data.reconstruction_error != null ? data.reconstruction_error.toFixed(5) : 'N/A'}</span></div>
                <div class="inspect-row"><span class="inspect-key">处理耗时</span><span class="inspect-val">${data.processing_time_ms != null ? data.processing_time_ms.toFixed(1) + 'ms' : 'N/A'}</span></div>
            </div>
        `;
        this._addInspectHistory(printerName, data);
    }

    _addInspectHistory(printerName, data) {
        const entry = {
            time: new Date().toLocaleTimeString(),
            printer: printerName || '未知',
            is_anomaly: data.is_anomaly,
            label: data.label,
            confidence: data.confidence
        };
        this._inspectHistory.unshift(entry);
        if (this._inspectHistory.length > 50) this._inspectHistory.pop();
        this._renderInspectHistory();
    }

    _renderInspectHistory() {
        const el = document.getElementById('inspectHistory');
        if (!el) return;
        if (this._inspectHistory.length === 0) {
            el.innerHTML = '<span class="inspect-history-empty">暂无记录</span>';
            return;
        }
        el.innerHTML = this._inspectHistory.map(h => `
            <div class="inspect-history-item" onclick="manager._loadHistoryResult('${h.time}')">
                <div class="inspect-history-item-header">
                    <span class="inspect-history-time">${h.time} · ${h.printer}</span>
                    <span class="inspect-history-badge ${h.is_anomaly ? 'anomaly' : 'normal'}">${h.is_anomaly ? '异常' : '正常'}</span>
                </div>
                <div class="inspect-history-summary">${h.label || 'N/A'} · ${h.confidence != null ? h.confidence.toFixed(1) + '%' : 'N/A'}</div>
            </div>
        `).join('');
    }

    onInspectPrinterChange() {
        const sel = document.getElementById('inspectPrinterSelect');
        const btn = document.getElementById('btnInspectCapture');
        if (btn) btn.disabled = !sel || !sel.value;
    }

    switchInspectTab(tab) {
        this._inspectTab = tab;
        document.querySelectorAll('.inspect-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        const snapPanel = document.getElementById('inspectSnapshotPanel');
        const uploadPanel = document.getElementById('inspectUploadPanel');
        if (snapPanel) snapPanel.style.display = tab === 'snapshot' ? '' : 'none';
        if (uploadPanel) uploadPanel.style.display = tab === 'upload' ? '' : 'none';
    }

    async inspectPageCapture() {
        const sel = document.getElementById('inspectPrinterSelect');
        const printerId = sel ? sel.value : '';
        if (!printerId) return;
        const preview = document.getElementById('inspectSnapshotPreview');
        const resultEl = document.getElementById('inspectPageResult');
        if (preview) preview.innerHTML = '<span class="inspect-preview-placeholder">⏳ 获取快照中...</span>';
        if (resultEl) resultEl.innerHTML = '<div class="inspect-page-result-empty"><span>⏳ 识别中...</span></div>';
        try {
            const snapRes = await fetch(`/api/printers/${printerId}/snapshot`);
            if (!snapRes.ok) {
                if (preview) preview.innerHTML = '<span class="inspect-preview-placeholder">❌ 无法获取摄像头画面</span>';
                return;
            }
            const blob = await snapRes.blob();
            const url = URL.createObjectURL(blob);
            if (preview) preview.innerHTML = `<img src="${url}" alt="快照">`;
            const formData = new FormData();
            formData.append('image', blob, 'snapshot.jpg');
            const res = await fetch('/api/inspect/predict', { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.success) {
                if (resultEl) resultEl.innerHTML = `<div class="inspect-page-result-empty"><span>❌ ${data.message || '识别失败'}</span></div>`;
                return;
            }
            const printer = this.printers.find(p => p.id === printerId);
            if (resultEl) resultEl.innerHTML = this._buildInspectResultHTML(data);
            this._addInspectHistory(printer ? printer.name : printerId, data);
        } catch (e) {
            if (resultEl) resultEl.innerHTML = '<div class="inspect-page-result-empty"><span>❌ 网络错误</span></div>';
        }
    }

    async inspectPageUpload() {
        const input = document.getElementById('inspectFileInput');
        if (!input || !input.files || !input.files[0]) return;
        const file = input.files[0];
        const preview = document.getElementById('inspectUploadPreview');
        const resultEl = document.getElementById('inspectPageResult');
        const url = URL.createObjectURL(file);
        if (preview) preview.innerHTML = `<img src="${url}" alt="上传图片">`;
        if (resultEl) resultEl.innerHTML = '<div class="inspect-page-result-empty"><span>⏳ 识别中...</span></div>';
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await fetch('/api/inspect/predict', { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.success) {
                if (resultEl) resultEl.innerHTML = `<div class="inspect-page-result-empty"><span>❌ ${data.message || '识别失败'}</span></div>`;
                return;
            }
            if (resultEl) resultEl.innerHTML = this._buildInspectResultHTML(data);
            this._addInspectHistory('上传图片', data);
        } catch (e) {
            if (resultEl) resultEl.innerHTML = '<div class="inspect-page-result-empty"><span>❌ 网络错误</span></div>';
        }
    }

    _updateCVHealthDots() {
        const dots = document.querySelectorAll('.cv-health-dot');
        dots.forEach(dot => {
            if (this._cvHealthy) {
                dot.className = 'cv-health-dot cv-health-online';
                dot.title = 'CV 模型在线';
            } else {
                dot.className = 'cv-health-dot cv-health-offline';
                dot.title = 'CV 模型离线';
            }
        });
    }

    async testCVLatency() {
        const el = document.getElementById('cvLatencyResult');
        if (el) el.innerHTML = '<span class="latency-testing">⏳ 测试中...</span>';
        try {
            const t0 = performance.now();
            const res = await fetch('/api/inspect/latency');
            const t1 = performance.now();
            const data = await res.json();
            const totalMs = (t1 - t0).toFixed(1);
            if (data.success) {
                const rtt = data.rtt_ms != null ? data.rtt_ms.toFixed(1) : 'N/A';
                const cls = data.rtt_ms < 10 ? 'latency-good' : data.rtt_ms < 50 ? 'latency-warn' : 'latency-slow';
                el.innerHTML = `
                    <div class="latency-result ${cls}">
                        <span class="latency-dot">●</span>
                        <span>服务端延迟 <strong>${rtt} ms</strong></span>
                    </div>
                    <div class="latency-meta">
                        <span>往返总耗时: ${totalMs} ms</span>
                        <span>${data.message || 'pong'}</span>
                    </div>
                `;
            } else {
                el.innerHTML = `<div class="latency-result latency-offline"><span class="latency-dot">●</span><span>${data.message || '测试失败'}</span></div>`;
            }
        } catch (e) {
            if (el) el.innerHTML = '<div class="latency-result latency-offline"><span class="latency-dot">●</span><span>网络错误</span></div>';
        }
    }

    _buildInspectResultHTML(data) {
        const anomalyClass = data.is_anomaly ? 'inspect-card-anomaly' : 'inspect-card-normal';
        const anomalyText = data.is_anomaly ? '⚠️ 异常' : '✅ 正常';
        return `
            <div class="inspect-grid ${anomalyClass}">
                <div class="inspect-header">
                    <span class="inspect-label-text">${data.label || 'N/A'}</span>
                    <span class="inspect-anomaly-badge">${anomalyText}</span>
                </div>
                <div class="inspect-row">
                    <span class="inspect-key">置信度</span>
                    <span class="inspect-val">${data.confidence != null ? data.confidence.toFixed(1) + '%' : 'N/A'}</span>
                </div>
                <div class="inspect-row">
                    <span class="inspect-key">重构误差</span>
                    <span class="inspect-val">${data.reconstruction_error != null ? data.reconstruction_error.toFixed(5) : 'N/A'}</span>
                </div>
                <div class="inspect-row">
                    <span class="inspect-key">阈值</span>
                    <span class="inspect-val">${data.threshold != null ? data.threshold.toFixed(4) : 'N/A'}</span>
                </div>
                ${data.quality ? `
                <div class="inspect-row">
                    <span class="inspect-key">清晰度</span>
                    <span class="inspect-val">${data.quality.sharpness != null ? data.quality.sharpness.toFixed(1) : 'N/A'}</span>
                </div>
                <div class="inspect-row">
                    <span class="inspect-key">边缘密度</span>
                    <span class="inspect-val">${data.quality.edge_density != null ? data.quality.edge_density.toFixed(2) : 'N/A'}</span>
                </div>
                <div class="inspect-row">
                    <span class="inspect-key">平均亮度</span>
                    <span class="inspect-val">${data.quality.mean_brightness != null ? data.quality.mean_brightness.toFixed(1) : 'N/A'}</span>
                </div>
                ` : ''}
                <div class="inspect-row">
                    <span class="inspect-key">处理耗时</span>
                    <span class="inspect-val">${data.processing_time_ms != null ? data.processing_time_ms.toFixed(1) + 'ms' : 'N/A'}</span>
                </div>
            </div>
        `;
    }

    // ==================== 文件管理 ====================

    renderFileManager() {
        this._selectedFile = null;
        this._fileTab = this._fileTab || 'storage';
        const allPrinters = this.printers;
        const select = document.getElementById('fmPrinterSelect');
        if (select) {
            select.innerHTML = '<option value="">选择打印机...</option>' +
                allPrinters.map(p => `<option value="${p.id}">${this.escapeHtml(p.name)} (${p.model})</option>`).join('');
            select.onchange = () => {
                this._selectedFmPrinter = select.value;
                this._updateFmPrinterStatus(select.value);
                document.getElementById('uploadBtn').disabled = !this._selectedFile;
                document.getElementById('uploadDirectBtn').disabled = !select.value || !this._selectedFile;
                if (select.value && this._fileTab === 'printer') {
                    this.loadPrinterFiles(select.value);
                }
                if (this._fileTab === 'storage') {
                    this.loadStorageFiles();
                }
            };
            if (select.value) {
                this._updateFmPrinterStatus(select.value);
            }
        }

        this.switchFileTab(this._fileTab);
        this.loadStorageFiles();

        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        if (uploadZone && fileInput) {
            uploadZone.onclick = () => fileInput.click();
            uploadZone.ondragover = (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); };
            uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
            uploadZone.ondrop = (e) => {
                e.preventDefault();
                uploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.handleFileSelect(e.dataTransfer.files[0]);
                }
            };
            fileInput.onchange = () => {
                if (fileInput.files.length > 0) {
                    this.handleFileSelect(fileInput.files[0]);
                }
            };
        }
    }

    _updateFmPrinterStatus(printerId) {
        const statusEl = document.getElementById('fmPrinterStatus');
        if (!statusEl) return;
        if (!printerId) {
            statusEl.textContent = '';
            statusEl.className = 'fm-printer-status';
            return;
        }
        const printer = this.printers.find(p => p.id === printerId);
        if (printer) {
            const isOnline = printer.status !== 'offline';
            statusEl.textContent = isOnline ? '在线' : '离线';
            statusEl.className = 'fm-printer-status ' + (isOnline ? 'online' : 'offline');
        }
    }

    handleFileSelect(file) {
        const validExts = ['.gcode', '.3mf', '.gcode.3mf'];
        const ext = '.' + file.name.split('.').slice(1).join('.');
        if (!validExts.some(v => file.name.endsWith(v))) {
            this.showToast('不支持的文件格式，请选择 .gcode / .3mf / .gcode.3mf 文件', 'error');
            return;
        }
        if (file.size > 200 * 1024 * 1024) {
            this.showToast('文件大小超过 200MB 限制', 'error');
            return;
        }
        this._selectedFile = file;
        document.getElementById('uploadBtn').disabled = !this._selectedFile;
        document.getElementById('uploadDirectBtn').disabled = !document.getElementById('fmPrinterSelect').value || !this._selectedFile;
        const zone = document.getElementById('uploadZone');
        zone.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:12px;color:var(--green);">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p style="color:var(--green);">${this.escapeHtml(file.name)}</p>
            <span>${(file.size / 1024 / 1024).toFixed(2)} MB · 点击重新选择</span>
        `;
    }

    _showUploadProgress() {
        const el = document.getElementById('uploadProgress');
        el.style.display = 'block';
        document.getElementById('uploadProgressFill').style.width = '0%';
        document.getElementById('uploadProgressPercent').textContent = '0%';
        document.getElementById('uploadProgressLabel').textContent = '准备上传...';
        document.getElementById('uploadProgressSize').textContent = '0 / 0 MB';
        document.getElementById('uploadProgressSpeed').textContent = '';
    }

    _updateUploadProgress(loaded, total, label) {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        document.getElementById('uploadProgressFill').style.width = percent + '%';
        document.getElementById('uploadProgressPercent').textContent = percent + '%';
        document.getElementById('uploadProgressLabel').textContent = label;
        const loadedMB = (loaded / 1024 / 1024).toFixed(1);
        if (total > 0) {
            const totalMB = (total / 1024 / 1024).toFixed(1);
            document.getElementById('uploadProgressSize').textContent = `${loadedMB} / ${totalMB} MB`;
        } else {
            document.getElementById('uploadProgressSize').textContent = `${loadedMB} MB`;
        }
        if (this._uploadStartTime && loaded > 0) {
            const elapsed = (Date.now() - this._uploadStartTime) / 1000;
            const speed = loaded / elapsed;
            const speedStr = speed > 1024 * 1024
                ? `${(speed / 1024 / 1024).toFixed(1)} MB/s`
                : `${(speed / 1024).toFixed(0)} KB/s`;
            document.getElementById('uploadProgressSpeed').textContent = speedStr;
        }
    }

    _finishUploadProgress(success, message) {
        document.getElementById('uploadProgressFill').style.width = success ? '100%' : '0%';
        document.getElementById('uploadProgressPercent').textContent = success ? '100%' : '失败';
        document.getElementById('uploadProgressLabel').textContent = message;
        document.getElementById('uploadProgressSpeed').textContent = '';
        setTimeout(() => {
            document.getElementById('uploadProgress').style.display = 'none';
        }, 3000);
    }

    _xhrUpload(url, formData, onSuccess) {
        this._uploadStartTime = Date.now();
        this._showUploadProgress();

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                this._updateUploadProgress(e.loaded, e.total, '上传中...');
            }
        });

        xhr.addEventListener('load', () => {
            try {
                const result = JSON.parse(xhr.responseText);
                if (result.success) {
                    this._updateUploadProgress(this._selectedFile.size, this._selectedFile.size, '上传完成');
                    this._finishUploadProgress(true, '上传成功');
                    this.showToast(result.message || '上传成功', 'success');
                    if (onSuccess) onSuccess(result);
                } else {
                    this._finishUploadProgress(false, '上传失败: ' + (result.message || '未知错误'));
                    this.showToast('上传失败: ' + (result.message || '未知错误'), 'error');
                }
            } catch (e) {
                this._finishUploadProgress(false, '响应解析失败');
                this.showToast('响应解析失败', 'error');
            }
        });

        xhr.addEventListener('error', () => {
            this._finishUploadProgress(false, '网络错误');
            this.showToast('上传失败: 网络错误', 'error');
        });

        xhr.addEventListener('abort', () => {
            this._finishUploadProgress(false, '已取消');
        });

        xhr.send(formData);
        return xhr;
    }

    uploadFile() {
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (!printerId || !this._selectedFile) return;

        const formData = new FormData();
        formData.append('file', this._selectedFile);

        document.getElementById('uploadBtn').disabled = true;
        document.getElementById('uploadDirectBtn').disabled = true;

        this._xhrUpload(`/api/printers/${printerId}/upload`, formData, () => {
            this.loadPrinterFiles(printerId);
        });
    }

    uploadToStorage() {
        if (!this._selectedFile) return;

        const formData = new FormData();
        formData.append('file', this._selectedFile);

        document.getElementById('uploadBtn').disabled = true;
        document.getElementById('uploadDirectBtn').disabled = true;

        this._xhrUpload('/api/storage/upload', formData, () => {
            this.loadStorageFiles();
            this._selectedFile = null;
            const zone = document.getElementById('uploadZone');
            zone.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:12px;opacity:0.5;">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>拖拽文件到此处或点击上传</p>
                <span>最大 200MB</span>
            `;
            document.getElementById('uploadBtn').disabled = true;
            document.getElementById('uploadDirectBtn').disabled = true;
        });
    }

    switchFileTab(tab) {
        this._fileTab = tab;
        document.querySelectorAll('.fm-tab-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.fm-tab-btn[data-tab="${tab}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        document.getElementById('storageTab').style.display = tab === 'storage' ? 'block' : 'none';
        document.getElementById('printerTab').style.display = tab === 'printer' ? 'block' : 'none';
        if (tab === 'printer') {
            const printerId = document.getElementById('fmPrinterSelect').value;
            if (printerId) {
                this.loadPrinterFiles(printerId);
            }
        }
    }

    async loadStorageFiles() {
        try {
            const res = await fetch('/api/storage/files');
            const files = await res.json();
            this.renderStorageFiles(files);
        } catch (e) {
            document.getElementById('storageFileList').innerHTML = `
                <div class="empty-state"><p>加载失败</p><span>${e.message}</span></div>
            `;
        }
    }

    renderStorageFiles(files) {
        const container = document.getElementById('storageFileList');
        if (!files || files.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    <p>暂无模型文件</p>
                    <span>上传 .gcode / .3mf 文件到服务器</span>
                </div>
            `;
            return;
        }
        container.innerHTML = files.map((f, i) => {
            const ext = f.ext.replace('.', '').toUpperCase();
            const icon = ext === 'GCODE' ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>` :
                `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
            const modified = new Date(f.modified * 1000).toLocaleString();
            return `
                <div class="fm-file-item">
                    <div class="fm-file-icon">${icon}</div>
                    <div class="fm-file-info">
                        <div class="fm-file-name" title="${this.escapeHtml(f.name)}">${this.escapeHtml(f.name)}</div>
                        <div class="fm-file-ext">${ext} · ${f.size_mb} MB · ${modified}</div>
                    </div>
                    <div class="fm-file-actions">
                        <button class="btn btn-sm btn-primary" onclick="manager.sendToPrinter('${this.escapeJs(f.name)}')" title="发送到打印机">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/></svg>
                        </button>
                        <button class="btn btn-sm btn-success" onclick="manager.startPrintFromStorage('${this.escapeJs(f.name)}')" title="发送并打印（设置参数）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="manager.quickPrintFromStorage('${this.escapeJs(f.name)}')" title="发送并快速打印（默认参数）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:8px;height:8px;margin-left:-2px;"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="manager.deleteStorageFile('${this.escapeJs(f.name)}')" title="删除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async sendToPrinter(filename) {
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (!printerId) {
            this.showToast('请先选择目标打印机', 'error');
            return;
        }
        try {
            const res = await fetch('/api/storage/send-to-printer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, printer_id: printerId }),
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`已发送 ${filename} 到打印机`, 'success');
            } else {
                this.showToast('发送失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('发送失败: 网络错误', 'error');
        }
    }

    async startPrintFromStorage(filename) {
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (!printerId) {
            this.showToast('请先选择目标打印机', 'error');
            return;
        }
        this._amsPrintPrinterId = printerId;
        this._amsPrintFilename = filename;
        this._amsPrintFromStorage = true;
        this.showAmsMappingModal(printerId, filename);
    }

    async quickPrintFromStorage(filename) {
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (!printerId) {
            this.showToast('请先选择目标打印机', 'error');
            return;
        }
        try {
            const res = await fetch('/api/storage/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    printer_id: printerId,
                    plate_number: 1,
                    use_ams: true,
                    ams_mapping: null,
                    flow_calibration: true,
                }),
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`已发送并开始打印: ${filename}`, 'success');
            } else {
                this.showToast('失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('失败: 网络错误', 'error');
        }
    }

    async deleteStorageFile(filename) {
        if (!confirm(`确定要删除服务器文件 "${filename}" 吗？`)) return;
        try {
            const res = await fetch(`/api/storage/files/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
            });
            const result = await res.json();
            if (result.success) {
                this.showToast('已删除服务器文件', 'success');
                this.loadStorageFiles();
            } else {
                this.showToast('删除失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('删除失败: 网络错误', 'error');
        }
    }

    async loadPrinterFiles(printerId) {
        try {
            const res = await fetch(`/api/printers/${printerId}/files`);
            const files = await res.json();
            this.renderFileList(files, printerId);
        } catch (e) {
            document.getElementById('fmFileList').innerHTML = `
                <div class="empty-state"><p>加载失败</p><span>${e.message}</span></div>
            `;
        }
    }

    renderFileList(files, printerId) {
        const container = document.getElementById('fmFileList');
        if (!files || files.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    <p>打印机上没有文件</p>
                    <span>上传 .gcode 或 .3mf 文件到打印机</span>
                </div>
            `;
            return;
        }
        container.innerHTML = files.map(f => {
            const ext = f.split('.').slice(-1)[0].toUpperCase();
            const isGcode = f.endsWith('.gcode') || f.endsWith('.gcode.3mf');
            const icon = isGcode ? '📄' : '📦';
            return `
                <div class="fm-file-item">
                    <div class="fm-file-icon">${icon}</div>
                    <div class="fm-file-info">
                        <div class="fm-file-name" title="${this.escapeHtml(f)}">${this.escapeHtml(f)}</div>
                        <div class="fm-file-ext">${ext}</div>
                    </div>
                    <div class="fm-file-actions">
                        <button class="btn btn-sm btn-success" onclick="manager.startPrint('${printerId}', '${this.escapeJs(f)}')" title="打印（设置参数）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="manager.quickPrint('${printerId}', '${this.escapeJs(f)}')" title="快速打印（默认参数）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:8px;height:8px;margin-left:-2px;"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="manager.deleteFile('${printerId}', '${this.escapeJs(f)}')" title="删除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async startPrint(printerId, filename) {
        this._amsPrintPrinterId = printerId;
        this._amsPrintFilename = filename;
        this._amsPrintFromStorage = false;
        this.showAmsMappingModal(printerId, filename);
    }

    showAmsMappingModal(printerId, filename) {
        document.getElementById('amsFilename').textContent = filename;
        document.getElementById('amsPlateNumber').value = 1;
        document.getElementById('amsUseAms').checked = true;
        document.getElementById('amsFlowCalibration').checked = true;

        const printer = this.printers.find(p => p.id === printerId);
        const traysContainer = document.getElementById('amsMappingTrays');
        if (printer && printer.ams_units && printer.ams_units.length > 0) {
            let html = '<div class="ams-tray-grid">';
            printer.ams_units.forEach((tray, idx) => {
                const trayNum = tray.tray_id || (idx + 1);
                html += `
                    <div class="ams-tray-item">
                        <div class="ams-tray-swatch" style="background:${tray.color || '#CCC'};"></div>
                        <div class="ams-tray-info">
                            <span class="ams-tray-id">槽位 ${trayNum}</span>
                            <span class="ams-tray-mat">${this.escapeHtml(tray.material || '?')}</span>
                        </div>
                        <select class="form-input ams-tray-select" data-tray="${trayNum}" style="width:70px;padding:4px 8px;font-size:12px;">
                            <option value="0">不使用</option>`;
                for (let i = 1; i <= 4; i++) {
                    html += `<option value="${i}" ${i === idx + 1 ? 'selected' : ''}>耗材${i}</option>`;
                }
                html += `</select></div>`;
            });
            html += '</div>';
            html += '<span style="font-size:11px;color:var(--text-muted);">将 AMS 槽位映射到 G-code 中的耗材编号</span>';
            traysContainer.innerHTML = html;
        } else {
            traysContainer.innerHTML = '<div class="empty-state" style="padding:12px;"><p>无 AMS 数据</p><span>该打印机可能未安装 AMS</span></div>';
        }
        document.getElementById('amsMappingModal').classList.add('active');
    }

    async quickPrint(printerId, filename) {
        this.showToast('正在启动打印...', 'info');
        try {
            const url = `/api/printers/${printerId}/print`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    printer_id: printerId,
                    plate_number: 1,
                    use_ams: true,
                    ams_mapping: null,
                    flow_calibration: true,
                }),
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`已开始打印: ${filename}`, 'success');
            } else {
                this.showToast('启动失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('启动失败: 网络错误', 'error');
        }
    }

    async confirmStartPrint() {
        const printerId = this._amsPrintPrinterId;
        const filename = this._amsPrintFilename;
        const fromStorage = this._amsPrintFromStorage;
        if (!printerId || !filename) return;

        const plateNumber = parseInt(document.getElementById('amsPlateNumber').value) || 1;
        const useAms = document.getElementById('amsUseAms').checked;
        const flowCalibration = document.getElementById('amsFlowCalibration').checked;

        const traySelects = document.querySelectorAll('.ams-tray-select');
        const amsMapping = [];
        traySelects.forEach(sel => {
            const val = parseInt(sel.value);
            if (val > 0) amsMapping.push(val);
        });

        const confirmBtn = document.getElementById('amsConfirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '正在启动...';
        }

        try {
            const url = fromStorage
                ? '/api/storage/print'
                : `/api/printers/${printerId}/print`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    printer_id: fromStorage ? printerId : undefined,
                    plate_number: plateNumber,
                    use_ams: useAms,
                    ams_mapping: amsMapping.length > 0 ? amsMapping : null,
                    flow_calibration: flowCalibration,
                }),
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`开始打印: ${filename}`, 'success');
                closeAmsMappingModal();
            } else {
                this.showToast('启动失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('启动失败: 网络错误', 'error');
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '开始打印';
            }
        }
    }

    async deleteFile(printerId, filename) {
        if (!confirm(`确定要删除 "${filename}" 吗？`)) return;
        try {
            const res = await fetch(`/api/printers/${printerId}/files/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`已删除: ${filename}`, 'success');
                this.loadPrinterFiles(printerId);
            } else {
                this.showToast('删除失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('删除失败: 网络错误', 'error');
        }
    }

    refreshFiles() {
        if (this._fileTab === 'printer') {
            const printerId = document.getElementById('fmPrinterSelect').value;
            if (printerId) {
                this.loadPrinterFiles(printerId);
            }
        } else {
            this.loadStorageFiles();
        }
    }

    // ==================== 赛场工具 ====================

    async refreshDrives() {
        const select = document.getElementById('compDriveSelect');
        const info = document.getElementById('compDriveInfo');
        select.innerHTML = '<option value="">检测中...</option>';
        try {
            const res = await fetch('/api/competition/drives');
            const data = await res.json();
            if (!data.success || !data.drives || data.drives.length === 0) {
                select.innerHTML = '<option value="">未检测到 SD 卡</option>';
                info.style.display = 'none';
                return;
            }
            select.innerHTML = '<option value="">选择 SD 卡...</option>';
            data.drives.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.DeviceID + '\\';
                opt.textContent = `${d.DeviceID} ${d.VolumeName || 'SD Card'} (${d.FreeSpaceGB} GB 可用 / ${d.SizeGB} GB)`;
                select.appendChild(opt);
            });
            select.onchange = () => {
                const sel = select.options[select.selectedIndex];
                if (select.value) {
                    info.style.display = 'block';
                    info.textContent = sel.textContent;
                } else {
                    info.style.display = 'none';
                }
                this._updateExportBtn();
            };
        } catch (e) {
            select.innerHTML = '<option value="">检测失败，请重试</option>';
        }
    }

    async loadCompFiles() {
        const container = document.getElementById('compFileList');
        try {
            const res = await fetch('/api/storage/files');
            const files = await res.json();
            if (!Array.isArray(files) || files.length === 0) {
                container.innerHTML = '<span class="text-muted">服务器没有文件</span>';
                return;
            }
            container.innerHTML = '';
            files.forEach(f => {
                const div = document.createElement('label');
                div.className = 'comp-file-item';
                const sizeMB = (f.size / 1024 / 1024).toFixed(1);
                div.innerHTML = `
                    <input type="checkbox" value="${this._escapeHtml(f.name)}" onchange="manager._updateExportBtn()">
                    <span>${this._escapeHtml(f.name)}</span>
                    <span class="file-size">${sizeMB} MB</span>
                `;
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<span class="text-muted">加载失败</span>';
        }
    }

    _updateExportBtn() {
        const drive = document.getElementById('compDriveSelect').value;
        const checked = document.querySelectorAll('#compFileList input[type="checkbox"]:checked');
        const btn = document.getElementById('compExportBtn');
        btn.disabled = !drive || checked.length === 0;
    }

    toggleAllCompFiles() {
        const checkboxes = document.querySelectorAll('#compFileList input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => { cb.checked = !allChecked; });
        this._updateExportBtn();
    }

    async exportToSD() {
        const drive = document.getElementById('compDriveSelect').value;
        const checkboxes = document.querySelectorAll('#compFileList input[type="checkbox"]:checked');
        const filenames = Array.from(checkboxes).map(cb => cb.value);
        const resultEl = document.getElementById('compExportResult');
        const btn = document.getElementById('compExportBtn');

        const targetPath = this._getExportPathSetting();

        btn.disabled = true;
        btn.textContent = '导出中...';
        resultEl.style.display = 'block';
        resultEl.className = 'comp-export-result';
        resultEl.innerHTML = '正在导出文件到 SD 卡...';

        try {
            const res = await fetch('/api/competition/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ drive, filenames, target_path: targetPath }),
            });
            const data = await res.json();
            if (data.success) {
                let html = `<strong>${data.message}</strong> (${data.total_size_mb} MB)`;
                if (data.copied.length > 0) {
                    html += '<ul class="result-list">';
                    data.copied.forEach(f => {
                        html += `<li>✓ ${f.name} (${f.size_mb} MB)</li>`;
                    });
                    html += '</ul>';
                }
                if (data.failed.length > 0) {
                    html += '<ul class="result-list">';
                    data.failed.forEach(f => {
                        html += `<li>✗ ${f.name}: ${f.reason}</li>`;
                    });
                    html += '</ul>';
                }
                resultEl.innerHTML = html;
                resultEl.className = 'comp-export-result success';
                resultEl.innerHTML += `<p style="margin-top:8px;font-size:11px;">文件已导出到: ${data.export_dir}</p>`;
                this.showToast('导出完成', 'success');
            } else {
                resultEl.innerHTML = `导出失败: ${data.message}`;
                resultEl.className = 'comp-export-result error';
                this.showToast('导出失败', 'error');
            }
        } catch (e) {
            resultEl.innerHTML = '导出失败: 网络错误';
            resultEl.className = 'comp-export-result error';
            this.showToast('导出失败', 'error');
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出到 SD 卡`;
    }

    async runHealthCheck() {
        const resultEl = document.getElementById('compHealthResult');
        const btn = document.getElementById('compHealthBtn');
        btn.disabled = true;
        resultEl.innerHTML = '检查中...';
        try {
            const res = await fetch('/api/competition/health');
            const data = await res.json();
            let html = `<p style="margin-bottom:8px;"><strong>打印机:</strong> ${data.healthy_printers}/${data.total_printers} 正常 | <strong>服务器文件:</strong> ${data.storage_files} 个</p>`;
            data.printers.forEach(p => {
                const statusClass = p.healthy ? 'healthy' : 'unhealthy';
                const statusText = p.healthy ? '正常' : '异常';
                html += `<div class="health-item">
                    <span class="health-status ${statusClass}"></span>
                    <span>${p.name}</span>
                    <span class="health-detail">${statusText}${p.issues.length > 0 ? ': ' + p.issues.join(', ') : ''}</span>
                </div>`;
            });
            resultEl.innerHTML = html;
        } catch (e) {
            resultEl.innerHTML = '检查失败: 网络错误';
        }
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>开始检查`;
    }

    saveChecklist() {
        const checkboxes = document.querySelectorAll('#compChecklist input[type="checkbox"]');
        const state = [];
        checkboxes.forEach((cb, i) => { state.push(cb.checked); });
        try {
            localStorage.setItem('xploreprint_checklist', JSON.stringify(state));
        } catch (e) { /* ignore */ }
    }

    loadChecklist() {
        try {
            const state = JSON.parse(localStorage.getItem('xploreprint_checklist'));
            if (!state) return;
            const checkboxes = document.querySelectorAll('#compChecklist input[type="checkbox"]');
            checkboxes.forEach((cb, i) => {
                if (i < state.length) cb.checked = state[i];
            });
        } catch (e) { /* ignore */ }
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== 工具箱 ====================

    _toolboxCurrentPath = '/';

    _getDefaultToolboxTree() {
        return {
            type: 'folder',
            name: '根目录',
            children: [
                {
                    type: 'folder',
                    name: '打印机',
                    children: [
                        { type: 'link', name: 'Bambu Wiki - H2S', url: 'https://wiki.bambulab.com/zh/h2s' },
                        { type: 'link', name: 'Bambu Wiki - P2P', url: 'https://wiki.bambulab.com/zh/p2s' },
                        { type: 'link', name: 'Bambu Wiki - A1', url: 'https://wiki.bambulab.com/zh/a1' },
                        { type: 'link', name: 'Bambu Wiki - P1P/P1S', url: 'https://wiki.bambulab.com/zh/p1' },
                        { type: 'link', name: 'Bambu Wiki - X1', url: 'https://wiki.bambulab.com/zh/x1' },
                    ]
                }
            ]
        };
    }

    _getToolboxTree() {
        try {
            const saved = localStorage.getItem('xploreprint_toolbox_tree');
            if (saved) {
                const tree = JSON.parse(saved);
                return tree && tree.type === 'folder' ? tree : null;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    _saveToolboxTree(tree) {
        try {
            localStorage.setItem('xploreprint_toolbox_tree', JSON.stringify(tree));
        } catch (e) { /* ignore */ }
    }

    _ensureToolboxTree() {
        let tree = this._getToolboxTree();
        if (!tree) {
            tree = this._getDefaultToolboxTree();
            this._saveToolboxTree(tree);
        }
        return tree;
    }

    _findFolderByPath(tree, path) {
        if (path === '/' || path === '') return tree;
        const parts = path.split('/').filter(p => p);
        let current = tree;
        for (const part of parts) {
            if (!current.children) return null;
            const found = current.children.find(c => c.type === 'folder' && c.name === part);
            if (!found) return null;
            current = found;
        }
        return current;
    }

    _pathToFolder(path) {
        const parts = path.split('/').filter(p => p);
        if (parts.length === 0) return '根目录';
        return parts[parts.length - 1];
    }

    renderToolbox() {
        const tree = this._ensureToolboxTree();
        const folder = this._findFolderByPath(tree, this._toolboxCurrentPath);
        if (!folder) {
            this._toolboxCurrentPath = '/';
            return this.renderToolbox();
        }

        this._renderToolboxBreadcrumb();
        document.getElementById('toolboxLinkFolder').value = this._toolboxCurrentPath || '/';

        const container = document.getElementById('toolboxGrid');
        const query = (document.getElementById('toolboxSearch')?.value || '').trim().toLowerCase();
        container.innerHTML = '';

        const items = folder.children || [];
        const filtered = query
            ? this._searchToolboxItems(tree, query)
            : items;

        if (query) {
            this._renderToolboxBreadcrumbSearch(query);
        }

        if (filtered.length === 0) {
            container.innerHTML = `<div class="toolbox-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin:0 auto 12px;">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                ${query ? '没有匹配的结果' : '此文件夹为空'}
            </div>`;
            return;
        }

        const sorted = [...filtered].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        sorted.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'toolbox-item' + (item.type === 'folder' ? ' folder' : '');

            let iconHtml = '';
            if (item.type === 'folder') {
                const count = (item.children || []).length;
                iconHtml = `<div class="toolbox-item-icon folder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                </div>`;
                div.onclick = () => this.enterToolboxFolder(this._toolboxCurrentPath + (this._toolboxCurrentPath === '/' ? '' : '/') + item.name);
            } else {
                const isWiki = item.name.toLowerCase().includes('wiki');
                const iconClass = isWiki ? 'wiki' : 'link';
                const initial = (item.name.match(/[A-Za-z\u4e00-\u9fff]/) || ['T'])[0];
                iconHtml = `<div class="toolbox-item-icon ${iconClass}">${initial}</div>`;
                div.style.cursor = 'pointer';
                div.onclick = () => window.open(item.url, '_blank');
            }

            const subText = item.type === 'folder'
                ? `${(item.children || []).length} 项`
                : (item.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');

            div.innerHTML = `
                ${iconHtml}
                <div class="toolbox-item-info">
                    <div class="toolbox-item-name">${this._escapeHtml(item.name)}</div>
                    <div class="toolbox-item-sub">${this._escapeHtml(subText)}</div>
                </div>
                <div class="toolbox-item-actions" onclick="event.stopPropagation();">
                    <button class="toolbox-item-delete" title="删除" onclick="manager.deleteToolboxItem('${this._escapeHtml(item.name)}')">×</button>
                </div>
            `;
            container.appendChild(div);
        });
    }

    _searchToolboxItems(tree, query) {
        const results = [];
        const walk = (node, path) => {
            if (!node || !node.children) return;
            for (const child of node.children) {
                const childPath = path + '/' + child.name;
                if (child.name.toLowerCase().includes(query) || (child.url && child.url.toLowerCase().includes(query))) {
                    results.push({ ...child, _path: childPath });
                }
                if (child.type === 'folder') {
                    walk(child, childPath);
                }
            }
        };
        walk(tree, '');
        return results;
    }

    _renderToolboxBreadcrumb() {
        const container = document.getElementById('toolboxBreadcrumb');
        const parts = this._toolboxCurrentPath.split('/').filter(p => p);
        let html = '';
        let accumulated = '';
        html += `<span class="breadcrumb-item${this._toolboxCurrentPath === '/' ? ' current' : ''}" data-path="/" onclick="manager.enterToolboxFolder('/')">根目录</span>`;
        for (const part of parts) {
            accumulated += '/' + part;
            html += `<span class="breadcrumb-sep">/</span>`;
            const isLast = accumulated === this._toolboxCurrentPath;
            html += `<span class="breadcrumb-item${isLast ? ' current' : ''}" data-path="${accumulated}" onclick="manager.enterToolboxFolder('${accumulated}')">${this._escapeHtml(part)}</span>`;
        }
        container.innerHTML = html;
    }

    _renderToolboxBreadcrumbSearch(query) {
        const container = document.getElementById('toolboxBreadcrumb');
        container.innerHTML = `<span class="breadcrumb-item current">搜索: "${this._escapeHtml(query)}"</span>
            <span class="breadcrumb-item" onclick="manager.clearToolboxSearch()" style="color:var(--accent-blue);">✕ 清除</span>`;
    }

    enterToolboxFolder(path) {
        this._toolboxCurrentPath = path;
        document.getElementById('toolboxSearch').value = '';
        this.renderToolbox();
    }

    onToolboxSearch() {
        this.renderToolbox();
    }

    clearToolboxSearch() {
        document.getElementById('toolboxSearch').value = '';
        this.renderToolbox();
    }

    openAddToolboxLinkModal() {
        document.getElementById('toolboxLinkFolder').value = this._toolboxCurrentPath || '/';
        document.getElementById('toolboxLinkModal').classList.add('active');
    }

    addToolboxLink(event) {
        if (event) event.preventDefault();
        const name = document.getElementById('toolboxLinkName').value.trim();
        let url = document.getElementById('toolboxLinkUrl').value.trim();
        const folderPath = document.getElementById('toolboxLinkFolder').value;

        if (!name || !url) {
            this.showToast('请填写名称和链接', 'error');
            return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const tree = this._ensureToolboxTree();
        const folder = this._findFolderByPath(tree, folderPath);
        if (!folder) {
            this.showToast('目标文件夹不存在', 'error');
            return;
        }
        if (!folder.children) folder.children = [];

        const exists = folder.children.some(c => c.type === 'link' && c.name === name);
        if (exists) {
            this.showToast('该名称已存在', 'error');
            return;
        }

        folder.children.push({ type: 'link', name, url });
        this._saveToolboxTree(tree);
        this.renderToolbox();
        closeToolboxLinkModal();
        this.showToast('添加成功', 'success');
    }

    createToolboxFolder() {
        const name = prompt('输入文件夹名称:');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();

        const tree = this._ensureToolboxTree();
        const folder = this._findFolderByPath(tree, this._toolboxCurrentPath);
        if (!folder) return;
        if (!folder.children) folder.children = [];

        const exists = folder.children.some(c => c.type === 'folder' && c.name === trimmed);
        if (exists) {
            this.showToast('该文件夹已存在', 'error');
            return;
        }

        folder.children.push({ type: 'folder', name: trimmed, children: [] });
        this._saveToolboxTree(tree);
        this.renderToolbox();
        this.showToast('文件夹已创建', 'success');
    }

    deleteToolboxItem(name) {
        if (!confirm(`确定删除 "${name}" 吗？如果是文件夹，其中的所有内容也会被删除。`)) return;
        const tree = this._ensureToolboxTree();
        const folder = this._findFolderByPath(tree, this._toolboxCurrentPath);
        if (!folder || !folder.children) return;
        folder.children = folder.children.filter(c => c.name !== name);
        this._saveToolboxTree(tree);
        this.renderToolbox();
        this.showToast(`已删除: ${name}`, 'success');
    }

    // ==================== 设置 ====================

    _getExportPathSetting() {
        try {
            return localStorage.getItem('xploreprint_export_path') || 'XplorePrint';
        } catch (e) {
            return 'XplorePrint';
        }
    }

    loadExportPathSetting() {
        const el = document.getElementById('exportPathSetting');
        if (el) {
            el.value = this._getExportPathSetting();
        }
    }

    saveExportPathSetting() {
        const el = document.getElementById('exportPathSetting');
        const value = (el?.value || '').trim();
        if (!value) {
            this.showToast('路径不能为空', 'error');
            return;
        }
        try {
            localStorage.setItem('xploreprint_export_path', value);
            this.showToast('导出路径已保存', 'success');
        } catch (e) {
            this.showToast('保存失败', 'error');
        }
    }

    async loadTeamInfo() {
        const el = document.getElementById('teamInfoMarkdown');
        if (!el) return;
        try {
            const res = await fetch('/api/team-info');
            const data = await res.json();
            if (data.success) {
                el.innerHTML = data.html;
            } else {
                el.innerHTML = '<p class="text-muted">队伍信息加载失败</p>';
            }
        } catch (e) {
            el.innerHTML = '<p class="text-muted">队伍信息加载失败</p>';
        }
    }

    // ==================== G3D - Git for 3D Prints ====================

    _g3dProjectId = null;

    async loadG3DProjects() {
        const list = document.getElementById('g3dProjectList');
        list.innerHTML = '<div class="empty-state"><div class="loading-spinner"><div class="spinner-dot"></div><div class="spinner-dot"></div><div class="spinner-dot"></div></div><p>加载中...</p></div>';
        try {
            const res = await fetch('/api/g3d/projects');
            const projects = await res.json();
            if (!projects.length) {
                list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg><p>暂无项目</p><span>创建第一个项目来管理你的3D打印和CAD文件</span></div>';
                return;
            }
            list.innerHTML = projects.map(p => `
                <div class="g3d-project-card" onclick="manager.g3dOpenProject('${p.id}')">
                    <div class="g3d-project-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    </div>
                    <div class="g3d-project-info">
                        <div class="g3d-project-name">${this._escapeHtml(p.name)}<span class="g3d-visibility-badge">${p.visibility === 'private' ? 'Private' : 'Public'}</span></div>
                        <div class="g3d-project-desc">${this._escapeHtml(p.description || '暂无描述')}</div>
                        ${(p.tags && p.tags.length) ? `<div class="g3d-project-tags">${p.tags.map(t => `<span class="g3d-project-tag">${this._escapeHtml(t)}</span>`).join('')}</div>` : ''}
                    </div>
                    <div class="g3d-project-meta">
                        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${p.file_count || 0}</span>
                        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${p.commit_count || 0}</span>
                    </div>
                    <div class="g3d-project-date">${this._formatDate(p.updated_at)}</div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = '<div class="empty-state"><p>加载失败</p><span>请检查服务器连接</span></div>';
        }
    }

    async g3dOpenProject(projectId) {
        this._g3dProjectId = projectId;
        document.getElementById('g3dContent').style.display = 'none';
        document.getElementById('g3dDetail').style.display = 'block';
        try {
            const res = await fetch(`/api/g3d/projects/${projectId}`);
            const project = await res.json();
            document.getElementById('g3dDetailName').textContent = project.name;
            document.getElementById('g3dDetailDesc').textContent = project.description || '';
            const badge = document.getElementById('g3dVisibilityBadge');
            badge.textContent = project.visibility === 'private' ? 'Private' : 'Public';
            badge.className = 'g3d-visibility-badge' + (project.visibility === 'private' ? ' private' : '');
            document.getElementById('g3dStatFiles').textContent = project.file_count || 0;
            document.getElementById('g3dStatCommits').textContent = project.commit_count || 0;
            document.getElementById('g3dStatBranch').textContent = project.default_branch || 'main';
            const updatedSpan = document.querySelector('#g3dStatUpdated span');
            if (updatedSpan) updatedSpan.textContent = this._formatDate(project.updated_at);
            this._renderG3DTags(project.tags || []);
            this._renderG3DFiles(project.files || []);
            this._renderG3DCommits(project.commits || []);
            this._renderG3DStaging();
            this._renderG3DReadme(project.readme || '');
            this._renderG3DAssembly(project.assemblies || []);
        } catch (e) {
            this.showToast('加载项目失败', 'error');
        }
    }

    g3dBackToList() {
        this._g3dProjectId = null;
        document.getElementById('g3dContent').style.display = 'block';
        document.getElementById('g3dDetail').style.display = 'none';
        this.loadG3DProjects();
    }

    showG3DCreateProject() {
        const name = prompt('请输入项目名称：');
        if (!name || !name.trim()) return;
        const desc = prompt('请输入项目描述（可选）：') || '';
        this._g3dCreateProject(name.trim(), desc.trim());
    }

    async _g3dCreateProject(name, description) {
        try {
            const res = await fetch('/api/g3d/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description }),
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('项目创建成功', 'success');
                this.loadG3DProjects();
            } else {
                this.showToast(data.message || '创建失败', 'error');
            }
        } catch (e) {
            this.showToast('创建失败', 'error');
        }
    }

    async g3dDeleteCurrentProject() {
        if (!this._g3dProjectId) return;
        const key = prompt('⚠️ 删除项目需要管理员密钥，请输入密钥:');
        if (!key) return;
        if (!confirm('确定要删除此项目吗？所有文件和提交历史将被永久删除。此操作不可撤销！')) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_key: key })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('项目已删除', 'success');
                this.g3dBackToList();
            } else {
                this.showToast(data.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    async _g3dEditProject() {
        const name = document.getElementById('g3dDetailName').textContent;
        const desc = document.getElementById('g3dDetailDesc').textContent;
        const newName = prompt('项目名称:', name);
        if (!newName || !newName.trim()) return;
        const newDesc = prompt('项目描述:', desc || '');
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim(), description: (newDesc || '').trim() })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('项目已更新', 'success');
                this.g3dOpenProject(this._g3dProjectId);
            } else {
                this.showToast(data.message || '更新失败', 'error');
            }
        } catch (e) {
            this.showToast('更新失败', 'error');
        }
    }

    g3dTriggerUpload() {
        document.getElementById('g3dFileInput').click();
    }

    async g3dHandleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/upload`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json();
                if (!data.success) {
                    this.showToast(`上传 ${file.name} 失败: ${data.message}`, 'error');
                }
            } catch (e) {
                this.showToast(`上传 ${file.name} 失败`, 'error');
            }
        }
        event.target.value = '';
        this._renderG3DStaging();
    }

    async _renderG3DStaging() {
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/staging`);
            const files = await res.json();
            const container = document.getElementById('g3dStagingFiles');
            const actions = document.getElementById('g3dStagingActions');
            if (!files.length) {
                container.innerHTML = '';
                actions.style.display = 'none';
                return;
            }
            actions.style.display = 'flex';
            container.innerHTML = files.map(f => `
                <div class="g3d-staging-file">
                    <span class="file-name">${this._escapeHtml(f.name)}</span>
                    <span class="file-size">${this._formatFileSize(f.size)}</span>
                    <span class="file-remove" onclick="event.stopPropagation();manager._g3dRemoveStagingFile('${f.name}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </span>
                </div>
            `).join('');
        } catch (e) {
            /* ignore */
        }
    }

    async _g3dRemoveStagingFile(filename) {
        try {
            await fetch(`/api/g3d/projects/${this._g3dProjectId}/staging/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            this._renderG3DStaging();
        } catch (e) {
            /* ignore */
        }
    }

    async g3dClearStaging() {
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/staging`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                this.showToast(`已清除 ${data.cleared} 个暂存文件`, 'info');
                this._renderG3DStaging();
            }
        } catch (e) {
            this.showToast('清除失败', 'error');
        }
    }

    async g3dCommit() {
        const message = document.getElementById('g3dCommitMessage').value.trim();
        if (!message) {
            this.showToast('请输入提交信息', 'warning');
            return;
        }
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/commits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('提交成功', 'success');
                document.getElementById('g3dCommitMessage').value = '';
                this._renderG3DStaging();
                this.g3dOpenProject(this._g3dProjectId);
            } else {
                this.showToast(data.message || '提交失败', 'error');
            }
        } catch (e) {
            this.showToast('提交失败', 'error');
        }
    }

    _renderG3DFiles(files) {
        const list = document.getElementById('g3dFileList');
        if (!files.length) {
            list.innerHTML = '<div class="empty-state" style="padding:20px;"><span style="font-size:12px;">暂无文件，请在暂存区上传并提交</span></div>';
            return;
        }
        list.innerHTML = files.map(f => {
            const ext = (f.ext || '').replace('.', '');
            return `
                <div class="g3d-file-item">
                    <div class="g3d-file-icon ${ext}">${ext.toUpperCase().substring(0, 3)}</div>
                    <div class="g3d-file-info">
                        <div class="g3d-file-name">${this._escapeHtml(f.name)}</div>
                        <div class="g3d-file-meta">${this._formatFileSize(f.size)}</div>
                    </div>
                    <div class="g3d-file-actions">
                        <a class="g3d-file-download" href="/api/g3d/projects/${this._g3dProjectId}/download/${encodeURIComponent(f.name)}" title="下载">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                        <button class="g3d-file-delete" onclick="event.preventDefault();manager._g3dDeleteFile('${this._escapeHtml(f.name).replace(/'/g, "\\'")}')" title="删除文件">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    _renderG3DCommits(commits) {
        const list = document.getElementById('g3dCommitList');
        if (!commits.length) {
            list.innerHTML = '<div class="empty-state" style="padding:20px;"><span style="font-size:12px;">暂无提交历史</span></div>';
            return;
        }
        list.innerHTML = commits.map(c => `
            <div class="g3d-commit-item">
                <div class="g3d-commit-dot"></div>
                <div class="g3d-commit-body">
                    <div class="g3d-commit-message">${this._escapeHtml(c.message)}</div>
                    <div class="g3d-commit-meta">
                        <span class="g3d-commit-id" title="${c.id}">${c.id}</span>
                        <span>${this._formatDate(c.timestamp)}</span>
                        <span>${c.file_count || 0} 个文件</span>
                    </div>
                    ${c.files && c.files.length ? `
                    <div class="g3d-commit-files">
                        ${c.files.map(fn => `<span class="g3d-commit-file-tag" onclick="event.stopPropagation();window.open('/api/g3d/projects/${this._g3dProjectId}/download/${encodeURIComponent(fn)}?commit_id=${c.id}')">${this._escapeHtml(fn)}</span>`).join('')}
                    </div>
                    ` : ''}
                    <div class="g3d-commit-actions">
                        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();manager._g3dDeleteCommit('${c.id}')">删除</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async _g3dDeleteCommit(commitId) {
        const key = prompt('⚠️ 删除提交需要管理员密钥，请输入密钥:');
        if (!key) return;
        if (!confirm('确定要删除此提交吗？')) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/commits/${commitId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_key: key })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('提交已删除', 'success');
                this.g3dOpenProject(this._g3dProjectId);
            } else {
                this.showToast(data.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    async _g3dDeleteFile(filename) {
        const key = prompt('⚠️ 删除文件需要管理员密钥，请输入密钥:');
        if (!key) return;
        if (!confirm(`确定要删除文件 "${filename}" 吗？此操作不可撤销。`)) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/files/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_key: key })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('文件已删除', 'success');
                this.g3dOpenProject(this._g3dProjectId);
            } else {
                this.showToast(data.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    _g3dFilterProjects(query) {
        const q = (query || '').toLowerCase();
        document.querySelectorAll('.g3d-project-card').forEach(card => {
            const name = (card.querySelector('.g3d-project-name')?.textContent || '').toLowerCase();
            const desc = (card.querySelector('.g3d-project-desc')?.textContent || '').toLowerCase();
            card.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none';
        });
    }

    _renderG3DTags(tags) {
        const row = document.getElementById('g3dTagsRow');
        if (!row) return;
        let html = (tags || []).map(t => `
            <span class="g3d-tag">${this._escapeHtml(t)}<span class="g3d-tag-remove" onclick="manager._g3dRemoveTag('${this._escapeHtml(t).replace(/'/g, "\\'")}')">&times;</span></span>
        `).join('');
        html += '<span class="g3d-tag-add" onclick="manager._g3dAddTag()">+ 添加标签</span>';
        row.innerHTML = html;
    }

    async _g3dRemoveTag(tag) {
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}`);
            const project = await res.json();
            const tags = (project.tags || []).filter(t => t !== tag);
            await fetch(`/api/g3d/projects/${this._g3dProjectId}/tags`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags })
            });
            this._renderG3DTags(tags);
        } catch (e) {
            /* ignore */
        }
    }

    async _g3dAddTag() {
        const tag = prompt('输入新标签:');
        if (!tag || !tag.trim()) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}`);
            const project = await res.json();
            const tags = [...(project.tags || []), tag.trim()];
            await fetch(`/api/g3d/projects/${this._g3dProjectId}/tags`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags })
            });
            this._renderG3DTags(tags);
        } catch (e) {
            /* ignore */
        }
    }

    _renderG3DReadme(readme) {
        const area = document.getElementById('g3dReadmeArea');
        if (!area) return;
        if (readme) {
            area.innerHTML = `
                <div class="g3d-readme-content" id="g3dReadmeContent">${this._parseMarkdown(readme)}</div>
                <div style="margin-top:8px;" id="g3dReadmeEditBtn">
                    <button class="btn btn-outline btn-sm" onclick="manager._g3dEditReadme()">编辑 README</button>
                </div>
                <div class="g3d-readme-edit" style="display:none;" id="g3dReadmeEdit">
                    <textarea class="form-control" id="g3dReadmeTextarea" rows="10" style="width:100%;">${this._escapeHtml(readme)}</textarea>
                    <div style="margin-top:8px;display:flex;gap:6px;">
                        <button class="btn btn-primary btn-sm" onclick="manager._g3dSaveReadme()">保存</button>
                        <button class="btn btn-outline btn-sm" onclick="manager._g3dCancelReadme()">取消</button>
                    </div>
                </div>
            `;
        } else {
            area.innerHTML = `
                <div class="g3d-readme-empty">
                    <p>暂无 README 说明</p>
                    <p style="font-size:11px;">添加 README 来介绍你的项目</p>
                    <button class="btn btn-outline btn-sm" onclick="manager._g3dEditReadme()">添加 README</button>
                </div>
                <div class="g3d-readme-edit" style="display:none;" id="g3dReadmeEdit">
                    <textarea class="form-control" id="g3dReadmeTextarea" rows="10" style="width:100%;" placeholder="用 Markdown 编写项目说明..."></textarea>
                    <div style="margin-top:8px;display:flex;gap:6px;">
                        <button class="btn btn-primary btn-sm" onclick="manager._g3dSaveReadme()">保存</button>
                        <button class="btn btn-outline btn-sm" onclick="manager._g3dCancelReadme()">取消</button>
                    </div>
                </div>
            `;
        }
    }

    _g3dEditReadme() {
        const content = document.getElementById('g3dReadmeContent');
        const edit = document.getElementById('g3dReadmeEdit');
        const empty = document.querySelector('.g3d-readme-empty');
        const editBtn = document.getElementById('g3dReadmeEditBtn');
        if (content) content.style.display = 'none';
        if (empty) empty.style.display = 'none';
        if (editBtn) editBtn.style.display = 'none';
        if (edit) edit.style.display = 'block';
    }

    _g3dCancelReadme() {
        const content = document.getElementById('g3dReadmeContent');
        const edit = document.getElementById('g3dReadmeEdit');
        const empty = document.querySelector('.g3d-readme-empty');
        const editBtn = document.getElementById('g3dReadmeEditBtn');
        if (edit) edit.style.display = 'none';
        if (content) content.style.display = 'block';
        if (empty) empty.style.display = '';
        if (editBtn) editBtn.style.display = '';
    }

    async _g3dSaveReadme() {
        const textarea = document.getElementById('g3dReadmeTextarea');
        if (!textarea) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/readme`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ readme: textarea.value })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('README 已保存', 'success');
                this._renderG3DReadme(textarea.value);
            } else {
                this.showToast(data.message || '保存失败', 'error');
            }
        } catch (e) {
            this.showToast('保存失败', 'error');
        }
    }

    _renderG3DAssembly(assemblies) {
        const area = document.getElementById('g3dAssemblyArea');
        if (!area) return;
        const list = assemblies || [];
        const cards = list.map((a, i) => {
            const parts = a.parts || [];
            const partCount = a.part_count || parts.length;
            return `
                <div class="g3d-assembly-card" data-assembly-id="${this._escapeHtml(a.id)}">
                    <div class="g3d-assembly-card-header">
                        <h4>${this._escapeHtml(a.assembly_name)}</h4>
                        <div class="g3d-assembly-card-actions">
                            <button class="btn btn-outline btn-sm" onclick="manager._g3dEditAssembly('${this._escapeHtml(a.id)}')">编辑</button>
                            <button class="btn btn-outline btn-sm btn-danger" onclick="manager._g3dDeleteAssembly('${this._escapeHtml(a.id)}')">删除</button>
                        </div>
                    </div>
                    <div class="assembly-meta">
                        <span>零件数: ${partCount}</span>
                        ${a.updated_at ? `<span>更新于: ${this._formatDate(a.updated_at)}</span>` : ''}
                    </div>
                    ${parts.length ? `<div class="assembly-parts">${parts.map(p => `<span class="assembly-part-tag">${this._escapeHtml(p)}</span>`).join('')}</div>` : ''}
                    ${a.notes ? `<div class="assembly-notes">${this._escapeHtml(a.notes)}</div>` : ''}
                    <div class="g3d-assembly-edit" style="display:none;" id="g3dAssemblyEdit_${this._escapeHtml(a.id)}">
                        <div class="form-group">
                            <label>装配体名称</label>
                            <input type="text" class="form-control" id="g3dAssemblyName_${this._escapeHtml(a.id)}" value="${this._escapeHtml(a.assembly_name)}">
                        </div>
                        <div class="form-group">
                            <label>零件列表 (每行一个)</label>
                            <textarea class="form-control" id="g3dAssemblyParts_${this._escapeHtml(a.id)}" rows="4">${parts.join('\n')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>备注说明</label>
                            <textarea class="form-control" id="g3dAssemblyNotes_${this._escapeHtml(a.id)}" rows="3">${this._escapeHtml(a.notes || '')}</textarea>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="btn btn-primary btn-sm" onclick="manager._g3dSaveAssembly('${this._escapeHtml(a.id)}')">保存</button>
                            <button class="btn btn-outline btn-sm" onclick="manager._g3dCancelAssembly('${this._escapeHtml(a.id)}')">取消</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        area.innerHTML = `
            <div class="g3d-assembly-list" id="g3dAssemblyList">
                ${cards || '<div class="g3d-assembly-empty"><p>暂无装配体信息</p><p style="font-size:11px;">添加装配体说明来记录零件组成</p></div>'}
            </div>
            <div style="margin-top:12px;display:flex;gap:6px;">
                <button class="btn btn-outline btn-sm" onclick="manager._g3dAddAssembly()">+ 添加装配体</button>
            </div>
            <div class="g3d-assembly-edit" style="display:none;" id="g3dAssemblyAddEdit">
                <div class="form-group">
                    <label>装配体名称</label>
                    <input type="text" class="form-control" id="g3dAssemblyAddName" placeholder="例如: 机器人底盘总成">
                </div>
                <div class="form-group">
                    <label>零件列表 (每行一个)</label>
                    <textarea class="form-control" id="g3dAssemblyAddParts" rows="4" placeholder="底盘底座.sldprt&#10;电机支架.sldprt"></textarea>
                </div>
                <div class="form-group">
                    <label>备注说明</label>
                    <textarea class="form-control" id="g3dAssemblyAddNotes" rows="3"></textarea>
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="btn btn-primary btn-sm" onclick="manager._g3dSaveNewAssembly()">添加</button>
                    <button class="btn btn-outline btn-sm" onclick="manager._g3dCancelAddAssembly()">取消</button>
                </div>
            </div>
        `;
    }

    _g3dAddAssembly() {
        const edit = document.getElementById('g3dAssemblyAddEdit');
        if (edit) edit.style.display = 'block';
    }

    _g3dCancelAddAssembly() {
        const edit = document.getElementById('g3dAssemblyAddEdit');
        if (edit) edit.style.display = 'none';
        const name = document.getElementById('g3dAssemblyAddName');
        const parts = document.getElementById('g3dAssemblyAddParts');
        const notes = document.getElementById('g3dAssemblyAddNotes');
        if (name) name.value = '';
        if (parts) parts.value = '';
        if (notes) notes.value = '';
    }

    async _g3dSaveNewAssembly() {
        const name = document.getElementById('g3dAssemblyAddName').value.trim();
        const partsText = document.getElementById('g3dAssemblyAddParts').value.trim();
        const notes = document.getElementById('g3dAssemblyAddNotes').value.trim();
        if (!name) { this.showToast('请输入装配体名称', 'error'); return; }
        const parts = partsText ? partsText.split('\n').map(s => s.trim()).filter(Boolean) : [];
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/assembly`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assembly_name: name, parts, notes, part_count: parts.length })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('装配体已添加', 'success');
                this._renderG3DAssembly(data.assemblies);
            } else {
                this.showToast(data.message || '添加失败', 'error');
            }
        } catch (e) {
            this.showToast('添加失败', 'error');
        }
    }

    _g3dEditAssembly(assemblyId) {
        const card = document.querySelector(`.g3d-assembly-card[data-assembly-id="${assemblyId}"]`);
        if (!card) return;
        const info = card.querySelector('.g3d-assembly-card-header');
        const meta = card.querySelector('.assembly-meta');
        const parts = card.querySelector('.assembly-parts');
        const notes = card.querySelector('.assembly-notes');
        const edit = document.getElementById(`g3dAssemblyEdit_${assemblyId}`);
        if (info) info.style.display = 'none';
        if (meta) meta.style.display = 'none';
        if (parts) parts.style.display = 'none';
        if (notes) notes.style.display = 'none';
        if (edit) edit.style.display = 'block';
    }

    _g3dCancelAssembly(assemblyId) {
        const card = document.querySelector(`.g3d-assembly-card[data-assembly-id="${assemblyId}"]`);
        if (!card) return;
        const info = card.querySelector('.g3d-assembly-card-header');
        const meta = card.querySelector('.assembly-meta');
        const parts = card.querySelector('.assembly-parts');
        const notes = card.querySelector('.assembly-notes');
        const edit = document.getElementById(`g3dAssemblyEdit_${assemblyId}`);
        if (info) info.style.display = '';
        if (meta) meta.style.display = '';
        if (parts) parts.style.display = '';
        if (notes) notes.style.display = '';
        if (edit) edit.style.display = 'none';
    }

    async _g3dSaveAssembly(assemblyId) {
        const name = document.getElementById(`g3dAssemblyName_${assemblyId}`).value.trim();
        const partsText = document.getElementById(`g3dAssemblyParts_${assemblyId}`).value.trim();
        const notes = document.getElementById(`g3dAssemblyNotes_${assemblyId}`).value.trim();
        const parts = partsText ? partsText.split('\n').map(s => s.trim()).filter(Boolean) : [];
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/assembly/${assemblyId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assembly_name: name, parts, notes, part_count: parts.length })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('装配体已更新', 'success');
                this._renderG3DAssembly(data.assemblies);
            } else {
                this.showToast(data.message || '保存失败', 'error');
            }
        } catch (e) {
            this.showToast('保存失败', 'error');
        }
    }

    async _g3dDeleteAssembly(assemblyId) {
        if (!confirm('确定要删除这个装配体吗？')) return;
        try {
            const res = await fetch(`/api/g3d/projects/${this._g3dProjectId}/assembly/${assemblyId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('装配体已删除', 'success');
                this._renderG3DAssembly(data.assemblies);
            } else {
                this.showToast(data.message || '删除失败', 'error');
            }
        } catch (e) {
            this.showToast('删除失败', 'error');
        }
    }

    _parseMarkdown(text) {
        if (!text) return '';
        let html = this._escapeHtml(text);
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        html = html.replace(/^---$/gm, '<hr>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    _formatDate(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            const now = new Date();
            const diff = now - d;
            if (diff < 60000) return '刚刚';
            if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
            if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
            if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
            return d.toLocaleDateString('zh-CN');
        } catch (e) {
            return iso;
        }
    }
}

const manager = new PrinterApp();

// ==================== 全局模态框函数 ====================

function showAddPrinterModal() {
    document.getElementById('addPrinterModal').classList.add('active');
}

function closeAddPrinterModal() {
    document.getElementById('addPrinterModal').classList.remove('active');
    document.getElementById('addPrinterForm').reset();
}

function closeToolboxLinkModal() {
    document.getElementById('toolboxLinkModal').classList.remove('active');
    document.getElementById('toolboxLinkForm').reset();
}

function addPrinter(event) {
    event.preventDefault();
    const data = {
        name: document.getElementById('printerName').value.trim(),
        ip_address: document.getElementById('printerIP').value.trim(),
        access_code: document.getElementById('printerCode').value.trim(),
        serial_number: document.getElementById('printerSerial').value.trim(),
        model: document.getElementById('printerModel').value
    };
    manager.addPrinter(data);
}

function showQueueModal() {
    const select = document.getElementById('queuePrinter');
    select.innerHTML = manager.printers.map(p =>
        `<option value="${p.id}">${manager.escapeHtml(p.name)}</option>`
    ).join('');
    if (manager.printers.length === 0) {
        select.innerHTML = '<option value="">请先添加打印机</option>';
    }
    manager._queueFile = null;
    document.getElementById('queueFileInfo').style.display = 'none';
    document.getElementById('queueUploadZone').style.borderColor = '';
    document.getElementById('queueFileInput').value = '';
    document.getElementById('queueFileSelect').innerHTML = '<option value="">从打印机选择已有文件...</option>';
    manager.populateRobotSelects();
    document.getElementById('queueModal').classList.add('active');
}

function closeQueueModal() {
    manager._queueFile = null;
    document.getElementById('queueFileInfo').style.display = 'none';
    document.getElementById('queueUploadZone').style.borderColor = '';
    document.getElementById('queueFileInput').value = '';
    document.getElementById('queueModal').classList.remove('active');
    document.getElementById('queueForm').reset();
}

function closeAmsMappingModal() {
    document.getElementById('amsMappingModal').classList.remove('active');
}

function addQueueItem(event) {
    event.preventDefault();
    const data = {
        printer_id: document.getElementById('queuePrinter').value,
        file_name: document.getElementById('queueFileName').value.trim(),
        material: document.getElementById('queueMaterial').value,
        estimated_time: parseInt(document.getElementById('queueTime').value) || 0,
        priority: parseInt(document.getElementById('queuePriority').value),
        notes: document.getElementById('queueNotes').value.trim(),
        robot_id: document.getElementById('queueRobotId').value,
        subsystem: document.getElementById('queueSubsystem').value,
        assigned_to: document.getElementById('queueAssignedTo').value.trim(),
    };
    manager.addQueueItem(data);
}

function showFilamentModal() {
    document.getElementById('filamentModal').classList.add('active');
}

function closeFilamentModal() {
    document.getElementById('filamentModal').classList.remove('active');
    document.getElementById('filamentForm').reset();
}

function addFilament(event) {
    event.preventDefault();
    const data = {
        material: document.getElementById('filMaterial').value,
        brand: document.getElementById('filBrand').value.trim(),
        color: document.getElementById('filColor').value,
        color_name: document.getElementById('filColorName').value.trim(),
        total_weight: parseFloat(document.getElementById('filWeight').value),
        price: parseFloat(document.getElementById('filPrice').value) || 0
    };
    manager.addFilamentData(data);
}

function showRobotModal() {
    manager.renderRobotListInModal();
    document.getElementById('robotModal').classList.add('active');
}

function closeRobotModal() {
    document.getElementById('robotModal').classList.remove('active');
    document.getElementById('robotForm').reset();
}

function addRobot(event) {
    event.preventDefault();
    const data = {
        name: document.getElementById('robotName').value.trim(),
        year: document.getElementById('robotYear').value.trim(),
        type: document.getElementById('robotType').value,
        notes: document.getElementById('robotNotes').value.trim(),
    };
    manager.addRobotData(data);
    document.getElementById('robotForm').reset();
}

function showCompetitionModal() {
    document.getElementById('competitionModal').classList.add('active');
}

function closeCompetitionModal() {
    document.getElementById('competitionModal').classList.remove('active');
    document.getElementById('competitionForm').reset();
}

function addCompetition(event) {
    event.preventDefault();
    const data = {
        name: document.getElementById('compName').value.trim(),
        start_date: document.getElementById('compStartDate').value,
        end_date: document.getElementById('compEndDate').value,
        location: document.getElementById('compLocation').value.trim(),
        notes: document.getElementById('compNotes').value.trim(),
    };
    manager.addCompetitionData(data);
    document.getElementById('competitionForm').reset();
}

// Close modals on overlay click
['addPrinterModal', 'queueModal', 'filamentModal', 'robotModal', 'competitionModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });
});
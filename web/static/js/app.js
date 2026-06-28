/**
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
        this.init();
    }

    init() {
        this.bindNavigation();
        this.bindSocket();
        this.loadPrinters();
        setInterval(() => this.loadStats(), 5000);
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
            this.loadStats();
        } catch (e) {
            console.error('Failed to load printers:', e);
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
        const temp = card.querySelector('.printer-card-content');
        if (temp) {
            temp.innerHTML = this.getPrinterCardInnerHTML(printer);
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
            amsHTML = `
                <div class="ams-section">
                    <div class="ams-title">AMS 耗材 (${printer.ams_units.length} 槽)</div>
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
            errorHTML = `
                <div style="font-size:12px;color:var(--red);margin-bottom:12px;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;">
                    ${this.escapeHtml(printer.error_message)}
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
                <span class="status-badge ${statusClass}">
                    <span class="status-dot"></span>${statusText}
                </span>
            </div>
            ${errorHTML}
            ${progressHTML}
            <div class="temp-grid">
                <div class="temp-item">
                    <span class="temp-label">喷头</span>
                    <span class="temp-value">${printer.nozzle_temp}°C <span class="temp-target">/ ${printer.target_nozzle_temp}°C</span></span>
                </div>
                <div class="temp-item">
                    <span class="temp-label">热床</span>
                    <span class="temp-value">${printer.bed_temp}°C <span class="temp-target">/ ${printer.target_bed_temp}°C</span></span>
                </div>
                <div class="temp-item">
                    <span class="temp-label">腔体</span>
                    <span class="temp-value">${printer.chamber_temp}°C</span>
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
            <div class="queue-item">
                <div class="queue-info">
                    <div class="queue-rank">#${index + 1}</div>
                    <div class="queue-detail">
                        <div class="queue-file">${this.escapeHtml(item.file_name)} ${priorityLabels[item.priority] || ''}</div>
                        <div class="queue-meta">
                            ${item.printer_name} · ${item.material} · ${item.estimated_time ? item.estimated_time + '分钟' : '未知时间'}
                            ${item.notes ? ' · ' + this.escapeHtml(item.notes) : ''}
                        </div>
                    </div>
                </div>
                <span class="queue-status ${item.status}">${statusMap[item.status] || item.status}</span>
                <div class="queue-actions">
                    <button class="btn btn-sm btn-outline btn-danger" onclick="manager.removeQueueItem('${item.id}')">删除</button>
                </div>
            </div>
        `).join('');
    }

    async addQueueItem(data) {
        try {
            const res = await fetch('/api/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.status === 'ok') {
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
                </div>
            `;
            return;
        }
        grid.innerHTML = parts.map(p => `
            <div class="part-card" onclick="manager.quickAddPart('${p.id}')">
                <div class="part-card-header">
                    <div class="part-card-name">${this.escapeHtml(p.name)}</div>
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
                <button class="btn btn-sm btn-primary" style="width:100%;">快速添加到队列</button>
            </div>
        `).join('');
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
        }, 3000);
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
                            <div class="ops-card-subtitle">当前: 喷头 ${printer.nozzle_temp}°C / 热床 ${printer.bed_temp}°C</div>
                        </div>
                    </div>
                    <div class="temp-control-row">
                        <span class="temp-control-label">喷头</span>
                        <div class="temp-control-input">
                            <input type="range" id="nozzleTempSlider" min="0" max="300" oninput="document.getElementById('nozzleTempInput').value=this.value">
                            <input type="number" id="nozzleTempInput" min="0" max="300" value="${printer.nozzle_temp || 0}" oninput="document.getElementById('nozzleTempSlider').value=this.value">
                        </div>
                        <span class="temp-control-value">°C</span>
                    </div>
                    <div class="temp-control-row">
                        <span class="temp-control-label">热床</span>
                        <div class="temp-control-input">
                            <input type="range" id="bedTempSlider" min="0" max="120" oninput="document.getElementById('bedTempInput').value=this.value">
                            <input type="number" id="bedTempInput" min="0" max="120" value="${printer.bed_temp || 0}" oninput="document.getElementById('bedTempSlider').value=this.value">
                        </div>
                        <span class="temp-control-value">°C</span>
                    </div>
                    <button class="btn btn-primary btn-sm temp-apply" onclick="manager.applyTemperatures()">应用温度</button>
                </div>

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon fan">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><path d="M12 12v-4a4 4 0 014 4z"/></svg>
                        </div>
                        <div>
                            <h4>风扇控制</h4>
                            <div class="ops-card-subtitle">部件散热风扇</div>
                        </div>
                    </div>
                    <div class="fan-control">
                        <span class="fan-speed-display" id="fanSpeedDisplay">128</span>
                        <input type="range" id="fanSpeedSlider" min="0" max="255" value="128" oninput="document.getElementById('fanSpeedDisplay').textContent = this.value">
                    </div>
                    <div class="fan-presets">
                        <span class="fan-preset" onclick="document.getElementById('fanSpeedSlider').value=0;document.getElementById('fanSpeedDisplay').textContent='0';manager.setFanSpeed(0)">关闭</span>
                        <span class="fan-preset" onclick="document.getElementById('fanSpeedSlider').value=64;document.getElementById('fanSpeedDisplay').textContent='64';manager.setFanSpeed(64)">25%</span>
                        <span class="fan-preset" onclick="document.getElementById('fanSpeedSlider').value=128;document.getElementById('fanSpeedDisplay').textContent='128';manager.setFanSpeed(128)">50%</span>
                        <span class="fan-preset" onclick="document.getElementById('fanSpeedSlider').value=192;document.getElementById('fanSpeedDisplay').textContent='192';manager.setFanSpeed(192)">75%</span>
                        <span class="fan-preset" onclick="document.getElementById('fanSpeedSlider').value=255;document.getElementById('fanSpeedDisplay').textContent='255';manager.setFanSpeed(255)">100%</span>
                    </div>
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

                <div class="ops-card">
                    <div class="ops-card-header">
                        <div class="ops-card-icon move">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
                        </div>
                        <div>
                            <h4>轴移动</h4>
                            <div class="ops-card-subtitle">${isPrinting ? '请先暂停打印' : '归位 / 移动'}</div>
                        </div>
                    </div>
                    <div class="move-control">
                        <button class="move-btn danger" onclick="manager.sendCommand('${printer.id}','home')">🏠 归位</button>
                        <button class="move-btn" onclick="manager.sendCommand('${printer.id}','move_z', {distance: 10})">⬆ Z+10</button>
                        <button class="move-btn" onclick="manager.sendCommand('${printer.id}','move_z', {distance: -10})">⬇ Z-10</button>
                        <button class="move-btn" onclick="manager.sendCommand('${printer.id}','move_z', {distance: 50})">⬆ Z+50</button>
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
        const nozzleTemp = parseInt(document.getElementById('nozzleTempInput').value) || 0;
        const bedTemp = parseInt(document.getElementById('bedTempInput').value) || 0;
        if (nozzleTemp > 0) {
            this.sendCommand(printerId, 'set_nozzle_temp', { temp: nozzleTemp });
        }
        if (bedTemp > 0) {
            this.sendCommand(printerId, 'set_bed_temp', { temp: bedTemp });
        }
        this.showToast(`温度已设置: 喷头 ${nozzleTemp}°C / 热床 ${bedTemp}°C`, 'info');
    }

    setFanSpeed(speed) {
        const printerId = this._selectedOpsPrinter;
        if (!printerId) return;
        this.sendCommand(printerId, 'set_fan', { speed: parseInt(speed) });
        this.showToast(`风扇速度已设置为 ${speed}`, 'info');
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

    // ==================== 文件管理 ====================

    renderFileManager() {
        this._selectedFile = null;
        const onlinePrinters = this.printers.filter(p => p.status !== 'offline');
        const select = document.getElementById('fmPrinterSelect');
        if (select) {
            select.innerHTML = '<option value="">选择目标打印机...</option>' +
                onlinePrinters.map(p => `<option value="${p.id}">${this.escapeHtml(p.name)} (${p.model})</option>`).join('');
            select.onchange = () => {
                this._selectedFmPrinter = select.value;
                document.getElementById('uploadBtn').disabled = !select.value || !this._selectedFile;
                if (select.value) {
                    this.loadPrinterFiles(select.value);
                }
            };
        }

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

        document.getElementById('fmFileList').innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                <p>请选择打印机并刷新</p>
                <span>选择打印机后点击刷新查看文件列表</span>
            </div>
        `;
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
        document.getElementById('uploadBtn').disabled = !document.getElementById('fmPrinterSelect').value;
        const zone = document.getElementById('uploadZone');
        zone.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:12px;color:var(--green);">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p style="color:var(--green);">${this.escapeHtml(file.name)}</p>
            <span>${(file.size / 1024 / 1024).toFixed(2)} MB · 点击重新选择</span>
        `;
    }

    async uploadFile() {
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (!printerId || !this._selectedFile) return;

        const formData = new FormData();
        formData.append('file', this._selectedFile);

        const progressEl = document.getElementById('uploadProgress');
        const progressFill = document.getElementById('uploadProgressFill');
        const progressText = document.getElementById('uploadProgressText');
        document.getElementById('uploadBtn').disabled = true;
        progressEl.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '上传中...';

        try {
            const res = await fetch(`/api/printers/${printerId}/upload`, {
                method: 'POST',
                body: formData,
            });
            const result = await res.json();
            if (result.success) {
                progressFill.style.width = '100%';
                progressText.textContent = '上传成功';
                this.showToast(`文件已上传到打印机`, 'success');
                this.loadPrinterFiles(printerId);
            } else {
                progressText.textContent = '上传失败: ' + (result.message || '未知错误');
                this.showToast('上传失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            progressText.textContent = '上传失败: 网络错误';
            this.showToast('上传失败: 网络错误', 'error');
        }
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
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
                        <button class="btn btn-sm btn-success" onclick="manager.startPrint('${printerId}', '${this.escapeJs(f)}')" title="开始打印">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
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
        if (!confirm(`确定要开始打印 "${filename}" 吗？`)) return;
        try {
            const res = await fetch(`/api/printers/${printerId}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename }),
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`开始打印: ${filename}`, 'success');
            } else {
                this.showToast('启动失败: ' + (result.message || '未知错误'), 'error');
            }
        } catch (e) {
            this.showToast('启动失败: 网络错误', 'error');
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
        const printerId = document.getElementById('fmPrinterSelect').value;
        if (printerId) {
            this.loadPrinterFiles(printerId);
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
    manager.populateRobotSelects();
    document.getElementById('queueModal').classList.add('active');
}

function closeQueueModal() {
    document.getElementById('queueModal').classList.remove('active');
    document.getElementById('queueForm').reset();
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
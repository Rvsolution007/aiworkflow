/**
 * AI Flow Builder — Main App Logic
 * Navigation, data loading, modals, toasts, and global state.
 */

const App = {
  currentSection: 'ai-builder',
  flows: [],
  credentials: [],
  executions: [],

  /**
   * Initialize the application
   */
  init() {
    // Connect WebSocket
    WS.connect();

    // Setup navigation
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
      item.addEventListener('click', () => {
        this.navigateTo(item.dataset.section);
      });
    });

    // Load initial data
    this.loadFlows();
    this.loadCredentials();
    this.loadExecutions();
    this.loadSystemInfo();

    // Setup WebSocket listeners for execution progress
    WS.on('execution_progress', (data) => Execution.handleProgress(data));
    WS.on('execution_complete', (data) => Execution.handleComplete(data));

    // Initialize recorder UI
    RecorderUI.init();

    // Listen for timer updates from server
    WS.on('timer_update', (data) => this._handleTimerUpdate(data));

    // Start countdown ticker (updates every second)
    this._timerCountdownInterval = setInterval(() => this._tickTimerCountdowns(), 1000);

    // Load initial timer statuses
    this._loadTimerStatuses();
  },

  /**
   * Navigate to a section
   */
  navigateTo(section) {
    this.currentSection = section;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });

    // Update sections
    document.querySelectorAll('.section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `section-${section}`);
    });

    // Update title
    const titles = {
      'ai-builder': '🧠 AI Builder',
      'recorder': '🔴 Record Flow',
      'flows': '📋 My Flows',
      'execution': '▶️ Run Flow',
      'history': '📊 History',
      'credentials': '🔐 Credentials',
      'sessions': '🍪 Sessions',
      'settings': '⚙️ Settings',
    };
    document.getElementById('page-title').textContent = titles[section] || section;

    // Refresh data for section
    if (section === 'flows') this.loadFlows();
    if (section === 'history') this.loadExecutions();
    if (section === 'execution') this.loadFlowsForSelect();
    if (section === 'credentials') this.loadCredentials();
    if (section === 'sessions') SessionsUI.loadSessions();
    if (section === 'recorder') this._loadProfilesForRecorder();
  },

  /**
   * Load all flows
   */
  async loadFlows() {
    try {
      const res = await fetch('/api/flows');
      const data = await res.json();
      if (data.success) {
        this.flows = data.flows;
        this._renderFlows();
        document.getElementById('flows-count').textContent = data.flows.length;
      }
    } catch (err) {
      console.error('Failed to load flows:', err);
    }
  },

  /**
   * Load credentials
   */
  async loadCredentials() {
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      if (data.success) {
        this.credentials = data.credentials;
        this._renderCredentials();
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  },

  /**
   * Load execution history
   */
  async loadExecutions() {
    try {
      const res = await fetch('/api/executions');
      const data = await res.json();
      if (data.success) {
        this.executions = data.executions;
        this._renderHistory();
      }
    } catch (err) {
      console.error('Failed to load executions:', err);
    }
  },

  /**
   * Load flows into execution select dropdown
   */
  loadFlowsForSelect() {
    const select = document.getElementById('execute-flow-select');
    select.innerHTML = '<option value="">— Select a flow —</option>';
    this.flows.forEach(flow => {
      select.innerHTML += `<option value="${flow.id}">${flow.name} (${flow.steps.length} steps)</option>`;
    });
  },

  /**
   * Load system info for settings
   */
  async loadSystemInfo() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const el = document.getElementById('system-info');
      const redisIcon = data.redis?.status === 'connected' ? '🟢' : '🔴';
      const redisColor = data.redis?.status === 'connected' ? 'var(--success)' : 'var(--error)';
      el.innerHTML = `
        <p>🟢 Status: ${data.status}</p>
        <p>⏱️ Uptime: ${Math.floor(data.uptime / 60)} minutes</p>
        <p>💾 Memory: ${Math.round(data.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(data.memory.heapTotal / 1024 / 1024)}MB</p>
        <p>🕐 Server Time: ${new Date(data.timestamp).toLocaleString()}</p>
        <hr style="margin:10px 0;border-color:var(--border-subtle)">
        <p style="font-weight:600">Redis Queue:</p>
        <p>${redisIcon} Redis: <strong style="color:${redisColor}">${data.redis?.status || 'unknown'}</strong></p>
        <p>📡 Host: <code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px">${data.redis?.host || '?'}:${data.redis?.port || '?'}</code></p>
        ${data.redis?.error ? `<p style="color:var(--error);font-size:11px">⚠️ ${data.redis.error}</p>` : ''}
      `;
    } catch (err) {
      document.getElementById('system-info').textContent = '❌ Unable to fetch system info';
    }
  },

  /**
   * Refresh all data
   */
  refreshData() {
    this.loadFlows();
    this.loadCredentials();
    this.loadExecutions();
    this.loadSystemInfo();
    this.toast('Data refreshed', 'info');
  },

  // ─── Render Functions ─────────────────────────────

  // Timer statuses cache
  _timerStatuses: {},

  async _loadTimerStatuses() {
    try {
      const res = await fetch('/api/timers');
      const data = await res.json();
      if (data.success && data.timers) {
        data.timers.forEach(t => {
          this._timerStatuses[t.flowId] = t;
        });
        // Re-render flows if on flows page
        if (this.currentSection === 'flows') this._renderFlows();
      }
    } catch (e) {}
  },

  _handleTimerUpdate(data) {
    if (!data.flowId) return;
    this._timerStatuses[data.flowId] = data;
    // Update the timer widget on the specific flow card
    this._updateTimerWidget(data.flowId);
  },

  _tickTimerCountdowns() {
    document.querySelectorAll('.flow-timer-countdown').forEach(el => {
      const nextRun = el.dataset.nextRun;
      if (!nextRun) return;
      const remaining = new Date(nextRun).getTime() - Date.now();
      if (remaining <= 0) {
        el.textContent = '🔄 Running...';
        el.classList.add('timer-running');
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        el.textContent = `⏱ Next: ${mins}m ${secs}s`;
        el.classList.remove('timer-running');
      }
    });
  },

  _updateTimerWidget(flowId) {
    const widget = document.getElementById(`timer-widget-${flowId}`);
    if (!widget) return;
    const status = this._timerStatuses[flowId];
    widget.innerHTML = this._buildTimerWidget(flowId, status);
  },

  _buildTimerWidget(flowId, timerStatus) {
    const flow = this.flows.find(f => f.id == flowId);
    const enabled = timerStatus?.enabled || flow?.timer_enabled;
    const interval = timerStatus?.interval || flow?.timer_interval_min || 0;
    const nextRun = timerStatus?.nextRun || null;
    const running = timerStatus?.running || false;
    const waiting = timerStatus?.waitingForExecution || false;

    if (!enabled) {
      return `
        <div class="timer-widget-off" onclick="event.stopPropagation(); TimerUI.setTimer(${flowId})">
          <div class="timer-toggle-label">🔁 Auto-Repeat</div>
          <div class="timer-toggle-switch">
            <span class="timer-off-text">OFF</span>
          </div>
        </div>
      `;
    }

    let statusHtml = '';
    if (running) {
      statusHtml = '<div class="flow-timer-countdown timer-running">🔄 Executing...</div>';
    } else if (nextRun) {
      const remaining = new Date(nextRun).getTime() - Date.now();
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const nextTime = new Date(nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusHtml = `
        <div class="flow-timer-countdown" data-next-run="${nextRun}">⏱ Next: ${mins}m ${secs}s</div>
        <div class="flow-timer-next-time">🕐 at ${nextTime}</div>
      `;
    } else if (waiting) {
      statusHtml = '<div class="flow-timer-countdown timer-waiting">⏸ Waiting for run...</div>';
    }

    return `
      <div class="timer-widget-on" onclick="event.stopPropagation(); TimerUI.setTimer(${flowId})">
        <div class="timer-widget-header">
          <div class="timer-toggle-label">🔁 Auto: ${interval}min</div>
          <div class="timer-toggle-switch active">
            <span class="timer-on-text">ON</span>
          </div>
        </div>
        ${statusHtml}
      </div>
    `;
  },

  _renderFlows() {
    const grid = document.getElementById('flows-grid');

    if (this.flows.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No flows yet</div>
          <div class="empty-state-subtext">Use AI Builder to create your first automation flow</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.flows.map(flow => {
      const timerStatus = this._timerStatuses[flow.id];
      const timerWidgetHtml = this._buildTimerWidget(flow.id, timerStatus);
      const warmUpOn = flow.warmUpEnabled !== false;

      return `
        <div class="flow-card" onclick="App.viewFlow(${flow.id})">
          <div class="flow-card-top">
            <div class="flow-card-actions">
              <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); App.executeFlow(${flow.id})" title="Run">▶️</button>
              <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); App.deleteFlow(${flow.id})" title="Delete">🗑️</button>
            </div>
            <div class="flow-card-name">${this._escapeHtml(flow.name)}</div>
            <div class="flow-card-desc">${this._escapeHtml(flow.description || 'No description')}</div>
            <div class="flow-card-meta">
              <div class="flow-card-steps">⚡ ${flow.steps.length} steps</div>
              <div class="flow-card-warmup ${warmUpOn ? 'warmup-on' : 'warmup-off'}" 
                   onclick="event.stopPropagation(); App.toggleWarmUp(${flow.id}, ${!warmUpOn})" 
                   title="${warmUpOn ? 'Session warm-up ON — click to disable' : 'Session warm-up OFF — click to enable'}">
                🔥 ${warmUpOn ? 'Warm-up ON' : 'Warm-up OFF'}
              </div>
              <div class="flow-card-category">${flow.category || 'general'}</div>
            </div>
          </div>
          <div class="flow-card-timer" id="timer-widget-${flow.id}">
            ${timerWidgetHtml}
          </div>
        </div>
      `;
    }).join('');
  },

  _renderCredentials() {
    const grid = document.getElementById('credentials-grid');

    if (this.credentials.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔐</div>
          <div class="empty-state-text">No credentials stored</div>
          <div class="empty-state-subtext">Add credentials for automated login</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.credentials.map(cred => `
      <div class="cred-card">
        <div class="cred-icon">🔑</div>
        <div class="cred-info">
          <div class="cred-name">${this._escapeHtml(cred.name)}</div>
          <div class="cred-label">${this._escapeHtml(cred.label || 'No label')}</div>
          <div class="cred-badges">
            ${cred.hasUsername ? '<span class="cred-badge">👤 Username</span>' : ''}
            ${cred.hasPassword ? '<span class="cred-badge">🔒 Password</span>' : ''}
            ${cred.hasTotpSecret ? '<span class="cred-badge">📱 2FA</span>' : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="App.deleteCredential(${cred.id})">🗑️</button>
      </div>
    `).join('');
  },

  _selectedExecutions: new Set(),

  _renderHistory() {
    const container = document.getElementById('history-list');

    if (this.executions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-text">No execution history</div>
          <div class="empty-state-subtext">Run a flow to see execution history</div>
        </div>
      `;
      return;
    }

    const statusIcons = {
      completed: '✅',
      failed: '❌',
      running: '⏳',
      queued: '🕐',
      cancelled: '🚫',
    };

    // Toolbar with Select All + Delete
    const toolbar = `
      <div class="history-toolbar">
        <label class="history-select-all">
          <input type="checkbox" id="history-select-all" onchange="App.toggleSelectAll(this.checked)">
          <span>Select All</span>
        </label>
        <div class="history-toolbar-actions">
          <span id="history-selected-count" class="history-count"></span>
          <button id="history-delete-btn" class="btn btn-sm btn-danger" style="display:none" onclick="App.deleteSelectedExecutions()">
            🗑️ Delete Selected
          </button>
        </div>
      </div>
    `;

    const cards = this.executions.map(exec => `
      <div class="history-card ${exec.status}" id="history-card-${exec.id}">
        <div class="history-checkbox" onclick="event.stopPropagation()">
          <input type="checkbox" class="exec-checkbox" data-id="${exec.id}" 
            onchange="App.toggleExecSelect(${exec.id}, this.checked)" 
            ${this._selectedExecutions.has(exec.id) ? 'checked' : ''}>
        </div>
        <div class="history-status-icon ${exec.status}">
          ${statusIcons[exec.status] || '❓'}
        </div>
        <div class="history-info" onclick="App.viewExecution(${exec.id})">
          <div class="history-name">${this._escapeHtml(exec.flow_name)}</div>
          <div class="history-meta">
            <span class="exec-status-badge ${exec.status}">${exec.status}</span>
            <span>${exec.current_step}/${exec.total_steps} steps</span>
            <span>${new Date(exec.created_at).toLocaleString()}</span>
          </div>
          ${exec.error_message ? `
            <div class="history-error">
              ⚠️ ${this._escapeHtml(exec.error_message.substring(0, 150))}${exec.error_message.length > 150 ? '...' : ''}
            </div>
          ` : ''}
        </div>
        <button class="btn btn-sm btn-icon-danger" onclick="event.stopPropagation(); App.deleteSingleExecution(${exec.id})" title="Delete">
          🗑️
        </button>
      </div>
    `).join('');

    container.innerHTML = toolbar + cards;
    this._updateDeleteBtn();
  },

  toggleSelectAll(checked) {
    this._selectedExecutions.clear();
    if (checked) {
      this.executions.forEach(e => this._selectedExecutions.add(e.id));
    }
    document.querySelectorAll('.exec-checkbox').forEach(cb => cb.checked = checked);
    this._updateDeleteBtn();
  },

  toggleExecSelect(id, checked) {
    if (checked) {
      this._selectedExecutions.add(id);
    } else {
      this._selectedExecutions.delete(id);
    }
    // Update Select All checkbox
    const allCb = document.getElementById('history-select-all');
    if (allCb) allCb.checked = this._selectedExecutions.size === this.executions.length;
    this._updateDeleteBtn();
  },

  _updateDeleteBtn() {
    const count = this._selectedExecutions.size;
    const btn = document.getElementById('history-delete-btn');
    const countEl = document.getElementById('history-selected-count');
    if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
    if (countEl) countEl.textContent = count > 0 ? `${count} selected` : '';
  },

  async deleteSelectedExecutions() {
    const ids = Array.from(this._selectedExecutions);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} execution(s)? This cannot be undone.`)) return;

    try {
      const res = await fetch('/api/executions/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (data.success) {
        this._selectedExecutions.clear();
        this.toast(`${data.deleted} execution(s) deleted`, 'success');
        this.navigateTo('history');
      } else {
        this.toast(data.error || 'Delete failed', 'error');
      }
    } catch (err) {
      this.toast('Delete failed: ' + err.message, 'error');
    }
  },

  async deleteSingleExecution(id) {
    if (!confirm('Delete this execution?')) return;
    try {
      const res = await fetch(`/api/executions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this._selectedExecutions.delete(id);
        this.toast('Execution deleted', 'success');
        this.navigateTo('history');
      }
    } catch (err) {
      this.toast('Delete failed', 'error');
    }
  },

  // ─── Actions ─────────────────────────────────────

  async viewFlow(id) {
    try {
      const res = await fetch(`/api/flows/${id}`);
      const data = await res.json();
      if (data.success) {
        this.navigateTo('ai-builder');
        FlowBuilder.setFlow({
          id: data.flow.id,
          flowName: data.flow.name,
          description: data.flow.description,
          steps: data.flow.steps,
          category: data.flow.category,
          profileName: data.flow.profileName || data.flow.profile_name || 'default',
        });
      }
    } catch (err) {
      this.toast('Failed to load flow', 'error');
    }
  },

  async executeFlow(id) {
    this.navigateTo('execution');
    setTimeout(() => {
      document.getElementById('execute-flow-select').value = id;
      Execution.run();
    }, 300);
  },

  async deleteFlow(id) {
    if (!confirm('Delete this flow?')) return;
    try {
      await fetch(`/api/flows/${id}`, { method: 'DELETE' });
      this.toast('Flow deleted', 'success');
      this.loadFlows();
    } catch (err) {
      this.toast('Failed to delete flow', 'error');
    }
  },

  async deleteCredential(id) {
    if (!confirm('Delete this credential?')) return;
    try {
      await fetch(`/api/credentials/${id}`, { method: 'DELETE' });
      this.toast('Credential deleted', 'success');
      this.loadCredentials();
    } catch (err) {
      this.toast('Failed to delete credential', 'error');
    }
  },

  async viewExecution(id) {
    try {
      const res = await fetch(`/api/executions/${id}`);
      const data = await res.json();
      if (data.success) {
        Execution.showDetails(data.execution);
      }
    } catch (err) {
      this.toast('Failed to load execution', 'error');
    }
  },

  // ─── Modal ───────────────────────────────────────

  showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('active');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  },

  // ─── Toast ───────────────────────────────────────

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || ''}</span> ${this._escapeHtml(message)}`;

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 5000);
  },

  // ─── Helpers ─────────────────────────────────────

  /**
   * Load credentials as browser profiles for recorder dropdown
   */
  async _loadProfilesForRecorder() {
    const select = document.getElementById('recorder-profile-select');
    if (!select) return;

    // Keep current selection
    const currentValue = select.value;

    // Start with default
    select.innerHTML = '<option value="default">Default Profile</option>';

    // Add profiles from credentials
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      if (data.success && data.credentials) {
        data.credentials.forEach(cred => {
          const opt = document.createElement('option');
          opt.value = cred.name;
          opt.textContent = `🔑 ${cred.label || cred.name}`;
          select.appendChild(opt);
        });
      }
    } catch (e) {
      console.error('Failed to load profiles for recorder:', e);
    }

    // Restore selection if still valid
    if (currentValue) {
      const exists = Array.from(select.options).some(o => o.value === currentValue);
      if (exists) select.value = currentValue;
    }
  },

  /**
   * Toggle warm-up enabled/disabled for a flow
   */
  async toggleWarmUp(flowId, enabled) {
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warmUpEnabled: enabled }),
      });
      const data = await res.json();
      if (data.success) {
        // Update local cache
        const flow = this.flows.find(f => f.id == flowId);
        if (flow) flow.warmUpEnabled = enabled;
        this._renderFlows();
        this.toast(`Session warm-up ${enabled ? 'enabled 🔥' : 'disabled'}`, enabled ? 'success' : 'info');
      }
    } catch (err) {
      this.toast('Failed to toggle warm-up', 'error');
    }
  },

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};

// ─── Credentials Modal ─────────────────────────────

const Credentials = {
  showAddModal() {
    App.showModal(`
      <div class="modal-title">🔐 Add Credential</div>
      <div class="input-group">
        <label class="input-label">Credential Name *</label>
        <input type="text" class="input" id="cred-name" placeholder="e.g., google_admin">
      </div>
      <div class="input-group">
        <label class="input-label">Label (optional)</label>
        <input type="text" class="input" id="cred-label" placeholder="e.g., Google Admin Account">
      </div>
      <div class="input-group">
        <label class="input-label">Username / Email *</label>
        <input type="text" class="input" id="cred-username" placeholder="user@example.com">
      </div>
      <div class="input-group">
        <label class="input-label">Password *</label>
        <input type="password" class="input" id="cred-password" placeholder="••••••••">
      </div>
      <div class="input-group">
        <label class="input-label">TOTP Secret (optional — for 2FA)</label>
        <input type="text" class="input" id="cred-totp" placeholder="JBSWY3DPEHPK3PXP">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Credentials.save()">💾 Save Credential</button>
      </div>
    `);
  },

  async save() {
    const name = document.getElementById('cred-name').value.trim();
    const label = document.getElementById('cred-label').value.trim();
    const username = document.getElementById('cred-username').value.trim();
    const password = document.getElementById('cred-password').value;
    const totpSecret = document.getElementById('cred-totp').value.trim();

    if (!name || !username || !password) {
      App.toast('Name, username, and password are required', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, label, username, password, totpSecret: totpSecret || null }),
      });

      const data = await res.json();
      if (data.success) {
        App.toast('Credential saved securely! 🔐', 'success');
        App.closeModal();
        App.loadCredentials();
      } else {
        App.toast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      App.toast(`Save failed: ${err.message}`, 'error');
    }
  },
};

// ─── Execution Controller ──────────────────────────

const Execution = {
  currentExecutionId: null,
  totalSteps: 0,
  flowSteps: [],
  startTime: null,

  async run() {
    const select = document.getElementById('execute-flow-select');
    const flowId = select.value;

    if (!flowId) {
      App.toast('Please select a flow', 'warning');
      return;
    }

    // Get flow details for step preview
    const flow = App.flows.find(f => f.id == flowId);
    if (flow) {
      this.flowSteps = flow.steps || [];
      this.totalSteps = this.flowSteps.length;
    }

    // Hide selector, show live view immediately with init progress
    document.getElementById('execution-select').style.display = 'none';
    const container = document.getElementById('execution-live-container');
    container.style.display = 'block';

    // Show initialization progress in steps list
    const list = document.getElementById('exec-steps-list');
    document.getElementById('exec-progress-bar').style.width = '0%';
    document.getElementById('exec-progress-bar').className = 'progress-bar-fill';
    document.getElementById('exec-progress-text').textContent = 'Initializing...';

    const initPhases = [
      { label: 'Preparing flow environment...', pct: 10 },
      { label: 'Loading flow steps...', pct: 25 },
      { label: 'Connecting to execution engine...', pct: 45 },
      { label: 'Queueing flow for execution...', pct: 65 },
      { label: 'Launching browser worker...', pct: 85 },
    ];

    // Show init progress card
    list.innerHTML = `
      <div class="exec-init-card">
        <div class="exec-init-header">
          <div class="spinner" style="width:20px;height:20px"></div>
          <span>Initializing Execution</span>
        </div>
        <div class="exec-init-phase" id="exec-init-phase">${initPhases[0].label}</div>
        <div class="exec-init-bar">
          <div class="exec-init-bar-fill" id="exec-init-bar-fill" style="width:0%"></div>
        </div>
        <div class="exec-init-pct" id="exec-init-pct">0%</div>
      </div>
    `;

    const statusEl = document.getElementById('exec-status');
    statusEl.innerHTML = '🚀 Initializing...';
    statusEl.className = 'exec-status-badge running';

    // Animate through phases
    const phaseEl = document.getElementById('exec-init-phase');
    const barEl = document.getElementById('exec-init-bar-fill');
    const pctEl = document.getElementById('exec-init-pct');

    for (let i = 0; i < initPhases.length; i++) {
      await this._delay(300 + Math.random() * 200);
      if (phaseEl) {
        phaseEl.textContent = initPhases[i].label;
        phaseEl.style.animation = 'none';
        phaseEl.offsetHeight; // reflow
        phaseEl.style.animation = 'fadeIn 0.3s ease';
      }
      if (barEl) barEl.style.width = `${initPhases[i].pct}%`;
      if (pctEl) pctEl.textContent = `${initPhases[i].pct}%`;
      document.getElementById('exec-progress-bar').style.width = `${Math.round(initPhases[i].pct * 0.1)}%`;
      document.getElementById('exec-progress-text').textContent = `Initializing... ${initPhases[i].pct}%`;
    }

    // Now make the actual API call
    try {
      const res = await fetch(`/api/execute/${flowId}`, { method: 'POST' });
      
      // Check if response is JSON
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Server returned ${res.status} ${res.statusText}. The API may not be available.`);
      }

      const data = await res.json();

      if (data.success) {
        // Complete init progress
        if (barEl) barEl.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (phaseEl) phaseEl.textContent = '✅ Flow queued successfully!';
        document.getElementById('exec-progress-text').textContent = `Initializing... 100%`;

        await this._delay(500);

        this.currentExecutionId = data.execution.id;
        this.totalSteps = data.execution.total_steps;
        this.startTime = Date.now();
        
        // Now show all the flow steps
        this._showLiveView();
        App.toast('Flow queued for execution! ⚡', 'success');

        // Start auto-checking if stuck in queue
        this._startQueueWatcher(data.execution.id);
      } else {
        // Show error with reason on UI
        this._showError(
          data.error || 'Unknown error', 
          data.details || 'Execution could not be started'
        );
        App.toast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      // Network/server error — show with full details
      this._showError(
        err.message || 'Connection failed',
        'Could not connect to the execution server. Check if Redis is running.'
      );
      App.toast(`Execution failed: ${err.message}`, 'error');
    }
  },

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  _queueTimer: null,
  _queueCheckCount: 0,

  _startQueueWatcher(executionId) {
    this._queueCheckCount = 0;
    if (this._queueTimer) clearInterval(this._queueTimer);
    
    this._queueTimer = setInterval(async () => {
      this._queueCheckCount++;
      const elapsed = this._queueCheckCount * 10;

      // Update status with timer
      const statusEl = document.getElementById('exec-status');
      if (statusEl && statusEl.className.includes('queued')) {
        statusEl.innerHTML = `⏳ Queued — Waiting for worker... (${elapsed}s)`;
      }

      // After 20s, check execution status from API
      if (this._queueCheckCount >= 2) {
        try {
          const res = await fetch(`/api/executions/${executionId}`);
          const data = await res.json();
          
          if (data.success && data.execution) {
            const exec = data.execution;
            
            // If still queued after 30s, show debug info
            if (exec.status === 'queued' && this._queueCheckCount >= 3) {
              this._showQueueDebug(elapsed);
            }
            
            // If status changed, stop watching
            if (exec.status !== 'queued') {
              clearInterval(this._queueTimer);
              this._queueTimer = null;
            }

            // If failed, broadcast it
            if (exec.status === 'failed') {
              this.handleComplete({
                executionId,
                result: { status: 'failed', error: exec.error_message || 'Worker failed' },
              });
            }
          }
        } catch (e) {
          // ignore fetch errors
        }
      }

      // After 2 minutes, stop watching
      if (this._queueCheckCount >= 12) {
        clearInterval(this._queueTimer);
        this._queueTimer = null;
      }
    }, 10000);
  },

  async _showQueueDebug(elapsed) {
    // Fetch Redis health
    let redisInfo = 'Checking...';
    try {
      const healthRes = await fetch('/api/health');
      const health = await healthRes.json();
      if (health.redis) {
        const r = health.redis;
        redisInfo = r.status === 'connected'
          ? `🟢 Connected (${r.host}:${r.port})`
          : `🔴 Disconnected — ${r.error || 'Unknown'}`;
      }
    } catch (e) {
      redisInfo = '❌ Could not fetch health';
    }

    // Show debug card below steps
    const list = document.getElementById('exec-steps-list');
    let debugEl = document.getElementById('exec-queue-debug');
    if (!debugEl) {
      debugEl = document.createElement('div');
      debugEl.id = 'exec-queue-debug';
      list.parentNode.insertBefore(debugEl, list.nextSibling);
    }
    
    debugEl.innerHTML = `
      <div class="exec-error-card" style="border-color: var(--warning); box-shadow: 0 4px 20px rgba(245,158,11,0.1);">
        <div class="exec-error-header">
          <span class="exec-error-icon">⏳</span>
          <span class="exec-error-title" style="color:var(--warning)">Stuck in Queue (${elapsed}s)</span>
        </div>
        <div class="exec-error-reason">The worker has not picked up this job. Possible reasons:</div>
        <div class="exec-error-tips">
          <strong>Debug Info:</strong>
          <ul>
            <li>Redis Status: <strong>${redisInfo}</strong></li>
            <li>Execution ID: ${this.currentExecutionId}</li>
            <li>Waiting: ${elapsed} seconds</li>
          </ul>
          <br>
          <strong>Possible fixes:</strong>
          <ul>
            <li>Check <strong>REDIS_PASSWORD</strong> in EasyPanel environment</li>
            <li>Restart the <strong>aiworkflow</strong> service in EasyPanel</li>
            <li>Check EasyPanel logs for <code>[WORKER]</code> messages</li>
            <li>Verify Redis service <strong>redis_aiworkflow</strong> is running</li>
          </ul>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="Execution.backToSelect()" style="margin-top:12px">
          ← Cancel & Go Back
        </button>
      </div>
    `;
  },

  handleProgress(data) {
    if (data.executionId !== this.currentExecutionId) return;

    // Stop queue watcher if we get progress
    if (this._queueTimer) {
      clearInterval(this._queueTimer);
      this._queueTimer = null;
    }
    // Remove debug card if shown
    const debugEl = document.getElementById('exec-queue-debug');
    if (debugEl) debugEl.remove();

    if (data.event === 'status') {
      const statusIcon = data.status === 'running' ? '🔄' : data.status === 'completed' ? '✅' : '❌';
      const statusEl = document.getElementById('exec-status');
      statusEl.innerHTML = `${statusIcon} ${data.message || data.status}`;
      statusEl.className = `exec-status-badge ${data.status}`;
    }

    if (data.event === 'step') {
      this._updateStepUI(data);
    }
  },

  handleComplete(data) {
    if (data.executionId !== this.currentExecutionId) return;
    
    const status = data.result?.status || 'unknown';
    const elapsed = Date.now() - (this.startTime || Date.now());
    const elapsedText = `${(elapsed / 1000).toFixed(1)}s`;

    // Update status bar
    const statusEl = document.getElementById('exec-status');
    if (status === 'completed') {
      statusEl.innerHTML = `✅ Completed in ${elapsedText}`;
      statusEl.className = 'exec-status-badge completed';
      document.getElementById('exec-progress-bar').style.width = '100%';
      document.getElementById('exec-progress-bar').classList.add('completed');
    } else {
      statusEl.innerHTML = `❌ Failed — ${data.result?.error || 'Unknown error'}`;
      statusEl.className = 'exec-status-badge failed';
      document.getElementById('exec-progress-bar').classList.add('failed');
    }

    // Show error details if failed
    if (status === 'failed' && data.result) {
      this._showStepError(data.result);
    }

    // Show back button
    const backBtn = document.getElementById('exec-back-btn');
    if (backBtn) backBtn.style.display = 'inline-flex';

    App.toast(
      status === 'completed' ? 'Flow completed successfully! ✅' : `Flow failed: ${data.result?.error || 'Error'}`,
      status === 'completed' ? 'success' : 'error'
    );
    App.loadExecutions();
  },

  _showLiveView() {
    document.getElementById('execution-select').style.display = 'none';
    const container = document.getElementById('execution-live-container');
    container.style.display = 'block';
    
    // Reset progress
    document.getElementById('exec-progress-bar').style.width = '0%';
    document.getElementById('exec-progress-bar').className = 'progress-bar-fill';
    document.getElementById('exec-progress-text').textContent = `0 / ${this.totalSteps} steps`;
    document.getElementById('exec-status').innerHTML = '⏳ Queued — Waiting for worker...';
    document.getElementById('exec-status').className = 'exec-status-badge queued';
    
    // Hide back button
    const backBtn = document.getElementById('exec-back-btn');
    if (backBtn) backBtn.style.display = 'none';

    // Clear error panel
    const errorPanel = document.getElementById('exec-error-panel');
    if (errorPanel) errorPanel.style.display = 'none';

    // Build step list with all steps as pending
    const list = document.getElementById('exec-steps-list');
    list.innerHTML = '';

    this.flowSteps.forEach((step, index) => {
      const stepEl = document.createElement('div');
      stepEl.id = `exec-step-${index + 1}`;
      stepEl.className = 'exec-step pending';
      stepEl.style.animationDelay = `${index * 0.05}s`;
      stepEl.innerHTML = `
        <div class="exec-step-num">${index + 1}</div>
        <div class="exec-step-icon">⏳</div>
        <div class="exec-step-content">
          <div class="exec-step-action">${App._escapeHtml(step.action || 'Step')}</div>
          <div class="exec-step-desc">${App._escapeHtml(step.description || '')}</div>
        </div>
        <div class="exec-step-time">—</div>
      `;
      list.appendChild(stepEl);
    });
  },

  _updateStepUI(data) {
    const list = document.getElementById('exec-steps-list');
    const progress = (data.step / data.total) * 100;

    // Animate progress bar
    document.getElementById('exec-progress-bar').style.width = `${progress}%`;
    document.getElementById('exec-progress-text').textContent = `${data.step} / ${data.total} steps`;

    const statusIcons = {
      running: '<div class="spinner"></div>',
      completed: '✅',
      failed: '❌',
      healing: '🔧',
      healed: '🩹',
      pending: '⏳',
    };

    // Find existing step element or create new one
    let stepEl = document.getElementById(`exec-step-${data.step}`);
    if (!stepEl) {
      stepEl = document.createElement('div');
      stepEl.id = `exec-step-${data.step}`;
      list.appendChild(stepEl);
    }

    // Apply status class with animation
    stepEl.className = `exec-step ${data.status} step-animate`;
    stepEl.innerHTML = `
      <div class="exec-step-num">${data.step}</div>
      <div class="exec-step-icon">${statusIcons[data.status] || '⚡'}</div>
      <div class="exec-step-content">
        <div class="exec-step-action">${App._escapeHtml(data.action || `Step ${data.step}`)}</div>
        <div class="exec-step-desc">${App._escapeHtml(data.description || data.message || '')}</div>
        ${data.status === 'failed' && data.error ? `<div class="exec-step-error">❌ ${App._escapeHtml(data.error)}</div>` : ''}
        ${data.status === 'healing' ? '<div class="exec-step-healing">🔧 AI is attempting to self-heal this step...</div>' : ''}
        ${data.status === 'healed' ? '<div class="exec-step-healed">🩹 Step recovered by AI self-healer</div>' : ''}
      </div>
      <div class="exec-step-time">${data.duration || ''}</div>
    `;

    // Update screenshot if available
    if (data.screenshot) {
      const screenshotFile = data.screenshot.split(/[\\/]/).pop();
      document.getElementById('screenshot-container').innerHTML = 
        `<img src="/screenshots/${screenshotFile}" alt="Step ${data.step} screenshot">`;
      document.getElementById('screenshot-label').textContent = 
        `Step ${data.step}: ${data.description || data.action || ''}`;
    }

    // Scroll to current step
    stepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _showError(errorMessage, errorContext) {
    // Show error inline in the execution area
    document.getElementById('execution-select').style.display = 'none';
    const container = document.getElementById('execution-live-container');
    container.style.display = 'block';

    const list = document.getElementById('exec-steps-list');
    list.innerHTML = `
      <div class="exec-error-card">
        <div class="exec-error-header">
          <span class="exec-error-icon">⚠️</span>
          <span class="exec-error-title">Execution Failed</span>
        </div>
        <div class="exec-error-reason">${App._escapeHtml(errorContext)}</div>
        <div class="exec-error-detail">
          <div class="exec-error-label">Error Details:</div>
          <code class="exec-error-code">${App._escapeHtml(errorMessage)}</code>
        </div>
        <div class="exec-error-tips">
          <strong>Possible fixes:</strong>
          <ul>
            <li>Check if <strong>Redis</strong> service is running in EasyPanel</li>
            <li>Verify <strong>REDIS_HOST</strong> environment variable is correct</li>
            <li>Check EasyPanel logs for more details</li>
            <li>Ensure the flow has valid steps</li>
          </ul>
        </div>
        <button class="btn btn-primary" onclick="Execution.backToSelect()" style="margin-top:16px">
          ← Back to Flow Selection
        </button>
      </div>
    `;

    document.getElementById('exec-status').innerHTML = '❌ Error';
    document.getElementById('exec-status').className = 'exec-status-badge failed';
    document.getElementById('exec-progress-bar').style.width = '0%';
    document.getElementById('exec-progress-text').textContent = 'Failed';
  },

  _showStepError(result) {
    const errorPanel = document.getElementById('exec-error-panel');
    if (!errorPanel) return;
    
    errorPanel.style.display = 'block';
    errorPanel.innerHTML = `
      <div class="exec-error-card compact">
        <div class="exec-error-header">
          <span class="exec-error-icon">❌</span>
          <span class="exec-error-title">Flow Failed at Step ${result.failedStep || '?'}</span>
        </div>
        <div class="exec-error-reason">${App._escapeHtml(result.error || 'Unknown error')}</div>
        ${result.details ? `<code class="exec-error-code">${App._escapeHtml(result.details)}</code>` : ''}
      </div>
    `;
  },

  backToSelect() {
    document.getElementById('execution-select').style.display = 'block';
    document.getElementById('execution-live-container').style.display = 'none';
    App.loadFlowsForSelect();
  },

  showDetails(execution) {
    this.currentExecutionId = execution.id;
    this.totalSteps = execution.total_steps;
    this.flowSteps = execution.steps || [];

    App.navigateTo('execution');
    
    setTimeout(() => {
      this._showLiveView();

      const statusText = `${execution.status === 'completed' ? '✅' : execution.status === 'failed' ? '❌' : '⏳'} ${execution.status}`;
      document.getElementById('exec-status').innerHTML = statusText;
      document.getElementById('exec-status').className = `exec-status-badge ${execution.status}`;

      const progress = (execution.current_step / execution.total_steps) * 100;
      document.getElementById('exec-progress-bar').style.width = `${progress}%`;
      document.getElementById('exec-progress-text').textContent = 
        `${execution.current_step} / ${execution.total_steps} steps`;

      // Show back button
      const backBtn = document.getElementById('exec-back-btn');
      if (backBtn) backBtn.style.display = 'inline-flex';

      // Render step history with staggered animation
      if (execution.steps) {
        execution.steps.forEach((step, i) => {
          setTimeout(() => {
            this._updateStepUI({
              step: step.step_index + 1,
              total: execution.total_steps,
              action: step.action,
              description: step.description,
              status: step.status,
              error: step.error_message,
              duration: step.duration_ms ? `${(step.duration_ms/1000).toFixed(1)}s` : '',
              screenshot: step.screenshot_path,
            });
          }, i * 100); // Stagger each step by 100ms
        });
      }

      // Show error info if failed
      if (execution.status === 'failed' && execution.error_message) {
        this._showStepError({
          error: execution.error_message,
          failedStep: execution.current_step,
        });
      }
    }, 300);
  },
};

// ─── Close modal on overlay click ──────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) App.closeModal();
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') App.closeModal();
  });
});

// ─── Initialize App ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());


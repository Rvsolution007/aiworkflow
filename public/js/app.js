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
      'flows': '📋 My Flows',
      'execution': '▶️ Run Flow',
      'history': '📊 History',
      'credentials': '🔐 Credentials',
      'settings': '⚙️ Settings',
    };
    document.getElementById('page-title').textContent = titles[section] || section;

    // Refresh data for section
    if (section === 'flows') this.loadFlows();
    if (section === 'history') this.loadExecutions();
    if (section === 'execution') this.loadFlowsForSelect();
    if (section === 'credentials') this.loadCredentials();
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
      el.innerHTML = `
        <p>🟢 Status: ${data.status}</p>
        <p>⏱️ Uptime: ${Math.floor(data.uptime / 60)} minutes</p>
        <p>💾 Memory: ${Math.round(data.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(data.memory.heapTotal / 1024 / 1024)}MB</p>
        <p>🕐 Server Time: ${new Date(data.timestamp).toLocaleString()}</p>
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

    grid.innerHTML = this.flows.map(flow => `
      <div class="flow-card" onclick="App.viewFlow(${flow.id})">
        <div class="flow-card-actions">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); App.executeFlow(${flow.id})" title="Run">▶️</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); App.deleteFlow(${flow.id})" title="Delete">🗑️</button>
        </div>
        <div class="flow-card-name">${this._escapeHtml(flow.name)}</div>
        <div class="flow-card-desc">${this._escapeHtml(flow.description || 'No description')}</div>
        <div class="flow-card-meta">
          <div class="flow-card-steps">⚡ ${flow.steps.length} steps</div>
          <div class="flow-card-category">${flow.category || 'general'}</div>
        </div>
      </div>
    `).join('');
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

    container.innerHTML = this.executions.map(exec => `
      <div class="history-card" onclick="App.viewExecution(${exec.id})">
        <div class="history-status-icon ${exec.status}">
          ${statusIcons[exec.status] || '❓'}
        </div>
        <div class="history-info">
          <div class="history-name">${this._escapeHtml(exec.flow_name)}</div>
          <div class="history-meta">
            <span>${exec.status}</span>
            <span>${exec.current_step}/${exec.total_steps} steps</span>
            <span>${new Date(exec.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ─── Actions ─────────────────────────────────────

  async viewFlow(id) {
    try {
      const res = await fetch(`/api/flows/${id}`);
      const data = await res.json();
      if (data.success) {
        this.navigateTo('ai-builder');
        FlowBuilder.setFlow({
          flowName: data.flow.name,
          description: data.flow.description,
          steps: data.flow.steps,
          category: data.flow.category,
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

  async run() {
    const select = document.getElementById('execute-flow-select');
    const flowId = select.value;

    if (!flowId) {
      App.toast('Please select a flow', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/execute/${flowId}`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        this.currentExecutionId = data.execution.id;
        this.totalSteps = data.execution.total_steps;
        this._showLiveView();
        App.toast('Flow queued for execution! ⚡', 'success');
      } else {
        App.toast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      App.toast(`Execution failed: ${err.message}`, 'error');
    }
  },

  handleProgress(data) {
    if (data.executionId !== this.currentExecutionId) return;

    if (data.event === 'status') {
      document.getElementById('exec-status').textContent = 
        `${data.status === 'running' ? '🔄' : data.status === 'completed' ? '✅' : '❌'} ${data.message || data.status}`;
    }

    if (data.event === 'step') {
      this._updateStepUI(data);
    }
  },

  handleComplete(data) {
    if (data.executionId !== this.currentExecutionId) return;
    
    const status = data.result?.status || 'unknown';
    App.toast(
      status === 'completed' ? 'Flow completed successfully! ✅' : `Flow ${status}`,
      status === 'completed' ? 'success' : 'error'
    );
    App.loadExecutions();
  },

  _showLiveView() {
    document.getElementById('execution-select').style.display = 'none';
    document.getElementById('execution-live-container').style.display = 'block';
    document.getElementById('exec-steps-list').innerHTML = '';
    document.getElementById('exec-progress-bar').style.width = '0%';
    document.getElementById('exec-progress-text').textContent = `0 / ${this.totalSteps} steps`;
    document.getElementById('exec-status').textContent = '⏳ Queued - Waiting for worker...';
  },

  _updateStepUI(data) {
    const list = document.getElementById('exec-steps-list');
    const progress = (data.step / data.total) * 100;

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

    // Check if step element already exists
    let stepEl = document.getElementById(`exec-step-${data.step}`);
    if (!stepEl) {
      stepEl = document.createElement('div');
      stepEl.id = `exec-step-${data.step}`;
      list.appendChild(stepEl);
    }

    stepEl.className = `exec-step ${data.status}`;
    stepEl.innerHTML = `
      <div class="exec-step-icon">${statusIcons[data.status] || '⚡'}</div>
      <div class="exec-step-content">
        <div class="exec-step-action">Step ${data.step}: ${data.action || ''}</div>
        <div class="exec-step-desc">${App._escapeHtml(data.description || data.message || '')}</div>
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

    list.scrollTop = list.scrollHeight;
  },

  showDetails(execution) {
    this.navigateTo('execution');
    this.currentExecutionId = execution.id;
    this.totalSteps = execution.total_steps;
    this._showLiveView();

    const statusText = `${execution.status === 'completed' ? '✅' : execution.status === 'failed' ? '❌' : '⏳'} ${execution.status}`;
    document.getElementById('exec-status').textContent = statusText;

    const progress = (execution.current_step / execution.total_steps) * 100;
    document.getElementById('exec-progress-bar').style.width = `${progress}%`;
    document.getElementById('exec-progress-text').textContent = 
      `${execution.current_step} / ${execution.total_steps} steps`;

    // Render step history
    if (execution.steps) {
      execution.steps.forEach(step => {
        this._updateStepUI({
          step: step.step_index + 1,
          total: execution.total_steps,
          action: step.action,
          description: step.description,
          status: step.status,
          duration: step.duration_ms ? `${(step.duration_ms/1000).toFixed(1)}s` : '',
          screenshot: step.screenshot_path,
        });
      });
    }
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

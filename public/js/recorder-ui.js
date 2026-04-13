/**
 * AI Flow Builder — Recorder UI
 * Frontend controls for Record & Replay mode.
 * Live step preview, step editing, and session management.
 */

const RecorderUI = {
  isRecording: false,
  recordedSteps: [],
  selectedProfile: 'default',

  /**
   * Initialize recorder UI
   */
  init() {
    // Listen for recorder WebSocket events
    WS.on('recorder_event', (data) => this._handleRecorderEvent(data));
  },

  /**
   * Start recording
   */
  async startRecording() {
    const profileName = document.getElementById('recorder-profile-select')?.value || 'default';
    this.selectedProfile = profileName;
    this.recordedSteps = [];

    // Update UI to recording state
    this._setRecordingUI(true, 'Starting browser...');

    try {
      const res = await fetch('/api/recorder/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName }),
      });
      const data = await res.json();

      if (data.success) {
        this.isRecording = true;
        this._setRecordingUI(true, 'Recording — Interact with the browser');
        this._renderRecordedSteps();
        App.toast('🔴 Recording started! Interact with the browser window.', 'success');
      } else {
        this._setRecordingUI(false);
        App.toast(`Failed: ${data.message || data.error}`, 'error');
      }
    } catch (err) {
      this._setRecordingUI(false);
      App.toast(`Error: ${err.message}`, 'error');
    }
  },

  /**
   * Stop recording
   */
  async stopRecording() {
    this._setRecordingUI(true, 'Stopping & saving session...');

    try {
      const res = await fetch('/api/recorder/stop', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        this.isRecording = false;
        this.recordedSteps = data.steps || [];
        this._setRecordingUI(false);
        this._renderRecordedSteps();
        this._showEditMode();
        App.toast(`✅ Recording stopped! ${data.stepCount} steps captured.`, 'success');
      } else {
        App.toast(`Stop failed: ${data.message}`, 'error');
      }
    } catch (err) {
      App.toast(`Error: ${err.message}`, 'error');
    }
  },

  /**
   * Discard recording
   */
  async discardRecording() {
    if (this.isRecording) {
      if (!confirm('Discard current recording?')) return;
    }

    try {
      await fetch('/api/recorder/discard', { method: 'POST' });
      this.isRecording = false;
      this.recordedSteps = [];
      this._setRecordingUI(false);
      this._renderRecordedSteps();
      App.toast('Recording discarded', 'info');
    } catch (err) {
      App.toast(`Error: ${err.message}`, 'error');
    }
  },

  /**
   * Save recorded flow
   */
  async saveRecordedFlow() {
    if (this.recordedSteps.length === 0) {
      App.toast('No steps to save', 'warning');
      return;
    }

    const name = document.getElementById('recorded-flow-name')?.value?.trim();
    if (!name) {
      App.toast('Please enter a flow name', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: `Recorded flow (${this.recordedSteps.length} steps)`,
          steps: this.recordedSteps,
          category: 'recorded',
        }),
      });

      const data = await res.json();
      if (data.success) {
        App.toast(`Flow "${name}" saved! ✅`, 'success');
        App.loadFlows();
        // Switch to flow builder view with the saved flow
        FlowBuilder.setFlow({
          flowName: name,
          description: `Recorded flow (${this.recordedSteps.length} steps)`,
          steps: this.recordedSteps,
          category: 'recorded',
        });
        this.recordedSteps = [];
        this._hideEditMode();
      } else {
        App.toast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      App.toast(`Save failed: ${err.message}`, 'error');
    }
  },

  // ─── Step Editing ───────────────────────────────

  /**
   * Remove a step
   */
  removeStep(index) {
    this.recordedSteps.splice(index, 1);
    this._renderRecordedSteps();
  },

  /**
   * Move a step up
   */
  moveStepUp(index) {
    if (index <= 0) return;
    const temp = this.recordedSteps[index];
    this.recordedSteps[index] = this.recordedSteps[index - 1];
    this.recordedSteps[index - 1] = temp;
    this._renderRecordedSteps();
  },

  /**
   * Move a step down
   */
  moveStepDown(index) {
    if (index >= this.recordedSteps.length - 1) return;
    const temp = this.recordedSteps[index];
    this.recordedSteps[index] = this.recordedSteps[index + 1];
    this.recordedSteps[index + 1] = temp;
    this._renderRecordedSteps();
  },

  // ─── Private Methods ───────────────────────────

  _handleRecorderEvent(data) {
    if (data.step) {
      this.recordedSteps.push(data.step);
      this._renderRecordedSteps();

      // Auto-scroll to latest step
      const list = document.getElementById('recorder-steps-list');
      if (list) list.scrollTop = list.scrollHeight;
    }
  },

  _setRecordingUI(recording, message) {
    const startBtn = document.getElementById('recorder-start-btn');
    const stopBtn = document.getElementById('recorder-stop-btn');
    const discardBtn = document.getElementById('recorder-discard-btn');
    const indicator = document.getElementById('recorder-indicator');
    const profileSelect = document.getElementById('recorder-profile-select');

    if (startBtn) startBtn.style.display = recording ? 'none' : 'inline-flex';
    if (stopBtn) stopBtn.style.display = recording ? 'inline-flex' : 'none';
    if (discardBtn) discardBtn.style.display = recording ? 'inline-flex' : 'none';
    if (profileSelect) profileSelect.disabled = recording;

    if (indicator) {
      if (recording) {
        indicator.style.display = 'flex';
        indicator.querySelector('.recorder-indicator-text').textContent = message || 'Recording...';
      } else {
        indicator.style.display = 'none';
      }
    }
  },

  _renderRecordedSteps() {
    const list = document.getElementById('recorder-steps-list');
    if (!list) return;

    if (this.recordedSteps.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding:30px">
          <div class="empty-state-icon">🎬</div>
          <div class="empty-state-text">No steps recorded yet</div>
          <div class="empty-state-subtext">Click Record and interact with the browser</div>
        </div>
      `;
      return;
    }

    const actionIcons = {
      navigate: '🌐', click: '👆', type: '⌨️', wait: '⏳',
      scroll: '📜', select: '📝', keyboard: '⌨️', screenshot: '📸',
    };

    list.innerHTML = this.recordedSteps.map((step, i) => `
      <div class="recorder-step" data-index="${i}">
        <div class="recorder-step-num">${i + 1}</div>
        <div class="recorder-step-icon">${actionIcons[step.action] || '⚡'}</div>
        <div class="recorder-step-content">
          <div class="recorder-step-action">${App._escapeHtml(step.action)}</div>
          <div class="recorder-step-desc">${App._escapeHtml(step.description || '')}</div>
        </div>
        <div class="recorder-step-actions">
          <button class="btn-step-action" onclick="RecorderUI.moveStepUp(${i})" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-step-action" onclick="RecorderUI.moveStepDown(${i})" title="Move down" ${i === this.recordedSteps.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn-step-action btn-step-delete" onclick="RecorderUI.removeStep(${i})" title="Remove">✕</button>
        </div>
      </div>
    `).join('');
  },

  _showEditMode() {
    const editPanel = document.getElementById('recorder-edit-panel');
    if (editPanel) editPanel.style.display = 'block';
  },

  _hideEditMode() {
    const editPanel = document.getElementById('recorder-edit-panel');
    if (editPanel) editPanel.style.display = 'none';
  },
};

// ─── Sessions Management UI ──────────────────────────

const SessionsUI = {
  sessions: [],

  async loadSessions() {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) {
        this.sessions = data.sessions;
        this._renderSessions();
      }
    } catch (err) {
      console.error('Failed to load sessions', err);
    }
  },

  async deleteSession(profileName) {
    if (!confirm(`Delete session "${profileName}"? You will need to login again.`)) return;
    try {
      const res = await fetch(`/api/sessions/${profileName}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        App.toast('Session deleted', 'success');
        this.loadSessions();
      }
    } catch (err) {
      App.toast('Delete failed', 'error');
    }
  },

  _renderSessions() {
    const container = document.getElementById('sessions-list');
    if (!container) return;

    if (this.sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:30px">
          <div class="empty-state-icon">🔐</div>
          <div class="empty-state-text">No saved sessions</div>
          <div class="empty-state-subtext">Sessions are saved automatically when you login during recording or execution</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.sessions.map(s => `
      <div class="session-card">
        <div class="session-icon">🍪</div>
        <div class="session-info">
          <div class="session-name">${App._escapeHtml(s.profileName)}</div>
          <div class="session-meta">
            <span>🍪 ${s.cookieCount} cookies</span>
            <span>🔗 ${(s.domains || []).join(', ')}</span>
            <span>📅 ${new Date(s.savedAt).toLocaleString()}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="SessionsUI.deleteSession('${App._escapeHtml(s.profileName)}')">🗑️</button>
      </div>
    `).join('');
  },
};

// ─── Timer UI ────────────────────────────────────────

const TimerUI = {
  async setTimer(flowId) {
    const flow = App.flows.find(f => f.id == flowId);
    if (!flow) return;

    App.showModal(`
      <div class="modal-title">⏱️ Auto-Repeat Timer</div>
      <div class="modal-flow-name">${App._escapeHtml(flow.name)}</div>
      <div class="input-group">
        <label class="input-label">Repeat Interval (minutes)</label>
        <input type="number" class="input" id="timer-interval" value="${flow.timer_interval_min || 40}" min="1" max="1440" placeholder="e.g., 40">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Flow will auto-run again after this many minutes from successful completion.
        </div>
      </div>
      <div class="input-group">
        <label class="input-label" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="timer-enabled" ${flow.timer_enabled ? 'checked' : ''}>
          <span>Enable Auto-Repeat</span>
        </label>
      </div>
      <div id="timer-status" style="margin-top:10px;font-size:12px;color:var(--text-muted)"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="TimerUI.saveTimer(${flowId})">💾 Save Timer</button>
      </div>
    `);

    // Load current timer status
    try {
      const res = await fetch('/api/timers');
      const data = await res.json();
      const timer = data.timers?.find(t => t.flowId == flowId);
      if (timer && timer.nextRun) {
        const nextRunTime = new Date(timer.nextRun).toLocaleTimeString();
        document.getElementById('timer-status').innerHTML = 
          `<span style="color:var(--success)">⏱️ Next run at: <strong>${nextRunTime}</strong></span>`;
      }
    } catch (e) {}
  },

  async saveTimer(flowId) {
    const enabled = document.getElementById('timer-enabled').checked;
    const intervalMinutes = parseInt(document.getElementById('timer-interval').value) || 0;

    if (enabled && intervalMinutes <= 0) {
      App.toast('Please enter a valid interval', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/timers/${flowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, intervalMinutes }),
      });
      const data = await res.json();

      if (data.success) {
        App.toast(enabled ? `⏱️ Timer set: repeat every ${intervalMinutes} min` : 'Timer disabled', 'success');
        App.closeModal();
        App.loadFlows();
      }
    } catch (err) {
      App.toast(`Failed: ${err.message}`, 'error');
    }
  },
};

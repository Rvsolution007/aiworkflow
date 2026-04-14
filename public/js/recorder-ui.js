/**
 * AI Flow Builder — Recorder UI (Remote Browser Viewer)
 * Frontend controls for Record & Replay mode.
 * Shows live browser screen from server and captures user interactions.
 */

const RecorderUI = {
  isRecording: false,
  recordedSteps: [],
  selectedProfile: 'default',
  _frameCount: 0,
  _lastFpsUpdate: 0,
  _receivedFirstFrame: false,
  _pendingStep: null,  // Step waiting for approval
  _isFullscreen: false,

  /**
   * Initialize recorder UI
   */
  init() {
    // Listen for recorder WebSocket events (step approval mode)
    WS.on('recorder_event', (data) => this._handleRecorderEvent(data));
    // Listen for screen frames from server
    WS.on('screen_frame', (data) => this._handleScreenFrame(data));

    // Setup remote browser viewer event handlers
    this._setupRemoteViewerEvents();
  },

  /**
   * Start recording
   */
  async startRecording() {
    const profileName = document.getElementById('recorder-profile-select')?.value || 'default';
    const startUrl = document.getElementById('recorder-start-url')?.value?.trim() || '';
    this.selectedProfile = profileName;
    this.recordedSteps = [];
    this._receivedFirstFrame = false;
    this._frameCount = 0;

    // Update UI to recording state
    this._setRecordingUI(true, 'Starting browser on server...');

    // Show remote browser viewer, hide instructions
    this._showViewer(true);

    try {
      const res = await fetch('/api/recorder/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName, startUrl }),
      });
      const data = await res.json();

      if (data.success) {
        this.isRecording = true;
        this._setRecordingUI(true, 'Recording — Use the viewer to interact');
        this._renderRecordedSteps();
        App.toast('🔴 Recording started! Interact using the Remote Browser Viewer.', 'success');
      } else {
        this._setRecordingUI(false);
        this._showViewer(false);
        App.toast(`Failed: ${data.message || data.error}`, 'error');
      }
    } catch (err) {
      this._setRecordingUI(false);
      this._showViewer(false);
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
        this._showViewer(false);
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
      this._showViewer(false);
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
          profileName: this.selectedProfile || 'default',
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

  removeStep(index) {
    this.recordedSteps.splice(index, 1);
    this._renderRecordedSteps();
  },

  moveStepUp(index) {
    if (index <= 0) return;
    const temp = this.recordedSteps[index];
    this.recordedSteps[index] = this.recordedSteps[index - 1];
    this.recordedSteps[index - 1] = temp;
    this._renderRecordedSteps();
  },

  moveStepDown(index) {
    if (index >= this.recordedSteps.length - 1) return;
    const temp = this.recordedSteps[index];
    this.recordedSteps[index] = this.recordedSteps[index + 1];
    this.recordedSteps[index + 1] = temp;
    this._renderRecordedSteps();
  },

  /**
   * Add a manual wait step to the recording
   */
  addWaitStep() {
    const secondsInput = document.getElementById('recorder-wait-seconds');
    const seconds = parseInt(secondsInput?.value) || 60;
    
    if (seconds < 1 || seconds > 300) {
      App.toast('Wait time must be between 1 and 300 seconds', 'warning');
      return;
    }

    const waitStep = {
      action: 'wait',
      description: `Wait ${seconds} seconds`,
      params: { duration: seconds * 1000 },
    };

    this.recordedSteps.push(waitStep);
    this._renderRecordedSteps();
    App.toast(`⏱ Added wait step: ${seconds} seconds`, 'success');
  },

  // ─── Fullscreen ─────────────────────────────────

  /**
   * Toggle fullscreen for the remote browser viewer
   */
  toggleFullscreen() {
    const viewer = document.getElementById('remote-browser-viewer');
    if (!viewer) return;

    if (!this._isFullscreen) {
      // Enter fullscreen
      if (viewer.requestFullscreen) viewer.requestFullscreen();
      else if (viewer.webkitRequestFullscreen) viewer.webkitRequestFullscreen();
      this._isFullscreen = true;
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      this._isFullscreen = false;
    }

    // Update button icon
    const btn = document.getElementById('remote-fullscreen-btn');
    if (btn) btn.textContent = this._isFullscreen ? '⛌' : '⛶';
  },

  // ─── Step Approval ──────────────────────────────

  /**
   * Show approval banner for a new step
   */
  _showStepApproval(step) {
    this._pendingStep = step;
    const banner = document.getElementById('step-approval-banner');
    const text = document.getElementById('step-approval-text');
    
    if (banner && text) {
      text.textContent = `${step.action}: ${step.description || 'New action detected'}`;
      banner.style.display = 'flex';
      banner.classList.add('step-approval-animate');
      setTimeout(() => banner.classList.remove('step-approval-animate'), 300);
    }
  },

  /**
   * Accept the pending step
   */
  approveStep() {
    if (!this._pendingStep) return;
    this.recordedSteps.push(this._pendingStep);
    this._renderRecordedSteps();
    App.toast(`✅ Step accepted: ${this._pendingStep.description || this._pendingStep.action}`, 'success');
    this._pendingStep = null;
    const banner = document.getElementById('step-approval-banner');
    if (banner) banner.style.display = 'none';
  },

  /**
   * Reject the pending step
   */
  rejectStep() {
    if (!this._pendingStep) return;
    App.toast(`❌ Step rejected: ${this._pendingStep.description || this._pendingStep.action}`, 'info');
    this._pendingStep = null;
    const banner = document.getElementById('step-approval-banner');
    if (banner) banner.style.display = 'none';
  },

  // ─── Remote Browser Viewer ─────────────────────

  /**
   * Setup mouse/keyboard event handlers on the remote browser viewer
   */
  _setupRemoteViewerEvents() {
    // DOM is already ready when init() is called (scripts at bottom of body)
    const screen = document.getElementById('remote-browser-screen');
    const wrapper = document.getElementById('remote-browser-canvas-wrapper');
    const urlInput = document.getElementById('remote-url-input');
    const urlGoBtn = document.getElementById('url-go-btn');
    const keyboardInput = document.getElementById('remote-keyboard-input');

    if (!screen || !wrapper) {
      console.warn('[RemoteViewer] Elements not found, retrying in 500ms...');
      setTimeout(() => this._setupRemoteViewerEvents(), 500);
      return;
    }

    console.log('[RemoteViewer] Event handlers registered successfully');

    // ─── Mouse Click ───────────────────────────
    screen.addEventListener('click', (e) => {
      if (!this.isRecording) return;
      e.preventDefault();
      const coords = this._getScaledCoords(e, screen);
      WS.send({ type: 'remote_click', x: coords.x, y: coords.y });

      // Show click ripple effect
      this._showClickRipple(e, wrapper);

      // Focus keyboard input for subsequent typing
      if (keyboardInput) keyboardInput.focus();
    });

    // ─── Mouse Move (throttled) ────────────────
    let lastMoveTime = 0;
    screen.addEventListener('mousemove', (e) => {
      if (!this.isRecording) return;
      const now = Date.now();
      if (now - lastMoveTime < 100) return;
      lastMoveTime = now;
      const coords = this._getScaledCoords(e, screen);
      WS.send({ type: 'remote_mousemove', x: coords.x, y: coords.y });
    });

    // ─── Mouse Scroll ──────────────────────────
    wrapper.addEventListener('wheel', (e) => {
      if (!this.isRecording) return;
      e.preventDefault();
      WS.send({ type: 'remote_scroll', deltaX: e.deltaX, deltaY: e.deltaY });
    }, { passive: false });

    // ─── Keyboard Input ────────────────────────
    if (keyboardInput) {
      keyboardInput.addEventListener('input', (e) => {
        if (!this.isRecording) return;
        const text = keyboardInput.value;
        if (text) {
          WS.send({ type: 'remote_type', text: text });
          keyboardInput.value = '';
        }
      });

      keyboardInput.addEventListener('keydown', (e) => {
        if (!this.isRecording) return;
        const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'Home', 'End', 'PageUp', 'PageDown'];
        if (specialKeys.includes(e.key)) {
          e.preventDefault();
          WS.send({ type: 'remote_key', key: e.key });
        }
      });
    }

    // When clicking the screen, focus keyboard input
    screen.addEventListener('mousedown', () => {
      if (keyboardInput) {
        setTimeout(() => keyboardInput.focus(), 50);
      }
    });

    // ─── URL Bar ───────────────────────────────
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._navigateToUrl(urlInput.value.trim());
        }
      });
    }

    if (urlGoBtn) {
      urlGoBtn.addEventListener('click', () => {
        const url = document.getElementById('remote-url-input')?.value?.trim();
        if (url) this._navigateToUrl(url);
      });
    }
  },

  /**
   * Navigate to URL via WebSocket
   */
  _navigateToUrl(url) {
    if (!url || !this.isRecording) return;
    WS.send({ type: 'remote_navigate', url });
    App.toast(`Navigating to ${url}...`, 'info');
  },

  /**
   * Get mouse coordinates scaled to the actual browser viewport
   */
  _getScaledCoords(event, imgElement) {
    const rect = imgElement.getBoundingClientRect();
    const scaleX = imgElement.naturalWidth / rect.width;
    const scaleY = imgElement.naturalHeight / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  },

  /**
   * Show click ripple animation at click position
   */
  _showClickRipple(event, container) {
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    const rect = container.getBoundingClientRect();
    ripple.style.left = (event.clientX - rect.left) + 'px';
    ripple.style.top = (event.clientY - rect.top) + 'px';
    container.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  },

  /**
   * Handle incoming screen frame from server
   */
  _handleScreenFrame(data) {
    const screen = document.getElementById('remote-browser-screen');
    const loading = document.getElementById('remote-browser-loading');
    const urlInput = document.getElementById('remote-url-input');
    const fpsEl = document.getElementById('remote-fps');

    if (screen && data.frame) {
      screen.src = 'data:image/jpeg;base64,' + data.frame;

      // Hide loading on first frame and force-show the image
      if (!this._receivedFirstFrame) {
        this._receivedFirstFrame = true;
        console.log('[RemoteViewer] First frame received! Showing browser screen.');
        // Force hide loading overlay
        if (loading) {
          loading.style.display = 'none';
          loading.style.visibility = 'hidden';
          loading.style.zIndex = '-1';
        }
        // Force show the browser screen image
        screen.style.display = 'block';
        screen.style.visibility = 'visible';
        screen.style.minHeight = '300px';
        screen.style.zIndex = '10';
        screen.style.position = 'relative';
      }

      // Update URL bar only when user is NOT actively editing it
      if (urlInput && data.url && document.activeElement !== urlInput) {
        urlInput.value = data.url;
      }

      // FPS counter
      this._frameCount++;
      const now = Date.now();
      if (now - this._lastFpsUpdate > 1000) {
        const fps = this._frameCount;
        this._frameCount = 0;
        this._lastFpsUpdate = now;
        if (fpsEl) fpsEl.textContent = `${fps} FPS`;
      }
    }
  },

  /**
   * Show/hide the remote browser viewer
   */
  _showViewer(show) {
    const viewer = document.getElementById('remote-browser-viewer');
    const instructions = document.getElementById('recorder-instructions');
    const loading = document.getElementById('remote-browser-loading');
    const screen = document.getElementById('remote-browser-screen');

    if (show) {
      if (viewer) viewer.style.display = 'block';
      if (instructions) instructions.style.display = 'none';
      if (loading) loading.style.display = 'flex';
      if (screen) screen.style.display = 'none';
      this._receivedFirstFrame = false;
    } else {
      if (viewer) viewer.style.display = 'none';
      if (instructions) instructions.style.display = 'block';
    }
  },

  // ─── Private Methods ───────────────────────────

  _handleRecorderEvent(data) {
    if (data.step) {
      // Auto-approve navigation and wait steps (these are just URL changes)
      const autoApproveActions = ['navigate', 'wait'];
      if (autoApproveActions.includes(data.step.action)) {
        this.recordedSteps.push(data.step);
        this._renderRecordedSteps();
      } else {
        // Show approval banner for action steps (click, type, keyboard, scroll)
        this._showStepApproval(data.step);
      }

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
    const waitControls = document.getElementById('recorder-wait-controls');
    const startUrlGroup = document.getElementById('recorder-start-url')?.parentElement;

    if (startBtn) startBtn.style.display = recording ? 'none' : 'inline-flex';
    if (stopBtn) stopBtn.style.display = recording ? 'inline-flex' : 'none';
    if (discardBtn) discardBtn.style.display = recording ? 'inline-flex' : 'none';
    if (profileSelect) profileSelect.disabled = recording;
    if (waitControls) waitControls.style.display = recording ? 'block' : 'none';
    if (startUrlGroup) startUrlGroup.style.display = recording ? 'none' : 'block';

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
    const countEl = document.getElementById('recorder-step-count');
    if (!list) return;

    if (countEl) countEl.textContent = `${this.recordedSteps.length} steps`;

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

    const isEnabled = flow.timer_enabled ? true : false;
    const currentInterval = flow.timer_interval_min || 30;

    App.showModal(`
      <div class="modal-title">⏱️ Auto-Execution Timer</div>
      <div class="modal-flow-name">${App._escapeHtml(flow.name)}</div>
      
      <div class="timer-modal-section">
        <div class="timer-enable-row">
          <label class="timer-switch-label">
            <span class="timer-switch-text">Auto-Repeat After Completion</span>
            <div class="timer-switch">
              <input type="checkbox" id="timer-enabled" ${isEnabled ? 'checked' : ''} onchange="TimerUI._toggleUI()">
              <span class="timer-switch-slider"></span>
            </div>
          </label>
        </div>
      </div>

      <div id="timer-config-area" style="${isEnabled ? '' : 'opacity:0.4;pointer-events:none;'}">
        <div class="timer-modal-section">
          <label class="input-label">Repeat Interval</label>
          <div class="timer-quick-btns">
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(15)">15m</button>
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(30)">30m</button>
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(45)">45m</button>
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(60)">1hr</button>
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(120)">2hr</button>
            <button class="btn btn-sm timer-quick-btn" onclick="TimerUI._setQuick(360)">6hr</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
            <input type="number" class="input" id="timer-interval" value="${currentInterval}" min="1" max="1440" style="flex:1">
            <span style="color:var(--text-muted);font-size:13px">minutes</span>
          </div>
        </div>

        <div class="timer-modal-info">
          <div class="timer-info-icon">ℹ️</div>
          <div class="timer-info-text">
            <strong>How it works:</strong> When you run this flow and it completes successfully, the timer starts counting. After the interval, it auto-runs again. This loop continues until you turn it OFF.
            <br><br>
            <strong>Example:</strong> If interval is 30 min and flow completes at 9:30, next run starts at 10:00.
            <br>If flow fails, the timer pauses until next manual run succeeds.
          </div>
        </div>
      </div>

      <div id="timer-status" style="margin-top:12px;font-size:12px;color:var(--text-muted)"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="TimerUI.saveTimer(${flowId})">💾 Save Timer</button>
      </div>
    `);

    // Highlight current interval
    this._highlightQuickBtn(currentInterval);

    // Load current timer status
    try {
      const res = await fetch('/api/timers');
      const data = await res.json();
      const timer = data.timers?.find(t => t.flowId == flowId);
      if (timer) {
        if (timer.nextRun) {
          const nextRunTime = new Date(timer.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const remaining = new Date(timer.nextRun).getTime() - Date.now();
          const mins = Math.floor(remaining / 60000);
          const secs = Math.floor((remaining % 60000) / 1000);
          document.getElementById('timer-status').innerHTML = 
            `<span style="color:var(--success)">⏱️ Next execution at <strong>${nextRunTime}</strong> (in ${mins}m ${secs}s)</span>`;
        } else if (timer.waitingForExecution) {
          document.getElementById('timer-status').innerHTML = 
            `<span style="color:var(--warning)">⏸ Timer active — waiting for first successful execution to start loop</span>`;
        } else if (timer.running) {
          document.getElementById('timer-status').innerHTML = 
            `<span style="color:var(--info)">🔄 Currently executing...</span>`;
        }
      }
    } catch (e) {}
  },

  _toggleUI() {
    const enabled = document.getElementById('timer-enabled').checked;
    const area = document.getElementById('timer-config-area');
    if (area) {
      area.style.opacity = enabled ? '1' : '0.4';
      area.style.pointerEvents = enabled ? 'auto' : 'none';
    }
  },

  _setQuick(minutes) {
    const input = document.getElementById('timer-interval');
    if (input) input.value = minutes;
    this._highlightQuickBtn(minutes);
  },

  _highlightQuickBtn(minutes) {
    document.querySelectorAll('.timer-quick-btn').forEach(btn => {
      const labelMap = { '15m': 15, '30m': 30, '45m': 45, '1hr': 60, '2hr': 120, '6hr': 360 };
      const val = labelMap[btn.textContent] || 0;
      btn.classList.toggle('active', val === minutes);
    });
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
        App.toast(
          enabled ? `⏱️ Auto-repeat set: every ${intervalMinutes} min after completion` : '⏱️ Auto-repeat disabled',
          'success'
        );
        App.closeModal();
        App.loadFlows();
        App._loadTimerStatuses();
      }
    } catch (err) {
      App.toast(`Failed: ${err.message}`, 'error');
    }
  },
};

/**
 * AI Flow Builder — Flow Builder UI
 * Manages flow step preview, editing, and saving.
 */

const FlowBuilder = {
  currentFlow: null,
  flowId: null, // Track existing flow ID for update vs create

  /**
   * Set flow data and render preview
   */
  setFlow(flow) {
    this.currentFlow = flow;
    this.flowId = flow.id || null; // Store flow ID if editing existing flow
    this.renderSteps(flow.steps);

    // Show actions and footer
    document.getElementById('flow-preview-actions').style.display = 'flex';
    document.getElementById('flow-preview-footer').style.display = 'flex';

    // Set flow name in input
    const nameInput = document.getElementById('flow-name-input');
    nameInput.value = flow.flowName || flow.name || '';
  },

  /**
   * Render step list in preview panel
   */
  renderSteps(steps) {
    const container = document.getElementById('flow-steps-list');

    if (!steps || steps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🤖</div>
          <div class="empty-state-text">No steps in this flow</div>
          <div class="empty-state-subtext">Chat with AI or record to add steps</div>
        </div>
      `;
      return;
    }

    const actionIcons = {
      navigate: '🌐',
      click: '👆',
      type: '⌨️',
      wait: '⏳',
      screenshot: '📸',
      scroll: '📜',
      select: '📝',
      conditional_login: '🔐',
      wait_for_element: '👀',
      wait_for_navigation: '🔄',
      keyboard: '⌨️',
      extract_text: '📄',
    };

    container.innerHTML = `
      <div class="flow-steps-count">${steps.length} steps</div>
      ${steps.map((step, i) => `
        <div class="flow-step" data-index="${i}">
          <div class="flow-step-index">${i + 1}</div>
          <div class="flow-step-content">
            <div class="flow-step-action">
              ${actionIcons[step.action] || '⚡'} ${(step.action || '').toUpperCase()}
            </div>
            <div class="flow-step-desc" title="${this._escapeHtml(step.description || '')}">
              ${step.description || this._getStepSummary(step)}
            </div>
          </div>
          <button class="flow-step-delete-btn" onclick="event.stopPropagation(); FlowBuilder.removeStep(${i})" title="Delete this step">✕</button>
        </div>
      `).join('')}
    `;
  },

  /**
   * Remove a step from the current flow
   */
  removeStep(index) {
    if (!this.currentFlow || !this.currentFlow.steps) return;
    const removedStep = this.currentFlow.steps[index];
    this.currentFlow.steps.splice(index, 1);
    this.renderSteps(this.currentFlow.steps);
    App.toast(`Step ${index + 1} removed: ${removedStep?.action || 'unknown'}`, 'info');
  },

  /**
   * Save the current flow (creates new or updates existing)
   */
  async saveFlow() {
    if (!this.currentFlow) {
      App.toast('No flow to save', 'warning');
      return;
    }

    const name = document.getElementById('flow-name-input').value.trim();
    if (!name) {
      App.toast('Please enter a flow name', 'warning');
      return;
    }

    try {
      let response;
      const payload = {
        name,
        description: this.currentFlow.description || '',
        steps: this.currentFlow.steps,
        category: this.currentFlow.category || 'general',
        profileName: this.currentFlow.profileName || 'default',
      };

      if (this.flowId) {
        // UPDATE existing flow
        response = await fetch(`/api/flows/${this.flowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // CREATE new flow
        response = await fetch('/api/flows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();

      if (data.success) {
        // Store the ID so future saves update instead of creating duplicates
        this.flowId = data.flow.id;
        App.toast(`Flow "${name}" ${this.flowId ? 'updated' : 'saved'}! ✅`, 'success');
        App.loadFlows();
        return data.flow;
      } else {
        App.toast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      App.toast(`Save failed: ${err.message}`, 'error');
    }
    return null;
  },

  /**
   * Save and immediately execute
   */
  async saveAndExecute() {
    const flow = await this.saveFlow();
    if (flow) {
      App.navigateTo('execution');
      setTimeout(() => {
        document.getElementById('execute-flow-select').value = flow.id;
        Execution.run();
      }, 300);
    }
  },

  /**
   * Clear the current flow
   */
  clearFlow() {
    this.currentFlow = null;
    this.flowId = null;
    document.getElementById('flow-preview-actions').style.display = 'none';
    document.getElementById('flow-preview-footer').style.display = 'none';
    this.renderSteps([]);
  },

  /**
   * Get a summary for a step based on its params
   */
  _getStepSummary(step) {
    const p = step.params || {};
    switch (step.action) {
      case 'navigate': return `Go to ${p.url || ''}`;
      case 'click': return `Click "${p.selector || p.text || ''}"`;
      case 'type': return `Type "${(p.text || p.value || '').substring(0, 30)}" into ${p.selector || ''}`;
      case 'wait': return `Wait ${p.duration || p.ms || 0}ms`;
      case 'scroll': return `Scroll ${p.direction || 'down'} ${p.pixels || 300}px`;
      default: return JSON.stringify(p).substring(0, 60);
    }
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};

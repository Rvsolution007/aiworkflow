/**
 * AI Flow Builder — AI Chat Interface
 * Handles AI conversation and flow generation.
 */

const AIChat = {
  history: [],
  isLoading: false,
  currentFlow: null,

  /**
   * Send a message to the AI
   */
  async send() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || this.isLoading) return;

    input.value = '';
    this.isLoading = true;
    this._toggleSendBtn(false);

    // Add user message to chat
    this._addMessage('user', message);

    // Add loading indicator
    const loadingId = this._addLoading();

    try {
      // Call AI generate endpoint
      const response = await fetch('/api/flows/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: message,
        }),
      });

      const data = await response.json();
      this._removeLoading(loadingId);

      if (data.success && data.flow) {
        this.currentFlow = data.flow;

        // Add AI response
        const stepsSummary = data.flow.steps.map((s, i) => 
          `${i + 1}. **${s.action}** — ${s.description}`
        ).join('\n');

        this._addMessage('ai', 
          `✅ I've generated a flow: **"${data.flow.flowName}"**\n\n` +
          `${data.flow.description || ''}\n\n` +
          `**${data.flow.steps.length} steps generated.** Check the preview panel on the right to review and save.`
        );

        // Update flow preview
        FlowBuilder.setFlow(data.flow);

        // Add to history
        this.history.push(
          { role: 'user', content: message },
          { role: 'model', content: `Generated flow: ${data.flow.flowName}` }
        );
      } else {
        this._addMessage('ai', `❌ Error: ${data.error || 'Failed to generate flow'}`);
      }
    } catch (err) {
      this._removeLoading(loadingId);
      this._addMessage('ai', `❌ Connection error: ${err.message}`);
    }

    this.isLoading = false;
    this._toggleSendBtn(true);
  },

  /**
   * Add message to chat UI
   */
  _addMessage(type, text) {
    const container = document.getElementById('chat-messages');
    const avatar = type === 'ai' ? '🧠' : '👤';

    // Convert basic markdown to HTML
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    const msg = document.createElement('div');
    msg.className = `chat-message ${type}`;
    msg.innerHTML = `
      <div class="chat-avatar">${avatar}</div>
      <div class="chat-bubble">${html}</div>
    `;

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  /**
   * Add loading indicator
   */
  _addLoading() {
    const container = document.getElementById('chat-messages');
    const id = 'loading-' + Date.now();

    const msg = document.createElement('div');
    msg.className = 'chat-message ai';
    msg.id = id;
    msg.innerHTML = `
      <div class="chat-avatar">🧠</div>
      <div class="chat-bubble">
        <div class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>
        Generating flow...
      </div>
    `;

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return id;
  },

  _removeLoading(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  },

  _toggleSendBtn(enabled) {
    const btn = document.getElementById('chat-send-btn');
    btn.disabled = !enabled;
  },
};

// Enter key to send
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') AIChat.send();
    });
  }
});

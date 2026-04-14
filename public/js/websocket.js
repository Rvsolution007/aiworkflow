/**
 * AI Flow Builder — WebSocket Client
 * Real-time execution progress updates.
 */

const WS = {
  socket: null,
  reconnectAttempts: 0,
  maxReconnects: 10,
  reconnectDelay: 2000,
  listeners: {},

  /**
   * Connect to WebSocket server
   */
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('✅ WebSocket connected');
        this.reconnectAttempts = 0;
        this._updateStatus(true);
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      this.socket.onclose = () => {
        console.log('❌ WebSocket disconnected');
        this._updateStatus(false);
        this._reconnect();
      };

      this.socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        this._updateStatus(false);
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
      this._updateStatus(false);
      this._reconnect();
    }
  },

  /**
   * Register event listener
   * @param {string} type - Message type
   * @param {function} callback - Handler function
   */
  on(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },

  /**
   * Remove event listener
   */
  off(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },

  /**
   * Handle incoming message
   */
  _handleMessage(data) {
    const { type, ...rest } = data;
    
    // Call registered listeners
    if (this.listeners[type]) {
      this.listeners[type].forEach(cb => cb(rest));
    }

    // Also emit to wildcard listeners
    if (this.listeners['*']) {
      this.listeners['*'].forEach(cb => cb(data));
    }
  },

  /**
   * Send a message to the server
   */
  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  },

  /**
   * Auto-reconnect with exponential backoff
   */
  _reconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => this.connect(), delay);
  },

  /**
   * Update connection status in sidebar
   */
  _updateStatus(connected) {
    const dot = document.getElementById('ws-status');
    const text = document.getElementById('ws-status-text');
    
    if (connected) {
      dot.classList.remove('offline');
      text.textContent = 'Connected';
    } else {
      dot.classList.add('offline');
      text.textContent = 'Disconnected';
    }
  },
};

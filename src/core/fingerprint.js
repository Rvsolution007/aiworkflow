/**
 * AI Flow Builder — Browser Fingerprint Generator v2
 * Creates coherent browser fingerprints where ALL properties match.
 * 
 * v2 enhancements:
 * - Updated Chrome versions to 135.x (latest stable)
 * - Added AudioContext fingerprint noise injection
 * - Added Battery API spoofing
 * - Added WebRTC IP leak prevention
 * - Added navigator.connection spoofing
 * - Added Performance.now() timing noise
 * - Added canvas noise injection
 * - More diverse profiles (8 instead of 4)
 */

const { randomInt } = require('../utils/helpers');

// ─── Fingerprint Profiles ─────────────────────────────────────────
// Each profile is a complete, consistent identity
// Updated to Chrome 135.x (April 2026 stable)

const PROFILES = [
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    screenRes: { width: 1920, height: 1080 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en-US', 'en'],
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 10,
    connectionRtt: 50,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    screenRes: { width: 1366, height: 768 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en'],
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 4,
    deviceMemory: 8,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 8.5,
    connectionRtt: 100,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1536, height: 864 },
    screenRes: { width: 1536, height: 864 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en-US', 'en', 'hi'],
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 6,
    deviceMemory: 16,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 15,
    connectionRtt: 50,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    screenRes: { width: 1440, height: 900 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 12,
    deviceMemory: 16,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 20,
    connectionRtt: 25,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 900 },
    screenRes: { width: 1600, height: 900 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en-US', 'en'],
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 12,
    connectionRtt: 75,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    screenRes: { width: 1280, height: 720 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'hi', 'en'],
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 4,
    deviceMemory: 4,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 5.5,
    connectionRtt: 150,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1200 },
    screenRes: { width: 1920, height: 1200 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-US',
    languages: ['en-US', 'en-IN', 'en'],
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 12,
    deviceMemory: 32,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 25,
    connectionRtt: 25,
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1680, height: 1050 },
    screenRes: { width: 1680, height: 1050 },
    colorDepth: 24,
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en'],
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 6,
    deviceMemory: 8,
    maxTouchPoints: 0,
    connectionType: '4g',
    connectionDownlink: 10,
    connectionRtt: 100,
  },
];

/**
 * Get a random coherent fingerprint profile
 */
function getRandomProfile() {
  return { ...PROFILES[randomInt(0, PROFILES.length - 1)] };
}

/**
 * Generate JavaScript to inject into page for fingerprint spoofing
 * v2 — Enhanced with AudioContext, Battery, WebRTC, Connection, Canvas noise
 * @param {object} profile - Fingerprint profile
 * @returns {string} JavaScript code to evaluate in page context
 */
function generateFingerprintScript(profile) {
  return `
    // ─── Navigator Overrides ────────────────────────────
    Object.defineProperty(navigator, 'platform', { get: () => '${profile.platform}' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${profile.deviceMemory} });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => ${profile.maxTouchPoints} });
    Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(profile.languages)} });
    Object.defineProperty(navigator, 'language', { get: () => '${profile.languages[0]}' });

    // ─── WebDriver Flag ─────────────────────────────────
    // rebrowser-puppeteer-core handles this at CDP level, but triple-ensure
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    try { delete navigator.__proto__.webdriver; } catch(e) {}

    // ─── Chrome Runtime ─────────────────────────────────
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        connect: function() { return { onDisconnect: { addListener: function() {} } }; },
        sendMessage: function() {},
      };
    }

    // ─── Permissions API ────────────────────────────────
    const originalQuery = window.Notification && Notification.permission
      ? Notification.permission
      : undefined;
    if (navigator.permissions) {
      const originalPermQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: originalQuery || 'prompt' });
        }
        return originalPermQuery.call(navigator.permissions, parameters);
      };
    }

    // ─── Plugins ────────────────────────────────────────
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // ─── Screen Properties ──────────────────────────────
    Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.colorDepth} });
    Object.defineProperty(screen, 'width', { get: () => ${profile.screenRes.width} });
    Object.defineProperty(screen, 'height', { get: () => ${profile.screenRes.height} });
    Object.defineProperty(screen, 'availWidth', { get: () => ${profile.screenRes.width} });
    Object.defineProperty(screen, 'availHeight', { get: () => ${profile.screenRes.height - 40} });

    // ─── WebGL Spoofing ─────────────────────────────────
    const getParameterProxyHandler = {
      apply: function(target, thisArg, args) {
        const param = args[0];
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return '${profile.webglVendor}';
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return '${profile.webglRenderer}';
        return Reflect.apply(target, thisArg, args);
      }
    };

    const canvasProto = HTMLCanvasElement.prototype;
    const origGetContext = canvasProto.getContext;
    canvasProto.getContext = function(type, ...args) {
      const context = origGetContext.call(this, type, ...args);
      if (context && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
        const origGetParameter = context.getParameter.bind(context);
        context.getParameter = new Proxy(origGetParameter, getParameterProxyHandler);
      }
      return context;
    };

    // ═══════════════════════════════════════════════════════
    // ═══ NEW v2 — Enhanced Anti-Detection Below ═══════════
    // ═══════════════════════════════════════════════════════

    // ─── AudioContext Fingerprint Noise ──────────────────
    // Google uses audio rendering fingerprint — inject subtle noise
    (function() {
      const origCreateOscillator = AudioContext.prototype.createOscillator;
      const origCreateAnalyser = AudioContext.prototype.createAnalyser;
      const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      const audioNoise = ${(Math.random() * 0.0001).toFixed(10)};
      
      // Add subtle noise to frequency data
      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        origGetFloat.call(this, array);
        if (array && array.length) {
          for (let i = 0; i < array.length; i++) {
            array[i] += audioNoise * (Math.random() - 0.5);
          }
        }
      };

      // Also noise OfflineAudioContext rendering
      if (typeof OfflineAudioContext !== 'undefined') {
        const origRenderAudio = OfflineAudioContext.prototype.startRendering;
        OfflineAudioContext.prototype.startRendering = function() {
          return origRenderAudio.call(this).then(buffer => {
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i += 100) {
              data[i] += audioNoise * (Math.random() - 0.5);
            }
            return buffer;
          });
        };
      }
    })();

    // ─── Canvas Fingerprint Noise ────────────────────────
    // Inject subtle pixel noise into canvas reads
    (function() {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      const canvasNoise = ${(Math.random() * 0.01).toFixed(10)};
      
      HTMLCanvasElement.prototype.toDataURL = function() {
        try {
          const ctx = this.getContext('2d');
          if (ctx && this.width > 0 && this.height > 0) {
            const imageData = ctx.getImageData(0, 0, Math.min(this.width, 5), Math.min(this.height, 5));
            // Modify a few pixels slightly
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (canvasNoise > 0.005 ? 1 : 0)));
            }
            ctx.putImageData(imageData, 0, 0);
          }
        } catch(e) {}
        return origToDataURL.apply(this, arguments);
      };
    })();

    // ─── Battery API Spoofing ────────────────────────────
    // Headless mode has no battery — spoof as real laptop
    if (navigator.getBattery) {
      const fakeBattery = {
        charging: ${Math.random() > 0.3 ? 'true' : 'false'},
        chargingTime: ${Math.random() > 0.5 ? 'Infinity' : randomInt(1800, 7200)},
        dischargingTime: ${randomInt(3600, 28800)},
        level: ${(Math.random() * 0.6 + 0.3).toFixed(2)},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return true; },
      };
      // Define as event target properties
      ['onchargingchange', 'onchargingtimechange', 'ondischargingtimechange', 'onlevelchange'].forEach(evt => {
        fakeBattery[evt] = null;
      });
      navigator.getBattery = () => Promise.resolve(fakeBattery);
    }

    // ─── navigator.connection Spoofing ──────────────────
    // Missing in headless — spoof as real 4G connection
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '${profile.connectionType || '4g'}',
          downlink: ${profile.connectionDownlink || 10},
          rtt: ${profile.connectionRtt || 50},
          saveData: false,
          type: 'wifi',
          addEventListener: function() {},
          removeEventListener: function() {},
        }),
        configurable: true,
      });
    }

    // ─── Performance.now() Timing Noise ─────────────────
    // Headless has different timing precision — add micro noise
    (function() {
      const origPerformanceNow = Performance.prototype.now;
      const timeNoise = ${(Math.random() * 0.1).toFixed(6)};
      Performance.prototype.now = function() {
        return origPerformanceNow.call(this) + timeNoise * Math.random();
      };
    })();

    // ─── WebRTC Local IP Prevention ─────────────────────
    // Prevent real IP leak via WebRTC (Google checks this!)
    (function() {
      const origRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (origRTCPeerConnection) {
        const patchedRTC = function(config, constraints) {
          // Force use of relay-only ICE to prevent local IP exposure
          if (config && config.iceServers) {
            config.iceTransportPolicy = 'relay';
          }
          return new origRTCPeerConnection(config, constraints);
        };
        patchedRTC.prototype = origRTCPeerConnection.prototype;
        window.RTCPeerConnection = patchedRTC;
        if (window.webkitRTCPeerConnection) {
          window.webkitRTCPeerConnection = patchedRTC;
        }
      }
    })();

    // ─── Media Devices Spoofing ─────────────────────────
    // Real browsers have media devices, headless doesn't
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const origEnumerate = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = function() {
        return origEnumerate.call(navigator.mediaDevices).then(devices => {
          if (devices.length === 0) {
            // Return fake devices if none found (headless indicator)
            return [
              { deviceId: 'default', groupId: 'default', kind: 'audioinput', label: '' },
              { deviceId: 'communications', groupId: 'default', kind: 'audioinput', label: '' },
              { deviceId: 'default', groupId: 'default', kind: 'audiooutput', label: '' },
              { deviceId: 'default', groupId: 'default', kind: 'videoinput', label: '' },
            ];
          }
          return devices;
        });
      };
    }

    // ─── Iframe contentWindow ───────────────────────────
    // Ensure iframes also get the same overrides
    const origCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName, ...args) {
      const element = origCreateElement(tagName, ...args);
      if (tagName.toLowerCase() === 'iframe') {
        const origSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
        // The overrides will be applied via evaluateOnNewDocument
      }
      return element;
    };

    // ─── Prevent CDP Detection ──────────────────────────
    // Some sites detect Chrome DevTools Protocol usage
    (function() {
      // Remove debugger traces
      const origToString = Function.prototype.toString;
      Function.prototype.toString = function() {
        if (this === Function.prototype.toString) return 'function toString() { [native code] }';
        if (this === navigator.permissions.query) return 'function query() { [native code] }';
        return origToString.call(this);
      };
    })();
  `;
}

module.exports = { getRandomProfile, generateFingerprintScript, PROFILES };

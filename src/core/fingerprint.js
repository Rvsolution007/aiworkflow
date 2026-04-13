/**
 * AI Flow Builder — Browser Fingerprint Generator
 * Creates coherent browser fingerprints where ALL properties match.
 * This prevents detection via fingerprint inconsistencies.
 */

const { randomInt } = require('../utils/helpers');

// ─── Fingerprint Profiles ─────────────────────────────────────────
// Each profile is a complete, consistent identity

const PROFILES = [
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
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
  },
  {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    // rebrowser-puppeteer-core handles this at CDP level, but double-ensure
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;

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
  `;
}

module.exports = { getRandomProfile, generateFingerprintScript, PROFILES };

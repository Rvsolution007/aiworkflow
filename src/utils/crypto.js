/**
 * AI Flow Builder — Cryptographic Utilities
 * AES-256-GCM encryption with PBKDF2 key derivation.
 * Military-grade encryption for credential storage.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';

/**
 * Derive a 256-bit key from a master password using PBKDF2
 * @param {string} password - Master password
 * @param {Buffer} salt - Random salt
 * @returns {Buffer} 256-bit key
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @param {string} masterPassword - Master password for key derivation
 * @returns {string} Encrypted string (salt:iv:authTag:ciphertext) in hex
 */
function encrypt(plaintext, masterPassword) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterPassword, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:ciphertext (all in hex)
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param {string} encryptedData - Encrypted string from encrypt()
 * @param {string} masterPassword - Master password used during encryption
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails (wrong password or tampered data)
 */
function decrypt(encryptedData, masterPassword) {
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [saltHex, ivHex, authTagHex, ciphertext] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = deriveKey(masterPassword, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a random hex string
 * @param {number} length - Number of bytes
 * @returns {string} Random hex string
 */
function randomHex(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = { encrypt, decrypt, deriveKey, randomHex };

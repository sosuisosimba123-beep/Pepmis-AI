import PocketBase from 'pocketbase';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const pbUrl = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
export const pb = new PocketBase(pbUrl);

// Disable auto-cancellation for concurrent server requests
pb.autoCancellation(false);

// AES-256-GCM Encryption key derived from ENCRYPTION_SECRET in .env
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'pepmis-ai-secret-encryption-key-32b';
const DERIVED_KEY = crypto.scryptSync(ENCRYPTION_SECRET, 'pepmis_salt_2026', 32);

/**
 * Encrypts sensitive text using AES-256-GCM
 * @param {string} text
 * @returns {string} ivHex:authTagHex:encryptedHex
 */
export function encryptCredential(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted text
 * @param {string} cipherText
 * @returns {string} Decrypted plain text
 */
export function decryptCredential(cipherText) {
  if (!cipherText || !cipherText.includes(':')) return '';
  try {
    const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[Decryption Error]: Unable to decrypt stored credential.', err.message);
    return '';
  }
}

/**
 * Authenticates as admin if admin credentials are provided in .env
 */
export async function authenticatePocketBase() {
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;

  if (email && password) {
    try {
      await pb.admins.authWithPassword(email, password);
      console.log('✅ PocketBase authenticated as Admin successfully.');
    } catch (err) {
      console.warn('⚠️ PocketBase admin auth notice:', err.message);
    }
  }
}

/**
 * Logs a PEPMIS submission entry into PocketBase ('pepmis_submissions' collection)
 * @param {Object} logData
 */
export async function logSubmission({ senderId, checkNumber, reportText, status, details }) {
  try {
    const record = await pb.collection('pepmis_submissions').create({
      sender_id: senderId,
      check_number: checkNumber || '',
      report_text: reportText || '',
      status: status,
      details: details || '',
      submitted_at: new Date().toISOString()
    });
    console.log(`[PocketBase] Logged submission record ID: ${record.id}`);
    return record;
  } catch (err) {
    console.warn('[PocketBase Warning] Failed to log submission to PocketBase:', err.message);
    return null;
  }
}

/**
 * Persists user session context and encrypts password in PocketBase ('user_sessions' collection)
 * @param {string} senderId
 * @param {Object} sessionData
 * @param {boolean} [savePasswordEncrypted=true]
 */
export async function saveDbSession(senderId, sessionData, savePasswordEncrypted = true) {
  try {
    const existing = await pb.collection('user_sessions').getFirstListItem(`sender_id="${senderId}"`).catch(() => null);

    const payload = {
      sender_id: senderId,
      check_number: sessionData.checkNumber || '',
      report_text: sessionData.reportText || '',
      updated_at: new Date().toISOString()
    };

    if (savePasswordEncrypted && sessionData.password) {
      payload.encrypted_password = encryptCredential(sessionData.password);
    }

    if (existing) {
      return await pb.collection('user_sessions').update(existing.id, payload);
    } else {
      return await pb.collection('user_sessions').create(payload);
    }
  } catch (err) {
    return null;
  }
}

/**
 * Retrieves persisted session context and decrypts stored password if available from PocketBase
 * @param {string} senderId
 * @returns {Promise<Object|null>}
 */
export async function getDbSession(senderId) {
  try {
    const existing = await pb.collection('user_sessions').getFirstListItem(`sender_id="${senderId}"`);
    const decryptedPass = existing.encrypted_password ? decryptCredential(existing.encrypted_password) : null;

    return {
      checkNumber: existing.check_number || null,
      password: decryptedPass,
      reportText: existing.report_text || null
    };
  } catch (err) {
    return null;
  }
}

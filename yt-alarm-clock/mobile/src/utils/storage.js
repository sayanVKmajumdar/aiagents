import AsyncStorage from '@react-native-async-storage/async-storage';

const ALARMS_KEY = '@yt_alarm_clock_alarms';
const SERVER_URL_KEY = '@yt_alarm_clock_server_url';
const API_KEY_STORAGE = '@yt_alarm_clock_api_key';

/**
 * Point this at your deployed backend.
 *   Render : https://yt-alarm-backend.onrender.com
 *   Fly.io : https://yt-alarm-backend.fly.dev
 *   Local  : http://192.168.1.23:8000   (device and laptop on the same Wi-Fi)
 */
export const DEFAULT_SERVER_URL = 'https://YOUR-DEPLOYED-URL.onrender.com';

/**
 * Demo/trial builds are compiled with EXPO_PUBLIC_DEMO_MODE=1 (see the
 * android-trial build profile). In that mode an empty or placeholder backend
 * URL is not treated as an error: alarms still fire and ring with the bundled
 * tone, so the app can be installed and tested before a server exists.
 */
export const DEMO_MODE =
  String(process.env.EXPO_PUBLIC_DEMO_MODE || '').toLowerCase() === '1';

/** True when we have a usable backend; DEMO_MODE without one is still "ready". */
export const canRing = (url) => isConfigured(url) || DEMO_MODE;

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------
export const createAlarm = ({ hour, minute, label = '', song = null, enabled = true }) => ({
  id: `alarm_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  hour,
  minute,
  label,
  // song: { video_id, title, artist } when the user pinned a track, null = surprise me
  song,
  enabled,
  notificationId: null,
  createdAt: new Date().toISOString(),
});

export const loadAlarms = async () => {
  try {
    const raw = await AsyncStorage.getItem(ALARMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[storage] Could not read alarms', e);
    return [];
  }
};

export const saveAlarms = async (alarms) => {
  try {
    await AsyncStorage.setItem(ALARMS_KEY, JSON.stringify(alarms));
    return true;
  } catch (e) {
    console.error('[storage] Failed to save alarms', e);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Server URL + optional API key
// ---------------------------------------------------------------------------
const normaliseUrl = (url) => (url || '').trim().replace(/\/+$/, '');

export const loadServerUrl = async () => {
  try {
    const stored = await AsyncStorage.getItem(SERVER_URL_KEY);
    return normaliseUrl(stored) || DEFAULT_SERVER_URL;
  } catch (e) {
    return DEFAULT_SERVER_URL;
  }
};

export const saveServerUrl = async (url) => {
  const clean = normaliseUrl(url);
  try {
    await AsyncStorage.setItem(SERVER_URL_KEY, clean);
    return clean;
  } catch (e) {
    console.error('[storage] Failed to save server URL', e);
    return null;
  }
};

export const loadApiKey = async () => {
  try {
    return (await AsyncStorage.getItem(API_KEY_STORAGE)) || '';
  } catch (e) {
    return '';
  }
};

export const saveApiKey = async (key) => {
  try {
    await AsyncStorage.setItem(API_KEY_STORAGE, (key || '').trim());
  } catch (e) {
    console.error('[storage] Failed to save API key', e);
  }
};

export const isConfigured = (url) =>
  Boolean(url) && !/YOUR-DEPLOYED-URL/i.test(url) && /^https?:\/\//i.test(url);

/**
 * AudioService — owns the single expo-audio player used while an alarm rings.
 *
 * Design notes:
 *  - We keep one module-level AudioPlayer (`createAudioPlayer`) rather than the
 *    hook, because the player has to survive re-renders of the ringing modal and
 *    be reachable from a plain function when the notification wakes the app.
 *  - The stream comes from yt-dlp, i.e. a rotating googlevideo.com URL. Those
 *    URLs are bound to the requesting IP and expire, so any failure must be
 *    recoverable: `play()` reports an error and the ringing screen asks the API
 *    for a fresh stream.
 *  - `loop = true` guarantees the alarm never goes quiet if the track is short.
 */

import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

import { fetchAlarmAudio } from './ApiService';

// Bundled tone, used when the backend cannot be reached at all. An alarm that
// rings boringly beats an alarm that does not ring.
const FALLBACK_SOUND = require('../../assets/fallback-alarm.wav');

let player = null;
let currentTrack = null;
let currentVolume = 1;
let rampingInterval = null;

const ALARM_AUDIO_MODE = {
  playsInSilentMode: true, // iOS: ignore the mute switch
  interruptionMode: 'doNotMix',
  shouldPlayInBackground: true,
  shouldRouteThroughEarpiece: false,
  allowsRecording: false,
};

/** Configure the audio session for alarm playback. Safe to call repeatedly. */
export const configureForAlarm = async () => {
  try {
    await setIsAudioActiveAsync(true);
    await setAudioModeAsync(ALARM_AUDIO_MODE);
  } catch (e) {
    console.warn('[audio] Could not configure audio session', e);
  }
};

/** Restore normal (non-alarm) audio behaviour after dismissal. */
export const restoreAudioSession = async () => {
  try {
    await setAudioModeAsync({ ...ALARM_AUDIO_MODE, shouldPlayInBackground: false });
  } catch (e) {
    /* ignore */
  }
};

const destroyPlayer = () => {
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch (e) {
    /* player already released */
  }
  player = null;
};

const ensurePlayer = (source = null) => {
  if (!player) {
    player = createAudioPlayer(source, { updateInterval: 500, keepAudioSessionActive: true });
    player.loop = true;
    player.volume = currentVolume;
  }
  return player;
};

/**
 * Play a track (or ask the backend for a random one).
 *
 * If the backend cannot be reached at all we fall back to the bundled alarm
 * tone after a few seconds, and report that through `fallback: true` so the
 * ringing screen can say so. The alarm must never be silent.
 *
 * @param {object} options
 * @param {{video_id?: string, title?: string, artist?: string}} [options.song]
 * @param {{serverUrl: string, apiKey?: string}} options.config
 * @param {boolean} [options.allowFallback]
 * @returns {Promise<{track: object, player: object, fallback: boolean}>}
 */
export const play = async ({ song = null, config, allowFallback = true }) => {
  await configureForAlarm();

  try {
    const track = await fetchAlarmAudio(config.serverUrl, {
      apiKey: config.apiKey,
      videoId: song?.video_id || null,
      timeoutMs: 25000,
    });

    const activePlayer = ensurePlayer();
    activePlayer.replace({ uri: track.stream_url });
    currentTrack = track;

    // A gentle ramp respects sleepy ears while still reaching full volume fast.
    rampVolume(0.35, 1, 2500);
    activePlayer.play();

    return { track, player: activePlayer, fallback: false };
  } catch (error) {
    if (!allowFallback) throw error;
    console.warn('[audio] stream unavailable, using bundled alarm tone:', error.message);
    return playFallback(error);
  }
};

/**
 * Ring with the bundled tone instead of a stream. Used when the server is
 * unreachable (cold Render container, airplane mode, no backend configured).
 */
export const playFallback = async (cause = null) => {
  await configureForAlarm();
  const activePlayer = ensurePlayer(FALLBACK_SOUND);
  activePlayer.loop = true;
  activePlayer.replace(FALLBACK_SOUND);

  currentTrack = {
    video_id: null,
    title: 'Offline alarm tone',
    artist: cause ? 'Backend unreachable' : 'Built-in sound',
    duration_ms: 0,
    stream_url: 'local://fallback-alarm.wav',
  };

  rampVolume(0.4, 1, 2000);
  activePlayer.play();

  return { track: currentTrack, player: activePlayer, fallback: true, cause };
};

/** Retry with a fresh stream URL (expired googlevideo URLs are common). */
export const restart = async ({ song = null, config, allowFallback = false }) => {
  destroyPlayer();
  return play({ song, config, allowFallback });
};

export const pause = () => {
  try {
    player?.pause();
  } catch (e) {
    /* ignore */
  }
};

export const resume = () => {
  try {
    player?.play();
  } catch (e) {
    /* ignore */
  }
};

export const stop = () => {
  stopVolumeRamp();
  destroyPlayer();
  currentTrack = null;
  restoreAudioSession();
};

/** Live playback state: { playing, currentTime, duration, progress, isBuffering }. */
export const getPlaybackState = () => {
  if (!player) {
    return {
      playing: false,
      currentTime: 0,
      duration: 0,
      progress: 0,
      isBuffering: false,
      isLoaded: false,
    };
  }

  const duration = player.duration || 0;
  const currentTime = player.currentTime || 0;
  return {
    playing: Boolean(player.playing),
    currentTime,
    duration,
    progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
    isBuffering: Boolean(player.isBuffering),
    isLoaded: Boolean(player.isLoaded),
  };
};

export const getCurrentTrack = () => currentTrack;

export const setVolume = (value) => {
  currentVolume = Math.max(0, Math.min(1, value));
  if (player) player.volume = currentVolume;
};

export const getVolume = () => currentVolume;

const stopVolumeRamp = () => {
  if (rampingInterval) {
    clearInterval(rampingInterval);
    rampingInterval = null;
  }
};

/** Smoothly move the volume from `from` to `to` over `durationMs`. */
export const rampVolume = (from, to, durationMs = 2000) => {
  stopVolumeRamp();
  const steps = Math.max(1, Math.round(durationMs / 100));
  const delta = (to - from) / steps;
  let step = 0;

  setVolume(from);
  rampingInterval = setInterval(() => {
    step += 1;
    setVolume(from + delta * step);
    if (step >= steps) {
      stopVolumeRamp();
      setVolume(to);
    }
  }, 100);
};

/**
 * Subscribe to playback status updates (requires an active player created by
 * `play()`). Returns an unsubscribe function; safe to call at any time.
 */
export const addPlaybackListener = (callback) => {
  if (!player) return () => {};
  const subscription = player.addListener('playbackStatusUpdate', callback);
  return () => {
    try {
      subscription?.remove?.();
    } catch (e) {
      /* ignore */
    }
  };
};

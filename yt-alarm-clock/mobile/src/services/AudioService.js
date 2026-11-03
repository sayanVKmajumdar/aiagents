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

const ensurePlayer = () => {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
    player.loop = true;
    player.volume = currentVolume;
  }
  return player;
};

/**
 * Play a track (or ask the backend for a random one).
 *
 * @param {object} options
 * @param {{video_id?: string, title?: string, artist?: string}} [options.song]
 * @param {{serverUrl: string, apiKey?: string}} options.config
 * @returns {Promise<{track: object, player: object}>}
 */
export const play = async ({ song = null, config }) => {
  await configureForAlarm();

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

  return { track, player: activePlayer };
};

/** Retry with a fresh stream URL (expired googlevideo URLs are common). */
export const restart = async ({ song = null, config }) => {
  destroyPlayer();
  return play({ song, config });
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

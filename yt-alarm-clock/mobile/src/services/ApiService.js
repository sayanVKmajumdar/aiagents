/**
 * Thin client for the yt-alarm backend.
 *
 * Two things matter here for an alarm:
 *   1. `fetchAlarmAudio` must fail *fast and loudly* so the ringing screen can
 *      fall back to a bundled sound instead of leaving the user in silence.
 *   2. Render's free tier sleeps after 15 minutes. We warm the container while
 *      the user is still awake (see `warmUp`) so the 7 AM request is instant.
 */

const DEFAULT_TIMEOUT_MS = 20000;

class ApiError extends Error {
  constructor(message, { status = 0, retryable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

const withTimeout = async (promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${timeoutMs / 1000}s`, {
        retryable: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const buildHeaders = (apiKey) => {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
};

const request = async (baseUrl, path, { apiKey, timeoutMs } = {}) => {
  if (!baseUrl) {
    throw new ApiError('No server URL configured yet. Add one in Settings.', {
      retryable: false,
    });
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  return withTimeout(async (signal) => {
    const response = await fetch(url, {
      headers: buildHeaders(apiKey),
      signal,
    });

    if (!response.ok) {
      let detail = `Server responded ${response.status}`;
      try {
        const body = await response.json();
        if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : detail;
      } catch (e) {
        /* non-JSON error body */
      }
      throw new ApiError(detail, {
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    return response.json();
  }, timeoutMs);
};

/**
 * Wake the backend and check it is healthy.
 * @returns {Promise<{ok: boolean, mode?: string, message?: string}>}
 */
export const ping = async (baseUrl, { apiKey } = {}) => {
  try {
    const body = await request(baseUrl, '/health', { apiKey, timeoutMs: 15000 });
    return {
      ok: body?.status === 'live',
      mode: body?.ytmusic_auth,
      apiKeyRequired: Boolean(body?.api_key_required),
      message: body?.status === 'live' ? 'Backend online' : 'Unexpected health response',
    };
  } catch (error) {
    return { ok: false, message: error.message };
  }
};

/**
 * Fire-and-forget warm-up so a cold Render container is awake before the alarm.
 * Never throws.
 */
export const warmUp = async (baseUrl, { apiKey } = {}) => {
  try {
    await request(baseUrl, '/health', { apiKey, timeoutMs: 8000 });
  } catch (e) {
    /* nothing to do, alarm path will retry */
  }
};

/**
 * Get a random (or specific) track plus a direct audio stream URL.
 *
 * @param {string} baseUrl
 * @param {{apiKey?: string, videoId?: string|null, signal?: AbortSignal}} options
 * @returns {Promise<{video_id: string, title: string, artist: string,
 *   stream_url: string, duration_ms: number, thumbnail: string}>}
 */
export const fetchAlarmAudio = async (baseUrl, { apiKey, videoId, timeoutMs = 25000 } = {}) => {
  const query = videoId ? `?video_id=${encodeURIComponent(videoId)}` : '';
  const body = await request(baseUrl, `/get-alarm-audio${query}`, {
    apiKey,
    timeoutMs,
  });

  if (!body?.stream_url) {
    throw new ApiError('Backend returned no playable stream URL.', { retryable: true });
  }

  return {
    video_id: body.video_id,
    title: body.title || 'Alarm Song',
    artist: body.artist || 'YouTube Music',
    stream_url: body.stream_url,
    duration_ms: Number(body.duration_ms) || 0,
    thumbnail: body.thumbnail || '',
  };
};

/**
 * Search YouTube Music so the user can pin a specific wake-up song.
 * @returns {Promise<Array<{video_id: string, title: string, artist: string, thumbnail: string}>>}
 */
export const searchSongs = async (baseUrl, query, { apiKey, limit = 12 } = {}) => {
  const body = await request(
    baseUrl,
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { apiKey, timeoutMs: 20000 }
  );
  return (body?.results || []).filter((item) => item.video_id);
};

export { ApiError };

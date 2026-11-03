/**
 * Small formatting helpers shared by the alarm list and the ringing screen.
 */

export const pad2 = (value) => String(value).padStart(2, '0');

export const formatTime = (hour, minute) => `${pad2(hour)}:${pad2(minute)}`;

export const formatClock = (date = new Date()) =>
  formatTime(date.getHours(), date.getMinutes());

export const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${pad2(secs)}`;
};

/** "in 7h 20m", "in 45m", "now" — used under each alarm row. */
export const describeCountdown = (hour, minute, now = new Date()) => {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const diffMinutes = Math.round((next - now) / 60000);
  if (diffMinutes <= 0) return 'now';
  if (diffMinutes < 60) return `in ${diffMinutes}m`;

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
};

/** The next Date at which `hour:minute` fires. */
export const nextOccurrence = (hour, minute, now = new Date()) => {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
};

export const toDate = (hour, minute) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
};

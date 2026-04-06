/**
 * cron-label.js — Converts cron expressions to human-readable labels.
 *
 * No dependencies. Handles standard 5-field cron syntax.
 * minute hour day-of-month month day-of-week
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTime(hour, minute) {
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  const period = h >= 12 ? 'pm' : 'am';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${displayHour}${period}` : `${displayHour}:${String(m).padStart(2, '0')}${period}`;
}

function parseDays(field) {
  if (field === '*') return null;
  const parts = field.split(',').map(p => parseInt(p, 10));
  return parts.map(d => DAYS_SHORT[d] || String(d));
}

function cronToLabel(expression) {
  if (!expression) return null;

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes
  if (minute.startsWith('*/') && hour === '*') {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  // Every N hours
  if (minute !== '*' && hour.startsWith('*/')) {
    const interval = hour.slice(2);
    return `Every ${interval} hours at :${minute.padStart(2, '0')}`;
  }

  // Specific time
  const hasTime = minute !== '*' && hour !== '*';
  const time = hasTime ? formatTime(hour, minute) : null;

  // Specific days of week
  const days = parseDays(dayOfWeek);

  // Specific day of month
  const hasDayOfMonth = dayOfMonth !== '*';

  // Specific month
  const hasMonth = month !== '*';

  // Build label
  if (hasTime && !days && !hasDayOfMonth && !hasMonth) {
    return `Daily at ${time}`;
  }

  if (hasTime && days && days.length === 1) {
    return `${DAYS[parseInt(dayOfWeek, 10)]}s at ${time}`;
  }

  if (hasTime && days && days.length > 1) {
    return `${days.join(', ')} at ${time}`;
  }

  if (hasTime && hasDayOfMonth && !hasMonth) {
    const suffix = dayOfMonth === '1' ? 'st' : dayOfMonth === '2' ? 'nd' : dayOfMonth === '3' ? 'rd' : 'th';
    return `${dayOfMonth}${suffix} of each month at ${time}`;
  }

  if (hasTime && hasDayOfMonth && hasMonth) {
    return `${MONTHS[parseInt(month, 10)]} ${dayOfMonth} at ${time}`;
  }

  // Fallback
  return expression;
}

module.exports = { cronToLabel };

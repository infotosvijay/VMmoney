// Record shapes, IDs, formatting helpers.

export const SCHEMA_VERSION = 1;
export const PACKAGE_APP = 'family-money-manager';

export const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

export const nowISO = () => new Date().toISOString();

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const todayStr = () => localDate();
export const monthKey = (dateStr) => dateStr.slice(0, 7);
export const thisMonth = () => monthKey(todayStr());

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
export function monthLabel(ym, long = true) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: long ? 'long' : 'short', year: 'numeric' });
}
export function dayLabel(dateStr) {
  const t = todayStr();
  if (dateStr === t) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dateStr === localDate(y)) return 'Yesterday';
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtMoney(n, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return (n || 0).toFixed(2);
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Fields common to every synced record. */
export function base(ownerId) {
  const t = nowISO();
  return { id: uid(), ownerId, createdAt: t, updatedAt: t, deleted: false };
}

export const PAYMENT_MODES = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net banking'],
];
export const ACCOUNT_TYPES = [
  ['cash', 'Cash'], ['bank', 'Bank'], ['upi', 'UPI'], ['card', 'Card'], ['wallet', 'Wallet'],
];
export const FREQUENCIES = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'],
];
// This family: exactly two members. Fixed IDs so every device agrees who is who (no duplicates on merge).
export const FAMILY = [
  { id: 'member-vj', key: 'vj', name: 'VJ', color: '#6d3fc4' },
  { id: 'member-mm', key: 'mm', name: 'MM', color: '#0e7490' },
];
export const familyMember = (id) => FAMILY.find((m) => m.id === id);
export const otherMember = (id) => FAMILY.find((m) => m.id !== id);
export const MEMBER_COLORS = ['#0f766e', '#2563eb', '#c026d3', '#ea580c', '#65a30d', '#dc2626', '#7c3aed', '#0891b2'];

export const labelOf = (list, key) => (list.find((x) => x[0] === key) || [key, key])[1];

export function sha256Hex(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

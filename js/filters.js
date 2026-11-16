// Transactions-screen filters: date presets, the date range a filter set means, and the removable "chips".
// Pure functions (no screen, no database) so they can be tested.

import { localDate, monthRange } from './models.js';

/** The filter fields a saved filter remembers. The month and the Mine / Family tab are not part of it. */
export const SAVED_KEYS = ['q', 't', 'c', 'a', 'u', 'min', 'max', 'df', 'dt'];

export const BLANK = { q: '', t: '', c: '', a: '', u: '', min: '', max: '', df: '', dt: '' };

export const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week']];
// 'last30' still works in presetRange for links and saved filters made before it left the screen

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const shift = (d, days) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); return localDate(x); };

/** { df, dt } for a preset name. The week runs Monday to today. */
export function presetRange(name, now = new Date()) {
  const today = localDate(now);
  if (name === 'today') return { df: today, dt: today };
  if (name === 'yesterday') { const y = shift(now, -1); return { df: y, dt: y }; }
  if (name === 'week') return { df: shift(now, -((now.getDay() + 6) % 7)), dt: today };
  if (name === 'last30') return { df: shift(now, -29), dt: today };
  return { df: '', dt: '' };
}

/** The preset a from/to pair equals right now, or '' (used to highlight the active preset chip). */
export const activePreset = (f, now = new Date()) =>
  (f.df || f.dt) ? (PRESETS.find(([k]) => { const r = presetRange(k, now); return r.df === f.df && r.dt === f.dt; })?.[0] || '') : '';

/**
 * The { from, to } the filters mean. A date range wins over the month and means "all time".
 * Either end may be left empty ("from 1 March" or "up to 10 March"). Ends typed the wrong way round are swapped.
 */
export function dateRange(f) {
  if (isDate(f.df) || isDate(f.dt)) {
    let from = isDate(f.df) ? f.df : '';
    let to = isDate(f.dt) ? f.dt : '';
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  if (/^\d{4}-\d{2}$/.test(f.m)) return monthRange(f.m);
  if (/^\d{4}$/.test(f.m)) return { from: `${f.m}-01-01`, to: `${f.m}-12-31` };
  return {};
}

export const hasDateRange = (f) => isDate(f.df) || isDate(f.dt);

const pretty = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };

/**
 * One chip per active filter: [{ keys: ['t'], label: 'Type: Expense' }, ...]. Removing a chip clears its keys.
 * `names` turns ids into text: { cat(id), account(id), member(id) }.
 */
export function filterChips(f, names, { money = String } = {}) {
  const chips = [];
  if (f.q) chips.push({ keys: ['q'], label: `Search: ${f.q}` });
  if (f.t) chips.push({ keys: ['t'], label: `Type: ${f.t[0].toUpperCase() + f.t.slice(1)}` });
  if (f.c) chips.push({ keys: ['c'], label: `Category: ${names.cat(f.c.slice(2))}` });
  if (f.a) chips.push({ keys: ['a'], label: `Account: ${names.account(f.a)}` });
  if (f.u) chips.push({ keys: ['u'], label: `Member: ${names.member(f.u)}` });
  if (f.min || f.max) {
    const label = f.min && f.max ? `Amount: ${money(+f.min)} – ${money(+f.max)}` : f.min ? `Amount: at least ${money(+f.min)}` : `Amount: up to ${money(+f.max)}`;
    chips.push({ keys: ['min', 'max'], label });
  }
  if (hasDateRange(f)) {
    const { from, to } = dateRange(f);
    const label = from && to ? (from === to ? `Date: ${pretty(from)}` : `Date: ${pretty(from)} – ${pretty(to)}`) : from ? `Date: from ${pretty(from)}` : `Date: up to ${pretty(to)}`;
    chips.push({ keys: ['df', 'dt'], label });
  }
  return chips;
}

/** Saved filters live on this device: [{ id, name, f }]. Saving under an existing name replaces it. */
export function withSaved(list, name, f) {
  const keep = Object.fromEntries(SAVED_KEYS.map((k) => [k, f[k] || '']));
  const clean = name.trim().slice(0, 40);
  const next = (list || []).filter((s) => s.name.toLowerCase() !== clean.toLowerCase());
  next.push({ id: clean.toLowerCase(), name: clean, f: keep });
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
export const withoutSaved = (list, id) => (list || []).filter((s) => s.id !== id);

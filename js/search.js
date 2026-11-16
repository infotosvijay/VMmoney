// Search box syntax. Plain words must all appear on the entry (handled by transactions.js). On top of that:
//   >500  <100  >=500  <=100  =250      amount limits
//   cat:food   type:income   acc:cash   member:vj   note:rent     one field only (use quotes for spaces: cat:"eating out")
// Pure functions, so they can be tested.

const TOKEN = /(\w+):"([^"]*)"|(\w+):(\S+)|(>=|<=|>|<|=)\s*(\d[\d,]*(?:\.\d+)?)|(\S+)/g;
const FIELDS = { cat: 'cat', category: 'cat', type: 'type', acc: 'acc', account: 'acc', member: 'member', who: 'member', note: 'note' };

/**
 * Split the search text into { words, min, max, cat, type, acc, member, note }.
 * `min` / `max` are { value, strict } so that ">500" excludes 500 and ">=500" includes it.
 * Unknown "field:value" text (like a time "10:30") stays a plain word.
 */
export function parseSearch(text) {
  const out = { words: [], min: null, max: null, cat: [], type: [], acc: [], member: [], note: [] };
  for (const m of String(text || '').matchAll(TOKEN)) {
    const field = FIELDS[(m[1] ?? m[3] ?? '').toLowerCase()];
    if (m[1] !== undefined || m[3] !== undefined) {
      const value = (m[2] ?? m[4] ?? '').trim().toLowerCase();
      if (field && value) out[field].push(value);
      else if (!field) out.words.push(m[0].toLowerCase());
    } else if (m[5]) {
      const value = Number(m[6].replace(/,/g, ''));
      if (m[5] === '>' || m[5] === '>=') out.min = tighter(out.min, { value, strict: m[5] === '>' }, true);
      else if (m[5] === '<' || m[5] === '<=') out.max = tighter(out.max, { value, strict: m[5] === '<' }, false);
      else { out.min = { value, strict: false }; out.max = { value, strict: false }; }
    } else out.words.push(m[7].toLowerCase());
  }
  return out;
}

function tighter(cur, next, isMin) {
  if (!cur) return next;
  if (next.value === cur.value) return { value: cur.value, strict: cur.strict || next.strict };
  return (next.value > cur.value) === isMin ? next : cur;
}

export const amountOk = (amount, { min, max }) =>
  (!min || (min.strict ? amount > min.value : amount >= min.value)) && (!max || (max.strict ? amount < max.value : amount <= max.value));

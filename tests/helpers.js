// Test helpers: a memory-only database with the two family members and their accounts.
import * as db from '../js/db.js';
import * as tx from '../js/transactions.js';

export async function freshDb(memberId = 'member-vj') {
  db.initMemory();
  db.cfg.memberId = memberId;
  db.cfg.mode = 'member';
  await tx.ensureFamilyMembers();
  await tx.ensureDefaultAccount();
  const other = memberId === 'member-vj' ? 'member-mm' : 'member-vj';
  await tx.accountFor(other, 'online');
  await tx.accountFor(other, 'cash');
}

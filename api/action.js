import { kv } from '@vercel/kv';

const PALETTE = [
  "#FF6B6B","#4DD0B1","#FFC94D","#7C9CFF","#FF9F45",
  "#C77DFF","#5BC0EB","#F15BB5","#9DE36B","#FF8FB1",
  "#5AD8E6","#FFB04D","#A88BFF","#6BE3B0","#FF7A5C",
  "#74C0FC","#E8C84D","#FF6FD8","#8CE38F","#FFA0A0"
];

function defaultState() {
  return { title: '청1 방학숙제', pin: '1234', open: true, teams: [], members: [], items: [], log: [], purchases: [], seq: 0 };
}

function uid_(s) { s.seq = (s.seq || 0) + 1; return 'id' + s.seq + '_' + Math.floor(Math.random() * 10000); }
function trim_(v) { return String(v == null ? '' : v).trim(); }
function teamName_(s, tid) { for (const t of s.teams) if (t.id === tid) return t.name; return '미배정'; }
function pubMember_(m) { return { id: m.id, name: m.name, soon: m.soon, teamId: m.teamId, talents: m.talents }; }
function checkPin_(s, pin) { if (trim_(pin) !== trim_(s.pin)) throw new Error('PIN이 올바르지 않습니다.'); }
function findMember_(s, id) { return s.members.find(m => m.id === id) || null; }
function findItem_(s, id) { return s.items.find(it => it.id === id) || null; }

function pushLog_(s, type, m, amount, label, ref) {
  if (!s.log) s.log = [];
  const id = uid_(s);
  s.log.unshift({ id, ts: new Date().toISOString(), type, memberId: m.id, memberName: m.name, teamName: teamName_(s, m.teamId), amount, label: label || '', ref: ref || '' });
  if (s.log.length > 60) s.log = s.log.slice(0, 60);
  return id;
}

function addPurchase_(s, m, it, id) {
  if (!s.purchases) s.purchases = [];
  s.purchases.push({ id: String(id), ts: new Date().toISOString(), memberId: m.id, name: m.name, team: teamName_(s, m.teamId), item: it.name, price: it.price, done: false });
}

function cancelPurchaseRow_(s, id) {
  if (!s.purchases) return;
  const p = s.purchases.find(p => String(p.id) === String(id));
  if (p) p.cancelled = true;
}

async function readState() {
  try {
    const data = await kv.get('STATE');
    return data || defaultState();
  } catch (e) {
    return defaultState();
  }
}

async function writeState(s) {
  await kv.set('STATE', s);
}

const actions = {
  async getState() {
    const s = await readState();
    return {
      title: s.title,
      open: s.open,
      teams: s.teams,
      members: s.members.map(m => pubMember_(m)),
      items: s.items,
      log: (s.log || []).slice(0, 30)
    };
  },

  async verifyPin(pin) {
    const s = await readState();
    return trim_(pin) === trim_(s.pin);
  },

  async getAdminData(pin) {
    const s = await readState();
    checkPin_(s, pin);
    return { members: s.members, teams: s.teams, items: s.items };
  },

  async register(name, soon, phone, teamId, pin) {
    const s = await readState();
    if (!s.open) throw new Error('현재 가입이 닫혀 있어요.');
    if (!trim_(name)) throw new Error('이름을 입력해 주세요.');
    const p = trim_(pin);
    if (!p || p.length < 4) throw new Error('개인 PIN을 4자리 이상 입력해 주세요.');
    const m = { id: uid_(s), name: trim_(name), soon: trim_(soon), phone: trim_(phone), teamId, talents: 0, pin: p };
    s.members.push(m);
    await writeState(s);
    return pubMember_(m);
  },

  async verifyMemberPin(memberId, pin) {
    const s = await readState();
    const m = findMember_(s, memberId);
    if (!m) throw new Error('멤버를 찾을 수 없어요.');
    if (!m.pin) throw new Error('PIN이 설정되지 않았어요. 관리자에게 문의해 주세요.');
    return trim_(m.pin) === trim_(pin);
  },

  async changeMemberPin(memberId, oldPin, newPin) {
    const s = await readState();
    const m = findMember_(s, memberId);
    if (!m) throw new Error('멤버를 찾을 수 없어요.');
    if (trim_(m.pin) !== trim_(oldPin)) throw new Error('기존 PIN이 올바르지 않아요.');
    const np = trim_(newPin);
    if (!np || np.length < 4) throw new Error('새 PIN을 4자리 이상 입력해 주세요.');
    m.pin = np;
    await writeState(s);
    return true;
  },

  async resetMemberPin(adminPinValue, memberId, newPin) {
    const s = await readState();
    checkPin_(s, adminPinValue);
    const m = findMember_(s, memberId);
    if (!m) throw new Error('멤버를 찾을 수 없어요.');
    const np = trim_(newPin);
    if (!np || np.length < 4) throw new Error('새 PIN을 4자리 이상 입력해 주세요.');
    m.pin = np;
    await writeState(s);
    return true;
  },

  async transfer(fromId, toId, amount) {
    const s = await readState();
    const f = findMember_(s, fromId), t = findMember_(s, toId);
    if (!f || !t) throw new Error('대상을 찾을 수 없어요.');
    if (f.teamId !== t.teamId) throw new Error('같은 팀끼리만 주고받을 수 있어요.');
    amount = Math.round(Number(amount));
    if (!(amount > 0)) throw new Error('수량을 확인해 주세요.');
    if (f.talents < amount) throw new Error('달란트가 부족해요.');
    f.talents -= amount; t.talents += amount;
    pushLog_(s, 'transfer', f, amount, f.name + ' → ' + t.name, t.id);
    await writeState(s);
    return true;
  },

  async earn(pin, memberId, amount, label) {
    const s = await readState();
    checkPin_(s, pin);
    const m = findMember_(s, memberId);
    if (!m) throw new Error('대상을 찾을 수 없어요.');
    amount = Math.round(Number(amount));
    if (!amount) throw new Error('수량을 확인해 주세요.');
    m.talents += amount;
    pushLog_(s, 'earn', m, amount, label);
    await writeState(s);
    return pubMember_(m);
  },

  async setTalents(pin, memberId, value) {
    const s = await readState();
    checkPin_(s, pin);
    const m = findMember_(s, memberId);
    if (!m) throw new Error('대상을 찾을 수 없어요.');
    value = Math.round(Number(value));
    const delta = value - m.talents;
    m.talents = value;
    pushLog_(s, 'adjust', m, delta, '직접 수정');
    await writeState(s);
    return pubMember_(m);
  },

  async buy(pin, memberId, itemId) {
    const s = await readState();
    checkPin_(s, pin);
    const m = findMember_(s, memberId), it = findItem_(s, itemId);
    if (!m || !it) throw new Error('대상을 찾을 수 없어요.');
    if (it.stock <= 0) throw new Error('품절된 상품입니다.');
    if (m.talents < it.price) throw new Error('달란트가 부족해요.');
    m.talents -= it.price; it.stock -= 1;
    const pid = pushLog_(s, 'spend', m, it.price, it.name, it.id);
    addPurchase_(s, m, it, pid);
    await writeState(s);
    return true;
  },

  async selfBuy(memberId, itemId) {
    const s = await readState();
    const m = findMember_(s, memberId), it = findItem_(s, itemId);
    if (!m || !it) throw new Error('대상을 찾을 수 없어요.');
    if (it.stock <= 0) throw new Error('품절된 상품입니다.');
    if (m.talents < it.price) throw new Error('달란트가 부족해요.');
    m.talents -= it.price; it.stock -= 1;
    const pid = pushLog_(s, 'spend', m, it.price, it.name, it.id);
    addPurchase_(s, m, it, pid);
    await writeState(s);
    return true;
  },

  async undoEntry(pin, entryId) {
    const s = await readState();
    checkPin_(s, pin);
    if (!s.log) s.log = [];
    const idx = s.log.findIndex(l => l.id === entryId);
    if (idx < 0) throw new Error('기록을 찾을 수 없어요. (오래된 기록은 취소할 수 없어요)');
    const e = s.log[idx];
    const m = findMember_(s, e.memberId);
    if (e.type === 'earn' || e.type === 'adjust') { if (m) m.talents -= e.amount; }
    else if (e.type === 'spend') {
      if (m) m.talents += e.amount;
      const it = findItem_(s, e.ref); if (it) it.stock += 1;
      cancelPurchaseRow_(s, e.id);
    }
    else if (e.type === 'transfer') {
      if (m) m.talents += e.amount;
      const t = findMember_(s, e.ref); if (t) t.talents -= e.amount;
    }
    s.log.splice(idx, 1);
    await writeState(s);
    return true;
  },

  async getMyPurchases(memberId) {
    const s = await readState();
    if (!s.purchases) return [];
    return s.purchases
      .filter(p => !p.cancelled && String(p.memberId) === String(memberId))
      .map(p => ({ id: p.id, item: p.item, price: p.price, done: p.done, ts: p.ts }))
      .reverse();
  },

  async getPurchases(pin) {
    const s = await readState();
    checkPin_(s, pin);
    if (!s.purchases) return [];
    return s.purchases
      .filter(p => !p.cancelled)
      .map(p => ({ id: p.id, ts: p.ts, name: p.name, team: p.team, item: p.item, price: p.price, done: p.done }))
      .reverse();
  },

  async markPurchaseDone(pin, id, done) {
    const s = await readState();
    checkPin_(s, pin);
    if (!s.purchases) return false;
    const p = s.purchases.find(p => String(p.id) === String(id));
    if (!p) return false;
    p.done = done;
    await writeState(s);
    return true;
  },

  async addTeams(pin, names) {
    const s = await readState();
    checkPin_(s, pin);
    for (const nm of names) {
      const n = trim_(nm); if (!n) continue;
      s.teams.push({ id: uid_(s), name: n, color: PALETTE[s.teams.length % PALETTE.length] });
    }
    await writeState(s);
    return s.teams;
  },

  async removeTeam(pin, teamId) {
    const s = await readState();
    checkPin_(s, pin);
    s.teams = s.teams.filter(t => t.id !== teamId);
    s.members.forEach(m => { if (m.teamId === teamId) m.teamId = ''; });
    await writeState(s);
    return true;
  },

  async setMemberTeam(pin, memberId, teamId) {
    const s = await readState();
    checkPin_(s, pin);
    s.members.forEach(m => { if (m.id === memberId) m.teamId = teamId; });
    await writeState(s);
    return true;
  },

  async removeMember(pin, memberId) {
    const s = await readState();
    checkPin_(s, pin);
    s.members = s.members.filter(m => m.id !== memberId);
    await writeState(s);
    return true;
  },

  async addItem(pin, name, price, stock, emoji) {
    const s = await readState();
    checkPin_(s, pin);
    s.items.push({ id: uid_(s), name: trim_(name), price: Math.round(Number(price)), stock: Math.round(Number(stock)), emoji: trim_(emoji) || '🎁' });
    await writeState(s);
    return s.items;
  },

  async removeItem(pin, itemId) {
    const s = await readState();
    checkPin_(s, pin);
    s.items = s.items.filter(it => it.id !== itemId);
    await writeState(s);
    return true;
  },

  async setMeta(pin, patch) {
    const s = await readState();
    checkPin_(s, pin);
    if (patch.title !== undefined) s.title = trim_(patch.title) || '청1 방학숙제';
    if (patch.newPin !== undefined && trim_(patch.newPin)) s.pin = trim_(patch.newPin);
    if (patch.open !== undefined) s.open = !!patch.open;
    await writeState(s);
    return true;
  },

  async resetAll(pin) {
    const s = await readState();
    checkPin_(s, pin);
    const d = defaultState();
    d.pin = s.pin; d.title = s.title;
    await writeState(d);
    return true;
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fn, args = [] } = req.body;
  if (!actions[fn]) return res.status(400).json({ error: `Unknown function: ${fn}` });

  try {
    const data = await actions[fn](...args);
    res.json({ data });
  } catch (e) {
    res.json({ error: e.message || String(e) });
  }
}

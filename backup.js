// Preserve the original storage key when the product is rebranded.
export const DATA_KEY = 'money-tracker-v2';
export const BACKUP_FORMAT = 'pitihden.local-backup';
const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'JPY'];
const COLLECTIONS = {books:200, accounts:2000, categories:2000, transactions:100000,
  budgets:20000, recurring:20000, members:20000, splits:20000};
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const textOK = (value, max=500) => typeof value === 'string' && value.length <= max;
const numberOK = (value, negative=false) => typeof value === 'number' && Number.isFinite(value) &&
  Math.abs(value) <= 1e15 && (negative || value >= 0);
const colorOK = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const monthOK = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function dateOK(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function check(condition, message) { if (!condition) throw new Error(message); }
function inspect(value, depth=0) {
  check(depth <= 12, 'Struktur file terlalu dalam.');
  if (typeof value === 'string') check(value.length <= 4000, 'Ada teks yang terlalu panjang.');
  if (typeof value === 'number') check(Number.isFinite(value), 'Ada angka yang tidak valid.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check(!['__proto__', 'constructor', 'prototype'].includes(key), 'File memuat properti terlarang.');
    inspect(child, depth+1);
  }
}
function ids(items, label) {
  const result = new Set();
  for (const item of items) {
    check(item && typeof item === 'object' && idOK(item.id), `ID ${label} tidak valid.`);
    check(!result.has(item.id), `Ada ID ${label} yang berulang.`);
    result.add(item.id);
  }
  return result;
}
export function validateBackupData(data) {
  check(data && typeof data === 'object' && !Array.isArray(data) && data.version === 2,
    'Versi data tidak didukung.');
  inspect(data);
  for (const [name, max] of Object.entries(COLLECTIONS))
    check(Array.isArray(data[name]) && data[name].length <= max, `Daftar ${name} tidak valid.`);
  const books=ids(data.books,'buku kas'), accounts=ids(data.accounts,'rekening'),
    categories=ids(data.categories,'kategori'), transactions=ids(data.transactions,'transaksi'),
    members=ids(data.members,'anggota');
  for (const name of ['budgets','recurring','splits']) ids(data[name],name);
  check(books.size>0 && books.has(data.activeBookId), 'Buku kas aktif tidak ditemukan.');
  for (const b of data.books) check(textOK(b.name,120) && textOK(b.type,30) &&
    colorOK(b.color) && textOK(b.code,100) && (!b.familyBookId || books.has(b.familyBookId)),
    'Detail buku kas tidak valid.');
  for (const a of data.accounts) check(books.has(a.bookId) && textOK(a.name,120) &&
    textOK(a.type,30) && CURRENCIES.includes(a.currency) && numberOK(a.opening,true) &&
    colorOK(a.color), 'Detail rekening tidak valid.');
  for (const c of data.categories) check(textOK(c.name,120) &&
    ['income','expense'].includes(c.type) && (!c.parentId || categories.has(c.parentId)) &&
    textOK(c.icon,30) && colorOK(c.color), 'Detail kategori tidak valid.');
  for (const t of data.transactions) {
    check(books.has(t.bookId) && dateOK(t.date) && ['income','expense','transfer'].includes(t.type) &&
      numberOK(t.amount) && CURRENCIES.includes(t.currency) && accounts.has(t.accountId) &&
      (!t.toAccountId || accounts.has(t.toAccountId)) &&
      (!t.categoryId || categories.has(t.categoryId)) && textOK(t.note),
      'Detail transaksi tidak valid.');
    check(data.accounts.find(a=>a.id===t.accountId)?.bookId===t.bookId,
      'Rekening transaksi berada di buku kas lain.');
    if(t.toAccountId) check(data.accounts.find(a=>a.id===t.toAccountId)?.bookId===t.bookId,
      'Rekening tujuan berada di buku kas lain.');
  }
  for (const b of data.budgets) check(books.has(b.bookId) && monthOK(b.month) &&
    numberOK(b.amount) && (!b.categoryId || categories.has(b.categoryId)),
    'Detail anggaran tidak valid.');
  for (const r of data.recurring) check(books.has(r.bookId) &&
    ['income','expense'].includes(r.type) && numberOK(r.amount) &&
    categories.has(r.categoryId) && accounts.has(r.accountId) && textOK(r.note) &&
    ['daily','weekly','biweekly','monthly','yearly'].includes(r.frequency) &&
    dateOK(r.nextDate) && (!r.endDate || dateOK(r.endDate)),
    'Detail jadwal tidak valid.');
  for (const m of data.members) check(books.has(m.bookId) && textOK(m.name,120) &&
    ['owner','editor','viewer'].includes(m.role), 'Detail anggota tidak valid.');
  for (const s of data.splits) {
    check(books.has(s.bookId) && textOK(s.title) && dateOK(s.date) &&
      numberOK(s.amount) && members.has(s.payerMemberId) && accounts.has(s.accountId) &&
      transactions.has(s.transactionId) && Array.isArray(s.shares) && s.shares.length<=200 &&
      Array.isArray(s.settlements) && s.settlements.length<=20000,
      'Detail patungan tidak valid.');
    for (const share of s.shares) check(members.has(share.memberId) && numberOK(share.amount),
      'Bagian patungan tidak valid.');
    for (const payment of s.settlements) check(members.has(payment.memberId) &&
      numberOK(payment.amount) && dateOK(payment.date) && transactions.has(payment.transactionId),
      'Pelunasan tidak valid.');
  }
  check(data.rates && typeof data.rates==='object' && data.rates.IDR===1,
    'Data kurs tidak valid.');
  for (const currency of CURRENCIES) check(numberOK(data.rates[currency]) &&
    data.rates[currency]>0, `Kurs ${currency} tidak valid.`);
  check(CURRENCIES.includes(data.selectedCurrency), 'Mata uang tampilan tidak valid.');
  return data;
}
export function createBackup(state, exportedAt=new Date().toISOString()) {
  validateBackupData(state);
  return JSON.stringify({format:BACKUP_FORMAT, backupVersion:1, app:'PITIHDEN',
    creator:'utiedev', exportedAt, data:state}, null, 2);
}
export function parseBackup(text) {
  let payload;
  try { payload=JSON.parse(text); }
  catch { throw new Error('File bukan JSON yang valid.'); }
  check(payload?.format===BACKUP_FORMAT && payload.backupVersion===1,
    'File ini bukan backup PITIHDEN yang didukung.');
  check(textOK(payload.exportedAt,50) && !Number.isNaN(Date.parse(payload.exportedAt)),
    'Tanggal backup tidak valid.');
  return {data:validateBackupData(payload.data), exportedAt:payload.exportedAt};
}

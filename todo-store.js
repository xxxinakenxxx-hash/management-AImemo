(function (global) {
  'use strict';
  const DB = 'management_ai_memo'; const TTL = 30000; const owner = `${Date.now()}-${Math.random()}`;
  let db;
  function req(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  function done(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  async function open() { return new Promise((resolve, reject) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); if (!d.objectStoreNames.contains('todos')) d.createObjectStore('todos', { keyPath: 'todo_id' }); if (!d.objectStoreNames.contains('draft')) d.createObjectStore('draft', { keyPath: 'key' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function editable() { const current = JSON.parse(localStorage.getItem(`${DB}:edit-lock`) || 'null'); if (!current || Date.now() - current.at >= TTL || current.owner === owner) { localStorage.setItem(`${DB}:edit-lock`, JSON.stringify({ owner, at: Date.now() })); return true; } return false; }
  async function init() { db = await open(); return { readOnly: !editable() }; }
  async function all() { const t = db.transaction('todos', 'readonly'); return (await req(t.objectStore('todos').getAll())).filter((todo) => !todo.is_deleted); }
  async function save(todo) { const t = db.transaction(['todos', 'meta'], 'readwrite'); todo.updated_at = global.todoService.now(); todo.revision = Number(todo.revision || 0) + 1; t.objectStore('todos').put(todo); await done(t); return todo; }
  async function saveDraft(text) { const t = db.transaction('draft', 'readwrite'); if (String(text).trim()) t.objectStore('draft').put({ key: 'main_input', text: String(text), updated_at: global.todoService.now() }); else t.objectStore('draft').delete('main_input'); await done(t); }
  async function getDraft() { return req(db.transaction('draft', 'readonly').objectStore('draft').get('main_input')); }
  const FORMAT = 'maimemo-backup'; const VERSION = 1; const ITERATIONS = 200000;
  function b64(bytes) { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }
  function bytes(value) { if (!value || typeof value !== 'string') throw new Error('バックアップ形式が不正です。'); const text = atob(value); return Uint8Array.from(text, (char) => char.charCodeAt(0)); }
  function validateBackup(backup) {
    if (!backup || backup.format !== FORMAT || backup.version !== VERSION) throw new Error('対応していないバックアップ形式です。');
    if (!backup.kdf || backup.kdf.name !== 'PBKDF2' || backup.kdf.hash !== 'SHA-256' || backup.kdf.iterations !== ITERATIONS) throw new Error('鍵導出情報が不正です。');
    if (!backup.cipher || backup.cipher.name !== 'AES-GCM' || backup.cipher.length !== 256) throw new Error('暗号化情報が不正です。');
    bytes(backup.salt); bytes(backup.iv); bytes(backup.ciphertext); return true;
  }
  function validateData(data) {
    if (!data || !Array.isArray(data.meta) || !Array.isArray(data.todos)) throw new Error('バックアップデータが不正です。');
    const meta = data.meta.map((row) => { if (!row || typeof row.key !== 'string' || !row.key) throw new Error('メタ情報が不正です。'); return row; });
    const todos = data.todos.map(global.todoService.validateTodo);
    const draft = data.draft == null ? null : data.draft;
    if (draft && (draft.key !== 'main_input' || typeof draft.text !== 'string' || draft.text.length > global.todoService.MAX_TEXT_LENGTH)) throw new Error('下書きが不正です。');
    return { meta, todos, draft };
  }
  function passphrase(value) { if (!String(value || '')) throw new Error('パスフレーズを入力してください。'); return String(value); }
  async function keyFor(value, salt) { const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase(value)), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  async function snapshot() { const [meta, todos, draft] = await Promise.all([req(db.transaction('meta', 'readonly').objectStore('meta').getAll()), req(db.transaction('todos', 'readonly').objectStore('todos').getAll()), getDraft()]); return { meta, todos: todos.map(global.todoService.validateTodo), draft: draft || null }; }
  async function replaceAllLocalData(data) { const value = validateData(data); const tx = db.transaction(['meta', 'todos', 'draft'], 'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('todos').clear(); tx.objectStore('draft').clear(); value.meta.forEach((row) => tx.objectStore('meta').put(row)); value.todos.forEach((todo) => tx.objectStore('todos').put(todo)); if (value.draft) tx.objectStore('draft').put(value.draft); await done(tx); }
  async function deleteAllLocalData() { const tx = db.transaction(['meta', 'todos', 'draft'], 'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('todos').clear(); tx.objectStore('draft').clear(); await done(tx); }
  async function summary() { const value = await snapshot(); const dates = value.todos.map((todo) => todo.updated_at).concat(value.draft ? [value.draft.updated_at] : []).filter(Boolean).sort(); return { count: value.todos.filter((todo) => !todo.is_deleted).length, lastUpdatedAt: dates.length ? dates[dates.length - 1] : null }; }
  async function exportEncryptedBackup(pass) { const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await keyFor(pass, salt); const data = validateData(await snapshot()); const plain = new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: VERSION, data })); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain); const backup = { format: FORMAT, version: VERSION, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS }, cipher: { name: 'AES-GCM', length: 256 }, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(encrypted)), created_at: new Date().toISOString() }; return new Blob([JSON.stringify(backup)], { type: 'application/json' }); }
  async function importEncryptedBackup(file, pass) { let backup; try { backup = JSON.parse(await file.text()); } catch (error) { throw new Error('バックアップファイルを読み込めません。'); } validateBackup(backup); try { const key = await keyFor(pass, bytes(backup.salt)); const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(backup.iv) }, key, bytes(backup.ciphertext)); const payload = JSON.parse(new TextDecoder().decode(plain)); if (payload.format !== FORMAT || payload.version !== VERSION) throw new Error('本文の版が不正です。'); await replaceAllLocalData(payload.data); } catch (error) { const result = new Error('バックアップを復元できません。パスフレーズ、改ざん、形式を確認してください。'); result.cause = error; throw result; } }
  global.todoStore = { init, all, save, saveDraft, getDraft, summary, exportEncryptedBackup, importEncryptedBackup, validateBackup, replaceAllLocalData, deleteAllLocalData, stop() { const current = JSON.parse(localStorage.getItem(`${DB}:edit-lock`) || 'null'); if (current && current.owner === owner) localStorage.removeItem(`${DB}:edit-lock`); db && db.close(); } };
}(window));

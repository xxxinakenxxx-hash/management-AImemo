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
  global.todoStore = { init, all, save, saveDraft, getDraft, stop() { const current = JSON.parse(localStorage.getItem(`${DB}:edit-lock`) || 'null'); if (current && current.owner === owner) localStorage.removeItem(`${DB}:edit-lock`); db && db.close(); } };
}(window));

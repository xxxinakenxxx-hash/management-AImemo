(function (global) {
  'use strict';
  const STATUSES = ['SELF', 'DELEGATED', 'HOLD', 'COMPLETED'];
  const now = () => new Date().toISOString();
  const uuid = () => global.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  function date(value) { if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('日付が不正です。'); return String(value); }
  function createTodo(input) {
    const body = String(input && input.body || '').trim(); if (!body || body.length > 5000) throw new Error('本文を確認してください。');
    const timestamp = now(); const status = input.status || 'SELF'; if (!STATUSES.includes(status)) throw new Error('状態が不正です。');
    return Object.assign({ todo_id: uuid(), body, status, source_person: null, target_person: null, due_date: null, delegated_to: null, delegated_at: null, report_due_date: null, report_received: false, report_received_at: null, report_content: null, completed_at: status === 'COMPLETED' ? timestamp : null, created_at: timestamp, updated_at: timestamp, revision: 1, is_deleted: false, deleted_at: null }, input || {}, { body, status, due_date: date(input && input.due_date) });
  }
  function validateTodo(todo) {
    const value = createTodo(todo);
    if (todo.is_deleted && !todo.deleted_at) throw new Error('削除日時が不正です。');
    if (todo.status === 'COMPLETED' && !todo.completed_at) throw new Error('完了日時が不正です。');
    return value;
  }
  global.todoService = { STATUSES, now, createTodo, validateTodo, MAX_TEXT_LENGTH: 5000 };
}(window));

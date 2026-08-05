(function () {
  'use strict';
  const tabs = [['SELF', '自分'], ['DELEGATED', '振る'], ['HOLD', '保留'], ['COMPLETED', '完了']];
  const $ = (id) => document.getElementById(id);
  let store; let state = 'SELF'; let todos = []; let readOnly = false; let selectedTodo = null;
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('management_ai_memo_token') || '';
  let recognition = null; let speechRunning = false; let speechSession = null;
  const status = (text, error) => { $('status').textContent = text || ''; $('status').className = error ? 'error' : ''; };
  const speechStatus = (text, error) => { $('speech-state').textContent = text || ''; $('speech-state').className = error ? 'speech-state error' : 'speech-state'; };
  function persistToken() { if (token) { sessionStorage.setItem('management_ai_memo_token', token); history.replaceState(null, '', location.pathname + location.search); } }
  function appendFinalTranscript(text) {
    const value = String(text || '').trim(); if (!value) return;
    const input = $('input'); input.value = input.value ? `${input.value}${input.value.endsWith('\n') ? '' : ' '}${value}` : value;
    store.saveDraft(input.value).catch(() => status('音声結果を下書き保存できません。入力内容は保持しています。', true));
  }
  function consumeSpeechResults(event) {
    if (!speechSession) return;
    if (speechSession.processedResultCount > event.results.length) speechSession.processedResultCount = 0;
    for (let i = speechSession.processedResultCount; i < event.results.length; i += 1) {
      if (!event.results[i].isFinal) continue;
      const transcript = String(event.results[i][0].transcript || '').trim();
      const previous = speechSession.lastFinalTranscript;
      let addition = transcript;
      if (previous && transcript === previous) addition = '';
      else if (previous && transcript.startsWith(previous)) addition = transcript.slice(previous.length);
      appendFinalTranscript(addition);
      speechSession.lastFinalTranscript = transcript;
      speechSession.processedResultCount = i + 1;
    }
  }
  function speechError(error) {
    const messages = { 'not-allowed': 'マイクの権限が拒否されました。権限を許可するか、文字入力をご利用ください。', 'service-not-allowed': '音声認識が許可されていません。文字入力をご利用ください。', 'audio-capture': 'マイクを利用できません。文字入力をご利用ください。', network: '音声認識の通信でエラーが発生しました。入力内容は保持しています。', aborted: '音声入力を停止しました。' };
    speechStatus(messages[error] || '音声認識でエラーが発生しました。入力内容は保持しています。', error !== 'aborted');
  }
  function stopSpeech() { if (recognition) recognition.stop(); speechRunning = false; $('speech-start').disabled = readOnly; $('speech-stop').disabled = true; speechStatus('音声入力を停止しました。'); }
  function startSpeech() {
    if (readOnly || speechRunning) return;
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { $('speech-start').disabled = true; speechStatus('このブラウザでは音声入力を利用できません。文字入力をご利用ください。', true); return; }
    speechSession = { processedResultCount: 0, lastFinalTranscript: '' };
    recognition = new Speech(); recognition.lang = 'ja-JP'; recognition.continuous = false; recognition.interimResults = true;
    recognition.onstart = () => { speechRunning = true; $('speech-start').disabled = true; $('speech-stop').disabled = false; speechStatus('認識中です。'); };
    recognition.onresult = consumeSpeechResults;
    recognition.onerror = (event) => speechError(event.error);
    recognition.onend = () => { speechRunning = false; speechSession = null; $('speech-start').disabled = readOnly; $('speech-stop').disabled = true; if (!$('speech-state').classList.contains('error')) speechStatus('音声入力を停止しました。'); store.saveDraft($('input').value).catch(() => {}); };
    try { recognition.start(); } catch (error) { speechError(error.name || 'start-failed'); }
  }
  function renderTabs() { $('tabs').replaceChildren(...tabs.map(([key, label]) => { const b = document.createElement('button'); b.textContent = label; b.className = key === state ? '' : 'secondary'; b.onclick = () => { state = key; render(); }; return b; })); }
  function operationText(todo) { const values = [['本文', todo.body], ['誰から', todo.source_person], ['誰に', todo.target_person], ['期限', todo.due_date], ['振った相手', todo.delegated_to], ['報告期限', todo.report_due_date], ['報告内容', todo.report_content]]; return values.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n'); }
  function todoSubject(todo) { return `【TODO】${String(todo.body || '').slice(0, 80)}`; }
  function todoMailBody(todo) { return operationText(todo); }
  function openMailDraft(todo) { const url = `mailto:?subject=${encodeURIComponent(todoSubject(todo))}&body=${encodeURIComponent(todoMailBody(todo))}`; window.location.href = url; status('メール作成画面を開きました。送信は行っていません。'); }
  function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()); }
  function openCalendarDraft(todo, selectedDate) {
    if (!validDate(todo.due_date) && !selectedDate) {
      const dateDialog = $('calendar-date-dialog'); $('calendar-date-input').value = '';
      if (dateDialog.showModal) dateDialog.showModal(); else dateDialog.hidden = false;
      return;
    }
    const date = validDate(todo.due_date) ? todo.due_date : selectedDate;
    if (!validDate(date)) return status('有効な予定日がないため、カレンダー登録を中止しました。', true);
    const title = String(todo.body || '').slice(0, 80); const details = operationText(todo); const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${date.replaceAll('-', '')}/${date.replaceAll('-', '')}&details=${encodeURIComponent(details)}`;
    window.open(url, '_blank', 'noopener'); status('カレンダー作成画面を開きました。保存は行っていません。');
  }
  async function copyTodoText(todo) { try { await navigator.clipboard.writeText(operationText(todo)); status('TODO本文をコピーしました。'); } catch (error) { status('コピーに失敗しました。ブラウザの権限を確認してください。', true); } }
  function openTodoMenu(todo) { selectedTodo = todo; const dialog = $('todo-actions'); if (dialog.showModal) dialog.showModal(); else dialog.hidden = false; }
  function render() {
    renderTabs(); const list = $('list'); list.replaceChildren();
    todos.filter((todo) => todo.status === state).forEach((todo) => {
      const item = document.createElement('article'); item.className = 'todo'; const body = document.createElement('textarea'); body.value = todo.body; body.readOnly = readOnly; body.onchange = () => update(todo, { body: body.value });
      const fields = document.createElement('div'); fields.className = 'fields'; [['source_person', '誰から'], ['target_person', '誰に'], ['delegated_to', '委任先'], ['due_date', '期限'], ['report_due_date', '報告期限'], ['report_content', '報告内容']].forEach(([key, placeholder]) => { const input = document.createElement(key === 'report_content' ? 'textarea' : 'input'); input.placeholder = placeholder; input.value = todo[key] || ''; if (key.endsWith('_date')) input.type = 'date'; input.disabled = readOnly; input.onchange = () => update(todo, { [key]: input.value || null }); fields.appendChild(input); });
      const controls = document.createElement('div'); const select = document.createElement('select'); select.disabled = readOnly; tabs.forEach(([key, label]) => { const option = document.createElement('option'); option.value = key; option.textContent = label; option.selected = key === todo.status; select.appendChild(option); }); select.onchange = () => update(todo, { status: select.value, completed_at: select.value === 'COMPLETED' ? new Date().toISOString() : null }); const menu = document.createElement('button'); menu.textContent = '…'; menu.className = 'secondary'; menu.disabled = readOnly; menu.onclick = () => openTodoMenu(todo); const del = document.createElement('button'); del.textContent = '削除'; del.className = 'danger'; del.disabled = readOnly; del.onclick = () => { if (confirm('このTODOを削除しますか？')) update(todo, { is_deleted: true, deleted_at: new Date().toISOString() }); }; controls.append(select, menu, del); item.append(body, fields, controls); list.appendChild(item);
    });
  }
  async function update(todo, patch) { const before = { ...todo }; Object.assign(todo, patch); try { await store.save(todo); render(); status('保存しました。'); } catch (error) { Object.assign(todo, before); render(); status('保存に失敗しました。入力値は保持しています。', true); } }
  async function register() { if (readOnly) return; const value = $('input').value; if (!value.trim()) return status('本文を入力してください。', true); try { const todo = todoService.createTodo({ body: value }); await store.save(todo); todos.push(todo); $('input').value = ''; await store.saveDraft(''); render(); status('そのまま登録しました。'); } catch (error) { status(error.message || '保存に失敗しました。入力と下書きを保持しています。', true); } }
  async function organize() { if (!token) return status('AI整理には社内TOPから利用を開始してください。', true); const value = $('input').value; if (!value.trim()) return status('本文を入力してください。', true); $('ai').disabled = true; try { const response = await fetch(window.MANAGEMENT_AI_MEMO_CONFIG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ token, inputText: value, clientVersion: 'external-1', timezone: 'Asia/Tokyo' }) }); const result = await response.json(); if (!result.success) throw new Error(result.message || 'AI整理に失敗しました。'); const created = result.todos.map((todo) => todoService.createTodo({ body: todo.body, source_person: todo.sourcePerson, target_person: todo.targetPerson, due_date: todo.dueDate })); for (const todo of created) { await store.save(todo); todos.push(todo); } $('input').value = ''; await store.saveDraft(''); render(); status('AI整理して登録しました。'); } catch (error) { status(error.message || 'AI整理に失敗しました。入力と下書きを保持しています。', true); } finally { $('ai').disabled = false; } }
  function refreshSummary() { store.summary().then((value) => { $('summary').textContent = `保存件数: ${value.count}件 ／ 最終更新: ${value.lastUpdatedAt ? new Date(value.lastUpdatedAt).toLocaleString('ja-JP') : '未保存'}`; }).catch(() => { $('summary').textContent = '保存状態を取得できません。'; }); }
  function download(blob) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `management-ai-memo-${new Date().toISOString().slice(0, 10)}.maimemo`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  async function exportBackup() { const pass = prompt('バックアップ用パスフレーズを入力してください。'); if (pass === null) return; try { download(await store.exportEncryptedBackup(pass)); status('暗号化バックアップを書き出しました。'); } catch (error) { status(error.message, true); } }
  async function importBackup(file) { if (!file) return; if (readOnly) return status('読取専用のため復元できません。', true); const pass = prompt('バックアップ作成時のパスフレーズを入力してください。'); if (pass === null) return; try { await store.importEncryptedBackup(file, pass); todos = await store.all(); const draft = await store.getDraft(); $('input').value = draft ? draft.text : ''; render(); refreshSummary(); status('バックアップを復元しました。'); } catch (error) { status(error.message, true); } }
  async function deleteAll() { if (readOnly) return status('読取専用のため全件削除できません。', true); if (prompt('確認のため「すべて削除」と入力してください。') !== 'すべて削除') return status('全件削除を中止しました。'); try { await store.deleteAllLocalData(); todos = []; $('input').value = ''; render(); refreshSummary(); status('端末内のデータをすべて削除しました。'); } catch (error) { status(error.message, true); } }
  function toggleSettings() { $('settings-panel').hidden = !$('settings-panel').hidden; if (!$('settings-panel').hidden) refreshSummary(); }
  (async () => { persistToken(); store = window.todoStore; const initialized = await store.init(); readOnly = initialized.readOnly; todos = await store.all(); const draft = await store.getDraft(); if (draft) $('input').value = draft.text; $('input').oninput = () => store.saveDraft($('input').value); $('speech-start').onclick = startSpeech; $('speech-stop').onclick = stopSpeech; $('save').onclick = register; $('ai').onclick = organize; $('settings').onclick = toggleSettings; $('backup-export').onclick = exportBackup; $('backup-import').onclick = () => $('backup-file').click(); $('backup-file').onchange = () => { importBackup($('backup-file').files[0]); $('backup-file').value = ''; }; $('delete-all').onclick = deleteAll; $('email-action').onclick = () => { if (selectedTodo) openMailDraft(selectedTodo); }; $('calendar-action').onclick = () => { if (selectedTodo) openCalendarDraft(selectedTodo); }; $('calendar-date-form').onsubmit = (event) => { event.preventDefault(); const date = $('calendar-date-input').value; if (!validDate(date)) return status('有効な予定日を選択または入力してください。', true); $('calendar-date-dialog').close(); if (selectedTodo) openCalendarDraft(selectedTodo, date); }; $('calendar-date-cancel').onclick = () => $('calendar-date-dialog').close(); $('copy-action').onclick = () => { if (selectedTodo) copyTodoText(selectedTodo); }; render(); if (readOnly) { $('input').readOnly = true; $('speech-start').disabled = true; $('save').disabled = true; $('ai').disabled = true; } })().catch((error) => status(error.message || '初期化に失敗しました。', true));
}());

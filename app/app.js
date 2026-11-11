'use strict';
(() => {
  const CFG = {
    time: { max: 120, step: 5, unit: 'min', def: 15, label: 'Duração', majorEvery: 3, hint: 'Uma volta = 2 horas' },
    reps: { max: 40, step: 1, unit: 'vezes', def: 10, label: 'Repetições', majorEvery: 5, hint: 'Uma volta = 40 vezes' }
  };
  const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DAY_INI = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const SUGGEST = ['📖', '🧘', '💧', '🏃', '💪', '🎸', '✍️', '🥗', '😴', '🚶', '🧠', '🎨', '📵', '🧹', '🦷', '💊'];
  const LONG_PRESS_MS = 550;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* sem vibração */ } };

  function fmt(kind, v) {
    if (kind === 'reps') return v === 1 ? '1 vez' : `${v} vezes`;
    if (v < 60) return `${v} min`;
    const h = Math.floor(v / 60), m = v % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  /* ---------- armazenamento: IndexedDB no aparelho ---------- */
  const DB_NAME = 'circulo';
  const DB_VER = 1;
  let db = null;
  let dbFailed = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB indisponível')); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('habits')) d.createObjectStore('habits', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('logs')) d.createObjectStore('logs', { keyPath: 'id' }).createIndex('habitId', 'habitId');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(stores, fn) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      fn(t);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  function readAll(storeName) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(storeName).objectStore(storeName).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }
  function readMeta(key) {
    return new Promise((resolve) => {
      const r = db.transaction('meta').objectStore('meta').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
  }
  const store = {
    putHabit: (h) => tx(['habits'], (t) => t.objectStore('habits').put(h)),
    deleteHabit: (id) => tx(['habits', 'logs'], (t) => {
      t.objectStore('habits').delete(id);
      const logs = t.objectStore('logs');
      logs.index('habitId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const c = e.target.result;
        if (c) { logs.delete(c.primaryKey); c.continue(); }
      };
    }),
    addLog: (l) => tx(['logs'], (t) => t.objectStore('logs').put(l)),
    deleteLog: (id) => tx(['logs'], (t) => t.objectStore('logs').delete(id)),
    setSel: (i) => tx(['meta'], (t) => t.objectStore('meta').put(i, 'sel'))
  };
  const safe = (p) => p.catch((err) => {
    console.error(err);
    toast('Não consegui salvar no aparelho. Tente de novo.');
  });
  let selT = 0;
  const saveSelSoon = () => { clearTimeout(selT); selT = setTimeout(() => safe(store.setSel(state.sel)), 300); };
  let askedPersist = false;
  function askPersist() {
    if (askedPersist) return;
    askedPersist = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  const state = { habits: [], logs: [], sel: 0 };

  /* ---------- navegação entre telas ---------- */
  const screens = { home: $('scr-home'), log: $('scr-log'), new: $('scr-new') };
  let current = 'home';
  function show(name, focusEl) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('is-active', k === name);
    current = name;
    if (focusEl) setTimeout(() => focusEl.focus({ preventScroll: true }), 40);
  }

  /* ---------- carrossel no círculo ---------- */
  const home = $('scr-home');
  const track = $('track');
  const pager = $('pager');
  const chips = () => Array.from(track.querySelectorAll('.habit-chip'));
  const itemW = () => (track.querySelector('.habit-chip') || {}).offsetWidth || 1;
  const clampIdx = (i) => Math.max(0, Math.min(state.habits.length - 1, i));

  function renderCarousel() {
    chips().forEach((n) => n.remove());
    state.habits.forEach((h, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'habit-chip';
      b.dataset.i = String(i);
      b.setAttribute('aria-label', `${h.name}: registrar`);
      b.tabIndex = i === state.sel ? 0 : -1;
      const s = document.createElement('span');
      s.className = 'emo';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = h.emoji;
      b.append(s);
      track.append(b);
    });
    pager.innerHTML = state.habits.length > 1
      ? state.habits.map((_, i) => `<span class="${i === state.sel ? 'on' : ''}"></span>`).join('')
      : '';
  }

  function paint() {
    if (!state.habits.length) return;
    const w = itemW(), x = track.scrollLeft;
    chips().forEach((el, i) => {
      const t = Math.min(Math.abs(i * w - x) / w, 1.6);
      el.style.setProperty('--s', (1 - t * 0.42).toFixed(3));
      el.style.setProperty('--o', (1 - t * 0.55).toFixed(3));
    });
    const idx = clampIdx(Math.round(x / w));
    if (idx !== state.sel) { state.sel = idx; renderMeta(); saveSelSoon(); }
  }
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); });
  }, { passive: true });

  function goTo(i, smooth = true) {
    track.scrollTo({ left: clampIdx(i) * itemW(), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }
  function settleCarousel() {
    requestAnimationFrame(() => { track.scrollLeft = state.sel * itemW(); paint(); });
  }

  function updateTodayLabel() {
    const now = new Date();
    $('today-label').textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  }

  function renderMeta() {
    const empty = state.habits.length === 0;
    home.classList.toggle('is-empty', empty);
    $('empty-add').hidden = !empty;
    $('week').hidden = empty;
    $('btn-log').textContent = empty ? 'Criar hábito' : 'Registrar';
    if (empty) {
      $('habit-name').textContent = 'Seu primeiro hábito';
      $('habit-today').textContent = 'Toque no círculo pra criar';
      return;
    }
    const h = state.habits[state.sel];
    $('habit-name').textContent = h.name;
    const today = dayKey(new Date());
    const mine = state.logs.filter((l) => l.habitId === h.id);
    const total = mine.filter((l) => l.day === today).reduce((a, l) => a + l.value, 0);
    const days = new Set(mine.map((l) => l.day));
    const weekEl = $('week');
    weekEl.innerHTML = '';
    let count = 0;
    for (let n = 6; n >= 0; n--) {
      const d = daysAgo(n);
      const done = days.has(dayKey(d));
      if (done) count++;
      const li = document.createElement('li');
      li.className = `${done ? 'done' : ''} ${n === 0 ? 'today' : ''}`.trim();
      li.innerHTML = `<span class="dot"></span><span class="d">${DAY_INI[d.getDay()]}</span>`;
      li.setAttribute('aria-label', `${DAYS[d.getDay()]}: ${done ? 'feito' : 'não feito'}`);
      weekEl.append(li);
    }
    weekEl.setAttribute('aria-label', `Feito em ${count} dos últimos 7 dias`);
    $('habit-today').textContent = total
      ? `Hoje: ${fmt(h.kind, total)} · ${count} de 7 dias`
      : `Nada hoje ainda · ${count} de 7 dias`;
    chips().forEach((el, i) => { el.tabIndex = i === state.sel ? 0 : -1; });
    Array.from(pager.children).forEach((d, i) => d.classList.toggle('on', i === state.sel));
  }

  /* arrastar com mouse (desktop) */
  let drag = null, suppressClick = false;
  track.addEventListener('dragstart', (e) => e.preventDefault());
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: track.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; track.classList.add('dragging'); }
    if (drag.moved) track.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      track.classList.remove('dragging');
      goTo(Math.round(track.scrollLeft / itemW()));
    }
    drag = null;
  });

  /* segurar o emoji do centro = editar */
  let pressT = 0, pressAt = null, longPressed = false;
  track.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.habit-chip');
    if (!b) return;
    longPressed = false;
    pressAt = { x: e.clientX, y: e.clientY };
    clearTimeout(pressT);
    pressT = setTimeout(() => {
      const i = Number(b.dataset.i);
      if (Math.abs(track.scrollLeft - i * itemW()) > itemW() * 0.3) return;
      longPressed = true;
      if (drag) { drag = null; track.classList.remove('dragging'); }
      vibrate(12);
      openForm(state.habits[i]);
    }, LONG_PRESS_MS);
  });
  const cancelPress = () => { clearTimeout(pressT); pressAt = null; };
  track.addEventListener('pointermove', (e) => {
    if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 8) cancelPress();
  });
  track.addEventListener('pointerup', cancelPress);
  track.addEventListener('pointercancel', cancelPress);
  track.addEventListener('contextmenu', (e) => e.preventDefault());

  track.addEventListener('click', (e) => {
    const b = e.target.closest('.habit-chip');
    if (!b) return;
    if (suppressClick) return;
    if (longPressed) { longPressed = false; return; }
    const i = Number(b.dataset.i);
    const centered = Math.abs(track.scrollLeft - i * itemW()) < itemW() * 0.3;
    if (centered) openLog(i); else goTo(i);
  });
  track.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = clampIdx(state.sel + (e.key === 'ArrowRight' ? 1 : -1));
    goTo(i);
    setTimeout(() => { const c = chips()[i]; if (c) c.focus({ preventScroll: true }); }, 0);
  });

  /* ---------- anel (slider) ---------- */
  const dial = $('dial'), arc = $('dial-arc'), knob = $('dial-knob');
  const R = 132, C = 2 * Math.PI * R;
  arc.setAttribute('stroke-dasharray', C.toFixed(2));
  let logHabit = null, logValue = 0, saving = false, dialDrag = false;

  function buildTicks(c) {
    const n = c.max / c.step;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const major = i % c.majorEvery === 0;
      const r1 = major ? 104 : 109, r2 = 116;
      const s = Math.sin(a), co = Math.cos(a);
      html += `<line class="tick${major ? ' major' : ''}" x1="${(150 + r1 * s).toFixed(2)}" y1="${(150 - r1 * co).toFixed(2)}" x2="${(150 + r2 * s).toFixed(2)}" y2="${(150 - r2 * co).toFixed(2)}"/>`;
    }
    $('ticks').innerHTML = html;
  }

  function setValue(v) {
    const c = CFG[logHabit.kind];
    v = Math.max(0, Math.min(c.max, Math.round(v / c.step) * c.step));
    if (dialDrag && v !== logValue) vibrate(6);
    logValue = v;
    const f = v / c.max;
    arc.style.strokeDashoffset = `${(C * (1 - f)).toFixed(2)}px`;
    const a = f * 2 * Math.PI;
    knob.setAttribute('cx', (150 + R * Math.sin(a)).toFixed(2));
    knob.setAttribute('cy', (150 - R * Math.cos(a)).toFixed(2));
    $('dial-value').textContent = String(v);
    $('dial-unit').textContent = c.unit;
    dial.setAttribute('aria-valuenow', String(v));
    dial.setAttribute('aria-valuetext', fmt(logHabit.kind, v));
    const btn = $('btn-save');
    btn.disabled = v === 0 || saving;
    btn.textContent = v === 0 ? 'Gire o anel pra marcar' : `Salvar ${fmt(logHabit.kind, v)}`;
  }

  function openLog(i) {
    if (!state.habits.length) { openForm(null); return; }
    if (typeof i === 'number' && i !== state.sel) { state.sel = clampIdx(i); renderMeta(); saveSelSoon(); }
    logHabit = state.habits[state.sel];
    const c = CFG[logHabit.kind];
    $('log-emoji').textContent = logHabit.emoji;
    $('log-name').textContent = logHabit.name;
    dial.setAttribute('aria-label', `${c.label} de ${logHabit.name}`);
    dial.setAttribute('aria-valuemax', String(c.max));
    $('dial-hint').textContent = c.hint;
    buildTicks(c);
    const last = state.logs.filter((l) => l.habitId === logHabit.id).sort((a, b) => b.ts - a.ts)[0];
    saving = false;
    setValue(last ? last.value : c.def);
    show('log', dial);
  }

  function valueFromEvent(e, guard) {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += 2 * Math.PI;
    const c = CFG[logHabit.kind];
    let v = Math.round(((a / (2 * Math.PI)) * c.max) / c.step) * c.step;
    if (guard) {
      if (logValue >= c.max * 0.75 && v <= c.max * 0.25) v = c.max;
      else if (logValue <= c.max * 0.25 && v >= c.max * 0.75) v = 0;
    }
    return v;
  }
  dial.addEventListener('pointerdown', (e) => {
    const r = dial.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (dist < (r.width / 2) * 0.62) return; // toque no disco do meio não mexe no valor
    dialDrag = true;
    try { dial.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    setValue(valueFromEvent(e, false));
  });
  dial.addEventListener('pointermove', (e) => { if (dialDrag) setValue(valueFromEvent(e, true)); });
  const endDial = () => { dialDrag = false; };
  dial.addEventListener('pointerup', endDial);
  dial.addEventListener('pointercancel', endDial);
  dial.addEventListener('keydown', (e) => {
    const c = CFG[logHabit.kind];
    const map = { ArrowRight: c.step, ArrowUp: c.step, ArrowLeft: -c.step, ArrowDown: -c.step, PageUp: c.step * 5, PageDown: -c.step * 5 };
    if (e.key in map) { e.preventDefault(); setValue(logValue + map[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); setValue(0); }
    else if (e.key === 'End') { e.preventDefault(); setValue(c.max); }
    else if (e.key === 'Enter') { e.preventDefault(); save(); }
  });
  $('dec').addEventListener('click', () => setValue(logValue - CFG[logHabit.kind].step));
  $('inc').addEventListener('click', () => setValue(logValue + CFG[logHabit.kind].step));

  function save() {
    if (!logValue || saving) return;
    saving = true;
    $('btn-save').disabled = true;
    const now = new Date();
    const habit = logHabit;
    const log = { id: uid(), habitId: habit.id, value: logValue, day: dayKey(now), ts: now.getTime() };
    state.logs.push(log);
    safe(store.addLog(log));
    askPersist();
    const wrap = $('dial-wrap');
    wrap.classList.remove('saved');
    void wrap.offsetWidth;
    wrap.classList.add('saved');
    const msg = `+${fmt(habit.kind, log.value)} · ${habit.name}`;
    setTimeout(() => {
      renderMeta();
      show('home', chips()[state.sel]);
      toast(msg, {
        label: 'Desfazer',
        fn: () => {
          state.logs = state.logs.filter((l) => l.id !== log.id);
          safe(store.deleteLog(log.id));
          renderMeta();
          toast('Registro desfeito');
        }
      });
      saving = false;
    }, reduce ? 0 : 420);
  }
  $('btn-save').addEventListener('click', save);
  $('log-back').addEventListener('click', () => show('home', chips()[state.sel]));

  /* ---------- novo hábito / editar ---------- */
  const form = $('new-form'), emojiInput = $('emoji-input'), nameInput = $('name-input');
  let newEmoji = '';
  let editing = null;

  function lastGrapheme(s) {
    s = s.trim();
    if (!s) return '';
    if (window.Intl && Intl.Segmenter) {
      const segs = Array.from(new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(s));
      return segs[segs.length - 1].segment;
    }
    return Array.from(s).pop();
  }
  function renderGrid() {
    $('emoji-grid').innerHTML = SUGGEST.map((e) =>
      `<button type="button" class="emoji-opt" role="radio" aria-checked="${e === newEmoji}" aria-label="${e}">${e}</button>`
    ).join('');
  }
  function syncGrid() {
    $('emoji-grid').querySelectorAll('.emoji-opt').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === newEmoji)));
  }
  function validate() { $('btn-create').disabled = !(newEmoji && nameInput.value.trim()); }

  $('emoji-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.emoji-opt');
    if (!b) return;
    newEmoji = b.textContent;
    emojiInput.value = newEmoji;
    syncGrid();
    validate();
  });
  emojiInput.addEventListener('input', () => {
    newEmoji = lastGrapheme(emojiInput.value);
    emojiInput.value = newEmoji;
    syncGrid();
    validate();
  });
  nameInput.addEventListener('input', validate);

  let delT = 0;
  function resetDelete() {
    const b = $('btn-delete');
    clearTimeout(delT);
    b.dataset.armed = '';
    b.textContent = 'Apagar hábito';
  }

  function openForm(h) {
    editing = h || null;
    form.reset();
    newEmoji = h ? h.emoji : '';
    emojiInput.value = newEmoji;
    nameInput.value = h ? h.name : '';
    const kind = h ? h.kind : 'time';
    form.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
    const locked = !!h && state.logs.some((l) => l.habitId === h.id);
    form.querySelectorAll('input[name="kind"]').forEach((r) => { r.disabled = locked; });
    $('kind-note').hidden = !locked;
    $('form-title').textContent = h ? 'Editar hábito' : 'Novo hábito';
    screens.new.setAttribute('aria-label', h ? 'Editar hábito' : 'Novo hábito');
    $('btn-create').textContent = h ? 'Salvar alterações' : 'Criar hábito';
    $('btn-delete').hidden = !h;
    resetDelete();
    renderGrid();
    validate();
    show('new', $('emoji-grid').querySelector('.emoji-opt'));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('btn-create').disabled) return;
    const name = nameInput.value.trim();
    const kind = form.querySelector('input[name="kind"]:checked').value;
    if (editing) {
      editing.emoji = newEmoji;
      editing.name = name;
      if (!state.logs.some((l) => l.habitId === editing.id)) editing.kind = kind;
      safe(store.putHabit(editing));
      editing = null;
      renderCarousel();
      renderMeta();
      show('home', chips()[state.sel]);
      settleCarousel();
      toast('Hábito atualizado');
      return;
    }
    const h = { id: uid(), emoji: newEmoji, name, kind, created: Date.now() };
    const first = state.habits.length === 0;
    state.habits.push(h);
    state.sel = state.habits.length - 1;
    safe(store.putHabit(h));
    saveSelSoon();
    askPersist();
    renderCarousel();
    renderMeta();
    show('home', chips()[state.sel]);
    settleCarousel();
    toast(first ? `${h.emoji} criado. Segure o emoji pra editar.` : `${h.emoji} ${h.name} criado`);
  });

  $('btn-delete').addEventListener('click', () => {
    const b = $('btn-delete');
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = 'Toque de novo pra apagar';
      clearTimeout(delT);
      delT = setTimeout(resetDelete, 3000);
      return;
    }
    resetDelete();
    const h = editing;
    if (!h) return;
    state.habits = state.habits.filter((x) => x.id !== h.id);
    state.logs = state.logs.filter((l) => l.habitId !== h.id);
    safe(store.deleteHabit(h.id));
    state.sel = Math.max(0, Math.min(state.sel, state.habits.length - 1));
    saveSelSoon();
    editing = null;
    renderCarousel();
    renderMeta();
    show('home', state.habits.length ? chips()[state.sel] : $('empty-add'));
    settleCarousel();
    toast(`${h.name} apagado`);
  });

  $('btn-new').addEventListener('click', () => openForm(null));
  $('empty-add').addEventListener('click', () => openForm(null));
  $('new-back').addEventListener('click', () => { editing = null; show('home', $('btn-new')); });

  /* ---------- geral ---------- */
  let toastT = 0;
  function toast(msg, action) {
    const t = $('toast'), a = $('toast-action');
    $('toast-msg').textContent = msg;
    a.hidden = !action;
    t.classList.toggle('has-action', !!action);
    a.onclick = action ? () => { t.classList.remove('show'); action.fn(); } : null;
    if (action) a.textContent = action.label;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2400);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || current === 'home') return;
    e.preventDefault();
    const target = current === 'new' ? $('btn-new') : chips()[state.sel];
    editing = null;
    show('home', target);
  });
  $('btn-log').addEventListener('click', () => openLog());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    updateTodayLabel();
    renderMeta();
  });
  window.addEventListener('resize', () => settleCarousel());

  async function boot() {
    updateTodayLabel();
    try {
      db = await openDB();
      const [habits, logs, sel] = await Promise.all([readAll('habits'), readAll('logs'), readMeta('sel')]);
      state.habits = habits.sort((a, b) => a.created - b.created);
      state.logs = logs;
      state.sel = Number.isInteger(sel) ? sel : 0;
    } catch (err) {
      console.error(err);
      db = null;
      dbFailed = true;
    }
    state.sel = Math.max(0, Math.min(state.sel, state.habits.length - 1));
    renderCarousel();
    renderMeta();
    settleCarousel();
    if (dbFailed) toast('Este navegador não deixou guardar dados. Os registros somem ao fechar.');
  }
  boot();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker', err));
    });
  }
})();

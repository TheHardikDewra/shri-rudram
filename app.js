/* ========================================
   Sri Rudram - App Logic
   ======================================== */

(function () {
  'use strict';

  // Tells sync.js a synced key just changed. Harmless when sync.js is absent.
  function syncNotify(key) {
    document.dispatchEvent(new CustomEvent('sync:local-change', { detail: { key } }));
  }

  // ---- Data ----
  if (typeof RUDRAM_DATA === 'undefined') {
    console.error('RUDRAM_DATA not loaded');
    return;
  }
  const DATA = RUDRAM_DATA;
  const NAMAKAM = DATA.namakam;
  const CHAMAKAM = DATA.chamakam;
  const ALL_ANUVAKAS = NAMAKAM.concat(CHAMAKAM);
  const YT_VIDEO_ID = DATA.meta.youtubeVideoId;

  // Enrich each anuvaka with aggregated sanskrit/transliteration strings
  // (computed from mantras array for preview display and legacy callers).
  ALL_ANUVAKAS.forEach(function (a) {
    if (Array.isArray(a.mantras)) {
      a.sanskrit = a.mantras.map(function (m) { return m.sanskrit; }).join('\n');
      a.transliteration = a.mantras.map(function (m) { return m.iast; }).join('\n');
    }
  });

  // Composite id helpers. Each anuvaka has {section, number}
  function idOf(a) { return a.section + '-' + a.number; }
  function byId(id) {
    const parts = id.split('-');
    const section = parts[0];
    const num = parseInt(parts[1], 10);
    return (section === 'namakam' ? NAMAKAM : CHAMAKAM).find(a => a.number === num) || null;
  }

  // Build linear order: namakam 1..11 then chamakam 1..11
  function linearIndex(anuvaka) {
    if (anuvaka.section === 'namakam') return anuvaka.number - 1;
    return 11 + anuvaka.number - 1;
  }
  function anuvakaByLinearIndex(idx) {
    if (idx < 0) idx = 0;
    if (idx > 21) idx = 21;
    return ALL_ANUVAKAS[idx];
  }

  // ---- State ----
  const STATE = {
    currentView: 'home',
    completed: new Set(), // Set of "namakam-1", "chamakam-3" etc
    expandedCardId: null,
    chantIdx: 0,           // linear index 0..21
    chantShowIast: true,
    chantShowMeaning: true,
    chantShowSwara: true,
    chantFullscreen: false,
    chantAutoSync: true,
    globalShowSwara: true,  // for Namakam/Chamakam list views
    ytPlayer: null,
    ytReady: false,
    ytPollTimer: null,
    ytCurrentTime: 0,
  };

  // ---- localStorage helpers ----
  const KEYS = {
    theme: 'sr_theme',
    fontSize: 'sr_fontsize',
    completed: 'sr_completed',
    sadhana: 'sr_sadhana',
    chantShow: 'sr_chant_show',
    chantPos: 'sr_chant_pos',
  };
  const EXPORT_KEYS = Object.values(KEYS);

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }
  function lsGetJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSetJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  // ---- Completion state ----
  function loadCompleted() {
    const arr = lsGetJSON(KEYS.completed, []);
    if (Array.isArray(arr)) STATE.completed = new Set(arr);
  }
  function saveCompleted() {
    lsSetJSON(KEYS.completed, Array.from(STATE.completed)); syncNotify(KEYS.completed);
  }
  function isCompleted(id) { return STATE.completed.has(id); }
  function toggleCompleted(id) {
    if (STATE.completed.has(id)) STATE.completed.delete(id);
    else STATE.completed.add(id);
    saveCompleted();
  }

  // ---- Sadhana log ----
  function loadSadhana() {
    const data = lsGetJSON(KEYS.sadhana, null);
    if (data && typeof data.total === 'number' && Array.isArray(data.log)) return data;
    return { total: 0, log: [], streak: 0 };
  }
  function saveSadhana(data) { lsSetJSON(KEYS.sadhana, data); syncNotify(KEYS.sadhana); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function calcStreak(log) {
    if (!log.length) return 0;
    const set = new Set(log.filter(e => e.count > 0).map(e => e.date));
    let streak = 0;
    const d = new Date();
    while (true) {
      const ds = d.toISOString().slice(0, 10);
      if (set.has(ds)) { streak++; d.setDate(d.getDate() - 1); } else break;
    }
    return streak;
  }
  function logRecitation() {
    const data = loadSadhana();
    const today = todayStr();
    const entry = data.log.find(e => e.date === today);
    if (entry) entry.count++;
    else data.log.push({ date: today, count: 1 });
    data.total++;
    data.streak = calcStreak(data.log);
    saveSadhana(data);
    renderSadhana();
  }
  function renderSadhana() {
    const data = loadSadhana();
    const totalEl = document.getElementById('sadhana-total');
    const streakEl = document.getElementById('sadhana-streak');
    const monthEl = document.getElementById('sadhana-month');
    const lastEl = document.getElementById('sadhana-last');
    if (!totalEl) return;
    data.streak = calcStreak(data.log);
    totalEl.textContent = data.total.toLocaleString('en-IN');
    streakEl.textContent = data.streak;

    const now = new Date();
    const prefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    let monthCount = 0;
    data.log.forEach(e => { if (e.date.startsWith(prefix)) monthCount += e.count; });
    monthEl.textContent = monthCount.toLocaleString('en-IN');

    if (data.log.length > 0) {
      const sorted = data.log.slice().sort((a, b) => b.date.localeCompare(a.date));
      const d = new Date(sorted[0].date + 'T00:00:00');
      lastEl.textContent = 'Last: ' + d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
      lastEl.textContent = '';
    }
  }

  // ---- Font size ----
  const FONTSIZE_MAP = { small: '14px', normal: '16px', large: '18px' };
  function getFontSize() { return lsGet(KEYS.fontSize) || 'normal'; }
  function applyFontSize(size) {
    if (!FONTSIZE_MAP[size]) size = 'normal';
    document.documentElement.style.fontSize = FONTSIZE_MAP[size];
    lsSet(KEYS.fontSize, size);
  }
  function cycleFontSize(direction) {
    const sizes = ['small', 'normal', 'large'];
    let idx = sizes.indexOf(getFontSize());
    idx += direction;
    if (idx < 0) idx = 0;
    if (idx > sizes.length - 1) idx = sizes.length - 1;
    applyFontSize(sizes[idx]);
  }

  // ---- Theme ----
  const THEME_CYCLE = ['system', 'light', 'dark'];
  const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
  function getStoredTheme() { return lsGet(KEYS.theme) || 'system'; }
  function applyTheme(mode) {
    const html = document.documentElement;
    if (mode === 'dark') html.setAttribute('data-theme', 'dark');
    else if (mode === 'light') html.setAttribute('data-theme', 'light');
    else html.removeAttribute('data-theme');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = THEME_LABELS[mode];
    lsSet(KEYS.theme, mode);
  }
  function cycleTheme() {
    const cur = getStoredTheme();
    const idx = THEME_CYCLE.indexOf(cur);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    applyTheme(next);
  }

  // ---- Escape HTML ----
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Router ----
  const ALLOWED_VIEWS = ['home', 'namakam', 'chamakam', 'sages', 'chant', 'about'];
  function getHash() {
    const h = window.location.hash.replace('#', '').trim();
    return ALLOWED_VIEWS.includes(h) ? h : 'home';
  }
  function navigate(view) {
    if (!ALLOWED_VIEWS.includes(view)) view = 'home';
    STATE.currentView = view;
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.hidden = v.id !== 'view-' + view;
    });

    if (view === 'home') renderHome();
    else if (view === 'namakam') renderAnuvakaList('namakam');
    else if (view === 'chamakam') renderAnuvakaList('chamakam');
    else if (view === 'sages') renderSagesView();
    else if (view === 'chant') initChant();

    // Stop polling when leaving chant
    if (view !== 'chant') stopYtPolling();

    // Exit fullscreen when leaving chant
    if (view !== 'chant' && STATE.chantFullscreen) {
      STATE.chantFullscreen = false;
      document.body.classList.remove('chant-fullscreen');
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  window.addEventListener('hashchange', () => navigate(getHash()));

  // ---- Home View ----
  function renderHome() {
    document.getElementById('stat-completed').textContent = STATE.completed.size;
    renderSadhana();
  }

  // ---- Sages View: Maharudra Sadhana + 11 Forms ----
  function renderSagesView() {
    renderSadhanaDays();
    renderRudraForms();
  }

  function renderSadhanaDays() {
    const host = document.getElementById('sadhana-days');
    if (!host || host.dataset.rendered === '1') return;

    // Collect rishi data from namakam anuvaka-level rishi_info.sadhana_sages
    const seen = {};
    NAMAKAM.forEach(function (a) {
      if (!a.rishi_info || !Array.isArray(a.rishi_info.sadhana_sages)) return;
      a.rishi_info.sadhana_sages.forEach(function (s) {
        if (!seen[s.day]) {
          seen[s.day] = {
            day: s.day,
            rishi: s.rishi,
            purpose: s.purpose,
            invocations: []
          };
        }
        const versesText = Array.isArray(s.verses) ? 'Verses ' + s.verses.join(', ') : s.verses;
        seen[s.day].invocations.push('Anuvak ' + a.number + ': ' + versesText);
      });
    });

    const days = Object.values(seen).sort(function (a, b) { return a.day - b.day; });

    let html = '';
    days.forEach(function (d) {
      html += '<div class="sadhana-day">' +
        '<div class="sadhana-day-header">' +
          '<span class="sadhana-day-num">Day ' + d.day + '</span>' +
          '<span class="sadhana-day-rishi">' + escHtml(d.rishi) + '</span>' +
        '</div>' +
        '<div class="sadhana-day-invocations">' + escHtml(d.invocations.join(' • ')) + '</div>' +
        '<div class="sadhana-day-purpose">' + escHtml(d.purpose) + '</div>' +
      '</div>';
    });
    host.innerHTML = html;
    host.dataset.rendered = '1';
  }

  function renderRudraForms() {
    const host = document.getElementById('rudra-forms-grid');
    if (!host || host.dataset.rendered === '1') return;
    const forms = (DATA.meta && DATA.meta.eleven_forms_of_rudra) || [];
    if (!forms.length) return;

    let html = '';
    forms.forEach(function (f, i) {
      // Format is "Name (description)" - split if present
      const m = String(f).match(/^(.+?)\s*\((.+)\)\s*$/);
      const name = m ? m[1].trim() : String(f);
      const desc = m ? m[2].trim() : '';
      html += '<div class="rudra-form">' +
        '<span class="rudra-form-num">' + (i + 1) + '</span>' +
        '<div class="rudra-form-body">' +
          '<span class="rudra-form-name">' + escHtml(name) + '</span>' +
          (desc ? '<span class="rudra-form-desc">' + escHtml(desc) + '</span>' : '') +
        '</div>' +
      '</div>';
    });
    host.innerHTML = html;
    host.dataset.rendered = '1';
  }

  // ---- Anuvaka List (Namakam / Chamakam) ----
  function renderAnuvakaList(section) {
    const list = section === 'namakam' ? NAMAKAM : CHAMAKAM;
    const container = document.getElementById(section + '-list');
    if (!container) return;
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach(a => frag.appendChild(createAnuvakaCard(a)));
    container.appendChild(frag);
    updateAnuvakaStats(section);
  }

  function updateAnuvakaStats(section) {
    const list = section === 'namakam' ? NAMAKAM : CHAMAKAM;
    const completedCount = list.filter(a => isCompleted(idOf(a))).length;
    const counter = document.getElementById(section + '-counter');
    const prog = document.getElementById(section + '-progress');
    if (counter) counter.textContent = list.length + ' anuvakas';
    if (prog) prog.textContent = completedCount + ' / ' + list.length + ' learned';
  }

  function previewLine(text) {
    if (!text) return '';
    const firstPart = text.split('\n')[0] || '';
    // Cap length for preview
    return firstPart.length > 140 ? firstPart.slice(0, 140) + '...' : firstPart;
  }

  function renderMantraStack(mantras, opts) {
    if (!Array.isArray(mantras) || mantras.length === 0) return '';
    opts = opts || {};
    const useSwara = opts.useSwara !== false;
    let html = '<div class="mantra-stack' + (useSwara ? '' : ' no-swara') + '">';
    mantras.forEach(function (m) {
      const keyWordsHtml = Array.isArray(m.key_words) && m.key_words.length
        ? '<div class="mantra-keywords">' +
            m.key_words.map(function (k) {
              return '<span class="mantra-keyword">' + escHtml(k) + '</span>';
            }).join('') +
          '</div>'
        : '';
      const swaraText = (useSwara && m.sanskrit_swara) ? m.sanskrit_swara : m.sanskrit;
      html += '' +
        '<div class="mantra-item">' +
          '<div class="mantra-header">' +
            '<span class="mantra-num">' + m.id + '</span>' +
            '<span class="mantra-label">' + escHtml(m.label || '') + '</span>' +
          '</div>' +
          '<div class="mantra-sanskrit">' + escHtml(swaraText) + '</div>' +
          '<div class="mantra-iast">' + escHtml(m.iast) + '</div>' +
          '<div class="mantra-meaning">' + escHtml(m.meaning) + '</div>' +
          keyWordsHtml +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderRishiInfo(a) {
    if (!a.rishi_info) return '';
    const r = a.rishi_info;
    let html = '<div class="rishi-info">';
    html += '<div class="rishi-info-header">Traditional Context</div>';
    const rows = [];
    if (r.overall_rishi) rows.push(['Rishi', r.overall_rishi]);
    if (r.chanda) rows.push(['Chanda (meter)', r.chanda]);
    if (r.devata) rows.push(['Devata', r.devata]);
    if (r.purpose) rows.push(['Purpose / Phala', r.purpose]);
    if (r.story) rows.push(['Context', r.story]);
    rows.forEach(function (row) {
      html += '<div class="rishi-row">' +
        '<div class="rishi-label">' + escHtml(row[0]) + '</div>' +
        '<div class="rishi-value">' + escHtml(row[1]) + '</div>' +
      '</div>';
    });

    // Maharudra Sadhana sages (Namakam only)
    if (Array.isArray(r.sadhana_sages) && r.sadhana_sages.length) {
      html += '<div class="rishi-sadhana-header">Maharudra Sadhana - Sages Who Invoked These Verses</div>';
      r.sadhana_sages.forEach(function (s) {
        const versesText = Array.isArray(s.verses) ? 'Verses ' + s.verses.join(', ') : s.verses;
        html += '<div class="rishi-sage">' +
          '<div class="rishi-sage-header">' +
            '<span class="rishi-sage-day">Day ' + s.day + '</span>' +
            '<span class="rishi-sage-name">' + escHtml(s.rishi) + '</span>' +
            '<span class="rishi-sage-verses">' + escHtml(versesText) + '</span>' +
          '</div>' +
          '<div class="rishi-sage-purpose">' + escHtml(s.purpose) + '</div>' +
        '</div>';
      });
    }

    if (r.source) {
      html += '<div class="rishi-source">Source: ' + escHtml(r.source) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function createAnuvakaCard(a) {
    const card = document.createElement('div');
    const id = idOf(a);
    const completed = isCompleted(id);
    card.className = 'anuvaka-card' + (completed ? ' completed' : '');
    card.dataset.id = id;

    const sectionLabel = a.section === 'namakam' ? 'Namakam' : 'Chamakam';
    const tagText = sectionLabel + ' ' + a.number;
    const mantraCount = Array.isArray(a.mantras) ? a.mantras.length : 0;

    card.innerHTML = '' +
      '<div class="anuvaka-tag">' + escHtml(tagText) + '</div>' +
      '<div class="anuvaka-theme">' + escHtml(a.theme) + '</div>' +
      '<div class="anuvaka-preview">' + escHtml(previewLine(a.sanskrit)) + '</div>' +
      '<div class="anuvaka-preview-translit">' + escHtml(previewLine(a.transliteration)) + '</div>' +
      '<div class="anuvaka-meta-row">' +
        '<span class="anuvaka-chunk-count">' + mantraCount + ' verses</span>' +
      '</div>' +
      '<div class="anuvaka-body">' +
        '<div class="anuvaka-summary">' + escHtml(a.meaning) + '</div>' +
        '<div class="anuvaka-toggle-row">' +
          '<label class="anuvaka-toggle"><input type="checkbox" ' + (STATE.globalShowSwara ? 'checked' : '') + ' data-toggle="swara"> Show swara marks</label>' +
        '</div>' +
        '<div class="mantra-stack-host">' + renderMantraStack(a.mantras, { useSwara: STATE.globalShowSwara }) + '</div>' +
        renderRishiInfo(a) +
        '<div class="anuvaka-actions">' +
          '<button type="button" class="anuvaka-btn primary" data-action="play">Play from This Anuvaka</button>' +
          '<button type="button" class="anuvaka-btn ' + (completed ? 'uncomplete' : 'complete') + '" data-action="toggle">' +
            (completed ? 'Mark as Not Learned' : 'Mark as Learned') +
          '</button>' +
        '</div>' +
      '</div>';

    // Swara toggle handler
    const swaraToggle = card.querySelector('[data-toggle="swara"]');
    if (swaraToggle) {
      swaraToggle.addEventListener('click', function (e) { e.stopPropagation(); });
      swaraToggle.addEventListener('change', function (e) {
        STATE.globalShowSwara = !!e.target.checked;
        lsSet('sr_show_swara', STATE.globalShowSwara ? '1' : '0');
        const host = card.querySelector('.mantra-stack-host');
        if (host) host.innerHTML = renderMantraStack(a.mantras, { useSwara: STATE.globalShowSwara });
        // Sync other cards on the page
        document.querySelectorAll('[data-toggle="swara"]').forEach(function (el) {
          if (el !== swaraToggle) el.checked = STATE.globalShowSwara;
        });
        document.querySelectorAll('.anuvaka-card').forEach(function (otherCard) {
          if (otherCard === card) return;
          const otherId = otherCard.dataset.id;
          const parts = otherId.split('-');
          const otherAnuvaka = (parts[0] === 'namakam' ? NAMAKAM : CHAMAKAM).find(x => x.number === parseInt(parts[1], 10));
          const otherHost = otherCard.querySelector('.mantra-stack-host');
          if (otherAnuvaka && otherHost) {
            otherHost.innerHTML = renderMantraStack(otherAnuvaka.mantras, { useSwara: STATE.globalShowSwara });
          }
        });
      });
    }

    // Toggle expand on card click (but not on action buttons or toggles)
    card.addEventListener('click', function (e) {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        handleCardAction(actionBtn.dataset.action, a, card);
        return;
      }
      // Ignore clicks on labels/checkboxes for the swara toggle
      if (e.target.closest('.anuvaka-toggle') || e.target.closest('.anuvaka-body .rishi-info')) {
        return;
      }
      // Toggle expand
      if (STATE.expandedCardId && STATE.expandedCardId !== id) {
        const prev = document.querySelector('.anuvaka-card.expanded[data-id="' + STATE.expandedCardId + '"]');
        if (prev) prev.classList.remove('expanded');
      }
      const isExpanded = card.classList.contains('expanded');
      card.classList.toggle('expanded', !isExpanded);
      STATE.expandedCardId = isExpanded ? null : id;
    });

    return card;
  }

  function handleCardAction(action, a, card) {
    const id = idOf(a);
    if (action === 'play') {
      STATE.chantIdx = linearIndex(a);
      saveChantPos();
      window.location.hash = '#chant';
      // Wait for hash change + init then seek
      setTimeout(() => {
        seekToCurrent(true);
      }, 400);
    } else if (action === 'toggle') {
      toggleCompleted(id);
      // Update UI
      const completed = isCompleted(id);
      card.classList.toggle('completed', completed);
      const btn = card.querySelector('[data-action="toggle"]');
      if (btn) {
        btn.textContent = completed ? 'Mark as Not Learned' : 'Mark as Learned';
        btn.classList.toggle('complete', !completed);
        btn.classList.toggle('uncomplete', completed);
      }
      updateAnuvakaStats(a.section);
      // Update home stat if visible
      const statEl = document.getElementById('stat-completed');
      if (statEl) statEl.textContent = STATE.completed.size;
    }
  }

  // ---- Chant View ----
  function saveChantPos() { lsSet(KEYS.chantPos, String(STATE.chantIdx)); syncNotify(KEYS.chantPos); }
  function loadChantPos() {
    const raw = lsGet(KEYS.chantPos);
    const n = raw ? parseInt(raw, 10) : 0;
    STATE.chantIdx = (isNaN(n) || n < 0 || n > 21) ? 0 : n;
  }
  function saveChantShow() {
    lsSetJSON(KEYS.chantShow, {
      iast: STATE.chantShowIast,
      meaning: STATE.chantShowMeaning,
      swara: STATE.chantShowSwara,
      autoSync: STATE.chantAutoSync,
    });
  }
  function loadChantShow() {
    const saved = lsGetJSON(KEYS.chantShow, null);
    if (saved) {
      if (typeof saved.iast === 'boolean') STATE.chantShowIast = saved.iast;
      if (typeof saved.meaning === 'boolean') STATE.chantShowMeaning = saved.meaning;
      if (typeof saved.swara === 'boolean') STATE.chantShowSwara = saved.swara;
      if (typeof saved.autoSync === 'boolean') STATE.chantAutoSync = saved.autoSync;
    }
    // Global swara preference for list views
    const globalSwara = lsGet('sr_show_swara');
    if (globalSwara !== null) STATE.globalShowSwara = globalSwara === '1';
  }

  function initChant() {
    // Populate selector (only once)
    const sel = document.getElementById('chant-select');
    if (sel && sel.options.length === 0) {
      ALL_ANUVAKAS.forEach((a, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        const label = (a.section === 'namakam' ? 'Namakam' : 'Chamakam') + ' ' + a.number + ' - ' + a.theme;
        opt.textContent = label.length > 80 ? label.slice(0, 80) + '...' : label;
        sel.appendChild(opt);
      });
    }

    // Dots
    renderDots();

    // Settings toggles reflect state
    const iastChk = document.getElementById('chant-show-iast');
    const meanChk = document.getElementById('chant-show-meaning');
    const syncBtn = document.getElementById('chant-sync-toggle');
    if (iastChk) iastChk.checked = STATE.chantShowIast;
    if (meanChk) meanChk.checked = STATE.chantShowMeaning;
    if (syncBtn) {
      syncBtn.textContent = 'Auto-sync: ' + (STATE.chantAutoSync ? 'On' : 'Off');
      syncBtn.setAttribute('aria-pressed', STATE.chantAutoSync ? 'true' : 'false');
    }

    renderChant();
    startYtPolling();
  }

  function renderChant() {
    const idx = STATE.chantIdx;
    const a = anuvakaByLinearIndex(idx);
    const sectionLabel = a.section === 'namakam' ? 'Namakam' : 'Chamakam';

    document.getElementById('chant-anuvaka-info').textContent =
      sectionLabel + ' Anuvaka ' + a.number + ' - (' + (idx + 1) + ' of 22)';
    document.getElementById('chant-section-label').textContent =
      sectionLabel + ' - Anuvaka ' + a.number;
    document.getElementById('chant-theme').textContent = a.theme;

    const mantrasEl = document.getElementById('chant-mantras');
    if (mantrasEl) {
      mantrasEl.innerHTML = renderMantraStack(a.mantras, { useSwara: STATE.chantShowSwara });
      mantrasEl.classList.toggle('hide-iast', !STATE.chantShowIast);
      mantrasEl.classList.toggle('hide-meaning', !STATE.chantShowMeaning);
    }

    // Selector
    const sel = document.getElementById('chant-select');
    if (sel) sel.value = String(idx);

    // Prev/next disabled state
    document.getElementById('chant-prev').disabled = idx <= 0;
    document.getElementById('chant-next').disabled = idx >= 21;

    // Dots highlight
    const dots = document.querySelectorAll('.chant-dot');
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === idx);
    });
  }

  function renderDots() {
    const container = document.getElementById('chant-dots');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 22; i++) {
      const dot = document.createElement('div');
      dot.className = 'chant-dot' + (i === STATE.chantIdx ? ' active' : '');
      dot.dataset.idx = String(i);
      dot.title = (i < 11 ? 'Namakam ' : 'Chamakam ') + ((i % 11) + 1);
      container.appendChild(dot);
    }
  }

  function chantPrev() {
    if (STATE.chantIdx > 0) {
      STATE.chantIdx--;
      saveChantPos();
      renderChant();
    }
  }
  function chantNext() {
    if (STATE.chantIdx < 21) {
      STATE.chantIdx++;
      saveChantPos();
      renderChant();
    }
  }

  // Seek YouTube player to current anuvaka timestamp
  function seekToCurrent(autoplay) {
    const a = anuvakaByLinearIndex(STATE.chantIdx);
    if (!a) return;
    if (!STATE.ytPlayer || !STATE.ytReady) {
      // Fallback: reload iframe with start time
      reloadIframeAt(a.youtubeTime, autoplay);
      return;
    }
    try {
      STATE.ytPlayer.seekTo(a.youtubeTime, true);
      if (autoplay) STATE.ytPlayer.playVideo();
    } catch (e) {
      reloadIframeAt(a.youtubeTime, autoplay);
    }
  }

  function reloadIframeAt(seconds, autoplay) {
    const iframe = document.getElementById('chant-youtube');
    if (!iframe) return;
    const origin = encodeURIComponent(window.location.origin || 'https://shri-rudram.vercel.app');
    let src = 'https://www.youtube-nocookie.com/embed/' + YT_VIDEO_ID +
      '?enablejsapi=1&rel=0&origin=' + origin + '&start=' + Math.max(0, Math.floor(seconds));
    if (autoplay) src += '&autoplay=1';
    iframe.src = src;
  }

  // ---- YouTube IFrame API polling ----
  // We detect which anuvaka is currently playing based on currentTime.
  function currentAnuvakaIndexFromTime(t) {
    // Find the last anuvaka whose youtubeTime <= t
    let idx = 0;
    for (let i = 0; i < ALL_ANUVAKAS.length; i++) {
      if (ALL_ANUVAKAS[i].youtubeTime <= t + 0.5) idx = i;
      else break;
    }
    return idx;
  }

  function onYouTubeIframeAPIReady() {
    // Will be called when the iframe API loads
    if (!document.getElementById('chant-youtube')) return;
    try {
      STATE.ytPlayer = new YT.Player('chant-youtube', {
        events: {
          onReady: function () { STATE.ytReady = true; },
          onStateChange: function () { /* no-op */ },
        },
      });
    } catch (e) { /* ignore */ }
  }
  // Expose globally for YT API
  window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

  function startYtPolling() {
    stopYtPolling();
    STATE.ytPollTimer = setInterval(() => {
      if (!STATE.ytPlayer || !STATE.ytReady) return;
      let t = 0;
      try { t = STATE.ytPlayer.getCurrentTime(); } catch (e) { return; }
      STATE.ytCurrentTime = t;
      if (!STATE.chantAutoSync) return;
      const newIdx = currentAnuvakaIndexFromTime(t);
      if (newIdx !== STATE.chantIdx) {
        STATE.chantIdx = newIdx;
        saveChantPos();
        renderChant();
      }
    }, 1000);
  }
  function stopYtPolling() {
    if (STATE.ytPollTimer) {
      clearInterval(STATE.ytPollTimer);
      STATE.ytPollTimer = null;
    }
  }

  // ---- Fullscreen chant ----
  function toggleChantFullscreen() {
    STATE.chantFullscreen = !STATE.chantFullscreen;
    document.body.classList.toggle('chant-fullscreen', STATE.chantFullscreen);
    const btn = document.getElementById('chant-fullscreen');
    if (btn) btn.textContent = STATE.chantFullscreen ? 'Exit Full Screen' : 'Full Screen';
    if (STATE.chantFullscreen) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(function () {});
      }
    }
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && STATE.chantFullscreen) {
      STATE.chantFullscreen = false;
      document.body.classList.remove('chant-fullscreen');
      const btn = document.getElementById('chant-fullscreen');
      if (btn) btn.textContent = 'Full Screen';
    }
  });

  // ---- Export / Import ----
  function exportData() {
    const out = {};
    EXPORT_KEYS.forEach(key => {
      const val = lsGet(key);
      if (val !== null) {
        try { out[key] = JSON.parse(val); }
        catch (e) { out[key] = val; }
      }
    });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shri-rudram-backup-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        const hasValid = EXPORT_KEYS.some(k => k in data);
        if (!hasValid) { alert('Invalid backup file. No recognized data found.'); return; }
        if (!confirm('This will replace your current progress. Continue?')) return;
        EXPORT_KEYS.forEach(key => {
          if (key in data) {
            const v = data[key];
            if (typeof v === 'string') lsSet(key, v);
            else lsSet(key, JSON.stringify(v));
          }
        });
        window.location.reload();
      } catch (err) {
        alert('Failed to read backup file. Make sure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  // ---- Init / Event wiring ----
  function injectFontControls() {
    const host = document.getElementById('font-controls');
    if (!host) return;
    host.innerHTML = '<button class="font-btn" id="font-dec" aria-label="Decrease font size">A-</button><button class="font-btn" id="font-inc" aria-label="Increase font size">A+</button>';
    document.getElementById('font-dec').addEventListener('click', () => cycleFontSize(-1));
    document.getElementById('font-inc').addEventListener('click', () => cycleFontSize(1));
  }

  function initTheme() {
    applyTheme(getStoredTheme());
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', cycleTheme);
  }

  function wireEvents() {
    // Sadhana log
    const sadLog = document.getElementById('sadhana-log');
    if (sadLog) sadLog.addEventListener('click', logRecitation);

    // Chant controls
    const prev = document.getElementById('chant-prev');
    const next = document.getElementById('chant-next');
    const fullBtn = document.getElementById('chant-fullscreen');
    const sel = document.getElementById('chant-select');
    const jump = document.getElementById('chant-jump');
    const iastChk = document.getElementById('chant-show-iast');
    const meanChk = document.getElementById('chant-show-meaning');
    const syncBtn = document.getElementById('chant-sync-toggle');
    const dots = document.getElementById('chant-dots');
    const settingsToggle = document.getElementById('chant-settings-toggle');

    if (prev) prev.addEventListener('click', chantPrev);
    if (next) next.addEventListener('click', chantNext);
    if (fullBtn) fullBtn.addEventListener('click', toggleChantFullscreen);

    if (sel) sel.addEventListener('change', function (e) {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) {
        STATE.chantIdx = v;
        saveChantPos();
        renderChant();
      }
    });
    if (jump) jump.addEventListener('click', function () { seekToCurrent(true); });

    if (iastChk) iastChk.addEventListener('change', function (e) {
      STATE.chantShowIast = !!e.target.checked;
      saveChantShow();
      renderChant();
    });
    if (meanChk) meanChk.addEventListener('change', function (e) {
      STATE.chantShowMeaning = !!e.target.checked;
      saveChantShow();
      renderChant();
    });
    const swaraChk = document.getElementById('chant-show-swara');
    if (swaraChk) {
      swaraChk.checked = STATE.chantShowSwara;
      swaraChk.addEventListener('change', function (e) {
        STATE.chantShowSwara = !!e.target.checked;
        saveChantShow();
        renderChant();
      });
    }
    if (syncBtn) syncBtn.addEventListener('click', function () {
      STATE.chantAutoSync = !STATE.chantAutoSync;
      saveChantShow();
      syncBtn.textContent = 'Auto-sync: ' + (STATE.chantAutoSync ? 'On' : 'Off');
      syncBtn.setAttribute('aria-pressed', STATE.chantAutoSync ? 'true' : 'false');
    });

    if (dots) dots.addEventListener('click', function (e) {
      const dot = e.target.closest('.chant-dot');
      if (!dot) return;
      const idx = parseInt(dot.dataset.idx, 10);
      if (!isNaN(idx)) {
        STATE.chantIdx = idx;
        saveChantPos();
        renderChant();
      }
    });

    if (settingsToggle) settingsToggle.addEventListener('click', function () {
      // Collapse/expand the info panel by toggling the chant-current-info visibility via body class
      const info = document.querySelector('.chant-current-info');
      if (!info) return;
      info.hidden = !info.hidden;
    });

    // Export/Import
    const exp = document.getElementById('export-data');
    const imp = document.getElementById('import-data');
    if (exp) exp.addEventListener('click', exportData);
    if (imp) imp.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) {
        importData(file);
        e.target.value = '';
      }
    });

    // Keyboard shortcuts in chant view
    document.addEventListener('keydown', function (e) {
      if (STATE.currentView !== 'chant') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') { chantPrev(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { chantNext(); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') { toggleChantFullscreen(); e.preventDefault(); }
    });
  }


  // Progress arrived from another device - repaint in place, no reload.
  // Mirrors navigate()'s dispatch without its scroll / fullscreen effects.
  document.addEventListener('sync:remote-applied', () => {
    loadCompleted();
    if (STATE.currentView === 'home') renderHome();
    else if (STATE.currentView === 'namakam') renderAnuvakaList('namakam');
    else if (STATE.currentView === 'chamakam') renderAnuvakaList('chamakam');
    else if (STATE.currentView === 'sages') renderSagesView();
    // chant view: position is only read on entry, never yanked mid-chant
  });

  function init() {
    initTheme();
    injectFontControls();
    loadCompleted();
    loadChantPos();
    loadChantShow();
    applyFontSize(getFontSize());
    wireEvents();
    navigate(getHash());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

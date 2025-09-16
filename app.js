// Power Fire - HIIT Timer PWA (vanilla JS)

(function () {
  'use strict';

  // Elements
  const setupScreen = document.getElementById('setupScreen');
  const runScreen = document.getElementById('runScreen');

  const timeDisplay = document.getElementById('timeDisplay');
  const phaseLabel = document.getElementById('phaseLabel'); // opcional (pode não existir)
  const phaseLive = document.getElementById('phaseLive');
  const progressArc = document.getElementById('progressArc');

  const inpPrepareMin = document.getElementById('inpPrepareMin');
  const inpPrepareSec = document.getElementById('inpPrepareSec');
  const inpExerciseMin = document.getElementById('inpExerciseMin');
  const inpExerciseSec = document.getElementById('inpExerciseSec');
  const inpRestMin = document.getElementById('inpRestMin');
  const inpRestSec = document.getElementById('inpRestSec');
  const setsInput = document.getElementById('sets');

  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');

  const presetSelect = document.getElementById('presetSelect');
  const savePresetBtn = document.getElementById('savePresetBtn');
  const deletePresetBtn = document.getElementById('deletePresetBtn');
  const totalTimeEl = document.getElementById('totalTime'); // footer de setup
  const setsRemainingEl = document.getElementById('setsRemaining');
  const totalRemainingEl = document.getElementById('totalRemaining');
  const finishMsg = document.getElementById('finishMsg');

  // Constants (SVG ring)
  const RADIUS = 52;
  const CIRC = 2 * Math.PI * RADIUS; // ~326.7
  progressArc.style.strokeDasharray = CIRC.toString();
  progressArc.style.strokeDashoffset = CIRC.toString();

  // State
  let audioCtx = null;
  let swReg = null;
  let intervalId = null;

  let plan = [];
  let currentIndex = -1;
  let remaining = 0;
  let phaseTotal = 1;
  let running = false;
  let paused = false;
  let setsPlanned = 0;
  let setsRemaining = 0;
  let totalRemaining = 0; // em segundos para o circuito inteiro

  // Áudio de contagem regressiva por fase (MP3 externos)
  const SONS_DIR = './sons/';
  const cueFiles = {
    prepare: 'inicio.mp3',
    exercise: 'pausa para descanso.mp3',
    rest: 'Iniciar treino.mp3'
  };
  const cueMeta = {
    prepare: { audio: null, duration: 5, loaded: false },
    exercise: { audio: null, duration: 5, loaded: false },
    rest: { audio: null, duration: 5, loaded: false }
  };
  let audioUnlocked = false;
  let cueStartedThisPhase = false;
  let currentCueKey = null;
  let currentCue = null;
  // Áudio de conclusão do circuito
  let audioFinish = null;
  let finishPlayed = false;

  // Utils
  function parseTimeToSeconds(v) {
    // Accepts HH:MM or HH:MM:SS or MM:SS
    if (!v) return 0;
    const parts = v.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
    if (parts.length === 3) {
      const [hh, mm, ss] = parts;
      return (hh | 0) * 3600 + (mm | 0) * 60 + (ss | 0);
    }
    if (parts.length === 2) {
      const [mm, ss] = parts;
      return (mm | 0) * 60 + (ss | 0);
    }
    // Some browsers may return only HH:MM even when hours are 0
    return 0;
  }

  // Helpers MM+SS
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v || 0));
  const toSecs = (mm, ss) => (clamp(parseInt(mm, 10), 0, 999) * 60) + clamp(parseInt(ss, 10), 0, 59);
  const fromSecs = (total) => ({ mm: Math.floor((total || 0) / 60), ss: (total || 0) % 60 });

  function pad2(n) { return n.toString().padStart(2, '0'); }

  function fmtMMSS(s) {
    s = Math.max(0, s | 0);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${pad2(mm)}:${pad2(ss)}`;
  }

  function fmtHMMSS(s) {
    s = Math.max(0, s | 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
    return `${pad2(m)}:${pad2(sec)}`;
  }

  function clampInt(n, min, max) { return Math.max(min, Math.min(max, n | 0)); }

  // Audio (WebAudio API)
  function ensureAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
  }

  function beep(freq = 660, duration = 0.15, type = 'sine', gain = 0.05) {
    if (!audioCtx) return Promise.resolve();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.01);
    g.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration + 0.01);
    return new Promise((res) => osc.onended = res);
  }

  async function beepStartSoon() {
    // tom médio
    await beep(700, 0.12, 'sine', 0.06);
  }

  async function beepEndSoon() {
    // tom grave
    await beep(440, 0.12, 'sine', 0.06);
  }

  async function beepSequence(seq) {
    for (const b of seq) {
      await beep(b.freq, b.duration, b.type, b.gain);
      await new Promise(r => setTimeout(r, b.gap || 50));
    }
  }

  // Notifications
  async function ensureNotificationPermission() {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    try {
      const p = await Notification.requestPermission();
      return p;
    } catch {
      return 'denied';
    }
  }

  async function notify(title, body) {
    try {
      if (!swReg) swReg = (await navigator.serviceWorker.ready);
      if (Notification.permission === 'granted' && swReg?.showNotification) {
        await swReg.showNotification(title, {
          body,
          icon: './icons/icon.svg',
          badge: './icons/icon.svg',
          tag: 'power-fire',
          renotify: true
        });
      }
    } catch (e) {
      // no-op
    }
  }

  // Phase helpers
  const PHASE_LABEL = {
    prepare: 'Prepare',
    exercise: 'Exercício',
    rest: 'Descanso',
    done: 'Concluído'
  };

  function setPhaseLabel(type) {
    if (phaseLabel) {
      phaseLabel.className = 'phase';
      if (type === 'prepare') phaseLabel.classList.add('phase-prepare');
      if (type === 'exercise') phaseLabel.classList.add('phase-exercise');
      if (type === 'rest') phaseLabel.classList.add('phase-rest');
      phaseLabel.textContent = PHASE_LABEL[type] || type;
    }
    if (phaseLive) {
      phaseLive.className = 'phase-live';
      if (type === 'prepare') phaseLive.classList.add('prepare');
      if (type === 'exercise') phaseLive.classList.add('exercise');
      if (type === 'rest') phaseLive.classList.add('rest');
      phaseLive.textContent = PHASE_LABEL[type] || type;
    }
  }

  function applyRingColor(type) {
    if (!progressArc) return;
    progressArc.classList.remove('ring--prepare', 'ring--exercise', 'ring--rest');
    if (type === 'prepare') progressArc.classList.add('ring--prepare');
    if (type === 'exercise') progressArc.classList.add('ring--exercise');
    if (type === 'rest') progressArc.classList.add('ring--rest');
  }

  function buildPlan(settings) {
    const seq = [];
    const { prepare, exercise, rest, sets } = settings;
    if (prepare > 0) seq.push({ type: 'prepare', duration: prepare });
    for (let i = 1; i <= sets; i++) {
      if (exercise > 0) seq.push({ type: 'exercise', duration: exercise, set: i });
      // último descanso omitido
      if (i < sets && rest > 0) seq.push({ type: 'rest', duration: rest, set: i });
    }
    return seq;
  }

  function computeTotalTime(seq) {
    return seq.reduce((acc, p) => acc + (p.duration || 0), 0);
  }

  function updateTotalTimeFooter(seq) {
    totalTimeEl.textContent = 'Total: ' + fmtHMMSS(computeTotalTime(seq));
  }

  function updateRunTotalsUI() {
    if (setsRemainingEl) setsRemainingEl.textContent = String(Math.max(0, setsRemaining | 0));
    if (totalRemainingEl) totalRemainingEl.textContent = fmtHMMSS(totalRemaining);
  }

  // Ring progress
  function setProgress(elapsed, total) {
    const progress = Math.min(1, Math.max(0, elapsed / Math.max(1, total)));
    const offset = CIRC * (1 - progress);
    progressArc.style.strokeDashoffset = String(offset);
  }

  function resetRing() {
    progressArc.style.strokeDashoffset = String(CIRC);
  }

  // ======= Áudio: preload, threshold e sincronização =======
  function cueUrlFor(key) {
    // codifica apenas o nome do arquivo, mantendo o diretório legível
    return SONS_DIR + encodeURIComponent(cueFiles[key]);
  }

  function preloadCues() {
    for (const key of ['prepare', 'exercise', 'rest']) {
      try {
        const a = new Audio();
        a.preload = 'auto';
        a.src = cueUrlFor(key);
        a.addEventListener('loadedmetadata', () => {
          if (a.duration && isFinite(a.duration)) {
            cueMeta[key].duration = Math.max(0.1, a.duration);
            cueMeta[key].loaded = true;
          }
        });
        a.addEventListener('error', () => {
          // mantém fallback de 5s
          cueMeta[key].loaded = false;
        });
        cueMeta[key].audio = a;
      } catch {
        // mantém fallback
      }
    }
    // Preload do som de finalização
    try {
      audioFinish = new Audio();
      audioFinish.preload = 'auto';
      audioFinish.src = './sons/fim_series.mp3';
    } catch {}
  }

  function getCueDuration(type) {
    const m = cueMeta[type];
    if (!m) return 5;
    const d = m.duration;
    return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 5;
  }

  function getThresholdForPhase(type) {
    // threshold em segundos inteiros (ceil da duração), limitado ao total da fase
    const d = Math.ceil(getCueDuration(type));
    return Math.max(1, Math.min(phaseTotal | 0, d | 0));
  }

  function stopCurrentCue() {
    if (currentCue) {
      try { currentCue.onended = null; } catch {}
      try { currentCue.pause(); } catch {}
      try { currentCue.currentTime = 0; } catch {}
    }
    currentCue = null;
    currentCueKey = null;
  }

  function endCurrentPhaseNow() {
    if (!running) return;
    // debitar o restante desta fase do totalRemaining para manter sincronismo
    totalRemaining = Math.max(0, totalRemaining - remaining);
    // decremento de conjuntos se a fase atual era exercise
    const cur = plan[currentIndex];
    if (cur && cur.type === 'exercise') {
      setsRemaining = Math.max(0, (setsRemaining | 0) - 1);
      updateRunTotalsUI();
    }
    remaining = 0;
    stopCurrentCue();
    advancePhase();
  }

  function startCueForPhase(type, threshold) {
    if (!audioUnlocked) return; // respeita autoplay
    const meta = cueMeta[type];
    if (!meta || !meta.audio) return;
    const a = meta.audio;
    try { a.currentTime = 0; } catch {}
    currentCue = a;
    currentCueKey = type;
    cueStartedThisPhase = true;
    // ao terminar o áudio, terminar imediatamente a fase
    a.onended = () => {
      // evita sobreposição/loop
      stopCurrentCue();
      endCurrentPhaseNow();
    };
    a.play().then(() => {
      // opcional: notificar somente se threshold != 5 para evitar duplicidade
      if (threshold !== 5) {
        notify(`${PHASE_LABEL[type]} termina em ${threshold}s`, 'Contagem final de áudio.');
      }
    }).catch(() => {
      // se o play for bloqueado, não quebra o fluxo
    });
  }

  // Timer engine
  function startTick() {
    clearInterval(intervalId);
    intervalId = setInterval(onTick, 1000);
  }

  async function onTick() {
    if (!running || paused) return;
    remaining = Math.max(0, remaining - 1);
    totalRemaining = Math.max(0, totalRemaining - 1);
    timeDisplay.textContent = fmtMMSS(remaining);
    const elapsed = Math.max(0, phaseTotal - remaining);
    setProgress(elapsed, phaseTotal);
    updateRunTotalsUI();

    // Disparo do áudio sincronizado pelo threshold da fase
    const curPhase = plan[currentIndex];
    if (curPhase && !cueStartedThisPhase) {
      const threshold = getThresholdForPhase(curPhase.type);
      if (remaining === threshold) {
        startCueForPhase(curPhase.type, threshold);
      }
    }

    // avisos aos -5s
    if (remaining === 5) {
      // Próxima fase
      const next = plan[currentIndex + 1];
      if (next) {
        // tocar sequência de beeps de forma sequencial (médio -> grave)
        beepStartSoon().then(() => beepEndSoon());
        notify(`${PHASE_LABEL[next.type]} começa em 5s`, `Prepare-se para ${PHASE_LABEL[next.type].toLowerCase()}.`);
      } else {
        // apenas fim da fase atual no último bloco
        beepEndSoon();
      }
      const cur = plan[currentIndex];
      notify(`${PHASE_LABEL[cur.type]} termina em 5s`, `Últimos segundos do ${PHASE_LABEL[cur.type].toLowerCase()}.`);
    }

    if (remaining <= 0) {
      // decremento de conjuntos quando um exercício termina
      const cur = plan[currentIndex];
      if (cur && cur.type === 'exercise') {
        setsRemaining = Math.max(0, (setsRemaining | 0) - 1);
        updateRunTotalsUI();
      }
      stopCurrentCue(); // garante que nenhum áudio continue após virar
      // troca de fase
      advancePhase();
    }
  }

  function advancePhase() {
    currentIndex++;
    if (currentIndex >= plan.length) {
      // concluído
      running = false;
      paused = false;
      clearInterval(intervalId);
      timeDisplay.textContent = '00:00';
      setPhaseLabel('done');
      resetRing();
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      pauseBtn.textContent = 'PAUSAR';
      // finalizar UI da run screen
      setsRemaining = 0;
      totalRemaining = 0;
      updateRunTotalsUI();
      if (finishMsg) finishMsg.hidden = false;
      notify('Treino finalizado', 'Parabéns! Circuito concluído.');
      // tocar som de finalização (apenas uma vez)
      if (audioUnlocked && audioFinish && !finishPlayed) {
        try { audioFinish.currentTime = 0; } catch {}
        audioFinish.play().catch(() => {});
        finishPlayed = true;
      }
      // pequeno toque final
      ensureAudioContext();
      beepSequence([
        { freq: 880, duration: 0.1, gain: 0.07 },
        { freq: 660, duration: 0.1, gain: 0.07 },
        { freq: 990, duration: 0.12, gain: 0.07 },
      ]);
      return;
    }

    const cur = plan[currentIndex];
    remaining = cur.duration | 0;
    phaseTotal = Math.max(1, remaining);
    timeDisplay.textContent = fmtMMSS(remaining);
    setPhaseLabel(cur.type);
    applyRingColor(cur.type);
    resetRing();
    // pronto para novo disparo de áudio nesta fase
    cueStartedThisPhase = false;
    stopCurrentCue();
    // dispara notificação de troca
    notify(`Início: ${PHASE_LABEL[cur.type]}`, `Conjunto ${cur.set || '-'}/${setsPlanned}`);
  }

  function validateSettings(p, e, r, s) {
    return {
      prepare: Math.max(0, p | 0),
      exercise: Math.max(0, e | 0),
      rest: Math.max(0, r | 0),
      sets: clampInt(s, 1, 999)
    };
  }

  function readSettingsFromInputs() {
    normalizeTimePairs();
    const p = toSecs(inpPrepareMin.value, inpPrepareSec.value);
    const e = toSecs(inpExerciseMin.value, inpExerciseSec.value);
    const r = toSecs(inpRestMin.value, inpRestSec.value);
    const s = parseInt(setsInput.value || '1', 10);
    return validateSettings(p, e, r, s);
  }

  function persistLastSettings(settings) {
    try {
      localStorage.setItem('pf:last-settings', JSON.stringify(settings));
    } catch {}
  }

  function restoreLastSettings() {
    try {
      const raw = localStorage.getItem('pf:last-settings');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.prepare === 'number') {
        const { mm, ss } = fromSecs(s.prepare);
        inpPrepareMin.value = mm; inpPrepareSec.value = ss;
      }
      if (typeof s.exercise === 'number') {
        const { mm, ss } = fromSecs(s.exercise);
        inpExerciseMin.value = mm; inpExerciseSec.value = ss;
      }
      if (typeof s.rest === 'number') {
        const { mm, ss } = fromSecs(s.rest);
        inpRestMin.value = mm; inpRestSec.value = ss;
      }
      if (typeof s.sets === 'number') setsInput.value = s.sets;
      const seq = buildPlan(s);
      updateTotalTimeFooter(seq);
    } catch {}
  }

  // Presets
  function loadPresets() {
    try {
      const raw = localStorage.getItem('pf:presets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function savePresets(list) {
    try { localStorage.setItem('pf:presets', JSON.stringify(list)); } catch {}
  }

  function refreshPresetSelect() {
    const list = loadPresets();
    presetSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Selecione —';
    presetSelect.appendChild(placeholder);
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      presetSelect.appendChild(opt);
    }
  }

  function presetValueToSeconds(val) {
    if (typeof val === 'number') return Math.max(0, val | 0);
    if (typeof val === 'string') return parseTimeToSeconds(val);
    return 0;
  }

  function applyPresetByName(name) {
    const list = loadPresets();
    const p = list.find(x => x.name === name);
    if (!p) return;
    const pSec = presetValueToSeconds(p.prepare);
    const eSec = presetValueToSeconds(p.exercise);
    const rSec = presetValueToSeconds(p.rest);
    const { mm: pMm, ss: pSs } = fromSecs(pSec);
    const { mm: eMm, ss: eSs } = fromSecs(eSec);
    const { mm: rMm, ss: rSs } = fromSecs(rSec);
    inpPrepareMin.value = pMm; inpPrepareSec.value = pSs;
    inpExerciseMin.value = eMm; inpExerciseSec.value = eSs;
    inpRestMin.value = rMm; inpRestSec.value = rSs;
    setsInput.value = p.sets;
    const seq = buildPlan(readSettingsFromInputs());
    updateTotalTimeFooter(seq);
  }

  function handleSavePreset() {
    const name = prompt('Nome do preset:');
    if (!name) return;
    const list = loadPresets();
    const exists = list.findIndex(x => x.name === name);
    normalizeTimePairs();
    const preset = {
      name,
      prepare: toSecs(inpPrepareMin.value, inpPrepareSec.value),
      exercise: toSecs(inpExerciseMin.value, inpExerciseSec.value),
      rest: toSecs(inpRestMin.value, inpRestSec.value),
      sets: setsInput.value
    };
    if (exists >= 0) list[exists] = preset; else list.push(preset);
    savePresets(list);
    refreshPresetSelect();
    presetSelect.value = name;
  }

  function handleDeletePreset() {
    const name = presetSelect.value;
    if (!name) return;
    if (!confirm(`Excluir preset "${name}"?`)) return;
    const list = loadPresets();
    const next = list.filter(x => x.name !== name);
    savePresets(next);
    refreshPresetSelect();
    presetSelect.value = '';
  }

  // Controls
  async function handleStart() {
    ensureAudioContext(); // habilita sons após primeira interação
    await ensureNotificationPermission();
    audioUnlocked = true; // libera reprodução de áudio HTML5
    finishPlayed = false; // permite tocar no final deste circuito

    const settings = readSettingsFromInputs();
    persistLastSettings(settings);
    plan = buildPlan(settings);
    setsPlanned = settings.sets;
    setsRemaining = setsPlanned;
    updateTotalTimeFooter(plan);
    totalRemaining = computeTotalTime(plan);

    if (plan.length === 0) {
      alert('Nada para executar: verifique tempos e conjuntos.');
      return;
    }

    // reset e iniciar
    running = true;
    paused = false;
    currentIndex = -1;
    timeDisplay.textContent = '00:00';
    resetRing();
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    // estado visual do botão: rodando = amarelo
    pauseBtn.textContent = 'PAUSAR';
    pauseBtn.classList.add('btn', 'btn--yellow');
    pauseBtn.classList.remove('btn--green');

    // trocar para Run Screen
    if (finishMsg) finishMsg.hidden = true;
    if (setupScreen) setupScreen.hidden = true;
    if (runScreen) runScreen.hidden = false;
    updateRunTotalsUI(); // inicializa contadores visíveis

    advancePhase(); // vai para a primeira fase
    startTick();
  }

  function handlePauseResume() {
    if (!running) return;
    if (!paused) {
      paused = true;
      pauseBtn.textContent = 'RETOMAR';
      // pausado = verde
      pauseBtn.classList.remove('btn--yellow');
      pauseBtn.classList.add('btn--green');
      // pausar áudio atual se estiver tocando
      if (currentCue && !currentCue.paused) {
        try { currentCue.pause(); } catch {}
      }
    } else {
      paused = false;
      pauseBtn.textContent = 'PAUSAR';
      // rodando = amarelo
      pauseBtn.classList.add('btn--yellow');
      pauseBtn.classList.remove('btn--green');
      // retomar áudio atual se existir
      if (currentCue && audioUnlocked) {
        currentCue.play().catch(() => {});
      } else if (!cueStartedThisPhase) {
        // recalcular threshold no retorno
        const cur = plan[currentIndex];
        if (cur) {
          const threshold = getThresholdForPhase(cur.type);
          if (remaining === threshold) {
            startCueForPhase(cur.type, threshold);
          } else if (remaining < threshold) {
            // se já passamos do ponto, inicia imediatamente para não perder o aviso
            startCueForPhase(cur.type, threshold);
          }
        }
      }
    }
  }

  function handleReset() {
    if (!confirm('Deseja redefinir')) return;
    running = false;
    paused = false;
    clearInterval(intervalId);
    currentIndex = -1;
    remaining = 0;
    phaseTotal = 1;
    timeDisplay.textContent = '00:00';
    setPhaseLabel('prepare');
    applyRingColor('prepare');
    resetRing();
    stopCurrentCue();
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'PAUSAR';
    // limpar estados de cor no reset
    pauseBtn.classList.remove('btn--yellow', 'btn--green');
    // voltar à tela de setup
    if (runScreen) runScreen.hidden = true;
    if (setupScreen) setupScreen.hidden = false;
    if (finishMsg) finishMsg.hidden = true;
    setsRemaining = 0;
    totalRemaining = 0;
    updateRunTotalsUI();
  }

  // Events
  startBtn.addEventListener('click', handleStart);
  pauseBtn.addEventListener('click', handlePauseResume);
  resetBtn.addEventListener('click', handleReset);

  presetSelect.addEventListener('change', (e) => {
    if (presetSelect.value) applyPresetByName(presetSelect.value);
  });
  savePresetBtn.addEventListener('click', handleSavePreset);
  deletePresetBtn.addEventListener('click', handleDeletePreset);

  // Update total time footer when inputs change
  for (const el of [inpPrepareMin, inpPrepareSec, inpExerciseMin, inpExerciseSec, inpRestMin, inpRestSec, setsInput]) {
    el.addEventListener('change', () => {
      const seq = buildPlan(readSettingsFromInputs());
      updateTotalTimeFooter(seq);
    });
  }

  // Normalização de SS >= 60 para MM+carrego
  function normalizeTimePair(minEl, secEl) {
    let mm = clamp(parseInt(minEl.value, 10) || 0, 0, 999);
    let ss = clamp(parseInt(secEl.value, 10) || 0, 0, 5999); // suporta entradas maiores antes de normalizar
    if (ss >= 60) {
      mm = clamp(mm + Math.floor(ss / 60), 0, 999);
      ss = ss % 60;
    }
    minEl.value = mm;
    secEl.value = ss;
  }

  function normalizeTimePairs() {
    normalizeTimePair(inpPrepareMin, inpPrepareSec);
    normalizeTimePair(inpExerciseMin, inpExerciseSec);
    normalizeTimePair(inpRestMin, inpRestSec);
  }

  for (const secEl of [inpPrepareSec, inpExerciseSec, inpRestSec]) {
    secEl.addEventListener('blur', () => normalizeTimePairs());
  }

  // Service Worker registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./service-worker.js');
        swReg = reg;
      } catch (e) {
        // no-op
      }
    });
  }

  // Init
  function init() {
    refreshPresetSelect();
    restoreLastSettings();
    const seq = buildPlan(readSettingsFromInputs());
    updateTotalTimeFooter(seq);
    applyRingColor('prepare');
    preloadCues();
    // garantir cor do botão REDEFINIR
    if (resetBtn) resetBtn.classList.add('btn--red');
  }
  init();
})();

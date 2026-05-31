(function initRaveRelay(root) {
  "use strict";

  const LANES = [
    { id: "bass", label: "Bass", key: "q", color: "#ff5a5f", tone: 110 },
    { id: "beam", label: "Beam", key: "w", color: "#00a895", tone: 147 },
    { id: "spark", label: "Spark", key: "e", color: "#f6bf26", tone: 196 },
    { id: "echo", label: "Echo", key: "r", color: "#7257ff", tone: 247 }
  ];

  const ROUND_SIZE = 18;
  const WINDOW_MS = {
    perfect: 80,
    nice: 160,
    catch: 250
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function seedFromString(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function nextRandom() {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shanghaiDateString(now) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(now || new Date());
  }

  function buildSetlist(dateString, count) {
    const total = count || ROUND_SIZE;
    const random = mulberry32(seedFromString(`rave-relay:${dateString}`));
    const list = [];
    for (let index = 0; index < total; index += 1) {
      let laneIndex = Math.floor(random() * LANES.length);
      const last = list[list.length - 1];
      const prev = list[list.length - 2];
      if (last && prev && last.laneIndex === laneIndex && prev.laneIndex === laneIndex) {
        laneIndex = (laneIndex + 1 + Math.floor(random() * (LANES.length - 1))) % LANES.length;
      }
      const targetMs = 820 + Math.floor(random() * 340);
      const closeMs = targetMs + 470;
      list.push({
        id: `${dateString}-${index + 1}`,
        laneIndex,
        laneId: LANES[laneIndex].id,
        targetMs,
        closeMs,
        targetPercent: Math.round((targetMs / closeMs) * 100)
      });
    }
    return list;
  }

  function scoreTap(laneCorrect, offsetMs, combo) {
    if (!laneCorrect) {
      return {
        kind: "wrong lane",
        points: 0,
        hypeDelta: -10,
        nextCombo: 0,
        hit: false
      };
    }

    const absoluteOffset = Math.abs(offsetMs);
    let base = 0;
    let kind = "miss";
    let hypeDelta = -8;
    if (absoluteOffset <= WINDOW_MS.perfect) {
      kind = "perfect";
      base = 120;
      hypeDelta = 9;
    } else if (absoluteOffset <= WINDOW_MS.nice) {
      kind = "nice";
      base = 82;
      hypeDelta = 6;
    } else if (absoluteOffset <= WINDOW_MS.catch) {
      kind = "catch";
      base = 45;
      hypeDelta = 3;
    }

    if (base === 0) {
      return {
        kind,
        points: 0,
        hypeDelta,
        nextCombo: 0,
        hit: false
      };
    }

    const nextCombo = combo + 1;
    const comboBonus = nextCombo >= 3 ? Math.min(64, (nextCombo - 2) * 8) : 0;
    return {
      kind,
      points: base + comboBonus,
      hypeDelta,
      nextCombo,
      hit: true
    };
  }

  function gradeRun(stats) {
    const hitRate = stats.total > 0 ? stats.hits / stats.total : 0;
    if (stats.score >= 2300 && hitRate >= 0.94) return "S";
    if (stats.score >= 1850 && hitRate >= 0.82) return "A";
    if (stats.score >= 1350 && hitRate >= 0.68) return "B";
    if (stats.score >= 850 && hitRate >= 0.5) return "C";
    return "D";
  }

  function shareText(stats) {
    return `Rave Relay ${stats.date}: ${stats.score} pts, ${stats.hits}/${stats.total} hits, ${stats.bestCombo}x combo, grade ${stats.grade}.`;
  }

  const core = {
    LANES,
    ROUND_SIZE,
    WINDOW_MS,
    buildSetlist,
    clamp,
    gradeRun,
    scoreTap,
    seedFromString,
    shanghaiDateString,
    shareText
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
  }

  if (!root || !root.document) {
    return;
  }

  const document = root.document;
  const refs = {
    dayPill: document.getElementById("day-pill"),
    score: document.getElementById("score"),
    combo: document.getElementById("combo"),
    hits: document.getElementById("hits"),
    hypeFill: document.getElementById("hype-fill"),
    roundLabel: document.getElementById("round-label"),
    feedback: document.getElementById("feedback"),
    startButton: document.getElementById("start-button"),
    soundButton: document.getElementById("sound-button"),
    copyButton: document.getElementById("copy-button"),
    resultPanel: document.getElementById("result-panel"),
    grade: document.getElementById("grade"),
    resultCopy: document.getElementById("result-copy"),
    lanes: Array.from(document.querySelectorAll(".lane")),
    signals: Array.from(document.querySelectorAll(".signal"))
  };

  const state = {
    date: shanghaiDateString(new Date()),
    setlist: [],
    mode: "ready",
    index: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hits: 0,
    misses: 0,
    hype: 48,
    current: null,
    pulseStart: 0,
    pulseTarget: 0,
    pulseClose: 0,
    consumed: false,
    timer: null,
    frame: null,
    muted: true,
    audio: null,
    lastShare: ""
  };

  function renderStats() {
    refs.dayPill.textContent = state.date;
    refs.score.textContent = String(state.score);
    refs.combo.textContent = `${state.combo}x`;
    refs.hits.textContent = `${state.hits}/${ROUND_SIZE}`;
    refs.hypeFill.style.width = `${clamp(state.hype, 0, 100)}%`;
    refs.roundLabel.textContent = `Pulse ${Math.min(state.index + (state.current ? 1 : 0), ROUND_SIZE)} / ${ROUND_SIZE}`;
  }

  function markLane(laneIndex, className) {
    const lane = refs.lanes[laneIndex];
    if (!lane) return;
    lane.classList.add(className);
    root.setTimeout(() => lane.classList.remove(className), 170);
  }

  function clearPulseClasses() {
    refs.lanes.forEach((lane) => {
      lane.classList.remove("is-active", "in-window", "is-hit", "is-miss");
      lane.style.removeProperty("--target");
    });
    refs.signals.forEach((signal) => {
      signal.style.left = "0%";
    });
  }

  function ensureAudio() {
    if (state.muted || state.audio) return;
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) return;
    state.audio = new AudioContext();
  }

  function playTone(laneIndex, success) {
    if (state.muted) return;
    ensureAudio();
    if (!state.audio) return;
    const now = state.audio.currentTime;
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    oscillator.type = success ? "triangle" : "sawtooth";
    oscillator.frequency.value = success ? LANES[laneIndex].tone : 74;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(success ? 0.08 : 0.05, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(state.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  }

  function setFeedback(text) {
    refs.feedback.textContent = text;
  }

  function resetRound() {
    if (state.timer) root.clearTimeout(state.timer);
    if (state.frame) root.cancelAnimationFrame(state.frame);
    state.setlist = buildSetlist(state.date, ROUND_SIZE);
    state.mode = "playing";
    state.index = 0;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.hits = 0;
    state.misses = 0;
    state.hype = 48;
    state.current = null;
    state.consumed = false;
    state.lastShare = "";
    refs.resultPanel.hidden = true;
    refs.copyButton.disabled = true;
    refs.startButton.textContent = "Reset relay";
    clearPulseClasses();
    renderStats();
    setFeedback("First pulse");
  }

  function finishRound() {
    state.mode = "done";
    state.current = null;
    state.consumed = true;
    clearPulseClasses();
    const grade = gradeRun({
      score: state.score,
      hits: state.hits,
      total: ROUND_SIZE
    });
    const stats = {
      date: state.date,
      score: state.score,
      hits: state.hits,
      total: ROUND_SIZE,
      bestCombo: state.bestCombo,
      grade
    };
    const bestKey = "rave-relay-best-score";
    const previousBest = Number(root.localStorage.getItem(bestKey) || "0");
    if (state.score > previousBest) {
      root.localStorage.setItem(bestKey, String(state.score));
    }
    state.lastShare = shareText(stats);
    refs.grade.textContent = grade;
    refs.resultCopy.textContent =
      state.score > previousBest
        ? `${state.lastShare} New local best.`
        : `${state.lastShare} Local best: ${previousBest}.`;
    refs.resultPanel.hidden = false;
    refs.copyButton.disabled = false;
    refs.startButton.textContent = "Play again";
    setFeedback("Relay complete");
    renderStats();
  }

  function nextPulse() {
    if (state.index >= state.setlist.length) {
      finishRound();
      return;
    }

    clearPulseClasses();
    state.current = state.setlist[state.index];
    state.consumed = false;
    const now = root.performance.now();
    state.pulseStart = now + 120;
    state.pulseTarget = state.pulseStart + state.current.targetMs;
    state.pulseClose = state.pulseStart + state.current.closeMs;
    const lane = refs.lanes[state.current.laneIndex];
    lane.classList.add("is-active");
    lane.style.setProperty("--target", `${state.current.targetPercent}%`);
    setFeedback(LANES[state.current.laneIndex].label);
    renderStats();
    tick();
  }

  function missCurrent(reason) {
    if (!state.current || state.consumed) return;
    state.consumed = true;
    state.misses += 1;
    state.combo = 0;
    state.hype = clamp(state.hype - 8, 0, 100);
    markLane(state.current.laneIndex, "is-miss");
    playTone(state.current.laneIndex, false);
    setFeedback(reason);
    state.index += 1;
    renderStats();
    state.timer = root.setTimeout(nextPulse, 240);
  }

  function tick() {
    if (!state.current || state.mode !== "playing") return;
    const now = root.performance.now();
    const elapsed = Math.max(0, now - state.pulseStart);
    const progress = clamp((elapsed / state.current.closeMs) * 100, 0, 100);
    refs.signals[state.current.laneIndex].style.left = `${progress}%`;
    const offset = now - state.pulseTarget;
    refs.lanes[state.current.laneIndex].classList.toggle("in-window", Math.abs(offset) <= WINDOW_MS.catch);

    if (!state.consumed && now > state.pulseClose) {
      missCurrent("late miss");
      return;
    }
    state.frame = root.requestAnimationFrame(tick);
  }

  function handleLane(laneIndex) {
    if (state.mode !== "playing" || !state.current || state.consumed) return;
    const offset = root.performance.now() - state.pulseTarget;
    const result = scoreTap(laneIndex === state.current.laneIndex, offset, state.combo);
    state.consumed = true;
    state.score += result.points;
    state.hype = clamp(state.hype + result.hypeDelta, 0, 100);
    state.combo = result.nextCombo;
    state.bestCombo = Math.max(state.bestCombo, state.combo);

    if (result.hit) {
      state.hits += 1;
      markLane(laneIndex, "is-hit");
      playTone(laneIndex, true);
      setFeedback(`+${result.points} ${result.kind}`);
    } else {
      state.misses += 1;
      markLane(laneIndex, "is-miss");
      playTone(laneIndex, false);
      setFeedback(result.kind);
    }

    state.index += 1;
    renderStats();
    state.timer = root.setTimeout(nextPulse, 260);
  }

  async function copyScore() {
    if (!state.lastShare) return;
    const text = `${state.lastShare} ${root.location.href}`;
    try {
      await root.navigator.clipboard.writeText(text);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setFeedback("score copied");
  }

  refs.startButton.addEventListener("click", () => {
    resetRound();
    state.timer = root.setTimeout(nextPulse, 300);
  });

  refs.soundButton.addEventListener("click", () => {
    state.muted = !state.muted;
    refs.soundButton.textContent = state.muted ? "Sound off" : "Sound on";
    refs.soundButton.setAttribute("aria-pressed", String(!state.muted));
    ensureAudio();
  });

  refs.copyButton.addEventListener("click", copyScore);

  document.querySelectorAll("[data-lane-button]").forEach((button) => {
    button.addEventListener("click", () => handleLane(Number(button.dataset.laneButton)));
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const laneIndex = LANES.findIndex((lane) => lane.key === key);
    if (laneIndex >= 0) {
      event.preventDefault();
      handleLane(laneIndex);
    }
  });

  renderStats();
})(typeof window !== "undefined" ? window : undefined);

(function () {
  "use strict";
  const SAVE_KEY = "dvoe_local_v1";
  const SETTINGS_KEY = "dvoe_local_settings_v1";
  const API_DATA_KEY = "dvoe_local_api_data_v1";
  const bundledData = globalThis.DVOE_DATA;
  let data = bundledData;
  try {
    const cached = JSON.parse(localStorage.getItem(API_DATA_KEY) || "null");
    if (cached?.host?.scenes && cached?.pantheon?.scenes) data = cached;
  } catch { /* используем встроенную базу */ }
  let engine = new globalThis.DvoeEngine.Engine(data);

  const $ = (id) => document.getElementById(id);
  const home = $("home"), game = $("game"), overlay = $("overlay"), settings = $("settings");
  let timerHandle = null, installPrompt = null;

  const getSettings = () => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; }
  };
  const putSettings = (value) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  const hasSave = () => !!localStorage.getItem(SAVE_KEY);

  function save() {
    if (!engine.state) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify(engine.snapshot()));
    updateResume();
  }

  function updateResume() {
    $("resumeBtn").classList.toggle("hidden", !hasSave());
    if (!hasSave()) return;
    try {
      const state = JSON.parse(localStorage.getItem(SAVE_KEY));
      $("resumeTitle").textContent = state.type === "pantheon" ? "Вернуться в Пантеон" : "Продолжить с ведущим";
    } catch { $("resumeTitle").textContent = "Продолжить"; }
  }

  function updateCounts() {
    $("hostCount").textContent = data.counts.hostScenes;
    $("pantheonCount").textContent = data.counts.pantheonScenes;
    $("lineCount").textContent = data.counts.lines;
  }

  function showHome() {
    clearInterval(timerHandle);
    home.classList.remove("hidden");
    game.classList.add("hidden");
    updateResume();
  }

  function showOverlay(title, body, actions = []) {
    $("overlayTitle").textContent = title;
    $("overlayBody").textContent = body;
    const box = $("overlayActions");
    box.replaceChildren();
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.className = action.primary ? "primary" : "secondary";
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => { overlay.close(); action.run?.(); });
      box.append(button);
    });
    if (!overlay.open) overlay.showModal();
  }

  function render(view) {
    if (!view) return showHome();
    home.classList.add("hidden");
    game.classList.remove("hidden");
    $("modeLabel").textContent = view.type === "pantheon" ? "Пантеон" : (view.mode === "SERVICE" ? "Ведущий" : view.mode);
    $("sceneLabel").textContent = view.sceneId || view.screen || "";
    $("eyebrow").textContent = (view.eyebrow || (view.type === "pantheon" ? "ПАНТЕОН" : `${view.mechanic || "СЦЕНА"}`)).toUpperCase();
    $("sceneTitle").textContent = view.title || "ДВОЕ";
    $("sceneBody").textContent = view.body || "";
    $("sceneGlow").style.background = view.type === "pantheon" ? "rgba(181,139,67,.24)" : "rgba(135,31,72,.25)";
    renderMusic(view.music);
    renderActions(view.actions || []);
    startTimer(view);
    save();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderMusic(music) {
    const box = $("musicBox");
    if (!music) { box.classList.add("hidden"); box.replaceChildren(); return; }
    box.classList.remove("hidden");
    const text = document.createElement("span");
    text.textContent = `Музыка: ${music.examples?.slice(0, 2).join(", ") || music.query || music.id}`;
    box.replaceChildren(text);
    if (music.query) {
      const link = document.createElement("a");
      link.href = `https://music.yandex.ru/search?text=${encodeURIComponent(music.query)}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Открыть поиск";
      box.append(document.createElement("br"), link);
    }
  }

  function renderActions(actions) {
    const primary = $("primaryActions"), utility = $("utilityActions"), form = $("textForm"), input = $("textInput");
    primary.replaceChildren(); utility.replaceChildren(); form.classList.add("hidden");
    const inputAction = actions.find((action) => action.type === "text" || action.input);
    if (inputAction) {
      form.classList.remove("hidden");
      input.placeholder = inputAction.label || "Введите ответ";
      form.dataset.action = inputAction.type;
    }
    actions.filter((action) => action !== inputAction).forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.dataset.type = action.type;
      button.dataset.value = action.value ?? "";
      button.addEventListener("click", () => perform(action.type, action.value));
      (action.utility ? utility : primary).append(button);
    });
  }

  function perform(type, value) {
    try {
      const result = engine.action(type, value);
      if (result?.overlay) return showOverlay(result.title, result.body, [{ label: "Закрыть", primary: true }]);
      render(result);
    } catch (error) {
      showOverlay("Ошибка", error.message || String(error), [{ label: "Закрыть", primary: true }]);
    }
  }

  function startTimer(view) {
    clearInterval(timerHandle);
    const box = $("timer"), value = $("timerValue");
    if (!view.timerSec) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - view.shownAt) / 1000));
      const left = Math.max(0, view.timerSec - elapsed);
      value.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
      const event = engine.timedEvent(Date.now());
      if (event) {
        save();
        showOverlay(event.kind === "done" ? "Время" : "Сигнал", event.text, [{ label: "Продолжить", primary: true }]);
      }
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  function confirmRestart() {
    showOverlay("Начать заново?", "Текущий прогресс сохранён, пока вы не подтвердите перезапуск.", [
      { label: "Отмена" },
      { label: "Начать заново", primary: true, run: () => {
        const type = engine.state?.type;
        render(type === "pantheon" ? engine.startPantheon() : engine.startHost());
      } },
    ]);
  }

  $("startHostBtn").addEventListener("click", () => render(engine.startHost()));
  $("startPantheonBtn").addEventListener("click", () => render(engine.startPantheon()));
  $("resumeBtn").addEventListener("click", () => {
    try { render(engine.restore(localStorage.getItem(SAVE_KEY))); }
    catch { localStorage.removeItem(SAVE_KEY); showHome(); }
  });
  $("homeBtn").addEventListener("click", showHome);
  $("restartBtn").addEventListener("click", confirmRestart);
  $("saveBtn").addEventListener("click", save);
  $("closeOverlay").addEventListener("click", () => overlay.close());

  $("textForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = $("textInput").value.trim();
    const type = event.currentTarget.dataset.action || "text";
    if (!value) return;
    $("textInput").value = "";
    perform(type, value);
  });

  $("dayBtn").addEventListener("click", () => {
    if (!engine.state) engine.state = engine.newHostState();
    const task = engine.dayTask();
    showOverlay("Дневное задание", task?.t || "На сегодня заданий нет.", [{ label: "Закрыть", primary: true }]);
  });

  $("settingsBtn").addEventListener("click", () => {
    $("apiUrl").value = getSettings().apiUrl || "";
    $("apiStatus").textContent = "";
    settings.showModal();
  });
  settings.addEventListener("close", () => putSettings({ ...getSettings(), apiUrl: $("apiUrl").value.trim() }));
  $("testApiBtn").addEventListener("click", async () => {
    const url = $("apiUrl").value.trim().replace(/\/$/, "");
    if (!url) return $("apiStatus").textContent = "Сначала вставьте URL /exec.";
    $("apiStatus").textContent = "Проверяю…";
    try {
      const response = await fetch(`${url}?api=1&action=ping`, { redirect: "follow" });
      const json = await response.json();
      $("apiStatus").textContent = json.ok ? `API отвечает: ${json.version || "ok"}` : `Ошибка API: ${json.error || "неизвестно"}`;
    } catch (error) { $("apiStatus").textContent = `Не удалось подключиться: ${error.message}`; }
  });
  $("syncDbBtn").addEventListener("click", async () => {
    const url = $("apiUrl").value.trim().replace(/\/$/, "");
    if (!url) return $("apiStatus").textContent = "Сначала вставьте URL /exec.";
    $("apiStatus").textContent = "Загружаю обе базы…";
    try {
      const response = await fetch(`${url}?api=1&action=db`, { redirect: "follow" });
      const json = await response.json();
      if (!json.ok || !json.host?.scenes || !json.pantheon?.scenes) throw new Error(json.error || "API вернул неполную базу");
      const lines = Object.values(json.host.lines || {}).reduce((sum, group) => sum + group.length, 0);
      data = {
        version: json.version || "api",
        generatedAt: new Date().toISOString(),
        counts: {
          hostScenes: Object.keys(json.host.scenes).length,
          pantheonScenes: Object.keys(json.pantheon.scenes).length,
          lines,
          music: Object.keys(json.host.music || {}).length,
          day: (json.host.day || []).length,
        },
        host: json.host,
        pantheon: json.pantheon,
      };
      if (data.counts.hostScenes !== 310 || data.counts.pantheonScenes !== 50) {
        throw new Error(`Получено ${data.counts.hostScenes} + ${data.counts.pantheonScenes} сцен вместо 310 + 50`);
      }
      localStorage.setItem(API_DATA_KEY, JSON.stringify(data));
      const saved = engine.state ? engine.snapshot() : null;
      engine = new globalThis.DvoeEngine.Engine(data);
      if (saved) engine.restore(saved);
      updateCounts();
      putSettings({ ...getSettings(), apiUrl: url });
      $("apiStatus").textContent = "База обновлена: 310 сцен ведущего и 50 сцен Пантеона.";
    } catch (error) { $("apiStatus").textContent = `База не обновлена: ${error.message}`; }
  });

  $("clearBtn").addEventListener("click", () => {
    localStorage.removeItem(SAVE_KEY);
    settings.close();
    showHome();
  });
  $("exportBtn").addEventListener("click", () => {
    const payload = localStorage.getItem(SAVE_KEY) || "{}";
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "dvoe-save.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $("importInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      engine.restore(text);
      localStorage.setItem(SAVE_KEY, text);
      settings.close();
      render(engine.currentView());
    } catch (error) { $("apiStatus").textContent = `Файл не принят: ${error.message}`; }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); installPrompt = event; $("installBtn").classList.remove("hidden");
  });
  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").classList.add("hidden");
  });

  if (location.protocol.startsWith("http") && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  updateCounts();
  $("networkBadge").textContent = navigator.onLine ? "локально" : "без сети";
  window.addEventListener("online", () => $("networkBadge").textContent = "локально");
  window.addEventListener("offline", () => $("networkBadge").textContent = "без сети");
  updateResume();
})();

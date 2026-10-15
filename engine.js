(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DvoeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RECENT = 12;
  const CHECKIN_MIN = 30;
  const AMBIENT_CHANCE = 0.2;
  const BRIDGE_CHANCE = 0.3;
  const CHOICE_CHANCE = 0.4;
  const GATE = [["ok_flirt", "HUB_CHECK_FLIRT"], ["ok_intimate", "HUB_CHECK_INTIMATE"], ["ok_l5", "HUB_CHECK_L5"]];
  const ENTER = { ok_flirt: "enter_flirt", ok_intimate: "enter_intimate", ok_l5: "enter_l5" };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const choice = (array, random) => array && array.length ? array[Math.floor(random() * array.length)] : null;

  class Engine {
    constructor(data, options = {}) {
      if (!data?.host?.scenes || !data?.pantheon?.scenes) throw new Error("Некорректная база игры");
      this.data = data;
      this.random = options.random || Math.random;
      this.now = options.now || (() => Date.now());
      this.state = null;
    }

    newHostState() {
      return {
        type: "host", players: [{ name: "" }, { name: "" }], scene: "", seq: 0,
        flags: {}, brave: 0, hist: [], played: [], seenR: [], usedLines: [],
        lastGame: "", prev: "", lastSkipped: "", music: "", phase: "",
        votes: {}, texts: {}, checks: {}, done: {}, X: 0, n: 1, pick: {},
        lastAct: this.now(), nudged: false, checkinAt: this.now(), secretShown: false,
        dirAt: 0, matched: [], pending: "", pendingNext: "", pendingEv: "",
        shownAt: this.now(), timerDone: false, timerOverride: 0, nextTimerSec: 0,
        waitNote: false, evening: true, feed: [], view: null,
      };
    }

    startHost() {
      this.state = this.newHostState();
      return this.go("HUB_START");
    }

    startPantheon(names = ["Первый", "Второй"]) {
      this.state = {
        type: "pantheon", screen: "greet", active: true, tone: null, god: null,
        sceneId: null, sceneIndex: 0, list: [], names: { a: names[0] || "Первый", b: names[1] || "Второй" },
        startedAt: this.now(), feed: [], view: null,
      };
      return this.pantheonScreen("greet");
    }

    restore(raw) {
      const candidate = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
      if (!candidate || !["host", "pantheon"].includes(candidate.type)) throw new Error("Некорректное сохранение");
      this.state = candidate;
      return this.currentView();
    }

    snapshot() { return clone(this.state); }
    currentScene() { return this.state?.type === "host" ? this.data.host.scenes[this.state.scene] : this.data.pantheon.scenes[this.state?.sceneId]; }
    currentView() { return clone(this.state?.view || null); }

    name(index) { return this.state.players?.[index]?.name || (index ? "Второй" : "Первый"); }

    fill(text) {
      if (this.state.type === "pantheon") {
        return String(text || "")
          .replace(/\{A\}|\{X\}/g, this.state.names.a || "Первый")
          .replace(/\{B\}|\{Y\}/g, this.state.names.b || "Второй")
          .replace(/\{n\}/g, String(1 + Math.floor(this.random() * 6)));
      }
      const st = this.state;
      const x = st.X, y = 1 - st.X, feminine = !!st.flags.voice_f;
      return String(text || "")
        .replace(/\[([^\[\]|]*)\|([^\[\]|]*)\]/g, (_, masculine, female) => feminine ? female : masculine)
        .replace(/\{A\}/g, this.name(0)).replace(/\{B\}/g, this.name(1))
        .replace(/\{X\}/g, this.name(x)).replace(/\{Y\}/g, this.name(y))
        .replace(/\{n\}/g, String(st.n))
        .replace(/\{style\}/g, st.pick.style_list || "")
        .replace(/\{word\}/g, st.pick.word_list || "");
    }

    line(event, level, vars) {
      let pool = this.data.host.lines[event] || [];
      let candidates = pool.filter((item) => level >= item.a && level <= item.b);
      if (!candidates.length) candidates = pool.slice();
      if (!candidates.length) return "";
      const fresh = candidates.filter((item) => !this.state.usedLines.includes(item.id));
      if (fresh.length) candidates = fresh;
      const total = candidates.reduce((sum, item) => sum + item.w, 0);
      let cursor = this.random() * total;
      let picked = candidates[0];
      for (const item of candidates) {
        cursor -= item.w;
        if (cursor <= 0) { picked = item; break; }
      }
      this.state.usedLines.push(picked.id);
      this.state.usedLines = this.state.usedLines.slice(-30);
      let text = picked.t;
      if (vars) for (const [key, value] of Object.entries(vars)) text = text.split(`{${key}}`).join(value);
      return this.fill(text);
    }

    resolve(target, current, depth = 0) {
      const st = this.state, db = this.data.host;
      if (!target || depth > 8) return "HUB_MODE_SELECT";
      if (target.startsWith("RANDOM:")) return this.resolve(choice(target.slice(7).split("|"), this.random), current, depth + 1);
      const last = db.scenes[st.lastGame];
      if (target === "RETURN:PREV") return last ? this.resolve(`POOL:${last.mode}_L${last.lvl}`, current, depth + 1) : "HUB_VIBE";
      if (target === "RETURN:SCENE") {
        const previous = db.scenes[st.prev];
        return previous && previous.mode !== "SERVICE" ? previous.id : (last ? last.id : "HUB_VIBE");
      }
      if (target === "RETURN:PENDING") return st.pending && db.scenes[st.pending]
        ? this.resolve(st.pending, current, depth + 1) : this.resolve("RETURN:PREV", current, depth + 1);
      if (target === "RETURN:SKIPPED") return st.lastSkipped && db.scenes[st.lastSkipped]
        ? st.lastSkipped : this.resolve("RETURN:PREV", current, depth + 1);
      if (target === "UP:LAST") return this.resolve(last ? last.up : "HUB_MODE_SELECT", current, depth + 1);
      if (target === "DOWN:LAST") return this.resolve(last ? last.down : "HUB_MODE_SELECT", current, depth + 1);
      if (target === "DAY:MENU") return "HUB_MODE_SELECT";
      if (target.startsWith("POOL:")) {
        const key = target.slice(5);
        let id = this.pickFromPool(key, current);
        if (id) return id;
        const [mode, rawLevel] = key.split("_L");
        for (let level = Number(rawLevel) - 1; level >= 0; level--) {
          id = this.pickFromPool(`${mode}_L${level}`, current);
          if (id) return id;
        }
        return "HUB_MODE_SELECT";
      }
      const scene = db.scenes[target];
      if (!scene) return "HUB_MODE_SELECT";
      const missing = scene.cond.filter((flag) => !st.flags[flag]);
      if (missing.length) {
        for (const [flag, gate] of GATE) if (missing.includes(flag) && gate !== target) return this.resolve(gate, current, depth + 1);
        return scene.mode === "SERVICE" ? "HUB_MODE_SELECT" : this.resolve(`POOL:${scene.mode}_L${scene.lvl}`, current, depth + 1);
      }
      return target;
    }

    pickFromPool(key, current) {
      const db = this.data.host, st = this.state, ids = db.pools[key] || [];
      const recent = st.hist.slice(-RECENT), notAfter = current?.notAfter || [];
      const okay = (id, relaxation) => {
        const scene = db.scenes[id];
        if (scene.cond.some((flag) => !st.flags[flag])) return false;
        if (current && id === current.id) return false;
        if (relaxation < 2 && !scene.repeat && st.played.includes(id)) return false;
        if (relaxation < 1 && (recent.includes(id) || notAfter.includes(id))) return false;
        return true;
      };
      for (let relaxation = 0; relaxation < 3; relaxation++) {
        const candidates = ids.filter((id) => okay(id, relaxation));
        if (candidates.length) return choice(candidates, this.random);
      }
      return null;
    }

    sceneTimer(scene) {
      return this.state.scene === scene.id && Number(this.state.timerOverride) > 0
        ? Number(this.state.timerOverride) : Number(scene.timer) || 0;
    }

    applyFlag(scene, label) {
      const flag = scene.setsOn[label];
      if (!flag) return "";
      this.state.flags[flag] = true;
      if (flag === "brave") { this.state.brave += 1; return "brave"; }
      return "";
    }

    go(target, event = "", extra = "") {
      const db = this.data.host, st = this.state;
      let current = db.scenes[st.scene];
      const levelBefore = current ? current.lvl : 0;
      let id = this.resolve(target, current, 0);
      let scene = db.scenes[id];
      let guard = 0;
      while (scene?.skipIf && st.flags[scene.skipIf] && guard++ < 5) {
        id = this.resolve(scene.options[0]?.next, scene, 0);
        scene = db.scenes[id];
      }
      if (!scene) throw new Error(`Не удалось открыть сцену: ${target}`);

      if (id === "INT_094" && st.nextTimerSec) st.timerOverride = Number(st.nextTimerSec) || 0;
      else if (scene.mode !== "SERVICE" && id !== "INT_094") st.timerOverride = 0;
      st.nextTimerSec = 0;

      const flow = /^(POOL:|RANDOM:POOL|RETURN:PREV|UP:|DOWN:)/.test(String(target || ""));
      if (scene.mode !== "SERVICE" && flow && scene.lvl <= 3 && scene.mech !== "SILENCE") {
        if (st.brave >= 3 && !st.secretShown) {
          st.secretShown = true; st.pending = id; id = "HUB_SECRET"; scene = db.scenes[id];
        } else if (this.now() - st.checkinAt > CHECKIN_MIN * 60000) {
          st.checkinAt = this.now(); st.pending = id; id = "HUB_CHECKIN"; scene = db.scenes[id];
        }
      }

      if (id === "HUB_NAMES" && st.players[0].name && st.players[1].name) {
        return this.go(scene.options[0]?.next || scene.cont, "names", event ? this.line(event, 0) : "");
      }

      const previousGame = db.scenes[st.lastGame];
      const head = [];
      if (extra) head.push(extra);
      if (event) {
        const reaction = this.line(event, ["enter_intimate", "enter_l5"].includes(event) ? 4 : levelBefore);
        if (reaction) head.push(reaction);
      }

      if (st.scene && st.scene !== id) st.prev = st.scene;
      st.scene = id; st.seq += 1; st.phase = ""; st.votes = {}; st.texts = {}; st.checks = {}; st.done = {};
      st.nudged = false; st.lastAct = this.now(); st.shownAt = this.now(); st.dirAt = st.shownAt;
      st.timerDone = false; st.waitNote = false; st.pendingNext = ""; st.pendingEv = "";
      st.hist.push(id); st.hist = st.hist.slice(-RECENT * 2);
      const seenBefore = scene.repeat ? st.seenR.includes(id) : false;
      if (scene.repeat && !seenBefore) st.seenR.push(id);
      if (!scene.repeat && !st.played.includes(id)) st.played.push(id);
      if (!scene.secret && !scene.input.startsWith("checklist")) scene.sets.forEach((flag) => { st.flags[flag] = true; });
      st.X = this.random() < 0.5 ? 0 : 1;
      st.n = 1 + Math.floor(this.random() * 6);
      st.pick = {};
      for (const [key, values] of Object.entries(scene.lists || {})) if (values?.length) st.pick[key] = choice(values, this.random);

      if (scene.mode !== "SERVICE") {
        if (scene.mode === "AFTER" && previousGame?.mode === "INTIMATE") head.push(this.line("aftercare", 0));
        else if (previousGame && previousGame.mode !== scene.mode && !event) head.push(this.line("mode", scene.lvl));
        else if (this.random() < AMBIENT_CHANCE) head.push(this.line("ambient", scene.lvl));
        else if (this.random() < BRIDGE_CHANCE) head.push(this.line("bridge", scene.lvl));
        st.lastGame = id;
      }

      const sourceBody = seenBefore && scene.alts.length ? choice(scene.alts, this.random) : (scene.msg || choice(scene.alts, this.random));
      let body = head.filter(Boolean).join("\n\n");
      body = `${body ? `${body}\n\n` : ""}${this.fill(sourceBody)}`;
      if (id === "INT_107" && st.matched.length) body += `\n\n👉 Начните с: ${choice(st.matched, this.random)}`;
      const timerSec = this.sceneTimer(scene);
      if (timerSec) body += `\n\n${this.line("timer", scene.lvl, { t: timerSec >= 120 ? `${Math.round(timerSec / 60)} мин` : `${timerSec} сек` })}`;
      if (scene.music && scene.music !== "keep" && scene.music !== st.music) st.music = scene.music;
      if (scene.cue) body += `\n🎚 ${scene.cue}`;

      if (scene.input.startsWith("checklist")) st.phase = "check";
      else if ((scene.input.startsWith("text") && scene.input !== "text:names") || scene.input === "text:names") st.phase = "text";
      else if (scene.consent === "both" && scene.mode !== "SERVICE" && !scene.secret && scene.voteRule !== "min") st.phase = "consent";
      else st.phase = scene.secret || scene.voteRule === "min" || (scene.mode === "SERVICE" && scene.consent === "both") ? "vote" : "options";

      st.view = this.hostView(scene, body);
      return this.currentView();
    }

    hostView(scene, body) {
      const st = this.state;
      const actions = [];
      if (st.phase === "consent") {
        actions.push({ type: "consent", value: "y", label: "Да" }, { type: "consent", value: "n", label: "Пас" });
        body += `\n\n${this.line("single_prompt", scene.lvl)}`;
      } else if (st.phase === "check") {
        const items = (scene.hidden.split(":")[1] || "").split("·").map((item) => item.trim()).filter(Boolean);
        items.forEach((item, index) => actions.push({ type: "check", value: index, label: item }));
        actions.push({ type: "check", value: "done", label: "Я отметил(а)" });
        body += "\n\nОтметьте подходящие варианты, затем нажмите «Я отметил(а)».";
      } else if (st.phase === "text") {
        actions.push({ type: "text", label: scene.input === "text:names" ? "Введите два имени через запятую" : "Введите ответ" });
        actions.push({ type: "continue", label: "Продолжить без ответа" });
      } else if (st.phase === "doing") {
        actions.push({ type: "continue", label: "Продолжить" });
      } else {
        scene.options.forEach((option, index) => actions.push({ type: "option", value: index, label: this.fill(option.label) }));
        if (scene.secret && scene.options.length === 1) actions.push({ type: "option", value: -1, label: "Нет" });
      }
      if (scene.hidden && !scene.input.startsWith("checklist")) actions.unshift({ type: "secret", label: "Показать секрет" });
      if (scene.mode !== "SERVICE") {
        actions.push({ type: "skip", label: "Пропуск", utility: true });
        actions.push({ type: "down", label: "Легче", utility: true });
        actions.push({ type: "up", label: "Смелее", utility: true });
        actions.push({ type: "mode", label: "Режим", utility: true });
        actions.push({ type: "pause", label: "Стоп", utility: true });
        actions.push({ type: "joke", label: "Шутка", utility: true });
      }
      const music = st.music && st.music !== "SILENCE_00" ? this.data.host.music[st.music] : null;
      return {
        type: "host", sceneId: scene.id, mode: scene.mode, level: scene.lvl, mechanic: scene.mech,
        title: scene.mode === "SERVICE" ? "Ведущий" : `${scene.mode} · уровень ${scene.lvl}`,
        body, phase: st.phase, actions, timerSec: this.sceneTimer(scene), shownAt: st.shownAt,
        music: music ? { id: st.music, query: music.q, examples: music.ex } : null,
        sequence: st.seq,
      };
    }

    action(type, value) {
      if (!this.state) throw new Error("Игра не запущена");
      if (this.state.type === "pantheon") return this.pantheonAction(type, value);
      const st = this.state, scene = this.currentScene();
      st.lastAct = this.now();
      if (!scene) return this.go("HUB_MODE_SELECT");
      if (type === "secret") return { overlay: true, title: "Секрет", body: this.secretText(scene) };
      if (type === "consent") return this.consent(value);
      if (type === "option") return this.option(Number(value));
      if (type === "continue") return this.continue();
      if (type === "text") return this.text(String(value || ""));
      if (type === "check") return this.check(value);
      if (["skip", "down", "up", "mode", "pause", "joke"].includes(type)) return this.universal(type);
      throw new Error(`Неизвестное действие: ${type}`);
    }

    consent(answer) {
      const st = this.state, scene = this.currentScene();
      if (st.phase !== "consent") return this.currentView();
      if (answer === "y") {
        st.phase = "options"; st.shownAt = this.now(); st.dirAt = st.shownAt;
        st.timerDone = false; st.nudged = false; st.waitNote = false;
        const body = `${this.line("both_yes", scene.lvl) || "Согласие получено."}\n\n${st.view.body}`;
        st.view = this.hostView(scene, body);
        return this.currentView();
      }
      return this.go(scene.refuse || scene.split || scene.cont || "HUB_MODE_SELECT", "both_no");
    }

    option(index) {
      const st = this.state, scene = this.currentScene();
      if (st.phase === "consent") return this.currentView();
      let pickedIndex = index;
      if (st.phase === "vote") {
        if (pickedIndex < 0) {
          if (scene.options.length === 1 && scene.secret) return this.go(scene.refuse || scene.split || "HUB_MODE_SELECT", "both_no");
          pickedIndex = 0;
        }
        if (scene.id === "INT_103") st.nextTimerSec = [600, 1200, 2400][pickedIndex] || 600;
      }
      const option = scene.options[pickedIndex];
      if (!option) return this.currentView();
      let event = this.applyFlag(scene, option.label);
      if (scene.id === "HUB_HOST") event = "host_chosen";
      else if (scene.id === "HUB_PAUSE" && option.next === "RETURN:SCENE") event = "resume";
      else if (option.label.includes("😂")) event = "joke";
      else if (!event && scene.mode !== "SERVICE" && this.random() < CHOICE_CHANCE) event = "choice";
      if (scene.waitOpts.includes(pickedIndex + 1)) {
        st.phase = "doing"; st.pendingNext = option.next; st.pendingEv = event || "";
        st.shownAt = this.now(); st.dirAt = st.shownAt; st.timerDone = false; st.nudged = false;
        st.view = this.hostView(scene, this.line("doing", scene.lvl, { c: this.fill(option.label) }));
        return this.currentView();
      }
      return this.go(option.next, event || (scene.mode === "SERVICE" ? "" : "choice"));
    }

    continue() {
      const st = this.state, scene = this.currentScene();
      if (st.phase === "doing") return this.go(st.pendingNext || scene.cont, st.pendingEv || (this.random() < 0.6 ? "continue" : ""));
      if (st.phase === "text") {
        st.phase = "options";
        st.view = this.hostView(scene, this.line("text_skip", scene.lvl));
        return this.currentView();
      }
      if (scene.options.length === 1) return this.go(scene.options[0].next);
      return this.currentView();
    }

    text(value) {
      const scene = this.currentScene();
      if (this.state.phase !== "text") return this.currentView();
      if (scene.input === "text:names") {
        const names = value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
        this.state.players[0].name = names[0] || "Первый";
        this.state.players[1].name = names[1] || "Второй";
        return this.go(scene.options[0]?.next || scene.cont, "names");
      }
      this.state.texts["0"] = value.slice(0, 300);
      this.state.phase = "options";
      this.state.view = this.hostView(scene, `${this.line("choice", scene.lvl) || "Ответ принят."}\n\n${value}`);
      return this.currentView();
    }

    check(value) {
      const st = this.state, scene = this.currentScene();
      const items = (scene.hidden.split(":")[1] || "").split("·").map((item) => item.trim()).filter(Boolean);
      st.checks["0"] ||= [];
      if (value !== "done") {
        const item = items[Number(value)];
        if (item) {
          const at = st.checks["0"].indexOf(item);
          if (at < 0) st.checks["0"].push(item); else st.checks["0"].splice(at, 1);
        }
        return this.currentView();
      }
      st.matched = st.checks["0"].slice();
      if (st.matched.length) {
        st.flags.wishes_matched = true;
        return this.go(scene.options[0]?.next, "", `Совпало: ${st.matched.join(", ")}`);
      }
      return this.go((scene.options[1] || scene.options[0])?.next, "", "Совпадений нет. Ничего страшного — значит, начнём с другого.");
    }

    universal(type) {
      const st = this.state, scene = this.currentScene();
      if (type === "skip") { st.flags.had_skip = true; st.lastSkipped = scene.id; return this.go(scene.cont || scene.options[0]?.next, "skip"); }
      if (type === "down") return this.go(scene.down || "HUB_MODE_SELECT", "down");
      if (type === "up") return this.go(scene.up || "HUB_MODE_SELECT", "up");
      if (type === "mode") return this.go(scene.modeChange || "HUB_MODE_SELECT", "mode");
      if (type === "pause") return this.go("HUB_PAUSE", "pause");
      if (type === "joke") {
        const joke = this.line("joke", scene.lvl);
        return { overlay: true, title: "Лис", body: joke || "Продолжаем." };
      }
      return this.currentView();
    }

    secretText(scene) {
      const matches = [...String(scene.hidden || "").matchAll(/\{(X|Y)\}:\s*([^{]+)/g)];
      if (!matches.length) return this.fill(scene.hidden || "Секрет не задан.");
      return matches.map((match) => `${match[1]}: ${this.fill(match[2].trim())}`).join("\n\n");
    }

    timedEvent(now = this.now()) {
      if (this.state?.type !== "host") return null;
      const st = this.state, scene = this.currentScene();
      if (!scene || !["options", "doing"].includes(st.phase)) return null;
      const timer = this.sceneTimer(scene);
      if (!timer) return null;
      const elapsed = (now - st.shownAt) / 1000;
      const words = scene.lists.director_words || scene.lists.tick_words || scene.lists.checkin_words;
      if (words?.length && elapsed < timer) {
        const fallback = scene.mech === "DIRECTOR" ? Math.max(60, Math.min(180, timer / 4)) : 600;
        const every = Math.max(30, Number(scene.lists.interval_sec) || fallback) * 1000;
        if (now - (st.dirAt || st.shownAt) >= every) {
          st.dirAt = now;
          return { kind: "cue", text: `${scene.lists.director_words ? "Режиссёр: " : ""}${choice(words, this.random)}` };
        }
      }
      if (timer >= 60 && !st.timerDone && elapsed >= timer) {
        st.timerDone = true;
        return { kind: "done", text: this.line("timer_done", scene.lvl) || "Время завершилось." };
      }
      return null;
    }

    dayTask() {
      const hour = new Date(this.now()).getHours();
      const pool = this.data.host.day.filter((task) => hour >= task.h1 && hour < task.h2 && (!task.cond || this.state?.flags?.[task.cond]));
      return choice(pool.length ? pool : this.data.host.day, this.random);
    }

    pantheonScreen(screen) {
      const st = this.state;
      st.screen = screen;
      const screens = {
        greet: { title: "Аудиенция", body: "Вы здесь. Значит, отбор прошли. Не спрашиваю как.", actions: [{ type: "p_accept", label: "Принять" }, { type: "p_wait", label: "Не готов" }] },
        intro: { title: "Эро", body: "Меня звали тем, кто был прежде всех. Тем, кто вынес свет из тьмы. Тем, кто держит ключи от всего запертого. Главное — я здесь.", actions: [{ type: "p_rule", label: "Дальше" }] },
        rule: { title: "Правило", body: "Слово «стоп» — закон. Всё остальное — игра.", actions: [{ type: "p_names", label: "Принимаю" }] },
        names: { title: "Имена", body: "Как вас звать? Введите два имени через запятую.", actions: [{ type: "p_names_submit", label: "Продолжить", input: true }] },
        tone: { title: "Выберите путь", body: "Все пять веток Пантеона доступны.", actions: [
          { type: "p_tone", value: "FUN", label: "Игра" }, { type: "p_tone", value: "FLIRT", label: "Флирт" },
          { type: "p_tone", value: "INTIMATE", label: "Близость" }, { type: "p_tone", value: "RELAX", label: "Тишина" },
          { type: "p_tone", value: "AFTER", label: "После" },
        ] },
        ritual: { title: "Первое", body: "Три минуты. Смотрите. Молчите. Не касайтесь. Я вернусь.", actions: [{ type: "p_begin", label: "Мы готовы" }] },
        waiting: { title: "Аудиенция отложена", body: "Хорошо. Я подожду.", actions: [{ type: "p_restart", label: "Вернуться" }] },
        done: { title: "Конец аудиенции", body: "Останьтесь. Сколько хотите. Меня больше нет.", actions: [{ type: "p_restart", label: "Новая аудиенция" }] },
      };
      st.view = { type: "pantheon", screen, ...(screens[screen] || screens.greet) };
      return this.currentView();
    }

    pantheonAction(type, value) {
      const st = this.state;
      if (type === "p_accept") return this.pantheonScreen("intro");
      if (type === "p_wait") { st.active = false; return this.pantheonScreen("waiting"); }
      if (type === "p_rule") return this.pantheonScreen("rule");
      if (type === "p_names") return this.pantheonScreen("names");
      if (type === "p_names_submit") {
        const names = String(value || "").split(/[,;]/).map((item) => item.trim()).filter(Boolean);
        st.names = { a: names[0] || "Первый", b: names[1] || "Второй" };
        return this.pantheonScreen("tone");
      }
      if (type === "p_tone") { st.tone = String(value || "INTIMATE").toUpperCase(); return this.pantheonScreen("ritual"); }
      if (type === "p_begin") return this.pantheonFirst(st.tone);
      if (type === "p_next") return this.pantheonNext();
      if (type === "p_restart") return this.startPantheon([st.names.a, st.names.b]);
      return this.currentView();
    }

    pantheonFirst(mode) {
      const st = this.state;
      st.list = Object.keys(this.data.pantheon.scenes)
        .filter((id) => this.data.pantheon.scenes[id].mode.toUpperCase() === mode.toUpperCase())
        .sort();
      st.sceneIndex = 0;
      st.sceneId = st.list[0] || null;
      if (!st.sceneId) return this.pantheonScreen("done");
      return this.pantheonRender();
    }

    pantheonNext() {
      const st = this.state, old = this.data.pantheon.scenes[st.sceneId];
      const requested = String(old?.next || "").trim();
      if (requested && this.data.pantheon.scenes[requested] && st.list.includes(requested)) {
        st.sceneId = requested; st.sceneIndex = st.list.indexOf(requested);
      } else {
        st.sceneIndex += 1;
        if (st.sceneIndex >= st.list.length) return this.pantheonScreen("done");
        st.sceneId = st.list[st.sceneIndex];
      }
      return this.pantheonRender();
    }

    pantheonRender() {
      const st = this.state, scene = this.data.pantheon.scenes[st.sceneId];
      const god = this.data.pantheon.gods[scene.god] || { name: scene.god, title: scene.god };
      st.screen = "scene";
      st.view = {
        type: "pantheon", screen: "scene", sceneId: scene.id, mode: scene.mode, level: scene.level,
        god: god.name, eyebrow: god.title || god.name, title: scene.title, body: this.fill(scene.body),
        mechanic: scene.mechanic, progress: `${st.sceneIndex + 1}/${st.list.length}`,
        actions: [{ type: "p_next", label: st.sceneIndex + 1 >= st.list.length ? "Завершить" : "Дальше" }],
      };
      return this.currentView();
    }
  }

  return { Engine };
});

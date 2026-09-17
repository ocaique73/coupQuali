// Ponte entre o cliente 2D e a cena 3D.
//
// Por que existe: o client.js é script clássico e a cena é módulo ES. Este
// arquivo carrega a cena sob demanda e repassa estado, eventos e escolha de
// alvo. Se o 3D falhar — WebGL bloqueado, CDN fora, GPU fraca — cai para o 2D
// sozinho e avisa.
//
// Visual (2D/3D), câmera e tema são POR JOGADOR, guardados no navegador, e
// podem mudar NO MEIO da partida: se algo travar no 3D, dá para voltar ao 2D
// e continuar jogando sem perder a vez.

(function () {
  const HOST = document.getElementById("three3dHost");
  const AREA3D = document.getElementById("tableArea3d");
  const AREA2D = document.getElementById("tableArea");
  const MSG = document.getElementById("three3dMsg");
  const PICKER = document.getElementById("modePicker");
  const HINT = document.getElementById("modeHint");
  const CAMROW = document.getElementById("camRow");
  const CAMPICKER = document.getElementById("camPicker");

  const MODES = [
    { id: "2d", label: "2D", dot: "#3aa6ff" },
    { id: "3d", label: "3D", dot: "#a78bfa" },
  ];
  const CAMS = [
    { id: "first", label: "1ª pessoa", dot: "#22d3ee" },
    { id: "third", label: "3ª pessoa", dot: "#ff9d3a" },
  ];

  const read = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };

  let mode = read("coup.mode", "2d") === "3d" ? "3d" : "2d";
  let cam = read("coup.cam", "first") === "third" ? "third" : "first";
  let scene = null;
  let loading = false;
  let failed = false;

  function webglOk() {
    try {
      const c = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl"))
      );
    } catch {
      return false;
    }
  }

  function setMsg(t) {
    MSG.textContent = t || "";
    MSG.style.display = t ? "" : "none";
  }

  function showArea() {
    const on = mode === "3d" && !failed;
    AREA3D.classList.toggle("hidden", !on);
    AREA2D.classList.toggle("hidden", on);
    if (CAMROW) CAMROW.classList.toggle("hidden", !on);
    if (on && scene) scene.resize();
  }

  function opts() {
    return {
      theme: window.UI?.theme || "politica",
      hideCards: !!window.__coupHide,
      thirdPerson: cam === "third",
      targets: window.__coupTargets || null,
    };
  }

  async function ensureScene() {
    if (scene || loading || failed) return;
    if (!webglOk()) return fallback("Este navegador não tem WebGL — usando 2D.");

    loading = true;
    setMsg("Carregando 3D...");
    try {
      const mod = await import("/three/scene3d.js");
      mod.init(HOST, {
        // clicar num personagem escolhe o alvo da ação (roubar, golpe...)
        onPickTarget: (pid) => window.COUP3D.pickTarget?.(pid),
      });
      scene = mod;
      setMsg("");
      if (window.__coupState) scene.update(window.__coupState, window.__coupMyId, opts());
    } catch (e) {
      console.error("[3D]", e);
      fallback("Não deu para carregar o 3D — voltando para o 2D.");
    } finally {
      loading = false;
    }
  }

  function fallback(why) {
    failed = true;
    scene = null;
    mode = "2d";
    save("coup.mode", "2d");
    setMsg("");
    showArea();
    renderPicker();
    if (HINT) HINT.textContent = why;
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    save("coup.mode", m);
    failed = false;
    showArea();
    renderPicker();
    if (m === "3d") ensureScene();
  }

  function setCam(c) {
    if (c === cam) return;
    cam = c;
    save("coup.cam", c);
    renderPicker();
    if (scene && window.__coupState)
      scene.update(window.__coupState, window.__coupMyId, opts());
  }

  function pill(list, atual, onPick, disabled, title) {
    const frag = document.createDocumentFragment();
    for (const m of list) {
      const b = document.createElement("button");
      b.className = `themeBtn ${m.id === atual ? "on" : ""}`;
      b.innerHTML = `<i style="background:${m.dot}"></i>${m.label}`;
      b.disabled = !!disabled;
      b.title = title || `Usar ${m.label}`;
      b.onclick = () => onPick(m.id);
      frag.appendChild(b);
    }
    return frag;
  }

  function renderPicker() {
    if (!PICKER) return;

    const sig = `${mode}|${cam}|${failed}`;
    if (PICKER.dataset.sig !== sig) {
      PICKER.dataset.sig = sig;
      PICKER.innerHTML = "";
      // Pode trocar EM PARTIDA de propósito: é a saída de emergência se o 3D
      // travar no meio do jogo.
      PICKER.appendChild(pill(MODES, mode, setMode, false));

      if (CAMPICKER) {
        CAMPICKER.innerHTML = "";
        CAMPICKER.appendChild(pill(CAMS, cam, setCam, false));
      }
    }

    if (HINT && !failed)
      HINT.textContent = mode === "3d" ? "3D é experimental" : "";
  }

  // ---- ganchos chamados pelo client.js ----
  window.COUP3D = {
    pickTarget: null, // o client.js preenche

    onState(state, myId, extra) {
      window.__coupState = state;
      window.__coupMyId = myId;
      if (extra) {
        window.__coupTargets = extra.targets || null;
        window.__coupHide = !!extra.hideCards;
      }
      renderPicker();

      if (mode === "3d" && !failed) {
        ensureScene();
        if (scene) {
          try {
            scene.update(state, myId, opts());
          } catch (e) {
            console.error("[3D]", e);
            fallback("O 3D deu erro — voltando para o 2D.");
          }
        }
      }
    },

    // chat escrito e texto do chat rápido, acima do ombro no 3D
    onSpeak(pid, txt, ms) {
      if (mode === "3d" && scene) {
        try {
          scene.speak(pid, txt, ms);
        } catch (e) {
          console.error("[3D]", e);
        }
      }
    },

    onEmote(ev) {
      if (mode === "3d" && scene) {
        try {
          scene.emote(ev);
        } catch (e) {
          console.error("[3D]", e);
        }
      }
    },

    // moedas, cartas do embaixador, carta perdida
    onGameEvent(ev) {
      if (mode === "3d" && scene) {
        try {
          scene.gameEvent(ev);
        } catch (e) {
          console.error("[3D]", e);
        }
      }
    },

    // o cliente chama quando entra/sai do modo de escolher alvo
    refresh() {
      if (mode === "3d" && scene && window.__coupState)
        scene.update(window.__coupState, window.__coupMyId, opts());
    },

    isOn: () => mode === "3d" && !failed && !!scene,
  };

  addEventListener("resize", () => scene && scene.resize());
  showArea();
  renderPicker();
  if (mode === "3d") ensureScene();
})();

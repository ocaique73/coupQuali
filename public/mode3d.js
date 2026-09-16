// Ponte entre o cliente 2D e a cena 3D.
//
// Por que existe: o client.js é script clássico e a cena é módulo ES. Este
// arquivo carrega a cena sob demanda (import dinâmico) e repassa estado e
// emotes. Se o 3D falhar — WebGL bloqueado, CDN fora, GPU fraca — ele cai para
// o 2D sozinho e avisa, que é justamente o motivo de o 2D continuar existindo.
//
// A escolha é POR JOGADOR (fica no localStorage), não da sala: quem está numa
// máquina fraca usa 2D sem obrigar os outros. O estado do jogo é o mesmo nos
// dois modos — muda só o desenho.

(function () {
  const HOST = document.getElementById("three3dHost");
  const AREA3D = document.getElementById("tableArea3d");
  const AREA2D = document.getElementById("tableArea");
  const MSG = document.getElementById("three3dMsg");
  const PICKER = document.getElementById("modePicker");
  const HINT = document.getElementById("modeHint");

  const MODES = [
    { id: "2d", label: "2D", dot: "#3aa6ff" },
    { id: "3d", label: "3D", dot: "#a78bfa" },
  ];

  function read(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  }
  function save(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  }

  let mode = read("coup.mode", "2d") === "3d" ? "3d" : "2d";
  let scene = null; // módulo carregado
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
    if (on && scene) scene.resize();
  }

  async function ensureScene() {
    if (scene || loading || failed) return;
    if (!webglOk()) return fallback("Este navegador não tem WebGL — usando 2D.");

    loading = true;
    setMsg("Carregando 3D...");
    try {
      const mod = await import("/three/scene3d.js");
      mod.init(HOST);
      scene = mod;
      setMsg("");
      if (window.__coupState) scene.update(window.__coupState, window.__coupMyId);
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

  function renderPicker() {
    if (!PICKER) return;
    const playing = !!window.__coupState?.started;

    const sig = `${mode}|${playing}|${failed}`;
    if (PICKER.dataset.sig === sig) return;
    PICKER.dataset.sig = sig;

    PICKER.innerHTML = "";
    for (const m of MODES) {
      const b = document.createElement("button");
      b.className = `themeBtn ${m.id === mode ? "on" : ""}`;
      b.innerHTML = `<i style="background:${m.dot}"></i>${m.label}`;
      // trocar de renderizador no meio da partida atrapalha mais do que ajuda
      b.disabled = playing;
      b.title = playing
        ? "Só dá para trocar o visual fora da partida"
        : `Usar o visual ${m.label}`;
      b.onclick = () => setMode(m.id);
      PICKER.appendChild(b);
    }

    if (HINT && !failed)
      HINT.textContent = playing
        ? "Trava durante a partida"
        : mode === "3d"
          ? "3D é experimental"
          : "";
  }

  // ---- ganchos chamados pelo client.js ----
  window.COUP3D = {
    onState(state, myId) {
      window.__coupState = state;
      window.__coupMyId = myId;
      renderPicker();
      if (mode === "3d" && !failed) {
        ensureScene();
        if (scene) {
          try {
            scene.update(state, myId);
          } catch (e) {
            console.error("[3D]", e);
            fallback("O 3D deu erro — voltando para o 2D.");
          }
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
    isOn: () => mode === "3d" && !failed && !!scene,
  };

  addEventListener("resize", () => scene && scene.resize());
  showArea();
  renderPicker();
  if (mode === "3d") ensureScene();
})();

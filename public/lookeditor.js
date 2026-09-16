// Editor de personagem dentro do "Meu perfil": prévia 3D + opções.
//
// A cor é EXCLUSIVA na sala — as já usadas por outros aparecem riscadas e o
// servidor recusa de novo se alguém tentar burlar.
//
// A prévia usa o mesmo módulo da mesa (scene3d), num modo "vitrine": só o
// personagem, girando devagar, sem mesa nem jogo.

(function () {
  const PREV = document.getElementById("pfPreview3d");
  const MSG = document.getElementById("pfPreviewMsg");
  const PICKS = {
    color: document.getElementById("pfColor"),
    shirt: document.getElementById("pfShirt"),
    body: document.getElementById("pfBody"),
    skin: document.getElementById("pfSkin"),
    prop: document.getElementById("pfProp"),
  };

  // mesma paleta do 3D e do 2D
  const COLORS = ["#3aa6ff", "#2dd36f", "#ff6ad5", "#ff9d3a", "#a78bfa", "#22d3ee"];
  const SKIN_HEX = ["#ffdbac", "#f1c9a0", "#e0a875", "#c68642", "#8d5524", "#4a2c14"];

  const OPCOES = {
    shirt: [
      { id: "short", label: "Curta" },
      { id: "long", label: "Longa" },
    ],
    body: [
      { id: "thin", label: "Magro" },
      { id: "fat", label: "Gordo" },
    ],
    prop: [
      { id: "none", label: "Nada" },
      { id: "smoke", label: "Cigarro" },
    ],
  };

  let look = { shirt: "short", body: "thin", skin: 1, prop: "none" };
  let color = 0;
  let taken = new Set();
  let viewer = null; // módulo da vitrine
  let loading = false;

  function botao(txt, ativo, onClick, { dot, risca, title } = {}) {
    const b = document.createElement("button");
    b.className = `lookBtn ${ativo ? "on" : ""} ${risca ? "taken" : ""}`;
    b.innerHTML = dot
      ? `<i style="background:${dot}"></i>${txt ? UI.escape(txt) : ""}`
      : UI.escape(txt);
    b.title = title || "";
    b.disabled = !!risca;
    b.onclick = onClick;
    return b;
  }

  function render() {
    // cor
    PICKS.color.innerHTML = "";
    COLORS.forEach((hex, i) => {
      const ocupada = taken.has(i) && i !== color;
      PICKS.color.appendChild(
        botao("", i === color, () => {
          color = i;
          render();
          refreshPreview();
        }, {
          dot: hex,
          risca: ocupada,
          title: ocupada ? "Já é a cor de outro jogador" : "Usar esta cor",
        }),
      );
    });

    // pele
    PICKS.skin.innerHTML = "";
    SKIN_HEX.forEach((hex, i) => {
      PICKS.skin.appendChild(
        botao("", i === look.skin, () => {
          look.skin = i;
          render();
          refreshPreview();
        }, { dot: hex }),
      );
    });

    for (const campo of ["shirt", "body", "prop"]) {
      PICKS[campo].innerHTML = "";
      for (const o of OPCOES[campo]) {
        PICKS[campo].appendChild(
          botao(o.label, look[campo] === o.id, () => {
            look[campo] = o.id;
            render();
            refreshPreview();
          }),
        );
      }
    }
  }

  async function ensureViewer() {
    if (viewer || loading) return;
    loading = true;
    try {
      const mod = await import("/three/viewer3d.js");
      mod.init(PREV);
      viewer = mod;
      if (MSG) MSG.style.display = "none";
      refreshPreview();
    } catch (e) {
      console.error("[prévia 3D]", e);
      if (MSG) MSG.textContent = "prévia 3D indisponível";
    } finally {
      loading = false;
    }
  }

  function refreshPreview() {
    if (viewer) viewer.setLook({ color, look, avatar: window.__pfAvatar || null });
  }

  // ---- API usada pelo client.js ----
  window.LOOK = {
    open(atual) {
      look = Object.assign({ shirt: "short", body: "thin", skin: 1, prop: "none" }, atual.look || {});
      color = Number.isInteger(atual.color) ? atual.color : 0;
      taken = new Set(atual.taken || []);
      render();
      ensureViewer();
      refreshPreview();
    },
    // chamado quando o campo de foto muda, para a cabeça virar a foto
    setAvatar(url) {
      window.__pfAvatar = url || null;
      refreshPreview();
    },
    value() {
      return { look, color };
    },
    stop() {
      if (viewer) viewer.pause();
    },
    resume() {
      if (viewer) viewer.resume();
    },
  };
})();

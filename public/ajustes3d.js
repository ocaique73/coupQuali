// Os números da cena 3D num lugar só.
//
// Existe porque acertar "a mesa está pequena", "o boneco está baixo", "a luz
// está forte" editando código e recarregando levava uma eternidade. Aqui os
// valores ficam nomeados, a bancada em /teste mexe neles ao vivo, e o que
// ficar bom volta para PADRAO como o novo padrão do jogo.
//
// Script clássico de propósito: o client.js (que monta o painel) não é módulo,
// e a cena lê isto de window, como já faz com window.UI.
(function () {
  const PADRAO = {
    // ---- mesa ----
    mesaRaio: 2.05, // raio do tampo
    mesaAltura: 0.92, // altura do tampo a partir do chão
    mesaEspessura: 0.16,

    // ---- personagens ----
    assentoRaio: 2.62, // distância de cada boneco ao centro da mesa
    bonecoEscala: 1.0,
    bonecoAltura: 0, // sobe ou desce o boneco inteiro
    bonecoArco: 0.55, // quanto do círculo os outros ocupam (x PI)

    // ---- lâmpada ----
    lampadaAltura: 4.4, // onde o fio nasce no teto
    lampadaFio: 1.5, // comprimento do fio
    lampadaAbajur: 0.45, // raio do abajur

    // ---- luz ----
    luzForca: 42, // foco de cima
    luzAlcance: 14,
    luzRebote: 13, // o feltro devolvendo luz nos rostos
    luzAmbiente: 1.0,

    // ---- mau contato ----
    piscaLigado: 1, // 0 desliga
    piscaCada: 7, // segundos entre as crises
    piscaQuantas: 3, // apagadas por crise
    piscaForca: 0.78, // quanto a luz cai (0 a 1)

    // ---- câmera ----
    camPrimAltura: 2.12,
    camPrimDist: 1.34,
    camTercAltura: 3.1,
    camTercDist: 1.78,
    camAbertura: 64, // ângulo de visão
  };

  // Faixa e passo de cada controle. O rótulo é o que aparece na bancada.
  const CONTROLES = [
    ["Mesa", [
      ["mesaRaio", "Tamanho da mesa", 1.2, 3.4, 0.01],
      ["mesaAltura", "Altura da mesa", 0.5, 1.5, 0.01],
      ["mesaEspessura", "Espessura do tampo", 0.06, 0.4, 0.01],
    ]],
    ["Personagens", [
      ["assentoRaio", "Distância da mesa", 1.6, 4.2, 0.01],
      ["bonecoEscala", "Tamanho", 0.5, 1.8, 0.01],
      ["bonecoAltura", "Altura", -0.8, 0.8, 0.01],
      ["bonecoArco", "Abertura do semicírculo", 0.3, 1.0, 0.01],
    ]],
    ["Lâmpada", [
      ["lampadaAltura", "Altura do teto", 2.5, 6, 0.05],
      ["lampadaFio", "Comprimento do fio", 0.3, 3, 0.05],
      ["lampadaAbajur", "Tamanho do abajur", 0.2, 1.2, 0.01],
    ]],
    ["Luz", [
      ["luzForca", "Força do foco", 0, 120, 1],
      ["luzAlcance", "Alcance do foco", 5, 30, 0.5],
      ["luzRebote", "Luz de baixo (rostos)", 0, 40, 0.5],
      ["luzAmbiente", "Luz ambiente", 0, 3, 0.05],
    ]],
    ["Mau contato", [
      ["piscaLigado", "Ligado (0 ou 1)", 0, 1, 1],
      ["piscaCada", "Segundos entre crises", 2, 30, 0.5],
      ["piscaQuantas", "Apagadas por crise", 1, 8, 1],
      ["piscaForca", "Quanto apaga", 0.1, 1, 0.02],
    ]],
    ["Câmera", [
      ["camPrimAltura", "1ª pessoa — altura", 1, 4, 0.02],
      ["camPrimDist", "1ª pessoa — recuo", 0.8, 2.5, 0.02],
      ["camTercAltura", "3ª pessoa — altura", 1.5, 6, 0.02],
      ["camTercDist", "3ª pessoa — recuo", 1, 3.5, 0.02],
      ["camAbertura", "Ângulo de visão", 35, 100, 1],
    ]],
  ];

  const CHAVE = "coup.ajustes3d";

  function lidos() {
    try {
      const cru = localStorage.getItem(CHAVE);
      if (!cru) return {};
      const o = JSON.parse(cru);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  // Sempre parte do PADRAO: assim, um valor novo que eu adicione aqui aparece
  // para quem já tem ajustes salvos, em vez de vir indefinido.
  const atual = Object.assign({}, PADRAO, lidos());

  function salvar() {
    try {
      const diff = {};
      for (const k of Object.keys(PADRAO))
        if (atual[k] !== PADRAO[k]) diff[k] = atual[k];
      localStorage.setItem(CHAVE, JSON.stringify(diff));
    } catch {}
  }

  window.AJUSTES3D = {
    PADRAO,
    CONTROLES,
    valores: atual,
    get: (k) => atual[k],
    set(k, v) {
      if (!(k in PADRAO)) return;
      atual[k] = Number(v);
      salvar();
      window.COUP3D?.tune?.();
    },
    restaurar() {
      Object.assign(atual, PADRAO);
      try {
        localStorage.removeItem(CHAVE);
      } catch {}
      window.COUP3D?.tune?.();
    },
    // O que a bancada copia para virar o novo padrão no código.
    paraCodigo() {
      const linhas = Object.keys(PADRAO).map(
        (k) => `    ${k}: ${Number(atual[k].toFixed(4))},`,
      );
      return "  const PADRAO = {\n" + linhas.join("\n") + "\n  };";
    },
  };
})();

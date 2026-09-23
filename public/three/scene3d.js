// Cena 3D da mesa (Three.js, módulo ES).
//
// Não conhece regra de jogo: recebe o MESMO state do cliente 2D e desenha.
// Tudo que o jogo precisa para ser jogável no 3D passa por aqui — escolher
// alvo clicando no personagem, cronômetro da vez, respostas ao lado de cada
// um, esconder cartas, terceira pessoa, tema e gestos do chat rápido.
//
// API:
//   init(el, { onPickTarget, onLamp, onLook })
//   update(state, myId, opts)   opts: { theme, thirdPerson, targets, mesa }
//   emote(ev) / gameEvent(ev) / resize() / dispose()
//   revelar(pid, idx, role, tipo, ms) / suspense(pid, ms)  — virada da carta
//   lampadaDeFora(d) / olharDeFora(pid, yaw)  — o que a sala fez, chegando

import * as THREE from "three";

const COLORS = [0x3aa6ff, 0x2dd36f, 0xff6ad5, 0xff9d3a, 0xa78bfa, 0x22d3ee];

// feltro e brilho da lâmpada por tema (o 2D já muda; aqui acompanha)
const THEME_TABLE = {
  politica: { felt: 0x1f5c35, glow: 0xffc987, rim: 0x3a2412 },
  qualitas: { felt: 0xa8521a, glow: 0xffb56b, rim: 0x4a2408 },
};

let renderer, scene, camera, clock;
let container = null;
let lampPivot, lampLight, bounceLight, ambLight;
let lampCord, lampBody, lampShade, lampBulb;
let table, tableTop, tableRim, tableBase, deckMesh, bankGroup;
let raf = 0;
let disposed = false;
let onPickTarget = null;
// Avisos para fora da cena: o empurrão na lâmpada e para onde eu estou
// olhando. A cena não conhece socket — o client.js pluga estes dois.
let onLamp = null;
let onLook = null;

const seats = new Map(); // playerId -> refs
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

let myId = null;
let theme = "politica";
let thirdPerson = false;
let targets = null; // Set de ids clicáveis, ou null
let vencedorId = null; // enquanto dura a comemoração, a câmera fica nele
let hovered = null;

const shakeUntil = { t: 0 };
const lampKick = { t: 0 };
// Empurrar a lâmpada com a mão: enquanto está segura ela obedece ao ponteiro,
// e ao soltar volta a balançar sozinha a partir do ângulo onde parou.
const lampDrag = { ativo: false, x: 0, z: 0, lx: 0, ly: 0 };
// Pêndulo de verdade: ângulo e velocidade nos dois eixos. A lâmpada volta
// pela gravidade e vai perdendo força aos poucos, em vez de tremer rápido
// e parar de uma vez.
const lampFis = { z: 0, x: 0, vz: 0, vx: 0, t0: 0 };
const LAMP_MAX = 0.55; // até onde dá para empurrar, em radianos
// Altura do pescoço: é em volta deste ponto que a cabeça vira.
const PESCOCO = 1.62;

// O CRÂNIO, num lugar só. Cabelo e boné são calotas concêntricas com ele, e
// se cada um chutasse o próprio raio a peça descolaria da cabeça.
const CRANIO = { y: 1.74, r: 0.17, sx: 0.92, sy: 1.1, sz: 0.96 };
// referências do rosto, para nada voltar a tapar os olhos
const OLHO_Y = 1.79;
const SOBRANCELHA_Y = 1.836;
// TETO do quanto a cabeça vira. É o mesmo número do servidor (LOOK_MAX): o
// valor da barra fica por baixo dele, então nada que a cena mande é recusado
// do outro lado. A mesa gira infinito; o pescoço nunca.
const OLHAR_MAX = 0.92;
const OLHAR_MAX_Y = 0.42;

// O quanto a cabeça vira de fato — barra da bancada, presa ao teto acima.
function olharMax() {
  return Math.min(OLHAR_MAX, Math.max(0.05, aj("olharLimite", 0.55)));
}
const flying = []; // moedas/cartas em movimento pela mesa
const pops = []; // símbolos de gesto subindo acima do jogador
// Cartas virando na mesa agora. Enquanto uma está aqui, o updateCards não
// encosta nela: quem manda no desenho é a animação.
const virando = new Map(); // mesh -> { t, dur, role, volta, seat }
// "pid:idx" que a mesa tem de manter de costas até a virada terminar —
// o cliente 2D decide e manda junto com o estado.
let segredo = new Set();

// Um número da bancada (public/ajustes3d.js). Se a bancada não carregou,
// cai no valor de reserva e a cena monta igual — nada aqui pode depender
// dela para funcionar.
function aj(k, reserva) {
  const v = window.AJUSTES3D?.get(k);
  return typeof v === "number" && isFinite(v) ? v : reserva;
}

// a superfície onde as cartas e as fichas encostam
function tampo() {
  return aj("mesaAltura", 0.92) + aj("mesaEspessura", 0.16) / 2;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Giro e zoom da câmera. O giro dá a volta inteira na mesa, sem trava, e o
// zoom aproxima ou afasta. Nada disso revela carta de ninguém: a carta viva
// de outro jogador nunca chega a receber a arte (ver updateCards).
//
// Girar A MESA vale só em 3ª pessoa: em 1ª a câmera é o olho de quem está
// sentado, e girá-la dava a impressão de ter trocado de lugar. O que a 1ª
// pessoa faz com o arraste é virar a CABEÇA, com limite de pescoço — dá para
// olhar para os lados sem levantar da cadeira.
const orbit = {
  yaw: 0,
  pitch: 0,
  zoom: 1,
  dragging: false,
  lx: 0,
  ly: 0,
  andou: 0, // pixels percorridos desde que apertou
};

// Para onde EU estou olhando, em radianos, relativo a olhar para o centro da
// mesa. Em 1ª pessoa vem do arraste; em 3ª acompanha o giro da câmera, preso
// ao limite do pescoço. Vai para o servidor para os outros verem minha cabeça
// virar — sem isso, só eu sabia que tinha olhado para o lado.
const olhar = { yaw: 0, pitch: 0, enviadoYaw: 0, enviadoEm: 0 };
const EIXO_Y = new THREE.Vector3(0, 1, 0);

// Ângulo de volta para a faixa -PI..PI. A mesa gira infinito, então orbit.yaw
// cresce sem parar; o pescoço precisa do valor "de verdade" para saber que já
// chegou no limite.
function voltaPi(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
const trava = (v, m) => Math.max(-m, Math.min(m, v));

// Quanto a minha cabeça está virada agora. Em 3ª pessoa o giro da mesa é
// infinito mas a cabeça para no limite: o boneco olha para onde a câmera
// olha até onde o pescoço alcança.
function meuOlhar() {
  return thirdPerson
    ? trava(voltaPi(orbit.yaw), olharMax())
    : trava(olhar.yaw, olharMax());
}

// O recuo do zoom é limitado só em 1ª PESSOA. Aproximar continua solto nas
// duas: é assim que se chega perto da mesa para ver uma carta.
function zoomTeto() {
  return thirdPerson ? ZOOM_MAX : Math.max(1, aj("primZoomMax", 1.12));
}
const PITCH_MIN = -0.25;
const PITCH_MAX = 0.55;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.1;
// abaixo disto o movimento foi tremedeira de clique, não arraste
const ARRASTE_MIN = 6;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function cardTexture(url) {
  if (!texCache.has(url)) {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

function cardUrl(role) {
  return `/img/${theme}/${window.UI.roleClass(role)}.webp`;
}

// rótulo de texto como sprite; `bg` desenha uma pílula atrás (respostas)
function makeLabel(text, color = "#ffffff", w = 1.6, h = 0.4) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  function draw(txt, col, bg) {
    g.clearRect(0, 0, c.width, c.height);
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(26, 18, 460, 92, 46);
      else g.rect(26, 18, 460, 92);
      g.fill();
    }
    g.font = "bold 62px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (!bg) {
      g.lineWidth = 10;
      g.strokeStyle = "rgba(0,0,0,.85)";
      g.strokeText(txt, 256, 64);
    }
    g.fillStyle = col || color;
    g.fillText(txt, 256, 64);
    tex.needsUpdate = true;
  }
  draw(text, color, null);

  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  spr.scale.set(w, h, 1);
  spr.userData.redraw = draw;
  return spr;
}

// Placa de identificação acima da cabeça: foto → nome → moedas, numa linha
// só. A foto do perfil mora AQUI, não no rosto do boneco. Tudo desenhado num
// canvas porque um sprite custa uma chamada de desenho, e três elementos
// separados custariam três.
function makePlate() {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 176;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  let foto = null;
  let dados = { nick: "", coins: 0, cor: "#ffffff", etiqueta: null };

  function draw() {
    const { nick, coins, cor, etiqueta } = dados;
    g.clearRect(0, 0, c.width, c.height);

    g.font = "bold 70px system-ui, sans-serif";
    const wNick = g.measureText(nick).width;
    g.font = "bold 62px system-ui, sans-serif";
    const wMoedas = g.measureText(String(coins)).width;
    g.font = "bold 46px system-ui, sans-serif";
    const wEtiq = etiqueta ? g.measureText(etiqueta).width : 0;

    const rFoto = 56;
    const larg =
      (foto ? rFoto * 2 + 20 : 0) +
      wNick +
      24 +
      (etiqueta ? wEtiq + 10 : 52 + wMoedas);
    let x = (c.width - larg) / 2;
    const cy = c.height / 2;

    // pílula escura por trás: a sala é escura, mas o nome tem de ler sempre
    g.fillStyle = "rgba(6,12,20,.8)";
    g.beginPath();
    const px = x - 28;
    const pw = larg + 56;
    if (g.roundRect) g.roundRect(px, 24, pw, 128, 64);
    else g.rect(px, 24, pw, 128);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = cor;
    g.stroke();

    if (foto) {
      g.save();
      g.beginPath();
      g.arc(x + rFoto, cy, rFoto, 0, Math.PI * 2);
      g.clip();
      g.drawImage(foto, x, cy - rFoto, rFoto * 2, rFoto * 2);
      g.restore();
      g.beginPath();
      g.arc(x + rFoto, cy, rFoto, 0, Math.PI * 2);
      g.lineWidth = 5;
      g.strokeStyle = cor;
      g.stroke();
      x += rFoto * 2 + 20;
    }

    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "bold 70px system-ui, sans-serif";
    g.fillStyle = "#ffffff";
    g.fillText(nick, x, cy);
    x += wNick + 24;

    if (etiqueta) {
      // antes de começar não há moeda: o lugar dela é o aviso de pronto
      g.font = "bold 46px system-ui, sans-serif";
      g.fillStyle = etiqueta === "PRONTO" ? "#2dd36f" : "#8b97a8";
      g.fillText(etiqueta, x, cy + 2);
    } else {
      // moeda desenhada à mão: emoji de moeda não existe em toda fonte
      g.beginPath();
      g.arc(x + 21, cy, 21, 0, Math.PI * 2);
      g.fillStyle = "#ffd400";
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = "#8a6b00";
      g.stroke();
      x += 52;

      g.font = "bold 62px system-ui, sans-serif";
      g.fillStyle = "#ffd400";
      g.fillText(String(coins), x, cy);
    }

    tex.needsUpdate = true;
  }

  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  spr.scale.set(2.35, 0.54, 1);

  spr.userData.set = (nick, coins, cor, etiqueta) => {
    dados = { nick, coins, cor, etiqueta: etiqueta || null };
    draw();
  };
  // A foto pode nunca chegar (link quebrado, servidor sem CORS). Se falhar,
  // a placa continua válida, só sem retrato.
  spr.userData.setFoto = (url) => {
    if (!url) {
      foto = null;
      draw();
      return;
    }
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      foto = im;
      draw();
    };
    im.onerror = () => {};
    im.src = url;
  };

  return spr;
}

/* ------------------------------------------------------------------ */
/* cenário                                                             */
/* ------------------------------------------------------------------ */

function buildRoom() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  scene.fog = new THREE.Fog(0x07070a, 7, 20);

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(18, 7, 18),
    new THREE.MeshStandardMaterial({
      color: 0x14121a,
      roughness: 1,
      side: THREE.BackSide,
    }),
  );
  room.position.y = 3;
  room.receiveShadow = true;
  scene.add(room);

  table = new THREE.Group();
  tableTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 64),
    new THREE.MeshStandardMaterial({
      color: THEME_TABLE.politica.felt,
      roughness: 0.95,
    }),
  );
  tableTop.receiveShadow = true;
  table.add(tableTop);

  tableRim = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.09, 16, 64),
    new THREE.MeshStandardMaterial({
      color: THEME_TABLE.politica.rim,
      roughness: 0.6,
    }),
  );
  tableRim.rotation.x = Math.PI / 2;
  table.add(tableRim);

  tableBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.7, 1, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.8 }),
  );
  table.add(tableBase);
  scene.add(table);

  deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.12, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.7 }),
  );
  deckMesh.castShadow = true;
  table.add(deckMesh);

  bankGroup = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.025, 20),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0xd9d9d9 : 0xf0b429,
        roughness: 0.35,
        metalness: 0.65,
      }),
    );
    chip.position.set(0.32, i * 0.026, 0.1);
    bankGroup.add(chip);
  }
  table.add(bankGroup);

  ajustarMesa();
}

// Tudo que depende do tamanho ou da altura da mesa fica aqui, para poder ser
// refeito quando a bancada mexe nos números.
function ajustarMesa() {
  if (!tableTop) return;
  const r = aj("mesaRaio", 2.05);
  const esp = aj("mesaEspessura", 0.16);
  const h = aj("mesaAltura", 0.92);
  const sup = tampo();

  tableTop.scale.set(r, esp, r);
  tableTop.position.y = h;

  tableRim.scale.set(r + 0.02, r + 0.02, 1);
  tableRim.position.y = h + 0.03;

  tableBase.scale.set(1, h + 0.02, 1);
  tableBase.position.y = (h + 0.02) / 2;

  deckMesh.position.set(-0.32, sup + 0.06, 0.1);
  bankGroup.position.y = sup + 0.02;
}

function buildLamp() {
  lampPivot = new THREE.Group();
  scene.add(lampPivot);

  lampCord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0a }),
  );
  lampPivot.add(lampCord);

  const lamp = new THREE.Group();
  lampBody = lamp;

  // Cone SEM girar: o vértice fica em cima, onde o fio prende, e a boca
  // larga embaixo, jogando luz na mesa. Estava girado meia volta, o que
  // deixava o abajur de cabeça para baixo — funil abrindo para o teto.
  lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2b2b30,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  lampShade.userData.clickable = "lamp";
  lamp.add(lampShade);

  lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  lampBulb.userData.clickable = "lamp";
  lamp.add(lampBulb);

  // Luz baixa: acende a mesa e deixa o resto da sala no escuro.
  lampLight = new THREE.SpotLight(0xffc987, 42, 14, Math.PI / 3.4, 0.62, 1.3);
  lampLight.position.set(0, -0.12, 0);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lamp.add(lampLight);
  // O alvo fica na CENA, não dentro da lâmpada: pendurado nela, girava junto
  // com o abajur e a direção da luz nunca mudava de verdade. Quem o move é o
  // laço de animação, para o ponto do tampo onde o abajur está apontando.
  lampLight.target.position.set(0, tampo(), 0);
  scene.add(lampLight.target);

  lampPivot.add(lamp);

  // O feltro devolve luz para cima e acende os rostos de baixo.
  bounceLight = new THREE.PointLight(0xffb870, 13, 7, 2);
  scene.add(bounceLight);

  ambLight = new THREE.AmbientLight(0x3a3355, 1.0);
  scene.add(ambLight);
  const fill = new THREE.PointLight(0x5a4a80, 8, 16);
  fill.position.set(0, 3.4, 0);
  scene.add(fill);

  ajustarLampada();
}

function ajustarLampada() {
  if (!lampPivot) return;
  const teto = aj("lampadaAltura", 4.4);
  const fio = aj("lampadaFio", 1.5);
  const raio = aj("lampadaAbajur", 0.45);

  lampPivot.position.set(0, teto, 0);
  lampCord.scale.set(1, fio, 1);
  lampCord.position.y = -fio / 2;
  lampBody.position.y = -fio;

  // Abajur mais largo do que alto, como um pendente de verdade. O vértice
  // encosta na ponta do fio e a boca larga fica embaixo.
  const altura = raio * 0.85;
  lampShade.scale.set(raio, altura, raio);
  lampShade.position.y = -altura / 2;
  lampBulb.position.y = -altura * 0.8;

  lampLight.distance = aj("luzAlcance", 14);
  bounceLight.position.y = tampo() + 0.43;
  ambLight.intensity = aj("luzAmbiente", 1.0);
}

function applyTheme(t) {
  const cfg = THEME_TABLE[t] || THEME_TABLE.politica;
  if (tableTop) tableTop.material.color.set(cfg.felt);
  if (tableRim) tableRim.material.color.set(cfg.rim);
  if (lampLight) lampLight.color.set(cfg.glow);
  if (bounceLight) bounceLight.color.set(cfg.glow);
}

/* ------------------------------------------------------------------ */
/* personagem                                                          */
/* ------------------------------------------------------------------ */

const SKINS = [0xffdbac, 0xf1c9a0, 0xe0a875, 0xc68642, 0x8d5524, 0x4a2c14];
const HAIRS = [0x1c1410, 0x2a1d14, 0x4a3520, 0x6b4a2a, 0x9a6b3f, 0xd9b380];

// Mão com palma, quatro dedos e polegar. Cada dedo fica num PIVÔ no nó:
// girar o pivô dobra o dedo de verdade, em vez de arrastar a cápsula inteira
// para dentro da palma. É o que permite fechar a mão e deixar um dedo só
// esticado — o do meio, o indicador em L, o polegar do joinha.
function buildHand(skinMat) {
  const h = new THREE.Group();

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.1), skinMat);
  palm.castShadow = true;
  h.add(palm);

  // índice 0 = mindinho ... índice 3 = indicador (o mais perto do polegar)
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(-0.033 + i * 0.022, 0, 0.05);

    const f = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0115, 0.055, 3, 6),
      skinMat,
    );
    f.rotation.x = Math.PI / 2;
    f.position.z = 0.039;
    f.castShadow = true;
    pivot.add(f);

    h.add(pivot);
    fingers.push(pivot);
  }

  const tPivot = new THREE.Group();
  tPivot.position.set(0.05, 0.004, 0.012);
  const thumb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.014, 0.042, 3, 6),
    skinMat,
  );
  thumb.rotation.set(Math.PI / 2, 0, -0.9);
  thumb.position.set(0.006, 0, 0.02);
  tPivot.add(thumb);
  h.add(tPivot);

  h.userData.fingers = fingers;
  h.userData.thumb = tPivot;
  poseHand(h, "aberta");
  return h;
}

// Quanto cada dedo dobra em cada pose. Dobrar é girar no eixo X: o dedo sai
// de apontando para a frente e desce para dentro da palma.
// f = quanto cada dedo dobra; t = polegar para cima/baixo; tz = polegar
// aberto para o lado. O L só fecha se o polegar sair a 90° do indicador.
const POSES = {
  aberta: { f: [0, 0, 0, 0], t: 0, tz: 0 },
  punho: { f: [1.85, 1.85, 1.85, 1.85], t: 1.15, tz: 0 },
  dedo: { f: [1.95, 1.95, 0, 1.95], t: 1.2, tz: 0 }, // só o do meio de pé
  ele: { f: [1.95, 1.95, 1.95, 0], t: -0.05, tz: -1.15 }, // indicador + polegar em L
  joinha: { f: [2.05, 2.05, 2.05, 2.05], t: -1.45, tz: 0 }, // polegar para cima
};

function poseHand(h, nome) {
  const p = POSES[nome] || POSES.aberta;
  const fs = h.userData?.fingers;
  if (!fs) return;
  fs.forEach((f, i) => (f.rotation.x = p.f[i]));
  if (h.userData.thumb) h.userData.thumb.rotation.set(p.t, 0, p.tz || 0);
}

// Cabelo, careca, boné ou chapéu de cowboy. Careca não desenha nada: a
// cabeça de pele já está pronta por baixo.
// Cada item de cabeça tem a SUA barra de altura.
//
// Com uma barra só, subir o boné até sair dos olhos já jogava o chapéu de
// cowboy para cima da cabeça: eles assentam em alturas diferentes porque têm
// formatos diferentes. O cabelo entra na conta pelo mesmo motivo.
//
// Referências do rosto, para nada voltar a tapar os olhos: olhos em 1.79,
// topo da sobrancelha em ~1.845, alto da cabeça em 1.927.
// Calota que ACOMPANHA o crânio, cortada na altura da linha do cabelo.
//
// Cabelo e boné eram meia esfera de raio FIXO pousada numa altura. Dois
// defeitos vinham daí, e são os dois que apareciam na tela:
//
//  1. embaixo a borda era mais larga que a cabeça (uns 2 cm sobrando), o que
//     virava um friso preto em volta da testa;
//  2. a cabeça AFINA para cima, então subir a peça só afastava a borda — era
//     por isso que "subir o cabelo" o tirava da cabeça em vez de descobrir a
//     testa.
//
// Aqui a peça é uma esfera concêntrica com o crânio, um pouco maior, cortada
// no ângulo que cai exatamente na altura pedida. Ela encosta em todo o
// contorno, e subir a linha CORTA mais em vez de descolar.
// O teto: acima disto a calota fica menor que um dedal e a pessoa perde o
// cabelo sem entender por quê. A barra continua indo até lá, mas para aqui.
const LINHA_MAX = CRANIO.y + CRANIO.r * CRANIO.sy - 0.055;

function calotaCraniana(mat, linhaY, folga = 1.05) {
  linhaY = Math.min(linhaY, LINHA_MAX);
  const meioY = CRANIO.r * CRANIO.sy * folga;
  // cos(phi) = o quanto o corte está acima do centro, em meios-eixos
  const cos = Math.max(-0.9, Math.min(0.96, (linhaY - CRANIO.y) / meioY));
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(
      CRANIO.r * folga, 30, 22, 0, Math.PI * 2, 0, Math.acos(cos),
    ),
    mat,
  );
  m.scale.set(CRANIO.sx, CRANIO.sy, CRANIO.sz);
  m.position.y = CRANIO.y;
  m.castShadow = true;
  return m;
}

// Raio do crânio (em z, que é a direção da testa) na altura do corte: é onde
// a aba do boné tem de nascer para não flutuar nem entrar na cabeça.
function craneoRaioZ(linhaY, folga = 1.05) {
  const t = (Math.min(linhaY, LINHA_MAX) - CRANIO.y) / (CRANIO.r * CRANIO.sy * folga);
  return CRANIO.r * CRANIO.sz * folga * Math.sqrt(Math.max(0, 1 - t * t));
}

function montarCabeca(g, tipo, hairMat, skinMat, darkMat) {
  if (tipo === "bald") return;

  const subir =
    tipo === "cap"
      ? aj("boneAltura", 0)
      : tipo === "cowboy"
        ? aj("chapeuAltura", 0)
        : aj("cabeloAltura", 0);

  if (tipo === "cap" || tipo === "cowboy") {
    const corCap = tipo === "cap" ? darkMat : new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.85,
    });

    if (tipo === "cap") {
      // A linha do boné fica acima da sobrancelha: mais baixo que isso ele
      // tapa a testa inteira, que era o defeito.
      // 1.858 deixa uma faixa de testa à mostra entre a sobrancelha (topo em
      // 1.836) e a borda do boné, e é essa folga que a aba ocupa sem raspar.
      const linha = Math.min(1.858 + subir, LINHA_MAX);
      g.add(calotaCraniana(corCap, linha));

      // A ABA NASCE NA BORDA DA COPA. Antes ela ficava 4 cm acima dessa
      // borda e cortava o meio do boné — era o "aba no meio".
      const frente = craneoRaioZ(linha);
      const compAba = 0.115;
      const raioAba = 0.185;
      const aba = new THREE.Mesh(
        // disco parcial: só o pedaço da frente, como aba de boné
        new THREE.CylinderGeometry(raioAba, raioAba, 0.016, 22, 1, false, -1.0, 2.0),
        corCap,
      );
      // o disco é centrado, então recua metade dele para a ponta cair na
      // distância certa à frente da testa
      aba.position.set(0, linha - 0.008, frente + compAba - raioAba);
      aba.rotation.x = -0.16; // levanta a ponta, como aba de verdade
      aba.castShadow = true;
      g.add(aba);
      return;
    }

    // chapéu de cowboy: copa reta pousada na aba, que dá a volta na cabeça
    const linhaCh = 1.852 + subir;
    const aba = new THREE.Mesh(
      new THREE.CylinderGeometry(0.285, 0.285, 0.018, 26),
      corCap,
    );
    aba.position.y = linhaCh;
    aba.castShadow = true;
    g.add(aba);

    const copa = new THREE.Mesh(
      new THREE.CylinderGeometry(0.125, 0.16, 0.175, 22),
      corCap,
    );
    copa.position.y = linhaCh + 0.086;
    copa.castShadow = true;
    g.add(copa);

    const fita = new THREE.Mesh(
      new THREE.CylinderGeometry(0.163, 0.163, 0.04, 22),
      new THREE.MeshStandardMaterial({ color: 0x241509, roughness: 0.9 }),
    );
    fita.position.y = linhaCh + 0.03;
    g.add(fita);
    return;
  }

  // CABELO. A linha nasce logo acima da sobrancelha — descia até o olho e
  // fechava a testa. O `subir` mexe nessa linha, e como a calota acompanha o
  // crânio, subir agora DESCOBRE a testa em vez de tirar o cabelo da cabeça.
  const linha = Math.min(1.846 + subir, LINHA_MAX);
  g.add(calotaCraniana(hairMat, linha, 1.055));

  // Topetezinho: uma massa achatada saindo da frente do topo. É pequeno de
  // propósito — o volume grande que tentei antes virou capacete.
  const topete = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 14), hairMat);
  topete.scale.set(1.35, 0.5, 0.85);
  // o topete mora no ALTO da cabeça, não na linha do cabelo: subir a linha
  // descobre a testa e o topete fica onde estava, em vez de voar junto
  topete.position.set(0, 1.908, 0.055);
  topete.rotation.x = -0.3;
  topete.castShadow = true;
  g.add(topete);

  // costeletas: descem na frente da orelha e quebram a linha reta do corte
  for (const sx of [-1, 1]) {
    const cost = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.05), hairMat);
    cost.position.set(sx * 0.15, linha - 0.028, 0.012);
    g.add(cost);
  }
}

// A foto do perfil NÃO entra aqui: ela aparece na placa acima da cabeça,
// junto do nome e das moedas. Colada no rosto ficava irreconhecível e ainda
// engolia a cara do boneco.
export function buildCharacter({ color = 0, look = null, seed = 0 } = {}) {
  const g = new THREE.Group();
  const L = look || {
    shirt: "short",
    body: "thin",
    skin: seed % SKINS.length,
    prop: "none",
    head: "hair",
  };
  const gordo = L.body === "fat";
  const mangaLonga = L.shirt === "long";

  const shirtMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(COLORS[color % COLORS.length]),
    roughness: 0.68,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: SKINS[(L.skin ?? 0) % SKINS.length],
    roughness: 0.72,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: HAIRS[(color * 2 + seed) % HAIRS.length],
    roughness: 0.95,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a22,
    roughness: 0.6,
  });

  const W = gordo ? 1.32 : 1; // largura do corpo

  // O corpo inteiro pendura da JUNTA DO OMBRO: mudar a altura do tronco na
  // bancada desce a cintura, não a cabeça. Antes as alturas eram números
  // soltos e mexer numa desencaixava as outras.
  const ombroY = aj("ombroAltura", 1.43);
  const ombroX = aj("ombroLargura", 0.29);
  const troncoH = aj("troncoAltura", 0.52);
  const cintura = ombroY - troncoH;

  const hips = new THREE.Mesh(
    new THREE.CylinderGeometry(
      aj("quadrilRaio", 0.27) * W,
      aj("quadrilRaio", 0.27) * 1.1 * W,
      0.2,
      18,
    ),
    darkMat,
  );
  // 0.03 de sobreposição: encostado exato deixava uma fresta na emenda
  hips.position.y = cintura - 0.1 + 0.03;
  hips.castShadow = true;
  g.add(hips);

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(
      aj("troncoOmbro", 0.26) * W,
      aj("troncoCintura", 0.24) * W,
      troncoH,
      22,
    ),
    shirtMat,
  );
  torso.position.y = ombroY - troncoH / 2;
  torso.castShadow = true;
  g.add(torso);

  if (gordo) {
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.29, 18, 14), shirtMat);
    belly.scale.set(1.12, 0.78, 0.9);
    belly.position.set(0, cintura + troncoH * 0.29, 0.06);
    belly.castShadow = true;
    g.add(belly);
  }

  // Bola do ombro. Era 0.115 contra 0.07 do braço — uma esfera muito maior
  // do que o braço que sai dela, e o boneco ficava com ombreira de jogador
  // de futebol americano.
  for (const sx of [-1, 1]) {
    const sh = new THREE.Mesh(
      new THREE.SphereGeometry(aj("ombroTamanho", 0.09) * W, 14, 12),
      shirtMat,
    );
    sh.position.set(sx * ombroX * W, ombroY, 0);
    sh.castShadow = true;
    g.add(sh);
  }

  // gola: o acabamento da camisa onde o tronco fecha
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.17, 0.09, 16),
    shirtMat,
  );
  collar.position.y = ombroY + 0.07;
  g.add(collar);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.12, 12),
    skinMat,
  );
  neck.position.y = ombroY + 0.13;
  g.add(neck);

  // A CABEÇA INTEIRA num pivô no pescoço, para poder virar para os lados.
  //
  // Antes cada peça do rosto era filha do corpo, e girar só a esfera do
  // crânio deixava olhos, nariz e boca parados no lugar — a cabeça girava
  // vazia. São dois grupos: `cabeca` fica na altura do pescoço (é em volta
  // dela que o giro acontece) e `rosto` desfaz essa subida, para cada peça
  // continuar escrita nas alturas de sempre.
  const cabeca = new THREE.Group();
  cabeca.position.y = PESCOCO;
  // cresce a partir do pescoço, não do chão
  cabeca.scale.setScalar(aj("cabecaTamanho", 1));
  const rosto = new THREE.Group();
  rosto.position.y = -PESCOCO;
  cabeca.add(rosto);
  g.add(cabeca);
  g.userData.cabeca = cabeca;
  g.userData.rosto = rosto;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 26, 22), skinMat);
  head.scale.set(0.92, 1.1, 0.96);
  head.position.y = 1.74;
  head.castShadow = true;
  rosto.add(head);

  g.userData.head = head;

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat);
    ear.scale.set(0.5, 1, 0.7);
    ear.position.set(sx * 0.152, 1.74, 0);
    rosto.add(ear);
  }

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 10), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.73, 0.163);
  rosto.add(nose);
  g.userData.nose = nose; // cresce no gesto de "mentira"

  const eyeW = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.25 });
  const eyeD = new THREE.MeshStandardMaterial({ color: 0x1b1410, roughness: 0.15 });
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), eyeW);
    w.scale.set(1, 0.72, 0.6);
    w.position.set(sx * 0.062, 1.79, 0.146);
    rosto.add(w);

    const d = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 10, 8), eyeD);
    d.position.set(sx * 0.062, 1.79, 0.167);
    rosto.add(d);

    const br = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.013, 0.02), hairMat);
    br.position.set(sx * 0.062, 1.829, 0.151);
    br.rotation.z = sx * 0.12;
    rosto.add(br);
  }

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.012, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 0.5 }),
  );
  mouth.position.set(0, 1.676, 0.152);
  rosto.add(mouth);
  g.userData.mouth = mouth; // abre e fecha no gesto de rir

  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), skinMat);
  chin.scale.set(1, 0.6, 0.85);
  chin.position.set(0, 1.645, 0.06);
  rosto.add(chin);

  // cabelo, boné e chapéu também vão no pivô: viram junto com o rosto
  montarCabeca(rosto, L.head || "hair", hairMat, skinMat, darkMat);

  // Braço ESQUERDO segura as cartas; o DIREITO fica livre para os gestos.
  //
  // Cada braço tem DOIS pivôs: o ombro (o grupo do braço) e o cotovelo. Com
  // os dois em zero a pose é a de sempre — mão apoiada na mesa. Girar o
  // cotovelo é o que faz o braço ESTICAR nos gestos, em vez de o boneco só
  // levantar o conjunto todo duro.
  // Onde cada pedaço do braço TERMINA, calculado — não escrito à mão.
  //
  // Era daí que vinha o antebraço flutuando acima do braço: as posições do
  // cotovelo, do antebraço e da mão eram três números soltos, e bastava um
  // não bater com o ângulo do braço para a junta abrir. Agora a cápsula é
  // posta pelo seu TOPO (por isso o -meio) e a ponta sai do comprimento e do
  // ângulo, então o cotovelo cai sempre onde o braço acaba.
  const bracoR = aj("bracoGrossura", 0.07) * W;
  const bracoL = aj("bracoComprimento", 0.24) + bracoR * 2;
  const bracoA = aj("bracoAngulo", -0.55);
  const anteR = aj("anteGrossura", 0.058) * W;
  const anteL = aj("anteComprimento", 0.24) + anteR * 2;
  const anteA = aj("anteAngulo", -1.25);

  // ponta de uma cápsula de comprimento L girada em X por `a`, saindo da
  // origem do grupo
  const ponta = (L, a) => ({ y: -L * Math.cos(a), z: -L * Math.sin(a) });
  const cotovelo = ponta(bracoL, bracoA);
  const pulso = ponta(anteL, anteA);

  const arms = new THREE.Group();
  const maos = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();

    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(bracoR, bracoL - bracoR * 2, 4, 10),
      shirtMat,
    );
    upper.position.set(0, cotovelo.y / 2, cotovelo.z / 2);
    upper.rotation.x = bracoA;
    upper.castShadow = true;
    arm.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, cotovelo.y, cotovelo.z);
    arm.add(elbow);

    // manga longa cobre o antebraço; curta deixa a pele à mostra
    const fore = new THREE.Mesh(
      new THREE.CapsuleGeometry(anteR, anteL - anteR * 2, 4, 10),
      mangaLonga ? shirtMat : skinMat,
    );
    fore.position.set(0, pulso.y / 2, pulso.z / 2);
    fore.rotation.x = anteA;
    fore.castShadow = true;
    elbow.add(fore);

    if (mangaLonga) {
      // a boca da manga fica um pouco antes do pulso
      const recuo = 0.04 / anteL;
      const punho = new THREE.Mesh(
        new THREE.CylinderGeometry(anteR * 1.07, anteR * 1.07, 0.03, 12),
        darkMat,
      );
      punho.rotation.x = anteA;
      punho.position.set(0, pulso.y * (1 - recuo), pulso.z * (1 - recuo));
      elbow.add(punho);
    }

    const hand = buildHand(skinMat);
    hand.position.set(0, pulso.y, pulso.z);
    hand.rotation.x = anteA + aj("maoAngulo", 0.9);
    elbow.add(hand);
    arm.userData.hand = hand;
    arm.userData.elbow = elbow;
    maos.push(hand);

    arm.position.set(sx * ombroX * W, ombroY, 0);
    arm.userData.x0 = sx * ombroX * W; // descanso, respeitando o corpo
    arms.add(arm);
  }
  g.add(arms);
  g.userData.arms = arms;
  g.userData.maos = maos;
  // guardado para o brilho da vez: é a ROUPA que pulsa, não uma luz em volta
  g.userData.shirtMat = shirtMat;
  g.userData.shirtColor = new THREE.Color(COLORS[color % COLORS.length]);

  const prop = new THREE.Group();
  prop.position.set(0.07, 1.688, 0.135);
  if (L.prop === "smoke") {
    const cig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }),
    );
    cig.rotation.set(Math.PI / 2, 0, -0.25);
    cig.position.z = 0.08;
    prop.add(cig);

    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
    );
    ember.position.set(0.02, 0.01, 0.16);
    prop.add(ember);
    prop.userData.ember = ember;

    const puffs = [];
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0xbfc4cc,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      );
      puff.position.set(0.02, 0.05 + i * 0.16, 0.15);
      puff.userData.phase = i / 3;
      prop.add(puff);
      puffs.push(puff);
    }
    prop.userData.puffs = puffs;
  }
  // O cigarro está na BOCA: entra no pivô da cabeça, senão ficava flutuando
  // parado no ar quando o jogador virava o rosto.
  (g.userData.rosto || g).add(prop);
  g.userData.prop = prop;

  return g;
}

/* ------------------------------------------------------------------ */
/* assentos                                                            */
/* ------------------------------------------------------------------ */

// O jogador local fica no ângulo 0 e os outros se espalham pelo ARCO OPOSTO:
// num círculo completo, quem estivesse a 90° ficaria ao lado da câmera e
// nunca apareceria na tela.
// Todo mundo igualmente espaçado em volta da mesa: dois de frente um para o
// outro, três num triângulo, quatro num quadrado. Antes os outros eram
// espremidos num arco do lado oposto, para caberem na tela em 1ª pessoa — o
// resultado era uma mesa torta, com o dono da sala afastado dos demais.
function seatAngle(idx, total) {
  return ((Math.PI * 2) / Math.max(1, total)) * idx;
}

// Reposiciona e redimensiona os bonecos. Chamado ao montar cada assento e
// toda vez que a bancada mexe num número.
function ajustarAssentos() {
  const r = aj("assentoRaio", 2.62);
  const esc = aj("bonecoEscala", 1);
  const alt = aj("bonecoAltura", 0);
  const inc = aj("bonecoInclina", 0);
  const sup = tampo();
  // as cartas ficam logo para dentro da borda da mesa, então acompanham
  // qualquer mudança no tamanho dela
  const zc = r - (aj("mesaRaio", 2.05) - aj("cartaBorda", 0.34));

  for (const [, st] of seats) {
    const ang = seatAngle(st.idx, st.total ?? seats.size);
    st.ang = ang;
    st.group.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
    // olhar para o CHÃO do centro, não para 1 m de altura: mirar para cima
    // inclinava o boneco inteiro para trás e ele parecia deitado
    st.group.lookAt(0, 0, 0);

    st.escala = esc;
    st.alturaBase = alt;
    st.body.scale.setScalar(esc);
    st.body.position.y = alt;
    st.body.rotation.x = inc; // inclinação é do corpo, não do assento

    const ct = aj("cartaTamanho", 1);
    const meia = aj("cartaAfasta", 0.15);
    st.cartas.position.set(0, sup + 0.012, zc);
    st.cards.forEach((c, i) => {
      c.position.set((i - 0.5) * 2 * meia, i * 0.002, 0);
      c.scale.setScalar(ct);
    });
    st.chips.position.set(aj("fichaAfasta", 0.46), sup + 0.02, zc);
  }
}

function lookSig(p) {
  const L = p.look || {};
  return `${p.color}|${L.shirt}|${L.body}|${L.skin}|${L.prop}|${L.head}`;
}

function buildSeat(p, idx, total) {
  const g = new THREE.Group();
  const ang = seatAngle(idx, total);
  const r = aj("assentoRaio", 2.62);
  g.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
  g.lookAt(0, 0, 0); // para o chão do centro: mirar acima deitava o boneco

  const refs = {
    group: g, ang, idx, total,
    sig: "", lookSig: "", chipsN: -1,
    escala: aj("bonecoEscala", 1),
    alturaBase: aj("bonecoAltura", 0),
  };

  refs.body = buildCharacter({
    color: p.color ?? 0,
    look: p.look,
    seed: idx,
  });
  refs.lookSig = lookSig(p);
  refs.body.scale.setScalar(refs.escala);
  refs.body.position.y = refs.alturaBase;
  g.add(refs.body);

  // As cartas ficam DEITADAS NA MESA, viradas para baixo — inclusive as
  // minhas: eu vejo as minhas pelo HUD. A que o jogador perde abre para cima
  // e todo mundo enxerga.
  const cartas = new THREE.Group();
  cartas.rotation.x = -Math.PI / 2; // deitadas no tampo
  refs.cards = [];
  for (let i = 0; i < 2; i++) {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.39),
      new THREE.MeshStandardMaterial({
        color: 0x16213a,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    card.castShadow = true;
    cartas.add(card);
    refs.cards.push(card);
  }
  g.add(cartas);
  refs.cartas = cartas;

  // as fichas ficam ao lado das cartas do dono
  refs.chips = new THREE.Group();
  g.add(refs.chips);

  // foto, nome e moedas numa placa só, acima da cabeça
  refs.plate = makePlate();
  refs.plate.position.set(0, 2.42, 0);
  refs.plate.userData.pid = p.id; // clicar no NOME também escolhe o alvo
  g.add(refs.plate);

  // cronômetro logo abaixo do nome, e só na vez do jogador
  refs.timeLbl = makeLabel("", "#ffd400", 1.0, 0.26);
  refs.timeLbl.position.set(0, 2.08, 0);
  refs.timeLbl.visible = false;
  g.add(refs.timeLbl);

  // resposta (ACEITA / CONTESTA / BLOQUEIA) ao lado do personagem
  refs.respLbl = makeLabel("", "#ffffff", 1.15, 0.3);
  refs.respLbl.position.set(0.95, 1.62, 0);
  refs.respLbl.visible = false;
  g.add(refs.respLbl);

  // Balão de fala: chat escrito e o texto do chat rápido. No 2D isso aparece
  // ao lado do card; no 3D não aparecia em lugar nenhum, então metade do
  // chat rápido era invisível para quem jogava em 3D.
  refs.chatLbl = makeLabel("", "#ffffff", 2.1, 0.44);
  refs.chatLbl.position.set(-1.0, 1.78, 0);
  refs.chatLbl.visible = false;
  g.add(refs.chatLbl);

  refs.ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.58, 40),
    new THREE.MeshBasicMaterial({
      color: COLORS[(p.color ?? 0) % COLORS.length],
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
  );
  refs.ring.rotation.x = -Math.PI / 2;
  refs.ring.position.y = 0.02;
  g.add(refs.ring);

  // alvo de clique: cilindro invisível cobrindo o corpo
  refs.hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 2, 12),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  refs.hit.position.y = 1.1;
  refs.hit.userData.pid = p.id;
  g.add(refs.hit);

  refs.id = p.id;
  scene.add(g);
  return refs;
}

function updateChips(seat, coins) {
  if (seat.chipsN === coins) return;
  seat.chipsN = coins;
  seat.chips.clear();

  const gold = Math.floor(coins / 5);
  const silver = coins % 5;
  let i = 0;
  const mk = (isGold, n) => {
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.022, 16),
        new THREE.MeshStandardMaterial({
          color: isGold ? 0xf0b429 : 0xd9d9d9,
          roughness: 0.35,
          metalness: 0.6,
        }),
      );
      const col = Math.floor(i / 5);
      c.position.set(col * 0.18, (i % 5) * 0.023, 0);
      c.castShadow = true;
      seat.chips.add(c);
      i++;
    }
  };
  mk(true, gold);
  mk(false, silver);
}

function updateCards(seat, p) {
  // O segredo entra na assinatura: quando ele cai, a mesa se redesenha e a
  // carta finalmente aparece morta.
  const oculta = (i) => segredo.has(`${p.id}:${i}`);
  const sig =
    (p.hand || [])
      .map((c, i) => `${c.role || "?"}|${c.alive || oculta(i)}`)
      .join(",") +
    "|" +
    theme;
  if (seat.sig === sig) return;
  seat.sig = sig;

  (p.hand || []).forEach((c, i) => {
    const mesh = seat.cards[i];
    if (!mesh) return;
    // está virando neste instante: a animação é dona do mesh
    if (virando.has(mesh)) return;

    // Na mesa, carta viva fica SEMPRE virada para baixo — a minha também,
    // porque eu leio as minhas no HUD. A perdida vira para cima, de lado,
    // para a mesa inteira ver o que caiu.
    const viva = c.alive || oculta(i);
    const show = viva ? null : c.role;

    porCartaPraCima(mesh, show);
    mesh.rotation.z = viva ? 0 : 0.42;
    mesh.material.opacity = 1;
    mesh.material.transparent = false;
  });
}

// Pinta o mesh da carta: com papel (face para cima) ou sem (dorso).
//
// O plano é um só, com material DoubleSide — girar 180° mostraria a MESMA
// arte espelhada. O scale.x negativo desfaz esse espelho, e a troca acontece
// com a carta de perfil, onde ninguém vê.
function porCartaPraCima(mesh, role, espelhado = false) {
  if (role) {
    mesh.material.map = cardTexture(cardUrl(role));
    mesh.material.color.set(0xffffff);
  } else {
    mesh.material.map = null;
    mesh.material.color.set(0x16213a);
  }
  mesh.material.needsUpdate = true;
  // o sinal inverte o espelho, o módulo preserva o tamanho vindo da bancada
  mesh.scale.x = (espelhado ? -1 : 1) * Math.abs(mesh.scale.y || 1);
  if (!espelhado) mesh.rotation.y = 0;
}

// Aquele assento ainda tem carta em segredo (virando ou esperando virar)?
function assentoOculto(pid) {
  return segredo.has(`${pid}:0`) || segredo.has(`${pid}:1`);
}

/* ------------------------------------------------------------------ */
/* a virada da carta na mesa                                           */
/*                                                                     */
/* É o momento de suspense do jogo: a carta sobe do tampo, gira de     */
/* verdade e só então mostra o papel. Antes ela simplesmente trocava de */
/* textura entre dois quadros e não havia nada para ver.               */
/* ------------------------------------------------------------------ */

function ritmoRevela() {
  const v = aj("revelaRitmo", 1);
  return v > 0 ? v : 1;
}

// A carta treme na mesa antes de virar: o "vai ou não vai".
//
// O `ms` vem da fila de animações do 2D. É ela quem manda no ritmo — quando
// muita coisa acontece de uma vez a fila acelera, e a mesa 3D tem de acelerar
// junto, senão as duas telas contam a mesma jogada em tempos diferentes.
export function suspense(pid, ms) {
  const seat = seats.get(pid);
  if (!seat) return;
  seat.tremeAte = performance.now() + (ms || 750 * ritmoRevela()) * 1.3;
}

// Vira a carta `idx` do jogador. `tipo` = "perda" (fica virada para cima,
// caída de lado) ou "prova" (mostra e volta a deitar de costas).
export function revelar(pid, idx, role, tipo = "perda", ms) {
  const seat = seats.get(pid);
  const mesh = seat?.cards?.[idx];
  if (!mesh) return;

  seat.tremeAte = 0;
  seat.cartas.rotation.z = 0;
  virando.set(mesh, {
    t: 0,
    dur: ((ms || 1500 * ritmoRevela()) * 1.3) / 1000,
    role,
    volta: tipo === "prova",
    seat,
    z0: mesh.position.z,
  });
  porCartaPraCima(mesh, null);
  mesh.rotation.z = 0;
}

// Roda um quadro de cada carta virando. Chamada pelo laço de animação.
function passoDasViradas(dt) {
  for (const [mesh, v] of virando) {
    v.t += dt;
    const k = Math.min(1, v.t / v.dur);

    // sobe do tampo, fica no ar enquanto a mesa lê e desce no fim
    const alto = Math.sin(Math.min(1, k / 0.95) * Math.PI) * 0.16;
    mesh.position.z = v.z0 + alto;

    // As mesmas fatias do 2D: 22% recuando, 33% girando, o resto parada de
    // frente para a mesa inteira ler. Se os dois não baterem, quem joga em
    // 3D vê a carta em outro tempo de quem joga em 2D.
    let giro = 0;
    if (k < 0.22) giro = -0.28 * (k / 0.22); // recua para pegar impulso
    else if (k < 0.55) {
      const g = (k - 0.22) / 0.33;
      giro = -0.28 + (Math.PI + 0.28) * (g * g * (3 - 2 * g));
    } else giro = Math.PI;
    mesh.rotation.y = giro;

    // troca a arte com a carta de perfil, onde a troca não aparece
    if (!v.trocou && giro >= Math.PI / 2) {
      v.trocou = true;
      porCartaPraCima(mesh, v.role, true);
    }

    if (k >= 1) {
      virando.delete(mesh);
      if (v.volta) {
        // era só prova: volta a deitar de costas, como toda carta viva
        porCartaPraCima(mesh, null);
        mesh.rotation.y = 0;
        mesh.rotation.z = 0;
      } else {
        mesh.rotation.z = 0.42;
      }
      mesh.position.z = v.z0;
      if (v.seat) v.seat.sig = ""; // deixa o updateCards assumir de novo
    }
  }
}

function bankPos() {
  return new THREE.Vector3(0.32, 1.1, 0.1);
}
function deckPos() {
  return new THREE.Vector3(-0.32, 1.12, 0.1);
}
function seatFront(pid) {
  const s = seats.get(pid);
  if (!s) return bankPos();
  const v = new THREE.Vector3(0.5, 1.05, 0.3);
  s.group.localToWorld(v);
  return v;
}
// Onde ficam as cartas daquele jogador na mesa. A carta que voa do baralho
// pousa aqui, e a que ele devolve sai daqui.
function seatHand(pid) {
  const s = seats.get(pid);
  if (!s) return bankPos();
  return s.cartas.getWorldPosition(new THREE.Vector3());
}

function flyChip(from, to, gold, delay = 0) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.022, 16),
    new THREE.MeshStandardMaterial({
      color: gold ? 0xf0b429 : 0xd9d9d9,
      roughness: 0.35,
      metalness: 0.6,
    }),
  );
  m.position.copy(from);
  m.castShadow = true;
  scene.add(m);
  flying.push({ m, from: from.clone(), to: to.clone(), t: -delay, dur: 0.55, arc: 0.45 });
}

function flyCardMesh(from, to, role, delay = 0) {
  const mat = new THREE.MeshStandardMaterial({
    color: role ? 0xffffff : 0x16213a,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  if (role) mat.map = cardTexture(cardUrl(role));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.39), mat);
  m.position.copy(from);
  m.castShadow = true;
  scene.add(m);
  flying.push({
    m,
    from: from.clone(),
    to: to.clone(),
    t: -delay,
    dur: 0.7,
    arc: 0.55,
    spin: true,
  });
}

/* ------------------------------------------------------------------ */
/* a lâmpada é da SALA                                                 */
/*                                                                     */
/* Quem empurra manda o ângulo e a velocidade; os outros recebem e a    */
/* física de cada cena segue dali. É o empurrão que viaja, não cada     */
/* quadro do balanço — 60 pacotes por segundo por pessoa derrubariam a  */
/* sala, e o pêndulo é a mesma conta em todas as telas.                 */
/* ------------------------------------------------------------------ */

// De fora chega bem mais rápido do que a sala precisa ver; este é o freio.
const LAMP_ENVIO_MS = 60;
let lampEnviadoEm = 0;
// a lâmpada da sala já foi aplicada uma vez nesta cena?
let lampPronta = false;
// Até quando obedecer à mão de OUTRA pessoa. Enquanto alguém segura o abajur,
// a física daqui fica parada: sem isso, entre um pacote e outro o pêndulo
// local puxava a lâmpada de volta ao centro e ela tremia na mão do outro.
let lampSeguradaAte = 0;

function mandarLampada(solta) {
  if (!onLamp) return;
  const agora = performance.now();
  // "solta" é o fim do gesto: passa sempre, senão o último empurrão (o que
  // define o tamanho do balanço) podia ser justamente o que o freio comeu
  if (!solta && agora - lampEnviadoEm < LAMP_ENVIO_MS) return;
  lampEnviadoEm = agora;
  onLamp({
    z: lampFis.z,
    x: lampFis.x,
    // Enquanto a mão está no abajur a física fica congelada dos dois lados,
    // então a velocidade guardada é lixo velho: vai zero e o outro lado só
    // segue a posição. O pêndulo recomeça para todos no "solta", do mesmo
    // ângulo — a conta é a mesma, o balanço sai igual em todas as telas.
    vz: 0,
    vx: 0,
    solta: !!solta,
  });
}

// Alguém na sala empurrou a lâmpada (ou eu acabei de entrar e ela já estava
// balançando). Aqui a cena entra no mesmo balanço.
export function lampadaDeFora(d) {
  if (!lampPivot || !d) return;
  // quem está com a mão no abajur manda, não obedece
  if (lampDrag.ativo) return;
  const n = (v, m) => (Number.isFinite(Number(v)) ? trava(Number(v), m) : 0);
  lampFis.z = n(d.z, LAMP_MAX);
  lampFis.x = n(d.x, LAMP_MAX);
  lampFis.vz = n(d.vz, 6);
  lampFis.vx = n(d.vx, 6);
  if (d.solta) {
    // largou: daqui em diante é o pêndulo de cada cena, e ele parte do mesmo
    // ângulo em todas — a conta é a mesma, então o balanço sai igual
    lampSeguradaAte = 0;
    const forca = Math.min(1, Math.abs(lampFis.z) / LAMP_MAX);
    lampKick.t = performance.now() + 1200 + forca * 2400;
  } else {
    // ainda segurando do outro lado: segue a mão dele, sem pêndulo. O prazo
    // é a rede de segurança para quem largou e cujo "solta" se perdeu.
    lampSeguradaAte = performance.now() + 400;
  }
}

// Alguém virou a cabeça. Chega por fora do estado para a cabeça acompanhar o
// mouse do outro, e não só a cada pacote de estado.
export function olharDeFora(pid, yaw) {
  const s = seats.get(pid);
  if (!s || pid === myId) return;
  // teto, não a barra: o outro pode estar com um limite diferente do meu
  s.olharAlvo = trava(Number(yaw) || 0, OLHAR_MAX);
}

// Manda o meu olhar quando ele muda de verdade. Sem o filtro, um mouse
// parado ainda mandaria pacote a cada quadro.
function mandarOlhar() {
  if (!onLook) return;
  const y = meuOlhar();
  const agora = performance.now();
  if (Math.abs(y - olhar.enviadoYaw) < 0.015) return;
  if (agora - olhar.enviadoEm < 70) return;
  olhar.enviadoYaw = y;
  olhar.enviadoEm = agora;
  onLook(y);
}

// Eventos do jogo que viram movimento na mesa.
export function gameEvent(ev) {
  if (!scene) return;

  if (ev.type === "coins") {
    const ganha = ev.delta > 0;
    const n = Math.min(Math.abs(ev.delta), 5);
    const banco = bankPos();
    const frente = seatFront(ev.playerId);
    for (let i = 0; i < n; i++)
      flyChip(ganha ? banco : frente, ganha ? frente : banco, false, i * 0.08);
  } else if (ev.type === "steal") {
    const a = seatFront(ev.fromId);
    const b = seatFront(ev.toId);
    for (let i = 0; i < Math.min(ev.amount || 2, 4); i++)
      flyChip(a, b, false, i * 0.1);
  } else if (ev.type === "deck_draw") {
    // embaixador pegando as cartas do meio da mesa
    for (let i = 0; i < (ev.count || 2); i++)
      flyCardMesh(deckPos(), seatHand(ev.playerId), null, i * 0.16);
  } else if (ev.type === "deck_return") {
    for (let i = 0; i < (ev.count || 0); i++)
      flyCardMesh(seatHand(ev.playerId), deckPos(), null, i * 0.14);
  } else if (ev.type === "card_lost") {
    flyCardMesh(
      seatHand(ev.playerId),
      new THREE.Vector3(0, 1.06, -0.55),
      ev.role,
    );
  }
}

/* ------------------------------------------------------------------ */
/* interação                                                           */
/* ------------------------------------------------------------------ */

function onPointerMove(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;

  if (lampDrag.ativo) {
    const dx = e.clientX - lampDrag.lx;
    const dy = e.clientY - lampDrag.ly;
    lampDrag.lx = e.clientX;
    lampDrag.ly = e.clientY;

    // O empurrão é no sentido da TELA, não nos eixos do mundo.
    //
    // Era isto que deixava o abajur invertido: o código somava dx no eixo X
    // do mundo, mas a câmera gira em volta da mesa — de metade dos assentos o
    // "+X do mundo" aparece à esquerda, e a lâmpada ia para o lado contrário
    // do arraste. Agora o arraste é projetado na direção para onde a câmera
    // olha, então puxar para a direita joga a lâmpada para a direita de quem
    // está vendo, de qualquer assento.
    const frente = camera.getWorldDirection(new THREE.Vector3());
    frente.y = 0;
    if (frente.lengthSq() < 1e-6) frente.set(0, 0, -1);
    frente.normalize();
    const direita = new THREE.Vector3(-frente.z, 0, frente.x);

    const ganho = 0.004;
    // arrastar para BAIXO traz a lâmpada para perto de quem olha
    const mundoX = direita.x * dx * ganho - frente.x * dy * ganho;
    const mundoZ = direita.z * dx * ganho - frente.z * dy * ganho;

    // deslocar em +X é girar +Z; deslocar em +Z é girar -X
    lampFis.z = trava(lampFis.z + mundoX, LAMP_MAX);
    lampFis.x = trava(lampFis.x - mundoZ, LAMP_MAX);
    mandarLampada(false);
    return;
  }

  if (orbit.dragging) {
    const dx = e.clientX - orbit.lx;
    const dy = e.clientY - orbit.ly;
    orbit.lx = e.clientX;
    orbit.ly = e.clientY;
    orbit.andou += Math.abs(dx) + Math.abs(dy);

    if (thirdPerson) {
      // sem trava: dá para dar a volta completa na mesa
      orbit.yaw -= dx * 0.005;
      orbit.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbit.pitch + dy * 0.004));
    } else {
      // 1ª pessoa: a mesa fica firme e quem vira é a cabeça, com limite. O dy
      // NÃO mexe na altura da câmera aqui — subir o olho do jogador sentado
      // parecia que ele tinha levantado da cadeira.
      // Os sentidos são os MESMOS da 3ª pessoa, senão trocar de câmera no meio
      // da partida invertia o mouse: arrastar para a direita vira o olhar
      // para a direita, arrastar para baixo abaixa o olhar para a mesa.
      olhar.yaw = trava(olhar.yaw - dx * 0.005, olharMax());
      olhar.pitch = trava(olhar.pitch - dy * 0.004, OLHAR_MAX_Y);
    }
  }
}

function onPointerDown(e) {
  onPointerMove(e);

  // A lâmpada vem antes do giro, e vale nas duas câmeras: empurrar o abajur
  // não é girar a mesa.
  const hit = pick();
  if (hit?.lamp) {
    lampDrag.ativo = true;
    lampDrag.lx = e.clientX;
    lampDrag.ly = e.clientY;
    renderer.domElement.style.cursor = "grabbing";
    return;
  }

  // Vale nas duas câmeras: em 3ª gira a mesa, em 1ª vira a cabeça.
  orbit.dragging = true;
  orbit.andou = 0;
  orbit.lx = e.clientX;
  orbit.ly = e.clientY;
}

function onPointerUp() {
  if (lampDrag.ativo) {
    lampDrag.ativo = false;
    // Larga onde está e deixa a gravidade trazer de volta: a velocidade
    // começa em zero e o balanço nasce do próprio deslocamento.
    lampFis.vz = 0;
    lampFis.vx = 0;
    const forca = Math.min(1, Math.abs(lampFis.z) / LAMP_MAX);
    lampKick.t = performance.now() + 1200 + forca * 2400;
    // o pacote que fecha o gesto: daqui em diante é a física de cada cena
    mandarLampada(true);
  }
  orbit.dragging = false;
  renderer.domElement.style.cursor = "";
}

// scroll aproxima e afasta
function onWheel(e) {
  e.preventDefault();
  const k = e.deltaY > 0 ? 1.08 : 1 / 1.08;
  orbit.zoom = Math.max(ZOOM_MIN, Math.min(zoomTeto(), orbit.zoom * k));
}

// duplo clique volta a câmera para o lugar
function onDblClick() {
  orbit.yaw = 0;
  orbit.pitch = 0;
  orbit.zoom = 1;
  olhar.yaw = 0;
  olhar.pitch = 0;
}

function pick() {
  if (!scene || !camera) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o) {
      if (o.userData?.pid) return { pid: o.userData.pid };
      if (o.userData?.clickable === "lamp") return { lamp: true };
      o = o.parent;
    }
  }
  return null;
}

function onClick(e) {
  // Arrastar para girar não pode virar clique. O limite é generoso de
  // propósito: com 2px, tremer a mão ao clicar num alvo engolia o clique e
  // não dava para escolher quem roubar.
  if (orbit.andou > ARRASTE_MIN) {
    orbit.andou = 0;
    return;
  }
  onPointerMove(e);
  const hit = pick();
  if (!hit) return;

  if (hit.lamp) {
    // clique seco, sem arrastar: dá um tapa e ela sai balançando
    lampFis.vz += 0.9;
    lampKick.t = performance.now() + 2600;
    return;
  }
  if (hit.pid && targets && targets.has(hit.pid) && onPickTarget) {
    onPickTarget(hit.pid);
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function init(el, opts = {}) {
  container = el;
  disposed = false;
  onPickTarget = opts.onPickTarget || null;
  onLamp = opts.onLamp || null;
  onLook = opts.onLook || null;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(el.clientWidth || 800, el.clientHeight || 600);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(
    aj("camAbertura", 64),
    (el.clientWidth || 800) / (el.clientHeight || 600),
    0.1,
    100,
  );

  buildRoom();
  buildLamp();

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointerleave", onPointerUp);
  renderer.domElement.addEventListener("dblclick", onDblClick);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("click", onClick);

  clock = new THREE.Clock();
  animate();
}

// Quem ganhou. Passar null encerra a comemoração e a câmera volta.
export function vencedor(pid) {
  vencedorId = pid || null;
}

// Onde, na tela, está a cabeça de um jogador. Serve para o cartão de vitória
// e o confete ficarem em cima dele, em coordenadas de página.
export function telaDe(pid, altura = 2.15) {
  const s = seats.get(pid);
  if (!s || !camera || !renderer) return null;
  const v = new THREE.Vector3(
    s.group.position.x,
    (s.alturaBase ?? 0) + altura,
    s.group.position.z,
  );
  v.project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  return {
    x: r.left + ((v.x + 1) / 2) * r.width,
    y: r.top + ((1 - v.y) / 2) * r.height,
  };
}

// Chamado pela bancada de ajustes quando qualquer número muda.
export function tune() {
  if (!scene) return;
  ajustarMesa();
  ajustarLampada();
  ajustarAssentos();
  // Um número do CORPO mudou: os bonecos são remontados no próximo estado.
  // Zerar a assinatura é o gatilho que o update() já conhece.
  for (const [, st] of seats) st.lookSig = "";
  if (camera) {
    camera.fov = aj("camAbertura", 64);
    camera.updateProjectionMatrix();
  }
  // as posições de carta e ficha na mesa dependem da altura do tampo
  for (const [, st] of seats) st.chipsN = -1;
}

export function resize() {
  if (!renderer || !container) return;
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function respostaDe(state, pid) {
  if (state.phase === "reaction" && state.pendingAction) {
    const v = state.reactions?.[pid];
    if (v === "accept") return { t: "ACEITA", bg: "rgba(20,90,45,.92)" };
    if (v === "contest") return { t: "CONTESTA", bg: "rgba(120,25,25,.92)" };
    if (v === "block") return { t: "BLOQUEIA", bg: "rgba(120,90,10,.92)" };
  }
  if (state.phase === "block_challenge" && state.pendingAction?.block) {
    const v = state.blockChallenges?.[pid];
    if (v === "accept") return { t: "ACEITA", bg: "rgba(20,90,45,.92)" };
    if (v === "contest") return { t: "CONTESTA", bg: "rgba(120,25,25,.92)" };
  }
  return null;
}

// A câmera é recalculada TODO QUADRO, não só quando chega estado novo do
// servidor: senão arrastar para girar só mexia de 250 em 250 ms, aos solavancos.
function posicionaCamera() {
  // Vitória: a câmera sai do meu assento e vai para a frente do vencedor,
  // um pouco acima da mesa, olhando para o rosto dele.
  const vc = vencedorId ? seats.get(vencedorId) : null;
  if (vc) {
    const p = vc.group.position;
    const d = Math.hypot(p.x, p.z) || 1;
    // Longe o bastante para caber o busto inteiro: a 1,5 m a câmera entrava
    // dentro da cabeça dele.
    const fora = 3.1;
    camera.position.set(
      (p.x / d) * (d + fora),
      (vc.alturaBase ?? 0) + 2.25,
      (p.z / d) * (d + fora),
    );
    camera.lookAt(p.x, (vc.alturaBase ?? 0) + 1.45, p.z);
    return;
  }

  const me = seats.get(myId);
  if (!me) {
    camera.position.set(0, 4.6, 6.2);
    camera.lookAt(0, 0.9, 0);
    return;
  }
  const p = me.group.position;
  const k = thirdPerson ? aj("camTercDist", 1.78) : aj("camPrimDist", 1.34);
  const alt = thirdPerson ? aj("camTercAltura", 3.1) : aj("camPrimAltura", 2.12);
  const olha = tampo() + (thirdPerson ? 0.08 : 0);

  // o arraste gira o ponto de vista em volta do centro da mesa, mas só em
  // 3ª pessoa; em 1ª a câmera fica firme no assento
  const giro = thirdPerson ? orbit.yaw : 0;
  const ang = Math.atan2(p.x, p.z) + giro;
  // Trocar de 3ª para 1ª pessoa com o zoom bem aberto deixava o jogador longe,
  // atrás do próprio boneco; o teto é aplicado aqui e não só na roda do mouse.
  orbit.zoom = Math.min(orbit.zoom, zoomTeto());
  const raio = Math.hypot(p.x, p.z) * k * orbit.zoom;
  camera.position.set(
    Math.sin(ang) * raio,
    (alt + orbit.pitch * 1.4) * (0.55 + orbit.zoom * 0.45),
    Math.cos(ang) * raio,
  );

  // Em 1ª pessoa o assento fica no lugar e quem gira é a mira: o ponto para
  // onde olho roda em volta da câmera, dentro do limite do pescoço. Em 3ª a
  // mira é sempre o centro — lá é a mesa que gira.
  if (!thirdPerson && (olhar.yaw || olhar.pitch)) {
    const mira = new THREE.Vector3(0, olha, 0).sub(camera.position);
    mira.applyAxisAngle(EIXO_Y, olhar.yaw);
    // cima e baixo giram em volta do eixo lateral, senão o horizonte tomba
    const lado = new THREE.Vector3(-mira.z, 0, mira.x);
    if (lado.lengthSq() > 1e-6) mira.applyAxisAngle(lado.normalize(), olhar.pitch);
    camera.lookAt(camera.position.clone().add(mira));
  } else {
    camera.lookAt(0, olha, 0);
  }
}

export function update(state, meId, opts = {}) {
  if (!scene) return;
  myId = meId;

  if (opts.theme && opts.theme !== theme) {
    theme = opts.theme;
    applyTheme(theme);
    for (const [, s] of seats) s.sig = ""; // força redesenhar a arte das cartas
  }
  thirdPerson = !!opts.thirdPerson;
  targets = opts.targets && opts.targets.size ? opts.targets : null;
  // cartas que o cliente ainda não deixa revelar
  segredo = new Set(opts.segredo || []);

  // Entrei agora numa sala onde a lâmpada já estava balançando: entra no
  // balanço em vez de nascer com o abajur reto enquanto os outros o veem
  // torto. Só na primeira vez — depois quem manda são os recados de "lamp".
  if (!lampPronta && state?.lamp) {
    lampPronta = true;
    lampadaDeFora(state.lamp);
  }

  // Antes de começar, o cliente manda quem está SENTADO em vez de quem está
  // em jogo: a mesa mostra a sala se formando, sem carta nem moeda.
  const players = opts.mesa || state?.playersInGame || [];
  const ids = new Set(players.map((p) => p.id));

  let mudouMesa = false;
  for (const [id, s] of seats) {
    if (!ids.has(id)) {
      scene.remove(s.group);
      seats.delete(id);
      mudouMesa = true;
    }
  }

  const meIdx = players.findIndex((p) => p.id === meId);
  const order =
    meIdx >= 0 ? players.slice(meIdx).concat(players.slice(0, meIdx)) : players;

  order.forEach((p, i) => {
    let s = seats.get(p.id);
    if (!s) {
      s = buildSeat(p, i, order.length);
      seats.set(p.id, s);
      mudouMesa = true;
    }
    // entrou ou saiu gente: o círculo inteiro se redistribui
    if (s.total !== order.length || s.idx !== i) mudouMesa = true;
    s.idx = i;
    s.total = order.length;

    // trocou o visual no perfil: reconstrói o corpo
    const ls = lookSig(p);
    if (s.lookSig !== ls) {
      s.lookSig = ls;
      s.group.remove(s.body);
      s.body = buildCharacter({
        color: p.color ?? 0,
        look: p.look,
        seed: s.idx,
      });
      s.group.add(s.body);
      s.ring.material.color.set(COLORS[(p.color ?? 0) % COLORS.length]);
    }

    const cor = "#" + COLORS[(p.color ?? 0) % COLORS.length].toString(16).padStart(6, "0");
    // no lobby a placa troca as moedas pelo aviso de pronto
    const etiqueta = p.lobby ? (p.ready ? "PRONTO" : "NÃO PRONTO") : null;
    const placaSig = `${p.nick}|${p.coins}|${cor}|${etiqueta}`;
    if (s.placaSig !== placaSig) {
      s.placaSig = placaSig;
      s.plate.userData.set(p.nick, p.coins, cor, etiqueta);
    }
    if (s.fotoSig !== (p.avatar || "")) {
      s.fotoSig = p.avatar || "";
      s.plate.userData.setFoto(p.avatar || null);
    }
    updateChips(s, p.lobby ? 0 : p.coins);
    updateCards(s, p);
    // no lobby ninguém recebeu carta ainda
    s.cartas.visible = !p.lobby;

    const current = state.phase === "turn" && state.currentPlayerId === p.id;
    s.isCurrent = current;

    // Para onde a cabeça dele aponta. A minha sai da câmera agora, sem
    // esperar a volta do servidor; a dos outros vem do estado (e dos recados
    // de "look", que chegam entre um estado e outro).
    s.olharAlvo =
      p.id === meId ? meuOlhar() : trava(Number(p.yaw) || 0, OLHAR_MAX);

    // As minhas etiquetas flutuantes ficam SEMPRE escondidas: usam
    // depthTest:false e a câmera é a mais perto delas, então viravam letras
    // gigantes cobrindo a tela (em 1ª pessoa coladas na lente, em 3ª logo à
    // frente). O HUD no canto mostra tudo isso sem atrapalhar a cena.
    const souEu = p.id === meId;

    if (current && state.turnEndsAt) {
      const txt = window.UI.timeLeft(state.turnEndsAt);
      if (s.timeTxt !== txt) {
        s.timeTxt = txt;
        const urg = window.UI.secsLeft(state.turnEndsAt) <= 10;
        s.timeLbl.userData.redraw(`⏱ ${txt}`, urg ? "#ff5555" : "#ffd400", null);
      }
      s.timeLbl.visible = !souEu;
    } else {
      s.timeLbl.visible = false;
      s.timeTxt = "";
    }

    const r = respostaDe(state, p.id);
    if (r) {
      if (s.respTxt !== r.t) {
        s.respTxt = r.t;
        s.respLbl.userData.redraw(r.t, "#ffffff", r.bg);
      }
      s.respLbl.visible = !souEu;
    } else {
      s.respLbl.visible = false;
      s.respTxt = "";
    }

    s.isTarget = !!(targets && targets.has(p.id));
    if (!s.isTarget && !current) s.ring.material.opacity = 0;
    if (!s.isTarget)
      s.ring.material.color.set(COLORS[(p.color ?? 0) % COLORS.length]);

    // O corpo fica visível para todo mundo, inclusive para mim em 1ª pessoa:
    // são os MEUS braços e mãos na mesa, e sem eles a cena parecia um drone
    // pairando sobre a cadeira. Quem decide o que some é o laço de animação,
    // que sabe onde a câmera está neste quadro (ver "meu próprio corpo" lá).
    s.body.visible = true;
    s.plate.visible = !souEu;
    // o balão some sozinho depois do tempo — e nunca fica no meu assento,
    // mesmo que eu já tivesse um na tela quando virei "eu" (troca de aba,
    // reconexão): ele viraria um letreiro colado na lente
    if (souEu || (s.chatLbl.visible && (s.chatAte || 0) < performance.now()))
      s.chatLbl.visible = false;
    s.chips.visible = true;
    s.ring.visible = true;
    s.euMesmo = souEu;

    // O tombo e a cor cinza esperam a carta terminar de virar: o corpo
    // caindo antes da revelação já contava o final.
    const morto = p.aliveCount <= 0 && !assentoOculto(p.id);

    s.body.position.y = (s.alturaBase ?? 0) + (morto ? -0.25 : 0);

    // Quem perdeu as duas cartas fica sem cor: dá para ver de longe quem já
    // saiu, sem ter de contar carta virada.
    if (s.apagado !== morto) {
      s.apagado = morto;
      s.body.traverse((o) => {
        const m = o.material;
        if (!m || !m.color) return;
        if (!m.userData.corViva) m.userData.corViva = m.color.clone();
        if (morto) {
          const c = m.userData.corViva;
          const cinza = (c.r + c.g + c.b) / 3;
          m.color.setRGB(cinza * 0.42, cinza * 0.42, cinza * 0.46);
        } else {
          m.color.copy(m.userData.corViva);
        }
      });
    }
  });

  // Posições de assento, carta e ficha saem todas dos ajustes; sem isto, um
  // assento recém-criado nascia com as cartas no (0,0,0), dentro do pé da
  // mesa, e sumiam da vista.
  if (mudouMesa) ajustarAssentos();

  posicionaCamera();
  // para onde eu estou olhando vai para a sala: é o que faz a cabeça do meu
  // boneco virar na tela dos outros
  mandarOlhar();

  if (deckMesh) deckMesh.visible = (state?.deckCount ?? 0) > 0;
}

// Símbolo que sobe acima da placa do jogador: o 13 do "faz o L", a
// interrogação do "será?". Fica ACIMA do nome para não tapar a cara.
function popSymbol(seat, txt, cor, ms) {
  // O canvas do rótulo é 4:1; um sprite quadrado esticava o "13" e o "?"
  // na vertical e saía um borrão.
  const spr = makeLabel(txt, cor, 2.4, 0.6);
  spr.position.set(0, 2.82, 0);
  seat.group.add(spr);
  pops.push({ spr, grupo: seat.group, nasceu: performance.now(), dur: ms });
}

// Gota de suor ao lado da cabeça. Desenhada como geometria e não como emoji:
// emoji depende da fonte da máquina, e aqui já levamos um tofu por isso.
function popGota(seat, ms) {
  // Grande e acesa de propósito: na distância de jogo, uma gota "realista"
  // some. A sala é escura, então ela precisa brilhar sozinha.
  const gota = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0xa8e0ff,
      roughness: 0.1,
      transparent: true,
      opacity: 0.95,
      emissive: 0x4aa8e0,
      emissiveIntensity: 1.4,
    }),
  );
  gota.scale.set(0.85, 1.5, 0.85);
  gota.position.set(0.24, 1.9, 0.08);
  seat.group.add(gota);
  pops.push({ spr: gota, grupo: seat.group, nasceu: performance.now(), dur: ms, gota: true });
}

// Fala acima do ombro, por um tempo. Serve para o chat escrito e para o
// texto do chat rápido ("Mentira!", "Nice!", "filha da puta"...).
//
// O MEU balão nunca aparece para mim. O sprite fica no meu assento, que em
// 1ª pessoa é onde está a câmera: as letras colavam na lente e tapavam a
// tela inteira toda vez que eu mandava um chat rápido. No 2D continua
// aparecendo, porque lá o balão fica ao lado do card e não atrapalha.
export function speak(pid, txt, ms = 3200) {
  if (pid === myId) return;
  const s = seats.get(pid);
  if (!s || !txt) return;
  s.chatLbl.userData.redraw(txt.slice(0, 26), "#ffffff", "rgba(10,16,26,.92)");
  s.chatLbl.visible = true;
  s.chatAte = performance.now() + ms;
}

export function emote(ev) {
  const s = seats.get(ev.playerId);
  if (!s) return;
  const now = performance.now();
  const b = s.body.userData;

  switch (ev.kind) {
    case "bang":
      shakeUntil.t = now + 900;
      lampKick.t = now + 1800;
      lampFis.vz += 0.55; // a mesa treme e a lâmpada sente
      b.gesto = { nome: "bang", ate: now + 900, dur: 900 };
      for (const [, o] of seats)
        o.cards.forEach((c) => (c.userData.jump = now + 700));
      break;

    case "clap":
      // larga a carta na mesa e bate palma com as duas
      b.gesto = { nome: "clap", ate: now + 1800, dur: 1800 };
      break;

    case "finger":
      b.gesto = { nome: "dedo", ate: now + 2400, dur: 2400 };
      break;

    case "thumbs":
      b.gesto = { nome: "joinha", ate: now + 2200, dur: 2200 };
      break;

    case "l13":
      b.gesto = { nome: "ele", ate: now + 2600, dur: 2600 };
      popSymbol(s, "13", "#ff3b3b", 2600);
      break;

    case "think":
      popSymbol(s, "?", "#ffd400", 2200);
      break;

    case "laugh":
      b.rir = now + 2400;
      break;

    case "sweat":
      popGota(s, 2200);
      break;

    case "lie":
      // nariz de Pinóquio: cresce e volta
      b.nariz = now + 2600;
      break;
  }
}

function animate() {
  if (disposed) return;
  raf = requestAnimationFrame(animate);

  const t = clock.getElapsedTime();
  const nowMs = performance.now();

  posicionaCamera();

  // lâmpada: balanço lento; mais forte se alguém a empurrou ou bateu na mesa
  if (lampPivot) {
    const kick = Math.max(0, (lampKick.t - nowMs) / 2600);

    // Pêndulo: a gravidade puxa de volta com força proporcional ao ângulo, e
    // o freio tira energia devagar. Fio mais comprido balança mais devagar,
    // como na vida real.
    const dt = Math.min(0.05, (nowMs - (lampFis.t0 || nowMs)) / 1000);
    lampFis.t0 = nowMs;

    // a física só roda quando ninguém está com a mão no abajur — nem aqui,
    // nem na tela de quem está do outro lado
    if (!lampDrag.ativo && nowMs >= lampSeguradaAte) {
      const fio = Math.max(0.2, aj("lampadaFio", 1.5));
      const w2 = 9.81 / fio;
      const freio = Math.exp(-aj("lampadaAmortece", 0.3) * dt);

      lampFis.vz = (lampFis.vz - w2 * lampFis.z * dt) * freio;
      lampFis.vx = (lampFis.vx - w2 * lampFis.x * dt) * freio;
      lampFis.z += lampFis.vz * dt;
      lampFis.x += lampFis.vx * dt;

      // uma corrente de ar de nada, para ela nunca ficar parada de vez
      lampFis.vz += Math.sin(t * 0.37) * 0.0022;
      lampFis.vx += Math.cos(t * 0.29) * 0.0014;
    }

    lampPivot.rotation.z = lampFis.z;
    lampPivot.rotation.x = lampFis.x;

    // A POÇA DE LUZ acompanha o abajur.
    //
    // Antes o alvo do foco era um ponto fixo 4 m abaixo do abajur, filho da
    // própria lâmpada. Na conta, inclinar o pendente 0,3 rad movia a poça uns
    // 30 cm num cone larguíssimo e bem suave: na mesa não dava para perceber
    // nada, e a sensação era de lâmpada balançando com a luz pregada no lugar.
    // Agora o alvo é calculado no TAMPO, onde a luz de fato bate, e o alcance
    // do passeio é um número da bancada.
    const ondeBate = aj("luzPasseio", 3.2);
    const alvoX = Math.sin(lampFis.z) * ondeBate;
    const alvoZ = -Math.sin(lampFis.x) * ondeBate;
    if (lampLight) {
      // o alvo é filho da cena, não da lâmpada: assim ele fica onde a luz
      // aponta de verdade em vez de girar junto e nunca sair do lugar
      lampLight.target.position.set(alvoX, tampo(), alvoZ);
      lampLight.target.updateMatrixWorld();
    }
    // O rebote é a luz que o feltro devolve nos rostos e nas paredes: ele
    // mora onde a poça está, senão a sala continuava iluminada por igual e só
    // o chão mudava.
    if (bounceLight) {
      bounceLight.position.x = alvoX * 0.55;
      bounceLight.position.z = alvoZ * 0.55;
    }

    // Mau contato: de tempos em tempos a luz pisca algumas vezes seguidas.
    let falha = 1;
    if (aj("piscaLigado", 1) >= 0.5) {
      const ciclo = Math.max(2, aj("piscaCada", 7));
      const dentro = t % ciclo;
      const quantas = Math.max(1, Math.round(aj("piscaQuantas", 3)));
      const crise = quantas * 0.16; // dura pouco: é um susto, não um apagão
      if (dentro < crise) {
        const piscada = Math.floor(dentro / 0.16);
        const meio = (dentro % 0.16) / 0.16;
        // apaga rápido e volta, com a última piscada mais demorada
        if (piscada < quantas && meio < 0.55)
          falha = 1 - aj("piscaForca", 0.78) * (0.6 + Math.random() * 0.4);
      }
    }

    if (lampLight)
      lampLight.intensity = aj("luzForca", 42) * (1 + kick * 0.4) * falha;
    if (bounceLight)
      bounceLight.intensity = aj("luzRebote", 13) * (1 + kick * 0.35) * falha;
    if (lampBulb) lampBulb.material.color.setScalar(falha > 0.6 ? 1 : 0.35);
  }

  if (table) {
    const left = shakeUntil.t - nowMs;
    if (left > 0) {
      const k = (left / 900) * 0.035;
      table.position.x = Math.sin(nowMs * 0.05) * k;
      table.position.z = Math.cos(nowMs * 0.043) * k;
    } else table.position.x = table.position.z = 0;
  }

  // símbolos de gesto subindo e sumindo
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    const k = (nowMs - p.nasceu) / p.dur;
    if (k >= 1) {
      p.grupo.remove(p.spr);
      p.spr.material?.dispose?.();
      pops.splice(i, 1);
      continue;
    }
    if (p.gota) {
      // a gota escorre para baixo
      p.spr.position.y = 1.9 - k * 0.34;
      p.spr.material.opacity = 0.95 * (1 - k);
    } else {
      p.spr.position.y = 2.82 + k * 0.5;
      p.spr.material.opacity = k < 0.75 ? 1 : (1 - k) * 4;
    }
  }

  // cartas virando na mesa
  if (virando.size) passoDasViradas(1 / 60);

  // moedas e cartas em trânsito
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.t += 1 / 60;
    if (f.t < 0) continue;
    const k = Math.min(1, f.t / f.dur);
    f.m.position.lerpVectors(f.from, f.to, k);
    f.m.position.y += Math.sin(k * Math.PI) * f.arc;
    if (f.spin) f.m.rotation.y = k * Math.PI * 2;
    if (k >= 1) {
      scene.remove(f.m);
      flying.splice(i, 1);
    }
  }

  for (const [, s] of seats) {
    s.body.rotation.z = Math.sin(t * 0.8 + s.group.position.x) * 0.012;

    // ---- meu próprio corpo em 1ª pessoa ----
    //
    // Fica SÓ o par de braços. Tronco, ombros, quadril, gola, pescoço e cabeça
    // saem todos: em primeira pessoa eu não enxergo o meu próprio peito, e
    // deixá-lo na tela era um boneco de costas ocupando o meio da mesa.
    //
    // A varredura é pelos filhos do corpo em vez de uma lista de nomes: peça
    // nova que eu acrescente ao boneco já nasce escondida aqui, em vez de
    // aparecer sozinha na lente até alguém lembrar de listá-la.
    if (s.euMesmo) {
      const soBracos = !thirdPerson;
      const bracos = s.body.userData.arms;
      for (const parte of s.body.children)
        parte.visible = !soBracos || parte === bracos;
    }

    // suspense: as cartas do jogador tremem enquanto a mesa espera a virada
    if (s.tremeAte) {
      if (performance.now() < s.tremeAte) {
        s.cartas.rotation.z = Math.sin(t * 34) * 0.05;
      } else {
        s.tremeAte = 0;
        s.cartas.rotation.z = 0;
      }
    }

    // Na vez do jogador a ROUPA acende e pulsa na cor dele. O cilindro de
    // luz que havia antes em volta do corpo ficava feio e sujava a cena.
    const sm = s.body.userData.shirtMat;
    if (sm) {
      const forca = aj("roupaForca", 0.8);
      const vel = aj("roupaVel", 3.4);
      const alvo = s.isCurrent ? forca * (0.55 + Math.sin(t * vel) * 0.45) : 0;
      sm.emissive.copy(s.body.userData.shirtColor);
      sm.emissiveIntensity += (alvo - sm.emissiveIntensity) * 0.14;
    }

    // O anel no chão marca SÓ quem pode ser escolhido como alvo. Quem está
    // na vez já se anuncia pela roupa acesa; o anel aceso junto virava um
    // segundo aviso, e pior: não havia nada que o apagasse depois.
    if (s.ring) {
      if (s.isTarget) {
        s.ring.material.color.setHex(0xff3b3b);
        s.ring.material.opacity = 0.5 + Math.sin(t * 6) * 0.35;
      } else {
        s.ring.material.opacity = 0;
      }
    }

    const prop = s.body.userData.prop;
    const puffs = prop?.userData?.puffs;
    if (puffs) {
      for (const puff of puffs) {
        const ph = (t * 0.28 + puff.userData.phase) % 1;
        puff.position.y = 0.05 + ph * 0.55;
        puff.position.x = 0.02 + Math.sin(ph * 6 + puff.userData.phase * 9) * 0.05;
        puff.scale.setScalar(0.6 + ph * 1.9);
        puff.material.opacity = 0.2 * (1 - ph);
      }
      if (prop.userData.ember)
        prop.userData.ember.material.color.setHSL(
          0.05,
          1,
          0.45 + Math.sin(t * 2.2) * 0.12,
        );
    }

    // Braços: o ESQUERDO segura a carta; o DIREITO faz os gestos.
    const arms = s.body.userData.arms;
    if (arms) {
      const L = arms.children[0];
      const R = arms.children[1];
      const g = s.body.userData.gesto;
      const ativo = g && g.ate > nowMs ? g : null;

      // descanso: tudo zerado, mãos na mesa
      for (const a of [L, R]) {
        a.rotation.set(0, 0, 0);
        a.position.x = a.userData.x0 ?? 0;
        if (a.userData.elbow) a.userData.elbow.rotation.set(0, 0, 0);
        if (a.userData.hand) {
          a.userData.hand.rotation.set(-0.35, 0, 0);
          poseHand(a.userData.hand, "aberta");
        }
      }

      if (ativo) {
        // k sobe de 0 a 1 no começo do gesto: o braço não teleporta
        const k = Math.min(1, (ativo.dur - (ativo.ate - nowMs)) / 420);
        const eR = R.userData.elbow;
        const mR = R.userData.hand;

        if (ativo.nome === "bang") {
          const b = Math.abs(Math.sin(nowMs * 0.022));
          L.rotation.x = -0.55 * b;
          R.rotation.x = -0.55 * b;
          poseHand(L.userData.hand, "punho");
          poseHand(mR, "punho");
        } else if (ativo.nome === "clap") {
          const d = Math.abs(Math.sin(nowMs * 0.018)) * 0.16;
          L.rotation.x = -0.5;
          R.rotation.x = -0.5;
          L.position.x = (L.userData.x0 ?? 0) + 0.14 + d;
          R.position.x = (R.userData.x0 ?? 0) - 0.14 - d;
        } else if (ativo.nome === "dedo") {
          // Braço ESTICADO na cara de quem está do outro lado. Parado, com o
          // cotovelo dobrado, não lia como gesto nenhum.
          //
          // Em repouso o braço faz um L: úmero para baixo, antebraço na
          // horizontal. Girar o ombro -1.02 deita o úmero para a frente, e o
          // cotovelo +1.02 desfaz a dobra — aí o braço fica reto.
          const empurra = Math.sin(nowMs * 0.012) * 0.14; // estoca e volta
          R.rotation.x = (-1.02 + empurra) * k;
          R.rotation.z = -0.1 * k;
          if (eR) eR.rotation.x = 1.02 * k;
          if (mR) {
            mR.rotation.set(-0.35 - 1.2 * k, 0, 0); // dedo apontando para cima
            poseHand(mR, "dedo");
          }
        } else if (ativo.nome === "joinha") {
          // mesmo braço reto, mão de lado e polegar para cima
          const empurra = Math.sin(nowMs * 0.009) * 0.1;
          R.rotation.x = (-0.95 + empurra) * k;
          R.rotation.z = -0.2 * k;
          if (eR) eR.rotation.x = 0.95 * k;
          if (mR) {
            // sem inclinar a mão: o polegar já sobe sozinho pelo pivô, e
            // torcer o pulso jogava ele para trás
            mR.rotation.set(-0.35 - 0.15 * k, 0, 0);
            poseHand(mR, "joinha");
          }
        } else if (ativo.nome === "ele") {
          // mão LEVANTADA ao lado da cabeça fazendo o L, palma para a frente
          R.rotation.x = -2.15 * k;
          R.rotation.z = -0.28 * k;
          if (eR) eR.rotation.x = 0.2 * k;
          if (mR) {
            mR.rotation.set(-0.35 + 0.25 * k, 0, 0);
            poseHand(mR, "ele");
          }
        }
      }
    }

    // Rir: a boca abre e fecha e a cabeça joga para trás. Só a boca, a essa
    // distância, era um pontinho que ninguém via.
    const rindo = (s.body.userData.rir || 0) > nowMs;
    const mouth = s.body.userData.mouth;
    if (mouth) {
      const bat = Math.abs(Math.sin(nowMs * 0.019));
      const alvo = rindo ? 3 + bat * 5.5 : 1;
      mouth.scale.y += (alvo - mouth.scale.y) * 0.3;
      mouth.scale.x += ((rindo ? 1.5 : 1) - mouth.scale.x) * 0.3;
    }

    // A cabeça no pescoço: vira para os lados (para onde a pessoa olha) e
    // joga para trás quando ri. Antes a risada girava só a esfera do crânio e
    // o rosto ficava parado — agora rosto, cabelo e chapéu vão junto.
    const cabeca = s.body.userData.cabeca;
    if (cabeca) {
      // A MINHA cabeça sai da câmera a cada quadro, não do estado: esperar o
      // próximo pacote do servidor deixava o meu boneco olhando para o lado
      // errado enquanto eu já tinha girado a mesa.
      const alvoY = s.id === myId ? meuOlhar() : s.olharAlvo || 0;
      cabeca.rotation.y += (alvoY - cabeca.rotation.y) * 0.16;
      const alvoX = rindo ? -0.3 - Math.abs(Math.sin(nowMs * 0.019)) * 0.18 : 0;
      cabeca.rotation.x += (alvoX - cabeca.rotation.x) * 0.25;
    }

    // mentira: o nariz cresce e volta
    const nose = s.body.userData.nose;
    if (nose) {
      const left = (s.body.userData.nariz || 0) - nowMs;
      const cresc = left > 0 ? Math.sin((1 - left / 2600) * Math.PI) : 0;
      // bem exagerado: é piada de Pinóquio, tem de dar para ver da outra
      // ponta da mesa
      nose.scale.set(1 + cresc * 0.8, 1 + cresc * 7.5, 1 + cresc * 0.8);
      nose.position.z = 0.163 + cresc * 0.26;
    }

    // batida na mesa: as cartas deitadas dão um pulinho
    s.cards.forEach((c, i) => {
      const left = (c.userData.jump || 0) - nowMs;
      c.position.z =
        left > 0 ? Math.abs(Math.sin(left * 0.02)) * 0.08 * (left / 700) : i * 0.002;
    });
  }

  // Comemoração: a câmera está colada no vencedor, e qualquer etiqueta
  // (placa, cronômetro, resposta, balão) usa depthTest:false — pertinho da
  // lente vira um letreiro tapando a tela. Quem ganhou já está escrito no
  // cartão que aparece acima dele.
  if (vencedorId) {
    for (const [, s] of seats) {
      s.plate.visible = false;
      s.timeLbl.visible = false;
      s.respLbl.visible = false;
      s.chatLbl.visible = false;
    }
  }

  // a lâmpada avisa que dá para pegar
  if (!targets && !orbit.dragging && !lampDrag.ativo) {
    const h = pick();
    const cur = h?.lamp ? "grab" : "";
    if (renderer.domElement.style.cursor !== cur)
      renderer.domElement.style.cursor = cur;
  }

  // destaque de quem está sob o mouse na hora de escolher alvo
  if (targets) {
    const hit = pick();
    const novo = hit?.pid && targets.has(hit.pid) ? hit.pid : null;
    if (novo !== hovered) {
      hovered = novo;
      renderer.domElement.style.cursor = novo ? "pointer" : "";
    }
    for (const [pid, s] of seats)
      s.body.scale.setScalar((s.escala ?? 1) * (pid === hovered ? 1.06 : 1));
  } else if (hovered) {
    hovered = null;
    renderer.domElement.style.cursor = "";
    for (const [, s] of seats) s.body.scale.setScalar(s.escala ?? 1);
  }

  renderer.render(scene, camera);
}

export function dispose() {
  disposed = true;
  cancelAnimationFrame(raf);
  if (renderer) {
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointerleave", onPointerUp);
    renderer.domElement.removeEventListener("dblclick", onDblClick);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("click", onClick);
    renderer.dispose();
    if (renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  seats.clear();
  flying.length = 0;
  virando.clear();
  // a cena morreu: a próxima precisa pegar a lâmpada da sala de novo
  lampPronta = false;
  lampSeguradaAte = 0;
  renderer = scene = camera = null;
}

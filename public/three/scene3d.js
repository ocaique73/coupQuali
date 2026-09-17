// Cena 3D da mesa (Three.js, módulo ES).
//
// Não conhece regra de jogo: recebe o MESMO state do cliente 2D e desenha.
// Tudo que o jogo precisa para ser jogável no 3D passa por aqui — escolher
// alvo clicando no personagem, cronômetro da vez, respostas ao lado de cada
// um, esconder cartas, terceira pessoa, tema e gestos do chat rápido.
//
// API:
//   init(el, { onPickTarget })
//   update(state, myId, opts)   opts: { theme, hideCards, thirdPerson, targets }
//   emote(ev) / gameEvent(ev) / resize() / dispose()

import * as THREE from "three";

const ARM_X = 0.29; // distância do ombro ao centro do corpo
const COLORS = [0x3aa6ff, 0x2dd36f, 0xff6ad5, 0xff9d3a, 0xa78bfa, 0x22d3ee];

// feltro e brilho da lâmpada por tema (o 2D já muda; aqui acompanha)
const THEME_TABLE = {
  politica: { felt: 0x1f5c35, glow: 0xffc987, rim: 0x3a2412 },
  qualitas: { felt: 0xa8521a, glow: 0xffb56b, rim: 0x4a2408 },
};

let renderer, scene, camera, clock, myHand;
let container = null;
let lampPivot, lampLight, bounceLight, ambLight;
let lampCord, lampBody, lampShade, lampBulb;
let table, tableTop, tableRim, tableBase, deckMesh, bankGroup;
let raf = 0;
let disposed = false;
let onPickTarget = null;

const seats = new Map(); // playerId -> refs
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

let myId = null;
let theme = "politica";
let hideCards = false;
let thirdPerson = false;
let targets = null; // Set de ids clicáveis, ou null
let vencedorId = null; // enquanto dura a comemoração, a câmera fica nele
let hovered = null;

const shakeUntil = { t: 0 };
const lampKick = { t: 0 };
// Empurrar a lâmpada com a mão: enquanto está segura ela obedece ao ponteiro,
// e ao soltar volta a balançar sozinha a partir do ângulo onde parou.
const lampDrag = { ativo: false, x: 0, z: 0, lx: 0, ly: 0, fase: 0 };
const LAMP_MAX = 0.55; // até onde dá para empurrar, em radianos
const flying = []; // moedas/cartas em movimento pela mesa
const pops = []; // símbolos de gesto subindo acima do jogador

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
// Girar vale SÓ em 3ª pessoa. Em 1ª pessoa a câmera é o olho do jogador
// sentado; girar dava a impressão de ter trocado de lugar na mesa.
const orbit = {
  yaw: 0,
  pitch: 0,
  zoom: 1,
  dragging: false,
  lx: 0,
  ly: 0,
  andou: 0, // pixels percorridos desde que apertou
};
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
  lampLight.target.position.set(0, -4, 0);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lamp.add(lampLight);
  lamp.add(lampLight.target);

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

  const hips = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27 * W, 0.3 * W, 0.2, 18),
    darkMat,
  );
  hips.position.y = 0.84;
  hips.castShadow = true;
  g.add(hips);

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3 * W, 0.23 * W, 0.52, 22),
    shirtMat,
  );
  torso.position.y = 1.2;
  torso.castShadow = true;
  g.add(torso);

  if (gordo) {
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.29, 18, 14), shirtMat);
    belly.scale.set(1.12, 0.78, 0.9);
    belly.position.set(0, 1.06, 0.06);
    belly.castShadow = true;
    g.add(belly);
  }

  for (const sx of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.115 * W, 14, 12), shirtMat);
    sh.position.set(sx * ARM_X * W, 1.43, 0);
    sh.castShadow = true;
    g.add(sh);
  }

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.17, 0.09, 16),
    shirtMat,
  );
  collar.position.y = 1.5;
  g.add(collar);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.12, 12),
    skinMat,
  );
  neck.position.y = 1.56;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 26, 22), skinMat);
  head.scale.set(0.92, 1.1, 0.96);
  head.position.y = 1.74;
  head.castShadow = true;
  g.add(head);

  g.userData.head = head;

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat);
    ear.scale.set(0.5, 1, 0.7);
    ear.position.set(sx * 0.152, 1.74, 0);
    g.add(ear);
  }

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 10), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.73, 0.163);
  g.add(nose);
  g.userData.nose = nose; // cresce no gesto de "mentira"

  const eyeW = new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.25 });
  const eyeD = new THREE.MeshStandardMaterial({ color: 0x1b1410, roughness: 0.15 });
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), eyeW);
    w.scale.set(1, 0.72, 0.6);
    w.position.set(sx * 0.062, 1.79, 0.146);
    g.add(w);

    const d = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 10, 8), eyeD);
    d.position.set(sx * 0.062, 1.79, 0.167);
    g.add(d);

    const br = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.013, 0.02), hairMat);
    br.position.set(sx * 0.062, 1.829, 0.151);
    br.rotation.z = sx * 0.12;
    g.add(br);
  }

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.012, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 0.5 }),
  );
  mouth.position.set(0, 1.676, 0.152);
  g.add(mouth);
  g.userData.mouth = mouth; // abre e fecha no gesto de rir

  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), skinMat);
  chin.scale.set(1, 0.6, 0.85);
  chin.position.set(0, 1.645, 0.06);
  g.add(chin);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.178, 24, 18, 0, Math.PI * 2, 0, Math.PI / 1.85),
    hairMat,
  );
  hair.scale.set(0.95, 1.1, 1);
  hair.position.y = 1.757;
  g.add(hair);

  const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), hairMat);
  fringe.position.set(0, 1.85, 0.118);
  g.add(fringe);

  // Braço ESQUERDO segura as cartas; o DIREITO fica livre para os gestos.
  //
  // Cada braço tem DOIS pivôs: o ombro (o grupo do braço) e o cotovelo. Com
  // os dois em zero a pose é a de sempre — mão apoiada na mesa. Girar o
  // cotovelo é o que faz o braço ESTICAR nos gestos, em vez de o boneco só
  // levantar o conjunto todo duro.
  const arms = new THREE.Group();
  const maos = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();

    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07 * W, 0.24, 4, 10),
      shirtMat,
    );
    upper.position.set(0, -0.1, 0.05);
    upper.rotation.x = -0.55;
    upper.castShadow = true;
    arm.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.2, 0.16);
    arm.add(elbow);

    // manga longa cobre o antebraço; curta deixa a pele à mostra
    const fore = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.058 * W, 0.24, 4, 10),
      mangaLonga ? shirtMat : skinMat,
    );
    fore.position.set(0, 0.01, 0.12);
    fore.rotation.x = -1.25;
    fore.castShadow = true;
    elbow.add(fore);

    if (mangaLonga) {
      const punho = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062 * W, 0.062 * W, 0.03, 12),
        darkMat,
      );
      punho.rotation.x = -1.25;
      punho.position.set(0, -0.025, 0.235);
      elbow.add(punho);
    }

    const hand = buildHand(skinMat);
    hand.position.set(0, -0.035, 0.28);
    hand.rotation.x = -0.35;
    elbow.add(hand);
    arm.userData.hand = hand;
    arm.userData.elbow = elbow;
    maos.push(hand);

    arm.position.set(sx * ARM_X * W, 1.43, 0);
    arm.userData.x0 = sx * ARM_X * W; // posição de descanso, respeitando o corpo
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
  g.add(prop);
  g.userData.prop = prop;

  return g;
}

/* ------------------------------------------------------------------ */
/* assentos                                                            */
/* ------------------------------------------------------------------ */

// O jogador local fica no ângulo 0 e os outros se espalham pelo ARCO OPOSTO:
// num círculo completo, quem estivesse a 90° ficaria ao lado da câmera e
// nunca apareceria na tela.
function seatAngle(idx, total) {
  if (idx === 0) return 0;
  const k = total - 1;
  if (k <= 1) return Math.PI;
  const arco = Math.PI * aj("bonecoArco", 0.55);
  const t = (idx - 1) / (k - 1);
  return Math.PI - arco / 2 + t * arco;
}

// Reposiciona e redimensiona os bonecos. Chamado ao montar cada assento e
// toda vez que a bancada mexe num número.
function ajustarAssentos() {
  const r = aj("assentoRaio", 2.62);
  const esc = aj("bonecoEscala", 1);
  const alt = aj("bonecoAltura", 0);
  for (const [, st] of seats) {
    const ang = seatAngle(st.idx, st.total ?? seats.size);
    st.ang = ang;
    st.group.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
    st.group.lookAt(0, 1, 0);
    st.escala = esc;
    st.alturaBase = alt;
    st.body.scale.setScalar(esc);
    st.body.position.y = alt;
  }
}

function lookSig(p) {
  const L = p.look || {};
  return `${p.color}|${L.shirt}|${L.body}|${L.skin}|${L.prop}`;
}

function buildSeat(p, idx, total) {
  const g = new THREE.Group();
  const ang = seatAngle(idx, total);
  const r = aj("assentoRaio", 2.62);
  g.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
  g.lookAt(0, 1, 0);

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

  // as cartas ficam na MÃO ESQUERDA, para a direita sobrar para os gestos
  const hand = new THREE.Group();
  hand.position.set(-ARM_X, 1.2, 0.46);
  hand.rotation.x = -0.28;
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
    card.position.set((i - 0.5) * 0.28, 0, i * 0.004);
    card.castShadow = true;
    hand.add(card);
    refs.cards.push(card);
  }
  g.add(hand);
  refs.hand = hand;

  refs.chips = new THREE.Group();
  refs.chips.position.set(0.5, 1.0, 0.3);
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

function updateCards(seat, p, mine) {
  const esconder = mine && hideCards;
  const sig =
    (p.hand || []).map((c) => `${c.role || "?"}|${c.alive}`).join(",") +
    (esconder ? "|H" : "") +
    "|" +
    theme;
  if (seat.sig === sig) return;
  seat.sig = sig;

  (p.hand || []).forEach((c, i) => {
    const mesh = seat.cards[i];
    if (!mesh) return;

    const show = esconder
      ? c.alive
        ? null
        : c.role
      : mine
        ? c.role
        : c.alive
          ? null
          : c.role;

    if (show) {
      mesh.material.map = cardTexture(cardUrl(show));
      mesh.material.color.set(0xffffff);
    } else {
      mesh.material.map = null;
      mesh.material.color.set(0x16213a);
    }
    mesh.material.needsUpdate = true;
    mesh.rotation.z = c.alive ? 0 : 0.5;
    mesh.material.opacity = c.alive ? 1 : 0.5;
    mesh.material.transparent = !c.alive;
  });
}

/* ------------------------------------------------------------------ */
/* minha mão (presa à câmera)                                          */
/* ------------------------------------------------------------------ */

function buildMyHand() {
  myHand = new THREE.Group();
  // baixa e recuada o bastante para a carta inteira caber no quadro
  myHand.position.set(0, -0.44, -1.38);

  // As minhas mãos segurando as cartas pelas bordas de baixo. Emissivas de
  // propósito: presas à câmera, ficam fora do cone da lâmpada e sem isso
  // apareciam como dois vultos pretos tapando a carta.
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe8b487,
    emissive: 0x6b4a33,
    emissiveIntensity: 0.55,
    roughness: 0.75,
  });
  for (const sx of [-1, 1]) {
    const h = buildHand(skinMat);
    h.scale.setScalar(0.92);
    h.position.set(sx * 0.33, -0.2, 0.1);
    h.rotation.set(-1.25, 0, sx * 0.55);
    myHand.add(h);
  }

  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.45), // 2:3, a proporção da arte
      // Basic de propósito: a sala é escura, mas a minha mão tem de estar
      // sempre legível
      new THREE.MeshBasicMaterial({ color: 0x16213a, side: THREE.DoubleSide }),
    );
    m.position.set((i - 0.5) * 0.34, 0, i * 0.002);
    m.rotation.z = 0; // retas na vertical, sem leque
    m.userData.card = true;
    myHand.add(m);
  }

  camera.add(myHand);
  scene.add(camera); // a câmera precisa estar na cena para os filhos aparecerem
}

function updateMyHand(p) {
  if (!myHand) return;
  const cards = myHand.children.filter((c) => c.userData.card);
  (p?.hand || []).forEach((c, i) => {
    const m = cards[i];
    if (!m) return;
    const show = hideCards ? null : c.role;
    if (show) {
      m.material.map = cardTexture(cardUrl(show));
      m.material.color.set(0xffffff);
    } else {
      m.material.map = null;
      m.material.color.set(hideCards ? 0x2a3550 : 0x16213a);
    }
    m.material.opacity = c.alive ? 1 : 0.45;
    m.material.transparent = !c.alive;
    m.rotation.z = c.alive ? 0 : 0.4;
    m.material.needsUpdate = true;
  });
}

/* ------------------------------------------------------------------ */
/* moedas e cartas atravessando a mesa                                 */
/* ------------------------------------------------------------------ */

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
function seatHand(pid) {
  const s = seats.get(pid);
  if (!s) return bankPos();
  const v = new THREE.Vector3(-ARM_X, 1.25, 0.5);
  s.group.localToWorld(v);
  return v;
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
    const lim = (v) => Math.max(-LAMP_MAX, Math.min(LAMP_MAX, v));
    lampDrag.z = lim(lampDrag.z - dx * 0.004);
    lampDrag.x = lim(lampDrag.x + dy * 0.004);
    return;
  }

  if (orbit.dragging) {
    const dx = e.clientX - orbit.lx;
    const dy = e.clientY - orbit.ly;
    orbit.lx = e.clientX;
    orbit.ly = e.clientY;
    orbit.andou += Math.abs(dx) + Math.abs(dy);
    // sem trava: dá para dar a volta completa na mesa
    orbit.yaw -= dx * 0.005;
    orbit.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbit.pitch + dy * 0.004));
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

  if (!thirdPerson) return; // em 1ª pessoa não se gira
  orbit.dragging = true;
  orbit.andou = 0;
  orbit.lx = e.clientX;
  orbit.ly = e.clientY;
}

function onPointerUp() {
  if (lampDrag.ativo) {
    lampDrag.ativo = false;
    // Solta de onde estava: a fase do balanço é escolhida para o primeiro
    // quadro livre cair no mesmo ângulo, senão a lâmpada dava um salto.
    const amp = 0.055 + 0.2;
    const k = Math.max(-1, Math.min(1, lampDrag.z / amp));
    lampDrag.fase = Math.asin(k) - clock.getElapsedTime() * 2.05;
    // quanto mais longe foi empurrada, mais forte volta
    const forca = Math.min(1, Math.abs(lampDrag.z) / LAMP_MAX);
    lampKick.t = performance.now() + 1200 + forca * 2400;
    lampDrag.z = 0;
    lampDrag.x = 0;
  }
  orbit.dragging = false;
  renderer.domElement.style.cursor = "";
}

// scroll aproxima e afasta
function onWheel(e) {
  e.preventDefault();
  const k = e.deltaY > 0 ? 1.08 : 1 / 1.08;
  orbit.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, orbit.zoom * k));
}

// duplo clique volta a câmera para o lugar
function onDblClick() {
  orbit.yaw = 0;
  orbit.pitch = 0;
  orbit.zoom = 1;
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
    // clique seco, sem arrastar: dá um tapa e ela balança
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
  buildMyHand();

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
    // as minhas cartas ficam presas à lente e tapariam o vencedor
    if (myHand) myHand.visible = false;
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
  const raio = Math.hypot(p.x, p.z) * k * orbit.zoom;
  camera.position.set(
    Math.sin(ang) * raio,
    (alt + orbit.pitch * 1.4) * (0.55 + orbit.zoom * 0.45),
    Math.cos(ang) * raio,
  );
  camera.lookAt(0, olha, 0);
}

export function update(state, meId, opts = {}) {
  if (!scene) return;
  myId = meId;

  if (opts.theme && opts.theme !== theme) {
    theme = opts.theme;
    applyTheme(theme);
    for (const [, s] of seats) s.sig = ""; // força redesenhar a arte das cartas
  }
  hideCards = !!opts.hideCards;
  thirdPerson = !!opts.thirdPerson;
  targets = opts.targets && opts.targets.size ? opts.targets : null;

  // Antes de começar, o cliente manda quem está SENTADO em vez de quem está
  // em jogo: a mesa mostra a sala se formando, sem carta nem moeda.
  const players = opts.mesa || state?.playersInGame || [];
  const ids = new Set(players.map((p) => p.id));

  for (const [id, s] of seats) {
    if (!ids.has(id)) {
      scene.remove(s.group);
      seats.delete(id);
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
    }

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
    updateCards(s, p, p.id === meId);
    // no lobby as mãos ficam vazias: ninguém recebeu carta ainda
    s.hand.visible = !p.lobby;

    const current = state.phase === "turn" && state.currentPlayerId === p.id;
    s.isCurrent = current;

    // As minhas etiquetas flutuantes ficam SEMPRE escondidas: usam
    // depthTest:false e a câmera é a mais perto delas, então viravam letras
    // gigantes cobrindo a tela (em 1ª pessoa coladas na lente, em 3ª logo à
    // frente). O HUD no canto mostra tudo isso sem atrapalhar a cena.
    const souEu = p.id === meId;
    // o corpo some só em 1ª pessoa — em 3ª eu quero me ver na mesa
    const esconderMeuCorpo = souEu && !thirdPerson;

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

    s.body.visible = !esconderMeuCorpo;
    s.hand.visible = !esconderMeuCorpo;
    s.plate.visible = !souEu;
    // o balão some sozinho depois do tempo — e nunca fica no meu assento,
    // mesmo que eu já tivesse um na tela quando virei "eu" (troca de aba,
    // reconexão): ele viraria um letreiro colado na lente
    if (souEu || (s.chatLbl.visible && (s.chatAte || 0) < performance.now()))
      s.chatLbl.visible = false;
    // Em 1ª pessoa a câmera fica DENTRO do meu próprio assento: fichas e halo
    // envolviam a lente e viravam borrões amarelos tapando a tela.
    s.chips.visible = !esconderMeuCorpo;
    s.ring.visible = !esconderMeuCorpo;

    s.body.position.y = (s.alturaBase ?? 0) + (p.aliveCount <= 0 ? -0.25 : 0);
  });

  updateMyHand(players.find((x) => x.id === meId));
  if (myHand) myHand.visible = !thirdPerson && !!seats.get(meId);

  posicionaCamera();

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
      b.gesto = { nome: "bang", ate: now + 900, dur: 900 };
      for (const [, o] of seats)
        o.cards.forEach((c) => (c.userData.jump = now + 700));
      break;

    case "clap":
      // larga a carta na mesa e bate palma com as duas
      b.gesto = { nome: "clap", ate: now + 1800, dur: 1800 };
      s.hand.userData.down = now + 1800;
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
    const amp = 0.055 + kick * 0.2;

    // Enquanto o jogador segura a lâmpada, ela obedece à mão; ao soltar,
    // volta a balançar sozinha a partir de onde estava.
    if (lampDrag.ativo) {
      lampPivot.rotation.z = lampDrag.z;
      lampPivot.rotation.x = lampDrag.x;
    } else {
      lampPivot.rotation.z = Math.sin(t * (0.55 + kick * 1.5) + lampDrag.fase) * amp;
      lampPivot.rotation.x = Math.cos(t * (0.41 + kick * 1.2) + lampDrag.fase) * amp * 0.62;
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

    // Na vez do jogador a ROUPA acende e pulsa na cor dele. O cilindro de
    // luz que havia antes em volta do corpo ficava feio e sujava a cena.
    const sm = s.body.userData.shirtMat;
    if (sm) {
      const alvo = s.isCurrent ? 0.45 + Math.sin(t * 3.4) * 0.35 : 0;
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
    const head = s.body.userData.head;
    if (head) {
      const alvo = rindo ? -0.3 - Math.abs(Math.sin(nowMs * 0.019)) * 0.18 : 0;
      head.rotation.x += (alvo - head.rotation.x) * 0.25;
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

    // ao bater palma, a carta desce para a mesa
    if (s.hand) {
      const down = (s.hand.userData.down || 0) - nowMs;
      s.hand.position.y = down > 0 ? 1.04 : 1.2;
      s.hand.rotation.x = down > 0 ? -1.35 : -0.28;
    }

    s.cards.forEach((c) => {
      const left = (c.userData.jump || 0) - nowMs;
      c.position.y =
        left > 0 ? Math.abs(Math.sin(left * 0.02)) * 0.1 * (left / 700) : 0;
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
  renderer = scene = camera = null;
}

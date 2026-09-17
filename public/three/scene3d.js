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
let lampPivot, lampLight, bounceLight;
let table, tableTop, tableRim, deckMesh;
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
let hovered = null;

const shakeUntil = { t: 0 };
const lampKick = { t: 0 };
const flying = []; // moedas/cartas em movimento pela mesa

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Giro da câmera pelo arraste. É só um deslocamento em volta do MESMO ponto
// de vista: a câmera continua ancorada no assento do jogador, então girar
// não revela a carta de ninguém — ela é desenhada de costas para a mesa.
const orbit = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0, moved: false };
const YAW_MAX = Math.PI * 0.42;
const PITCH_MIN = -0.25;
const PITCH_MAX = 0.55;

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
    new THREE.CylinderGeometry(2.05, 2.05, 0.16, 64),
    new THREE.MeshStandardMaterial({
      color: THEME_TABLE.politica.felt,
      roughness: 0.95,
    }),
  );
  tableTop.position.y = 0.92;
  tableTop.receiveShadow = true;
  table.add(tableTop);

  tableRim = new THREE.Mesh(
    new THREE.TorusGeometry(2.07, 0.09, 16, 64),
    new THREE.MeshStandardMaterial({
      color: THEME_TABLE.politica.rim,
      roughness: 0.6,
    }),
  );
  tableRim.rotation.x = Math.PI / 2;
  tableRim.position.y = 0.95;
  table.add(tableRim);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.7, 0.9, 24),
    new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.8 }),
  );
  base.position.y = 0.45;
  table.add(base);
  scene.add(table);

  deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.12, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x14203a, roughness: 0.7 }),
  );
  deckMesh.position.set(-0.32, 1.06, 0.1);
  deckMesh.castShadow = true;
  table.add(deckMesh);

  const bank = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.025, 20),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0xd9d9d9 : 0xf0b429,
        roughness: 0.35,
        metalness: 0.65,
      }),
    );
    chip.position.set(0.32, 1.02 + i * 0.026, 0.1);
    bank.add(chip);
  }
  table.add(bank);
}

function buildLamp() {
  lampPivot = new THREE.Group();
  lampPivot.position.set(0, 4.4, 0);
  scene.add(lampPivot);

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0a }),
  );
  cord.position.y = -0.75;
  lampPivot.add(cord);

  const lamp = new THREE.Group();
  lamp.position.y = -1.5;

  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.4, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2b2b30,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  shade.rotation.x = Math.PI;
  shade.userData.clickable = "lamp";
  lamp.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  bulb.position.y = -0.14;
  bulb.userData.clickable = "lamp";
  lamp.add(bulb);

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
  bounceLight.position.set(0, 1.35, 0);
  scene.add(bounceLight);

  scene.add(new THREE.AmbientLight(0x3a3355, 1.0));
  const fill = new THREE.PointLight(0x5a4a80, 8, 16);
  fill.position.set(0, 3.4, 0);
  scene.add(fill);
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

const faceCache = new Map();
function faceTexture(url) {
  if (!faceCache.has(url)) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const t = loader.load(url, undefined, undefined, () =>
      faceCache.set(url, null),
    );
    t.colorSpace = THREE.SRGBColorSpace;
    faceCache.set(url, t);
  }
  return faceCache.get(url);
}

// mão com palma, quatro dedos e polegar
function buildHand(skinMat) {
  const h = new THREE.Group();

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.1), skinMat);
  palm.castShadow = true;
  h.add(palm);

  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.0115, 0.055, 3, 6),
      skinMat,
    );
    f.rotation.x = Math.PI / 2;
    f.position.set(-0.033 + i * 0.022, 0, 0.078);
    h.add(f);
  }

  const thumb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.014, 0.042, 3, 6),
    skinMat,
  );
  thumb.rotation.set(Math.PI / 2, 0, -0.9);
  thumb.position.set(0.055, 0.004, 0.03);
  h.add(thumb);

  return h;
}

export function buildCharacter({ color = 0, look = null, avatar = null, seed = 0 } = {}) {
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

  // A foto do perfil vira o rosto. Se a imagem falhar ao carregar, sobra a
  // cabeça normal que já está desenhada por baixo.
  const tex = avatar ? faceTexture(avatar) : null;
  if (tex) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.142, 32),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    );
    disc.position.set(0, 1.755, 0.153);
    g.add(disc);

    const aro = new THREE.Mesh(
      new THREE.TorusGeometry(0.142, 0.012, 10, 32),
      skinMat,
    );
    aro.position.copy(disc.position);
    g.add(aro);
  } else {
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

    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), skinMat);
    chin.scale.set(1, 0.6, 0.85);
    chin.position.set(0, 1.645, 0.06);
    g.add(chin);
  }

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.178, 24, 18, 0, Math.PI * 2, 0, Math.PI / 1.85),
    hairMat,
  );
  hair.scale.set(0.95, 1.1, 1);
  hair.position.y = 1.757;
  g.add(hair);

  if (!tex) {
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), hairMat);
    fringe.position.set(0, 1.85, 0.118);
    g.add(fringe);
  }

  // Braço ESQUERDO segura as cartas; o DIREITO fica livre para os gestos.
  const arms = new THREE.Group();
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

    // manga longa cobre o antebraço; curta deixa a pele à mostra
    const fore = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.058 * W, 0.24, 4, 10),
      mangaLonga ? shirtMat : skinMat,
    );
    fore.position.set(0, -0.19, 0.28);
    fore.rotation.x = -1.25;
    fore.castShadow = true;
    arm.add(fore);

    if (mangaLonga) {
      const punho = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062 * W, 0.062 * W, 0.03, 12),
        darkMat,
      );
      punho.rotation.x = -1.25;
      punho.position.set(0, -0.225, 0.395);
      arm.add(punho);
    }

    const hand = buildHand(skinMat);
    hand.position.set(0, -0.235, 0.44);
    hand.rotation.x = -0.35;
    arm.add(hand);

    arm.position.set(sx * ARM_X * W, 1.43, 0);
    arms.add(arm);
  }
  g.add(arms);
  g.userData.arms = arms;
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
const SEAT_R = 2.62;
const FAR_ARC = Math.PI * 0.55;

function seatAngle(idx, total) {
  if (idx === 0) return 0;
  const k = total - 1;
  if (k <= 1) return Math.PI;
  const t = (idx - 1) / (k - 1);
  return Math.PI - FAR_ARC / 2 + t * FAR_ARC;
}

function lookSig(p) {
  const L = p.look || {};
  return `${p.color}|${L.shirt}|${L.body}|${L.skin}|${L.prop}|${p.avatar || ""}`;
}

function buildSeat(p, idx, total) {
  const g = new THREE.Group();
  const ang = seatAngle(idx, total);
  g.position.set(Math.sin(ang) * SEAT_R, 0, Math.cos(ang) * SEAT_R);
  g.lookAt(0, 1, 0);

  const refs = { group: g, ang, idx, sig: "", lookSig: "", chipsN: -1 };

  refs.body = buildCharacter({
    color: p.color ?? 0,
    look: p.look,
    avatar: p.avatar,
    seed: idx,
  });
  refs.lookSig = lookSig(p);
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

  refs.label = makeLabel(p.nick);
  refs.label.position.set(0, 2.34, 0);
  g.add(refs.label);

  refs.coinLbl = makeLabel("0", "#ffd400", 0.9, 0.24);
  refs.coinLbl.position.set(0, 2.11, 0);
  g.add(refs.coinLbl);

  // cronômetro da vez
  refs.timeLbl = makeLabel("", "#ffd400", 1.0, 0.26);
  refs.timeLbl.position.set(0, 1.95, 0);
  refs.timeLbl.visible = false;
  g.add(refs.timeLbl);

  // resposta (ACEITA / CONTESTA / BLOQUEIA) ao lado do personagem
  refs.respLbl = makeLabel("", "#ffffff", 1.15, 0.3);
  refs.respLbl.position.set(0.95, 1.62, 0);
  refs.respLbl.visible = false;
  g.add(refs.respLbl);

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

  if (orbit.dragging) {
    const dx = e.clientX - orbit.lx;
    const dy = e.clientY - orbit.ly;
    orbit.lx = e.clientX;
    orbit.ly = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) orbit.moved = true;
    orbit.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, orbit.yaw - dx * 0.005));
    orbit.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbit.pitch + dy * 0.004));
  }
}

function onPointerDown(e) {
  orbit.dragging = true;
  orbit.moved = false;
  orbit.lx = e.clientX;
  orbit.ly = e.clientY;
}

function onPointerUp() {
  orbit.dragging = false;
  renderer.domElement.style.cursor = "";
}

// duplo clique volta a câmera para o centro
function onDblClick() {
  orbit.yaw = 0;
  orbit.pitch = 0;
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
  // arrastar para girar não pode disparar clique (escolher alvo, lâmpada)
  if (orbit.moved) {
    orbit.moved = false;
    return;
  }
  onPointerMove(e);
  const hit = pick();
  if (!hit) return;

  if (hit.lamp) {
    // empurra a lâmpada: balança mais forte e a luz oscila junto
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
    64,
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
  renderer.domElement.addEventListener("click", onClick);

  clock = new THREE.Clock();
  animate();
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
  const me = seats.get(myId);
  if (!me) {
    camera.position.set(0, 4.6, 6.2);
    camera.lookAt(0, 0.9, 0);
    return;
  }
  const p = me.group.position;
  const k = thirdPerson ? 1.78 : 1.34;
  const alt = thirdPerson ? 3.1 : 2.12;
  const olha = thirdPerson ? 1.0 : 0.92;

  // o arraste gira o ponto de vista em volta do centro da mesa
  const ang = Math.atan2(p.x, p.z) + orbit.yaw;
  const raio = Math.hypot(p.x, p.z) * k;
  camera.position.set(
    Math.sin(ang) * raio,
    alt + orbit.pitch * 1.4,
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

  const players = state?.playersInGame || [];
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
        avatar: p.avatar,
        seed: s.idx,
      });
      s.group.add(s.body);
      s.ring.material.color.set(COLORS[(p.color ?? 0) % COLORS.length]);
    }

    if (s.nick !== p.nick) {
      s.nick = p.nick;
      s.label.userData.redraw(p.nick, "#ffffff", null);
    }
    if (s.coinsShown !== p.coins) {
      s.coinsShown = p.coins;
      s.coinLbl.userData.redraw(String(p.coins), "#ffd400", null);
    }
    updateChips(s, p.coins);
    updateCards(s, p, p.id === meId);

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
    s.label.visible = !souEu;
    s.coinLbl.visible = !souEu;
    // Em 1ª pessoa a câmera fica DENTRO do meu próprio assento: fichas e halo
    // envolviam a lente e viravam borrões amarelos tapando a tela.
    s.chips.visible = !esconderMeuCorpo;
    s.ring.visible = !esconderMeuCorpo;

    s.body.position.y = p.aliveCount <= 0 ? -0.25 : 0;
  });

  updateMyHand(players.find((x) => x.id === meId));
  if (myHand) myHand.visible = !thirdPerson && !!seats.get(meId);

  posicionaCamera();

  if (deckMesh) deckMesh.visible = (state?.deckCount ?? 0) > 0;
}

export function emote(ev) {
  const s = seats.get(ev.playerId);
  if (!s) return;
  const now = performance.now();

  if (ev.kind === "bang") {
    shakeUntil.t = now + 900;
    lampKick.t = now + 1800;
    s.body.userData.bang = now + 900; // bate com as DUAS mãos
    for (const [, o] of seats)
      o.cards.forEach((c) => (c.userData.jump = now + 700));
  } else if (ev.kind === "finger" || ev.kind === "l13") {
    s.body.userData.raise = now + 2200; // mão livre, a outra segura a carta
  } else if (ev.kind === "clap") {
    // larga a carta na mesa e bate palma com as duas
    s.body.userData.clap = now + 1800;
    s.hand.userData.down = now + 1800;
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
    lampPivot.rotation.z = Math.sin(t * (0.55 + kick * 1.5)) * amp;
    lampPivot.rotation.x = Math.cos(t * (0.41 + kick * 1.2)) * amp * 0.62;
    if (lampLight) lampLight.intensity = 42 * (1 + kick * 0.4);
    if (bounceLight) bounceLight.intensity = 13 * (1 + kick * 0.35);
  }

  if (table) {
    const left = shakeUntil.t - nowMs;
    if (left > 0) {
      const k = (left / 900) * 0.035;
      table.position.x = Math.sin(nowMs * 0.05) * k;
      table.position.z = Math.cos(nowMs * 0.043) * k;
    } else table.position.x = table.position.z = 0;
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

    if (s.ring) {
      if (s.isTarget) {
        s.ring.material.color.setHex(0xff3b3b);
        s.ring.material.opacity = 0.5 + Math.sin(t * 6) * 0.35;
      } else if (s.isCurrent) {
        s.ring.material.opacity = 0.85;
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
      const raise = (s.body.userData.raise || 0) - nowMs;
      const clap = (s.body.userData.clap || 0) - nowMs;
      const bang = (s.body.userData.bang || 0) - nowMs;
      const L = arms.children[0];
      const R = arms.children[1];

      if (raise > 0) {
        const k = Math.min(1, (2200 - raise) / 500);
        R.rotation.x = -2.15 * k;
        R.rotation.z = -0.25 * k;
        L.rotation.set(0, 0, 0);
        L.position.x = -ARM_X;
        R.position.x = ARM_X;
      } else if (bang > 0) {
        const b = Math.abs(Math.sin(nowMs * 0.022));
        L.rotation.set(-0.55 * b, 0, 0);
        R.rotation.set(-0.55 * b, 0, 0);
        L.position.x = -ARM_X;
        R.position.x = ARM_X;
      } else if (clap > 0) {
        const d = Math.abs(Math.sin(nowMs * 0.018)) * 0.16;
        L.rotation.set(-0.5, 0, 0);
        R.rotation.set(-0.5, 0, 0);
        L.position.x = -ARM_X + 0.14 + d;
        R.position.x = ARM_X - 0.14 - d;
      } else {
        L.rotation.set(0, 0, 0);
        R.rotation.set(0, 0, 0);
        L.position.x = -ARM_X;
        R.position.x = ARM_X;
      }
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

  // destaque de quem está sob o mouse na hora de escolher alvo
  if (targets) {
    const hit = pick();
    const novo = hit?.pid && targets.has(hit.pid) ? hit.pid : null;
    if (novo !== hovered) {
      hovered = novo;
      renderer.domElement.style.cursor = novo ? "pointer" : "";
    }
    for (const [pid, s] of seats) s.body.scale.setScalar(pid === hovered ? 1.06 : 1);
  } else if (hovered) {
    hovered = null;
    renderer.domElement.style.cursor = "";
    for (const [, s] of seats) s.body.scale.setScalar(1);
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
    renderer.domElement.removeEventListener("click", onClick);
    renderer.dispose();
    if (renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  seats.clear();
  flying.length = 0;
  renderer = scene = camera = null;
}

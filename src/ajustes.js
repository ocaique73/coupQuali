// Os números da cena 3D, valendo para o JOGO INTEIRO.
//
// Antes cada navegador guardava os seus no localStorage: mexer uma barra em
// /teste mudava só a mesa de quem mexeu, e o mesmo jogo ficava diferente para
// cada pessoa na mesma sala. Agora o servidor é o dono — quem salva manda para
// cá, e daqui sai para todas as salas e todos os jogadores.
//
// A LISTA de números não está aqui de propósito. Ela mora em
// public/ajustes3d.js junto da faixa de cada barra, e é o cliente que recusa
// nome que não conhece. Repetir a tabela aqui daria duas listas para
// desencontrar na primeira barra nova. O que cabe ao servidor é a peneira que
// não depende da lista: nome com cara de nome, valor finito, dentro de um teto
// generoso e em quantidade limitada.
const fs = require("fs");
const path = require("path");

const ARQUIVO = path.join(__dirname, "..", "ajustes.json");
const MAX_CHAVES = 160;
const TETO = 1000; // nenhum número da cena chega perto disso
const NOME_OK = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

// Gravar no disco a cada arrastão de barra seria uma escrita por quadro.
const GRAVA_APOS_MS = 1200;

let atual = carregar();
let gravando = null;

function carregar() {
  try {
    // O replace tira o BOM: editor do Windows (e o Set-Content do PowerShell)
    // grava esses três bytes invisíveis na frente, e o JSON.parse engasga —
    // o arquivo parece perfeito na tela e a cena sobe no padrão sem explicar
    // por quê.
    const cru = fs.readFileSync(ARQUIVO, "utf8").replace(/^﻿/, "");
    const o = JSON.parse(cru);
    return peneirar(o);
  } catch {
    // Primeira subida: a cena cai no PADRAO do public/ajustes3d.js e o jogo
    // abre igual. Nada aqui é essencial.
    return {};
  }
}

function peneirar(obj) {
  const limpo = {};
  if (!obj || typeof obj !== "object") return limpo;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= MAX_CHAVES) break;
    if (!NOME_OK.test(k)) continue;
    const num = Number(v);
    if (!Number.isFinite(num) || Math.abs(num) > TETO) continue;
    limpo[k] = num;
    n++;
  }
  return limpo;
}

function agendarGravacao() {
  if (gravando) return;
  gravando = setTimeout(() => {
    gravando = null;
    try {
      fs.writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2));
    } catch (e) {
      // Disco somente-leitura (é o caso do Render) não pode derrubar o jogo:
      // os números continuam valendo em memória para todo mundo, só não
      // sobrevivem a um restart. Para virar permanente de verdade existe o
      // botão "Copiar para o código" na bancada.
      console.warn("[ajustes] não deu para gravar:", e.message);
    }
  }, GRAVA_APOS_MS);
  gravando.unref?.();
}

// Junta o que chegou ao que já valia. `reset` limpa tudo e devolve o jogo ao
// PADRAO escrito no código.
function aplicar(valores, reset) {
  if (reset) atual = {};
  else atual = Object.assign({}, atual, peneirar(valores));
  agendarGravacao();
  return atual;
}

/* ------------------------------------------------------------------ */
/* fixar: entregar os números para virarem código                      */
/*                                                                     */
/* O disco do Render é efêmero — some no deploy e quando o serviço      */
/* hiberna. O único lugar que sobrevive é o CÓDIGO, e quem escreve      */
/* código é uma pessoa, não o servidor.                                 */
/*                                                                     */
/* Então "fixar" aqui é só entregar o arquivo: a bancada baixa, e o     */
/* tools/fixar-ajustes.js carimba os valores no PADRAO do              */
/* public/ajustes3d.js. Havia um caminho que commitava sozinho pela API */
/* do GitHub, mas exigia criar e guardar um token — trabalho e risco    */
/* demais para uma tela de autor que se usa de vez em quando.           */
/* ------------------------------------------------------------------ */

// O nome carrega a data e a hora: cada download é um arquivo novo, em vez de
// "ajustes (1).json", "ajustes (2).json" empilhados na pasta sem dar para
// saber qual é o último.
function nomeDoArquivo() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return (
    `coup-visual-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` +
    `-${z(d.getHours())}${z(d.getMinutes())}.json`
  );
}

function fixar() {
  return {
    ok: false,
    motivo: "baixar",
    arquivo: nomeDoArquivo(),
    conteudo: JSON.stringify(atual, null, 2) + String.fromCharCode(10),
    texto: "",
  };
}

module.exports = { atuais: () => atual, aplicar, fixar };

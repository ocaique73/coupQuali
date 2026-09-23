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
    const cru = fs.readFileSync(ARQUIVO, "utf8");
    const o = JSON.parse(cru);
    return peneirar(o);
  } catch {
    // Primeira subida, ou deploy novo: a cena cai no PADRAO do
    // public/ajustes3d.js e o jogo abre igual. Nada aqui é essencial.
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

module.exports = { atuais: () => atual, aplicar };

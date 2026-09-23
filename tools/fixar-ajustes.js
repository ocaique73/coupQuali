// Carimba os números da bancada no PADRAO do public/ajustes3d.js.
//
// Uso:
//   node tools/fixar-ajustes.js caminho/do/coup-visual-....json
//   node tools/fixar-ajustes.js --ultimo        (pega o mais novo em Downloads)
//   node tools/fixar-ajustes.js --ver <arquivo> (só mostra, não escreve)
//
// Por que existe: o que se ajusta em /teste e /personagem vale na hora para
// todo mundo, mas mora na memória do servidor — some no deploy e quando o
// Render hiberna. O único lugar permanente é o código. A bancada baixa um
// arquivo, e este script traz os valores para cá, que é o passo que fecha o
// ciclo. Antes isso era feito na mão, número por número, e errar um dígito
// passava despercebido até alguém olhar o boneco.
//
// Depois de carimbar, o ajustes.json é zerado de propósito: ele guarda a
// DIFERENÇA em relação ao PADRAO, e se o padrão agora é o próprio valor, a
// diferença é nenhuma. Deixá-lo com o valor antigo faria o servidor mandar
// para os navegadores um "ajuste" que já é o padrão — inofensivo, mas mentiroso
// para quem for ler.
const fs = require("fs");
const path = require("path");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const ALVO = path.join(RAIZ, "public", "ajustes3d.js");
const RUNTIME = path.join(RAIZ, "ajustes.json");

function sair(msg) {
  console.error(msg);
  process.exit(1);
}

// O mais novo "coup-visual-*.json" da pasta de Downloads. É onde o navegador
// larga o arquivo, e pelo nome com data o mais novo é sempre o que interessa.
function ultimoBaixado() {
  const dir = path.join(os.homedir(), "Downloads");
  let nomes;
  try {
    nomes = fs.readdirSync(dir);
  } catch {
    sair(`Não achei a pasta ${dir}.`);
  }
  const candidatos = nomes
    .filter((n) => /^coup-visual-.*\.json$/i.test(n))
    .map((n) => {
      const p = path.join(dir, n);
      return { p, t: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.t - a.t);

  if (!candidatos.length)
    sair(
      `Nenhum coup-visual-*.json em ${dir}.\n` +
        `Clique em "Fixar permanente" na bancada primeiro.`,
    );
  return candidatos[0].p;
}

function lerValores(arquivo) {
  let cru;
  try {
    // tira o BOM: editor do Windows grava três bytes invisíveis na frente e o
    // JSON.parse engasga sem dizer por quê
    cru = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  } catch {
    sair(`Não consegui ler ${arquivo}.`);
  }
  let o;
  try {
    o = JSON.parse(cru);
  } catch (e) {
    sair(`${arquivo} não é JSON válido: ${e.message}`);
  }
  if (!o || typeof o !== "object" || Array.isArray(o))
    sair(`${arquivo} devia ser um objeto de números.`);
  return o;
}

// Lê o PADRAO de dentro do ajustes3d.js sem executar a página: o arquivo é um
// IIFE que mexe em window, e carregá-lo aqui quebraria.
function padraoAtual(fonte) {
  const ini = fonte.indexOf("const PADRAO = {");
  if (ini < 0) sair("Não achei o bloco PADRAO no ajustes3d.js.");
  const fim = fonte.indexOf("\n  };", ini);
  if (fim < 0) sair("Não achei o fim do bloco PADRAO.");
  const corpo = fonte.slice(ini, fim);

  const valores = {};
  for (const m of corpo.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(-?[\d.]+)\s*,/gm))
    valores[m[1]] = Number(m[2]);
  return { valores, ini, fim: fim + "\n  };".length };
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const soVer = args.includes("--ver");
const resto = args.filter((a) => a !== "--ver" && a !== "--ultimo");
const arquivo =
  resto[0] && fs.existsSync(resto[0]) ? resto[0] : ultimoBaixado();

const novos = lerValores(arquivo);
const fonte = fs.readFileSync(ALVO, "utf8");
const { valores: padrao, ini, fim } = padraoAtual(fonte);

console.log(`arquivo: ${arquivo}\n`);

const desconhecidos = Object.keys(novos).filter((k) => !(k in padrao));
if (desconhecidos.length)
  console.log(
    `ignorados (não existem no PADRAO): ${desconhecidos.join(", ")}\n`,
  );

const mudancas = [];
for (const [k, v] of Object.entries(novos)) {
  if (!(k in padrao)) continue;
  const n = Number(v);
  if (!Number.isFinite(n)) continue;
  if (padrao[k] !== n) mudancas.push([k, padrao[k], n]);
}

if (!mudancas.length) {
  console.log("Nada a mudar: o PADRAO já é esse.");
  process.exit(0);
}

const larg = Math.max(...mudancas.map(([k]) => k.length));
for (const [k, de, para] of mudancas)
  console.log(`  ${k.padEnd(larg)}  ${de}  ->  ${para}`);

if (soVer) {
  console.log(`\n(--ver: não escrevi nada)`);
  process.exit(0);
}

// Reescreve SÓ a linha de cada número mudado, dentro do bloco PADRAO: um
// replace no arquivo inteiro pegaria o mesmo nome em outro lugar (a lista de
// controles logo abaixo usa as mesmas chaves).
let bloco = fonte.slice(ini, fim);
for (const [k, , para] of mudancas) {
  const re = new RegExp(`^(\\s*${k}\\s*:\\s*)-?[\\d.]+(\\s*,)`, "m");
  if (!re.test(bloco)) sair(`Não achei a linha de ${k} no PADRAO.`);
  bloco = bloco.replace(re, `$1${para}$2`);
}
fs.writeFileSync(ALVO, fonte.slice(0, ini) + bloco + fonte.slice(fim));

// zera o runtime: o padrão agora é o próprio valor, então não há diferença
try {
  if (fs.existsSync(RUNTIME)) fs.writeFileSync(RUNTIME, "{}\n");
} catch {}

console.log(
  `\n${mudancas.length} número(s) carimbado(s) em public/ajustes3d.js.` +
    `\najustes.json zerado (o padrão virou o valor).`,
);

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
/* fixar de verdade: gravar no repositório                             */
/*                                                                     */
/* O disco do Render é efêmero — some no deploy e quando o serviço      */
/* hiberna. O único lugar que sobrevive a um redeploy é o REPOSITÓRIO,  */
/* porque é dele que o deploy nasce. Então "fixar" é literalmente fazer */
/* um commit do ajustes.json, e o deploy seguinte já sobe com ele.      */
/*                                                                     */
/* Precisa de duas variáveis de ambiente no painel do Render:           */
/*   GITHUB_TOKEN  — token com permissão de escrita em conteúdo         */
/*   GITHUB_REPO   — "usuario/repositorio"                              */
/* Sem elas o botão não quebra: devolve o arquivo para baixar e commitar*/
/* na mão, que dá no mesmo, só com um passo a mais.                     */
/* ------------------------------------------------------------------ */

const API = "https://api.github.com";

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  return token && repo ? { token, repo, branch } : null;
}

function cabecalhos(token) {
  return {
    // O token NUNCA é registrado em log nem devolvido ao navegador: ele só
    // existe dentro destas chamadas.
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "coup-online",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fixar() {
  const cfg = config();
  const conteudo = JSON.stringify(atual, null, 2) + String.fromCharCode(10);

  if (!cfg) {
    return {
      ok: false,
      motivo: "sem_token",
      conteudo,
      texto:
        "Sem GITHUB_TOKEN/GITHUB_REPO no servidor: baixe o ajustes.json e " +
        "faça o commit dele na raiz do projeto.",
    };
  }
  if (typeof fetch !== "function") {
    return { ok: false, motivo: "sem_fetch", conteudo, texto: "Node sem fetch." };
  }

  const url = `${API}/repos/${cfg.repo}/contents/ajustes.json`;

  try {
    // O GitHub exige o sha do arquivo que está lá para substituir. Se não
    // existir ainda (404), é criação e vai sem sha.
    let sha;
    const atualNoRepo = await fetch(`${url}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: cabecalhos(cfg.token),
    });
    if (atualNoRepo.status === 200) sha = (await atualNoRepo.json()).sha;
    else if (atualNoRepo.status !== 404)
      return { ok: false, motivo: "leitura", conteudo, texto: `GitHub respondeu ${atualNoRepo.status} ao ler o arquivo.` };

    const r = await fetch(url, {
      method: "PUT",
      headers: { ...cabecalhos(cfg.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Fixa os ajustes da cena pela bancada",
        content: Buffer.from(conteudo, "utf8").toString("base64"),
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!r.ok) {
      const corpo = await r.text();
      // a mensagem do GitHub ajuda (token sem permissão, repo errado), mas
      // vai cortada: não é lugar de despejar resposta inteira na tela
      return {
        ok: false,
        motivo: "escrita",
        conteudo,
        texto: `GitHub recusou (${r.status}): ${corpo.slice(0, 180)}`,
      };
    }

    return {
      ok: true,
      texto:
        "Commitado no repositório. O próximo deploy já sobe com estes números.",
    };
  } catch (e) {
    return { ok: false, motivo: "rede", conteudo, texto: `Falhou: ${e.message}` };
  }
}

module.exports = { atuais: () => atual, aplicar, fixar, temToken: () => !!config() };

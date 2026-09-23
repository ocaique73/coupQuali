// Caça identificador usado e não declarado/importado, ignorando comentários
// e strings (senão comentário em português vira falso positivo).
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "src");

const GLOBALS = new Set([
  "require", "module", "exports", "console", "setInterval", "setTimeout",
  "clearTimeout", "clearInterval", "Math", "Date", "Object", "Array", "JSON",
  "Number", "String", "Boolean", "Set", "Map", "Promise", "isNaN", "parseInt",
  "parseFloat", "process", "Error", "RegExp", "Infinity", "io", "socket",
  // globais do Node 18+ que o servidor usa de verdade
  "fetch", "Buffer", "URL", "structuredClone",
]);
const KW = /^(if|for|while|switch|catch|return|typeof|new|function|of|in|do|else|try|throw|delete|void|await|async)$/;

function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, '"S"')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, '"S"')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '"S"');
}

let bad = 0;
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
  const src = strip(fs.readFileSync(path.join(SRC, f), "utf8"));
  const dec = new Set();

  const add = (n) => n && dec.add(n);
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/const\s*\{([^}]+)\}/g))
    m[1].split(",").forEach((s) => add(s.trim().split(":").pop().trim()));
  for (const m of src.matchAll(/function[^(]*\(([^)]*)\)/g))
    m[1].split(",").forEach((s) => add(s.trim().split(/[=\s]/)[0].replace(/[{}.]/g, "")));
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g))
    m[1].split(",").forEach((s) => add(s.trim().split(/[=\s]/)[0].replace(/[{}.]/g, "")));
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);

  // chamadas: nome(
  for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const u = m[1];
    if (GLOBALS.has(u) || dec.has(u) || KW.test(u)) continue;
    console.log(`  SUSPEITO: ${f} -> ${u}()`);
    bad++;
  }

  // constantes lidas sem chamar — foi assim que RESPONSE_MS passou batido.
  // CONSTANTES_ASSIM são inconfundíveis, então dá para cobrar sem falso positivo.
  for (const m of src.matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})(?![\w$])/g)) {
    const u = m[1];
    if (GLOBALS.has(u) || dec.has(u)) continue;
    console.log(`  SUSPEITO: ${f} -> constante ${u} usada sem importar`);
    bad++;
  }
}
console.log(
  bad ? `\n${bad} suspeita(s)` : "nenhum identificador solto — os módulos fecham",
);
process.exit(bad ? 1 : 0);

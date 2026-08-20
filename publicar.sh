#!/bin/sh
# Carimba a versão nos assets e no version.json, que é o que permite à página
# perceber sozinha que está velha (ver o aviso em script.js).
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
node -e '
const fs=require("fs"); const v=process.argv[1];
for (const f of ["adega.html","index.html","noticias.html","viagens.html"]) {
  let s=fs.readFileSync(f,"utf8");
  s=s.replace(/(href="styles\.css)(\?v=\d+)?"/g, `$1?v=${v}"`);
  s=s.replace(/(src="(?:password-gate|script|adega|noticias|news-feed|viagens)\.js)(\?v=\d+)?"/g, `$1?v=${v}"`);
  fs.writeFileSync(f,s);
}
fs.writeFileSync("version.json", JSON.stringify({ v }, null, 2) + "\n");
console.log("v=" + v);
' "$V"

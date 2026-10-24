// Build fuer mieter.dthomes.ch / sign: alle Bibliotheken kommen aus /vendor (feste Versionen, eigener Server),
// der JSX-Code wird hier schon in normales JavaScript umgewandelt (kein Babel im Browser, kein fremdes CDN).
const fs = require("fs"), path = require("path");
const B = require("@babel/standalone");
const SRC = __dirname, OUT = path.join(__dirname, "public");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "vendor"), { recursive: true });
for (const n of fs.readdirSync(SRC)) if (/\.(png|webp|ico)$/.test(n)) fs.copyFileSync(path.join(SRC, n), path.join(OUT, n));
for (const n of fs.readdirSync(path.join(SRC, "vendor"))) fs.copyFileSync(path.join(SRC, "vendor", n), path.join(OUT, "vendor", n));
let h = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
let anzahl = 0;
h = h.replace(/<script([^>]*)type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/g, (m, a1, a2, code) => {
  anzahl++;
  const js = B.transform(code, { presets: ["react"], sourceType: "script", compact: false, comments: false }).code;
  if (/<\/script/i.test(js)) throw new Error("kompilierter Code enthaelt </script>");
  return "<script>" + js + "</script>";
});
if (!anzahl) throw new Error("Keine text/babel-Skripte gefunden");
h = h.replace(/<script[^>]*@babel\/standalone[^>]*><\/script>\s*/g, "");
// Nichts mehr von fremden Script-Servern laden
const fremd = h.match(/<script[^>]+src="https?:\/\/[^"]+"/g);
if (fremd) throw new Error("Externe Skripte gefunden: " + fremd.join(", "));
for (const m of h.matchAll(/<script[^>]+src="(\/vendor\/[^"]+)"/g)) if (!fs.existsSync(path.join(OUT, m[1]))) throw new Error("Fehlt: " + m[1]);
fs.writeFileSync(path.join(OUT, "index.html"), h);
console.log("index.html: " + anzahl + " Skript(e) vorkompiliert, Bibliotheken aus /vendor");

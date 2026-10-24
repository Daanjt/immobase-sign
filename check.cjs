// Code-Pruefung vor jedem Deploy (Vercel buildCommand). Kopie von immobase-cloud/Immobase-cloud/check.cjs.
// Der App-Code liegt in src/*.jsx (nach Bereichen aufgeteilt). index.html enthaelt nur
// den Platzhalter /*@@APP_SRC@@*/, den zusammensetzen() mit allen src-Dateien fuellt.
// Findet Fehler, die sonst erst beim Klicken in der App auffallen:
//   - doppelt deklarierte Funktionen/Variablen (no-redeclare)
//   - Namen, die es an der Stelle gar nicht gibt (no-undef), z.B. Funktion aus anderer Komponente
//   - doppelte Schluessel in Objekten, Zuweisung an const usw.
// Findet die Pruefung einen Fehler, bricht der Build ab und die letzte funktionierende
// Version bleibt online.  Manuell:  node check.cjs [datei.html ...]
const fs = require("fs");
const path = require("path");
const B = require("@babel/standalone");
const { Linter } = require("eslint");
const globals = require("globals");

const REGELN = {
  "no-undef": 2, "no-redeclare": 2, "no-dupe-keys": 2, "no-func-assign": 2,
  "no-dupe-args": 2, "no-const-assign": 2, "no-dupe-else-if": 2, "no-self-assign": 2,
};
// Babel-Hilfsfunktion, kein Fehler im eigenen Code
const IGNORIEREN = (x) => x.ruleId === "no-func-assign" && /'_extends'/.test(x.message);

const PLATZHALTER = "/*@@APP_SRC@@*/";

// Setzt index.html und src/*.jsx (alphabetisch) zusammen. Liefert den HTML-Text und
// eine Funktion, die eine Zeile im Ergebnis auf "datei:zeile" zurueckfuehrt.
function zusammensetzen(datei) {
  const roh = fs.readFileSync(datei, "utf8");
  const pos = roh.indexOf(PLATZHALTER + "\n");
  if (pos < 0) return { html: roh, ort: (z) => `${path.basename(datei)}:${z}` };
  const srcDir = path.join(path.dirname(datei), "src");
  const teile = fs.readdirSync(srcDir).filter(n => n.endsWith(".jsx")).sort()
    .map(n => ({ name: "src/" + n, text: fs.readFileSync(path.join(srcDir, n), "utf8") }));
  for (const t of teile) if (!t.text.endsWith("\n")) t.text += "\n";
  const vorher = roh.slice(0, pos), nachher = roh.slice(pos + PLATZHALTER.length + 1);
  const html = vorher + teile.map(t => t.text).join("") + nachher;
  const p0 = vorher.split("\n").length; // Zeile des Platzhalters (1-basiert)
  const bereiche = []; let z = p0;
  for (const t of teile) { const n = t.text.split("\n").length - 1; bereiche.push({ name: t.name, von: z, bis: z + n - 1 }); z += n; }
  const gesamtSrc = z - p0;
  const ort = (zeile) => {
    if (zeile < p0) return `${path.basename(datei)}:${zeile}`;
    const b = bereiche.find(b => zeile >= b.von && zeile <= b.bis);
    if (b) return `${b.name}:${zeile - b.von + 1}`;
    return `${path.basename(datei)}:${zeile - gesamtSrc + 1}`;
  };
  return { html, ort };
}

function pruefeDatei(datei) {
  const { html, ort } = zusammensetzen(datei);
  const re = /<script([^>]*)type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/g;
  const linter = new Linter();
  const g = { ...globals.es2021, ...globals.browser, React: "readonly", ReactDOM: "readonly" };
  const fehler = [];
  let m, anzahl = 0;
  while ((m = re.exec(html))) {
    anzahl++;
    const startZeile = html.slice(0, m.index + m[0].indexOf(">") + 1).split("\n").length;
    let js;
    try {
      js = B.transform(m[3], { presets: ["react"], sourceType: "script", compact: false, retainLines: true }).code;
    } catch (e) {
      fehler.push(`${path.basename(datei)}: Syntaxfehler: ${String(e.message).split("\n")[0]}`);
      continue;
    }
    for (const x of linter.verify(js, { parserOptions: { ecmaVersion: 2022, sourceType: "script" }, globals: g, rules: REGELN })) {
      if (x.severity < 2 || IGNORIEREN(x)) continue;
      fehler.push(`${ort(startZeile + x.line - 1)}  ${x.ruleId}  ${x.message}`);
    }
  }
  return { anzahl, fehler };
}

function pruefe(dateien) {
  let alle = [], skripte = 0;
  for (const d of dateien) { const r = pruefeDatei(d); skripte += r.anzahl; alle = alle.concat(r.fehler); }
  return { skripte, fehler: alle };
}

module.exports = { pruefe, zusammensetzen };

if (require.main === module) {
  const dateien = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(__dirname).filter(n => n.endsWith(".html")).map(n => path.join(__dirname, n));
  const r = pruefe(dateien);
  r.fehler.forEach(f => console.log(f));
  console.log(`Code-Pruefung: ${r.skripte} Skript(e), ${r.fehler.length} Fehler`);
  process.exit(r.fehler.length ? 1 : 0);
}

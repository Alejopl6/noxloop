// Un llavero del sistema de mentira que habla el MISMO protocolo que
// `noxloop-llavero` (apps/desktop/src-tauri/src/llavero.rs): una orden por
// argumento, `--ref` y `--servicio`, y el valor por la entrada estandar.
//
// Guarda en un JSON dentro de `LLAVERO_FALSO_DIR`. Con `LLAVERO_FALSO_CAIDO=1`
// responde que no hay llavero, que es lo que pasa en un servidor sin sesion.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [verbo, ...resto] = process.argv.slice(2);
const refIdx = resto.indexOf("--ref");
const ref = refIdx >= 0 ? resto[refIdx + 1] : null;
const archivo = join(process.env.LLAVERO_FALSO_DIR ?? ".", "llavero.json");
const leer = () => (existsSync(archivo) ? JSON.parse(readFileSync(archivo, "utf8")) : {});

let entrada = "";
process.stdin.on("data", (t) => (entrada += t));
process.stdin.on("end", () => {
  if (process.env.LLAVERO_FALSO_CAIDO === "1") {
    process.stderr.write("no hay llavero en esta sesion");
    process.exit(3);
  }
  const datos = leer();
  if (verbo === "disponible") return void process.stdout.write(JSON.stringify({ disponible: true }));
  if (verbo === "guardar") {
    datos[ref] = entrada;
    writeFileSync(archivo, JSON.stringify(datos));
    return;
  }
  if (verbo === "recuperar") {
    if (!(ref in datos)) process.exit(4);
    return void process.stdout.write(datos[ref]);
  }
  if (verbo === "existe") return void process.stdout.write(JSON.stringify({ existe: ref in datos }));
  if (verbo === "borrar") {
    delete datos[ref];
    writeFileSync(archivo, JSON.stringify(datos));
    return;
  }
  process.exit(2);
});

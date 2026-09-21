// Detector de integracion continua: que workflows hay, que comandos corren y
// si alguno gatea un pull request.
//
// POR QUE IMPORTA MAS QUE EL RESTO. Porque los comandos que corre la
// integracion continua son la definicion operativa del gate del proyecto: son
// los unicos comandos de los que se sabe que alguien decidio que tenian que
// pasar antes de mergear. Todo lo demas —lo que dice el README, lo que
// recuerda el equipo— es opinion. El principio II dice que el criterio de exito
// es un exit code; este detector es donde se averigua de que comando.
//
// POR QUE SE LEE CON EXPRESIONES REGULARES Y NO CON UN PARSER DE YAML. Porque
// un parser es una dependencia, y la constitucion prohibe dependencias en el
// camino critico: un scanner que no arranca porque falta un paquete es un
// scanner que no arranca. Lo que hace falta de esos archivos —la lista de
// lineas `run:` con su numero— se saca sin entender YAML, y lo que se pierde
// (anclas, plantillas) no cambia la respuesta a "que comandos corren".
//
// Y la razon por la que el numero de linea no es un adorno: un hallazgo que
// dice "corre npm test en algun sitio de ci.yml" obliga a abrir un archivo de
// doscientas lineas para comprobarlo. Eso no es evidencia, es una pista.

import { detectado, vacio } from "../hallazgo.mjs";

/** Donde vive la definicion de un pipeline. Es una tabla: un sistema mas es una fila. */
const UBICACIONES = Object.freeze([
  { re: /^\.github\/workflows\/[^/]+\.ya?ml$/, sistema: "workflows del alojamiento" },
  { re: /^\.gitlab-ci\.ya?ml$/, sistema: "pipeline del alojamiento" },
  { re: /^azure-pipelines(?:-[^/]+)?\.ya?ml$/, sistema: "pipeline del alojamiento" },
  { re: /^\.circleci\/config\.ya?ml$/, sistema: "servicio externo" },
  { re: /^\.drone\.ya?ml$/, sistema: "servicio externo" },
  { re: /^\.travis\.ya?ml$/, sistema: "servicio externo" },
  { re: /^bitbucket-pipelines\.ya?ml$/, sistema: "pipeline del alojamiento" },
  { re: /^Jenkinsfile$/, sistema: "servidor propio" },
  { re: /^\.woodpecker\.ya?ml$/, sistema: "servicio externo" },
  { re: /^\.buildkite\/[^/]+\.ya?ml$/, sistema: "servicio externo" },
]);

/** La linea que lanza un comando, en las grafias que usan los distintos sistemas. */
const LINEA_DE_COMANDO = /^(\s*)-?\s*(?:run|script|cmd|command|sh)\s*:\s*(.*)$/;

/** El disparador que convierte un workflow en un gate de integracion. */
const DISPARADOR_DE_PR = /\b(?:pull_request(?:_target)?|merge_request|pr:)\b/;

/** Mas alla de esto la lista deja de ser util y empieza a ser un volcado del archivo. */
const MAXIMOS_COMANDOS = 120;

/**
 * Saca los comandos de un archivo de pipeline, con su linea.
 *
 * Contempla el bloque literal (`run: |`), que es como se escriben los comandos
 * de varias lineas y por tanto donde estan casi siempre los interesantes.
 *
 * @param {import("../contexto.mjs").Contexto} ctx
 * @param {string} ruta
 */
function comandosDe(ctx, ruta) {
  const lineas = ctx.lineas(ruta);
  /** @type {Array<{ruta: string, linea: number, comando: string}>} */
  const comandos = [];

  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(LINEA_DE_COMANDO);
    if (!m) continue;
    const sangria = m[1].length;
    const resto = m[2].trim();

    if (resto === "|" || resto === ">" || resto === "|-" || resto === ">-") {
      for (let j = i + 1; j < lineas.length; j++) {
        const linea = lineas[j];
        if (!linea.trim()) continue;
        const sangriaActual = linea.length - linea.trimStart().length;
        if (sangriaActual <= sangria) break;
        comandos.push({ ruta, linea: j + 1, comando: linea.trim() });
        i = j;
      }
      continue;
    }
    if (resto) comandos.push({ ruta, linea: i + 1, comando: resto.replace(/^["']|["']$/g, "") });
  }
  return comandos;
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  const workflows = ctx.archivos
    .map((a) => a.ruta)
    .filter((ruta) => UBICACIONES.some((u) => u.re.test(ruta)))
    .sort();

  if (workflows.length === 0) {
    const motivo =
      "Se busco una definicion de pipeline en las rutas donde viven " +
      "(`.github/workflows/`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `.circleci/config.yml`, `Jenkinsfile`, " +
      "entre otras) y no hay ninguna. El proyecto no tiene integracion continua en el repositorio, o la tiene " +
      "configurada fuera de el — y lo que esta fuera del arbol, este scanner no lo ve ni lo adivina.";
    return [
      vacio("ci", "ci.workflows", [{ ruta: "." }], motivo, []),
      vacio("ci", "ci.comandos", [{ ruta: "." }], motivo, []),
      vacio(
        "ci",
        "ci.gatea_pr",
        [{ ruta: "." }],
        "No hay ningun workflow, asi que no hay nada que pueda gatear un pull request desde el repositorio. Lo " +
          "que gatee el merge estara en la configuracion del alojamiento, que no vive en el arbol.",
      ),
    ];
  }

  const hallazgos = [
    detectado("ci", "ci.workflows", workflows, workflows.map((ruta) => ({ ruta }))),
  ];

  /** @type {Array<{ruta: string, linea: number, comando: string}>} */
  const comandos = [];
  for (const ruta of workflows) comandos.push(...comandosDe(ctx, ruta));

  if (comandos.length === 0) {
    hallazgos.push(
      vacio(
        "ci",
        "ci.comandos",
        workflows.map((ruta) => ({ ruta })),
        "Hay workflows pero ninguno declara un comando en una linea `run:`, `script:` o equivalente. El pipeline " +
          "llama a acciones o plantillas de terceros, y lo que esas ejecutan no esta en el arbol.",
        [],
      ),
    );
  } else {
    const recortados = comandos.slice(0, MAXIMOS_COMANDOS);
    hallazgos.push(
      detectado(
        "ci",
        "ci.comandos",
        recortados,
        recortados.slice(0, 10).map((c) => ({ ruta: c.ruta, linea: c.linea })),
      ),
    );
  }

  /** @type {any} */
  let disparador = null;
  for (const ruta of workflows) {
    const encontrado = ctx.buscarTodas(ruta, DISPARADOR_DE_PR, 1)[0];
    if (encontrado) {
      disparador = { ruta, linea: encontrado.linea, extracto: encontrado.extracto };
      break;
    }
  }
  if (disparador) {
    hallazgos.push(detectado("ci", "ci.gatea_pr", true, [disparador]));
  } else {
    hallazgos.push(
      vacio(
        "ci",
        "ci.gatea_pr",
        workflows.map((ruta) => ({ ruta })),
        "Se leyeron todos los workflows y ninguno declara un disparador de pull request: corren en push, en " +
          "cron o a mano. Que el merge este protegido o no se decide en la configuracion del alojamiento, que " +
          "no vive en el arbol y por tanto no se puede detectar desde aqui.",
        false,
      ),
    );
  }

  return hallazgos;
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "ci", fase: "ci", detectar };
export default detector;

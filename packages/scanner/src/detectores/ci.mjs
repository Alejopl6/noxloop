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
  /** @type {Array<{ruta: string, linea: number, comando: string, lineas_del_bloque?: number}>} */
  const comandos = [];

  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(LINEA_DE_COMANDO);
    if (!m) continue;
    const sangria = m[1].length;
    const resto = m[2].trim();

    if (resto === "|" || resto === ">" || resto === "|-" || resto === ">-") {
      // UN BLOQUE `run: |` ES UN COMANDO, NO UNO POR LINEA.
      //
      // Esto empujaba CADA linea del bloque como si fuera un comando distinto.
      // Medido sobre el CI de este repositorio: 179 "comandos", de los cuales
      // 27 eran lineas de comentario (`# El glob era ...`), 18 eran control de
      // shell suelto (`fi`, `done`, `else`) y el resto, cuerpo de heredoc —
      // JavaScript dentro de un `node -e`, contado como si CI lo invocara.
      //
      // No es ruido que se pueda filtrar: es un modelo equivocado. CI ejecuta
      // ese bloque como UN paso, y partirlo en lineas inventa catorce comandos
      // donde hay uno. Filtrar comentarios solo bajaba a 134 — seguia mintiendo,
      // solo que menos.
      //
      // Por que importa mas de lo que parece: este hallazgo alimenta el
      // contexto del agente verificador. Con el modelo viejo, ese agente recibia
      // "el proyecto declara 137 comandos de verificacion" y entre ellos frases
      // en castellano de un comentario. Es contexto inventado con forma de dato
      // — el principio X, fabricado por un parser en vez de por un modelo.
      //
      // LO QUE SE PIERDE, y se declara: los comandos sueltos de dentro del
      // bloque. Recuperarlos exige interpretar shell —heredocs, continuaciones,
      // control de flujo— y un parser de shell a medias produce exactamente la
      // basura de arriba. El paso, que es la unidad que CI ejecuta, se puede
      // leer entero por su ruta y su linea.
      const cuerpo = [];
      let ultima = i;
      for (let j = i + 1; j < lineas.length; j++) {
        const linea = lineas[j];
        if (!linea.trim()) continue;
        const sangriaActual = linea.length - linea.trimStart().length;
        if (sangriaActual <= sangria) break;
        cuerpo.push(linea.trim());
        ultima = j;
      }
      if (cuerpo.length > 0) {
        // La primera linea con contenido nombra el paso: es lo que alguien
        // leeria para saber que hace. El resto se alcanza por ruta y linea.
        const primera = cuerpo.find((l) => !l.startsWith("#")) ?? cuerpo[0];
        comandos.push({
          ruta,
          linea: i + 1,
          comando: primera,
          lineas_del_bloque: cuerpo.length,
        });
      }
      i = ultima;
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

  /** @type {Array<{ruta: string, linea: number, comando: string, lineas_del_bloque?: number}>} */
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

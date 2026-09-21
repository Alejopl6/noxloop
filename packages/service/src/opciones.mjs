// El catalogo de lo que se puede elegir: los enums del dominio, con etiqueta,
// con lo que significa elegir cada uno, y con de donde sale la preseleccion.
//
// EL FALLO CONCRETO QUE CIERRA. Las pantallas de establecimiento pedian seis
// cosas que tienen un conjunto conocido —area de guideline, rol de agente, tipo
// de credencial, ambito, runtime, nivel de autonomia— y las pedian de dos
// formas, las dos malas:
//
//   - CAMPO DE TEXTO. «Runtime» era un `<input>` con la ayuda «este servicio
//     declara en /v1/capabilities: claude-agent-sdk, codex». O sea: la lista
//     estaba AHI, en la misma frase, y aun asi habia que teclearla. Un
//     `claude-agent` sin el sufijo es un agente guardado con un runtime que
//     ningun adaptador atiende, y el fallo no aparece hasta el primer ciclo.
//
//   - LISTA ESCRITA EN EL CLIENTE. `AREAS_DE_GUIDELINE` y `ROLES_DE_AGENTE`
//     viven hoy en `apps/studio/lib/tipos.ts`, copiadas del `CHECK` de la base.
//     Mientras las dos copias coincidan no se nota nada; el dia que el enum
//     crezca, la pantalla ofrece las de ayer y la nueva no existe para el
//     operador. Nadie ve un error: ve un desplegable completo al que le falta
//     una entrada.
//
// POR QUE LOS VALORES SALEN DE `ENUMS` Y LAS ETIQUETAS SE DECLARAN AQUI. Porque
// son dos cosas distintas. Los VALORES son el dominio y ya tienen un dueño —el
// esquema del almacen, que ademas los impone con un `CHECK`—; copiarlos seria
// crear la segunda copia que este archivo existe para eliminar. Las ETIQUETAS
// son producto: «tracker» no se le enseña a nadie, se enseña «Gestor de
// tickets». La union se comprueba en los dos sentidos: `delAlmacen()` rompe al
// arrancar si un valor del enum no tiene etiqueta, y tambien si hay una
// etiqueta para un valor que la base no acepta. Los dos casos acaban en la
// pantalla si nadie los mira — uno enseñando el identificador interno, el otro
// ofreciendo una opcion que el CHECK rechaza al guardar.
//
// POR QUE ESTO NO ES «UN ENDPOINT QUE DEVUELVE CONSTANTES». Tres de los grupos
// no son constantes en absoluto: los runtimes salen del registro de adaptadores
// que se inyecta al arrancar, los modelos de las capacidades que cada adaptador
// declara, y las preselecciones del proyecto que se este mirando. Y los que si
// son constantes viajan por el mismo sitio porque un cliente que tiene que
// saber cuales pedir aqui y cuales copiarse es un cliente que se copia todos.
//
// EL VOCABULARIO DE ORIGEN ES EL DEL SNAPSHOT, y no uno nuevo: `detectado` con
// su evidencia, `por_defecto` para lo que sale de una regla del dominio,
// `vacio` para el hueco que se declara, mas `declarado` para lo que es el
// contrato mismo. Un segundo vocabulario para la misma idea es densidad que el
// operador paga dos veces.

import { ENUMS } from "../../store/src/index.mjs";

import { exigirProyecto } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/**
 * Las etiquetas y lo que significa elegir cada valor.
 *
 * LA DESCRIPCION NO ES ADORNO en los grupos donde la eleccion decide algo que
 * no se puede deshacer mirando la pantalla. El rol de agente decide contra que
 * regla se valida la flota; el nivel de autonomia decide hasta donde llega el
 * sistema sin preguntar. Elegir eso a ciegas es elegir a ciegas lo unico que
 * sostiene la revision.
 *
 * @type {Record<string, Record<string, {etiqueta: string, descripcion?: string}>>}
 */
const VOCABULARIO = {
  "project.origen": {
    nuevo: {
      etiqueta: "Proyecto nuevo",
      descripcion:
        "No hay codigo todavia. Se prepara un destino vacio y la etapa de analisis se omite: no hay nada que escanear.",
    },
    local: {
      etiqueta: "Carpeta local",
      descripcion:
        "El codigo ya existe en esta maquina. Se lee para producir el snapshot y no se modifica ni un archivo.",
    },
    remoto: {
      etiqueta: "Repositorio remoto",
      descripcion:
        "El codigo vive en otro sitio y se clona a un area de trabajo propia. Necesita una credencial del gestor de repositorios con grant vigente.",
    },
  },

  "project.autonomia": {
    L0: {
      etiqueta: "L0 · cada paso se aprueba",
      descripcion:
        "Nada avanza sin una respuesta en la bandeja. Es donde empieza todo proyecto: el nivel se sube cuando el operador ya vio como trabaja la flota, no antes.",
    },
    L1: {
      etiqueta: "L1 · avanza y para en lo que importa",
      descripcion:
        "El ciclo corre solo y se detiene en las decisiones que el proyecto declaro peligrosas. Lo que no esta declarado, se pregunta.",
    },
    L2: {
      etiqueta: "L2 · hasta el pull request",
      descripcion:
        "El maximo que existe, y no por ahora: la autonomia de este producto termina en el pull request abierto. Ninguna decision de merge es del sistema.",
    },
  },

  "guideline.area": {
    frontend: { etiqueta: "Frontend", descripcion: "Como se escribe la superficie visual y sus componentes." },
    backend: { etiqueta: "Backend", descripcion: "Como se escriben los servicios, los datos y sus contratos." },
    testing: { etiqueta: "Testing", descripcion: "Que se prueba, con que runner y que cuenta como verde." },
    git: { etiqueta: "Git", descripcion: "Ramas, mensajes de commit y tamaño de un pull request." },
    seguridad: { etiqueta: "Seguridad", descripcion: "Secretos, dependencias y entrada que no es de fiar." },
    agentes: { etiqueta: "Agentes", descripcion: "Que puede hacer un agente en este repositorio y que no." },
    diseno: {
      etiqueta: "Diseno",
      descripcion:
        "Tokens, tipografia y movimiento. Es la unica omitible sin penalizacion: un proyecto sin superficie visual la deja vacia y no bloquea ninguna etapa.",
    },
  },

  "credential.tipo": {
    api_token: { etiqueta: "Token de API", descripcion: "Un token opaco que se manda en una cabecera." },
    tracker: { etiqueta: "Gestor de tickets", descripcion: "Lo que autoriza a leer y comentar work items." },
    scm: { etiqueta: "Gestor de repositorios", descripcion: "Lo que autoriza a clonar, empujar y abrir un pull request." },
    modelo: { etiqueta: "Proveedor de modelo", descripcion: "La clave con la que el runtime de un agente habla con su modelo." },
    ssh: { etiqueta: "Clave SSH", descripcion: "Un par de claves para acceso por SSH. Lo que se guarda es la privada." },
  },

  "credential.ambito": {
    global: {
      etiqueta: "Todo el workspace",
      descripcion:
        "Queda disponible para cualquier proyecto de este home. Disponible no es concedida: sin grant, ningun agente la alcanza.",
    },
    proyecto: {
      etiqueta: "Un solo proyecto",
      descripcion: "Queda atada a un proyecto concreto y no se puede conceder fuera de el.",
    },
  },

  // EL ORDEN DE LOS CUATRO ES EL DEL CICLO —quien planifica, quien escribe,
  // quien revisa, quien verifica— y no el del enum. Leidos en ese orden, los
  // cuatro se explican solos; en cualquier otro hay que leer las cuatro
  // descripciones para reconstruirlo.
  "agent.rol": {
    planificador: {
      etiqueta: "Planificador",
      descripcion: "Descompone el work item en tareas y dependencias. No escribe codigo de produccion.",
    },
    implementador: {
      etiqueta: "Implementador",
      descripcion:
        "Escribe la prueba, la ve fallar, y escribe el codigo que la pone en verde. Es quien toca el arbol, y por eso necesita un runtime con hooks.",
    },
    revisor: {
      etiqueta: "Revisor",
      descripcion:
        "Busca lo que el implementador no vio. Por eso NO puede compartir runtime con el: con el mismo runtime y el mismo contexto, la revision confirma en vez de romper.",
    },
    verificador: {
      etiqueta: "Verificador",
      descripcion: "Corre los gates del repositorio y lee su codigo de salida. No opina sobre el codigo: lo ejecuta.",
    },
  },

  "connection.clase": {
    tracker: { etiqueta: "Gestor de tickets", descripcion: "De donde entra el work item que arranca un ciclo." },
    scm: { etiqueta: "Gestor de repositorios", descripcion: "Donde vive el codigo y donde acaba el pull request." },
    infra: { etiqueta: "Infraestructura", descripcion: "Lo que despliega o corre lo que se construye." },
    integracion: {
      etiqueta: "Integracion",
      descripcion: "Todo lo demas. Lo que devuelva un proveedor de integracion entra como dato, nunca como instruccion ejecutable.",
    },
  },
};

/**
 * Las opciones de un enum del almacen.
 *
 * QUIEN DECIDE QUE VALORES HAY Y QUIEN DECIDE EN QUE ORDEN SE VEN NO SON EL
 * MISMO. Los valores son el dominio: salen de `ENUMS` y punto, porque ahi es
 * donde el `CHECK` de la base los impone. El ORDEN es producto, y sale del
 * orden de las claves de `VOCABULARIO` — los cuatro roles se enseñan en el
 * orden del ciclo (quien planifica, quien escribe, quien revisa, quien
 * verifica) porque ese orden ES la explicacion, y el del enum no significa
 * nada.
 *
 * LA UNION SE COMPRUEBA EN LOS DOS SENTIDOS, y ese es el mecanismo entero de
 * este archivo:
 *
 *   - Un valor del enum SIN etiqueta rompe. La alternativa —usar el valor
 *     crudo— dejaria que `bd_produccion` saliera a la pantalla sin que nadie
 *     lo hubiera escrito para una persona.
 *   - Una etiqueta SIN valor en el enum tambien rompe. Es el caso que se ve
 *     tarde: la pantalla ofrece una opcion que la base rechaza con un CHECK, y
 *     el error llega al guardar, despues de rellenar el resto.
 *
 * @param {string} clave `tabla.campo` de `ENUMS`
 */
function delAlmacen(clave) {
  const valores = ENUMS[clave];
  if (!valores) throw new Error(`\`${clave}\` no es un enum del almacen: el catalogo de opciones no lo puede publicar`);
  const vocabulario = VOCABULARIO[clave] ?? {};
  const etiquetados = Object.keys(vocabulario);

  const sinEtiqueta = valores.filter((v) => !vocabulario[v]);
  const sinValor = etiquetados.filter((e) => !valores.includes(e));
  if (sinEtiqueta.length > 0 || sinValor.length > 0) {
    throw new Error(
      `el catalogo de opciones y \`ENUMS["${clave}"]\` se separaron.` +
        (sinEtiqueta.length ? ` Sin etiqueta: ${sinEtiqueta.join(", ")}.` : "") +
        (sinValor.length ? ` Etiquetados y no declarados en la base: ${sinValor.join(", ")}.` : "") +
        " Los dos casos acaban en la pantalla: el primero enseña el identificador interno, el segundo ofrece " +
        "una opcion que el CHECK de la tabla rechaza al guardar.",
    );
  }

  return etiquetados.map((valor) => ({ valor, ...vocabulario[valor] }));
}

/**
 * Un grupo del catalogo, con la forma que TODOS comparten.
 *
 * `unica` LO CALCULA EL SERVICIO y no la pantalla, aunque la pantalla podria
 * contar. Es la regla «un select con una sola opcion no es un select, es un
 * dato»: si la decide cada sitio de llamada, se olvida en el cuarto.
 *
 * @param {{opciones: any[], origen: string, porque?: string, evidencia?: any, como_conseguirlo?: string, preseleccion?: any}} datos
 */
function grupo(datos) {
  return {
    opciones: datos.opciones,
    unica: datos.opciones.length === 1,
    origen: datos.origen,
    ...(datos.porque ? { porque: datos.porque } : {}),
    ...(datos.evidencia ? { evidencia: datos.evidencia } : {}),
    ...(datos.como_conseguirlo ? { como_conseguirlo: datos.como_conseguirlo } : {}),
    // `null` y no ausente: la pantalla pregunta siempre, y un campo que a veces
    // no esta obliga a distinguir «no hay preseleccion» de «este grupo no
    // preselecciona», que se ven igual desde el cliente.
    preseleccion: datos.preseleccion ?? null,
  };
}

/**
 * Un grupo que sale del contrato y de nada mas: los valores son los que son,
 * hoy y sin mirar nada.
 *
 * @param {string} clave
 * @param {any} [preseleccion]
 */
function declarado(clave, preseleccion) {
  return grupo({
    opciones: delAlmacen(clave),
    origen: "declarado",
    porque: `son los valores que el modelo de datos declara para \`${clave}\`, y los unicos que la base acepta.`,
    preseleccion,
  });
}

/**
 * Los runtimes REGISTRADOS, que no es lo mismo que los disponibles.
 *
 * LA DISTINCION ES LA MISMA QUE HACE `/v1/capabilities` y por el mismo motivo:
 * lo que se puede afirmar es que el adaptador esta registrado —el registro
 * valida su contrato al admitirlo, que es un hecho comprobable— y no que su
 * binario este instalado, que solo lo contesta `preflight` y no se puede
 * preguntar desde un `GET` sin lanzar procesos.
 *
 * Y CADA UNO DICE LO QUE NO PUEDE. Un runtime sin hooks no es elegible como
 * implementador: el paso RED del principio I depende de un hook, y sin el
 * depende de que el prompt se acuerde. Eso lo rechaza el modelo de flota AL
 * GUARDAR; decirlo despues de que el operador haya rellenado nueve campos
 * cuesta el viaje entero y la confianza en lo siguiente que se le proponga.
 *
 * @param {any} dep
 */
function runtimes(dep) {
  if (!dep.adaptadores) {
    return grupo({
      opciones: [],
      origen: "vacio",
      porque: dep.ausenciaDeAdaptadores.porque,
      como_conseguirlo: dep.ausenciaDeAdaptadores.comoConseguirlo,
    });
  }

  const opciones = dep.adaptadores.ids().map((/** @type {string} */ id) => {
    const caps = dep.adaptadores.capacidades(id) ?? {};
    const notas = [];
    if (caps.hooks === false) {
      notas.push(
        "no tiene mecanismo de hooks, asi que no es elegible como implementador: sin el hook del paso RED, " +
          "que la prueba se vea fallar antes de escribir el codigo depende de que el prompt se acuerde",
      );
    }
    if (caps.cost === false) {
      notas.push("no reporta gasto, asi que un techo en USD no se le puede aplicar y el limite se pone por intentos y por tiempo");
    }
    if (caps.resume === false) {
      notas.push("no retoma sesion: cada fase empieza de cero, sin el contexto acumulado de la anterior");
    }
    return {
      valor: id,
      etiqueta: id,
      capacidades: caps,
      // Los modelos que ESE runtime enumera. `"desconocido"` es una respuesta
      // legitima del contrato —un runtime cuyos modelos cambian sin que este
      // repositorio se entere— y se propaga tal cual: una lista corta inventada
      // aqui haria que la pantalla ofreciera solo esos.
      modelos: Array.isArray(caps.models) ? caps.models : [],
      modelos_enumerados: Array.isArray(caps.models),
      ...(notas.length > 0 ? { nota: notas.join(". ") + "." } : {}),
    };
  });

  return grupo({
    opciones,
    origen: "detectado",
    porque:
      "son los adaptadores registrados en este servicio. Registrados, no disponibles: el registro comprueba el " +
      "contrato de cada uno al admitirlo, pero que su binario este instalado solo lo contesta el preflight.",
    evidencia: `registro de adaptadores inyectado al arrancar: ${dep.adaptadores.ids().join(", ")}`,
  });
}

/**
 * De donde sale la preseleccion de area, cuando hay snapshot.
 *
 * SOLO SE PRESELECCIONA LO QUE EL PROYECTO RESPALDA. Es la tentacion evidente
 * —poner `frontend` porque es la primera de la lista— y es exactamente el
 * contexto inventado que el principio X prohibe: el operador lee una
 * preseleccion como una recomendacion, y una recomendacion sin nada detras se
 * acepta igual que una con todo detras.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function areaSugerida(dep, proyecto) {
  const fila = dep.almacen.base.consultarUno(
    "SELECT id FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
    [proyecto.id],
  );
  if (!fila) return null;

  // Las claves del scanner que respaldan un area. Cada una es un hallazgo con
  // evidencia en el arbol, no una correlacion: `testing.runner` es literalmente
  // el runner que el repositorio declara.
  /** @type {Array<{area: string, claves: string[]}>} */
  const POR_AREA = [
    { area: "testing", claves: ["testing.runner", "testing.proporcion"] },
    { area: "agentes", claves: ["agentes.instrucciones", "agentes.hooks", "agentes.skills"] },
    { area: "git", claves: ["ci.workflows", "ci.gatea_pr"] },
    { area: "seguridad", claves: ["riesgos.secreto", "riesgos.env_versionado"] },
  ];

  for (const { area, claves } of POR_AREA) {
    const filas = dep.almacen.base.consultar(
      `SELECT clave, valor, valor_corregido, evidencia FROM snapshot_finding WHERE snapshot_id = ? AND clave IN (${claves
        .map(() => "?")
        .join(", ")})`,
      [fila.id, ...claves],
    );

    for (const hallazgo of filas) {
      // QUE CUENTA COMO HALLAZGO Y QUE COMO HUECO, con la MISMA definicion que
      // usan la flota sugerida y el bootstrap: un hallazgo cuyo valor es nulo,
      // una lista vacia o una cadena en blanco es el scanner diciendo «se busco
      // aqui y no habia», y no respalda nada — aunque su `origen` diga
      // `detectado`. Leer un hueco como un hallazgo es el principio X al reves.
      //
      // Y SE MIRA EN EL VALOR Y NO EN UNA COLUMNA `motivo`, que es donde la
      // primera version de esta funcion lo buscaba: esa columna no existe en
      // `snapshot_finding` —el motivo del hueco solo vive en la forma en
      // memoria que produce el scanner— y la consulta moria con `no such
      // column: motivo`. No fallaba en ningun test porque ninguno llegaba aqui
      // con un snapshot de verdad detras; salio pegandole con curl.
      //
      // `valor_corregido` GANA cuando lo hay, por lo mismo que en el nucleo: lo
      // que vale es lo que el operador corrigio a mano.
      let valor;
      try {
        valor = JSON.parse(String(hallazgo.valor_corregido ?? hallazgo.valor));
      } catch {
        continue;
      }
      if (valor === null || valor === undefined) continue;
      if (Array.isArray(valor) && valor.length === 0) continue;
      if (typeof valor === "string" && valor.trim().length === 0) continue;
      if (typeof valor === "object" && !Array.isArray(valor) && Object.keys(valor).length === 0) continue;

      let evidencia = [];
      try {
        evidencia = JSON.parse(String(hallazgo.evidencia)).slice(0, 3);
      } catch {
        // Una evidencia con JSON roto no puede tumbar la preseleccion: se
        // preselecciona igual y se dice de que hallazgo sale.
      }
      // Un `detectado` sin evidencia no se declara detectado. La base ya lo
      // impide con un CHECK, y aqui se comprueba igual: esta funcion tambien
      // mira hallazgos `inferido` y `declarado`, que no llevan esa guarda.
      if (evidencia.length === 0) continue;

      return {
        valor: area,
        origen: "detectado",
        porque:
          `el snapshot de este proyecto trae \`${hallazgo.clave}\`, que es un hecho del arbol sobre el area de ` +
          `${area}. Es la primera area que el proyecto respalda por si mismo; las demas siguen ahi y se eligen igual.`,
        evidencia,
      };
    }
  }
  return null;
}

/**
 * `GET /v1/options?project_id=`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function catalogoDeOpciones(p) {
  const pedido = p.url.searchParams.get("project_id");
  // Se EXIGE que exista en vez de ignorarlo. Un `project_id` ignorado devuelve
  // el catalogo generico con 200 y con aspecto de respuesta buena: quien lo
  // mira cree que las preselecciones son de su proyecto y no lo son.
  const proyecto = pedido ? exigirProyecto(p.dep, pedido) : null;

  const area = proyecto ? areaSugerida(p.dep, proyecto) : null;

  return {
    cuerpo: {
      // El proyecto sobre el que se calcularon las preselecciones, dicho en la
      // respuesta: sin esto no hay forma de distinguir un catalogo generico de
      // uno que se pidio para otro proyecto y quedo en una cache.
      proyecto: proyecto ? { id: proyecto.id, nombre: proyecto.nombre } : null,

      grupos: {
        "project.origen": declarado("project.origen"),

        "project.autonomia": declarado(
          "project.autonomia",
          proyecto
            ? {
                valor: proyecto.autonomia,
                origen: "detectado",
                porque: `es el nivel que el proyecto \`${proyecto.nombre}\` tiene guardado ahora mismo.`,
                evidencia: [],
              }
            : {
                valor: ENUMS["project.autonomia"][0],
                origen: "por_defecto",
                porque:
                  "todo proyecto empieza en el nivel mas bajo. No sale de leer nada: es la regla del dominio, y " +
                  "subirlo es una decision que se toma habiendo visto trabajar a la flota.",
                evidencia: [],
              },
        ),

        "guideline.area": declarado("guideline.area", area),

        "credential.tipo": declarado("credential.tipo"),

        "credential.ambito": declarado(
          "credential.ambito",
          proyecto
            ? {
                valor: "proyecto",
                origen: "por_defecto",
                porque:
                  `esta pantalla se abrio sobre \`${proyecto.nombre}\`, y el ambito mas estrecho es el que menos ` +
                  "alcance concede si la credencial se filtra. Ampliarlo a todo el workspace es una decision, " +
                  "no un valor inicial.",
                evidencia: [],
              }
            : {
                valor: "global",
                origen: "por_defecto",
                porque:
                  "no hay ningun proyecto delante al que atarla, asi que el unico ambito que se puede guardar es " +
                  "el del workspace.",
                evidencia: [],
              },
        ),

        "agent.rol": declarado("agent.rol"),

        "agent.runtime": runtimes(p.dep),

        "connection.clase": declarado("connection.clase"),
      },
    },
  };
}

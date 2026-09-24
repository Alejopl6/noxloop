// `GET /v1/folders` — el explorador de carpetas, y las cuatro cosas que tiene
// que negarse a hacer.
//
// EL FALLO CONCRETO QUE CIERRA LA RUTA. Dar de alta un proyecto exigia ESCRIBIR
// la ruta a mano. En escritorio hay dialogo nativo; en el navegador no, porque
// el navegador no le entrega a una pagina la ruta de una carpeta del disco. Se
// dejo un campo de texto y ahi quedo: el operador que abre la consola en el
// navegador tiene que saberse de memoria la ruta absoluta de su repositorio y
// escribirla sin equivocarse. El servicio corre en SU maquina y puede leer el
// disco — la carpeta estaba a una llamada de distancia y nadie la hizo.
//
// Y EL FALLO QUE LA RUTA PODRIA ABRIR, que es por lo que estos tests son mas
// que «lista un directorio». Esto es un lector del sistema de archivos que
// contesta a peticiones de una pagina web. El token y la allowlist de origen
// cierran el caso general (ver `puerta.mjs`), pero una ruta que enumera todo el
// disco convierte cualquier fallo futuro de esa puerta en la lectura completa
// del equipo del operador. Por eso se acota aqui tambien, y por eso se mide:
//
//   1. Solo DIRECTORIOS. Los archivos se cuentan, no se nombran.
//   2. Solo dentro de las RAICES declaradas. `/` no es una raiz.
//   3. Ni por `..` ni por un enlace simbolico se sale de ellas.
//   4. Las ocultas no se listan por defecto, y se dice cuantas se omitieron.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { carpetaDePrueba, conServicio, diferencias, huellaDelArbol, pedir, repoDePrueba } from "./ayuda.mjs";

/**
 * `realpath` en las rutas de prueba, por lo mismo que `arrancar` lo hace con el
 * home: en macOS `/var` es un enlace a `/private/var`, asi que la ruta que
 * devuelve `mkdtemp` y la que el servicio lee NO se escriben igual. Sin esto,
 * los tests compararian dos formas del mismo directorio y fallarian por una
 * diferencia que no existe en el disco.
 *
 * @param {string} ruta
 */
const real = (ruta) => realpathSync(ruta);

/** El arbol de trabajo de un operador: dos repositorios, una carpeta suelta y un archivo. */
function escritorioDePrueba() {
  const raiz = real(carpetaDePrueba());
  for (const nombre of ["proyecto-uno", "proyecto-dos"]) {
    execFileSync("git", ["init", "--quiet", join(raiz, nombre)], { stdio: "ignore" });
  }
  mkdirSync(join(raiz, "solo-una-carpeta"));
  mkdirSync(join(raiz, ".oculta"));
  writeFileSync(join(raiz, "notas-personales.txt"), "nada que ver aqui\n");
  return raiz;
}

const carpetas = async (svc, consulta = "") =>
  (await pedir(svc, `/v1/folders${consulta}`)).json();

test("solo devuelve directorios: los archivos se cuentan, no se nombran", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    const nombres = cuerpo.items.map((/** @type {any} */ i) => i.nombre);

    assert.ok(
      !nombres.includes("notas-personales.txt"),
      "un archivo aparecio en la lista: los nombres de los documentos del operador no tienen por que " +
        `viajar por HTTP para contestar «que carpeta es tu proyecto». Salio: ${nombres.join(", ")}`,
    );
    assert.equal(cuerpo.archivos, 1, "el archivo se omitio sin contarlo: una lista recortada en silencio miente");
  });
});

test("dice cuales son repositorios git, con la evidencia que lo respalda", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    const porNombre = new Map(cuerpo.items.map((/** @type {any} */ i) => [i.nombre, i]));

    const uno = porNombre.get("proyecto-uno");
    assert.equal(uno.es_repositorio, true);
    assert.equal(uno.procedencia.origen, "detectado");
    assert.equal(
      uno.procedencia.evidencia[0].ruta,
      join(raiz, "proyecto-uno", ".git"),
      "un `detectado` sin la ruta que lo respalda es lo que el principio X prohibe",
    );

    const suelta = porNombre.get("solo-una-carpeta");
    assert.equal(suelta.es_repositorio, false);
    assert.equal(suelta.procedencia.origen, "vacio");
    assert.ok(
      suelta.procedencia.porque.length > 20,
      "un `vacio` sin motivo se lee como «no se miro», y aqui si se miro",
    );
  });
});

test("las ocultas no se listan por defecto, y se dice cuantas se omitieron", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    assert.ok(!cuerpo.items.some((/** @type {any} */ i) => i.nombre === ".oculta"));
    assert.equal(cuerpo.omitidas.ocultas, 1, "omitir sin contar convierte la lista en una verdad a medias");

    const conOcultas = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}&ocultas=si`);
    assert.ok(conOcultas.items.some((/** @type {any} */ i) => i.nombre === ".oculta"));
  });
});

test("en la raiz no hay a donde subir, y se dice con `padre: null`", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    assert.equal(cuerpo.padre, null, "con un padre no nulo la interfaz pinta un boton de subir que da 403");
    assert.equal(cuerpo.es_raiz, true);

    const dentro = await carpetas(svc, `?ruta=${encodeURIComponent(join(raiz, "proyecto-uno"))}`);
    assert.equal(dentro.padre, raiz);
    assert.equal(dentro.es_raiz, false);
  });
});

test("no se puede salir de las raices: ni con una ruta de fuera, ni con `..`", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    for (const intento of ["/", "/etc", join(raiz, "..", ".."), join(raiz, "proyecto-uno", "..", "..", "..")]) {
      const r = await pedir(svc, `/v1/folders?ruta=${encodeURIComponent(intento)}`);
      assert.equal(r.status, 403, `\`${intento}\` no se rechazo: el explorador se convirtio en un lector del disco`);
      const { error } = await r.json();
      assert.equal(error.codigo, "ruta_fuera_del_alcance");
      assert.ok(
        error.causa.includes(raiz),
        "el rechazo no nombra las raices, asi que el operador no sabe por donde SI puede navegar",
      );
    }
  });
});

test("un enlace que apunta fuera de las raices no se lista: es una puerta, no una carpeta", async () => {
  const raiz = escritorioDePrueba();
  const fuera = real(carpetaDePrueba());
  mkdirSync(join(fuera, "lo-que-no-deberia-verse"));
  symlinkSync(fuera, join(raiz, "atajo-a-fuera"));

  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    assert.ok(
      !cuerpo.items.some((/** @type {any} */ i) => i.nombre === "atajo-a-fuera"),
      "un enlace a fuera de las raices se listo: entrar en el deja el explorador leyendo cualquier sitio del disco",
    );
    assert.equal(cuerpo.omitidas.enlaces_fuera, 1);

    // Y tampoco se entra escribiendo su ruta: `realpath` lo resuelve antes de comparar.
    const r = await pedir(svc, `/v1/folders?ruta=${encodeURIComponent(join(raiz, "atajo-a-fuera"))}`);
    assert.equal(r.status, 403);
  });
});

test("un proyecto dado de alta fuera de las raices es raiz por si mismo", async () => {
  const raiz = escritorioDePrueba();
  const repoLejos = real(repoDePrueba());
  mkdirSync(join(repoLejos, "un-subdirectorio"));

  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    // Antes del alta, esa ruta esta fuera de alcance.
    const antes = await pedir(svc, `/v1/folders?ruta=${encodeURIComponent(repoLejos)}`);
    assert.equal(antes.status, 403);

    await pedir(svc, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origen: "local", nombre: "El De Lejos", ruta_local: repoLejos }),
    });

    const despues = await pedir(svc, `/v1/folders?ruta=${encodeURIComponent(repoLejos)}`);
    assert.equal(
      despues.status,
      200,
      "un proyecto que ya se gestiona sigue fuera de alcance: no se puede navegar por el propio proyecto",
    );
    const cuerpo = await despues.json();
    assert.equal(cuerpo.es_raiz, true, "el proyecto es raiz: subir por encima de el no lo autorizo nadie");
    assert.ok(cuerpo.raices.some((/** @type {any} */ r) => r.ruta === repoLejos));
  });
});

test("una carpeta ya dada de alta se marca con el proyecto que la gestiona", async () => {
  const raiz = real(carpetaDePrueba());
  const repo = join(raiz, "ya-dado-de-alta");
  execFileSync("git", ["init", "--quiet", repo], { stdio: "ignore" });

  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    await pedir(svc, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origen: "local", nombre: "Ya Esta", ruta_local: repo }),
    });

    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    const fila = cuerpo.items.find((/** @type {any} */ i) => i.nombre === "ya-dado-de-alta");
    assert.equal(
      fila.proyecto.nombre,
      "Ya Esta",
      "sin esto, el operador vuelve a dar de alta la misma carpeta y el servicio la rechaza por slug repetido",
    );
  });
});

test("una carpeta que no existe se dice, con la accion", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const r = await pedir(svc, `/v1/folders?ruta=${encodeURIComponent(join(raiz, "esta-no-esta"))}`);
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.equal(error.codigo, "carpeta_inexistente");
    assert.ok(error.accion.length > 20);
  });
});

test("sin `ruta` contesta desde la primera raiz, no desde el disco entero", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc);
    assert.equal(cuerpo.ruta, raiz);
    assert.equal(cuerpo.es_raiz, true);
  });
});

test("sin raices inyectadas, la raiz es el home del operador y NUNCA el disco entero", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await carpetas(svc);
    assert.equal(
      cuerpo.ruta,
      realpathSync(homedir()),
      "el valor por defecto dejo de ser el home: si alguna vez es `/`, esta ruta enumera el equipo entero",
    );
  });
});

test("leer carpetas no escribe nada: ni en el arbol que lista ni en el home del servicio", async () => {
  const raiz = escritorioDePrueba();
  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const arbolAntes = huellaDelArbol(raiz);
    const homeAntes = huellaDelArbol(svc.home);

    await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}`);
    await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}&ocultas=si`);

    assert.deepEqual(diferencias(arbolAntes, huellaDelArbol(raiz)), [], "listar toco el arbol del operador");
    assert.deepEqual(diferencias(homeAntes, huellaDelArbol(svc.home)), [], "listar escribio en el home");
  });
});

test("una carpeta con mas entradas que el limite lo dice en vez de recortar en silencio", async () => {
  const raiz = real(carpetaDePrueba());
  for (let i = 0; i < 12; i++) mkdirSync(join(raiz, `carpeta-${String(i).padStart(2, "0")}`));

  await conServicio({ raicesDeExploracion: [raiz] }, async (svc) => {
    const cuerpo = await carpetas(svc, `?ruta=${encodeURIComponent(raiz)}&limite=5`);
    assert.equal(cuerpo.items.length, 5);
    assert.equal(cuerpo.hay_mas, true);
    assert.equal(cuerpo.total, 12);
    assert.ok(
      cuerpo.avisos.some((/** @type {any} */ a) => a.codigo === "carpeta_recortada"),
      "se recorto sin aviso: la pantalla presenta cinco carpetas como si fueran todas las que hay",
    );
  });
});

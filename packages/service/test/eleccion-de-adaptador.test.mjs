// Que adaptador de conexiones monta el servicio, y por que los dos.
//
// EL FALLO QUE ESTO IMPIDE. Hasta hoy el ejecutable montaba solo el adaptador
// `local`, y el alojado era un hueco. Al llenarlo, la tentacion es cambiar uno
// por el otro — y eso convierte la mejora en una regresion: el operador que
// levanta los contenedores para poder usar OAuth PIERDE de la pantalla Azure
// DevOps, Vercel y el GitHub de token personal, porque la pantalla solo ofrece
// lo que atiende el adaptador montado.
//
// LO QUE SE PIDIO, con estas palabras: «el token personal deja de ser el camino
// por defecto y pasa a ser la alternativa para quien no quiera contenedores».
// Alternativa, no desaparicion.
//
// Y LA OTRA MITAD: sin el servidor de integraciones levantado, el producto
// sigue entero. No hay error, no hay aviso rojo: hay un camino menos, declarado.

import { test } from "node:test";
import assert from "node:assert/strict";

import { elegirProveedorDeConexiones, LEE_DEL_ENTORNO } from "../src/proveedor-de-conexiones.mjs";

/** Una boveda que no hace nada: lo que se prueba aqui es la eleccion. */
const bovedaFalsa = {
  async registrar() {
    return { credencial: { id: "c1", ref_boveda: "r1" } };
  },
  async otorgar() {
    return { id: "g1" };
  },
  async recuperar() {
    return "valor";
  },
  async borrar() {},
  async revocar() {},
};

const piezas = { boveda: bovedaFalsa, workspace: { id: "espacio-1" } };

test("EL INVARIANTE: sin el servidor de integraciones configurado, se monta el local y el producto sigue entero", () => {
  const proveedor = elegirProveedorDeConexiones({ ...piezas, entorno: {} });
  assert.equal(proveedor.id, "local", "sin configuracion se monto algo que no es el camino sin contenedores");
  assert.equal(proveedor.ids, undefined, "se envolvio un solo adaptador, y envolver uno solo le quita lo suyo");
});

test("con el servidor configurado se montan LOS DOS, y el principal es el alojado", () => {
  const proveedor = elegirProveedorDeConexiones({
    ...piezas,
    entorno: { NOXLOOP_NANGO_URL: "http://localhost:3003", NOXLOOP_NANGO_SECRET_KEY: "una-clave" },
  });
  assert.deepEqual(proveedor.ids, ["nango", "local"]);
  assert.equal(proveedor.id, "nango", "el principal tiene que ser el alojado: es el camino por defecto");
});

test("con los dos montados, el catalogo NO pierde los proveedores de token personal", async () => {
  // La medida exacta de la regresion que esto impide: los tres proveedores que
  // funcionaban antes tienen que seguir en el catalogo, y ademas entran los de
  // OAuth. Si alguien cambia un adaptador por el otro, esta prueba lo dice con
  // los slugs delante.
  const proveedor = elegirProveedorDeConexiones({
    ...piezas,
    entorno: { NOXLOOP_NANGO_URL: "http://localhost:3003", NOXLOOP_NANGO_SECRET_KEY: "una-clave" },
  });
  const catalogo = await proveedor.catalogo();
  const slugs = catalogo.map((e) => e.slug);
  for (const slug of ["github-pat", "azure-devops", "vercel"]) {
    assert.ok(slugs.includes(slug), `'${slug}' desaparecio del catalogo al montar el adaptador alojado`);
  }
  for (const slug of ["github", "linear", "jira"]) {
    assert.ok(slugs.includes(slug), `'${slug}' no aparecio pese a montar el adaptador que lo atiende`);
  }

  // Y cada entrada dice quien la atiende, que es lo que la pantalla compara.
  const porSlug = Object.fromEntries(catalogo.map((e) => [e.slug, e]));
  assert.equal(porSlug.github.adaptador, "nango");
  assert.equal(porSlug["github-pat"].adaptador, "local");
});

test("sin boveda no hay adaptador local, y con el servidor configurado se monta el alojado solo", () => {
  // El alojado guarda los valores en SU servidor, no en el llavero del sistema:
  // no necesita boveda. Que la ausencia de boveda deje al operador sin ningun
  // camino teniendo los contenedores levantados seria perder el unico que si
  // funciona.
  const proveedor = elegirProveedorDeConexiones({
    boveda: null,
    workspace: { id: "espacio-1" },
    entorno: { NOXLOOP_NANGO_URL: "http://localhost:3003", NOXLOOP_NANGO_SECRET_KEY: "una-clave" },
  });
  assert.equal(proveedor.id, "nango");
});

test("sin boveda y sin servidor configurado no hay proveedor, y eso es `null`, no un objeto a medias", () => {
  assert.equal(elegirProveedorDeConexiones({ boveda: null, workspace: { id: "e" }, entorno: {} }), null);
});

test("la direccion sin la clave no monta el alojado a medias: falta un dato y se dice", () => {
  // Montarlo sin clave lo dejaria contestando 401 `invalid_env` en cada
  // llamada, y ese mensaje no menciona ninguna clave ni ningun archivo.
  const proveedor = elegirProveedorDeConexiones({
    ...piezas,
    entorno: { NOXLOOP_NANGO_URL: "http://localhost:3003" },
  });
  assert.equal(proveedor.id, "local", "se monto el alojado sin la clave secreta con la que autoriza");
});

test("las variables del entorno estan declaradas con su nombre y para que sirve cada una", () => {
  // Va en una constante exportada y no en un `process.env` suelto porque es lo
  // que la ayuda del ejecutable imprime: una variable que solo existe dentro de
  // un `if` no se puede documentar sin copiarla a mano a otro sitio.
  const nombres = LEE_DEL_ENTORNO.map((v) => v.nombre);
  assert.ok(nombres.includes("NOXLOOP_NANGO_URL"));
  assert.ok(nombres.includes("NOXLOOP_NANGO_SECRET_KEY"));
  for (const variable of LEE_DEL_ENTORNO) {
    assert.ok(variable.para, `\`${variable.nombre}\` no dice para que sirve`);
    assert.ok(variable.donde, `\`${variable.nombre}\` no dice de donde se saca su valor`);
  }
});

test("ninguna salida de este modulo lleva el valor de la clave secreta", () => {
  const CENTINELA = `centinela-clave-${Math.random().toString(36).slice(2)}`;
  const proveedor = elegirProveedorDeConexiones({
    ...piezas,
    entorno: { NOXLOOP_NANGO_URL: "http://localhost:3003", NOXLOOP_NANGO_SECRET_KEY: CENTINELA },
  });
  assert.equal(
    JSON.stringify({ id: proveedor.id, ids: proveedor.ids, servidor: proveedor.servidor, declarado: LEE_DEL_ENTORNO }).includes(
      CENTINELA,
    ),
    false,
    "el proveedor montado expone la clave secreta del servidor de integraciones",
  );
});

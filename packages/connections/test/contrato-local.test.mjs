// T153 · el adaptador `local`: PAT y claves de API contra la boveda del sistema
// operativo, y el ciclo entero sin un solo contenedor.
//
// POR QUE LA PRUEBA MONTA LA BOVEDA DE VERDAD Y NO UN DOBLE. `local` no es un
// plan B: es el camino correcto para los proveedores que no usan OAuth. Lo que
// hay que demostrar no es que el adaptador llame a los metodos que le pusimos
// delante, sino que un PAT entra por la interfaz, queda guardado donde tiene que
// quedar y vuelve a salir para inyectarlo — con la boveda real, sus grants y su
// auditoria. Con un doble, la prueba pasaria igual el dia que el adaptador pida
// la credencial sin grant y la boveda se la niegue.
//
// El import sale del paquete A PROPOSITO y solo aqui: `src/` no importa la
// boveda —la recibe inyectada— y hay una prueba que lo prohibe
// (`paquete-autocontenido.test.mjs`). Esto es codigo de prueba, que no viaja al
// escritorio, y es el mismo patron que usa el motor con `providers/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chequeosDeContrato } from "../src/contrato.mjs";
import { crearAdaptadorLocal } from "../src/adaptadores/local.mjs";
import { CATALOGO_POR_DEFECTO } from "../src/catalogo.mjs";
import { ErrorDeConexion } from "../src/errores.mjs";
import { centinela, relojDePrueba, trozoDelCentinela } from "./ayuda.mjs";

import { crearBoveda } from "../../vault/src/boveda.mjs";
import { repositorioEnMemoria as repositorioDeBoveda } from "../../vault/src/repositorio.mjs";
import { crearAuditoria } from "../../vault/src/auditoria.mjs";
import { crearBackendDeArchivo } from "../../vault/src/backends/archivo.mjs";

const SECRETO = centinela("pat-local");

/** Monta la boveda real sobre un archivo cifrado en un temporal. Sin Docker. */
function bovedaReal() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-conexiones-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "credenciales.cifrado"),
    passphrase: "frase-de-prueba",
    motivo: "prueba: el llavero del sistema operativo no se ejercita en CI",
  });
  return crearBoveda({ backend, repositorio: repositorioDeBoveda(), auditoria: crearAuditoria() });
}

/**
 * La boveda real, envuelta para contar lecturas y para poder tirarla. Lo que se
 * cuenta es cuantas veces el ADAPTADOR fue a buscar el valor: es la unica forma
 * de distinguir "no cachea" de "devuelve lo que guardo la primera vez".
 */
function bovedaInstrumentada() {
  const real = bovedaReal();
  const estado = { lecturas: 0, caida: null };
  const caerSiHayQue = () => {
    if (estado.caida) throw new Error(estado.caida);
  };
  return {
    estado,
    boveda: {
      async registrar(datos) {
        caerSiHayQue();
        return await real.registrar(datos);
      },
      async otorgar(datos) {
        caerSiHayQue();
        return await real.otorgar(datos);
      },
      async recuperar(ref, motivo) {
        caerSiHayQue();
        estado.lecturas += 1;
        return await real.recuperar(ref, motivo);
      },
      async borrar(ref) {
        caerSiHayQue();
        return await real.borrar(ref);
      },
      async revocar(grantId) {
        caerSiHayQue();
        return await real.revocar(grantId);
      },
    },
  };
}

function fixturesLocales() {
  return {
    projectId: "proyecto-1",
    slugSinOauth: "azure-devops",
    valores: { organizacion: "una-organizacion", pat: SECRETO },
    centinela: SECRETO,
    slugOauth2: null,
    sinContenedores: true,
    llamada: { metodo: "GET", ruta: "/_apis/projects" },
    montar() {
      const { boveda, estado } = bovedaInstrumentada();
      const { reloj, avanzar } = relojDePrueba();
      const proveedor = crearAdaptadorLocal({
        boveda,
        workspaceId: "espacio-de-prueba",
        reloj,
        dormir: async (ms) => avanzar(ms),
        // Sin red: la peticion llega grabada. Un adaptador que necesite una
        // cuenta para probarse no lo puede correr quien adopte el proyecto.
        peticion: async (url, init) =>
          new Response(JSON.stringify({ url, autorizacion: typeof init?.headers?.Authorization }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });
      return {
        proveedor,
        avanzar,
        lecturas: () => estado.lecturas,
        caer: (causa = "el llavero del sistema no responde") => {
          estado.caida = causa;
        },
        levantar: () => {
          estado.caida = null;
        },
      };
    },
  };
}

test("el adaptador local pasa la suite de contrato", async (t) => {
  const fx = fixturesLocales();
  for (const chequeo of chequeosDeContrato(fx)) {
    await t.test(chequeo.name, async () => {
      await chequeo.run();
    });
  }
});

test("EL INVARIANTE: el ciclo entero —conectar, usar, revocar— se completa sin un solo contenedor", async () => {
  const fx = fixturesLocales();
  const { proveedor, lecturas } = fx.montar();

  const estado = await proveedor.preflight();
  assert.equal(estado.ok, true, JSON.stringify(estado.problemas));
  assert.deepEqual(
    estado.requisitos.filter((r) => r.tipo === "contenedor"),
    [],
    "el adaptador local declaro un contenedor: entonces no es el camino sin Docker",
  );

  const alta = await proveedor.conectar({ projectId: fx.projectId, slug: "azure-devops", valores: fx.valores });
  assert.equal(alta.url, undefined, "un PAT no tiene nada que autorizar en un navegador");
  assert.equal(alta.conexion.estado, "conectada", "con PAT la conexion queda lista de inmediato");

  const viva = await proveedor.credenciales(alta.conexion.id);
  assert.equal(viva.valores.AZURE_DEVOPS_PAT, SECRETO, "el valor no volvio de la boveda");
  assert.equal(viva.valores.AZURE_DEVOPS_ORG, "una-organizacion");
  assert.ok(lecturas() >= 1, "el valor salio de algun sitio que no es la boveda");

  const respuesta = await proveedor.llamar({
    conexionId: alta.conexion.id,
    metodo: "GET",
    ruta: "/_apis/projects",
  });
  assert.equal(respuesta.estado, 200);
  assert.equal(trozoDelCentinela(respuesta, SECRETO), null, "la llamada devolvio el token a quien la pidio");

  await proveedor.revocar(alta.conexion.id);
  await assert.rejects(
    () => proveedor.credenciales(alta.conexion.id),
    (e) => e instanceof ErrorDeConexion && typeof e.causa === "string" && e.causa.length > 0,
  );
});

test("el catalogo de `local` no ofrece oauth2: ese camino no es suyo", async () => {
  // El reparto lo decide el modo, no el operador. Si `local` ofreciera un
  // proveedor oauth2, alguien lo conectaria por aqui y el flujo moriria a mitad
  // sin que nadie supiera por que.
  const { proveedor } = fixturesLocales().montar();
  const catalogo = await proveedor.catalogo();
  assert.deepEqual(catalogo.filter((p) => p.modo === "oauth2"), []);
  assert.ok(catalogo.length > 0, "el catalogo de local quedo vacio");

  const soloOauth = CATALOGO_POR_DEFECTO.filter((p) => p.modo === "oauth2").map((p) => p.slug);
  for (const slug of soloOauth) {
    await assert.rejects(
      () => proveedor.conectar({ projectId: "p", slug, valores: {} }),
      (e) => {
        assert.equal(e.codigo, "proveedor_desconocido");
        assert.ok(e.accion, `conectar ${slug} por local fallo sin decir que hacer`);
        return true;
      },
    );
  }
});

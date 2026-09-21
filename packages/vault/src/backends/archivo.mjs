// El respaldo cifrado: headless, contenedor y CI (T132).
//
// CUANDO ES EL UNICO CAMINO. `keyring` necesita un Secret Service vivo, y en un
// servidor sin sesion grafica no lo hay. Sin este backend, la alternativa real
// no es "usar el llavero": es que el operador ponga el token en una variable de
// entorno del servicio, que es peor que un archivo cifrado en todo menos en lo
// rapido que se hace.
//
// QUE PROTEGE Y QUE NO. Protege el archivo en reposo: un respaldo que se copia,
// un disco que se pierde, el `cat` de otro usuario de la misma maquina (de ahi
// el 0600). No protege contra quien tenga a la vez el archivo y la frase de
// paso. Esa diferencia con el llavero es justo lo que `elegirBackend` obliga a
// declarar en vez de dejar que se descubra sola.
//
// AES-256-GCM y no CBC porque GCM autentica: un archivo manipulado tiene que
// fallar al abrirse, no descifrar a basura y mandarle esa basura al subproceso.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { fallar } from "../errores.mjs";

const VERSION = 1;
/** Coste de la derivacion: es la unica barrera contra probar frases, asi que no baja. */
const KDF = { N: 16384, r: 8, p: 1, largo: 32 };
const MEMORIA = 64 * 1024 * 1024;

/**
 * @param {{ ruta: string, passphrase: string, motivo: string }} config
 * @returns {{ tipo: string, motivo: string, evidencia: string, guardar: Function, recuperar: Function, existe: Function, borrar: Function }}
 */
export function crearBackendDeArchivo({ ruta, passphrase, motivo }) {
  if (!passphrase) {
    fallar(
      "sin_frase_de_paso",
      "el respaldo cifrado necesita una frase de paso y no se le dio ninguna",
      "pasa `passphrase` al crear el backend, o elegi el llavero del sistema si esta disponible",
    );
  }

  /** @type {Buffer|null} */
  let clave = null;

  function leerArchivo() {
    if (!existsSync(ruta)) return { version: VERSION, kdf: null, entradas: {} };
    try {
      return JSON.parse(readFileSync(ruta, "utf8"));
    } catch {
      return fallar(
        "archivo_ilegible",
        `el archivo de respaldo ${ruta} no se pudo leer como JSON`,
        "restaura el archivo desde una copia o borralo y vuelve a registrar las credenciales",
      );
    }
  }

  function escribirArchivo(contenido) {
    mkdirSync(dirname(ruta), { recursive: true });
    // Temporal + rename: un corte de luz a mitad de la escritura no puede dejar
    // el inventario de credenciales truncado.
    const temporal = `${ruta}.${process.pid}.tmp`;
    writeFileSync(temporal, JSON.stringify(contenido), { mode: 0o600 });
    renameSync(temporal, ruta);
    chmodSync(ruta, 0o600);
  }

  /** La sal vive en el archivo: sin ella, la misma frase daria claves distintas en cada arranque. */
  function claveDe(contenido) {
    if (clave) return clave;
    if (!contenido.kdf) {
      contenido.kdf = { ...KDF, sal: randomBytes(16).toString("hex") };
    }
    const { N, r, p, largo, sal } = contenido.kdf;
    clave = scryptSync(passphrase, Buffer.from(sal, "hex"), largo, { N, r, p, maxmem: MEMORIA });
    return clave;
  }

  return {
    tipo: "archivo_cifrado",
    motivo,
    evidencia: ruta,

    /**
     * @param {string} ref
     * @param {string} valor
     */
    async guardar(ref, valor) {
      const contenido = leerArchivo();
      const iv = randomBytes(12);
      const cifrador = createCipheriv("aes-256-gcm", claveDe(contenido), iv);
      const datos = Buffer.concat([cifrador.update(valor, "utf8"), cifrador.final()]);
      contenido.entradas[ref] = {
        iv: iv.toString("hex"),
        tag: cifrador.getAuthTag().toString("hex"),
        datos: datos.toString("hex"),
      };
      escribirArchivo(contenido);
    },

    /**
     * @param {string} ref
     * @returns {Promise<string>}
     */
    async recuperar(ref) {
      const contenido = leerArchivo();
      const entrada = contenido.entradas[ref];
      if (!entrada) {
        return fallar(
          "credencial_ausente",
          `no hay ningun valor guardado para ${ref}`,
          "registra la credencial antes de pedirla, o comproba que el backend es el mismo con el que se guardo",
        );
      }
      try {
        const descifrador = createDecipheriv("aes-256-gcm", claveDe(contenido), Buffer.from(entrada.iv, "hex"));
        descifrador.setAuthTag(Buffer.from(entrada.tag, "hex"));
        return Buffer.concat([
          descifrador.update(Buffer.from(entrada.datos, "hex")),
          descifrador.final(),
        ]).toString("utf8");
      } catch {
        // GCM no distingue "la frase es otra" de "alguien edito el archivo", y
        // las dos se arreglan igual de distinto. Se nombran las dos.
        return fallar(
          "frase_incorrecta",
          `el valor de ${ref} no se pudo descifrar: o la frase de paso es otra, o el archivo se modifico fuera de la boveda`,
          "comproba la frase de paso con la que arranco el servicio; si es la misma, el archivo esta alterado y hay que rotar las credenciales",
        );
      }
    },

    /** @param {string} ref */
    async existe(ref) {
      return Object.hasOwn(leerArchivo().entradas, ref);
    },

    /** @param {string} ref */
    async borrar(ref) {
      const contenido = leerArchivo();
      delete contenido.entradas[ref];
      escribirArchivo(contenido);
    },
  };
}

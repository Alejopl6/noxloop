// La boveda. Denegar por defecto, y el registro como parte de la operacion.
//
// LA REGLA QUE NO SE NEGOCIA (principio IX): el valor de una credencial existe
// en exactamente dos sitios — el backend de secretos y el entorno del
// subproceso que tiene grant, mientras ese subproceso vive. Este modulo es el
// unico camino entre los dos, y por eso es el unico sitio del paquete donde un
// valor pasa por una variable.
//
// POR QUE `recuperar` EXIGE UN MOTIVO. No es burocracia: es lo que hace que la
// auditoria sea automatica en vez de recordada. Si el motivo fuera opcional,
// existiria un camino por el que alguien "se olvido" de registrar el acceso, y
// ese camino acabaria siendo el que se usa cuando hay prisa. Aqui el registro se
// escribe ANTES de devolver el valor: un acceso sin registrar no puede ocurrir
// porque la funcion no llega a devolver.

import { fallar } from "./errores.mjs";
import { huellaDe, salPorDefecto } from "./huella.mjs";
import { crearCredencial, crearGrant, estadoDelGrant, PROPOSITOS } from "./modelo.mjs";
import { esBackendConocido } from "./backends/seleccion.mjs";

const CAMPOS_DEL_MOTIVO = ["grant_id", "project_id", "agent_id", "proposito"];

/**
 * @param {{ backend: any, repositorio: any, auditoria: any, sal?: string, reloj?: () => number }} piezas
 */
export function crearBoveda({ backend, repositorio, auditoria, sal = salPorDefecto(), reloj = () => Date.now() }) {
  // La seleccion del backend no puede ser silenciosa (T131): un backend que no
  // dice por que es el elegido es exactamente la caida silenciosa al archivo
  // cifrado que cambia el modelo de amenaza sin que el operador se entere.
  if (!backend || typeof backend.motivo !== "string" || backend.motivo.trim().length < 20) {
    fallar(
      "backend_sin_motivo",
      "el backend de secretos no declara por que es el elegido",
      "construi el backend con `elegirBackend`, que devuelve el tipo junto con su motivo",
    );
  }
  if (!esBackendConocido(backend.tipo)) {
    fallar(
      "backend_desconocido",
      `el backend declara el tipo '${backend.tipo}', que no es ninguno de los del contrato`,
      "usa 'keychain_so' o 'archivo_cifrado'",
    );
  }

  /** @param {unknown} motivo */
  function validarMotivo(motivo) {
    if (!motivo || typeof motivo !== "object") {
      fallar(
        "motivo_ausente",
        `recuperar exige un MotivoDeAcceso con ${CAMPOS_DEL_MOTIVO.join(", ")}`,
        "pasa el motivo del acceso: sin el no hay forma de auditar para que se saco la credencial",
      );
    }
    const faltan = CAMPOS_DEL_MOTIVO.filter((c) => !(/** @type {any} */ (motivo)[c]));
    if (faltan.length > 0) {
      fallar(
        "motivo_ausente",
        `al MotivoDeAcceso le faltan campos: ${faltan.join(", ")}`,
        "completa el motivo antes de pedir la credencial; el registro es parte del acceso, no un reporte posterior",
      );
    }
    if (!PROPOSITOS.includes(/** @type {any} */ (motivo).proposito)) {
      fallar(
        "proposito_desconocido",
        `el proposito '${/** @type {any} */ (motivo).proposito}' no es ninguno de los del contrato`,
        `usa uno de: ${PROPOSITOS.join(", ")}`,
      );
    }
  }

  /** Deniega, deja constancia y lanza. Las tres cosas, siempre en ese orden. */
  function denegar(codigo, motivo, ref, causa, accion) {
    auditoria.registrar({ tipo: "acceso", resultado: "denegado", ref, motivo, causa, codigo });
    fallar(codigo, causa, accion);
  }

  const boveda = {
    /** Que backend esta activo y por que. La interfaz lo muestra siempre. */
    backend() {
      return backend.evidencia
        ? { tipo: backend.tipo, motivo: backend.motivo, evidencia: backend.evidencia }
        : { tipo: backend.tipo, motivo: backend.motivo };
    },

    /**
     * Alta de credencial: crea la fila del inventario y guarda el valor.
     *
     * `proveedor` y `tipo` son obligatorios y no tienen valor por defecto. La
     * primera version de esto ponia `tipo = "token"`, que ni siquiera esta en
     * el enum del modelo de datos: el almacen lo rechazaba al persistir, y el
     * fallo aparecia al integrar los dos paquetes en vez de al escribir el
     * primero. `crearCredencial` los valida y dice cuales valen.
     *
     * @param {{ workspace: string, nombre: string, proveedor: string, tipo: string,
     *           ambito?: string, project_id?: string|null, alcance_declarado?: string|null,
     *           valor: string }} datos
     */
    async registrar({ workspace, nombre, proveedor, tipo, ambito, project_id, alcance_declarado, valor }) {
      const credencial = crearCredencial({
        workspace,
        nombre,
        proveedor,
        tipo,
        ambito,
        project_id,
        alcance_declarado,
        backend: backend.tipo,
        ahora: reloj(),
      });
      repositorio.guardarCredencial(credencial);
      const { huella } = await boveda.guardar(credencial.ref_boveda, valor, "credencial_registrada");
      return { credencial: repositorio.credencialPorRef(credencial.ref_boveda), huella };
    },

    /**
     * Guarda un valor. Devuelve la referencia y la huella. Nunca el valor.
     *
     * @param {string} ref
     * @param {string} valor
     * @param {string} [tipoDeEvento]
     */
    async guardar(ref, valor, tipoDeEvento = "credencial_guardada") {
      if (typeof valor !== "string" || valor.length === 0) {
        fallar(
          "valor_vacio",
          `se intento guardar un valor vacio en ${ref}`,
          "una credencial vacia hace que el redactor no pueda distinguirla del resto del texto: no se admite",
        );
      }
      const credencial = repositorio.credencialPorRef(ref);
      if (!credencial) {
        fallar(
          "credencial_ausente",
          `no hay ninguna credencial en el inventario con la referencia ${ref}`,
          "dala de alta con `registrar` antes de guardar su valor",
        );
      }
      await backend.guardar(ref, valor);
      const huella = huellaDe(valor, sal);
      repositorio.guardarCredencial({
        ...credencial,
        huella,
        rotadaEn: tipoDeEvento === "credencial_rotada" ? new Date(reloj()).toISOString() : credencial.rotadaEn,
      });
      auditoria.registrar({ tipo: tipoDeEvento, resultado: "ok", ref, huella });
      return { ref, huella };
    },

    /**
     * Rotar es guardar un valor nuevo sobre la misma fila.
     *
     * EL FALLO QUE EVITA. Implementar la rotacion como borrar + registrar se
     * lleva los grants por delante, y entonces cada rotacion obliga a volver a
     * autorizar a mano todo lo que usaba la credencial. El efecto medible no es
     * que se pierdan permisos: es que nadie rota.
     */
    async rotar(ref, valor) {
      return await boveda.guardar(ref, valor, "credencial_rotada");
    },

    /**
     * Recupera para inyeccion. Solo el servicio la llama, nunca la interfaz.
     *
     * @param {string} ref
     * @param {{ grant_id: string, project_id: string, agent_id: string, proposito: string }} motivo
     * @returns {Promise<string>}
     */
    async recuperar(ref, motivo) {
      validarMotivo(motivo);

      const credencial = repositorio.credencialPorRef(ref);
      if (!credencial) {
        denegar(
          "credencial_ausente",
          motivo,
          ref,
          `no hay ninguna credencial en el inventario con la referencia ${ref}`,
          "comproba la referencia, o da de alta la credencial",
        );
      }

      const grant = repositorio.grantPorId(motivo.grant_id);
      const alcanza =
        grant &&
        grant.credential_id === credencial.id &&
        grant.project_id === motivo.project_id &&
        grant.agent_id === motivo.agent_id;
      if (!alcanza) {
        denegar(
          "sin_grant",
          motivo,
          ref,
          `no hay ningun grant que autorice al agente ${motivo.agent_id} del proyecto ${motivo.project_id} sobre ${ref}`,
          "pedi el permiso por la bandeja: la tarea queda bloqueada hasta que alguien lo otorgue",
        );
      }

      // La vigencia se mira AHORA, no al planificar: entre una cosa y la otra
      // puede haber horas, y en esas horas alguien pudo revocar.
      const estado = estadoDelGrant(grant, reloj());
      if (!estado.vigente) {
        denegar(
          "grant_no_vigente",
          motivo,
          ref,
          estado.causa,
          "pedi una renovacion por la bandeja; un grant caducado no se prorroga solo",
        );
      }

      const valor = await backend.recuperar(ref);
      // El registro va antes del `return`: asi no existe el camino por el que
      // alguien obtuvo el valor y el evento no se escribio.
      auditoria.registrar({
        tipo: "acceso",
        resultado: "concedido",
        ref,
        motivo,
        huella: credencial.huella,
        backend: backend.tipo,
      });
      return valor;
    },

    /** Existe sin revelar. Es lo que usa la interfaz. */
    async existe(ref) {
      return repositorio.credencialPorRef(ref) !== null && (await backend.existe(ref));
    },

    /** Huella del valor actual, para detectar rotacion y comparar sin revelar. */
    async huella(ref) {
      return repositorio.credencialPorRef(ref)?.huella ?? null;
    },

    async borrar(ref) {
      await backend.borrar(ref);
      repositorio.borrarCredencial(ref);
      auditoria.registrar({ tipo: "credencial_borrada", resultado: "ok", ref });
    },

    /** @param {{ project_id: string, agent_id: string, credential_id: string, vigenciaHasta?: string|null }} datos */
    async otorgar(datos) {
      const grant = crearGrant({ ...datos, ahora: reloj() });
      repositorio.guardarGrant(grant);
      auditoria.registrar({ tipo: "grant_otorgado", resultado: "ok", grant_id: grant.id, credential_id: grant.credential_id });
      return grant;
    },

    /** @param {string} grantId */
    async revocar(grantId) {
      const grant = repositorio.grantPorId(grantId);
      if (!grant) {
        fallar("grant_ausente", `no hay ningun grant con el id ${grantId}`, "comproba el id en la vista inversa");
      }
      repositorio.guardarGrant({ ...grant, revocadoEn: new Date(reloj()).toISOString() });
      auditoria.registrar({ tipo: "grant_revocado", resultado: "ok", grant_id: grantId });
      return repositorio.grantPorId(grantId);
    },

    /**
     * Vista inversa (FR-045): que alcanza que, contando solo lo vigente.
     *
     * @param {{ credential_id?: string, project_id?: string, agent_id?: string }} criterio
     */
    async reach(criterio) {
      return repositorio.alcance(criterio, reloj());
    },
  };

  return boveda;
}

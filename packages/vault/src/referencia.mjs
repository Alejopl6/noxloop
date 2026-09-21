// `VaultRef`: `noxloop:<workspace>:<credential_id>`.
//
// POR QUE EL IDENTIFICADOR ES OPACO. Si la referencia fuera
// `noxloop:acme:token-de-produccion`, cualquiera que vea una referencia en un
// log —y las referencias SI van a los logs, para eso existen— aprende que
// credenciales hay y como se llaman. El identificador es aleatorio y el nombre
// legible vive en el inventario, que ya esta detras del token del servicio.

import { randomUUID } from "node:crypto";

const FORMA = /^noxloop:([A-Za-z0-9._-]+):([A-Za-z0-9-]+)$/;

/**
 * @param {string} workspace
 * @param {string} credentialId
 * @returns {string}
 */
export function construirRef(workspace, credentialId) {
  return `noxloop:${workspace}:${credentialId}`;
}

/** @returns {string} */
export function nuevoIdDeCredencial() {
  return randomUUID();
}

/**
 * @param {unknown} ref
 * @returns {{ workspace: string, credentialId: string }|null}
 */
export function partirRef(ref) {
  if (typeof ref !== "string") return null;
  const m = FORMA.exec(ref);
  return m ? { workspace: m[1], credentialId: m[2] } : null;
}

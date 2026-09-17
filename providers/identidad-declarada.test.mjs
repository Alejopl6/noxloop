// Declarar un responsable que el gestor no puede honrar tiene que AVISAR.
//
// EL FALLO QUE CIERRA, y es el segundo tramo del mismo cable. Una vez que
// `identity.assignee` llega al proveedor, Azure DevOps lo usa en su WIQL — pero
// GitHub y Linear no pueden: sus consultas de bandeja son del dueño del token y
// la API no acepta pedir las de otra persona. Sin declararlo, alguien configura
// un responsable, la bandeja sigue trayendo los del token, y nada dice que lo
// declarado se ignoro. Ese silencio es el modo de fallo que el proyecto ataca:
// el motor degrada, pero DE FORMA VISIBLE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_KEYS } from "./contract.mjs";

test("identityAssignee es una capacidad del contrato, no una convencion", () => {
  assert.ok(CAPABILITY_KEYS.includes("identityAssignee"));
});

test("los cuatro proveedores la declaran explicitamente", async () => {
  for (const nombre of ["fake", "github", "linear", "azure-devops"]) {
    const mod = await import(`./${nombre}/index.mjs`);
    const caps = mod.capabilities();
    assert.equal(typeof caps.identityAssignee, "boolean",
      `${nombre} no declara identityAssignee: una capacidad sin declarar es una que nadie puede consultar`);
  }
});

test("azure-devops SI puede: su WIQL acepta cualquier responsable", async () => {
  const mod = await import("./azure-devops/index.mjs");
  assert.equal(mod.capabilities().identityAssignee, true);
});

test("github y linear NO pueden, y lo dicen", async () => {
  for (const nombre of ["github", "linear"]) {
    const mod = await import(`./${nombre}/index.mjs`);
    assert.equal(mod.capabilities().identityAssignee, false,
      `${nombre} dice que soporta un responsable declarado; si fuera cierto hay que implementarlo`);
  }
});

// -------------------------------------------------- y la bandeja lo avisa

import { revisarBandeja } from "../packages/engine/src/inbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const proveedorQueNoPuede = {
  meta: { name: "de-prueba" },
  capabilities: () => ({
    children: false, dependencies: false, createChild: false, setState: false,
    comment: false, linkUrl: false, labels: false,
    searchAssigned: true, searchMentioned: false, boardFields: false,
    identityAssignee: false,
  }),
  searchInbox: async () => ({ assigned: [], mentioned: [] }),
};

const home = () => mkdtempSync(join(tmpdir(), "nox-ident-"));

test("declarar un responsable que el proveedor no honra sale como degradacion", async () => {
  const r = await revisarBandeja(
    { identity: { assignee: "bot@x.test" } },
    { provider: proveedorQueNoPuede, providerCtx: { identity: { assignee: "bot@x.test" } }, home: home() },
  );
  const d = r.degradaciones.join("\n");
  assert.match(d, /bot@x\.test/, "tiene que nombrar lo que se declaro y se ignora");
  assert.match(d, /identity\.assignee|responsable/i);
});

test("sin responsable declarado no hay degradacion que avisar", async () => {
  const r = await revisarBandeja({}, {
    provider: proveedorQueNoPuede, providerCtx: { identity: { assignee: null } }, home: home(),
  });
  assert.equal(r.degradaciones.filter((x) => /identity/.test(x)).length, 0);
});

test("un proveedor que SI lo honra no genera ruido", async () => {
  const puede = { ...proveedorQueNoPuede, capabilities: () => ({ ...proveedorQueNoPuede.capabilities(), identityAssignee: true }) };
  const r = await revisarBandeja({ identity: { assignee: "bot@x.test" } }, {
    provider: puede, providerCtx: { identity: { assignee: "bot@x.test" } }, home: home(),
  });
  assert.equal(r.degradaciones.filter((x) => /identity/.test(x)).length, 0);
});

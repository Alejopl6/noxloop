// Los esquemas del motor y su copia en el contrato de la spec 001 son EL MISMO
// contrato en dos lugares, y el CI lo exige en un paso de shell. Ese paso solo
// corre en GitHub: dos veces seguidas un campo nuevo entro al esquema del motor
// y no a su copia, y la divergencia se descubrio con el PR ya abierto. Aqui se
// mide en `npm test`, donde se ve antes de commitear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const MOTOR = new URL("../schemas/", import.meta.url);
const CONTRATO = new URL("../../../specs/001-parallel-ticket-orchestrator/contracts/", import.meta.url);

test("cada esquema del motor es identico a su copia en el contrato", () => {
  const delMotor = readdirSync(MOTOR).filter((n) => n.endsWith(".schema.json"));
  assert.ok(delMotor.length > 0, "no hay esquemas en el motor");
  for (const n of delMotor) {
    const a = readFileSync(new URL(n, MOTOR), "utf8");
    const b = readFileSync(new URL(n, CONTRATO), "utf8");
    assert.equal(a, b, `${n} divergio de su copia en specs/001/contracts: copia el del motor sobre el contrato`);
  }
});

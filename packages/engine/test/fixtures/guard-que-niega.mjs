// Un guard de mentira para verificar que el puente DELEGA en vez de decidir el.
export function decide() {
  return { allow: false, reason: "lo dijo el guard de verdad" };
}

// Un guard de mentira con la forma de los hooks `Stop`: avisa, no bloquea.
export function decide() {
  return { notify: true, message: "dejo trabajo sin commitear" };
}

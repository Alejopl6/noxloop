// La pagina del board. Va compilada dentro del modulo a proposito: asi el
// servidor no sirve ningun archivo del disco y no hay ruta que se pueda usar
// para salir a leer otra cosa.
//
// POR QUE NO PIDE NADA A LA RED. Se mira cuando algo se rompio, y eso incluye
// "no hay internet". Sin fuentes remotas, sin CDN, sin iconos externos. Hay un
// test que falla si aparece una URL que no sea loopback.
//
// EL LENGUAJE VISUAL es el de Vercel/Geist, y lo que se tomo son sus REGLAS, no
// una hoja de estilos:
//
//   - ACROMATICO. Cuatro grises y nada mas. El azul es el UNICO acento
//     interactivo: enlaces y foco, en ningun otro lado.
//   - EL COLOR DE ESTADO VIVE EN PUNTOS DE 10px, nunca en fondos ni en franjas.
//     Un tablero donde cada columna tiene su color de fondo grita cinco cosas a
//     la vez; con puntos, el color señala y el contenido ocupa el frente.
//   - TRES PESOS: 400, 500, 600. No hay 700. El enfasis sale del tamaño y del
//     espacio, no del grosor.
//   - SOMBRA EN LUGAR DE BORDE: `0 0 0 1px` con desplazamiento y difuminado en
//     cero se ve igual que un borde y no toca el modelo de caja, asi que nada
//     se mueve un pixel al pasar el mouse.
//   - ESCALA DE 4px para todo espacio, radio 6px por omision y 12px en tarjetas.
//
// LA DESVIACION, y es deliberada: Geist es una fuente REMOTA y este archivo no
// puede pedir nada a la red, asi que va la pila del sistema. Se pierde la letra;
// se conserva el resto del lenguaje, que es donde esta el 90%.
//
// LA OTRA: el documento describe la paleta clara. El modo oscuro se derivo
// aplicando las MISMAS reglas —cuatro grises, azul unico, color solo en
// puntos— en vez de invertir colores al azar.
//
// El JavaScript de abajo no usa plantillas con acento invertido: este archivo
// ES una plantilla, y anidarlas lo volveria imposible de leer.

export const PAGINA = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>noxloop</title>
<style>
  :root {
    /* --- la escala acromatica. Cuatro paradas, y nada entre medio. */
    --fondo: #fafafa;         /* lienzo */
    --panel: #ffffff;         /* superficie elevada */
    --hundido: #f2f2f2;       /* superficie hundida */
    --linea: #ebebeb;         /* el gris del relleno en hover */

    --texto: #171717;         /* primario */
    --texto-2: #4d4d4d;       /* secundario */
    --texto-3: #8f8f8f;       /* apagado */

    --azul: #0072f5;          /* EL acento. Enlaces y foco. Nada mas. */

    /* --- color de estado. Solo en puntos de 10px. */
    --e-espera: #8f8f8f;
    --e-curso: #0062d1;
    --e-pr: #7820bc;
    --e-ok: #398e4a;
    --e-mal: #e5484d;
    --e-alerta: #ff990a;

    /* --- sombra en lugar de borde */
    --anillo: 0 0 0 1px #00000014;
    --elev-1: 0 0 0 1px #00000014, 0 2px 2px #0000000a;
    --elev-2: 0 0 0 1px #00000014, 0 2px 2px #0000000a, 0 8px 8px -8px #0000000a;
    --elev-modal: 0 0 0 1px #00000014, 0 1px 1px #00000005, 0 8px 16px -4px #0000000a, 0 24px 32px -8px #0000000f;
    --separador: 0 1px 0 0 #0000000d;
    --foco: 0 0 0 2px var(--panel), 0 0 0 4px var(--azul);

    /* --- espacio, base 4 */
    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px; --s8: 32px;
    --r: 6px;        /* radio por omision */
    --r-card: 12px;  /* tarjetas y paneles */

    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    --swift: cubic-bezier(.175, .885, .32, 1.1);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --fondo: #0a0a0a;
      --panel: #111111;
      --hundido: #171717;
      --linea: #2e2e2e;
      --texto: #ededed;
      --texto-2: #a1a1a1;
      --texto-3: #6f6f6f;
      --azul: #3291ff;
      --anillo: 0 0 0 1px #ffffff1a;
      --elev-1: 0 0 0 1px #ffffff1a, 0 2px 2px #00000040;
      --elev-2: 0 0 0 1px #ffffff1a, 0 2px 2px #00000040, 0 8px 8px -8px #00000059;
      --elev-modal: 0 0 0 1px #ffffff1a, 0 8px 16px -4px #00000059, 0 24px 32px -8px #00000073;
      --separador: 0 1px 0 0 #ffffff14;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--fondo);
    color: var(--texto);
    font: 400 16px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
  }

  /* ---------------------------------------------------------- cabecera */

  header {
    height: 64px;
    display: flex;
    align-items: center;
    gap: var(--s8);
    padding: 0 var(--s6);
    background: var(--panel);
    box-shadow: var(--separador);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .marca {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    letter-spacing: -0.28px;
  }
  .marca span { color: var(--texto-3); font-weight: 400; }

  .metricas {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s6);
    font-size: 12px;
    line-height: 16px;
    color: var(--texto-2);
  }
  .metricas b {
    font-weight: 500;
    color: var(--texto);
    font-variant-numeric: tabular-nums;
  }

  .punto {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    display: inline-block;
  }
  .punto.vivo { background: var(--e-ok); }
  .punto.frio { background: var(--e-mal); }

  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: var(--s6) var(--s4) var(--s8);
    display: grid;
    gap: var(--s6);
  }

  /* ------------------------------------------------------------ paneles */

  .panel {
    background: var(--panel);
    border-radius: var(--r-card);
    box-shadow: var(--elev-1);
    overflow: hidden;
  }

  .panel > h2 {
    margin: 0;
    padding: var(--s3) var(--s4);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    letter-spacing: -0.28px;
    display: flex;
    align-items: center;
    gap: var(--s2);
    box-shadow: var(--separador);
  }
  .cuenta {
    margin-left: auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--texto-3);
    font-variant-numeric: tabular-nums;
  }

  .fila { padding: var(--s3) var(--s4); box-shadow: var(--separador); }
  .fila:last-child { box-shadow: none; }
  .fila .quien {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    color: var(--texto-2);
  }
  .fila .que {
    margin-top: var(--s1);
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* ------------------------------------------------------------ tablero */

  .tablero {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(248px, 1fr));
    gap: var(--s4);
    align-items: start;
  }

  .col { min-width: 0; }

  .col > h3 {
    margin: 0 0 var(--s3);
    padding: 0 var(--s1);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    letter-spacing: -0.28px;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .pila { display: grid; gap: var(--s2); }

  .vacia {
    padding: var(--s4) var(--s1);
    font-size: 12px;
    line-height: 16px;
    color: var(--texto-3);
  }

  /* ----------------------------------------------------------- tarjetas */

  .tarjeta {
    display: grid;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--panel);
    border-radius: var(--r-card);
    box-shadow: var(--elev-1);
    cursor: pointer;
    /* Solo cambia la sombra. Sin transform y sin opacity: la interaccion es
       puramente de color, como el resto del lenguaje. */
    transition: box-shadow .15s var(--swift);
  }
  .tarjeta:hover { box-shadow: var(--elev-2); }
  .tarjeta:focus-visible { outline: none; box-shadow: var(--foco); }

  .tarjeta .id {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    line-height: 16px;
    color: var(--texto-3);
  }
  .tarjeta .tit {
    font-size: 14px;
    line-height: 20px;
    color: var(--texto);
    overflow-wrap: anywhere;
  }

  /* Una etiqueta es texto gris con un anillo. Nunca un fondo de color: el
     color esta reservado a los puntos de estado. */
  .tag {
    font-size: 11px;
    line-height: 16px;
    padding: 0 var(--s2);
    border-radius: 9999px;
    color: var(--texto-2);
    box-shadow: var(--anillo);
    white-space: nowrap;
  }
  .tag.atencion { color: var(--e-alerta); box-shadow: 0 0 0 1px currentColor; }
  .tag.viva { color: var(--azul); box-shadow: 0 0 0 1px currentColor; }

  .barra {
    height: 2px;
    border-radius: 9999px;
    background: var(--hundido);
    box-shadow: var(--anillo);
    overflow: hidden;
  }
  .barra i { display: block; height: 100%; background: var(--texto-2); }

  .pie {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    line-height: 16px;
    color: var(--texto-3);
    font-variant-numeric: tabular-nums;
  }
  .pie a { color: var(--azul); text-decoration: none; }
  .pie a:hover { text-decoration: underline; }
  .pie a:focus-visible { outline: 2px auto var(--azul); outline-offset: 2px; }

  /* ------------------------------------------------------------- detalle */

  dialog {
    padding: 0;
    border: 0;
    max-width: 640px;
    width: calc(100% - 32px);
    background: var(--panel);
    color: var(--texto);
    border-radius: var(--r-card);
    box-shadow: var(--elev-modal);
  }
  dialog::backdrop { background: #00000080; }

  dialog .cabeza { padding: var(--s4); box-shadow: var(--separador); }
  dialog .cabeza h1 {
    margin: 0;
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: var(--texto-2);
  }
  dialog .cuerpo { padding: var(--s4); display: grid; gap: var(--s4); }
  dialog h4 {
    margin: 0 0 var(--s2);
    font-size: 12px;
    font-weight: 500;
    line-height: 16px;
    color: var(--texto-3);
  }
  dialog pre {
    margin: 0;
    padding: var(--s3);
    background: var(--hundido);
    border-radius: var(--r);
    box-shadow: var(--anillo);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .kv { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: var(--s1) var(--s4); }
  .kv dt { font-size: 13px; line-height: 20px; color: var(--texto-3); }
  .kv dd {
    margin: 0;
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    overflow-wrap: anywhere;
  }

  /* El boton es fantasma por omision: transparente, y el hover lo llena con el
     gris de linea. Sin transform y sin sombra propia. */
  button {
    height: 32px;
    padding: 0 var(--s3);
    border: 0;
    border-radius: var(--r);
    background: transparent;
    color: var(--texto-2);
    box-shadow: var(--anillo);
    font: 400 14px/1 var(--sans);
    cursor: pointer;
  }
  button:hover { background: var(--linea); color: var(--texto); }
  button:focus-visible { outline: none; box-shadow: var(--foco); }
</style>

<header>
  <h1 class="marca">noxloop <span>board</span></h1>
  <div class="metricas">
    <span><b id="m-items">0</b> items</span>
    <span><b id="m-activas">0</b> vivas</span>
    <span>US$&nbsp;<b id="m-gasto">0</b></span>
    <span class="punto frio" id="pulso" title="sin conexion"></span>
  </div>
</header>

<main>
  <section class="panel" id="p-respuesta" hidden>
    <h2><span class="punto" id="pt-respuesta"></span> Te necesitan <span class="cuenta" id="c-respuesta"></span></h2>
    <div id="l-respuesta"></div>
  </section>

  <section class="panel" id="p-avisos" hidden>
    <h2><span class="punto" id="pt-avisos"></span> Avisos del motor <span class="cuenta" id="c-avisos"></span></h2>
    <div id="l-avisos"></div>
  </section>

  <section class="tablero" id="tablero"></section>

  <section class="panel" id="p-omitidos" hidden>
    <h2><span class="punto" id="pt-omitidos"></span> Omitidos por la bandeja <span class="cuenta" id="c-omitidos"></span></h2>
    <div id="l-omitidos"></div>
  </section>
</main>

<dialog id="detalle">
  <div class="cabeza"><h1 id="d-id">—</h1></div>
  <div class="cuerpo">
    <div><h4>Ticket</h4><div id="d-tit"></div></div>
    <div><h4>Datos</h4><dl class="kv" id="d-kv"></dl></div>
    <div id="d-bloque" hidden><h4>Tareas bloqueadas, con su causa real</h4><pre id="d-bloqueadas"></pre></div>
    <div><button id="d-cerrar">Cerrar</button></div>
  </div>
</dialog>

<script>
(function () {
  var COLS = [
    ["pending", "Por empezar", "var(--e-espera)"],
    ["running", "En curso", "var(--e-curso)"],
    ["pr_open", "Con PR abierto", "var(--e-pr)"],
    ["integrated", "Integrado", "var(--e-ok)"],
    ["blocked", "Bloqueado", "var(--e-mal)"]
  ];
  var ultimo = null;

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    // Siempre por textContent: un titulo de ticket es texto que escribio otra
    // persona, y armar HTML con eso seria inyectarlo en la propia pagina.
    if (texto != null) n.textContent = texto;
    return n;
  }

  function punto(color) {
    var n = el("span", "punto");
    n.style.background = color;
    return n;
  }

  function pintarPunto(id, color) {
    var n = document.getElementById(id);
    if (n) n.style.background = color;
  }

  function corto(s) {
    if (!s) return "—";
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return m + " min";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h";
    return Math.round(h / 24) + " d";
  }

  function colorDe(estado) {
    for (var i = 0; i < COLS.length; i++) if (COLS[i][0] === estado) return COLS[i][2];
    return "var(--texto-3)";
  }

  function tarjeta(c) {
    var n = el("article", "tarjeta");
    n.tabIndex = 0;

    var id = el("div", "id");
    id.appendChild(punto(colorDe(c.estado)));
    id.appendChild(el("span", null, c.itemId));
    if (c.provider) id.appendChild(el("span", "tag", c.provider));
    if (c.hitoId) id.appendChild(el("span", "tag", "hito " + c.hitoId));
    if (c.esperandoRespuesta) id.appendChild(el("span", "tag atencion", "espera respuesta"));
    if (c.tareas.activas.length) id.appendChild(el("span", "tag viva", c.tareas.activas.length + " viva"));
    n.appendChild(id);

    n.appendChild(el("div", "tit", c.titulo));

    if (c.tareas.total) {
      var b = el("div", "barra");
      var i = el("i");
      i.style.width = c.avance + "%";
      b.appendChild(i);
      n.appendChild(b);
    }

    var pie = el("div", "pie");
    pie.appendChild(el("span", null,
      c.tareas.total ? (c.tareas.porEstado.integrated || 0) + "/" + c.tareas.total + " tareas" : "sin plan"));
    if (c.pr) {
      var a = el("a", null, "PR");
      a.href = c.pr;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.addEventListener("click", function (e) { e.stopPropagation(); });
      pie.appendChild(a);
    } else {
      pie.appendChild(el("span", null, corto(c.actualizado)));
    }
    n.appendChild(pie);

    function abrir() { detalle(c); }
    n.addEventListener("click", abrir);
    n.addEventListener("keydown", function (e) { if (e.key === "Enter") abrir(); });
    return n;
  }

  function detalle(c) {
    document.getElementById("d-id").textContent = c.itemId;
    document.getElementById("d-tit").textContent = c.titulo;

    var kv = document.getElementById("d-kv");
    kv.textContent = "";
    var datos = [
      ["estado", c.estado], ["avance", c.avance + "%"], ["rama", c.rama || "—"],
      ["pr", c.pr || "—"], ["hito", c.hitoId || "—"],
      ["gasto", "US$ " + c.gasto.usd + " en " + c.gasto.calls + " llamadas"],
      ["actualizado", c.actualizado || "—"], ["origen", c.origen]
    ];
    for (var i = 0; i < datos.length; i++) {
      kv.appendChild(el("dt", null, datos[i][0]));
      kv.appendChild(el("dd", null, String(datos[i][1])));
    }

    var hay = c.tareas.bloqueadas.length > 0;
    document.getElementById("d-bloque").hidden = !hay;
    if (hay) {
      var lineas = c.tareas.bloqueadas.map(function (b) { return b.id + ": " + b.motivo; });
      document.getElementById("d-bloqueadas").textContent = lineas.join("\\n\\n");
    }
    document.getElementById("detalle").showModal();
  }

  function panel(idPanel, idLista, idCuenta, filas) {
    var lista = document.getElementById(idLista);
    lista.textContent = "";
    for (var i = 0; i < filas.length; i++) {
      var f = el("div", "fila");
      var q = el("div", "quien");
      q.appendChild(punto(filas[i].color || "var(--texto-3)"));
      q.appendChild(el("span", null, filas[i].quien));
      f.appendChild(q);
      f.appendChild(el("div", "que", filas[i].que));
      lista.appendChild(f);
    }
    document.getElementById(idCuenta).textContent = filas.length ? String(filas.length) : "";
    document.getElementById(idPanel).hidden = filas.length === 0;
  }

  function pintar(b) {
    document.getElementById("m-items").textContent = b.totales.items;
    document.getElementById("m-activas").textContent = b.totales.tareasActivas;
    document.getElementById("m-gasto").textContent = b.totales.gastoUsd;

    pintarPunto("pt-respuesta", "var(--e-alerta)");
    pintarPunto("pt-avisos", "var(--texto-3)");
    pintarPunto("pt-omitidos", "var(--texto-3)");

    panel("p-respuesta", "l-respuesta", "c-respuesta", (b.necesitanRespuesta || []).map(function (n) {
      return {
        color: "var(--e-alerta)",
        quien: n.itemId + "  ·  " + n.origen + "  ·  hace " + corto(n.desde),
        que: n.pregunta
      };
    }));

    panel("p-avisos", "l-avisos", "c-avisos", (b.avisos || []).map(function (a) {
      return {
        color: a.nivel === "error" ? "var(--e-mal)" : "var(--e-alerta)",
        quien: a.nivel === "error" ? "error" : "aviso",
        que: a.mensaje
      };
    }));

    panel("p-omitidos", "l-omitidos", "c-omitidos", (b.omitidos || []).map(function (o) {
      return {
        color: o.clase === "permanente" ? "var(--e-alerta)" : "var(--texto-3)",
        quien: o.itemId + "  ·  " + o.clase,
        que: o.motivo
      };
    }));

    var t = document.getElementById("tablero");
    t.textContent = "";
    for (var i = 0; i < COLS.length; i++) {
      var id = COLS[i][0];
      var col = el("section", "col");
      col.setAttribute("data-id", id);

      var h = el("h3");
      h.appendChild(punto(COLS[i][2]));
      h.appendChild(el("span", null, COLS[i][1]));
      var cs = (b.columnas.filter(function (c) { return c.id === id; })[0] || { tarjetas: [] }).tarjetas;
      h.appendChild(el("span", "cuenta", String(cs.length)));
      col.appendChild(h);

      if (!cs.length) {
        col.appendChild(el("div", "vacia", "nada aca"));
      } else {
        var pila = el("div", "pila");
        for (var j = 0; j < cs.length; j++) pila.appendChild(tarjeta(cs[j]));
        col.appendChild(pila);
      }
      t.appendChild(col);
    }
  }

  function vivo(si) {
    var p = document.getElementById("pulso");
    p.className = si ? "punto vivo" : "punto frio";
    p.title = si ? "leyendo el estado en disco" : "sin conexion con el board";
  }

  document.getElementById("d-cerrar").addEventListener("click", function () {
    document.getElementById("detalle").close();
  });

  function conectar() {
    var es = new EventSource("/api/events");
    es.addEventListener("open", function () { vivo(true); });
    es.addEventListener("message", function (e) {
      vivo(true);
      try {
        ultimo = JSON.parse(e.data);
        pintar(ultimo);
      } catch (err) {
        // Un payload ilegible no puede dejar la pantalla en blanco: se queda lo
        // ultimo que si se pudo leer.
      }
    });
    es.addEventListener("error", function () { vivo(false); });
  }

  // La primera carga va por fetch para que la pantalla no quede vacia si el
  // stream tarda, y despues el stream la mantiene al dia.
  fetch("/api/board").then(function (r) { return r.json(); }).then(function (b) {
    ultimo = b;
    pintar(b);
  }).catch(function () {}).then(conectar);
})();
</script>
`;

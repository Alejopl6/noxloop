// La pagina del board. Va compilada dentro del modulo a proposito: asi el
// servidor no sirve ningun archivo del disco y no hay ruta que se pueda usar
// para salir a leer otra cosa.
//
// POR QUE NO PIDE NADA A LA RED. Se mira cuando algo se rompio, y eso incluye
// "no hay internet". Sin fuentes remotas, sin CDN, sin iconos externos. Hay un
// test que falla si aparece una URL que no sea loopback.
//
// El JavaScript de abajo no usa plantillas con acento invertido: este archivo
// ES una plantilla, y anidarlas lo volveria imposible de leer.

export const PAGINA = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>noxloop</title>
<style>
  :root {
    --fondo: #0b0d10; --panel: #14171c; --panel2: #1a1e25; --borde: #262c35;
    --texto: #e6e9ef; --suave: #9aa4b2; --tenue: #6b7480;
    --ok: #3fb950; --curso: #58a6ff; --pr: #a371f7; --alto: #f0883e; --mal: #f85149;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --fondo: #f6f7f9; --panel: #fff; --panel2: #f0f2f5; --borde: #dfe3e8;
      --texto: #1c2024; --suave: #57606a; --tenue: #8b949e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--fondo); color: var(--texto);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  header {
    display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
    padding: 14px 20px; border-bottom: 1px solid var(--borde); background: var(--panel);
    position: sticky; top: 0; z-index: 5;
  }
  h1 { font-size: 15px; margin: 0; letter-spacing: .08em; text-transform: uppercase; }
  h1 span { color: var(--tenue); }
  .metricas { display: flex; gap: 14px; color: var(--suave); font-size: 12px; margin-left: auto; align-items: center; }
  .metricas b { color: var(--texto); font-variant-numeric: tabular-nums; }
  .pulso { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .pulso.frio { background: var(--mal); }

  main { padding: 20px; display: grid; gap: 20px; }

  .aviso-panel { border: 1px solid var(--borde); border-radius: 10px; overflow: hidden; }
  .aviso-panel > h2 {
    margin: 0; padding: 10px 14px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    background: var(--panel); border-bottom: 1px solid var(--borde); color: var(--suave);
  }
  .aviso-panel.urgente { border-color: var(--alto); }
  .aviso-panel.urgente > h2 { color: var(--alto); }
  .fila { padding: 12px 14px; border-bottom: 1px solid var(--borde); background: var(--panel2); }
  .fila:last-child { border-bottom: 0; }
  .fila .quien { font-family: var(--mono); font-size: 12px; color: var(--curso); }
  .fila .que { margin-top: 5px; white-space: pre-wrap; color: var(--texto); }
  .fila .marca { margin-left: 8px; font-size: 11px; color: var(--tenue); text-transform: uppercase; letter-spacing: .05em; }
  .fila.warn .quien { color: var(--alto); }
  .fila.error .quien { color: var(--mal); }

  .tablero { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; align-items: start; }
  .col { border: 1px solid var(--borde); border-radius: 10px; background: var(--panel); min-width: 0; }
  .col > h3 {
    margin: 0; padding: 10px 12px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
    color: var(--suave); display: flex; justify-content: space-between; border-bottom: 1px solid var(--borde);
  }
  .col > h3 em { font-style: normal; color: var(--tenue); font-variant-numeric: tabular-nums; }
  .col[data-id=running] > h3 { color: var(--curso); }
  .col[data-id=pr_open] > h3 { color: var(--pr); }
  .col[data-id=integrated] > h3 { color: var(--ok); }
  .col[data-id=blocked] > h3 { color: var(--mal); }
  .pila { padding: 10px; display: grid; gap: 10px; }
  .vacia { padding: 14px 12px; color: var(--tenue); font-size: 12px; }

  .tarjeta {
    border: 1px solid var(--borde); border-radius: 8px; background: var(--panel2);
    padding: 11px; display: grid; gap: 8px; cursor: pointer;
  }
  .tarjeta:hover { border-color: var(--curso); }
  .tarjeta .id { font-family: var(--mono); font-size: 11px; color: var(--tenue); display: flex; gap: 8px; align-items: center; }
  .tarjeta .tit { font-weight: 500; overflow-wrap: anywhere; }
  .chip {
    font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--borde);
    color: var(--suave); text-transform: uppercase; letter-spacing: .05em;
  }
  .chip.espera { color: var(--alto); border-color: var(--alto); }
  .chip.viva { color: var(--curso); border-color: var(--curso); }
  .barra { height: 4px; border-radius: 999px; background: var(--borde); overflow: hidden; }
  .barra i { display: block; height: 100%; background: var(--ok); }
  .pie { display: flex; justify-content: space-between; font-size: 11px; color: var(--tenue); font-variant-numeric: tabular-nums; }
  .pie a { color: var(--pr); text-decoration: none; }
  .pie a:hover { text-decoration: underline; }

  dialog {
    border: 1px solid var(--borde); border-radius: 12px; background: var(--panel);
    color: var(--texto); max-width: 620px; width: calc(100% - 40px); padding: 0;
  }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  dialog header { border-radius: 12px 12px 0 0; }
  dialog .cuerpo { padding: 16px; display: grid; gap: 14px; }
  dialog h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--suave); }
  dialog pre { margin: 0; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--texto); }
  dialog button { background: var(--panel2); color: var(--texto); border: 1px solid var(--borde); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; }
  .kv dt { color: var(--tenue); }
  .kv dd { margin: 0; font-family: var(--mono); overflow-wrap: anywhere; }
</style>

<header>
  <h1>noxloop <span>board</span></h1>
  <div class="metricas">
    <span><b id="m-items">0</b> items</span>
    <span><b id="m-activas">0</b> tareas vivas</span>
    <span>US$ <b id="m-gasto">0</b></span>
    <span class="pulso frio" id="pulso" title="sin conexion"></span>
  </div>
</header>

<main>
  <section class="aviso-panel urgente" id="p-respuesta" hidden>
    <h2>Te necesitan</h2>
    <div id="l-respuesta"></div>
  </section>

  <section class="aviso-panel" id="p-avisos" hidden>
    <h2>Avisos del motor</h2>
    <div id="l-avisos"></div>
  </section>

  <section class="tablero" id="tablero"></section>

  <section class="aviso-panel" id="p-omitidos" hidden>
    <h2>Omitidos por la bandeja</h2>
    <div id="l-omitidos"></div>
  </section>
</main>

<dialog id="detalle">
  <header><h1 id="d-id">—</h1></header>
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
    ["pending", "Por empezar"], ["running", "En curso"], ["pr_open", "Con PR abierto"],
    ["integrated", "Integrado"], ["blocked", "Bloqueado"]
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

  function tarjeta(c) {
    var n = el("article", "tarjeta");
    n.tabIndex = 0;

    var id = el("div", "id");
    id.appendChild(el("span", null, c.itemId));
    if (c.provider) id.appendChild(el("span", "chip", c.provider));
    if (c.hitoId) id.appendChild(el("span", "chip", "hito " + c.hitoId));
    if (c.esperandoRespuesta) id.appendChild(el("span", "chip espera", "espera respuesta"));
    if (c.tareas.activas.length) id.appendChild(el("span", "chip viva", c.tareas.activas.length + " viva"));
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
      ["pr", c.pr || "—"], ["hito", c.hitoId || "—"], ["gasto", "US$ " + c.gasto.usd + " en " + c.gasto.calls + " llamadas"],
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

  function panel(idPanel, idLista, filas) {
    var lista = document.getElementById(idLista);
    lista.textContent = "";
    for (var i = 0; i < filas.length; i++) {
      var f = el("div", "fila " + (filas[i].nivel || ""));
      f.appendChild(el("div", "quien", filas[i].quien));
      f.appendChild(el("div", "que", filas[i].que));
      lista.appendChild(f);
    }
    document.getElementById(idPanel).hidden = filas.length === 0;
  }

  function pintar(b) {
    document.getElementById("m-items").textContent = b.totales.items;
    document.getElementById("m-activas").textContent = b.totales.tareasActivas;
    document.getElementById("m-gasto").textContent = b.totales.gastoUsd;

    panel("p-respuesta", "l-respuesta", (b.necesitanRespuesta || []).map(function (n) {
      return { quien: n.itemId + "  (" + n.origen + ", hace " + corto(n.desde) + ")", que: n.pregunta };
    }));

    panel("p-avisos", "l-avisos", (b.avisos || []).map(function (a) {
      return { nivel: a.nivel, quien: a.nivel === "error" ? "error" : "aviso", que: a.mensaje };
    }));

    panel("p-omitidos", "l-omitidos", (b.omitidos || []).map(function (o) {
      return { quien: o.itemId + "  [" + o.clase + "]", que: o.motivo };
    }));

    var t = document.getElementById("tablero");
    t.textContent = "";
    for (var i = 0; i < COLS.length; i++) {
      var id = COLS[i][0];
      var col = el("section", "col");
      col.setAttribute("data-id", id);
      var h = el("h3");
      h.appendChild(el("span", null, COLS[i][1]));
      var cs = (b.columnas.filter(function (c) { return c.id === id; })[0] || { tarjetas: [] }).tarjetas;
      h.appendChild(el("em", null, String(cs.length)));
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
    p.className = si ? "pulso" : "pulso frio";
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

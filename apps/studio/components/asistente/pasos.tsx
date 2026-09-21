'use client'

import { PasoDeAlta } from '@/components/asistente/paso-de-alta'
import { PasoDeDiseno } from '@/components/asistente/paso-de-diseno'
import { PasoFinal } from '@/components/asistente/paso-final'
import type { ContextoDelPaso, PasoDelAsistente } from '@/components/asistente/paso'
import { VistaDeSnapshot } from '@/components/vista-snapshot'
import { VistaDeConstitution } from '@/components/vista-constitution'
import { VistaDeGuidelines } from '@/components/vista-guidelines'
import { VistaDeBootstrap } from '@/components/vista-bootstrap'
import { VistaDeConexiones } from '@/components/vista-conexiones'
import { VistaDeFlota } from '@/components/vista-flota'
import { recorridoDelProyecto } from '@/lib/tipos'

/**
 * EL RECORRIDO, DECLARADO.
 *
 * El orden de este array ES el producto: crear el proyecto y que el sistema te
 * lleve de la mano hasta que ese proyecto puede recibir ciclos solo. Cambiarlo
 * de sitio cambia el producto, y por eso el orden vive aqui y no repartido
 * entre la navegacion, las vistas y los botones de "siguiente" de cada una.
 *
 * LAS OCHO ETAPAS NO SE REESCRIBEN: SE ENVUELVEN. Cada paso monta la vista que
 * ya existia, entera, con su propio `navegar`. Las trece pantallas de consola
 * siguen siendo las mismas pantallas —no hay una version "de asistente" y otra
 * "de consola" que se separen al tercer arreglo— y lo unico que el asistente
 * anade es el marco: donde estas, que decides aqui, y por donde se sigue.
 *
 * EL `navegar` QUE RECIBEN ES EL DEL ASISTENTE. Las vistas siguen llamando a
 * `navegar({ seccion: 'bootstrap', ... })` cuando su etapa queda cerrada,
 * igual que antes; lo que cambia es quien contesta. Por eso no hubo que tocar
 * ni una de las seis.
 */
export const PASOS_DEL_ASISTENTE: readonly PasoDelAsistente[] = [
  {
    id: 'alta',
    titulo: 'El proyecto',
    proposito:
      'Elige el proyecto que vas a establecer: uno que dejaste a medias, una carpeta que ya tienes, un repositorio remoto o uno nuevo desde una plantilla.',
    seccion: 'proyecto-nuevo',
    ancho: 'formulario',
    exige: null,
    omitible: false,
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) => <PasoDeAlta navegar={contexto.navegar} />,
  },

  {
    id: 'discovery',
    titulo: 'Analisis',
    proposito:
      'La maquina lee el codigo y te ensena lo que encontro. Decides cada hallazgo —aceptar, corregir o descartar— y aceptas el snapshot. El escaneo no escribe nada en tu repositorio.',
    seccion: 'snapshot',
    ancho: 'detalle',
    exige: 'snapshot_aceptado',
    omitible: false,
    automatico: false,
    preparacion: null,
    // El atajo del proyecto nuevo, leido de donde ya estaba declarado. No se
    // reescribe la condicion aqui: `recorridoDelProyecto` transcribe la arista
    // `CREATED -> CONSTITUTED` con `soloOrigen: "nuevo"` de la maquina de
    // estados, y dos copias de esa regla divergen a la primera.
    aplicaA: (proyecto) => proyecto === null || recorridoDelProyecto(proyecto).includes('DISCOVERED'),
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <VistaDeSnapshot proyectoId={contexto.proyectoId} navegar={contexto.navegar} />
      ) : null,
  },

  {
    id: 'constitution',
    titulo: 'Constitution',
    proposito:
      'Las reglas que el runtime consulta cuando una decision es ambigua. La maquina propone un borrador derivado del analisis, marcando que apartados detecto y cuales infirio; tu la revisas y la fijas.',
    seccion: 'constitution',
    ancho: 'lectura',
    exige: 'constitution_vigente',
    omitible: false,
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <VistaDeConstitution proyectoId={contexto.proyectoId} navegar={contexto.navegar} />
      ) : null,
  },

  {
    id: 'guidelines',
    titulo: 'Guidelines',
    proposito:
      'Como se hace lo que si se puede hacer, por area. La constitution dice que no se puede; esto dice como. Quedan versionadas junto al codigo.',
    // No hay seccion de consola para las guidelines: se llega a ellas dentro
    // de la pantalla de constitution. No es un olvido del contrato — son la
    // misma etapa (02-04) y comparten pantalla.
    seccion: 'constitution',
    ancho: 'lectura',
    // Ver `PasoDelAsistente.exige`: el servicio no publica ninguna guarda que
    // diga si las guidelines quedaron escritas. Consecuencia declarada: este
    // paso nunca bloquea y nunca es donde el asistente retoma.
    exige: null,
    omitible: false,
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? <VistaDeGuidelines proyectoId={contexto.proyectoId} /> : null,
  },

  {
    id: 'diseno',
    titulo: 'Diseno',
    proposito:
      'El sistema de diseno del proyecto. Si el proyecto no tiene superficie visual, este paso se omite y no penaliza ni bloquea nada.',
    seccion: null,
    ancho: 'lectura',
    exige: null,
    // FR-023, y es el unico paso del recorrido que lo es.
    omitible: true,
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <PasoDeDiseno
          proyectoId={contexto.proyectoId}
          alTerminar={contexto.irAlSiguientePaso}
        />
      ) : null,
  },

  {
    id: 'bootstrap',
    titulo: 'Bootstrap',
    proposito:
      'La maquina detecta el setup que ya tienes y propone lo que falta, cada cosa con su diff exacto. De cada recomendacion decides una de tres: aplicar, personalizar u omitir.',
    seccion: 'bootstrap',
    ancho: 'detalle',
    exige: 'bootstrap_resuelto',
    omitible: false,
    automatico: true,
    preparacion: {
      produce:
        'Detecta el setup que el proyecto ya tiene y calcula las recomendaciones que faltan, cada una con el diff exacto que escribiria.',
      porQueNoEscribe:
        'Analizar LEE el arbol del proyecto y calcula diffs: no toca ni un byte de tu repositorio. Lo que escribe es aplicar una recomendacion, y eso lo pulsas tu, una a una, con el diff delante (FR-026). Si el arbol cambio desde que se calculo, aplicar falla y pide recalcular en vez de escribir algo distinto de lo que viste.',
      // PARA EL FRENTE DEL BOOTSTRAP AUTOMATICO: el servicio ya expone
      // `GET /v1/projects/:id/bootstrap/proposal`, que detecta y propone en una
      // sola lectura. El dia que `VistaDeBootstrap` lea esa ruta en vez de
      // `/recommendations`, esta preparacion sobra y lo correcto es poner
      // `preparacion: null` dejando `automatico: true` — lo automatico habra
      // pasado a estar dentro del paso, que es mejor sitio. Mientras la vista
      // siga leyendo `/recommendations`, sin este `analyze` el paso entra con
      // la lista vacia y el operador tiene que pulsar "analizar", que es
      // justamente lo que el recorrido existe para quitarle.
      peticion: (proyectoId: string) => ({
        metodo: 'POST',
        ruta: `/v1/projects/${proyectoId}/bootstrap/analyze`,
      }),
    },
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <VistaDeBootstrap proyectoId={contexto.proyectoId} navegar={contexto.navegar} />
      ) : null,
  },

  {
    id: 'conexiones',
    titulo: 'Conexiones',
    proposito:
      'De donde sale el ticket y donde se abre el pull request. Eliges el proveedor y autorizas en su pagina; que la conexion vaya por OAuth o por token lo decide el catalogo segun el proveedor, no tu.',
    seccion: 'conexiones',
    ancho: 'inventario',
    exige: 'conexion_viva',
    omitible: false,
    // NO es automatico, y no por falta de ganas: autorizar exige que una
    // persona se identifique en la pagina del proveedor. Una conexion que se
    // estableciera sola seria una credencial que el operador no autorizo.
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <VistaDeConexiones proyectoId={contexto.proyectoId} navegar={contexto.navegar} />
      ) : null,
  },

  {
    id: 'flota',
    titulo: 'Flota',
    proposito:
      'Quien implementa y quien revisa, con runtimes distintos. Declarada la flota, el proyecto se activa y puede recibir ciclos.',
    seccion: 'flota',
    ancho: 'inventario',
    exige: 'flota_declarada',
    omitible: false,
    automatico: true,
    preparacion: {
      produce:
        'Propone la flota que este proyecto necesita —quien implementa, quien revisa, con que runtime y con que presupuesto— a partir de lo que el analisis encontro.',
      porQueNoEscribe:
        'Sugerir produce una propuesta de agentes que se ensena en el formulario: no da de alta ningun agente ni concede ninguna credencial. Alta y grants siguen siendo dos pulsaciones tuyas.',
      // EL HUECO, declarado como hueco (principio X). La tabla de rutas del
      // servicio no tiene hoy ningun endpoint de sugerencia de flota: lo
      // construye otro frente en `packages/`. Poner aqui una ruta inventada
      // dejaria el paso lanzando un 404 contra el servicio en cada entrada.
      peticion: null,
      hueco:
        'El asistente ya tiene el sitio donde enchufar la sugerencia de flota, y el servicio todavia no expone la peticion que la produce. Mientras tanto declaras los agentes a mano, aqui abajo: al menos un implementador y un revisor, con runtimes distintos.',
    },
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) =>
      contexto.proyectoId ? (
        <VistaDeFlota proyectoId={contexto.proyectoId} navegar={contexto.navegar} />
      ) : null,
  },

  {
    id: 'listo',
    titulo: 'Listo',
    proposito: 'El proyecto esta establecido. Esto es lo que puede hacer ahora.',
    // SIN SECCION, y el primer intento puso `runs`. El HTML generado enseno
    // por que no: con seccion, el pie del marco pinta "Abrir la pantalla de
    // Ciclos" justo debajo del "Ir a los ciclos" que ya pinta el cuerpo — dos
    // botones al mismo sitio a cuatro centimetros. Y ademas era falso: `runs`
    // no es la version de consola de este paso, es lo que viene despues de el.
    seccion: null,
    ancho: 'lectura',
    exige: null,
    omitible: false,
    automatico: false,
    preparacion: null,
    aplicaA: () => true,
    cuerpo: (contexto: ContextoDelPaso) => (
      <PasoFinal
        proyecto={contexto.proyecto}
        artefactos={contexto.artefactos}
        navegar={contexto.navegar}
      />
    ),
  },
]

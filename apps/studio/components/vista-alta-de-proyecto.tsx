'use client'

import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, GitBranch, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Encabezado, EsqueletoDeLista } from '@/components/pantalla'
import { elegirCarpeta, superficieDeSeleccion, type SuperficieDeSeleccion } from '@/lib/carpeta'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { AltaDeProyecto, OrigenProyecto, Plantilla, Proyecto } from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T085 · Alta de proyecto, con sus tres origenes. T087 · Las plantillas.
 *
 * LOS TRES ORIGENES SON TRES PREGUNTAS DISTINTAS, no un desplegable de
 * configuracion: "no tengo codigo todavia", "el codigo esta en esta carpeta",
 * "el codigo esta en ese repositorio". Por eso el selector es segmentado y no
 * un desplegable — las tres opciones se ven a la vez y cambian la pantalla de
 * abajo entera, que es exactamente para lo que sirve un control segmentado.
 *
 * LA ASIMETRIA DEL SELECTOR DE CARPETAS SE DICE, NO SE TAPA. En escritorio hay
 * dialogo nativo; en el navegador no hay forma de obtener la ruta de una
 * carpeta del disco, ni con `webkitdirectory` ni con `showDirectoryPicker`.
 * `lib/carpeta.ts` lo resuelve con la misma forma que `lib/daemon.ts` usa para
 * el origen del servicio, y esta pantalla pinta el camino que corresponde a la
 * superficie en la que esta corriendo. Un boton "Elegir carpeta" que en web no
 * hace nada seria peor que no tener boton.
 *
 * LOS DOS ERRORES DEL CONTRATO SE PINTAN CON SU ACCION, que es lo que el
 * contrato devuelve y lo que casi siempre se pierde por el camino:
 *
 *   - `no_es_repositorio` — la carpeta existe y no es un repositorio git. La
 *     salida no es "vuelve a intentarlo": es inicializarlo o elegir otra
 *     carpeta (escenario 4 de US1), y las dos estan aqui como controles.
 *   - `destino_no_vacio` — el destino de un proyecto nuevo ya tiene contenido.
 *     La app se niega a escribir encima y ofrece adoptarlo como existente
 *     (escenario 3 de US2), que aqui es un control que cambia el origen a
 *     "carpeta local" con la misma ruta ya escrita.
 *
 * Fijarse en que ninguna de las dos salidas escribe nada desde aqui: las dos
 * vuelven a llamar a `POST /v1/projects` con otro cuerpo. El servicio sigue
 * siendo el unico escritor (principio VIII).
 */

const ORIGENES = [
  {
    valor: 'nuevo' as const,
    etiqueta: 'Proyecto nuevo',
    icono: <Sparkles />,
    descripcion:
      'No hay codigo todavia. Se parte de una plantilla que eliges tu y el workspace queda inicializado. La etapa de analisis se omite explicitamente: no hay nada que escanear, y un analisis sobre una plantilla recien copiada solo devolveria la plantilla.',
  },
  {
    valor: 'local' as const,
    etiqueta: 'Carpeta local',
    icono: <FolderGit2 />,
    descripcion:
      'El codigo ya existe en esta maquina. noxloop lo lee para producir el snapshot y no modifica ni un archivo: el arbol de trabajo queda byte a byte igual.',
  },
  {
    valor: 'remoto' as const,
    etiqueta: 'Repositorio remoto',
    icono: <GitBranch />,
    descripcion:
      'El codigo esta en un repositorio remoto. Se clona a un area de trabajo propia de noxloop —no a tu carpeta de proyectos— y se analiza ahi. Necesita una credencial del gestor de repositorios con grant vigente.',
  },
]

/* -------------------------------------------------------------------------- */
/* T087 · Plantillas                                                          */
/* -------------------------------------------------------------------------- */

/**
 * El selector de plantilla de un proyecto nuevo.
 *
 * LA LISTA NO ESTA CABLEADA EN ESTA INTERFAZ, y esa decision es la mitad del
 * componente. El contrato declara que `POST /v1/projects` acepta `plantilla`,
 * pero NO declara donde se enumeran las plantillas disponibles. Hay dos
 * salidas: inventar aqui una lista de plantillas —y entonces la interfaz
 * decide producto, que es justo lo que el principio VIII prohibe— o pedirsela
 * al servicio y, si no la conoce, decirlo y dejar declarar el identificador a
 * mano.
 *
 * Esta es la segunda. Cuando el otro frente publique el catalogo, esta
 * pantalla lo pinta sin tocar una linea; mientras tanto no finge tenerlo.
 */
function SelectorDePlantilla({
  plantillas,
  elegida,
  alElegir,
}: {
  plantillas: Lectura<Plantilla[]>
  elegida: string
  alElegir: (id: string) => void
}) {
  const lista = plantillas.datos ?? []
  const cargando = plantillas.datos === null && plantillas.error === null

  if (cargando) return <EsqueletoDeLista filas={2} />

  // El servicio no publica catalogo de plantillas. Se dice, y se ofrece el
  // camino manual: quien conozca el identificador puede seguir.
  if (lista.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Note tipo="informativo" titulo="Este servicio no publica catalogo de plantillas">
          {plantillas.error
            ? plantillas.error.causa
            : 'El servicio de control contesto una lista vacia en /v1/templates.'}{' '}
          Esta interfaz no inventa una: una lista de plantillas escrita en el
          cliente seria la interfaz decidiendo que sabe hacer el servicio.
        </Note>
        <Campo
          etiqueta="Identificador de la plantilla"
          valor={elegida}
          alCambiar={alElegir}
          operativo
          marcador="node-typescript"
          ayuda="Opcional. Sin plantilla, el workspace queda inicializado vacio y con el repositorio creado."
        />
      </div>
    )
  }

  return (
    <ListaDeEntidades etiqueta="Plantillas disponibles">
      {lista.map((plantilla) => (
        <Entity
          key={plantilla.id}
          contenedor="li"
          titulo={plantilla.nombre}
          identificador={plantilla.id}
          descripcion={plantilla.descripcion}
          metadatos={
            <>
              {plantilla.stack ? (
                <span className="text-label-12 text-ds-gray-700">Stack: {plantilla.stack}</span>
              ) : null}
              {plantilla.arquitectura ? (
                <span className="text-label-12 text-ds-gray-700">
                  Arquitectura: {plantilla.arquitectura}
                </span>
              ) : null}
              {plantilla.testing ? (
                <span className="text-label-12 text-ds-gray-700">
                  Testing: {plantilla.testing}
                </span>
              ) : null}
            </>
          }
          alPulsar={() => alElegir(plantilla.id)}
          seleccionada={elegida === plantilla.id}
        />
      ))}
    </ListaDeEntidades>
  )
}

/* -------------------------------------------------------------------------- */
/* El formulario                                                              */
/* -------------------------------------------------------------------------- */

export function PanelDeAltaDeProyecto({
  plantillas,
  alCrear,
  trabajando,
  error,
  navegar,
}: {
  plantillas: Lectura<Plantilla[]>
  alCrear: (alta: AltaDeProyecto) => void
  trabajando: boolean
  error: ErrorDelServicio | null
  navegar: Navegar
}) {
  const [origen, setOrigen] = useState<OrigenProyecto>('local')
  const [nombre, setNombre] = useState('')
  const [ruta, setRuta] = useState('')
  const [remoto, setRemoto] = useState('')
  const [plantilla, setPlantilla] = useState('')
  const [superficie, setSuperficie] = useState<SuperficieDeSeleccion>('desconocida')
  const [errorDeCarpeta, setErrorDeCarpeta] = useState<ErrorDelServicio | null>(null)

  // `isTauri()` lee `window` sin protegerse: fuera de un efecto revienta el
  // prerender de `next build`. Misma regla que en `lib/daemon.ts`.
  useEffect(() => {
    let vigente = true
    superficieDeSeleccion().then((cual) => {
      if (vigente) setSuperficie(cual)
    })
    return () => {
      vigente = false
    }
  }, [])

  const abrirSelector = async () => {
    setErrorDeCarpeta(null)
    try {
      const elegida = await elegirCarpeta({ desde: ruta || undefined })
      // `null` es "cerre el dialogo sin elegir". No es un error y no se pinta
      // como uno.
      if (elegida) setRuta(elegida)
    } catch (fallo: unknown) {
      setErrorDeCarpeta(comoErrorDelServicio(fallo, 'selector de carpetas'))
    }
  }

  const faltaNombre = nombre.trim().length === 0
  const faltaRuta = origen !== 'remoto' && ruta.trim().length === 0
  const faltaRemoto = origen === 'remoto' && remoto.trim().length === 0
  const incompleto = faltaNombre || faltaRuta || faltaRemoto

  const enviar = (sobrescribir?: Partial<AltaDeProyecto>) => {
    const alta: AltaDeProyecto = {
      origen,
      nombre: nombre.trim(),
      ...(origen !== 'remoto' ? { ruta_local: ruta.trim() } : {}),
      ...(origen === 'remoto' ? { remoto: remoto.trim() } : {}),
      ...(origen === 'nuevo' && plantilla.trim() ? { plantilla: plantilla.trim() } : {}),
      ...sobrescribir,
    }
    alCrear(alta)
  }

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Anadir proyecto"
        descripcion="De donde sale el codigo decide que pasa despues: un proyecto nuevo se salta el analisis porque no hay nada que leer; uno existente empieza por leerlo sin tocarlo."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
      />

      <Segmentado
        etiqueta="Origen del proyecto"
        opciones={ORIGENES}
        valor={origen}
        alCambiar={(valor) => setOrigen(valor)}
      />

      <Fieldset>
        <FieldsetContent
          titulo="Identidad"
          descripcion="Como se llama este proyecto dentro de noxloop. No tiene que coincidir con el nombre de la carpeta ni con el del repositorio."
        >
          <div className="flex flex-col gap-5">
            <Campo
              etiqueta="Nombre"
              valor={nombre}
              alCambiar={setNombre}
              requerido
              marcador="consola de control"
              className="max-w-md"
            />

            {origen === 'remoto' ? (
              <Campo
                etiqueta="Repositorio remoto"
                valor={remoto}
                alCambiar={setRemoto}
                requerido
                operativo
                marcador="git@servidor:organizacion/repositorio.git"
                ayuda="Se clona a un area de trabajo propia de noxloop. Necesita una credencial del gestor de repositorios con grant vigente; si no la hay, la tarea se bloquea y entra en la bandeja en vez de fallar."
              />
            ) : (
              <Campo
                etiqueta={origen === 'nuevo' ? 'Destino del repositorio' : 'Carpeta del proyecto'}
                valor={ruta}
                alCambiar={setRuta}
                requerido
                operativo
                marcador="/ruta/absoluta/al/proyecto"
                ayuda={
                  superficie === 'escritorio'
                    ? 'Ruta absoluta. Tambien puedes elegirla con el dialogo del sistema.'
                    : 'Ruta absoluta, tal como la ve el servicio de control. En el navegador no hay dialogo de carpetas: el navegador no entrega la ruta de una carpeta del disco a una pagina web, asi que se escribe.'
                }
                accion={
                  superficie === 'escritorio' ? (
                    <Button variant="secondary" size="sm" onClick={() => void abrirSelector()}>
                      <FolderOpen />
                      Elegir carpeta
                    </Button>
                  ) : null
                }
              />
            )}

            {errorDeCarpeta ? (
              <ErrorText causa={errorDeCarpeta.causa} accion={errorDeCarpeta.accion} />
            ) : null}
          </div>
        </FieldsetContent>

        {origen === 'nuevo' ? (
          <FieldsetContent
            titulo="Plantilla"
            descripcion="De donde parte el workspace. Es lo unico que el bootstrap tendra para trabajar, porque no habra snapshot del que derivar nada."
          >
            <SelectorDePlantilla
              plantillas={plantillas}
              elegida={plantilla}
              alElegir={setPlantilla}
            />
          </FieldsetContent>
        ) : null}

        {error ? (
          <FieldsetContent>
            <div className="flex flex-col gap-3">
              <ErrorText causa={error.causa} accion={error.accion} />
              <SalidasDelError
                error={error}
                origen={origen}
                ruta={ruta}
                alAdoptarComoExistente={() => {
                  setOrigen('local')
                  enviar({ origen: 'local', plantilla: undefined })
                }}
                alInicializarRepositorio={() => {
                  setOrigen('nuevo')
                  enviar({ origen: 'nuevo' })
                }}
                alElegirOtraCarpeta={() => void abrirSelector()}
                puedeAbrirSelector={superficie === 'escritorio'}
              />
            </div>
          </FieldsetContent>
        ) : null}

        <FieldsetFooter
          nota={
            incompleto
              ? 'Faltan datos obligatorios. Nada se envia hasta que esten.'
              : origen === 'nuevo'
                ? 'Al crearlo, el workspace queda inicializado y la etapa de analisis se omite: no hay codigo que escanear.'
                : 'Al crearlo, lo siguiente es el analisis. El scanner lee y no escribe: el arbol de trabajo queda igual.'
          }
        >
          <Button
            variant="secondary"
            onClick={() => navegar({ seccion: 'proyectos', id: null })}
            disabled={trabajando}
          >
            Cancelar
          </Button>
          <Button onClick={() => enviar()} disabled={incompleto || trabajando}>
            {trabajando ? <Spinner tamano="sm" etiqueta="Creando el proyecto" /> : null}
            Crear proyecto
          </Button>
        </FieldsetFooter>
      </Fieldset>
    </div>
  )
}

/**
 * Las salidas concretas de los dos errores que el contrato nombra.
 *
 * Un error con `accion` en texto ya es mejor que la media. Lo que lo hace
 * operable es que la accion sea ademas un control: leer "ofrece adoptarlo como
 * existente" y tener que reconstruir a mano que eso significa cambiar el
 * origen y volver a enviar es trabajo que la pantalla puede hacer.
 */
function SalidasDelError({
  error,
  origen,
  ruta,
  alAdoptarComoExistente,
  alInicializarRepositorio,
  alElegirOtraCarpeta,
  puedeAbrirSelector,
}: {
  error: ErrorDelServicio
  origen: OrigenProyecto
  ruta: string
  alAdoptarComoExistente: () => void
  alInicializarRepositorio: () => void
  alElegirOtraCarpeta: () => void
  puedeAbrirSelector: boolean
}) {
  if (error.codigo === 'destino_no_vacio') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={alAdoptarComoExistente}>
          Adoptarlo como proyecto existente
        </Button>
        <span className="text-label-12 text-ds-gray-700">
          Se registra la misma ruta como carpeta local y se analiza sin tocar nada.
        </span>
      </div>
    )
  }

  if (error.codigo === 'no_es_repositorio') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={alInicializarRepositorio}>
          Inicializar el repositorio en esta carpeta
        </Button>
        {puedeAbrirSelector ? (
          <Button variant="secondary" size="sm" onClick={alElegirOtraCarpeta}>
            Elegir otra carpeta
          </Button>
        ) : null}
        <span className="text-label-12 text-ds-gray-700">
          {origen === 'local' && ruta
            ? `Inicializar crea el repositorio en ${ruta} y lo registra como proyecto nuevo. No borra nada de lo que ya hay.`
            : 'Inicializar crea el repositorio en la ruta indicada y lo registra como proyecto nuevo.'}
        </span>
      </div>
    )
  }

  return null
}

export function VistaDeAltaDeProyecto({ navegar }: { navegar: Navegar }) {
  const plantillas = useLectura<Plantilla[]>('/v1/templates')
  const mutacion = useMutacion()

  const crear = async (alta: AltaDeProyecto) => {
    const creado = await mutacion.enviar<Proyecto>('POST', '/v1/projects', alta)
    if (!creado) return

    // A donde se va despues NO es la misma pantalla para los tres origenes, y
    // eso es US2 escenario 2: un proyecto nuevo se salta el analisis porque no
    // hay codigo que escanear, asi que llevarlo a la pantalla de snapshot
    // seria mandarlo a mirar una lista vacia que nunca se va a llenar.
    navegar({
      seccion: alta.origen === 'nuevo' ? 'constitution' : 'snapshot',
      id: creado.id,
    })
  }

  return (
    <PanelDeAltaDeProyecto
      plantillas={plantillas}
      alCrear={(alta) => void crear(alta)}
      trabajando={mutacion.trabajando}
      error={mutacion.error}
      navegar={navegar}
    />
  )
}

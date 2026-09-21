'use client'

import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, GitBranch, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ExploradorDeCarpetas } from '@/components/ui/explorador-de-carpetas'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Seleccion } from '@/components/ui/seleccion'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Encabezado, EsqueletoDeLista } from '@/components/pantalla'
import { SelectorDeRepositorio, useConexionesDeCodigo } from '@/components/selector-de-repositorio'
import { elegirCarpeta, superficieDeSeleccion, type SuperficieDeSeleccion } from '@/lib/carpeta'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import { useOpciones, useValorConPreseleccion } from '@/lib/opciones'
import {
  GRUPO,
  type AltaDeProyecto,
  type AutorizacionDeConexion,
  type Conexion,
  type EntradaDeCatalogoDeConexiones,
  type GrupoDeOpciones,
  type OrigenProyecto,
  type Plantilla,
  type Proyecto,
  type RepositorioRemoto,
} from '@/lib/tipos'
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
    // EL TEXTO DECIA QUE EL CLON VA «a un area de trabajo propia de noxloop —no
    // a tu carpeta de proyectos—», y era falso EN LOS DOS SENTIDOS: el servicio
    // exige una `ruta_local` y clona donde se le diga, y esta pantalla ni
    // siquiera la pedia. Una descripcion que promete que el producto elige por
    // ti, al lado de un campo que te obliga a elegir, deja al operador sin
    // saber cual de las dos cosas es verdad.
    descripcion:
      'El codigo esta en un repositorio remoto. Conectas tu cuenta aqui mismo, eliges el repositorio de la lista y dices en que carpeta de esta maquina se clona. El clon lo hace el motor cuando le toca: dar de alta el proyecto no descarga nada todavia.',
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
  autonomias,
  cargandoOpciones = false,
  conexionesDeCodigo = [],
  cargandoConexiones = false,
  errorDeConexiones = null,
  catalogoDeCodigo = [],
  alConectarCuenta,
  conectandoCuenta = false,
  errorDeConectar = null,
  alCrear,
  trabajando,
  error,
  navegar,
}: {
  plantillas: Lectura<Plantilla[]>
  /** `project.autonomia` del catalogo del servicio. Ver `lib/opciones.ts`. */
  autonomias: GrupoDeOpciones
  cargandoOpciones?: boolean
  /** Las conexiones `scm` vivas del espacio de trabajo, para elegir el repositorio. */
  conexionesDeCodigo?: Conexion[]
  cargandoConexiones?: boolean
  errorDeConexiones?: ErrorDelServicio | null
  /** Los proveedores de codigo que se pueden conectar SIN salir de esta pantalla. */
  catalogoDeCodigo?: EntradaDeCatalogoDeConexiones[]
  alConectarCuenta: (proveedor: string, valores: Record<string, string>) => void
  conectandoCuenta?: boolean
  errorDeConectar?: ErrorDelServicio | null
  alCrear: (alta: AltaDeProyecto) => void
  trabajando: boolean
  error: ErrorDelServicio | null
  navegar: Navegar
}) {
  const [origen, setOrigen] = useState<OrigenProyecto>('local')
  const [nombre, setNombre] = useState('')
  const [ruta, setRuta] = useState('')
  const [remoto, setRemoto] = useState('')
  // El repositorio elegido de la lista, aparte de la direccion. Se guardan los
  // dos porque la direccion sigue siendo lo que viaja al servicio —el contrato
  // de `POST /v1/projects` no cambia— y la ficha es lo que la pantalla enseña
  // para que el operador vea QUE eligio y no una cadena que tiene que releer.
  const [repoElegido, setRepoElegido] = useState<RepositorioRemoto | null>(null)
  // La carpeta donde van a vivir los clones, aparte del destino final.
  //
  // SON DOS COSAS Y NO UNA, y meterlas en el mismo estado rompe el explorador:
  // el destino de un clon es una carpeta que TODAVIA NO EXISTE
  // (`<base>/<nombre-del-repo>`), y el explorador pidiendo esa ruta al servicio
  // recibe un error de carpeta inexistente y pinta un fallo sobre algo que esta
  // bien. Asi el explorador navega por lo que hay y el destino se compone.
  const [carpetaBase, setCarpetaBase] = useState('')
  // Escribir el destino a mano manda sobre la propuesta: recomponerlo al elegir
  // otro repositorio pisaria lo que el operador ya decidio.
  const [destinoAMano, setDestinoAMano] = useState(false)
  const [plantilla, setPlantilla] = useState('')
  const [superficie, setSuperficie] = useState<SuperficieDeSeleccion>('desconocida')
  const [errorDeCarpeta, setErrorDeCarpeta] = useState<ErrorDelServicio | null>(null)
  // EL NIVEL DE AUTONOMIA SE ELIGE AL DAR DE ALTA, y antes no se elegia en
  // ninguna pantalla: `POST /v1/projects` lo acepta desde siempre y todo
  // proyecto quedaba en L0 sin que nadie supiera que existian L1 y L2. Un
  // ajuste que no aparece en ninguna superficie no es un valor por defecto: es
  // una funcion que no existe para quien usa el producto.
  //
  // Arranca con lo que el servicio preselecciona —L0, por regla del dominio—
  // en vez de con un literal escrito aqui, y lo adopta cuando el catalogo
  // llega: en el primer render todavia no hay catalogo.
  const [autonomia, setAutonomia] = useValorConPreseleccion(autonomias)

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

  /** `<carpeta base>/<nombre del repositorio>`, que es donde aterriza el clon. */
  const destinoDelClon = (base: string, repositorio: RepositorioRemoto | null) => {
    const limpia = base.replace(/\/+$/, '')
    if (!repositorio?.nombre) return limpia
    return limpia ? `${limpia}/${repositorio.nombre}` : ''
  }

  const faltaNombre = nombre.trim().length === 0
  // LA RUTA LOCAL HACE FALTA EN LOS TRES ORIGENES, Y EL REMOTO NO LA PEDIA.
  //
  // El fallo era terminal y estaba medido contra el servicio: `POST
  // /v1/projects` exige `ruta_local` SIEMPRE —«todo proyecto tiene una ruta en
  // esta maquina, tambien el remoto: es donde va a vivir el clon»— y esta
  // pantalla la omitia justo en `remoto`. Resultado: el boton «Crear proyecto»
  // del origen remoto contestaba 400 `cuerpo_invalido` pidiendo un campo que
  // la pantalla ni siquiera dibujaba. O sea, la rama entera del repositorio
  // remoto no se podia completar por ningun camino.
  const faltaRuta = ruta.trim().length === 0
  const faltaRemoto = origen === 'remoto' && remoto.trim().length === 0
  const incompleto = faltaNombre || faltaRuta || faltaRemoto

  const enviar = (sobrescribir?: Partial<AltaDeProyecto>) => {
    const alta: AltaDeProyecto = {
      origen,
      nombre: nombre.trim(),
      ruta_local: ruta.trim(),
      ...(origen === 'remoto' ? { remoto: remoto.trim() } : {}),
      ...(origen === 'nuevo' && plantilla.trim() ? { plantilla: plantilla.trim() } : {}),
      ...(autonomia ? { autonomia } : {}),
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
              <div className="flex flex-col gap-4">
                {/* EL SELECTOR VA PRIMERO Y EL CAMPO DEBAJO, por el mismo motivo
                    que el explorador de carpetas de la otra rama: antes solo
                    estaba el campo, y pedir la direccion a mano teniendo la
                    credencial del operador guardada en la boveda es hacerle
                    copiar de un navegador algo que el producto puede preguntar.
                    Escribir sigue siendo posible, y cubre el caso que la lista
                    no alcanza: un repositorio de otra cuenta, o uno servido por
                    una forja que todavia no esta en el catalogo. */}
                <SelectorDeRepositorio
                  conexiones={conexionesDeCodigo}
                  cargandoConexiones={cargandoConexiones}
                  errorDeConexiones={errorDeConexiones}
                  catalogoDeCodigo={catalogoDeCodigo}
                  alConectar={alConectarCuenta}
                  conectando={conectandoCuenta}
                  errorDeConectar={errorDeConectar}
                  elegido={repoElegido}
                  alElegir={(repositorio) => {
                    setRepoElegido(repositorio)
                    setRemoto(repositorio?.url_clon ?? '')
                    // El nombre se propone SOLO si esta vacio. Sobrescribir lo
                    // que el operador ya escribio para llamar al proyecto como
                    // el repositorio es decidir por el algo que ya decidio.
                    if (repositorio && nombre.trim().length === 0) {
                      setNombre(repositorio.nombre ?? '')
                    }
                    if (!destinoAMano) setRuta(destinoDelClon(carpetaBase, repositorio))
                  }}
                />

                <Campo
                  etiqueta="Repositorio remoto"
                  valor={remoto}
                  alCambiar={(valor) => {
                    setRemoto(valor)
                    // Editar la direccion a mano suelta la ficha: dejarla
                    // marcada mientras la direccion dice otra cosa enseña como
                    // elegido un repositorio que no es el que se va a clonar.
                    if (repoElegido && valor !== repoElegido.url_clon) setRepoElegido(null)
                  }}
                  requerido
                  operativo
                  marcador="git@servidor:organizacion/repositorio.git"
                  ayuda="El repositorio que elijas arriba se escribe aqui. Tambien puedes escribir la direccion: cubre el caso que la lista no alcanza —un repositorio de otra cuenta, o una forja que el catalogo todavia no declara—."
                />

                {/* DONDE VA A VIVIR EL CLON, Y ESTE CAMPO FALTABA ENTERO. El
                    servicio exige `ruta_local` tambien en el origen remoto —el
                    clon tiene que aterrizar en algun sitio de esta maquina— y
                    esta pantalla no lo pedia ni lo mandaba: «Crear proyecto»
                    contestaba 400 pidiendo un campo que no existia en ninguna
                    casilla. El explorador va primero por el mismo motivo que en
                    la otra rama: el SERVICIO corre en esta maquina y si lee el
                    disco. */}
                <ExploradorDeCarpetas
                  ruta={carpetaBase}
                  alElegir={(carpeta) => {
                    setCarpetaBase(carpeta)
                    if (!destinoAMano) setRuta(destinoDelClon(carpeta, repoElegido))
                  }}
                />

                <Campo
                  etiqueta="Donde se clona"
                  valor={ruta}
                  alCambiar={(valor) => {
                    setDestinoAMano(true)
                    setRuta(valor)
                  }}
                  requerido
                  operativo
                  marcador="/ruta/absoluta/donde/vivira/el/clon"
                  ayuda="La carpeta en esta maquina donde noxloop va a clonar el repositorio. Lo normal es navegar hasta donde viven tus proyectos y anadir el nombre al final; se propone solo al elegir un repositorio de la lista. El clon lo hace el motor cuando le toca: dar de alta el proyecto no descarga nada todavia, y necesita una credencial del gestor de repositorios con grant vigente."
                />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* EL EXPLORADOR VA PRIMERO Y EL CAMPO DEBAJO, y ese orden es la
                    decision. Antes solo estaba el campo, con una ayuda que
                    explicaba —con razon— que en el navegador no hay dialogo de
                    carpetas. La explicacion era cierta y la conclusion no: el
                    SERVICIO corre en esta maquina y si lee el disco. Ahora se
                    navega; escribir sigue siendo posible, que es lo que cubre
                    las carpetas fuera de las raices que el servicio explora. */}
                <ExploradorDeCarpetas ruta={ruta} alElegir={setRuta} />

                <Campo
                  etiqueta={origen === 'nuevo' ? 'Destino del repositorio' : 'Carpeta del proyecto'}
                  valor={ruta}
                  alCambiar={setRuta}
                  requerido
                  operativo
                  marcador="/ruta/absoluta/al/proyecto"
                  ayuda={
                    origen === 'nuevo'
                      ? 'La carpeta que elijas arriba se escribe aqui. Para un proyecto nuevo el destino tiene que estar vacio, asi que lo normal es navegar hasta donde va a vivir y anadirle el nombre al final.'
                      : superficie === 'escritorio'
                        ? 'La carpeta que elijas arriba se escribe aqui. Tambien puedes escribirla, o abrir el dialogo del sistema.'
                        : 'La carpeta que elijas arriba se escribe aqui. Tambien puedes escribirla: el explorador solo llega a las raices que el servicio declara, y esta ruta acepta cualquiera.'
                  }
                  accion={
                    superficie === 'escritorio' ? (
                      <Button variant="secondary" size="sm" onClick={() => void abrirSelector()}>
                        <FolderOpen />
                        Dialogo del sistema
                      </Button>
                    ) : null
                  }
                />
              </div>
            )}

            {errorDeCarpeta ? (
              <ErrorText causa={errorDeCarpeta.causa} accion={errorDeCarpeta.accion} />
            ) : null}
          </div>
        </FieldsetContent>

        <FieldsetContent
          titulo="Nivel de autonomia"
          descripcion="Hasta donde llega la flota sin preguntar. Se puede cambiar despues; se pregunta ahora porque el valor por defecto decide como se comporta el primer ciclo."
        >
          <Seleccion
            etiqueta="Nivel de autonomia"
            grupo={autonomias}
            valor={autonomia}
            alCambiar={setAutonomia}
            cargando={cargandoOpciones}
            className="max-w-md"
          />
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
  // Sin `project_id`: todavia no hay proyecto. El servicio lo sabe y contesta
  // el catalogo generico con las preselecciones marcadas `por_defecto` en vez
  // de `detectado`, que es exactamente la diferencia que el operador tiene que
  // poder leer.
  const opciones = useOpciones()
  // Las conexiones de codigo se leen SIEMPRE y no solo con el origen remoto
  // elegido: cambiar de origen ya tiene la lista lista, en vez de enseñar un
  // esqueleto justo despues de que el operador pulse "Repositorio remoto".
  const conexiones = useConexionesDeCodigo()
  const mutacion = useMutacion()
  // DOS MUTACIONES Y NO UNA, y la separacion importa: conectar la cuenta y
  // crear el proyecto son dos peticiones distintas que pueden fallar por
  // motivos distintos. Con una sola, el error de conectar se pintaria abajo,
  // junto al boton «Crear proyecto», a cuarenta lineas de la casilla donde se
  // pego el token — y el operador leeria que fallo crear el proyecto.
  const conexion = useMutacion()

  /**
   * Conectar la cuenta de codigo DEL ESPACIO DE TRABAJO, sin proyecto.
   *
   * ESTA LLAMADA ES EL ARREGLO. Antes no existia ninguna ruta a la que esta
   * pantalla pudiera llamar —conectar exigia un proyecto y aqui no hay
   * ninguno— y por eso la pantalla remataba en un boton que llevaba a otra.
   * `POST /v1/connections/authorize` conecta sin proyecto, y en cuanto la
   * respuesta llega se relee la lista: los repositorios aparecen aqui mismo.
   *
   * El valor del token viaja UNA vez, hacia el servicio. Lo que vuelve es la
   * conexion; el valor entra a la boveda y no sale por ninguna ruta.
   */
  const conectarCuenta = async (proveedor: string, valores: Record<string, string>) => {
    const respuesta = await conexion.enviar<AutorizacionDeConexion>(
      'POST',
      '/v1/connections/authorize',
      { proveedor, ...(Object.keys(valores).length > 0 ? { valores } : {}) },
    )
    if (respuesta) conexiones.releer()
  }

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
      autonomias={opciones.grupoDe(GRUPO.autonomia)}
      cargandoOpciones={opciones.catalogo === null && opciones.lectura.error === null}
      conexionesDeCodigo={conexiones.conexiones}
      cargandoConexiones={conexiones.cargando}
      errorDeConexiones={conexiones.error}
      catalogoDeCodigo={conexiones.catalogo}
      alConectarCuenta={(proveedor, valores) => void conectarCuenta(proveedor, valores)}
      conectandoCuenta={conexion.trabajando}
      errorDeConectar={conexion.error}
      alCrear={(alta) => void crear(alta)}
      trabajando={mutacion.trabajando}
      error={mutacion.error}
      navegar={navegar}
    />
  )
}

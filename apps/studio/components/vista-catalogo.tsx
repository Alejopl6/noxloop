'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Boxes, Inbox, KeyRound, Plug, Settings, ShieldOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import { Skeleton } from '@/components/ui/esqueleto'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { StatusDot } from '@/components/ui/punto-de-estado'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { Description, ListaDeDescripciones } from '@/components/ui/descripcion'
import { EmptyState } from '@/components/ui/estado-vacio'
import {
  DisabledWall,
  ErrorText,
  Fieldset,
  FieldsetContent,
  FieldsetFooter,
  WarningText,
} from '@/components/ui/fieldset'
import { SecretValue } from '@/components/ui/valor-secreto'
import { Instante, Tabla, type ColumnaDeTabla } from '@/components/ui/tabla'
import { ModalDeAccionDestructiva } from '@/components/ui/modal-de-accion-destructiva'
import { VistaJSON } from '@/components/ui/vista-json'
import { ArbolDeArchivos, type NodoDeArchivo } from '@/components/ui/arbol-de-archivos'
import { MenuDeComandos, useMenuDeComandos, type Comando } from '@/components/ui/menu-de-comandos'
import type { Ruta } from '@/lib/ruta'

/**
 * El catalogo de componentes de consola (T083, T115, T162, T197).
 *
 * POR QUE ESTA PAGINA EXISTE Y NO ES UN CAPRICHO. Sin ella, quince componentes
 * escritos para las fases B, C y D son codigo que compila y que nadie ha visto
 * nunca en pantalla: el `tsc` dice que los tipos cuadran y no dice nada del
 * contraste en tema oscuro, del foco visible, de si el modal centra, ni de si
 * el estado vacio dice algo util. Tambien es lo que hace que el `next build`
 * los EJERCITE — un componente que nadie importa se queda fuera del bundle y su
 * primer render de verdad ocurre en la fase que lo estrena, que es el peor
 * momento para descubrir que el `<dialog>` no cierra.
 *
 * Y por que cada bloque ensena los ESTADOS y no una muestra: el fallo tipico no
 * es "el componente se ve mal", es "el componente se ve bien lleno y se
 * desmorona vacio, o con un texto de tres lineas, o sin permiso".
 *
 * Va por query string (`/?vista=catalogo`) porque asi enruta esta aplicacion
 * (`lib/ruta.ts` explica por que), y NO esta en la navegacion: no es superficie
 * de producto, es la herramienta de quien construye la superficie.
 *
 * La pagina se pinta sin pedirle nada al servicio, a proposito: revisar un
 * componente no deberia depender de tener el daemon corriendo.
 */

function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string
  nota: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-20 text-ds-gray-1000">{titulo}</h2>
        <p className="text-copy-14 text-ds-gray-900">{nota}</p>
      </div>
      {children}
    </section>
  )
}

function Estado({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="fuente-operativa text-label-12 text-ds-gray-700">{nombre}</span>
      {children}
    </div>
  )
}

interface FilaDeEjemplo {
  id: string
  nombre: string
  proveedor: string
  runs: number
  creada: string | null
}

const FILAS: FilaDeEjemplo[] = [
  { id: 'cred_7f2a91', nombre: 'Token de despliegue', proveedor: 'Gestor de repositorios', runs: 1284, creada: '2026-09-19T08:12:00.000Z' },
  { id: 'cred_0c41de', nombre: 'Clave de la nube', proveedor: 'Proveedor de nube', runs: 37, creada: '2026-06-02T17:40:00.000Z' },
  { id: 'cred_b83007', nombre: 'PAT del gestor de tickets', proveedor: 'Gestor de tickets', runs: 0, creada: null },
]

const ARBOL: NodoDeArchivo[] = [
  {
    nombre: 'packages',
    tipo: 'directorio',
    hijos: [
      {
        nombre: 'engine',
        tipo: 'directorio',
        hijos: [
          { nombre: 'planificador.mjs', tipo: 'archivo', estado: 'modificado' },
          { nombre: 'gate.mjs', tipo: 'archivo', estado: 'sin_cambios' },
        ],
      },
      { nombre: 'service', tipo: 'directorio', hijos: [{ nombre: 'boveda.mjs', tipo: 'archivo', estado: 'anadido' }] },
    ],
  },
  {
    nombre: 'docs',
    tipo: 'directorio',
    hijos: [{ nombre: 'runbook-viejo.md', tipo: 'archivo', estado: 'eliminado' }],
  },
  { nombre: 'noxloop.config.json', tipo: 'archivo', estado: 'modificado' },
]

const SNAPSHOT = {
  version: '0.1.0',
  proyecto: { id: 'prj_4f2a', nombre: 'consola', ruta: '/Users/operador/proyectos/consola' },
  conexion: { proveedor: 'gestor-de-tickets', modo: 'BASIC', api_key: 'no-deberia-estar-aqui' },
  gates: [
    { nombre: 'pruebas', obligatorio: true, tiempo_maximo_s: 900 },
    { nombre: 'tipos', obligatorio: true, tiempo_maximo_s: 120 },
  ],
  ultimo_run: { id: 'run_91ac', estado: 'verde', duracion_s: 412 },
}

export function VistaDeCatalogo({ navegar }: { navegar: (destino: Ruta) => void }) {
  const [ahora, setAhora] = useState(() => Date.parse('2026-09-20T12:00:00.000Z'))
  const [seleccionada, setSeleccionada] = useState<string | null>('cred_7f2a91')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [conError, setConError] = useState(false)
  const [archivo, setArchivo] = useState<string | null>(null)
  const menu = useMenuDeComandos()

  // `Date.now()` solo despues de hidratar: leerlo en el render haria que el
  // HTML prerenderizado y el primer render del cliente no coincidan.
  useEffect(() => {
    setAhora(Date.now())
  }, [])

  const columnas: ColumnaDeTabla<FilaDeEjemplo>[] = [
    { clave: 'nombre', encabezado: 'Credencial', celda: (fila) => fila.nombre },
    { clave: 'id', encabezado: 'Identificador', alineacion: 'operativo', celda: (fila) => fila.id },
    { clave: 'proveedor', encabezado: 'Proveedor', celda: (fila) => fila.proveedor },
    { clave: 'runs', encabezado: 'Runs', alineacion: 'numero', celda: (fila) => fila.runs },
    {
      clave: 'creada',
      encabezado: 'Creada',
      celda: (fila) => <Instante valor={fila.creada} ahora={ahora} />,
    },
  ]

  const comandos: Comando[] = [
    { id: 'ir-inicio', etiqueta: 'Abrir inicio', grupo: 'Navegacion', icono: <Boxes />, atajo: 'g i', ejecutar: () => navegar({ seccion: 'inicio', id: null }) },
    { id: 'ir-bandeja', etiqueta: 'Abrir bandeja', grupo: 'Navegacion', icono: <Inbox />, atajo: 'g b', ejecutar: () => navegar({ seccion: 'bandeja', id: null }) },
    { id: 'anadir-credencial', etiqueta: 'Anadir credencial', descripcion: 'Registra una credencial en la boveda del sistema', grupo: 'Credenciales', palabrasClave: ['secreto', 'token', 'clave'], icono: <KeyRound />, ejecutar: () => setModalAbierto(false) },
    { id: 'revocar-credencial', etiqueta: 'Revocar credencial', descripcion: 'Pide confirmacion escribiendo el nombre', grupo: 'Credenciales', icono: <ShieldOff />, ejecutar: () => setModalAbierto(true) },
    { id: 'conectar-proveedor', etiqueta: 'Conectar proveedor', grupo: 'Conexiones', icono: <Plug />, ejecutar: () => undefined },
    { id: 'abrir-ajustes', etiqueta: 'Abrir ajustes', grupo: 'Ajustes', icono: <Settings />, ejecutar: () => undefined },
  ]

  return (
    <div className="flex flex-col gap-14">
      <header className="flex flex-col gap-3">
        <h1 className="text-heading-24 text-ds-gray-1000">Catalogo de componentes</h1>
        <p className="max-w-2xl text-copy-14 text-ds-gray-900">
          Cada componente de consola en sus estados. No es superficie de producto: es
          donde se revisa que un estado vacio dice algo util, que el foco se ve, y que
          el tema oscuro no rompe nada. Se llega por{' '}
          <span className="fuente-operativa text-ds-gray-1000">/?vista=catalogo</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => navegar({ seccion: 'inicio', id: null })}>
            Volver a inicio
          </Button>
          <Button variant="secondary" onClick={menu.abrir}>
            Abrir menu de comandos
          </Button>
          <span className="text-label-12 text-ds-gray-700">
            o pulsa <span className="fuente-operativa">⌘K</span> /{' '}
            <span className="fuente-operativa">Ctrl+K</span> en cualquier parte
          </span>
        </div>
      </header>

      <hr className="border-ds-gray-400" />

      <Seccion
        titulo="Entity"
        nota="La fila del inventario de credenciales, de la lista de agentes y de las conexiones. El titulo es lo pulsable y se estira sobre la fila; los controles quedan por encima."
      >
        <ListaDeEntidades etiqueta="Ejemplos de Entity">
          <Entity
            contenedor="li"
            miniatura={<KeyRound />}
            titulo="Token de despliegue"
            identificador="sha256:7f2a91c4"
            descripcion="Alcance declarado: leer y escribir en el repositorio del proyecto. Sin permiso de administracion."
            metadatos={
              <>
                <Badge tono="exito">Activa</Badge>
                <span className="text-label-12 text-ds-gray-700">Global</span>
              </>
            }
            acciones={<Button variant="secondary" size="sm">Revisar</Button>}
            alPulsar={() => setSeleccionada('cred_7f2a91')}
            seleccionada={seleccionada === 'cred_7f2a91'}
          />
          <Entity
            contenedor="li"
            miniatura={<Plug />}
            titulo="Gestor de tickets"
            identificador="conn_0c41de"
            descripcion="Autentica con PAT, no con OAuth: el catalogo del proveedor decide el modo y esta interfaz no lo supone."
            metadatos={<Badge tono="advertencia">Caduca en 6 dias</Badge>}
            acciones={
              <>
                <Button variant="secondary" size="sm">Renovar</Button>
                <Button variant="secondary" size="sm">Probar</Button>
              </>
            }
            alPulsar={() => setSeleccionada('conn_0c41de')}
            seleccionada={seleccionada === 'conn_0c41de'}
          />
          <Entity
            contenedor="li"
            miniatura={<ShieldOff />}
            titulo="Clave de la nube"
            identificador="cred_b83007"
            descripcion="Revocada el 14 de septiembre. Se conserva en el inventario porque tres runs la usaron y la evidencia tiene que seguir explicandose."
            metadatos={<Badge tono="error">Revocada</Badge>}
          />
        </ListaDeEntidades>
      </Seccion>

      <Seccion
        titulo="Fieldset"
        nota="La unica caja de la consola: delimita una unidad de guardado. Con aviso, con error, y con muro de deshabilitado."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Estado nombre="normal">
            <Fieldset>
              <FieldsetContent
                titulo="Constitution del proyecto"
                descripcion="Los principios que el gate comprueba en cada run. Se aplican al siguiente run, no al que esta corriendo."
              >
                <WarningText>
                  Cambiar esto invalida las recomendaciones calculadas con la version
                  anterior; habra que volver a calcularlas.
                </WarningText>
              </FieldsetContent>
              <FieldsetFooter nota="Se aplica al guardar.">
                <Button variant="secondary">Descartar cambios</Button>
                <Button>Guardar constitution</Button>
              </FieldsetFooter>
            </Fieldset>
          </Estado>

          <Estado nombre="con error">
            <Fieldset>
              <FieldsetContent
                titulo="Guidelines del proyecto"
                descripcion="Las reglas que los agentes leen antes de escribir codigo."
              >
                <ErrorText
                  causa="No se pudo guardar las guidelines del proyecto consola: el servicio de control rechazo el documento porque la seccion 'gates' no es una lista."
                  accion="Corrige la seccion 'gates' para que sea una lista de objetos y vuelve a guardar."
                />
              </FieldsetContent>
              <FieldsetFooter nota="No se guardo nada.">
                <Button>Reintentar guardado</Button>
              </FieldsetFooter>
            </Fieldset>
          </Estado>

          <Estado nombre="DisabledWall">
            <Fieldset>
              <DisabledWall
                razon="Solo el escritor unico puede cambiar la constitution, y ahora mismo lo es otra ventana."
                accion={<Button variant="secondary" size="sm">Reclamar la escritura</Button>}
              >
                <FieldsetContent
                  titulo="Constitution del proyecto"
                  descripcion="Los principios que el gate comprueba en cada run."
                >
                  <p className="text-copy-14 text-ds-gray-900">
                    El contenido sigue a la vista, atenuado e inerte: ni el raton ni el
                    tabulador llegan a el.
                  </p>
                </FieldsetContent>
                <FieldsetFooter nota="Se aplica al guardar.">
                  <Button>Guardar constitution</Button>
                </FieldsetFooter>
              </DisabledWall>
            </Fieldset>
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="SecretValue"
        nota="FR-040, FR-041 y NFR-004. El caso normal es el primero: la boveda no entrega el valor a la interfaz, asi que no hay boton de revelar porque no hay nada que revelar."
      >
        <div className="flex flex-col gap-6">
          <Estado nombre="solo huella · el caso real">
            <SecretValue huella="sha256:7f2a91c4d0e58b3617aa" etiqueta="el token de despliegue" />
          </Estado>
          <Estado nombre="con valor · solo mientras esta de paso">
            <SecretValue
              valor="nxl_pat_4f2a91c4d0e58b3617aa22bd"
              huella="sha256:7f2a91c4d0e58b3617aa"
              etiqueta="el token de despliegue"
              segundosVisible={10}
            />
          </Estado>
          <Estado nombre="sin credencial">
            <SecretValue etiqueta="la clave de la nube" />
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="Description"
        nota="Clave/valor de una pagina de detalle. Geist prohibe una tabla de dos columnas para esto: no son filas comparables, son atributos de una cosa."
      >
        <ListaDeDescripciones>
          <Description titulo="Proveedor" contenido="Gestor de repositorios" />
          <Description titulo="Identificador" contenido="cred_7f2a91" operativo />
          <Description titulo="Huella" contenido="sha256:7f2a91c4d0e58b3617aa" operativo />
          <Description titulo="Alcance" contenido="Leer y escribir en el repositorio" />
          <Description titulo="Caduca" nota="Lo desconocido se pinta con guion, nunca en blanco." />
          <Description titulo="Runs que la usaron" contenido="1284" />
        </ListaDeDescripciones>
      </Seccion>

      <Seccion
        titulo="EmptyState"
        nota="Cuatro modos porque «no hay nada» significa cuatro cosas distintas, y cada una tiene una salida distinta. Un CTA como maximo, verbo + sustantivo."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Estado nombre="primero">
            <EmptyState
              modo="primero"
              titulo="Sin Credenciales Registradas"
              descripcion="Los agentes solo pueden usar credenciales autorizadas por la tripleta proyecto + agente + credencial: sin ninguna registrada, ningun run puede publicar nada."
              accion={<Button>Registrar credencial</Button>}
            />
          </Estado>
          <Estado nombre="filtrado">
            <EmptyState
              modo="filtrado"
              titulo="Ninguna Credencial Coincide"
              consulta="  Token De Despliegue "
              descripcion="La busqueda distingue espacios. Hay 3 credenciales registradas en este proyecto."
            />
          </Estado>
          <Estado nombre="error">
            <EmptyState
              modo="error"
              titulo="No Se Pudo Cargar El Inventario"
              descripcion="El servicio de control respondio 503 al pedir /v1/credentials. La aplicacion reintenta sola cada 10 segundos."
              accion={<Button variant="secondary">Reintentar ahora</Button>}
            />
          </Estado>
          <Estado nombre="sin permiso">
            <EmptyState
              modo="sin_permiso"
              titulo="Inventario No Visible"
              descripcion="Las credenciales de alcance global solo las lista el operador que las registro. Las de este proyecto si se ven."
            />
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="Badge y StatusDot"
        nota="Badge para todo: runs, colas, credenciales, conexiones. StatusDot SOLO para ciclo de vida de despliegue, que es lo unico a lo que Geist lo restringe."
      >
        <div className="flex flex-col gap-6">
          <Estado nombre="Badge · los cinco significados">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tono="exito">Verde</Badge>
              <Badge tono="error">Fallo</Badge>
              <Badge tono="advertencia">Caduca pronto</Badge>
              <Badge tono="informativo">En curso</Badge>
              <Badge tono="neutral">Sin estado</Badge>
              <Badge tono="exito" tamano="md">Tamano md</Badge>
            </div>
          </Estado>
          <Estado nombre="StatusDot · ciclo de vida de despliegue, y nada mas">
            <div className="flex flex-wrap items-center gap-6">
              <StatusDot estado="listo" />
              <StatusDot estado="construyendo" />
              <StatusDot estado="en_cola" />
              <StatusDot estado="error" />
              <StatusDot estado="cancelado" />
            </div>
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="Note"
        nota="El aviso pegado a lo que explica. No se llama Callout: en Geist ese componente no existe."
      >
        <div className="flex flex-col gap-3">
          <Note tipo="neutral">
            La bandeja vacia es el estado normal del sistema.
          </Note>
          <Note tipo="informativo" titulo="El sondeo es el camino primario">
            Los webhooks de autenticacion no se pudieron verificar en la edicion
            gratuita, asi que la conexion se confirma sondeando.
          </Note>
          <Note tipo="exito" titulo="Gate en verde">
            Los cuatro gates obligatorios pasaron en 412 segundos.
          </Note>
          <Note
            tipo="advertencia"
            titulo="La boveda esta degradada"
            accion={<Button variant="secondary" size="sm">Ver capacidades</Button>}
          >
            No hay Secret Service en este sistema, asi que las credenciales van a un
            archivo cifrado. Queda declarado en /v1/capabilities, nunca en silencio.
          </Note>
          <Note tipo="error" titulo="No se pudo conectar el proveedor">
            El puerto 3003 esta ocupado por otro proceso, y ese puerto esta registrado
            como redirect URI en la aplicacion OAuth. Libera el puerto y reintenta.
          </Note>
        </div>
      </Seccion>

      <Seccion
        titulo="Skeleton y Spinner"
        nota="Esqueleto solo cuando la forma de lo que viene ya se conoce. Spinner cuando no se sabe cuanto falta, y siempre con etiqueta: con prefers-reduced-motion la animacion se para y la etiqueta es lo unico que queda."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Estado nombre="Skeleton">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </Estado>
          <Estado nombre="Spinner">
            <div className="flex flex-wrap items-center gap-6">
              <Spinner tamano="sm" etiqueta="Cargando credenciales" />
              <Spinner tamano="md" etiqueta="Cargando credenciales" />
              <Spinner tamano="lg" etiqueta="Cargando credenciales" />
              <Spinner conTexto etiqueta="Sondeando la conexion" />
            </div>
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="Tabla"
        nota="Texto a la izquierda, numeros a la derecha con cifras tabulares, identificadores en Mono, guion para lo desconocido, y tiempo relativo hasta 7 dias. El estado vacio va fuera."
      >
        <div className="flex flex-col gap-8">
          <Estado nombre="con filas">
            <Tabla
              columnas={columnas}
              filas={FILAS}
              claveDeFila={(fila) => fila.id}
              etiqueta="Credenciales registradas"
            />
          </Estado>
          <Estado nombre="sin filas · la tabla desaparece entera">
            <>
              <Tabla
                columnas={columnas}
                filas={[]}
                claveDeFila={(fila) => fila.id}
                etiqueta="Credenciales registradas"
              />
              <EmptyState
                modo="filtrado"
                tamano="compacto"
                titulo="Ninguna Credencial Coincide"
                consulta="nube"
                descripcion="Hay 3 credenciales registradas. La busqueda mira el nombre y el proveedor, no la huella."
              />
            </>
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="ModalDeAccionDestructiva"
        nota="Confirmacion escribiendo el nombre exacto. No se cierra al pulsar fuera; Escape si cierra."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive" onClick={() => setModalAbierto(true)}>
            Revocar credencial
          </Button>
          <Button variant="secondary" onClick={() => setConError((antes) => !antes)}>
            {conError ? 'Quitar el error simulado' : 'Simular un fallo al confirmar'}
          </Button>
        </div>

        <ModalDeAccionDestructiva
          abierto={modalAbierto}
          alCerrar={() => setModalAbierto(false)}
          titulo="Revocar credencial"
          recurso="Token de despliegue"
          claseDeRecurso="la credencial"
          consecuencias={
            <>
              Tres agentes pierden el acceso al repositorio en cuanto se revoque, y el
              run <span className="fuente-operativa">run_91ac</span>, que esta en marcha,
              fallara en su proximo paso de publicacion. La huella se conserva en el
              inventario para que la evidencia de los runs pasados siga explicandose.
            </>
          }
          etiquetaDeConfirmacion="Revocar credencial"
          alConfirmar={() => setModalAbierto(false)}
          error={
            conError
              ? {
                  causa: 'No se pudo revocar la credencial Token de despliegue: la boveda del sistema operativo rechazo la operacion.',
                  accion: 'Desbloquea el llavero del sistema y vuelve a intentarlo.',
                }
              : null
          }
        />
      </Seccion>

      <Seccion
        titulo="VistaJSON"
        nota="Snapshot plegable. Enmascara por defecto las claves que huelen a secreto, y lo que copia es lo que ensena."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Estado nombre="enmascarado (por defecto)">
            <VistaJSON valor={SNAPSHOT} etiqueta="Snapshot del proyecto" />
          </Estado>
          <Estado nombre="sin enmascarar">
            <VistaJSON
              valor={SNAPSHOT}
              etiqueta="Snapshot del proyecto"
              enmascararSecretos={false}
            />
          </Estado>
        </div>
      </Seccion>

      <Seccion
        titulo="ArbolDeArchivos"
        nota="Que ficheros toca una recomendacion. Una sola parada de tabulador para el arbol entero; dentro se mueve con las flechas. El estado lleva letra ademas de color."
      >
        <div className="flex flex-col gap-3">
          <ArbolDeArchivos
            nodos={ARBOL}
            etiqueta="Ficheros que toca la recomendacion"
            seleccionada={archivo}
            alSeleccionar={(ruta) => setArchivo(ruta)}
          />
          <p className="text-label-12 text-ds-gray-700">
            Seleccionado:{' '}
            <span className="fuente-operativa text-ds-gray-900">{archivo ?? '—'}</span>
          </p>
        </div>
      </Seccion>

      <Seccion
        titulo="MenuDeComandos"
        nota="⌘K / Ctrl+K desde cualquier parte. Busca sin acentos y sin mayusculas en los dos sentidos. Es lo que hace la consola operable sin raton (NFR-005)."
      >
        <Button variant="secondary" onClick={menu.abrir}>
          Abrir menu de comandos
        </Button>
      </Seccion>

      <MenuDeComandos comandos={comandos} abierto={menu.abierto} alCerrar={menu.cerrar} />
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

import { useLectura } from '@/lib/lectura'
import { useBandeja, ListaDeBandeja } from '@/components/bandeja'
import { Button } from '@/components/ui/button'
import { ResumenDelCiclo } from '@/components/ui/ciclo-de-vida'
import { FalloDeLectura } from '@/components/pantalla'
import { INDICADORES_EN_CERO, type Indicadores, type Proyecto } from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * Vista de inicio.
 *
 * FR-061: NO es una grilla de tarjetas por proyecto. Esa forma escala mal —con
 * veinte proyectos son veinte tarjetas que el operador tiene que barrer con la
 * vista para descubrir que en ninguna pasa nada— y ademas miente sobre el
 * modelo: el trabajo no se mira proyecto a proyecto, se mira por excepcion.
 *
 * FR-060: indicadores agregados arriba, bandeja abajo y separada, y la bandeja
 * es lo unico que se puede pulsar.
 *
 * EL CICLO DE VIDA VA EN MEDIO, y a esta densidad la pregunta no es la misma
 * que en la lista de proyectos. Alli es "donde esta ESTE proyecto"; aqui es
 * "cuantos hay en cada etapa y cuales llevan semanas sin moverse". Un proyecto
 * parado tres semanas en BOOTSTRAPPED no se descubre barriendo la lista: en la
 * lista es una fila igual que las otras once. Por eso `ResumenDelCiclo` lo
 * saca de la distribucion y lo nombra, que es lo unico accionable que esta
 * pantalla anade a la bandeja.
 *
 * Layout segun los principios de Geist (research.md §2): espaciado y
 * alineacion antes que bordes y cajas. No hay ni una tarjeta en esta pantalla.
 * Monocromo: el unico color es el ambar de una entrada que espera decision,
 * y va acompanado de una senal no cromatica (el punto y el texto).
 */

const EVENTOS_DE_INDICADORES = [
  'run.estado',
  'proyecto.estado',
  'bandeja.entrada',
  'bandeja.resuelta',
  'sincronizar_completo',
] as const

function Indicador({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-12 text-ds-gray-900">{etiqueta}</span>
      {/* Geist Mono con `tabular-nums`: son datos operativos, y una columna de
          numeros que cambia no debe desplazarse al actualizarse. */}
      <span className="fuente-operativa text-heading-24 text-ds-gray-1000">{valor}</span>
    </div>
  )
}

/**
 * Los mismos eventos que relee la lista de proyectos.
 *
 * Es una peticion mas en esta pantalla, no N+1: `GET /v1/projects` es UNA
 * consulta con los contadores dentro (NFR-002). Los indicadores de `/v1/dashboard`
 * no sirven para esto —no traen el estado de cada proyecto, solo totales— y
 * derivar el reparto por etapas de seis numeros agregados seria inventarlo.
 */
const EVENTOS_DE_PROYECTOS = ['proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeInicio({ navegar }: { navegar: Navegar }) {
  const indicadores = useLectura<Indicadores>('/v1/dashboard', {
    relerEn: EVENTOS_DE_INDICADORES,
  })
  const proyectos = useLectura<Proyecto[]>('/v1/projects', {
    relerEn: EVENTOS_DE_PROYECTOS,
  })
  const bandeja = useBandeja()

  // `null` hasta que se haya hidratado: leer el reloj en el render hace que el
  // HTML prerenderizado y el primer render del cliente no coincidan, y la
  // antiguedad de un proyecto parado no es algo que se pueda suponer. El
  // intervalo es de un minuto porque lo que se cuenta son dias.
  const [ahora, setAhora] = useState<number | null>(null)
  useEffect(() => {
    setAhora(Date.now())
    const intervalo = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(intervalo)
  }, [])

  // Hasta que el servicio conteste, cero. Y cero es la verdad recien
  // instalado: no es un esqueleto gris fingiendo que hay algo cargando.
  const valores = indicadores.datos ?? INDICADORES_EN_CERO
  const entradas = bandeja.datos ?? []
  const esperando = entradas.filter((entrada) => entrada.estado === 'esperando')
  const registrados = proyectos.datos ?? []

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="titulo-indicadores" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 id="titulo-indicadores" className="text-heading-24 text-ds-gray-1000">
            Inicio
          </h1>
          <p className="text-copy-14 text-ds-gray-900">
            Lo ocurrido en todos tus proyectos, agregado. Se lee; no se pulsa.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          <Indicador etiqueta="Tareas completadas" valor={valores.tareas_completadas} />
          <Indicador etiqueta="HUs completadas" valor={valores.hus_completadas} />
          <Indicador
            etiqueta="PRs esperando decision"
            valor={valores.prs_esperando_decision}
          />
          <Indicador etiqueta="Fallos criticos" valor={valores.fallos_criticos} />
          <Indicador
            etiqueta="Requieren atencion"
            valor={valores.entradas_requieren_atencion || esperando.length}
          />
        </div>

        <p className="text-label-13 text-ds-gray-700">
          {valores.proyectos_registrados === 0
            ? 'No hay proyectos todavia. Nada de lo de arriba tiene de donde salir hasta que registres el primero, y eso se hace desde Proyectos.'
            : `${valores.proyectos_registrados} ${
                valores.proyectos_registrados === 1 ? 'proyecto' : 'proyectos'
              } registrados. Estan en Proyectos, uno por fila.`}
        </p>

        {/* El fallo lleva causa, accion y codigo, como en el resto de la
            consola. Los indicadores de arriba siguen en pantalla: lo que no se
            puede hacer es pintarlos como frescos, y de eso se encarga el
            banner de la cascara. */}
        <FalloDeLectura error={indicadores.error} />
      </section>

      {/* Una linea, no una caja. Es lo unico que separa "se lee" de "se hace". */}
      <hr className="border-ds-gray-400" />

      {registrados.length > 0 ? (
        <section aria-labelledby="titulo-ciclo" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-ciclo" className="text-heading-20 text-ds-gray-1000">
              Ciclo de vida
            </h2>
            <p className="text-copy-14 text-ds-gray-900">
              Donde esta cada proyecto del recorrido, y cuales llevan dias sin
              moverse de etapa. Retroceder no existe: una etapa cerrada no se
              desmarca, se reabre sin mover el estado.
            </p>
          </div>

          <ResumenDelCiclo proyectos={registrados} ahora={ahora} navegar={navegar} />

          <FalloDeLectura error={proyectos.error} />
        </section>
      ) : null}

      {/* Sin proyectos que pintar, el fallo va solo: `ResumenDelCiclo` diria
          "no hay ningun proyecto registrado", que es una afirmacion que esta
          lectura no puede hacer cuando lo que pasa es que no contesto. */}
      {registrados.length === 0 ? <FalloDeLectura error={proyectos.error} /> : null}

      {registrados.length > 0 ? <hr className="border-ds-gray-400" /> : null}

      <section aria-labelledby="titulo-bandeja" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-bandeja" className="text-heading-20 text-ds-gray-1000">
              Bandeja
            </h2>
            <p className="text-copy-14 text-ds-gray-900">
              Lo que requiere una decision tuya. Es lo unico accionable de esta
              pantalla.
            </p>
          </div>

          {entradas.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => navegar({ seccion: 'bandeja', id: null })}
            >
              Ver la bandeja entera
            </Button>
          ) : null}
        </div>

        <ListaDeBandeja
          entradas={esperando}
          onAbrir={(id) => navegar({ seccion: 'bandeja', id })}
        />

        <FalloDeLectura error={bandeja.error} />
      </section>
    </div>
  )
}

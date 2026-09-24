# La licencia de la capa de integración

**T161** · Texto listo para integrar en `LICENSE` y `README.md` de la raíz.
Este paquete no edita esos dos archivos: los redacta aquí y quien integre los
pega.

## El hallazgo

La capa de integración elegida —Nango self-hosted— está bajo **Elastic License
2.0 (ELv2)**, y sus dos SDK de cliente también: **`@nangohq/node`** y
**`@nangohq/frontend`**.

La decisión de meterla en el núcleo **está tomada** (2026-09-20). Lo que sigue
no vuelve a abrirla: existe para que nadie tenga que descubrir por su cuenta lo
que implica, y para que quien reciba una copia del binario reciba también los
términos que lleva dentro.

Verificado:

- **ELv2 no está aprobada por la OSI.** No es una licencia de software libre en
  el sentido que usan las distribuciones ni la mayoría de las políticas
  corporativas.
- **No es compatible con GPL ni con AGPL.** Un proyecto bajo esas licencias no
  puede incorporar este binario sin resolver el conflicto.
- **El repositorio sigue siendo MIT; la dependencia no lo es.** El binario
  distribuido lleva código ELv2 dentro, y la licencia exige que quien reciba una
  copia reciba también sus términos. Esa obligación es de quien **redistribuye**,
  y es la razón por la que el aviso va en `LICENSE` y no solo en una nota de
  versión.
- **Debian, Fedora y varias políticas corporativas de software libre rechazan
  ELv2.** Empaquetar noxloop en esos canales va a ser fricción, y conviene
  saberlo antes de prometerlo.
- **La cláusula de "no ofrecer el software como servicio alojado a terceros"
  no afecta** a un Nango local que el operador corre para sí mismo. **Sí
  afectaría** a un noxloop alojado que conectara integraciones por cuenta de sus
  usuarios. Si esa puerta se abre algún día, esta decisión vuelve a la mesa.

## Lo que la decisión obliga a hacer

1. **Declararla.** Es esto. Un usuario que descubre la licencia después de
   adoptar el producto tiene un problema que le creamos nosotros en silencio.
2. **Aplicaciones OAuth propias desde el día uno.** Las aplicaciones compartidas
   del proveedor tienen scopes fijos, el usuario autoriza al proveedor y no a
   noxloop, y el proveedor puede revocarlas. Y lo decisivo: **solo con
   aplicación propia se pueden exportar los tokens y salir de la capa alojada
   sin que los usuarios vuelvan a autorizar**. Es el seguro de **portabilidad**,
   y solo funciona si está puesto desde el principio.
3. **Mantener la fachada.** `ConnectionProvider` ya no es una mitigación de
   licencia —dejó de serlo cuando la decisión se tomó—, pero es lo que hace
   posibles los adaptadores `local` y `fake`, lo que mantiene al dominio
   ignorante del proveedor, y lo que convierte "cambiar de capa de integración"
   en cambiar un archivo si alguna vez hace falta.

## Para `LICENSE`

Pegar al final del archivo, después del texto MIT:

```text
--- Dependencias con licencia distinta ---

El código de noxloop se distribuye bajo la licencia MIT de más arriba.

Los binarios distribuidos de noxloop incluyen la capa de integración Nango y
sus SDK de cliente, "@nangohq/node" y "@nangohq/frontend", que NO están bajo
licencia MIT: están bajo la Elastic License 2.0 (ELv2).

La Elastic License 2.0 no está aprobada por la OSI y no es compatible con las
licencias GPL ni AGPL. Entre otras condiciones, prohíbe ofrecer el software
como un servicio alojado a terceros y prohíbe eludir sus limitaciones
funcionales. Un operador que ejecuta Nango localmente para su propio uso no
está afectado por esa cláusula; un servicio que conectara integraciones por
cuenta de sus usuarios, sí.

Quien redistribuya noxloop —empaquetado, reempaquetado o incorporado a otro
producto— está redistribuyendo también ese código ELv2, y la Elastic License
2.0 exige que quien recibe la copia reciba sus términos junto con ella.

El texto completo de la Elastic License 2.0 está en:
https://www.elastic.co/licensing/elastic-license
```

## Para `README.md`

Pegar en la sección de licencia, o crear una si no la hay:

```text
## Licencia

noxloop es MIT. La capa de integración que trae dentro, no.

Los binarios distribuidos incluyen Nango y sus SDK "@nangohq/node" y
"@nangohq/frontend", bajo Elastic License 2.0 (ELv2). La ELv2 no está aprobada
por la OSI y no es compatible con GPL ni AGPL, y distribuciones como Debian y
Fedora no aceptan paquetes con ese código dentro.

Qué significa en la práctica, según quién seas:

- Si usas noxloop en tu máquina o en la de tu equipo: nada. La cláusula que
  limita el servicio alojado no alcanza a un Nango local para tu propio uso.
- Si incorporas noxloop a un producto tuyo o lo reempaquetas: estás
  redistribuyendo código ELv2, y tienes que pasar sus términos a quien reciba
  la copia. Los tienes completos en LICENSE.
- Si quieres ofrecer noxloop como servicio alojado que conecte integraciones
  por cuenta de tus usuarios: eso sí choca con la ELv2. Hablémoslo antes de
  construirlo.
- Si tu política interna no admite ELv2: el núcleo de noxloop no depende de
  Nango para funcionar. La capa de integración está detrás de una fachada
  propia (`ConnectionProvider`) y el adaptador `local` cubre los proveedores
  que se conectan con token personal o clave de API, sin ninguna dependencia
  ELv2.
```

## Dónde está el código que trae la dependencia

`src/adaptadores/nango.mjs`. Hoy es un hueco declarado que falla al construirse:
la dependencia **todavía no está instalada**. El día que entre, entra por ahí, y
la prueba `paquete-autocontenido.test.mjs` obliga a que sea un cambio visible en
el diff y no un `npm install` de paso.

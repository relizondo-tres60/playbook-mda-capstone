# Runbook de la campana mensual

Procedimiento operativo. Duracion estimada del dia 1: entre 30 y 60 minutos, segun cuanta
revision manual arroje el cruce.

## Dia 1 — preparacion y envio

### 1. Crear la campana
Panel → **Resumen** → *Nueva campana mensual*. Elegir ano, mes y plazo (14 dias por
defecto). Se genera el codigo `EXT-AAAA-MM`.

### 2. Exportar desde AD Manager
Exportar el listado de usuarios con, al menos, estas columnas:

`samAccountName`, `displayName`, `userPrincipalName`, `mail`, `department`, `title`,
`company`, `manager`, `enabled`, `lockedOut`, `lastLogon`, `whenCreated`, `office`,
`distinguishedName`

Formato CSV o XLSX. Los nombres de cabecera se reconocen en ingles y en espanol; no hace
falta renombrarlas.

### 3. Previsualizar
Panel → **Importar** → seleccionar el archivo → *Previsualizar*. Verificar:

- Que el conteo de cuentas EXT sea del orden esperado.
- Que las columnas clave (`samAccountName`, `company`, `manager`) esten reconocidas.
- Que las empresas detectadas se vean razonables.
- Que **no** aparezcan cuentas internas en la muestra (falsos positivos).

La previsualizacion no escribe nada: se puede repetir con distintos archivos.

### 4. Importar
*Importar*. El sistema guarda el original en R2, filtra las EXT y ejecuta el cruce
automatico. Devuelve el reparto entre asignadas automaticamente, en revision manual y sin
administrador.

### 5. Normalizar empresas
Panel → **Empresas**. Revisar *posibles duplicados*: si dos filas son la misma empresa mal
escrita, fusionar. La fusion conserva el nombre de origen como alias, de modo que la
proxima importacion ya se resuelva sola.

> Es el paso que mas rinde a futuro: cada fusion y cada alias reducen la revision manual
> del mes siguiente.

### 6. Completar administradores de contrato
Panel → **Administradores**. Agregar los que falten, con su **faena** y **numero de
contrato**. Recordar que una empresa puede tener varios: es el caso de Mantos Blancos,
Mantoverde y Santiago con responsables distintos. Marcar uno como *por defecto* cuando
exista un responsable natural.

### 7. Recalcular el cruce
Panel → **Resumen** → *Recalcular cruce empresa/administrador*. Aplica los alias, fusiones
y administradores recien creados. Respeta las asignaciones ya confirmadas a mano.

### 8. Resolver la cola manual
Panel → **Cuentas**, filtro *Estado de revision = Revision manual* o *Sin administrador*.
Editar cada fila y asignar empresa y administrador. Repetir hasta dejar la cola vacia o
con casos justificados.

### 9. Generar solicitudes
Panel → **Resumen** → *Generar solicitudes de validacion*. Crea una solicitud por
administrador con cuentas asignadas e informa la fecha limite. Si quedan cuentas sin
administrador, lo dice: esas **no** entran en ninguna solicitud.

### 10. Verificar el correo
Panel → **Configuracion**. Confirmar que el proveedor este `ready: true` y que el
remitente sea el correcto.

### 11. Enviar
Panel → **Resumen** → *Enviar correos a administradores*. Confirmar el conteo.
Luego revisar **Envios y seguimiento**: no debe quedar ningun envio en error.

---

## Dias 2 a 13 — seguimiento

El cron diario (08:00 UTC, entre 04:00 y 05:00 en Chile) hace el trabajo:

- Envia recordatorios a D-7, D-3 y D-1 (configurable con `REMINDER_DAYS`).
- Cada recordatorio rota el token: el enlace vigente es siempre el del ultimo correo.
- Marca como vencidas las solicitudes cuyo plazo expiro.

Revisar una o dos veces por semana en **Envios y seguimiento**:

| Situacion | Accion |
|---|---|
| Envio en error (correo rebotado, casilla inexistente) | Corregir el correo en **Administradores** y *Reenviar* |
| El administrador dice no haber recibido el enlace | *Reenviar*: genera uno nuevo e invalida el anterior |
| El administrador ya no trabaja en la empresa | Actualizar el contacto y reenviar |
| El administrador pide corregir lo ya enviado | Registrar el cambio en **Cuentas** como decision interna, con justificacion |

---

## Dia 14 — vencimiento

El cron marca automaticamente como **dar de baja** todas las cuentas sin respuesta, con
`decision_source = 'timeout'`, y notifica al administrador que su plazo vencio.

**Las cuentas sin administrador identificado no se ven afectadas**: siguen en cola de
revision manual. Corresponde resolverlas antes de cerrar.

## Dia 15 — ejecucion y cierre

### 1. Revisar la cola de bajas
Panel → **Cuentas**, filtro *Decision = Dar de baja*. Verificar en particular las que
tengan `decision_source = timeout`: si alguna es sensible (una jefatura de faena, un
contrato vigente conocido), conviene confirmarla por telefono antes de ejecutar.

### 2. Exportar
Panel → **Resumen**:

- *Exportar cola de bajas (CSV)* → para el equipo de identidades.
- *Script PowerShell de bajas* → apoyo para la ejecucion.
- *Export completo (CSV)* → evidencia de auditoria.
- *Bitacora de auditoria* → registro completo del ciclo.

### 3. Ejecutar en AD
El equipo de identidades ejecuta primero con `-WhatIf`, revisa la salida y luego sin el
flag. El script deja su propio CSV de resultado.

> La aplicacion no ejecuta bajas en AD por diseno: no tiene credenciales de dominio.

### 4. Cerrar la campana
Panel → **Resumen** → *Cerrar campana*. Congela las decisiones y bloquea nuevos envios.
Las solicitudes aun abiertas pasan a vencidas.

---

## Indicadores a mirar cada mes

| Indicador | Que dice | Meta |
|---|---|---|
| % asignado automaticamente | calidad del dato de origen y del catalogo | > 80% |
| Cuentas sin administrador | brechas en el catalogo de contratos | tendiendo a 0 |
| % de respuesta de administradores | compromiso de los contratistas | > 85% |
| Cuentas dadas de baja por vencimiento | falta de respuesta, no decision informada | a la baja |
| Envios en error | calidad de los correos registrados | 0 |

Si el porcentaje automatico no sube mes a mes, la causa suele estar en el catalogo de
empresas (faltan alias o fusiones) o en administradores sin faena registrada.

## Problemas frecuentes

| Sintoma | Causa probable | Solucion |
|---|---|---|
| Se detectan muy pocas cuentas EXT | El nombramiento no usa `EXT` como token delimitado | Cambiar `ext_match_mode` a `substring` en **Configuracion** y revisar falsos positivos |
| Se detectan cuentas internas | Modo `substring` con nombres como "Texto" o "Extra" | Volver a `token` |
| Muchas cuentas en revision manual | Faltan alias, fusiones o administradores | Normalizar en **Empresas** y **Administradores**, y recalcular |
| Una empresa aparece dos veces | Nombre mal escrito no cubierto por la clave canonica | Fusionar en **Empresas** |
| El XLSX no se puede leer | Formato inusual o archivo protegido | Exportar como CSV desde AD Manager |
| Un administrador no puede abrir su enlace | El enlace fue rotado por un reenvio o recordatorio posterior | Indicarle que use el correo mas reciente, o reenviar |
| El administrador no puede enviar el formulario | Quedan cuentas sin decidir, o una baja sin fecha de termino ni comentario | El propio portal indica cuantas faltan y salta al primer campo pendiente |

# Auditoria de Cuentas Externas (EXT) — Active Directory

Aplicacion web para automatizar la auditoria mensual de cuentas externas `EXT` de Active
Directory: importa el listado de AD Manager, agrupa las cuentas por empresa y administrador
de contrato, envia a cada administrador un enlace personal para que valide cuales se
mantienen y cuales se dan de baja, y deja trazabilidad completa para auditoria.

> **Sitio independiente.** Este proyecto no forma parte del playbook MDA ni comparte con el
> codigo, estilos, dominio ni despliegue: vive en su propio Worker, su propia base de datos
> y su propio pipeline de CI/CD. El directorio `ext-audit/` es autocontenido y puede
> extraerse a un repositorio propio sin cambiar una linea.

## El problema

Hoy el proceso es manual: alguien exporta la planilla de AD Manager, identifica a mano las
cuentas con `EXT`, las agrupa por empresa, busca quien es el administrador de contrato de
cada una y escribe correos uno por uno. Las respuestas vuelven por correo, en formatos
distintos, y hay que consolidarlas a mano. La data de origen viene inconsistente: nombres de
empresa mal escritos, el campo `manager` a veces vacio o incorrecto, y una misma empresa con
varios responsables segun faena o contrato.

## Lo que hace la aplicacion

- **Importa** la planilla de AD Manager (CSV, TSV o XLSX) y guarda el original como evidencia.
- **Detecta** las cuentas `EXT` con reglas configurables y registra por que marco cada una.
- **Normaliza** los nombres de empresa: `"Servicios Integrales S.p.A."` y `"SERV. INTEGRALES SPA"`
  se reconocen como la misma, con herramientas de alias y fusion para lo que la clave no alcanza.
- **Cruza** cada cuenta con su empresa y administrador de contrato mediante una cascada de seis
  reglas con puntaje de confianza; lo que no resuelve queda en cola de revision manual, nunca inventado.
- **Envia** un correo por administrador con un enlace unico, firmado y con vencimiento.
- **Recibe** la validacion en una pagina web, no por correo: dos decisiones por cuenta
  (`Mantener activa` / `Dar de baja`), mas contrato, vigencia y fecha de termino del trabajador.
- **Vence** automaticamente a los 14 dias: lo no confirmado queda marcado para deshabilitacion.
- **Exporta** la cola de bajas en CSV y un script PowerShell de apoyo para el equipo de identidades.
- **Registra** todo en una bitacora append-only: quien, que, cuando y desde donde.

## Stack

Cloudflare Workers + D1 + R2, frontend estatico sin framework, correo por la API de Gmail
(Google Workspace), CI/CD con GitHub Actions. **Cero dependencias en tiempo de ejecucion**:
el Worker no usa ningun paquete npm. La unica devDependency es `wrangler`.

## Inicio rapido

```bash
cd ext-audit
npm install
cp .dev.vars.example .dev.vars     # editar; nunca commitear

npm run db:migrate:local
npm run db:seed:local              # empresas y administradores de ejemplo
npm run dev                        # http://localhost:8787
```

Crear el primer usuario:

```bash
curl -X POST http://localhost:8787/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"setupToken":"cambiar-por-un-valor-aleatorio-largo",
       "email":"relizondo@tres60.cl","name":"Rodrigo","password":"Clave.Local.2026"}'
```

Entrar a `http://localhost:8787`, crear la campana del mes e importar
`samples/admanager_export_sample.csv`. Son 19 filas con los casos dificiles ya incluidos:
empresas escritas de cuatro formas distintas, managers en formato DN de AD, cuentas ya
deshabilitadas, cuentas sin empresa, y cuentas internas (`mtexto`, `jextra`) que **no** deben
entrar y sirven para verificar que no haya falsos positivos.

Con `MAIL_PROVIDER=console` no se envia ningun correo: cada envio queda en la consola y en
la bitacora. Es el modo correcto para recorrer el flujo completo sin escribirle a nadie.

## Verificaciones

```bash
npm test        # 69 pruebas unitarias (node:test, sin dependencias)
npm run check   # sintaxis, imports y esquema de base de datos
```

## Documentacion

| Documento | Contenido |
|---|---|
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Diseno, componentes, flujo mensual y decisiones tomadas |
| [`docs/MODELO-DATOS.md`](docs/MODELO-DATOS.md) | Entidades, relaciones, vistas e indices |
| [`docs/API.md`](docs/API.md) | Endpoints, roles, contratos y errores |
| [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) | Cloudflare, GitHub Actions, respaldos y rollback |
| [`docs/GOOGLE-WORKSPACE.md`](docs/GOOGLE-WORKSPACE.md) | Configuracion del correo y cambio de casilla remitente |
| [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) | Modelo de amenazas, tokens, autenticacion y datos personales |
| [`docs/RUNBOOK-MENSUAL.md`](docs/RUNBOOK-MENSUAL.md) | Procedimiento operativo paso a paso |
| [`docs/INTEGRACIONES-FUTURAS.md`](docs/INTEGRACIONES-FUTURAS.md) | Capstone, AD Manager, Graph y su orden de prioridad |

## Decisiones que conviene conocer

**La aplicacion no ejecuta bajas en Active Directory.** No tiene credenciales de dominio.
Produce la cola de bajas y un script PowerShell de apoyo; la ejecucion la hace el equipo de
identidades con revision humana. Un sistema que envia correos automaticos a terceros no
deberia ademas poder deshabilitar cuentas del directorio.

**Las cuentas sin administrador identificado nunca se dan de baja solas.** El vencimiento
automatico alcanza unicamente a cuentas que efectivamente fueron notificadas a alguien.

**Se usa Workers Static Assets en vez de Cloudflare Pages** para el frontend: es la
evolucion oficial de Pages, permite un solo origen (sin CORS, cookie `SameSite=Strict`) y un
despliegue atomico. El frontend quedo igualmente estatico y desacoplado, de modo que
publicarlo en Pages sigue siendo posible cambiando una variable. El detalle esta en
`docs/ARQUITECTURA.md`.

**Este repositorio ya tiene un servicio de Cloudflare Workers Builds conectado**
(`playbook-mda-capstone`), que al ver `ext-audit/wrangler.toml` intenta tomarlo como
suyo y falla. Hay que acotarlo o darle a `ext-audit` su propio servicio antes de
integrar: el procedimiento esta en `docs/DESPLIEGUE.md`, seccion *Convivencia con las
integraciones ya existentes del repositorio*.

**El correo va por la API de Gmail y no por SMTP** porque el runtime de Workers no permite
abrir conexiones SMTP. La casilla remitente se cambia con una variable de entorno, sin tocar
codigo.

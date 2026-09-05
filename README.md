# Remote Control Hub

Controlá tu **PC desde tu celular** a través de la red Wi-Fi: touchpad, teclado,
micrófono inalámbrico y controles multimedia.

```
celular (PWA)  ──WebSocket──►  servidor Node.js (Windows)  ──►  entrada/mouse/audio real
     │                                        │
     └── escaneás un QR / escribís la IP ─────┘   (emparejamiento con código + aprobación)
```

## Estado del proyecto

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | MVP de conexión: servidor PC, cliente móvil, Wi-Fi, emparejamiento, WebSocket | ✅ implementado y testeado |
| 2 | Mouse / touchpad (movimiento, clics, doble clic, scroll 2 dedos, arrastrar) | ✅ implementado (dry-run testeado) |
| 3 | Teclado (texto, teclas especiales, combinaciones, atajos, modificadores) | ✅ implementado (dry-run testeado) |
| 4 | Micrófono inalámbrico (PCM en tiempo real, medidor, volumen, mute) | ✅ implementado (captura testeada) |
| 5 | Seguridad: token hash, allowlist, revocación, TTL de emparejamiento | ✅ implementado y testeado |
| 6 | Bluetooth como transporte alternativo | 🔲 pendiente (ver `ConnectionTransport`) |
| 7 | Instalador Windows + APK nativo / empaquetado | 🔲 pendiente |

## Stack elegido y por qué

- **Servidor: Node.js (>=18) sobre Windows.** Ya disponible en el entorno, sin
  compilación, con `ws` (WebSocket) y `qrcode`. El control real de mouse/teclado
  y la reproducción de audio se delegan en helpers PowerShell con `Add-Type`
  (interop `user32` / `winmm`), evitando dependencias nativas frágiles.
- **Cliente móvil: PWA servida por el propio servidor** (`http://IP:PUERTO/app`).
  El prompt recomendaba Flutter/Android nativo, pero en este entorno no hay
  Flutter instalado y las herramientas Android no están listas para un APK. Una
  PWA corre hoy en cualquier navegador del celular y cubre todas las
  capacidades requeridas (touch, teclado nativo, `getUserMedia`/micrófono). El
  protocolo y los módulos compartidos (`shared/`) están aislados para poder
  portar el cliente a Flutter en el futuro sin tocar el servidor.
- **Audio: PCM 16-bit LE, 48 kHz mono por el mismo WebSocket (frames binarios).**
  No requiere codecs ni WebRTC: el costo de ancho de banda es ~96 KB/s, la
  latencia es mínima (chunks de ~85 ms) y evita dependencias nativas. El
  servidor aplica volumen/mute por ganancia y reproduce vía `waveOut`.

## Estructura

```
remote-control-hub/
├── server/
│   ├── src/
│   │   ├── index.js          arranque, logging, shutdown
│   │   ├── config.js         variables de entorno + defaults
│   │   ├── ip.js             detección de IP local
│   │   ├── security.js       DeviceManager + PairingManager (tokens hasheados)
│   │   ├── store.js          persistencia JSON atómica de dispositivos
│   │   ├── http.js           UI admin, PWA /app, API REST (/api/*)
│   │   ├── ws.js             WebSocket: auth, routing, rate-limit, permisos
│   │   ├── input/controller.js  input dry-run/real (helper PowerShell)
│   │   ├── audio/sink.js     audio playback/captura (helper PowerShell)
│   │   └── ui/admin.html     panel de la PC (QR, emparejamiento, dispositivos)
│   ├── public/app/           cliente móvil (PWA, vanilla JS)
│   ├── helpers/              windows-input.ps1 · windows-audio.ps1
│   └── test/                 test de integración end-to-end
├── shared/
│   ├── protocol.js           mensajes permitidos (allowlist) y formatos
│   └── keys.js               mapa de teclas → códigos VK (compartido)
└── README.md
```

La interfaz `ConnectionTransport` no está implementada como clase única porque
el transporte es HTTP+WS del mismo origen; los módulos `network`/`security`/
`input`/`audio` ya están separados para añadir `BluetoothTransport` u otros sin
acoplarse a la UI.

## Requisitos

- Windows 10/11 (servidor)
- Node.js 18+ (`node -v`)
- PowerShell 5.1 (incluido en Windows)
- Un celular con navegador moderno (Chrome/Edge) en la misma red Wi-Fi

## Instalación y ejecución

```powershell
cd server
npm install
npm start
```

Se abre el **panel de la PC** en el navegador (o entrá a `http://IP_LAN:8742`).

> ⚠️ **Micrófono del celular requiere HTTPS.** Los navegadores solo exponen
> `navigator.mediaDevices`/`getUserMedia` en contextos seguros; por HTTP la PWA
> no puede capturar audio. Ejecutá con TLS y usá la URL `https://IP_LAN:8743/app`:
>
> ```powershell
> $env:RCH_TLS="true"
> npm start
> ```
>
> El certificado es autofirmado (se genera solo en `server/data/tls/`): en el
> celular tocá **Avanzado → Continuar de todos modos** la primera vez, y rehacé
> el emparejamiento porque el origen cambió.

### Emparejar el celular

1. En el celular abrí `https://IP_LAN:8743/app` (o escaneá el **código QR** del panel, que ya apunta a HTTPS).
2. Tocá **Emparejar con mi PC**.
3. En la PC: en el panel → sección **Emparejamiento** → **Aprobar** (el código se muestra en ambas pantallas).
4. En el celular: tocá **Ya lo aprobé en la PC**.
5. Ya podés usar Touchpad, Teclado, Micrófono y Multimedia.

### Probarlo sin tocar la PC (modo prueba/dry-run)

```powershell
$env:RCH_INPUT_DRY_RUN="true"   # el input se registra pero NO se ejecuta
$env:RCH_AUDIO_DRY_RUN="true"   # el audio se captura a data/capture.raw
npm start
```

> ⚠️ `RCH_AUDIO_DRY_RUN` también se usa para **grabar** el audio del micrófono
> a `server/data/capture.raw`. Se puede convertir a WAV con:
> `python -c "import struct,sys; d=open('server/data/capture.raw','rb').read(); f=open('capture.wav','wb'); f.write(b'RIFF'+struct.pack('<I',36+len(d))+b'WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00\xee\x02\x00\x02\x00\x10\x00data'+struct.pack('<I',len(d))+d); f.close()"`

### Tests

```powershell
cd server
npm test
```

Levanta un servidor real en un puerto libre con input/audio dry-run y verifica:
emparejamiento completo (request → aprobación → código → token), WebSocket
autenticado, heartbeat, eventos de mouse/teclado/texto/multimedia, bloqueo por
permisos, streaming de audio capturado a WAV válido, y revocación de tokens.

## Variables de configuración

| Variable | Default | Descripción |
|---|---|---|
| `RCH_HOST` | `0.0.0.0` | Interfaz de escucha |
| `RCH_PORT` | `8742` | Puerto HTTP/WebSocket (panel de la PC) |
| `RCH_TLS` | `false` | `true`: agrega HTTPS en `RCH_TLS_PORT` con certificado autofirmado |
| `RCH_TLS_PORT` | `8743` | Puerto HTTPS para el cliente móvil |
| `RCH_DATA_DIR` | `server/data` | Dónde persiste `devices.json`, el `.raw` de captura y el cert TLS |
| `RCH_INPUT_DRY_RUN` | `false` | `true`: registra eventos de input, no los ejecuta |
| `RCH_AUDIO_DRY_RUN` | `false` | `true`: guarda el audio a `capture.raw` en vez de reproducirlo |
| `RCH_AUDIO_DEVICE` | `-1` | Índice del dispositivo de salida (WAVE_MAPPER = -1). Listarlos: `listWindowsAudioDevices()` / panel |
| `RCH_PAIRING_TTL_MS` | `120000` | Vida útil del código de emparejamiento |
| `RCH_SESSION_TTL_DAYS` | `30` | Días de validez de una sesión sin uso |
| `RCH_HEARTBEAT_MS` | `30000` | Intervalo de heartbeat de la app |
| `RCH_MAX_DEVICES` | `16` | Máximo de dispositivos/conexiones pendientes |
| `RCH_ADMIN_TOKEN` | *(vacío)* | Si se define, la UI/API de admin exige este token en `x-admin-token` |
| `RCH_OPEN_BROWSER` | `true` | Abrir el panel de la PC al arrancar |
| `RCH_LOG_LEVEL` | `info` | `debug` \| `info` \| `error` |

## Protocolo (resumen)

Canal de texto = JSON `{t, ...}`. Canal binario = PCM16 LE del micrófono.

- Autenticación: primer mensaje `hello` con el token; si no es válido se cierra.
  Los tokens almacenados están **hasheados (sha256)**.
- Eventos de control (`input.*`, `media.*`, `audio.*`): validados contra un
  **allowlist** (`shared/protocol.js`). Nunca se ejecuta un comando arbitrario
  de la red ni se permite control remoto con comandos de shell.
- Permisos por dispositivo: `mouse`, `keyboard`, `audio` (toggle en el panel).
  Las teclas multimedia usan el permiso `keyboard`.
- Heartbeat de la app + ping/pong de WebSocket para detectar desconexiones;
  el cliente PWA reconecta automáticamente con backoff.

## Seguridad

- Código de emparejamiento de 6 dígitos con TTL + **aprobación explícita en la PC**.
- Tokens de sesión por dispositivo, hasheados, recordados en la PWA (`localStorage`)
  para reconexión automática, y **revocables** desde el panel.
- Rate limit por conexión (anti-abuso) y tamaño máximo de payload.
- `RCH_ADMIN_TOKEN` protege la API y el panel de administración en redes compartidas.
- Los helpers PowerShell solo ejecutan operaciones de input/audio validadas por el allowlist.

## Limitaciones conocidas

- El cliente es una **PWA** (no un APK); para instalarla en el celular, usá
  "Agregar a pantalla de inicio" con un navegador moderno.
- La reproducción de audio usa `waveOut`; si la red va más rápida que la salida,
  se descartan bloques excedentes para no acumular memoria (política de drop).
- Al primer uso del micrófono, el servidor compila `helpers/wavesink.cs` a un DLL
  (`csc.exe` → `data/wavesink.dll`) y el helper solo lo carga (`Add-Type -Path`).
  Esto evita el bug de PowerShell 5.1 donde compilar (`Add-Type -TypeDefinition`)
  con el stdin redirigido corrompe el handle y el helper lee EOF al instante.
- El arranque de PowerShell (~1 s) se amortiza manteniendo el helper vivo en modo
  reproducción; el **primer** uso del micrófono puede tardar ese segundo.
- Candado de teclas con modificadores + combinaciones se resuelve en el cliente
  con teclado físico del celular y botones de mods; un layout completo de teclas
  especiales puede ampliarse en `shared/keys.js`.
- Bluetooth no está implementado a propósito (Fase 6): requiere perfiles SPP/RFCOMM
  que Android/iOS restringen a apps nativas; la arquitectura modular queda lista.

## Sugerencias de desarrollo (roadmap)

- **Fase 6 — Bluetooth**: cliente nativo (Flutter/Android) con `BluetoothTransport`
  implementando la misma interfaz que Wi-Fi.
- **Fase 7 — Instalador**: `electron-builder` o un `.bat` de servicios para ejecutar
  el servidor en segundo plano (arranque con Windows), y empaquetado PWA/APK.
- **Microfono como entrada en Windows**: dispositivo virtual de entrada (VB-Cable /
  driver virtual) reutilizando el mismo chunk PCM recibido.
- **WebRTC** como canal de audio alternativo si se necesitara menor latencia con
  cola de red (el servidor ya separa control y audio binario en el mismo socket).

## Licencia

Código de proyecto personal; distribución libre. No incluye dependencias de terceros
más allá de `ws` y `qrcode` (MIT).
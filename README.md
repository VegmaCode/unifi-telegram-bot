# 🤖 UniFi Telegram Webhook

Bot de Telegram para monitorización de redes UniFi. Recibe notificaciones en tiempo real de eventos de tu UDM Pro y consulta el estado de tu red mediante comandos directamente desde Telegram.

## ✨ Funcionalidades

- 📩 **Notificaciones automáticas** de eventos UniFi vía Webhook
- 🤖 **Bot interactivo** con comandos para consultar el estado de la red
- 🌐 **Integración con la API local** del UDM Pro mediante API Key
- 🔐 **Acceso restringido** al chat autorizado
- 🐳 **Despliegue sencillo** con Docker Compose

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `/estado` | Estado de todos los dispositivos UniFi (APs, switches, gateway) |
| `/wan` | Estado de la conexión WAN, IP pública, clientes y APs |
| `/alertas` | Alertas activas sin archivar en la red |
| `/debug` | Diagnóstico de conexión con el UDM Pro |
| `/ayuda` | Lista de comandos disponibles |

### Eventos notificados automáticamente

El bot notifica eventos de red en tiempo real: conexiones/desconexiones WiFi, dispositivos offline, caídas de internet, loops de red, problemas de hardware, accesos de administrador y muchos más.

---

## 📋 Requisitos previos

- Docker y Docker Compose instalados en el servidor
- El servidor debe estar en la **misma red local** que el UDM Pro
- Cuenta de Telegram
- Acceso al panel de administración del UDM Pro

---

## 🚀 Instalación paso a paso

### Paso 1 — Crear el bot en Telegram con BotFather

1. Abre Telegram y busca **@BotFather**
2. Envía el comando `/newbot`
3. Escribe el **nombre** que tendrá el bot (ej: `Mi Red UniFi`)
4. Escribe el **username** del bot — debe terminar en `bot` (ej: `MiRedUnifi_bot`)
5. BotFather te devolverá el **Token** del bot. Guárdalo, tiene este formato:

   ```
   1234567890:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### Paso 2 — Obtener el Chat ID

El Chat ID identifica el grupo o chat donde el bot enviará los mensajes. Solo ese chat podrá interactuar con el bot.

**Opción A — Chat individual:**

1. Busca tu bot en Telegram y pulsa **Iniciar**
2. Abre en el navegador:
   ```
   https://api.telegram.org/bot<TU_TOKEN>/getUpdates
   ```
3. Envía cualquier mensaje al bot y recarga la página
4. Busca el campo `"id"` dentro de `"chat"` — ese es tu Chat ID

**Opción B — Grupo de Telegram:**

1. Crea un grupo y añade el bot como miembro
2. Envía un mensaje en el grupo
3. Abre la misma URL de arriba y busca el `"id"` del chat — los grupos tienen ID negativo (ej: `-1001234567890`)

### Paso 3 — Generar la API Key del UDM Pro

1. Accede al panel de tu UDM Pro
2. Ve a **Settings → System → Advanced**
3. En la sección **API Keys**, haz clic en **Create API Key**
4. Dale un nombre descriptivo (ej: `telegram-bot`)
5. Copia la key generada — solo se muestra una vez

### Paso 4 — Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/unifi-telegram-webhook.git
cd unifi-telegram-webhook
```

### Paso 5 — Configurar el `docker-compose.yml`

Edita el archivo `docker-compose.yml` y rellena las variables de entorno con tus datos:

```yaml
version: "3.8"
services:
  unifi-webhook:
    build: .
    container_name: unifi-webhook
    restart: always
    ports:
      - "3000:3000"
    environment:
      TELEGRAM_TOKEN: "1234567890:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Token de BotFather
      CHAT_ID: "-1001234567890"                                           # ID del chat autorizado
      SECRET: "una_clave_secreta_segura"                                  # Clave para el webhook
      UNIFI_HOST: "https://192.168.1.1"                                   # IP de tu UDM Pro
      UNIFI_API_KEY: "tu_api_key_del_udm_pro"                             # API Key del UDM Pro
      UNIFI_SITE: "default"                                               # Nombre del site (normalmente "default")
```

| Variable | Descripción |
|---|---|
| `TELEGRAM_TOKEN` | Token obtenido de BotFather en el Paso 1 |
| `CHAT_ID` | ID del chat obtenido en el Paso 2 |
| `SECRET` | Clave arbitraria que usará UniFi para autenticar el webhook |
| `UNIFI_HOST` | URL con la IP local de tu UDM Pro |
| `UNIFI_API_KEY` | API Key generada en el UDM Pro en el Paso 3 |
| `UNIFI_SITE` | Site de UniFi, habitualmente `default` |

### Paso 6 — Construir y arrancar el contenedor

```bash
docker compose up -d --build
```

Verifica que el contenedor arranca correctamente:

```bash
docker logs -f unifi-webhook
```

Deberías ver:

```
🚀 UNIFI webhook activo en puerto 3000
🖥️  UDM Pro: https://192.168.1.1 | Site: default
🔄 Iniciando polling de Telegram...
```

### Paso 7 — Configurar el Webhook en UniFi

1. Accede al panel de tu UDM Pro
2. Ve a **Settings → Notifications → Webhook**
3. Haz clic en **Add Webhook** y rellena los campos:

   | Campo | Valor |
   |---|---|
   | **Delivery URL** | `http://IP_DEL_SERVIDOR:3000/webhook` |
   | **Delivery method** | `POST` |
   | **Authentication** | `Bearer` |
   | **Token** | El valor que pusiste en `SECRET` |

4. Selecciona los eventos que quieres notificar
5. Guarda y prueba el webhook con el botón **Send Test**

---

## 🧪 Verificar que todo funciona

**Prueba el bot** enviando `/ayuda` en el chat de Telegram — debe responder con la lista de comandos.

**Prueba el webhook** con curl desde el servidor:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer una_clave_secreta_segura" \
  -d '{
    "name": "Internet Down",
    "severity": 1,
    "parameters": {
      "UNIFIhost": "UDM Pro",
      "UNIFIwanId": "WAN1",
      "UNIFIwanIsp": "Mi ISP"
    }
  }'
```

**Prueba el diagnóstico** enviando `/debug` al bot — verás el estado de la conexión con el UDM Pro y los datos raw de la API.

---

## 🗂️ Estructura del proyecto

```
unifi-telegram-webhook/
├── app.js              # Lógica principal del bot y webhook
├── package.json        # Dependencias Node.js
├── Dockerfile          # Imagen Docker
├── docker-compose.yml  # Configuración del contenedor
└── README.md
```

---

## ⚙️ Personalización

### Añadir nuevos eventos

En `app.js`, localiza el objeto `EVENT_MAP` y añade una entrada con el nombre exacto del evento tal como lo envía UniFi:

```js
"Nombre Del Evento": { icon: "🔔", area: "Categoría", texto: "Descripción en español" },
```

### Cambiar el huso horario

Por defecto los mensajes usan `Europe/Madrid`. Para cambiarlo, busca todas las ocurrencias de `timeZone` en `app.js` y sustitúyelas por tu zona horaria ([lista de zonas válidas](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)).

### Cambiar el puerto

Si el puerto `3000` está ocupado, cámbialo en `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"   # Expone el puerto 8080 hacia el 3000 interno
```

---

## 🔒 Seguridad

- El bot solo responde al `CHAT_ID` configurado. Cualquier otro chat recibe un mensaje de acceso denegado.
- El webhook requiere el header `Authorization: Bearer <SECRET>` para aceptar peticiones. Sin él devuelve `403`.
- La conexión con el UDM Pro usa HTTPS ignorando el certificado autofirmado del dispositivo, lo que es seguro en una red local cerrada.
- **No expongas el puerto 3000 a internet** salvo que lo protejas con un proxy inverso (nginx, Traefik) con HTTPS.

---

## 🐛 Solución de problemas

**El bot no responde a los comandos**
- Comprueba que el `CHAT_ID` es correcto y coincide con el chat desde el que escribes
- Revisa los logs: `docker logs -f unifi-webhook`

**El webhook devuelve 403**
- Verifica que el `SECRET` en UniFi coincide exactamente con el del `docker-compose.yml`

**Los comandos devuelven error 401**
- La `UNIFI_API_KEY` no es válida o ha caducado. Genera una nueva en el UDM Pro.

**Los comandos devuelven datos vacíos**
- Verifica que `UNIFI_HOST` apunta a la IP correcta del UDM Pro
- Comprueba que el servidor Docker está en la misma red que el UDM Pro
- Usa `/debug` para ver la respuesta raw de la API

---

## 📄 Licencia

MIT

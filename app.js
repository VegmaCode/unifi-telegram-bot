const express = require('express');
const axios   = require('axios');
const https   = require('https');

const app = express();
app.use(express.json({ strict: false }));
app.use(express.text());

// =====================
// CONFIG
// =====================
const PORT           = process.env.PORT        || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID        = process.env.CHAT_ID;
const SECRET         = process.env.SECRET;
const UNIFI_HOST     = process.env.UNIFI_HOST  || "https://172.20.100.1";
const UNIFI_API_KEY  = process.env.UNIFI_API_KEY;
const UNIFI_SITE     = process.env.UNIFI_SITE  || "default";

// Ignorar certificado autofirmado del UDM Pro
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// =====================
// CLIENTE API LOCAL UDM PRO (X-API-Key)
// =====================
const unifiApi = axios.create({
    baseURL: UNIFI_HOST,
    httpsAgent,
    headers: {
        'Accept':    'application/json',
        'X-API-Key': UNIFI_API_KEY
    },
    timeout: 10000
});

// Soporta tanto { data: [] } como { meta: { rc }, data: [] }
async function unifiGet(path, params = {}) {
    const res  = await unifiApi.get(`/proxy/network/api/s/${UNIFI_SITE}${path}`, { params });
    const body = res.data;

    // Respuesta formato legacy: { meta: { rc: 'error' } }
    if (body?.meta?.rc === 'error') {
        throw new Error(body.meta.msg || 'API error');
    }

    return body?.data || [];
}

// =====================
// TELEGRAM HELPERS
// =====================
async function sendTelegram(chatId, text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });
    } catch (err) {
        console.error("❌ Error enviando a Telegram:", err.response?.data || err.message);
    }
}

// =====================
// ESCAPE MARKDOWN
// =====================
function esc(text) {
    return String(text).replace(/[_*`\[]/g, '\\$&');
}

// =====================
// UTILIDADES
// =====================
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// =====================
// COMANDOS DEL BOT
// =====================
const COMMANDS = {
    '/start':   cmdAyuda,
    '/ayuda':   cmdAyuda,
    '/estado':  cmdEstado,
    '/wan':     cmdWan,
    '/alertas': cmdAlertas,
    '/debug':   cmdDebug,
};

async function cmdAyuda(chatId) {
    await sendTelegram(chatId, `🤖 *COTERENA Bot — Comandos disponibles*

/estado — Estado de todos los dispositivos UniFi
/wan — Estado de la conexión WAN e internet
/alertas — Alertas activas en la red
/debug — Diagnóstico de conexión con UDM Pro
/ayuda — Muestra este mensaje`);
}

// ─────────────────────────────────────────
// /debug
// ─────────────────────────────────────────
async function cmdDebug(chatId) {
    await sendTelegram(chatId, "🔍 Ejecutando diagnóstico...");
    await sendTelegram(chatId, `🖥️ Host: \`${esc(UNIFI_HOST)}\`\n🔑 API Key: \`${esc((UNIFI_API_KEY || "NO CONFIGURADA").slice(0, 8))}...\`\n🏠 Site: \`${esc(UNIFI_SITE)}\``);

    if (!UNIFI_API_KEY) {
        return sendTelegram(chatId, "❌ *UNIFI\\_API\\_KEY no está configurada* en el docker\\-compose.yml");
    }

    for (const path of ['/stat/health', '/stat/device', '/list/alarm']) {
        try {
            const data = await unifiGet(path);
            const raw  = JSON.stringify(data.slice ? data.slice(0, 2) : data, null, 2).slice(0, 2000);
            await sendTelegram(chatId, `📦 *${esc(path)}*\n\`\`\`\n${raw}\n\`\`\``);
        } catch (err) {
            await sendTelegram(chatId, `❌ *${esc(path)}* — ${esc(String(err.response?.status || ""))} ${esc(JSON.stringify(err.response?.data || err.message))}`);
        }
    }

    await sendTelegram(chatId, "✅ Diagnóstico completado.");
}

// ─────────────────────────────────────────
// /estado — /stat/device
// ─────────────────────────────────────────
async function cmdEstado(chatId) {
    await sendTelegram(chatId, "⏳ Consultando dispositivos...");
    try {
        const devices = await unifiGet('/stat/device');

        if (!devices.length) {
            return sendTelegram(chatId, "⚠️ No se encontraron dispositivos.");
        }

        const typeLabel  = { ugw: "🛡️ Gateway", usw: "🔀 Switch", uap: "📡 AP", udm: "🖥️ UDM", uxg: "🛡️ Gateway" };
        const stateLabel = { 0: "❌ Desconectado", 1: "✅ Conectado", 2: "🔄 Pendiente", 4: "⬆️ Actualizando", 5: "⚙️ Provisionando" };

        const time = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
        let lines = [`🖥️ *COTERENA | Estado de dispositivos*\n⏰ ${time}\n`];

        for (const d of devices) {
            const tipo   = typeLabel[d.type]   || `📦 ${esc(d.type || "?")}`;
            const estado = stateLabel[d.state] || `❓ Estado ${d.state}`;
            const nombre = esc(d.name || d.model || d.mac);
            const ip     = d.ip     ? ` — \`${esc(d.ip)}\`` : "";
            const uptime = d.uptime ? ` — ⏱️ ${formatUptime(d.uptime)}` : "";
            const stats  = d['system-stats'];
            const cpu    = stats?.cpu ? `CPU: ${Math.round(stats.cpu)}%` : "";
            const mem    = stats?.mem ? `MEM: ${Math.round(stats.mem)}%` : "";
            const extra  = [cpu, mem].filter(Boolean).join('  ');

            lines.push(`${tipo} *${nombre}*${ip}`);
            lines.push(`   ${estado}${uptime}`);
            if (extra) lines.push(`   📊 ${extra}`);
            lines.push(``);
        }

        lines.push(`📦 *Total: ${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}*`);
        await sendTelegram(chatId, lines.join("\n"));

    } catch (err) {
        console.error("❌ cmdEstado:", err.response?.data || err.message);
        await sendTelegram(chatId, `❌ Error consultando dispositivos.\n\`${esc(err.message)}\``);
    }
}

// ─────────────────────────────────────────
// /wan — /stat/health
// ─────────────────────────────────────────
async function cmdWan(chatId) {
    await sendTelegram(chatId, "⏳ Consultando estado WAN...");
    try {
        const health = await unifiGet('/stat/health');
        const time   = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

        const wan  = health.find(s => s.subsystem === 'wan');
        const lan  = health.find(s => s.subsystem === 'lan');
        const wlan = health.find(s => s.subsystem === 'wlan');

        let lines = [`🌐 *COTERENA | Estado de red*\n⏰ ${time}\n`];

        if (wan) {
            const status = wan.status === 'ok' ? '🟢 Conectado' : '🔴 Desconectado';
            lines.push(`*WAN:* ${status}`);
            if (wan.wan_ip)                lines.push(`   🌍 IP Pública: \`${esc(wan.wan_ip)}\``);
            if (wan.gw_mac)                lines.push(`   🔗 Gateway MAC: \`${esc(wan.gw_mac)}\``);
            if (wan['tx_bytes-r'] != null) lines.push(`   ⬆️ TX: ${formatBytes(wan['tx_bytes-r'])}/s  ⬇️ RX: ${formatBytes(wan['rx_bytes-r'])}/s`);
            if (wan.latency != null)       lines.push(`   📡 Latencia: ${esc(String(wan.latency))} ms`);
            lines.push(``);
        }

        if (lan) {
            lines.push(`*LAN:* ${lan.status === 'ok' ? '🟢 OK' : '🔴 Error'}`);
            if (lan.num_user != null) lines.push(`   💻 Clientes: ${lan.num_user}`);
            if (lan.num_sw   != null) lines.push(`   🔀 Switches: ${lan.num_sw}`);
            lines.push(``);
        }

        if (wlan) {
            lines.push(`*WiFi:* ${wlan.status === 'ok' ? '🟢 OK' : '🔴 Error'}`);
            if (wlan.num_user != null) lines.push(`   📱 Clientes WiFi: ${wlan.num_user}`);
            if (wlan.num_ap   != null) lines.push(`   📡 APs activos: ${wlan.num_ap}`);
        }

        await sendTelegram(chatId, lines.join("\n"));

    } catch (err) {
        console.error("❌ cmdWan:", err.response?.data || err.message);
        await sendTelegram(chatId, `❌ Error consultando WAN.\n\`${esc(err.message)}\``);
    }
}

// ─────────────────────────────────────────
// /alertas — /list/alarm
// ─────────────────────────────────────────
async function cmdAlertas(chatId) {
    await sendTelegram(chatId, "⏳ Consultando alertas activas...");
    try {
        const alarms = await unifiGet('/list/alarm', { archived: 'false' });
        const time   = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

        if (!alarms.length) {
            return sendTelegram(chatId, `✅ *COTERENA | Sin alertas activas*\n\nNo hay ninguna alerta pendiente.\n⏰ ${time}`);
        }

        let lines = [`🚨 *COTERENA | Alertas activas* (${alarms.length})\n⏰ ${time}\n`];

        for (const a of alarms.slice(0, 10)) {
            const fecha = a.datetime
                ? new Date(a.datetime).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
                : "—";
            lines.push(`⚠️ *${esc(a.msg || a.key || "Sin descripción")}*`);
            lines.push(`   📅 ${fecha}`);
            lines.push(``);
        }

        if (alarms.length > 10) lines.push(`_...y ${alarms.length - 10} alertas más._`);

        await sendTelegram(chatId, lines.join("\n"));

    } catch (err) {
        console.error("❌ cmdAlertas:", err.response?.data || err.message);
        await sendTelegram(chatId, `❌ Error consultando alertas.\n\`${esc(err.message)}\``);
    }
}

// =====================
// TELEGRAM POLLING
// =====================
let pollingOffset = 0;

async function startPolling() {
    console.log("🔄 Iniciando polling de Telegram...");

    const poll = async () => {
        try {
            const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`, {
                params: { offset: pollingOffset, timeout: 30 },
                timeout: 35000
            });

            for (const update of (res.data?.result || [])) {
                pollingOffset = update.update_id + 1;

                const msg = update.message || update.channel_post;
                if (!msg?.text) continue;

                const chatId  = String(msg.chat.id);
                const command = msg.text.trim().split(' ')[0].toLowerCase();

                if (chatId !== CHAT_ID) {
                    console.warn(`⛔ Chat no autorizado: ${chatId}`);
                    await sendTelegram(chatId, "⛔ No estás autorizado para usar este bot.");
                    continue;
                }

                console.log(`📨 Comando recibido: ${command}`);
                const handler = COMMANDS[command];
                if (handler) {
                    await handler(chatId);
                } else {
                    await sendTelegram(chatId, `❓ Comando desconocido: *${esc(command)}*\n\nUsa /ayuda para ver los comandos disponibles.`);
                }
            }
        } catch (err) {
            if (err.code !== 'ECONNABORTED') console.error("❌ Polling:", err.message);
        }
        setImmediate(poll);
    };

    poll();
}

// =====================
// WEBHOOK (UniFi → Telegram)
// =====================
app.post('/webhook', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.replace("Bearer ", "").trim();

        if (token !== SECRET) {
            console.warn("⛔ Token inválido:", token);
            return res.sendStatus(403);
        }

        const data = req.body;
        console.log("📩 EVENTO RECIBIDO:");
        console.log(JSON.stringify(data, null, 2));

        const message = formatMessage(data);
        if (!message) return res.sendStatus(200);

        await sendTelegram(CHAT_ID, message);
        console.log("✅ Mensaje enviado a Telegram");
        return res.sendStatus(200);

    } catch (err) {
        console.error("❌ ERROR WEBHOOK:", err.response?.data || err.message);
        return res.sendStatus(500);
    }
});

// =====================
// SEVERIDAD
// =====================
function getSeverityInfo(severity) {
    switch (parseInt(severity)) {
        case 0: return { emoji: "🔴", label: "CRÍTICO" };
        case 1: return { emoji: "🟠", label: "WARNING" };
        case 2: return { emoji: "🔵", label: "AVISO" };
        default: return { emoji: "🟠", label: "AVISO" };
    }
}

// =====================
// MAPA DE EVENTOS
// =====================
const EVENT_MAP = {
    "WiFi Client Connected":        { icon: "📶",    area: "WiFi",        texto: "Cliente WiFi conectado"            },
    "WiFi Client Disconnected":     { icon: "📴",    area: "WiFi",        texto: "Cliente WiFi desconectado"         },
    "WiFi Client Roamed":           { icon: "🔀",    area: "WiFi",        texto: "Cliente WiFi ha hecho roaming"     },
    "WiFi Client Signal Changed":   { icon: "📡",    area: "WiFi",        texto: "Señal WiFi del cliente cambiada"   },
    "Rogue AP Detected":            { icon: "🚨",    area: "WiFi",        texto: "AP no autorizado detectado"        },
    "Device Reconnected":           { icon: "✅",    area: "Dispositivo", texto: "Dispositivo conectado"             },
    "Device Offline":               { icon: "🔴",    area: "Dispositivo", texto: "Dispositivo desconectado"          },
    "Device Restarted":             { icon: "🔄",    area: "Dispositivo", texto: "Dispositivo reiniciado"            },
    "UniFi Device Disconnected":    { icon: "🔴",    area: "Dispositivo", texto: "Dispositivo UniFi desconectado"    },
    "Device Adoption":              { icon: "➕",    area: "Dispositivo", texto: "Dispositivo adoptado"              },
    "Multiple Devices Restarted":   { icon: "🔁",    area: "Dispositivo", texto: "Varios dispositivos reiniciados"   },
    "Internet Down":                { icon: "🌐🔴", area: "Red",         texto: "Internet desconectado"             },
    "Internet Restored":            { icon: "🌐🟢", area: "Red",         texto: "Internet conectado"                },
    "Temporary Internet Disconnection": { icon: "🌐🔴", area: "Red",      texto: "Desconexión de red temporal"      },
    "Multiple Internet Disconnections": { icon: "🌐🔴", area: "Red",      texto: "Múltiples desconexiones de red"    },
    "Network Loop Detected":        { icon: "🔄⚠️", area: "Red",         texto: "Loop de red detectado"             },
    "STP Blocked Network Loop":     { icon: "🛑",    area: "Red",         texto: "STP bloqueó un loop de red"        },
    "DHCP Leases Exhausted":        { icon: "📊",    area: "Red",         texto: "Pool DHCP agotado"                 },
    "Port Dropping Traffic":        { icon: "📉",    area: "Red",         texto: "Puerto descartando tráfico"        },
    "Port Transmissions Errors":    { icon: "❌",    area: "Red",         texto: "Errores de transmisión en puerto"  },
    "Modem Restarted":              { icon: "🔄",    area: "Red",         texto: "Módem reiniciado"                  },
    "Backup Power in Use":          { icon: "🔋",    area: "Energía",     texto: "Funcionando con batería (SAI)"     },
    "Insufficient PoE Power":       { icon: "⚡",    area: "Energía",     texto: "Potencia PoE insuficiente"         },
    "Fan Issue Detected":           { icon: "🌀",    area: "Hardware",    texto: "Fallo en ventilador detectado"     },
    "Slow RADIUS Authentication":   { icon: "🐢",    area: "Seguridad",   texto: "Autenticación RADIUS lenta"        },
    "Admin Login":                  { icon: "🔑",    area: "Seguridad",   texto: "Acceso de administrador"           },
    "Admin Login Failed":           { icon: "🚫",    area: "Seguridad",   texto: "Fallo de acceso de administrador"  },
    "Data Limit":                   { icon: "📊",    area: "Datos",       texto: "Límite de datos alcanzado"         },
};

// =====================
// FORMATEADOR WEBHOOK
// =====================
function formatMessage(data) {
    const time = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

    if (typeof data === "string") {
        return `📡 *COTERENA | TEST*\n\n📢 ${esc(data)}\n⏰ ${time}`;
    }

    if (data?.name) {
        const p     = data.parameters || {};
        const sev   = getSeverityInfo(data.severity);
        const event = EVENT_MAP[data.name] || { icon: "📌", area: "General", texto: data.name };

        let lines = [];
        lines.push(`${sev.emoji} *COTERENA | ${esc(sev.label)}*`);
        lines.push(``);

        if (data.customContent) {
            lines.push(`💬 *Mensaje personalizado:*`);
            lines.push(esc(data.customContent));
            lines.push(``);
        }

        lines.push(`${event.icon} *${esc(event.texto)}*`);
        lines.push(`🧩 *Categoría:* ${esc(event.area)}`);

        if (p.UNIFIconnectedToDeviceName) lines.push(`📡 *AP:* ${esc(p.UNIFIconnectedToDeviceName)}`);
        if (p.UNIFIclientAlias || p.UNIFIclientHostname)
            lines.push(`💻 *Cliente:* ${esc(p.UNIFIclientAlias || p.UNIFIclientHostname)}`);
        if (p.UNIFIclientIp)    lines.push(`🌐 *IP:* ${esc(p.UNIFIclientIp)}`);
        if (p.UNIFIclientMac)   lines.push(`🔢 *MAC:* ${esc(p.UNIFIclientMac)}`);
        if (p.UNIFIwifiName)    lines.push(`📶 *SSID:* ${esc(p.UNIFIwifiName)}`);
        if (p.UNIFInetworkName) lines.push(`🏷️ *VLAN:* ${esc(p.UNIFInetworkName)}`);
        if (p.UNIFIwifiBand && p.UNIFIwifiChannel)
            lines.push(`📻 *Canal:* ${esc(p.UNIFIwifiChannel)} (${p.UNIFIwifiBand === "na" ? "5 GHz" : "2.4 GHz"})`);
        if (p.UNIFIWiFiRssi)   lines.push(`📶 *RSSI:* ${esc(p.UNIFIWiFiRssi)} dBm`);
        if (p.UNIFIwanId)      lines.push(`🔌 *WAN:* ${esc(p.UNIFIwanId)}${p.UNIFIwanName ? ` — ${esc(p.UNIFIwanName)}` : ''}`);
        if (p.UNIFIwanIsp)     lines.push(`🌍 *ISP:* ${esc(p.UNIFIwanIsp)}`);
        if (p.UNIFIreportedDuration) lines.push(`⏱️ *Duración:* ${esc(p.UNIFIreportedDuration)}`);
        if (p.UNIFIdeviceName) lines.push(`🖥️ *Dispositivo:* ${esc(p.UNIFIdeviceName)}`);
        else if (p.UNIFIhost)  lines.push(`🖥️ *Dispositivo:* ${esc(p.UNIFIhost)}`);

        lines.push(`⏰ ${time}`);
        return lines.join("\n");
    }

    if (data?.meta?.msg) {
        return `⚠️ *COTERENA | EVENTO*\n\n📢 ${esc(data.meta.msg)}\n⏰ ${time}`;
    }

    return `📌 *COTERENA | EVENTO RAW*\n\n\`\`\`\n${JSON.stringify(data, null, 2).slice(0, 3000)}\n\`\`\`\n⏰ ${time}`;
}

// =====================
// START
// =====================
app.listen(PORT, () => {
    console.log(`🚀 COTERENA webhook activo en puerto ${PORT}`);
    console.log(`🖥️  UDM Pro: ${UNIFI_HOST} | Site: ${UNIFI_SITE}`);
    if (!UNIFI_API_KEY) console.warn("⚠️  UNIFI_API_KEY no configurada");
    startPolling();
});

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

let radiosData = [];

try {
    const jsonPath = path.join(__dirname, "radio.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    radiosData = JSON.parse(raw);
    console.log("JSON cargado correctamente");
} catch (err) {
    console.error("Error leyendo radio.json:", err.message);
}

// ROOT
app.get("/", (req, res) => {
    res.json({ status: "online" });
});

// LISTA RADIOS
app.get("/radio", (req, res) => {
    res.json(radiosData);
});

// STREAM RADIO (SEGURO CONTRA FUGAS Y REDIRECCIONES)
app.get("/radio/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const radio = radiosData.find(r => r.id === id);

    if (!radio || !radio.url) {
        return res.status(404).json({ error: "Radio no encontrada o sin URL válida" });
    }

    // Almacena las peticiones activas para este cliente específico
    let activeRequests = new Set();
    let isClientConnected = true;

    // Función interna recursiva con contador de saltos
    const connectToStream = (streamUrl, redirectCount = 0) => {
        // Evitar bucles infinitos de redirección
        if (redirectCount > 5) {
            console.error(`Radio ID ${id} superó el límite de redirecciones.`);
            if (!res.headersSent) {
                res.status(502).json({ error: "Demasiadas redirecciones en la emisora origen" });
            }
            return;
        }

        // Si el cliente se desconectó mientras procesábamos esto, abortamos inmediatamente
        if (!isClientConnected) return;

        const client = streamUrl.startsWith("https") ? https : http;

        const proxyReq = client.get(streamUrl, (stream) => {
            // Remover la petición actual del Set ya que ha respondido
            activeRequests.delete(proxyReq);

            // 1. Manejo de Redirecciones de forma segura
            if ([301, 302, 307, 308].includes(stream.statusCode) && stream.headers.location) {
                console.log(`Redirigiendo radio ID ${id} [Salto ${redirectCount + 1}] hacia: ${stream.headers.location}`);
                
                // Es vital reanudar o destruir el stream viejo para liberar memoria
                stream.resume(); 
                
                return connectToStream(stream.headers.location, redirectCount + 1);
            }

            // 2. Si el origen responde con error HTTP
            if (stream.statusCode >= 400) {
                stream.resume();
                if (!res.headersSent) {
                    return res.status(stream.statusCode).json({ error: "La emisora origen devolvió un error" });
                }
                return;
            }

            // Si el cliente se desconectó justo en el milisegundo en que el stream abrió
            if (!isClientConnected) {
                stream.destroy();
                return;
            }

            const contentType = stream.headers["content-type"] || "audio/mpeg";

            res.writeHead(200, {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Connection": "keep-alive",
                "Transfer-Encoding": "chunked"
            });

            // Capturar errores durante la transmisión activa
            stream.on("error", (streamErr) => {
                console.error(`Error en el flujo de datos de radio ID ${id}:`, streamErr.message);
                res.end();
            });

            stream.pipe(res);
        });

        // Registrar la petición activa en nuestro set de control
        activeRequests.add(proxyReq);

        // Capturar errores de conexión iniciales
        proxyReq.on("error", (err) => {
            activeRequests.delete(proxyReq);
            console.error(`Error de conexión inicial en radio ID ${id}:`, err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: "Error conectando con la emisora origen" });
            }
        });
    };

    // Iniciar el flujo
    connectToStream(radio.url);

    // CONTROL DE DESCONEXIÓN ABSOLUTO
    req.on("close", () => {
        isClientConnected = false;
        console.log(`Cliente desconectado de la radio ID ${id}. Limpiando recursos...`);
        
        // Destruimos absolutamente todas las peticiones HTTP pendientes de este hilo
        for (const activeReq of activeRequests) {
            activeReq.destroy();
        }
        activeRequests.clear();
    });
});

app.listen(PORT, () => {
    console.log(`Servidor online puerto ${PORT}`);
});

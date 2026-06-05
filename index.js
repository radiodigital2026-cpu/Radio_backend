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

// STREAM RADIO (CON REDIRECCIONES Y PROTECCIÓN DE ERRORES)
app.get("/radio/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const radio = radiosData.find(r => r.id === id);

    if (!radio || !radio.url) {
        return res.status(404).json({ error: "Radio no encontrada o sin URL válida" });
    }

    let proxyReq = null;

    // Función interna para manejar la conexión (soporta redirecciones)
    const connectToStream = (streamUrl) => {
        const client = streamUrl.startsWith("https") ? https : http;

        proxyReq = client.get(streamUrl, (stream) => {
            // 1. Manejo de Redirecciones (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(stream.statusCode) && stream.headers.location) {
                console.log(`Redirigiendo radio ID ${id} hacia: ${stream.headers.location}`);
                return connectToStream(stream.headers.location); // Llamada recursiva
            }

            // 2. Si el origen responde con error HTTP (ej. 404 o 500)
            if (stream.statusCode >= 400) {
                if (!res.headersSent) {
                    return res.status(stream.statusCode).json({ error: "La emisora origen devolvió un error" });
                }
            }

            const contentType = stream.headers["content-type"] || "audio/mpeg";

            res.writeHead(200, {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Connection": "keep-alive",
                "Transfer-Encoding": "chunked"
            });

            // Capturar errores en pleno streaming (durante la transmisión)
            stream.on("error", (streamErr) => {
                console.error(`Error en el flujo de datos de radio ID ${id}:`, streamErr.message);
                res.end(); // Cierra la conexión de forma segura con el cliente
            });

            stream.pipe(res);
        });

        // Error al conectar inicialmente
        proxyReq.on("error", (err) => {
            console.error(`Error de conexión inicial en radio ID ${id}:`, err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: "Error conectando con la emisora origen" });
            }
        });
    };

    // Iniciar la conexión por primera vez
    connectToStream(radio.url);

    // Si el oyente cierra la app o web
    req.on("close", () => {
        console.log(`Cliente desconectado de la radio ID ${id}.`);
        if (proxyReq) proxyReq.destroy(); 
    });
});

app.listen(PORT, () => {
    console.log(`Servidor online puerto ${PORT}`);
});

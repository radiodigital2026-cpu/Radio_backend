const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

// ARRAY DIRECTO
let radiosData = [];

try {
    const jsonPath = path.join(__dirname, "radio.json");
    const raw = fs.readFileSync(jsonPath, "utf8");
    radiosData = JSON.parse(raw);
    console.log("JSON cargado correctamente");
} catch (err) {
    console.error("Error leyendo radio.json");
    console.error(err);
}

// ======================================
// ROOT
// ======================================
app.get("/", (req, res) => {
    res.json({
        status: "online"
    });
});

// ======================================
// LISTA RADIOS
// ======================================
app.get("/radio", (req, res) => {
    res.json(radiosData);
});

// ======================================
// STREAM RADIO (OPTIMIZADO)
// ======================================
app.get("/radio/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const radio = radiosData.find(r => r.id === id);

    if (!radio || !radio.url) {
        return res.status(404).json({
            error: "Radio no encontrada o sin URL válida"
        });
    }

    const streamUrl = radio.url;
    const client = streamUrl.startsWith("https") ? https : http;

    // Guardamos la petición externa en una variable para poder controlarla
    const proxyReq = client.get(streamUrl, (stream) => {
        // Obtenemos el tipo de contenido original o forzamos audio/mpeg
        const contentType = stream.headers["content-type"] || "audio/mpeg";

        res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked"
        });

        // Transmitimos el audio directamente al usuario
        stream.pipe(res);
    });

    // CONTROL DE ERRORES: Si la emisora original falla o se cae
    proxyReq.on("error", (err) => {
        console.error(`Error en streaming de radio ID ${id}:`, err.message);
        
        // Solo respondemos error si no hemos enviado los encabezados de audio aún
        if (!res.headersSent) {
            res.status(500).json({
                error: "Error conectando con la emisora origen"
            });
        }
    });

    // OPTIMIZACIÓN CLAVE: Si el oyente cierra el reproductor, la web o la app
    req.on("close", () => {
        console.log(`Cliente desconectado de la radio ID ${id}. Cerrando conexión origen.`);
        proxyReq.destroy(); // Corta la descarga de datos desde la emisora
    });
});

app.listen(PORT, () => {
    console.log(`Servidor online puerto ${PORT}`);
});

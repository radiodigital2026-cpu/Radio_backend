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

    const jsonPath =
        path.join(__dirname, "radios.json");

    const raw =
        fs.readFileSync(jsonPath, "utf8");

    radiosData = JSON.parse(raw);

    console.log("JSON cargado correctamente");

} catch (err) {

    console.error("Error leyendo radios.json");

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
app.get("/radios", (req, res) => {

    res.json(radiosData);

});

// ======================================
// STREAM RADIO
// ======================================
app.get("/radio/:id", (req, res) => {

    const id =
        parseInt(req.params.id);

    const radio =
        radiosData.find(r => r.id === id);

    if (!radio) {

        return res.status(404).json({
            error: "Radio no encontrada"
        });
    }

    const streamUrl = radio.url;

    const client =
        streamUrl.startsWith("https")
            ? https
            : http;

    client.get(streamUrl, (stream) => {

        res.writeHead(200, {
            "Content-Type":
                stream.headers["content-type"]
                || "audio/mpeg",

            "Access-Control-Allow-Origin": "*"
        });

        stream.pipe(res);

    }).on("error", (err) => {

        console.error(err);

        res.status(500).json({
            error: "Error conectando stream"
        });

    });

});

app.listen(PORT, () => {

    console.log(
        `Servidor online puerto ${PORT}`
    );

});

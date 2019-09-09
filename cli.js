#!/usr/bin/env node

// --- libraries
const express = require("express");
const https = require("https");
const fs = require("fs");
const httpsLocalhost = require("https-localhost")();
const cors = require("cors");
const chalk = require("chalk");
const chokidar = require("chokidar");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));
const pjson = require("./package.json");

let io;
let clientSocket;
let filesWatcher;

const deploy = async () => {
  // --- setup server
  const port = argv && argv.p ? argv.p : 23001;
  const corsOptions = { credentials: true, origin: "https://playcanvas.com" };

  const certs = await httpsLocalhost.getCerts();
  const app = express();

  app.use(cors(corsOptions));
  app.get("/", (req, res) => res.send("..."));

  const server = https.createServer(certs, app).listen(port);

  log("", true);
  console.log(chalk.blue.underline.bold("Poseidon Remote Coding"));
  log("", true);
  log(`server available on port ${port}...`);

  // --- setup socket io
  io = require("socket.io").listen(server);

  io.on("connection", function(socket) {
    log(`client connected with id: ${socket.id}`, false, "green");

    clientSocket = socket;

    // --- files watching
    log("watch started...");
    startWatchingFiles();
  });
  io.on("disconnect", function(socket) {
    log(`client disconnected with id: ${socket.id}`, false, "red");
  });

  log("", true);
  log("[INFO] Development server running!", true, "yellow");
  log("", true);
  log("       Use Ctrl+C to quit this process", true, "green");
};

// --- execution
if (argv && argv.v) {
  console.log(`v${pjson.version}`);
  process.exit();
}

deploy();

// --- Utility functions
function log(message, omitTime, color) {
  const d = new Date();
  const time = d.toTimeString().split(" ")[0];

  const output = omitTime ? message : `[pic-serve] [${time}]   ${message}`;
  const colouredMessage = color ? chalk[color](output) : output;

  console.log(colouredMessage);
}

function startWatchingFiles() {
  if (filesWatcher) {
    filesWatcher.close();
  }

  filesWatcher = chokidar
    .watch(".", { ignored: /(^|[\/\\])\../ })
    .on("all", (event, fullPath) => {
      switch (event) {
        case "add":
          uploadFile(fullPath);
          break;
        case "change":
          uploadFile(fullPath);
          break;
        case "unlink":
          removeFile(fullPath);
          break;
        case "unlinkDir":
          removeFolder(fullPath);
          break;
      }
    });
}

function isExtensionAllowed(fullPath) {
  return path.extname(fullPath) === ".js";
}

function getPromiseID(fullPath, type) {
  return `${Date.now()}_${fullPath}_${type}`;
}

function uploadFile(fullPath) {
  if (isExtensionAllowed(fullPath) === false) return;

  let path = fullPath.replace(/\\/g, "/");
  path = path.split("/");

  const filename = path.pop();
  path = path.join("/");

  fs.readFile(fullPath, "utf8", function(err, contents) {
    if (!contents || contents === "") return false;

    log(`file ${filename} was edited, uploading changes...`, false);

    const id = getPromiseID(fullPath, "updated");

    clientSocket.once(`file:${id}`, function(data) {
      log(`${filename} was successfully uploaded.`, false, "green");
    });

    io.emit("file:updated", {
      id: id,
      path: path,
      filename: filename,
      contents: contents
    });
  });
}

function removeFile(fullPath) {
  if (isExtensionAllowed(fullPath) === false) return;

  let path = fullPath.replace(/\\/g, "/");
  path = path.split("/");

  const filename = path.pop();
  path = path.join("/");

  log(`file ${filename} was removed, uploading changes...`, false);

  const id = getPromiseID(fullPath, "removed");

  clientSocket.once(`file:${id}`, function() {
    log(`${filename} was deleted.`, false, "red");
  });

  io.emit("file:removed", {
    id: id,
    path: path,
    filename: filename
  });
}

function removeFolder(fullPath) {
  const path = fullPath.replace(/\\/g, "/");

  log(`path ${path} was removed, uploading changes...`, false);

  const id = getPromiseID(fullPath, "removed");

  clientSocket.once(`file:${id}`, function() {
    log(`${path} was deleted.`, false, "red");
  });

  io.emit("folder:removed", {
    id: id,
    path: path
  });
}

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
const mmm = require("mmmagic"),
  Magic = mmm.Magic;

let io;
let clientSocket;
let filesWatcher;

const magic = new Magic(mmm.MAGIC_MIME_TYPE);

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

  io.on("connection", function (socket) {
    log(`client connected with id: ${socket.id}`, false, "green");

    clientSocket = socket;

    // --- files watching
    log("watch started...");
    startWatchingFiles();

    // --- send settings to extension
    if (argv && argv.r) {
      io.emit("settings:reloadOnChange", {
        windowPath: argv.r,
        state: true,
      });
    }
  });
  io.on("disconnect", function (socket) {
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

const actionEventTypes = ["add", "change", "unlink", "unlinkDir"];
const actions = [];
let executing = false;

async function executeActions() {
  executing = true;
  const action = actions.shift();

  switch (action.event) {
    case "add":
      await uploadFile(action.fullPath);
      break;
    case "change":
      await uploadFile(action.fullPath);
      break;
    case "unlink":
      await removeFile(action.fullPath);
      break;
    case "unlinkDir":
      await removeFolder(action.fullPath);
      break;
  }

  if (actions.length > 0) {
    executeActions();
  } else {
    executing = false;
  }
}

function startWatchingFiles() {
  if (filesWatcher) {
    filesWatcher.close();
  }

  filesWatcher = chokidar
    .watch(".", { ignored: /(^|[\/\\])\../, usePolling: true })
    .on("all", async (event, fullPath) => {
      if (actionEventTypes.indexOf(event) === -1) return;

      actions.push({
        event: event,
        fullPath: fullPath,
      });

      if (executing === false) executeActions();
    });
}

function isExtensionAllowed(fullPath) {
  const allowed = [".js", ".json", ".glsl", ".txt", ".html", ".css"];
  return allowed.indexOf(path.extname(fullPath)) > -1;
}

function getExtensionType(fullPath) {
  const extension = path.extname(fullPath);
  const type = {
    ".js": "script",
    ".json": "json",
    ".glsl": "shader",
    ".txt": "text",
    ".html": "html",
    ".css": "css",
  };

  return type[extension];
}

function getPromiseID(fullPath, type) {
  return `${Date.now()}_${fullPath}_${type}`;
}

function uploadFile(fullPath) {
  return new Promise((resolve) => {
    if (isExtensionAllowed(fullPath) === false) {
      resolve();
      return;
    }

    let path = fullPath.replace(/\\/g, "/");
    path = path.split("/");

    const filename = path.pop();
    path = path.join("/");

    fs.readFile(fullPath, function (err, contents) {
      if (!contents || contents === "") {
        resolve();
        return;
      }

      const type = getExtensionType(fullPath);

      if (!type) {
        resolve();
        return;
      }

      log(`file ${filename} was edited, uploading changes...`, false);

      const id = getPromiseID(fullPath, "updated");

      magic.detectFile(fullPath, function (err, mimetype) {
        if (err) throw err;

        clientSocket.once(`file:${id}`, function (data) {
          resolve();

          log(`${filename} was successfully uploaded.`, false, "green");
        });

        io.emit("file:updated", {
          id: id,
          path: path,
          filename: filename,
          type: type,
          mimetype: mimetype,
          contents: contents,
        });
      });
    });
  });
}

function removeFile(fullPath) {
  return new Promise((resolve) => {
    if (isExtensionAllowed(fullPath) === false) {
      resolve();
      return;
    }

    let path = fullPath.replace(/\\/g, "/");
    path = path.split("/");

    const filename = path.pop();
    path = path.join("/");

    log(`file ${filename} was removed, uploading changes...`, false);

    const id = getPromiseID(fullPath, "removed");
    const type = getExtensionType(fullPath);

    if (!type) {
      resolve();
      return;
    }

    clientSocket.once(`file:${id}`, function () {
      resolve();

      log(`${filename} was deleted.`, false, "red");
    });

    io.emit("file:removed", {
      id: id,
      path: path,
      filename: filename,
      type: type,
    });
  });
}

function removeFolder(fullPath) {
  return new Promise((resolve) => {
    const path = fullPath.replace(/\\/g, "/");

    log(`path ${path} was removed, uploading changes...`, false);

    const id = getPromiseID(fullPath, "removed");

    clientSocket.once(`file:${id}`, function () {
      resolve();

      log(`${path} was deleted.`, false, "red");
    });

    io.emit("folder:removed", {
      id: id,
      path: path,
    });
  });
}

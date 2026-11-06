import { readdir, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("node_modules/stockfish/bin");
const target = path.resolve("public/engine");
await mkdir(target, { recursive: true });
const entries = await readdir(source);
const jsFiles = entries.filter((name) => name.endsWith(".js"));
const wasmFiles = entries.filter((name) => name.endsWith(".wasm"));
const preferred = jsFiles.find((name) => /lite-single/i.test(name)) || jsFiles.find((name) => /lite/i.test(name)) || jsFiles[0];
if (!preferred) throw new Error("Stockfish-Datei wurde im npm-Paket nicht gefunden.");
for (const name of [...jsFiles, ...wasmFiles]) {
  await copyFile(path.join(source, name), path.join(target, name));
}
await writeFile(path.join(target, "engine-path.json"), JSON.stringify({ file: preferred }));
console.log("Stockfish bereit:", preferred);
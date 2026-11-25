/**
 * Dados Tricolor — Build leve de produção para GitHub Pages (`scripts/build.mjs`)
 *
 * Responsabilidades:
 * 1. Copiar os arquivos estáticos de `docs/` para `dist/` (preservando `data/`,
 *    `assets/`, `CNAME`, `robots.txt`, `sitemap.xml`, `og-image.png`).
 * 2. Minificar `docs/css/style.css` e empacotar/minificar `docs/js/main.js`
 *    (ES Modules + tree-shaking) via `esbuild`.
 * 3. Aplicar cache-busting automático via hash SHA-256 no nome dos arquivos
 *    (`css/style.<hash>.min.css` e `js/main.<hash>.min.js`) e reescrever as
 *    referências em `dist/index.html`.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT_DIR, "docs");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const CSS_ENTRY = path.join(DOCS_DIR, "css", "style.css");
const JS_ENTRY = path.join(DOCS_DIR, "js", "main.js");
const HTML_ENTRY = path.join(DOCS_DIR, "index.html");

function contentHash(buffer, length = 10) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, length);
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatReduction(originalBytes, finalBytes) {
  if (originalBytes <= 0) return "0.0%";
  const pct = ((originalBytes - finalBytes) / originalBytes) * 100;
  return `-${pct.toFixed(1)}%`;
}

async function sumDirectoryBytes(dirPath, extension) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await sumDirectoryBytes(fullPath, extension);
    } else if (entry.isFile() && (!extension || entry.name.endsWith(extension))) {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}

async function copyStaticDocs(srcDir, dstDir) {
  await fs.mkdir(dstDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    const relPath = path.relative(DOCS_DIR, srcPath).split(path.sep).join("/");

    // CSS/JS originais e index.html são gerados otimizados no passo de build
    if (
      relPath === "index.html" ||
      relPath === "css/style.css" ||
      relPath === "js" ||
      relPath.startsWith("js/")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyStaticDocs(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

export async function runBuild() {
  // 1. Limpar dist/ e copiar arquivos estáticos
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await copyStaticDocs(DOCS_DIR, DIST_DIR);

  // 2. Medir tamanhos originais
  const rawCssBytes = (await fs.stat(CSS_ENTRY)).size;
  const rawJsBytes = await sumDirectoryBytes(path.join(DOCS_DIR, "js"), ".js");

  // 3. Minificar CSS via esbuild
  const cssResult = await build({
    entryPoints: [CSS_ENTRY],
    bundle: false,
    minify: true,
    charset: "utf8",
    legalComments: "none",
    write: false,
  });

  if (!cssResult.outputFiles || cssResult.outputFiles.length !== 1) {
    throw new Error("esbuild não gerou exatamente 1 arquivo CSS minificado.");
  }
  const cssBuffer = Buffer.from(cssResult.outputFiles[0].contents);
  const cssHash = contentHash(cssBuffer);
  const cssFileName = `style.${cssHash}.min.css`;
  const cssRelRef = `css/${cssFileName}`;
  await fs.mkdir(path.join(DIST_DIR, "css"), { recursive: true });
  await fs.writeFile(path.join(DIST_DIR, "css", cssFileName), cssBuffer);

  // 4. Empacotar (ES Modules) + minificar JS via esbuild
  const jsResult = await build({
    entryPoints: [JS_ENTRY],
    bundle: true,
    format: "esm",
    minify: true,
    target: ["es2020"],
    charset: "utf8",
    legalComments: "none",
    write: false,
  });

  if (!jsResult.outputFiles || jsResult.outputFiles.length !== 1) {
    throw new Error("esbuild não gerou exatamente 1 bundle JS minificado.");
  }
  const jsBuffer = Buffer.from(jsResult.outputFiles[0].contents);
  const jsHash = contentHash(jsBuffer);
  const jsFileName = `main.${jsHash}.min.js`;
  const jsRelRef = `js/${jsFileName}`;
  await fs.mkdir(path.join(DIST_DIR, "js"), { recursive: true });
  await fs.writeFile(path.join(DIST_DIR, "js", jsFileName), jsBuffer);

  // 5. Reescrever referências de CSS e JS em dist/index.html com cache-busting
  const rawHtml = await fs.readFile(HTML_ENTRY, "utf-8");
  const cssHrefRegex = /(<link\b[^>]*\bhref=["'])css\/style\.css(?:\?[^"']*)?(["'][^>]*>)/;
  const jsSrcRegex = /(<script\b[^>]*\bsrc=["'])js\/main\.js(?:\?[^"']*)?(["'][^>]*>)/;

  if (!cssHrefRegex.test(rawHtml)) {
    throw new Error("Referência 'css/style.css' não encontrada em docs/index.html.");
  }
  if (!jsSrcRegex.test(rawHtml)) {
    throw new Error("Referência 'js/main.js' não encontrada em docs/index.html.");
  }

  const builtHtml = rawHtml
    .replace(cssHrefRegex, (_, pre, post) => `${pre}${cssRelRef}${post}`)
    .replace(jsSrcRegex, (_, pre, post) => `${pre}${jsRelRef}${post}`);

  if (builtHtml.includes('href="css/style.css"') || builtHtml.includes('src="js/main.js"')) {
    throw new Error("Falha ao substituir referências não-versionadas em dist/index.html.");
  }

  await fs.writeFile(path.join(DIST_DIR, "index.html"), builtHtml, "utf-8");

  // 6. Validação de sanidade dos arquivos obrigatórios do artefato final
  const requiredOutputs = [
    "index.html",
    "CNAME",
    "robots.txt",
    "sitemap.xml",
    "data/spfc_pontos_corridos.json",
    "data/meta.json",
    cssRelRef,
    jsRelRef,
  ];
  for (const rel of requiredOutputs) {
    const stat = await fs.stat(path.join(DIST_DIR, rel));
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Artefato obrigatório ausente ou vazio em dist/: ${rel}`);
    }
  }

  const cssGzipBytes = zlib.gzipSync(cssBuffer).length;
  const jsGzipBytes = zlib.gzipSync(jsBuffer).length;

  console.log("=".repeat(64));
  console.log("DADOS TRICOLOR — BUILD DE PRODUÇÃO CONCLUÍDO (esbuild)");
  console.log("=".repeat(64));
  console.log(
    `CSS: ${formatKB(rawCssBytes)} -> ${formatKB(cssBuffer.length)} (${formatReduction(rawCssBytes, cssBuffer.length)}) | gzip: ${formatKB(cssGzipBytes)} | ${cssRelRef}`
  );
  console.log(
    `JS:  ${formatKB(rawJsBytes)} -> ${formatKB(jsBuffer.length)} (${formatReduction(rawJsBytes, jsBuffer.length)}) | gzip: ${formatKB(jsGzipBytes)} | ${jsRelRef}`
  );
  console.log(
    `Total ativos: ${formatKB(rawCssBytes + rawJsBytes)} -> ${formatKB(cssBuffer.length + jsBuffer.length)} (${formatReduction(rawCssBytes + rawJsBytes, cssBuffer.length + jsBuffer.length)})`
  );
  console.log(`Saída pronta para GitHub Pages: ${DIST_DIR}`);
  console.log("=".repeat(64));

  return {
    cssRelRef,
    jsRelRef,
    rawCssBytes,
    minCssBytes: cssBuffer.length,
    rawJsBytes,
    minJsBytes: jsBuffer.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBuild().catch((err) => {
    console.error("[BUILD ERROR]", err);
    process.exitCode = 1;
  });
}

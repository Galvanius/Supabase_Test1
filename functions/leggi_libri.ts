import * as fs from "fs";
import * as path from "path";
import pdf from "pdf-parse";

type PdfInfo = {
  path: string;
  name: string;
  size: number;
  text: string;
};

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const data = await fs.promises.readFile(filePath);
    const result = await pdf(data);
    return result.text || "";
  } catch {
    return "";
  }
}

async function listPdfsRecursive(baseDir: string): Promise<PdfInfo[]> {
  const pdfs: PdfInfo[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        try {
          const stat = await fs.promises.stat(fullPath);
          const text = await extractPdfText(fullPath);
          pdfs.push({
            path: fullPath,
            name: entry.name,
            size: stat.size,
            text,
          });
        } catch {
          // ignore individual file errors
        }
      }
    }
  }

  await walk(baseDir);
  return pdfs;
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = dp[m][n];
  const maxLen = Math.max(m, n);
  return 1 - distance / maxLen;
}

function sizeSimilarity(sizeA: number, sizeB: number): number {
  if (sizeA === 0 || sizeB === 0) return 0;
  return Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB);
}

function textSimilarity(textA: string, textB: string, maxLen = 5000): number {
  const ta = textA.slice(0, maxLen);
  const tb = textB.slice(0, maxLen);
  if (!ta || !tb) return 0;
  return stringSimilarity(ta, tb);
}

function pdfSimilarity(
  a: PdfInfo,
  b: PdfInfo,
  wName = 0.3,
  wSize = 0.2,
  wText = 0.5,
): number {
  const nameSim = stringSimilarity(a.name.toLowerCase(), b.name.toLowerCase());
  const sizeSim = sizeSimilarity(a.size, b.size);
  const textSim = textSimilarity(a.text, b.text);
  return wName * nameSim + wSize * sizeSim + wText * textSim;
}

/**
 * Prende in ingresso due path di folder.
 * Restituisce una stringa:
 *
 * <pdf_A_1>
 * <pdf_B_simile_1>
 * ----------------
 * <pdf_A_2>
 * <pdf_B_simile_2>
 * ----------------
 * ...
 */
export async function leggi_libri(
  firstFolder: string,
  secondFolder: string,
  similarityThreshold = 0.7,
): Promise<string> {
  const pdfsA = await listPdfsRecursive(firstFolder);
  const pdfsB = await listPdfsRecursive(secondFolder);

  const lines: string[] = [];

  for (const pdfA of pdfsA) {
    let bestScore = 0;
    let bestB: PdfInfo | null = null;

    for (const pdfB of pdfsB) {
      const score = pdfSimilarity(pdfA, pdfB);
      if (score > bestScore) {
        bestScore = score;
        bestB = pdfB;
      }
    }

    if (bestB && bestScore >= similarityThreshold) {
      lines.push(pdfA.path);
      lines.push(bestB.path);
      lines.push("----------------");
    }
  }

  return lines.join("\n");
}

if (require.main === module) {
  (async () => {
    const firstFolder = process.argv[2];
    const secondFolder = process.argv[3];

    if (!firstFolder || !secondFolder) {
      console.error(
        "Uso: node leggi_libri.js <prima_cartella_pdf> <seconda_cartella_pdf>",
      );
      process.exit(1);
    }

    try {
      const output = await leggi_libri(firstFolder, secondFolder);
      console.log(output);
    } catch (err) {
      console.error("Errore durante l'esecuzione di leggi_libri:", err);
      process.exit(1);
    }
  })();
}


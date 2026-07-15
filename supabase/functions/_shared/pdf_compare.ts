import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy } from "unpdf";

export const BUCKET = "repository";
export const TEXT_PAGE_MIN_CHARS = 40;
export const SCANNED_DOC_MAX_CHARS = 200;
export const DEFAULT_MAX_SAMPLES = 16;
/** Salta coppie con rapporto dimensioni troppo diverso (es. 110 MB vs 11 MB). */
export const MIN_SIZE_RATIO_PREFILTER = 0.45;

export type PageUnit = {
  pageIndex: number;
  text: string;
  fingerprint: string;
};

export type PdfProfile = {
  storagePath: string;
  fileSize: number;
  fileHash: string;
  pageCount: number;
  pages: PageUnit[];
  totalTextLength: number;
  likelyScanned: boolean;
};

export type MatchDetail = {
  pathA: string;
  pathB: string;
  score: number;
  nameScore: number;
  sizeScore: number;
  pageScore: number;
  contentScore: number;
  layout: string;
};

export type SupabaseClient = ReturnType<typeof createClient>;

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
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

  return 1 - dp[m][n] / Math.max(m, n);
}

function sizeSimilarity(sizeA: number, sizeB: number): number {
  if (sizeA === 0 || sizeB === 0) return 0;
  return Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeText(text);
  if (!normalized) return new Set();
  return new Set(
    normalized.split(" ").filter((word) => word.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function shaHex(data: Uint8Array, length = 64): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return length > 0 ? hex.slice(0, length) : hex;
}

async function byteChunkFingerprint(
  bytes: Uint8Array,
  pageCount: number,
  pageIndex: number,
): Promise<string> {
  const start = Math.floor((bytes.length * pageIndex) / pageCount);
  const end = Math.floor((bytes.length * (pageIndex + 1)) / pageCount);
  const safeEnd = Math.max(end, start + 1);
  return shaHex(bytes.slice(start, Math.min(safeEnd, bytes.length)), 16);
}

function fingerprintSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  let matches = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / Math.max(a.length, b.length);
}

function pickSamplePageIndices(totalPages: number, maxSamples: number): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= maxSamples) {
    return Array.from({ length: totalPages }, (_, index) => index);
  }

  const indices = new Set<number>([0, 1, 2, totalPages - 2, totalPages - 1]);
  const remaining = maxSamples - indices.size;
  const step = (totalPages - 1) / (remaining + 1);

  for (let i = 1; i <= remaining; i++) {
    indices.add(Math.min(totalPages - 1, Math.round(step * i)));
  }

  return Array.from(indices).sort((a, b) => a - b);
}

async function extractSamplePageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageIndex: number,
): Promise<string> {
  const page = await pdf.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str?: string }>;
  return normalizeText(items.map((item) => item.str ?? "").join(" "));
}

async function buildPdfProfile(
  storagePath: string,
  bytes: Uint8Array,
  maxSamples: number,
): Promise<PdfProfile> {
  const pdf = await getDocumentProxy(bytes);
  const totalPages = pdf.numPages;
  const sampleIndices = pickSamplePageIndices(totalPages, maxSamples);
  const fileHash = await shaHex(bytes, 0);
  const pages: PageUnit[] = [];

  for (const pageIndex of sampleIndices) {
    const pageText = await extractSamplePageText(pdf, pageIndex);
    const fingerprint = pageText.length >= TEXT_PAGE_MIN_CHARS
      ? await shaHex(new TextEncoder().encode(pageText), 16)
      : await byteChunkFingerprint(bytes, totalPages, pageIndex);

    pages.push({ pageIndex, text: pageText, fingerprint });
  }

  const totalTextLength = pages.reduce((sum, page) => sum + page.text.length, 0);

  return {
    storagePath,
    fileSize: bytes.byteLength,
    fileHash,
    pageCount: totalPages,
    pages,
    totalTextLength,
    likelyScanned: totalTextLength < SCANNED_DOC_MAX_CHARS,
  };
}

function pageCountSimilarity(
  pagesA: number,
  pagesB: number,
  mergeA: number,
  mergeB: number,
): number {
  const logicalA = Math.ceil(pagesA / mergeA);
  const logicalB = Math.ceil(pagesB / mergeB);
  if (logicalA === 0 || logicalB === 0) return 0;
  return Math.min(logicalA, logicalB) / Math.max(logicalA, logicalB);
}

function comparePagePair(pageA: PageUnit, pageB: PageUnit): number {
  if (pageA.text.length >= TEXT_PAGE_MIN_CHARS &&
    pageB.text.length >= TEXT_PAGE_MIN_CHARS) {
    return jaccardSimilarity(tokenize(pageA.text), tokenize(pageB.text));
  }

  if (pageA.text.length >= TEXT_PAGE_MIN_CHARS ||
    pageB.text.length >= TEXT_PAGE_MIN_CHARS) {
    const longText = pageA.text.length >= pageB.text.length ? pageA.text : pageB.text;
    const shortText = pageA.text.length >= pageB.text.length ? pageB.text : pageA.text;
    const shortTokens = tokenize(shortText);
    if (shortTokens.size === 0) {
      return fingerprintSimilarity(pageA.fingerprint, pageB.fingerprint) * 0.6;
    }
    return jaccardSimilarity(tokenize(longText), shortTokens) * 0.85;
  }

  return fingerprintSimilarity(pageA.fingerprint, pageB.fingerprint);
}

function compareSampleSequences(seqA: PageUnit[], seqB: PageUnit[]): number {
  if (seqA.length === 0 || seqB.length === 0) return 0;

  const compared = Math.min(seqA.length, seqB.length);
  let sum = 0;
  for (let i = 0; i < compared; i++) {
    sum += comparePagePair(seqA[i], seqB[i]);
  }

  const avg = sum / compared;
  const lengthPenalty = 1 - Math.abs(seqA.length - seqB.length) /
    Math.max(seqA.length, seqB.length);
  return avg * 0.85 + lengthPenalty * 0.15;
}

function compareProfiles(profileA: PdfProfile, profileB: PdfProfile): {
  contentScore: number;
  pageScore: number;
  layout: string;
} {
  if (profileA.fileHash === profileB.fileHash) {
    return { contentScore: 1, pageScore: 1, layout: "hash" };
  }

  const modes = [
    { label: "1:1", mergeA: 1, mergeB: 1 },
    { label: "A1-B2", mergeA: 1, mergeB: 2 },
    { label: "A2-B1", mergeA: 2, mergeB: 1 },
  ];

  let bestContent = 0;
  let bestPage = 0;
  let bestLayout = "1:1";

  for (const mode of modes) {
    const pageScore = pageCountSimilarity(
      profileA.pageCount,
      profileB.pageCount,
      mode.mergeA,
      mode.mergeB,
    );
    const contentScore = compareSampleSequences(profileA.pages, profileB.pages);
    const combined = contentScore * 0.8 + pageScore * 0.2;

    if (combined > bestContent) {
      bestContent = combined;
      bestPage = pageScore;
      bestLayout = mode.label;
    }
  }

  if (!profileA.likelyScanned && !profileB.likelyScanned) {
    const fullTextA = normalizeText(profileA.pages.map((page) => page.text).join(" "));
    const fullTextB = normalizeText(profileB.pages.map((page) => page.text).join(" "));
    const fullTextScore = jaccardSimilarity(tokenize(fullTextA), tokenize(fullTextB));
    bestContent = Math.max(bestContent, fullTextScore * 0.9 + bestPage * 0.1);
  }

  return {
    contentScore: bestContent,
    pageScore: bestPage,
    layout: bestLayout,
  };
}

/** Oltre questa soglia si usa hash streaming + campioni a chunk (no unpdf). */
const LARGE_PDF_BYTES = 20 * 1024 * 1024;
const CHUNK_SAMPLE_BYTES = 128 * 1024;

type StorageItem = {
  name: string;
  id?: string | null;
  metadata?: { size?: number } | null;
};

async function getPdfFileSize(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<number> {
  const lastSlash = storagePath.lastIndexOf("/");
  const folder = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;

  const { data, error } = await supabase.storage.from(BUCKET).list(folder, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    throw new Error(`Size lookup failed for ${storagePath}: ${error.message}`);
  }

  const item = ((data ?? []) as StorageItem[]).find((entry) => entry.name === fileName);
  const size = item?.metadata?.size;
  if (size == null || size <= 0) {
    throw new Error(`Size not found for ${storagePath}`);
  }

  return size;
}

async function getSignedDownloadUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(
    storagePath,
    3600,
  );

  if (error || !data?.signedUrl) {
    throw new Error(
      `Signed URL failed for ${storagePath}: ${error?.message ?? "no url"}`,
    );
  }

  return data.signedUrl;
}

/** Hash SHA-256 in streaming (solo PDF piccoli). */
async function streamSha256Hex(
  url: string,
): Promise<{ hash: string; size: number }> {
  const { createHash } = await import("node:crypto");
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Stream download failed: ${response.status}`);
  }

  const hash = createHash("sha256");
  let size = 0;
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    size += value.length;
  }

  return { hash: hash.digest("hex"), size };
}

async function downloadByteRange(
  url: string,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const end = start + length - 1;
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });

  if (!response.ok) {
    throw new Error(`Range download failed: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function buildChunkProfile(
  storagePath: string,
  signedUrl: string,
  fileSize: number,
  maxSamples: number,
): Promise<PdfProfile> {
  const sampleCount = Math.min(maxSamples, Math.max(4, 6));
  const pages: PageUnit[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((fileSize * i) / sampleCount);
    const length = Math.max(
      1,
      Math.min(CHUNK_SAMPLE_BYTES, fileSize - start),
    );
    const chunk = await downloadByteRange(signedUrl, start, length);
    const fingerprint = await shaHex(chunk, 16);
    pages.push({ pageIndex: i, text: "", fingerprint });
  }

  const fingerprintSlice = pages.slice(0, Math.min(3, pages.length))
    .map((page) => page.fingerprint)
    .join("|");
  const fileHash = await shaHex(
    new TextEncoder().encode(`${fileSize}|${fingerprintSlice}`),
    0,
  );

  const estimatedPages = Math.max(1, Math.round(fileSize / 120_000));

  return {
    storagePath,
    fileSize,
    fileHash,
    pageCount: estimatedPages,
    pages,
    totalTextLength: 0,
    likelyScanned: true,
  };
}

async function downloadPdf(
  supabase: SupabaseClient,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Download failed for ${path}: ${error?.message ?? "no data"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Scarica e analizza un PDF piccolo in memoria (unpdf). */
async function loadPdfProfile(
  supabase: SupabaseClient,
  storagePath: string,
  maxSamples: number,
): Promise<PdfProfile> {
  const bytes = await downloadPdf(supabase, storagePath);
  return buildPdfProfile(storagePath, bytes, maxSamples);
}

async function resolvePdfProfile(
  supabase: SupabaseClient,
  storagePath: string,
  maxSamples: number,
  fileSize: number,
  signedUrl: string,
): Promise<PdfProfile> {
  if (fileSize > LARGE_PDF_BYTES) {
    return buildChunkProfile(
      storagePath,
      signedUrl,
      fileSize,
      maxSamples,
    );
  }

  return loadPdfProfile(supabase, storagePath, maxSamples);
}

function effectiveSampleCount(maxSamples: number, fileSize: number): number {
  if (fileSize > LARGE_PDF_BYTES) {
    return Math.min(maxSamples, Math.max(4, 6));
  }
  return maxSamples;
}

type PdfProfileRow = {
  storage_path: string;
  file_size: number;
  file_hash: string;
  page_count: number;
  likely_scanned: boolean;
  total_text_length: number;
  sample_count: number;
  samples: PageUnit[];
};

function profileFromRow(row: PdfProfileRow): PdfProfile {
  return {
    storagePath: row.storage_path,
    fileSize: Number(row.file_size),
    fileHash: row.file_hash,
    pageCount: row.page_count,
    pages: row.samples ?? [],
    totalTextLength: row.total_text_length,
    likelyScanned: row.likely_scanned,
  };
}

async function loadCachedProfile(
  supabase: SupabaseClient,
  storagePath: string,
  maxSamples: number,
  fileSize: number,
): Promise<PdfProfile | null> {
  const expectedSamples = effectiveSampleCount(maxSamples, fileSize);
  const { data, error } = await supabase
    .from("pdf_profiles")
    .select(
      "storage_path, file_size, file_hash, page_count, likely_scanned, total_text_length, sample_count, samples",
    )
    .eq("storage_path", storagePath)
    .maybeSingle();

  if (error) {
    console.error("pdf_profiles read error:", error);
    return null;
  }

  if (!data || data.sample_count !== expectedSamples) {
    return null;
  }

  return profileFromRow(data as PdfProfileRow);
}

async function saveCachedProfile(
  supabase: SupabaseClient,
  profile: PdfProfile,
  maxSamples: number,
): Promise<void> {
  const { error } = await supabase.from("pdf_profiles").upsert(
    {
      storage_path: profile.storagePath,
      file_size: profile.fileSize,
      file_hash: profile.fileHash,
      page_count: profile.pageCount,
      likely_scanned: profile.likelyScanned,
      total_text_length: profile.totalTextLength,
      sample_count: effectiveSampleCount(maxSamples, profile.fileSize),
      samples: profile.pages,
    },
    { onConflict: "storage_path" },
  );

  if (error) {
    console.error("pdf_profiles write error:", error);
  }
}

/** Cache pigra: riusa profilo da DB se presente, altrimenti costruisce e salva. */
export async function getOrBuildProfile(
  supabase: SupabaseClient,
  storagePath: string,
  fileSize: number,
  maxSamples: number,
): Promise<PdfProfile> {
  const cached = await loadCachedProfile(
    supabase,
    storagePath,
    maxSamples,
    fileSize,
  );
  if (cached) return cached;

  const signedUrl = await getSignedDownloadUrl(supabase, storagePath);
  const profile = await resolvePdfProfile(
    supabase,
    storagePath,
    maxSamples,
    fileSize,
    signedUrl,
  );
  await saveCachedProfile(supabase, profile, maxSamples);
  return profile;
}

export async function cleanupPostgres(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from("pdf_profiles")
    .delete()
    .not("storage_path", "is", null);

  if (error) {
    console.error("pdf_profiles cleanup error:", error);
  }
}

export function formatMatch(match: MatchDetail): string {
  return [
    match.pathA,
    match.pathB,
    `score: ${match.score.toFixed(3)} (name: ${match.nameScore.toFixed(2)}, size: ${match.sizeScore.toFixed(2)}, pages: ${match.pageScore.toFixed(2)}, content: ${match.contentScore.toFixed(2)}, layout: ${match.layout})`,
    "----------------",
  ].join("\n");
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function hashMatchDetail(
  pathA: string,
  pathB: string,
  nameScore: number,
  sizeScore: number,
  threshold: number,
): MatchDetail | null {
  const score = 0.2 * (0.5 * nameScore + 0.5 * sizeScore) + 0.65 * 1 + 0.15 * 1;
  if (score < threshold) return null;
  return {
    pathA,
    pathB,
    score,
    nameScore,
    sizeScore,
    pageScore: 1,
    contentScore: 1,
    layout: "hash",
  };
}

export function matchPdfProfiles(
  profileA: PdfProfile,
  profileB: PdfProfile,
  pathA: string,
  pathB: string,
  threshold: number,
): MatchDetail | null {
  const nameScore = stringSimilarity(
    fileNameFromPath(pathA).toLowerCase(),
    fileNameFromPath(pathB).toLowerCase(),
  );
  const sizeScore = sizeSimilarity(profileA.fileSize, profileB.fileSize);

  if (profileA.fileHash === profileB.fileHash) {
    return hashMatchDetail(pathA, pathB, nameScore, sizeScore, threshold);
  }

  const basicScore = 0.5 * nameScore + 0.5 * sizeScore;
  const { contentScore, pageScore, layout } = compareProfiles(profileA, profileB);
  const score = basicScore * 0.2 + contentScore * 0.65 + pageScore * 0.15;

  if (score < threshold) return null;

  return {
    pathA,
    pathB,
    score,
    nameScore,
    sizeScore,
    pageScore,
    contentScore,
    layout,
  };
}

export async function buildProfileForPath(
  supabase: SupabaseClient,
  storagePath: string,
  fileSize: number,
  maxSamples: number,
): Promise<PdfProfile> {
  return getOrBuildProfile(supabase, storagePath, fileSize, maxSamples);
}

export async function compareTwoPdfs(
  supabase: SupabaseClient,
  pathA: string,
  pathB: string,
  threshold: number,
  maxSamples: number,
  knownSizeA?: number,
  knownSizeB?: number,
): Promise<MatchDetail | null> {
  const [sizeA, sizeB] = await Promise.all([
    knownSizeA != null && knownSizeA > 0
      ? Promise.resolve(knownSizeA)
      : getPdfFileSize(supabase, pathA),
    knownSizeB != null && knownSizeB > 0
      ? Promise.resolve(knownSizeB)
      : getPdfFileSize(supabase, pathB),
  ]);

  if (sizeSimilarity(sizeA, sizeB) < MIN_SIZE_RATIO_PREFILTER) {
    return null;
  }

  const bothSmall = sizeA <= LARGE_PDF_BYTES && sizeB <= LARGE_PDF_BYTES;
  if (bothSmall) {
    const [cachedA, cachedB] = await Promise.all([
      loadCachedProfile(supabase, pathA, maxSamples, sizeA),
      loadCachedProfile(supabase, pathB, maxSamples, sizeB),
    ]);

    let hashA = cachedA?.fileHash;
    let hashB = cachedB?.fileHash;

    if (!hashA || !hashB) {
      const signedUrlA = await getSignedDownloadUrl(supabase, pathA);
      const signedUrlB = await getSignedDownloadUrl(supabase, pathB);
      if (!hashA) hashA = (await streamSha256Hex(signedUrlA)).hash;
      if (!hashB) hashB = (await streamSha256Hex(signedUrlB)).hash;
    }

    if (hashA === hashB) {
      const nameScore = stringSimilarity(
        fileNameFromPath(pathA).toLowerCase(),
        fileNameFromPath(pathB).toLowerCase(),
      );
      return hashMatchDetail(
        pathA,
        pathB,
        nameScore,
        sizeSimilarity(sizeA, sizeB),
        threshold,
      );
    }
  }

  const profileA = await getOrBuildProfile(supabase, pathA, sizeA, maxSamples);
  const profileB = await getOrBuildProfile(supabase, pathB, sizeB, maxSamples);

  return matchPdfProfiles(profileA, profileB, pathA, pathB, threshold);
}

export type PdfInventoryItem = {
  path: string;
  size: number;
};

async function listPdfItemsRecursive(
  supabase: SupabaseClient,
  prefix: string,
): Promise<PdfInventoryItem[]> {
  const results: PdfInventoryItem[] = [];
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  const { data, error } = await supabase.storage.from(BUCKET).list(normalizedPrefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    throw new Error(`List failed for ${normalizedPrefix}: ${error.message}`);
  }

  for (const item of (data ?? []) as StorageItem[]) {
    const itemPath = normalizedPrefix
      ? `${normalizedPrefix}/${item.name}`
      : item.name;

    const isFolder = item.id == null && item.metadata == null;
    if (isFolder) {
      results.push(...await listPdfItemsRecursive(supabase, itemPath));
      continue;
    }

    if (item.name.toLowerCase().endsWith(".pdf")) {
      const size = item.metadata?.size ?? 0;
      results.push({ path: itemPath, size });
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listPdfsWithSize(
  supabase: SupabaseClient,
  prefix: string,
): Promise<PdfInventoryItem[]> {
  return listPdfItemsRecursive(supabase, prefix);
}

export async function listPdfsRecursive(
  supabase: SupabaseClient,
  prefix: string,
): Promise<string[]> {
  const items = await listPdfItemsRecursive(supabase, prefix);
  return items.map((item) => item.path);
}

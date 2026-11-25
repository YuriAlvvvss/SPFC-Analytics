/**
 * Dados Tricolor — Módulo de Dados (`data.js`)
 * Responsável por constantes de domínio, utilitários de formatação/normalização,
 * cache em memória e carregamento resiliente dos JSONs estáticos.
 */

export const DATA_URL = "data/spfc_pontos_corridos.json";
export const META_URL = "data/meta.json";
export const NEXT_MATCH_URL = "data/proximo_jogo.json";

export const CLASSICOS = new Set(["Corinthians", "Palmeiras", "Santos"]);
export const TITULOS_SPFC = new Set([2006, 2007, 2008]);

export const WEEKDAYS_PT_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MONTHS_PT_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export const MS_PER_DAY = 86400000;
export const MS_PER_MINUTE = 60000;
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
export const MATCH_WINDOW_MINUTES = 135;
export const MATCH_LIVE_SUBTEXT = "Estatísticas entram após a partida";
export const NEXT_MATCH_REFRESH_MS = 60000;

export const VALID_VENUES = new Map([
  ["casa", "Casa"],
  ["fora", "Fora"],
]);
export const VALID_RESULTS = new Set(["V", "E", "D"]);

// Formatadores pt-BR compartilhados
export const fmtInt = new Intl.NumberFormat("pt-BR");
export const fmtDec1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const fmtDec2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// =========================================================================
// Utilitários puros (zero NaN / XSS-safe / timezone-safe)
// =========================================================================

export function safePct(num, den) {
  return den > 0 ? (num / den) * 100 : null;
}

export function safeAvg(num, den) {
  return den > 0 ? num / den : null;
}

export function formatPct(value) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${fmtDec1.format(value)}%`;
}

export function formatAvg(value, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return "—";
  return decimals === 1 ? fmtDec1.format(value) : fmtDec2.format(value);
}

export function formatSigned(value) {
  if (value > 0) return `+${fmtInt.format(value)}`;
  return fmtInt.format(value);
}

export function pluralizar(quantidade, singular, plural) {
  return quantidade === 1 ? singular : plural;
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseIsoDateParts(isoDate) {
  if (typeof isoDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) return null;
  return {
    year: match[1],
    month: match[2],
    monthNum,
    day: match[3],
  };
}

export function parseIsoCalendarDate(isoDate) {
  if (typeof isoDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;

  const yearNum = Number(match[1]);
  const monthNum = Number(match[2]);
  const dayNum = Number(match[3]);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;

  const utc = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  if (
    utc.getUTCFullYear() !== yearNum ||
    utc.getUTCMonth() !== monthNum - 1 ||
    utc.getUTCDate() !== dayNum
  ) {
    return null;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
    yearNum,
    monthNum,
    dayNum,
    weekdayIndex: utc.getUTCDay(),
    utcMs: utc.getTime(),
  };
}

export function parseHoraValida(hora) {
  if (typeof hora !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
  if (!match) return null;
  return {
    horas: match[1],
    minutos: match[2],
    formatada: `${match[1]}:${match[2]}`,
  };
}

export function getTodayIsoBRT(agoraMs = Date.now()) {
  const ms = typeof agoraMs === "number" && Number.isFinite(agoraMs) ? agoraMs : Date.now();
  const ref = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(ref);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback explícito em UTC-3 (Brasília) caso Intl/timeZone não esteja disponível
  }
  const brtDate = new Date(ms - BRT_OFFSET_MS);
  const year = String(brtDate.getUTCFullYear());
  const month = String(brtDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(brtDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateBR(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  const parts = parseIsoDateParts(isoDate);
  if (parts) return `${parts.day}/${parts.month}/${parts.year}`;
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

export function formatMonthYearBR(isoDate) {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return formatDateBR(isoDate);
  return `${MONTHS_PT_SHORT[parts.monthNum - 1]}/${parts.year}`;
}

export function formatStreakPeriodBR(startIso, endIso, count) {
  if (!startIso) return "—";
  if (count <= 1 || !endIso || startIso === endIso) {
    return formatDateBR(startIso);
  }
  const startMY = formatMonthYearBR(startIso);
  const endMY = formatMonthYearBR(endIso);
  if (startMY === endMY) {
    const s = parseIsoDateParts(startIso);
    const e = parseIsoDateParts(endIso);
    if (s && e) {
      return `${s.day}/${s.month} – ${e.day}/${e.month}/${e.year}`;
    }
    return startMY;
  }
  return `${startMY} – ${endMY}`;
}

export function formatDateTimeBRT(isoString) {
  if (!isoString) return null;
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return null;
  try {
    const dateStr = dt.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeStr = dt.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${dateStr} às ${timeStr}`;
  } catch {
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${d}/${m}/${y} às ${hh}:${mm}`;
  }
}

// =========================================================================
// Normalização de dados (funções puras)
// =========================================================================

function toFiniteNumberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toCleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toCleanStringOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeGoal(rawGoal) {
  if (!rawGoal || typeof rawGoal !== "object") return null;
  const jogador = toCleanString(rawGoal.jogador);
  const minuto = toCleanString(rawGoal.minuto);
  const tipo = toCleanString(rawGoal.tipo, "Normal") || "Normal";
  const golContra = Boolean(rawGoal.gol_contra) || tipo === "Gol contra";

  if (!jogador && !golContra) return null;

  return {
    jogador: jogador || "Gol contra",
    minuto,
    tipo,
    gol_contra: golContra,
  };
}

/**
 * Normaliza uma partida bruta do JSON garantindo coerência de tipos e preservando
 * explicitamente `null` em campos opcionais (cartões/gols em períodos sem cobertura).
 */
export function normalizeMatch(rawMatch, fallbackIndex = 0) {
  if (!rawMatch || typeof rawMatch !== "object") return null;

  const temporada = toFiniteNumberOrNull(rawMatch.temporada);
  const golsPro = toFiniteNumberOrNull(rawMatch.gols_pro);
  const golsContra = toFiniteNumberOrNull(rawMatch.gols_contra);

  if (temporada === null || golsPro === null || golsContra === null) {
    return null;
  }

  const saldoGols = toFiniteNumberOrNull(rawMatch.saldo_gols) ?? golsPro - golsContra;
  const derivedResult = saldoGols > 0 ? "V" : saldoGols < 0 ? "D" : "E";
  const rawResult = toCleanString(rawMatch.resultado).toUpperCase();
  const resultado = VALID_RESULTS.has(rawResult) ? rawResult : derivedResult;
  const derivedPoints = resultado === "V" ? 3 : resultado === "E" ? 1 : 0;
  const pontos = toFiniteNumberOrNull(rawMatch.pontos) ?? derivedPoints;

  const rawMando = toCleanString(rawMatch.mando);
  const mando = VALID_VENUES.get(normalizeText(rawMando)) || rawMando;

  const cartoesAmarelos = toFiniteNumberOrNull(rawMatch.cartoes_amarelos);
  const cartoesVermelhos = toFiniteNumberOrNull(rawMatch.cartoes_vermelhos);
  const hasCardPair = cartoesAmarelos !== null && cartoesVermelhos !== null;

  // Preserva `null` quando a partida não possui cobertura de artilharia (ex.: 2003–2013)
  let gols = null;
  if (Array.isArray(rawMatch.gols)) {
    gols = rawMatch.gols.map(normalizeGoal).filter(Boolean);
  }

  return {
    ...rawMatch,
    id: toFiniteNumberOrNull(rawMatch.id) ?? fallbackIndex + 1,
    temporada,
    rodada: toFiniteNumberOrNull(rawMatch.rodada) ?? 0,
    data: toCleanString(rawMatch.data),
    hora: toCleanString(rawMatch.hora),
    mando,
    adversario: toCleanString(rawMatch.adversario, "Adversário desconhecido") || "Adversário desconhecido",
    adversario_estado: toCleanString(rawMatch.adversario_estado),
    arena: toCleanString(rawMatch.arena),
    gols_pro: golsPro,
    gols_contra: golsContra,
    saldo_gols: saldoGols,
    resultado,
    pontos,
    tecnico_spfc: toCleanStringOrNull(rawMatch.tecnico_spfc),
    formacao_spfc: toCleanStringOrNull(rawMatch.formacao_spfc),
    cartoes_amarelos: hasCardPair ? cartoesAmarelos : null,
    cartoes_vermelhos: hasCardPair ? cartoesVermelhos : null,
    cartoes_amarelos_adversario: hasCardPair
      ? toFiniteNumberOrNull(rawMatch.cartoes_amarelos_adversario)
      : null,
    cartoes_vermelhos_adversario: hasCardPair
      ? toFiniteNumberOrNull(rawMatch.cartoes_vermelhos_adversario)
      : null,
    gols,
  };
}

/**
 * Calcula limites dinâmicos de temporada, cobertura de dados detalhados e tabelas
 * de lookup de adversários a partir das partidas normalizadas.
 */
export function extractDatasetBounds(matches, metadata = {}) {
  const list = Array.isArray(matches) ? matches : [];
  const seasons = list
    .map((m) => m?.temporada)
    .filter((y) => typeof y === "number" && Number.isFinite(y));

  const minSeason = seasons.length > 0 ? Math.min(...seasons) : 2003;
  const maxSeason = seasons.length > 0 ? Math.max(...seasons) : minSeason;

  const detailedMatches = list.filter(
    (m) =>
      m &&
      ((m.cartoes_amarelos !== null && m.cartoes_vermelhos !== null) || Array.isArray(m.gols))
  );
  const detailedSeasons = detailedMatches
    .map((m) => m.temporada)
    .filter((y) => typeof y === "number" && Number.isFinite(y));

  let modernStart = 2014;
  if (detailedSeasons.length > 0) {
    modernStart = Math.min(...detailedSeasons);
  } else if (
    metadata &&
    Array.isArray(metadata.temporadas_com_cartoes) &&
    metadata.temporadas_com_cartoes.length > 0
  ) {
    modernStart = Math.min(...metadata.temporadas_com_cartoes);
  }

  const validSeasons = new Set();
  for (let y = minSeason; y <= maxSeason; y += 1) {
    validSeasons.add(y);
  }

  const availableSeasonsDesc = [...new Set(seasons)].sort((a, b) => b - a);
  const opponents = [
    ...new Set(
      list
        .map((m) => m?.adversario)
        .filter((name) => typeof name === "string" && name.trim().length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const opponentLookup = new Map([["classicos", "CLASSICOS"]]);
  const validOpponentClubs = new Map();
  for (const opp of opponents) {
    const normalized = normalizeText(opp);
    opponentLookup.set(normalized, opp);
    validOpponentClubs.set(normalized, opp);
  }

  return {
    minSeason,
    maxSeason,
    modernStart,
    totalSeasons: availableSeasonsDesc.length,
    detailedGamesCount: detailedMatches.length,
    validSeasons,
    availableSeasonsDesc,
    opponents,
    opponentLookup,
    validOpponentClubs,
  };
}

export function normalizeMatchesDataset(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.partidas)) {
    throw new Error("Formato de JSON inválido: campo 'partidas' ausente ou vazio.");
  }

  const matches = payload.partidas
    .map((raw, idx) => normalizeMatch(raw, idx))
    .filter(Boolean);

  if (matches.length === 0) {
    throw new Error("Formato de JSON inválido: campo 'partidas' ausente ou vazio.");
  }

  const meta =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? { ...payload.metadata }
      : {};
  const bounds = extractDatasetBounds(matches, meta);

  return {
    matches,
    meta,
    bounds,
  };
}

export function normalizeSyncMeta(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return { ...payload };
}

export function normalizeNextMatchPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return { ...payload };
}

// =========================================================================
// Cache em memória e carregamento resiliente dos JSONs
// =========================================================================

const dataCache = new Map();

export function clearDataCache(key) {
  if (typeof key === "string") {
    dataCache.delete(key);
    return;
  }
  dataCache.clear();
}

export function getCachedData(key) {
  return dataCache.has(key) ? dataCache.get(key) : undefined;
}

export async function loadMatchesDataset({
  url = DATA_URL,
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
} = {}) {
  const cacheKey = `matches:${url}`;
  if (!forceRefresh && dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("API fetch indisponível neste ambiente.");
  }

  const response = await fetchImpl(url, { cache: "no-cache" });
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response?.status ?? "desconhecido"} ao carregar ${url}`);
  }
  const payload = await response.json();
  const normalized = normalizeMatchesDataset(payload);
  dataCache.set(cacheKey, normalized);
  return normalized;
}

export async function loadSyncMeta({
  url = META_URL,
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
} = {}) {
  const cacheKey = `meta:${url}`;
  if (!forceRefresh && dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey);
  }
  if (typeof fetchImpl !== "function") {
    return null;
  }

  try {
    const resp = await fetchImpl(url, { cache: "no-cache" });
    if (!resp || !resp.ok) return null;
    const normalized = normalizeSyncMeta(await resp.json());
    if (normalized) {
      dataCache.set(cacheKey, normalized);
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function loadNextMatch({
  url = NEXT_MATCH_URL,
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
} = {}) {
  const cacheKey = `nextMatch:${url}`;
  if (!forceRefresh && dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey);
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, data: null };
  }

  try {
    const resp = await fetchImpl(url, { cache: "no-cache" });
    if (!resp || !resp.ok) {
      console.warn(
        `[Dados Tricolor] Próximo jogo indisponível (HTTP ${resp?.status ?? "?"}) em ${url}.`
      );
      return { ok: false, data: null };
    }
    const normalized = normalizeNextMatchPayload(await resp.json());
    if (!normalized) {
      console.warn(`[Dados Tricolor] Formato inválido em ${url}.`);
      return { ok: false, data: null };
    }
    const result = { ok: true, data: normalized };
    dataCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`[Dados Tricolor] Falha ao carregar ${url}:`, err);
    return { ok: false, data: null };
  }
}

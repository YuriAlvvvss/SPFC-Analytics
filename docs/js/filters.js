/**
 * Dados Tricolor — Módulo de Filtros, Deep-Linking e Agregações (`filters.js`)
 * Responsável pelo estado dos filtros, pílulas de período, sincronização bidirecional
 * com a URL (query string) e funções puras de filtragem, agregação de KPIs,
 * recordes/sequências, comparador de temporadas e próximo jogo.
 */

import {
  CLASSICOS,
  MATCH_LIVE_SUBTEXT,
  MATCH_WINDOW_MINUTES,
  MS_PER_DAY,
  MS_PER_MINUTE,
  VALID_RESULTS,
  VALID_VENUES,
  WEEKDAYS_PT_SHORT,
  fmtInt,
  formatDateBR,
  formatDateTimeBRT,
  formatPct,
  formatStreakPeriodBR,
  getTodayIsoBRT,
  normalizeText,
  parseHoraValida,
  parseIsoCalendarDate,
  pluralizar,
  safeAvg,
  safePct,
} from "./data.js";

export const MAX_SEARCH_URL_LENGTH = 120;

// =========================================================================
// Estado dos filtros e pílulas de período
// =========================================================================

export function createFilterState(bounds = {}) {
  const minSeason = Number.isFinite(bounds.minSeason) ? bounds.minSeason : 2003;
  const maxSeason = Number.isFinite(bounds.maxSeason) ? bounds.maxSeason : minSeason;

  return {
    seasonStart: minSeason,
    seasonEnd: maxSeason,
    opponent: "ALL",
    venue: "ALL",
    evolutionMode: "performance", // "performance" | "goals"
    secondaryTab: "discipline", // "discipline" | "opponents"
    tableSearch: "",
    tableResult: "ALL", // "ALL" | "V" | "E" | "D"
    tableSortBy: "data",
    tableSortDir: "desc",
    tablePage: 1,
    tablePageSize: 25,
  };
}

export function resetFilterState(state, bounds) {
  state.seasonStart = bounds.minSeason;
  state.seasonEnd = bounds.maxSeason;
  state.opponent = "ALL";
  state.venue = "ALL";
  state.tableResult = "ALL";
  state.tableSearch = "";
  state.tablePage = 1;
  return state;
}

export function isDefaultFilterState(state, bounds) {
  return (
    state.seasonStart === bounds.minSeason &&
    state.seasonEnd === bounds.maxSeason &&
    state.opponent === "ALL" &&
    state.venue === "ALL" &&
    state.tableResult === "ALL" &&
    state.tableSearch.trim() === ""
  );
}

/**
 * Resolve o intervalo de temporadas para uma pílula/atalho de período.
 * Função pura.
 */
export function resolvePeriodPreset(preset, bounds) {
  const minSeason = bounds.minSeason;
  const maxSeason = bounds.maxSeason;
  const modernStart = bounds.modernStart;

  if (preset === "ALL") {
    return { seasonStart: minSeason, seasonEnd: maxSeason };
  }
  if (preset === "TRI") {
    return { seasonStart: 2006, seasonEnd: 2008 };
  }
  if (preset === "MODERN") {
    return { seasonStart: modernStart, seasonEnd: maxSeason };
  }
  if (preset === "LAST5") {
    return { seasonStart: Math.max(minSeason, maxSeason - 4), seasonEnd: maxSeason };
  }
  if (preset === "CURRENT") {
    return { seasonStart: maxSeason, seasonEnd: maxSeason };
  }
  return null;
}

export function isPeriodPresetActive(preset, state, bounds) {
  const range = resolvePeriodPreset(preset, bounds);
  if (!range) return false;
  return state.seasonStart === range.seasonStart && state.seasonEnd === range.seasonEnd;
}

export function describeActiveFilters(state) {
  const parts = [];
  if (state.seasonStart === state.seasonEnd) {
    parts.push(`temporada ${state.seasonStart}`);
  } else {
    parts.push(`período ${state.seasonStart}–${state.seasonEnd}`);
  }
  if (state.opponent === "CLASSICOS") parts.push("Clássicos (COR · PAL · SAN)");
  else if (state.opponent !== "ALL") parts.push(`adversário ${state.opponent}`);
  if (state.venue !== "ALL") parts.push(`mando ${state.venue}`);
  return parts.join(" · ");
}

// =========================================================================
// Sincronização Bidirecional com a URL (Deep-Linking / Query Parameters)
// =========================================================================

export function parseValidSeasonParam(rawValue, validSeasons) {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const year = Number(trimmed);
  if (validSeasons instanceof Set) {
    return validSeasons.has(year) ? year : null;
  }
  return null;
}

/**
 * Função pura: faz o parsing defensivo da query string (`?de=...&ate=...`)
 * validando temporadas, adversário (com tolerância a acentos/caixa), mando,
 * resultado e busca textual. Nunca lança exceção em query strings malformadas.
 */
export function parseFiltersFromSearch(search, bounds) {
  const result = {
    seasonStart: bounds.minSeason,
    seasonEnd: bounds.maxSeason,
    opponent: "ALL",
    venue: "ALL",
    tableResult: "ALL",
    tableSearch: "",
  };

  if (typeof search !== "string" || !search.trim()) {
    return result;
  }

  try {
    const params = new URLSearchParams(search);

    // Intervalo de temporadas: de / ate
    const parsedStart = parseValidSeasonParam(params.get("de"), bounds.validSeasons);
    const parsedEnd = parseValidSeasonParam(params.get("ate"), bounds.validSeasons);

    if (parsedStart !== null) {
      result.seasonStart = parsedStart;
    }
    if (parsedEnd !== null) {
      result.seasonEnd = parsedEnd;
    }
    if (result.seasonStart > result.seasonEnd) {
      const tmp = result.seasonStart;
      result.seasonStart = result.seasonEnd;
      result.seasonEnd = tmp;
    }

    // Adversário (aceita correspondência exata ou normalizada sem acentos/maiúsculas)
    const rawOpponent = params.get("adversario");
    if (
      typeof rawOpponent === "string" &&
      rawOpponent.trim() &&
      bounds.opponentLookup instanceof Map
    ) {
      const canonicalOpponent = bounds.opponentLookup.get(normalizeText(rawOpponent));
      if (canonicalOpponent) {
        result.opponent = canonicalOpponent;
      }
    }

    // Mando de campo (Casa | Fora)
    const rawVenue = params.get("mando");
    if (typeof rawVenue === "string" && rawVenue.trim()) {
      const canonicalVenue = VALID_VENUES.get(normalizeText(rawVenue));
      if (canonicalVenue) {
        result.venue = canonicalVenue;
      }
    }

    // Resultado na tabela (V | E | D)
    const rawResult = params.get("resultado");
    if (typeof rawResult === "string" && rawResult.trim()) {
      const upperResult = rawResult.trim().toUpperCase();
      if (VALID_RESULTS.has(upperResult)) {
        result.tableResult = upperResult;
      }
    }

    // Busca textual na tabela
    const rawSearch = params.get("busca");
    if (typeof rawSearch === "string") {
      const cleanedSearch = rawSearch.trim().slice(0, MAX_SEARCH_URL_LENGTH);
      if (cleanedSearch) {
        result.tableSearch = cleanedSearch;
      }
    }
  } catch {
    // Fallback seguro: ignora query string malformada sem quebrar a página
  }

  return result;
}

export function applyFiltersFromUrl(state, bounds, search) {
  const rawSearch =
    typeof search === "string"
      ? search
      : typeof window !== "undefined" && window.location
        ? window.location.search
        : "";

  if (!rawSearch) return state;

  const parsed = parseFiltersFromSearch(rawSearch, bounds);
  state.seasonStart = parsed.seasonStart;
  state.seasonEnd = parsed.seasonEnd;
  state.opponent = parsed.opponent;
  state.venue = parsed.venue;
  state.tableResult = parsed.tableResult;
  state.tableSearch = parsed.tableSearch;
  return state;
}

/**
 * Função pura: serializa apenas os parâmetros diferentes do valor padrão.
 */
export function buildSearchParamsFromState(state, bounds) {
  const params = new URLSearchParams();

  if (state.seasonStart !== bounds.minSeason) {
    params.set("de", String(state.seasonStart));
  }
  if (state.seasonEnd !== bounds.maxSeason) {
    params.set("ate", String(state.seasonEnd));
  }
  if (state.opponent !== "ALL") {
    params.set("adversario", state.opponent);
  }
  if (state.venue !== "ALL") {
    params.set("mando", state.venue);
  }
  if (state.tableResult !== "ALL") {
    params.set("resultado", state.tableResult);
  }
  const trimmedSearch = typeof state.tableSearch === "string" ? state.tableSearch.trim() : "";
  if (trimmedSearch) {
    params.set("busca", trimmedSearch);
  }

  return params;
}

export function buildUrlFromState(state, bounds, locationLike) {
  const loc =
    locationLike ||
    (typeof window !== "undefined" && window.location
      ? window.location
      : { pathname: "/", hash: "" });
  const params = buildSearchParamsFromState(state, bounds);
  const queryString = params.toString();
  const pathname = loc.pathname || "/";
  const hash = loc.hash || "";
  return `${pathname}${queryString ? `?${queryString}` : ""}${hash}`;
}

export function syncUrlWithState(state, bounds, locationLike, historyLike) {
  const loc = locationLike || (typeof window !== "undefined" ? window.location : null);
  const hist = historyLike || (typeof window !== "undefined" ? window.history : null);
  if (!loc || !hist || typeof hist.replaceState !== "function") return;

  const nextUrl = buildUrlFromState(state, bounds, loc);
  const currentUrl = `${loc.pathname || "/"}${loc.search || ""}${loc.hash || ""}`;
  if (nextUrl === currentUrl) return;

  try {
    hist.replaceState(null, "", nextUrl);
  } catch {
    // Ignora silenciosamente em ambientes com History API restrita
  }
}

// =========================================================================
// Filtragem e Agregações Puras (KPIs, Séries, Artilheiros, Disciplina)
// =========================================================================

export function filterMatches(matches, filterState) {
  if (!Array.isArray(matches)) return [];
  const { seasonStart, seasonEnd, opponent = "ALL", venue = "ALL" } = filterState || {};

  return matches.filter((m) => {
    if (!m || typeof m !== "object") return false;
    if (Number.isFinite(seasonStart) && m.temporada < seasonStart) {
      return false;
    }
    if (Number.isFinite(seasonEnd) && m.temporada > seasonEnd) {
      return false;
    }
    if (opponent === "CLASSICOS") {
      if (!CLASSICOS.has(m.adversario)) return false;
    } else if (opponent !== "ALL") {
      if (m.adversario !== opponent) return false;
    }
    if (venue !== "ALL" && m.mando !== venue) {
      return false;
    }
    return true;
  });
}

/**
 * Função pura: agrega KPIs de desempenho e disciplina.
 * Protege todas as divisões contra zero e contabiliza médias de cartões
 * exclusivamente sobre partidas com registro disciplinar (`cartoes_* !== null`).
 */
export function computeSummary(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const games = list.length;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let points = 0;
  let gf = 0;
  let ga = 0;
  let cleanSheets = 0;
  let homeGames = 0;
  let awayGames = 0;

  let cardGames = 0;
  let yellowTotal = 0;
  let redTotal = 0;

  const seasonsSet = new Set();

  for (const m of list) {
    seasonsSet.add(m.temporada);
    if (m.mando === "Casa") homeGames += 1;
    else awayGames += 1;

    if (m.resultado === "V") wins += 1;
    else if (m.resultado === "E") draws += 1;
    else losses += 1;

    points += m.pontos;
    gf += m.gols_pro;
    ga += m.gols_contra;
    if (m.gols_contra === 0) cleanSheets += 1;

    // Garantia 1: contabiliza apenas jogos com dados disciplinares registrados (2014 em diante)
    if (
      typeof m.cartoes_amarelos === "number" &&
      Number.isFinite(m.cartoes_amarelos) &&
      typeof m.cartoes_vermelhos === "number" &&
      Number.isFinite(m.cartoes_vermelhos)
    ) {
      cardGames += 1;
      yellowTotal += m.cartoes_amarelos;
      redTotal += m.cartoes_vermelhos;
    }
  }

  const maxPoints = games * 3;
  return {
    games,
    seasonsCount: seasonsSet.size,
    homeGames,
    awayGames,
    wins,
    draws,
    losses,
    points,
    maxPoints,
    winrate: safePct(points, maxPoints),
    winPct: safePct(wins, games),
    drawPct: safePct(draws, games),
    lossPct: safePct(losses, games),
    gf,
    ga,
    gd: gf - ga,
    gfAvg: safeAvg(gf, games),
    gaAvg: safeAvg(ga, games),
    cleanSheetPct: safePct(cleanSheets, games),
    cardGames,
    yellowTotal,
    redTotal,
    yellowAvg: safeAvg(yellowTotal, cardGames),
    redAvg: safeAvg(redTotal, cardGames),
  };
}

/**
 * Agrupa partidas por temporada em ordem crescente.
 */
export function aggregateBySeason(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const bySeason = new Map();
  for (const m of list) {
    if (!bySeason.has(m.temporada)) bySeason.set(m.temporada, []);
    bySeason.get(m.temporada).push(m);
  }
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  const statsBySeason = seasons.map((year) => ({
    year,
    ...computeSummary(bySeason.get(year)),
  }));

  return {
    bySeason,
    seasons,
    statsBySeason,
  };
}

/**
 * Agrega ranking de artilheiros a partir de partidas com registro detalhado de gols,
 * excluindo gols contra da artilharia individual.
 */
export function aggregateScorers(matches, limit = 10) {
  const list = Array.isArray(matches) ? matches : [];
  const withGoalData = list.filter((m) => m && Array.isArray(m.gols));

  const scorersMap = new Map();
  let totalPlayerGoals = 0;
  let totalOwnGoals = 0;

  for (const m of withGoalData) {
    for (const g of m.gols) {
      if (!g) continue;
      if (g.gol_contra) {
        totalOwnGoals += 1;
        continue;
      }
      if (!g.jogador) continue;
      totalPlayerGoals += 1;
      if (!scorersMap.has(g.jogador)) {
        scorersMap.set(g.jogador, {
          name: g.jogador,
          normal: 0,
          penalty: 0,
          total: 0,
          matchIds: new Set(),
        });
      }
      const entry = scorersMap.get(g.jogador);
      entry.total += 1;
      if (g.tipo === "Pênalti") entry.penalty += 1;
      else entry.normal += 1;
      entry.matchIds.add(m.id);
    }
  }

  const topScorers = [...scorersMap.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, limit);

  return {
    withGoalDataCount: withGoalData.length,
    totalPlayerGoals,
    totalOwnGoals,
    uniqueScorersCount: scorersMap.size,
    topScorers,
  };
}

/**
 * Agrega disciplina (cartões amarelos e vermelhos) por temporada exclusivamente
 * sobre jogos com registro disciplinar válido.
 */
export function aggregateDisciplineBySeason(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const withCards = list.filter(
    (m) =>
      m &&
      typeof m.cartoes_amarelos === "number" &&
      Number.isFinite(m.cartoes_amarelos) &&
      typeof m.cartoes_vermelhos === "number" &&
      Number.isFinite(m.cartoes_vermelhos)
  );

  const bySeason = new Map();
  for (const m of withCards) {
    if (!bySeason.has(m.temporada)) {
      bySeason.set(m.temporada, {
        year: m.temporada,
        games: 0,
        yellow: 0,
        red: 0,
        advYellow: 0,
        advRed: 0,
      });
    }
    const b = bySeason.get(m.temporada);
    b.games += 1;
    b.yellow += m.cartoes_amarelos;
    b.red += m.cartoes_vermelhos;
    b.advYellow += m.cartoes_amarelos_adversario ?? 0;
    b.advRed += m.cartoes_vermelhos_adversario ?? 0;
  }

  const rows = [...bySeason.values()]
    .sort((a, b) => a.year - b.year)
    .map((r) => ({
      ...r,
      yellowAvg: safeAvg(r.yellow, r.games),
      redAvg: safeAvg(r.red, r.games),
    }));

  return {
    withCardsCount: withCards.length,
    rows,
  };
}

/**
 * Agrega desempenho por adversário: seleciona os `limit` adversários mais enfrentados
 * e ordena por aproveitamento decrescente.
 */
export function aggregateByOpponent(matches, limit = 15) {
  const list = Array.isArray(matches) ? matches : [];
  const byOpponent = new Map();
  for (const m of list) {
    if (!byOpponent.has(m.adversario)) byOpponent.set(m.adversario, []);
    byOpponent.get(m.adversario).push(m);
  }

  return [...byOpponent.entries()]
    .map(([name, oppMatches]) => ({ name, ...computeSummary(oppMatches) }))
    .sort((a, b) => b.games - a.games || (b.winrate ?? 0) - (a.winrate ?? 0))
    .slice(0, limit)
    .sort((a, b) => (b.winrate ?? 0) - (a.winrate ?? 0) || b.games - a.games);
}

// =========================================================================
// Recordes e Sequências (Streaks) — Cálculo Puro
// =========================================================================

export function compareNormalizedMatchesAsc(a, b) {
  if (a.data !== b.data) return a.data < b.data ? -1 : 1;
  if (a.temporada !== b.temporada) return a.temporada - b.temporada;
  if (a.rodada !== b.rodada) return a.rodada - b.rodada;
  return a.id - b.id;
}

export function findLongestStreak(sortedMatches, predicate) {
  let bestLen = 0;
  let bestStart = null;
  let bestEnd = null;
  let occurrences = 0;

  let curLen = 0;
  let curStart = null;

  const closeStreak = (endMatch) => {
    if (curLen <= 0 || !curStart || !endMatch) return;
    if (curLen > bestLen) {
      bestLen = curLen;
      bestStart = curStart;
      bestEnd = endMatch;
      occurrences = 1;
    } else if (curLen === bestLen) {
      // Critério de desempate: manter a sequência mais recente
      bestStart = curStart;
      bestEnd = endMatch;
      occurrences += 1;
    }
  };

  for (let i = 0; i < sortedMatches.length; i += 1) {
    const m = sortedMatches[i];
    if (predicate(m)) {
      if (curLen === 0) curStart = m;
      curLen += 1;
    } else if (curLen > 0) {
      closeStreak(sortedMatches[i - 1]);
      curLen = 0;
      curStart = null;
    }
  }

  if (curLen > 0) {
    closeStreak(sortedMatches[sortedMatches.length - 1]);
  }

  if (bestLen === 0 || !bestStart || !bestEnd) {
    return null;
  }

  return {
    quantidade: bestLen,
    dataInicio: bestStart.data,
    dataFim: bestEnd.data,
    periodoFormatado: formatStreakPeriodBR(bestStart.data, bestEnd.data, bestLen),
    ocorrencias: occurrences,
    empatesAdicionais: Math.max(0, occurrences - 1),
  };
}

export function computeRecentStreak(sortedMatches) {
  const n = sortedMatches.length;
  if (n === 0) return null;

  let winStreak = 0;
  for (let i = n - 1; i >= 0 && sortedMatches[i].resultado === "V"; i -= 1) {
    winStreak += 1;
  }

  let unbeatenStreak = 0;
  for (
    let i = n - 1;
    i >= 0 && (sortedMatches[i].resultado === "V" || sortedMatches[i].resultado === "E");
    i -= 1
  ) {
    unbeatenStreak += 1;
  }

  let lossStreak = 0;
  for (let i = n - 1; i >= 0 && sortedMatches[i].resultado === "D"; i -= 1) {
    lossStreak += 1;
  }

  let winlessStreak = 0;
  for (
    let i = n - 1;
    i >= 0 && (sortedMatches[i].resultado === "E" || sortedMatches[i].resultado === "D");
    i -= 1
  ) {
    winlessStreak += 1;
  }

  let drawStreak = 0;
  for (let i = n - 1; i >= 0 && sortedMatches[i].resultado === "E"; i -= 1) {
    drawStreak += 1;
  }

  const last = sortedMatches[n - 1];
  const ultimoPlacar = `${last.golsPro}×${last.golsContra}`;
  const ultimoResumo = `${last.resultado} ${ultimoPlacar} vs ${last.adversario}`;

  if (last.resultado === "V") {
    if (winStreak >= 2) {
      const startMatch = sortedMatches[n - winStreak];
      const periodo = formatStreakPeriodBR(startMatch.data, last.data, winStreak);
      const extraInvicto =
        unbeatenStreak > winStreak
          ? `${fmtInt.format(unbeatenStreak)} ${pluralizar(unbeatenStreak, "jogo", "jogos")} invicto`
          : `Último: ${ultimoResumo}`;
      return {
        tipo: "vitorias",
        tom: "positivo",
        badge: "Em alta",
        quantidade: winStreak,
        rotuloPrincipal: `${fmtInt.format(winStreak)} ${pluralizar(winStreak, "vitória seguida", "vitórias seguidas")}`,
        periodoFormatado: periodo,
        detalhe: `${periodo} · ${extraInvicto}`,
        dataInicio: startMatch.data,
        dataFim: last.data,
      };
    }

    if (unbeatenStreak >= 2) {
      const startMatch = sortedMatches[n - unbeatenStreak];
      const periodo = formatStreakPeriodBR(startMatch.data, last.data, unbeatenStreak);
      return {
        tipo: "invencibilidade",
        tom: "positivo",
        badge: "Invicto",
        quantidade: unbeatenStreak,
        rotuloPrincipal: `${fmtInt.format(unbeatenStreak)} ${pluralizar(unbeatenStreak, "jogo invicto", "jogos invicto")}`,
        periodoFormatado: periodo,
        detalhe: `${periodo} · Último: ${ultimoResumo}`,
        dataInicio: startMatch.data,
        dataFim: last.data,
      };
    }

    const dataFmt = formatDateBR(last.data);
    return {
      tipo: "vitorias",
      tom: "positivo",
      badge: "Vitória",
      quantidade: 1,
      rotuloPrincipal: "1 vitória",
      periodoFormatado: dataFmt,
      detalhe: `${dataFmt} · ${ultimoPlacar} vs ${last.adversario}`,
      dataInicio: last.data,
      dataFim: last.data,
    };
  }

  if (last.resultado === "D") {
    if (lossStreak >= 2) {
      const startMatch = sortedMatches[n - lossStreak];
      const periodo = formatStreakPeriodBR(startMatch.data, last.data, lossStreak);
      const extraJejum =
        winlessStreak > lossStreak
          ? `${fmtInt.format(winlessStreak)} ${pluralizar(winlessStreak, "jogo", "jogos")} sem vencer`
          : `Último: ${ultimoResumo}`;
      return {
        tipo: "derrotas",
        tom: "negativo",
        badge: "Derrotas",
        quantidade: lossStreak,
        rotuloPrincipal: `${fmtInt.format(lossStreak)} ${pluralizar(lossStreak, "derrota seguida", "derrotas seguidas")}`,
        periodoFormatado: periodo,
        detalhe: `${periodo} · ${extraJejum}`,
        dataInicio: startMatch.data,
        dataFim: last.data,
      };
    }

    if (winlessStreak >= 2) {
      const startMatch = sortedMatches[n - winlessStreak];
      const periodo = formatStreakPeriodBR(startMatch.data, last.data, winlessStreak);
      return {
        tipo: "jejum",
        tom: "negativo",
        badge: "Sem vencer",
        quantidade: winlessStreak,
        rotuloPrincipal: `${fmtInt.format(winlessStreak)} ${pluralizar(winlessStreak, "jogo sem vencer", "jogos sem vencer")}`,
        periodoFormatado: periodo,
        detalhe: `${periodo} · Último: ${ultimoResumo}`,
        dataInicio: startMatch.data,
        dataFim: last.data,
      };
    }

    const dataFmt = formatDateBR(last.data);
    return {
      tipo: "derrotas",
      tom: "negativo",
      badge: "Derrota",
      quantidade: 1,
      rotuloPrincipal: "1 derrota",
      periodoFormatado: dataFmt,
      detalhe: `${dataFmt} · ${ultimoPlacar} vs ${last.adversario}`,
      dataInicio: last.data,
      dataFim: last.data,
    };
  }

  // Último jogo foi Empate (E)
  if (winlessStreak >= 2) {
    const startMatch = sortedMatches[n - winlessStreak];
    const periodo = formatStreakPeriodBR(startMatch.data, last.data, winlessStreak);
    const detalheExtra =
      drawStreak === winlessStreak
        ? `${fmtInt.format(drawStreak)} ${pluralizar(drawStreak, "empate seguido", "empates seguidos")}`
        : `Último: ${ultimoResumo}`;
    return {
      tipo: "jejum",
      tom: "negativo",
      badge: "Sem vencer",
      quantidade: winlessStreak,
      rotuloPrincipal: `${fmtInt.format(winlessStreak)} ${pluralizar(winlessStreak, "jogo sem vencer", "jogos sem vencer")}`,
      periodoFormatado: periodo,
      detalhe: `${periodo} · ${detalheExtra}`,
      dataInicio: startMatch.data,
      dataFim: last.data,
    };
  }

  if (unbeatenStreak >= 2) {
    const startMatch = sortedMatches[n - unbeatenStreak];
    const periodo = formatStreakPeriodBR(startMatch.data, last.data, unbeatenStreak);
    return {
      tipo: "invencibilidade",
      tom: "neutro",
      badge: "Invicto",
      quantidade: unbeatenStreak,
      rotuloPrincipal: `${fmtInt.format(unbeatenStreak)} ${pluralizar(unbeatenStreak, "jogo invicto", "jogos invicto")}`,
      periodoFormatado: periodo,
      detalhe: `${periodo} · Último: ${ultimoResumo}`,
      dataInicio: startMatch.data,
      dataFim: last.data,
    };
  }

  const dataFmt = formatDateBR(last.data);
  return {
    tipo: "empate",
    tom: "neutro",
    badge: "Empate",
    quantidade: 1,
    rotuloPrincipal: "1 jogo sem vencer",
    periodoFormatado: dataFmt,
    detalhe: `${dataFmt} · Empate ${ultimoPlacar} vs ${last.adversario}`,
    dataInicio: last.data,
    dataFim: last.data,
  };
}

export function formatScoreRecord(match) {
  if (!match) return null;
  return {
    golsPro: match.golsPro,
    golsContra: match.golsContra,
    saldo: match.saldo,
    placarSpfc: `SPFC ${match.golsPro} × ${match.golsContra}`,
    adversario: match.adversario,
    mando: match.mando,
    data: match.data,
    dataFormatada: formatDateBR(match.data),
    temporada: match.temporada || null,
    rodada: match.rodada || null,
    arena: match.arena,
  };
}

/**
 * Função pura: calcula recordes e sequências (streaks) sem mutar o array de entrada.
 * Garante ordenação cronológica crescente, ignora placares inválidos e evita bugs de fuso horário.
 */
export function calcularRecordesESequencias(jogosFiltrados) {
  const entrada = Array.isArray(jogosFiltrados) ? [...jogosFiltrados] : [];
  const jogosValidos = [];

  for (const jogo of entrada) {
    if (!jogo || typeof jogo !== "object") continue;
    const gp = jogo.gols_pro;
    const gc = jogo.gols_contra;
    if (typeof gp !== "number" || !Number.isFinite(gp)) continue;
    if (typeof gc !== "number" || !Number.isFinite(gc)) continue;

    const saldo = gp - gc;
    const resultado = saldo > 0 ? "V" : saldo < 0 ? "D" : "E";
    jogosValidos.push({
      id: typeof jogo.id === "number" && Number.isFinite(jogo.id) ? jogo.id : 0,
      temporada: typeof jogo.temporada === "number" && Number.isFinite(jogo.temporada) ? jogo.temporada : 0,
      rodada: typeof jogo.rodada === "number" && Number.isFinite(jogo.rodada) ? jogo.rodada : 0,
      data: typeof jogo.data === "string" ? jogo.data.trim() : "",
      adversario:
        typeof jogo.adversario === "string" && jogo.adversario.trim()
          ? jogo.adversario.trim()
          : "Adversário desconhecido",
      mando: typeof jogo.mando === "string" ? jogo.mando.trim() : "",
      arena: typeof jogo.arena === "string" ? jogo.arena.trim() : "",
      golsPro: gp,
      golsContra: gc,
      saldo,
      resultado,
    });
  }

  if (jogosValidos.length === 0) {
    return {
      totalJogosValidos: 0,
      vazio: true,
      maiorInvencibilidade: null,
      maiorSequenciaVitorias: null,
      maiorJejumSemVencer: null,
      sequenciaRecente: null,
      maiorGoleadaAFavor: null,
      piorDerrota: null,
    };
  }

  jogosValidos.sort(compareNormalizedMatchesAsc);

  const maiorInvencibilidade = findLongestStreak(
    jogosValidos,
    (m) => m.resultado === "V" || m.resultado === "E"
  );
  const maiorSequenciaVitorias = findLongestStreak(jogosValidos, (m) => m.resultado === "V");
  const maiorJejumSemVencer = findLongestStreak(
    jogosValidos,
    (m) => m.resultado === "E" || m.resultado === "D"
  );
  const sequenciaRecente = computeRecentStreak(jogosValidos);

  // Maior Goleada a Favor: apenas vitórias (saldo > 0)
  // Desempate: maior saldo -> mais gols pró -> data mais recente
  let bestWin = null;
  for (const m of jogosValidos) {
    if (m.saldo <= 0) continue;
    if (
      !bestWin ||
      m.saldo > bestWin.saldo ||
      (m.saldo === bestWin.saldo && m.golsPro > bestWin.golsPro) ||
      (m.saldo === bestWin.saldo &&
        m.golsPro === bestWin.golsPro &&
        compareNormalizedMatchesAsc(m, bestWin) > 0)
    ) {
      bestWin = m;
    }
  }

  // Pior Derrota: apenas derrotas (saldo < 0)
  // Desempate: pior saldo -> mais gols sofridos -> data mais recente
  let worstLoss = null;
  for (const m of jogosValidos) {
    if (m.saldo >= 0) continue;
    if (
      !worstLoss ||
      m.saldo < worstLoss.saldo ||
      (m.saldo === worstLoss.saldo && m.golsContra > worstLoss.golsContra) ||
      (m.saldo === worstLoss.saldo &&
        m.golsContra === worstLoss.golsContra &&
        compareNormalizedMatchesAsc(m, worstLoss) > 0)
    ) {
      worstLoss = m;
    }
  }

  return {
    totalJogosValidos: jogosValidos.length,
    vazio: false,
    maiorInvencibilidade,
    maiorSequenciaVitorias,
    maiorJejumSemVencer,
    sequenciaRecente,
    maiorGoleadaAFavor: formatScoreRecord(bestWin),
    piorDerrota: formatScoreRecord(worstLoss),
  };
}

// =========================================================================
// Comparador de Temporadas Lado a Lado — Funções Puras
// =========================================================================

export function normalizarMandoComparador(mando) {
  if (typeof mando !== "string") return "ALL";
  const norm = normalizeText(mando);
  if (norm === "casa") return "Casa";
  if (norm === "fora") return "Fora";
  return "ALL";
}

/**
 * Filtra registros com placar numérico válido e devolve cópia ordenada
 * cronologicamente crescente (por data ISO, rodada e id), sem mutar a entrada
 * e sem depender de `new Date("YYYY-MM-DD")`.
 */
export function normalizarEOrdenarJogosTemporada(jogos) {
  if (!Array.isArray(jogos)) return [];
  const validos = [];

  for (let idx = 0; idx < jogos.length; idx += 1) {
    const jogo = jogos[idx];
    if (!jogo || typeof jogo !== "object") continue;

    const gp = jogo.gols_pro;
    const gc = jogo.gols_contra;
    if (typeof gp !== "number" || !Number.isFinite(gp) || gp < 0) continue;
    if (typeof gc !== "number" || !Number.isFinite(gc) || gc < 0) continue;

    const saldo = gp - gc;
    const resultado = saldo > 0 ? "V" : saldo < 0 ? "D" : "E";
    const pontos =
      typeof jogo.pontos === "number" && Number.isFinite(jogo.pontos)
        ? jogo.pontos
        : resultado === "V"
          ? 3
          : resultado === "E"
            ? 1
            : 0;

    validos.push({
      id: typeof jogo.id === "number" && Number.isFinite(jogo.id) ? jogo.id : idx,
      temporada:
        typeof jogo.temporada === "number" && Number.isFinite(jogo.temporada)
          ? jogo.temporada
          : null,
      rodada:
        typeof jogo.rodada === "number" && Number.isFinite(jogo.rodada) ? jogo.rodada : 0,
      data: typeof jogo.data === "string" ? jogo.data.trim() : "",
      mando: typeof jogo.mando === "string" ? jogo.mando.trim() : "",
      adversario:
        typeof jogo.adversario === "string" && jogo.adversario.trim()
          ? jogo.adversario.trim()
          : "Adversário desconhecido",
      golsPro: gp,
      golsContra: gc,
      saldo,
      resultado,
      pontos,
      _origIdx: idx,
    });
  }

  validos.sort((a, b) => {
    if (a.data !== b.data) {
      if (!a.data) return 1;
      if (!b.data) return -1;
      return a.data < b.data ? -1 : 1;
    }
    if (a.rodada !== b.rodada) return a.rodada - b.rodada;
    if (a.id !== b.id) return a.id - b.id;
    return a._origIdx - b._origIdx;
  });

  return validos;
}

/**
 * Função pura: resume o desempenho de uma temporada a partir de uma lista de jogos.
 * Protege todas as médias/percentuais contra divisão por zero (nunca produz NaN/Infinity).
 */
export function resumirTemporada(jogos) {
  const ordenados = normalizarEOrdenarJogosTemporada(jogos);
  const totalJogos = ordenados.length;

  let pontos = 0;
  let vitorias = 0;
  let empates = 0;
  let derrotas = 0;
  let golsPro = 0;
  let golsContra = 0;
  let jogosSemSofrerGol = 0;
  let jogosCasa = 0;
  let jogosFora = 0;

  const seriePontosAcumulados = [];
  const jogosOrdenados = [];

  for (let i = 0; i < ordenados.length; i += 1) {
    const m = ordenados[i];
    pontos += m.pontos;
    if (m.resultado === "V") vitorias += 1;
    else if (m.resultado === "E") empates += 1;
    else derrotas += 1;

    golsPro += m.golsPro;
    golsContra += m.golsContra;
    if (m.golsContra === 0) jogosSemSofrerGol += 1;
    if (m.mando === "Casa") jogosCasa += 1;
    else if (m.mando === "Fora") jogosFora += 1;

    seriePontosAcumulados.push(pontos);
    jogosOrdenados.push({
      jogoNumero: i + 1,
      id: m.id,
      temporada: m.temporada,
      rodada: m.rodada,
      data: m.data,
      mando: m.mando,
      adversario: m.adversario,
      golsPro: m.golsPro,
      golsContra: m.golsContra,
      saldo: m.saldo,
      resultado: m.resultado,
      pontosJogo: m.pontos,
      pontosAcumulados: pontos,
    });
  }

  const pontosPossiveis = totalJogos * 3;
  const saldoGols = golsPro - golsContra;
  const aproveitamento = totalJogos > 0 ? (pontos / pontosPossiveis) * 100 : null;
  const mediaGolsPro = totalJogos > 0 ? golsPro / totalJogos : null;
  const mediaGolsContra = totalJogos > 0 ? golsContra / totalJogos : null;
  const taxaSemSofrerGol = totalJogos > 0 ? (jogosSemSofrerGol / totalJogos) * 100 : null;

  return {
    jogos: totalJogos,
    jogosCasa,
    jogosFora,
    pontos,
    pontosPossiveis,
    aproveitamento,
    vitorias,
    empates,
    derrotas,
    golsPro,
    mediaGolsPro,
    golsContra,
    mediaGolsContra,
    saldoGols,
    jogosSemSofrerGol,
    taxaSemSofrerGol,
    seriePontosAcumulados,
    jogosOrdenados,
  };
}

export function avaliarComparacaoMetrica(valorA, valorB, polaridade, mesmaTemporada, compararPermitido) {
  if (!compararPermitido || !Number.isFinite(valorA) || !Number.isFinite(valorB)) {
    return {
      diferenca: null,
      diferencaAbsoluta: null,
      vencedor: "neutral",
    };
  }

  if (mesmaTemporada) {
    return {
      diferenca: 0,
      diferencaAbsoluta: 0,
      vencedor: "neutral",
    };
  }

  const diferenca = valorA - valorB;
  const diferencaAbsoluta = Math.abs(diferenca);

  if (diferencaAbsoluta < 1e-9) {
    return {
      diferenca: 0,
      diferencaAbsoluta: 0,
      vencedor: polaridade === "neutral" ? "neutral" : "tie",
    };
  }

  if (polaridade === "neutral") {
    return {
      diferenca,
      diferencaAbsoluta,
      vencedor: "neutral",
    };
  }

  if (polaridade === "lower") {
    return {
      diferenca,
      diferencaAbsoluta,
      vencedor: valorA < valorB ? "A" : "B",
    };
  }

  return {
    diferenca,
    diferencaAbsoluta,
    vencedor: valorA > valorB ? "A" : "B",
  };
}

/**
 * Função pura: compara duas temporadas na base completa sob o mando escolhido
 * ("ALL" | "Casa" | "Fora"), respeitando polaridade das métricas, estado neutro
 * em empates / mesma temporada e alinhamento de séries de pontos acumulados com `null`.
 */
export function compararTemporadas(dadosCompletos, tempA, tempB, mando = "ALL") {
  const base = Array.isArray(dadosCompletos) ? dadosCompletos : [];
  const mandoNormalizado = normalizarMandoComparador(mando);
  const anoA = Number(tempA);
  const anoB = Number(tempB);
  const anoAValido = Number.isFinite(anoA);
  const anoBValido = Number.isFinite(anoB);
  const mesmaTemporada = anoAValido && anoBValido && anoA === anoB;

  const jogosA = [];
  const jogosB = [];

  for (let i = 0; i < base.length; i += 1) {
    const m = base[i];
    if (!m || typeof m !== "object") continue;
    if (mandoNormalizado !== "ALL" && m.mando !== mandoNormalizado) continue;
    if (anoAValido && m.temporada === anoA) jogosA.push(m);
    if (anoBValido && m.temporada === anoB) jogosB.push(m);
  }

  const resumoA = resumirTemporada(jogosA);
  const resumoB = resumirTemporada(jogosB);
  const ambosComJogos = resumoA.jogos > 0 && resumoB.jogos > 0;

  const valOuNulo = (resumo, campo) => (resumo.jogos > 0 ? resumo[campo] : null);

  const definicoes = [
    {
      chave: "jogos",
      rotulo: "Jogos disputados",
      tipo: "int",
      polaridade: "neutral",
      valorA: resumoA.jogos,
      valorB: resumoB.jogos,
      compararPermitido: true,
    },
    {
      chave: "pontos",
      rotulo: "Pontos conquistados",
      tipo: "int",
      polaridade: "higher",
      valorA: valOuNulo(resumoA, "pontos"),
      valorB: valOuNulo(resumoB, "pontos"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "aproveitamento",
      rotulo: "Aproveitamento",
      tipo: "pct",
      polaridade: "higher",
      valorA: resumoA.aproveitamento,
      valorB: resumoB.aproveitamento,
      compararPermitido: ambosComJogos,
    },
    {
      chave: "vitorias",
      rotulo: "Vitórias",
      tipo: "int",
      polaridade: "higher",
      valorA: valOuNulo(resumoA, "vitorias"),
      valorB: valOuNulo(resumoB, "vitorias"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "empates",
      rotulo: "Empates",
      tipo: "int",
      polaridade: "neutral",
      valorA: valOuNulo(resumoA, "empates"),
      valorB: valOuNulo(resumoB, "empates"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "derrotas",
      rotulo: "Derrotas",
      tipo: "int",
      polaridade: "lower",
      valorA: valOuNulo(resumoA, "derrotas"),
      valorB: valOuNulo(resumoB, "derrotas"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "golsPro",
      rotulo: "Gols Pró",
      tipo: "int",
      polaridade: "higher",
      valorA: valOuNulo(resumoA, "golsPro"),
      valorB: valOuNulo(resumoB, "golsPro"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "mediaGolsPro",
      rotulo: "Média de Gols Pró / jogo",
      tipo: "dec2",
      polaridade: "higher",
      valorA: resumoA.mediaGolsPro,
      valorB: resumoB.mediaGolsPro,
      compararPermitido: ambosComJogos,
    },
    {
      chave: "golsContra",
      rotulo: "Gols Contra",
      tipo: "int",
      polaridade: "lower",
      valorA: valOuNulo(resumoA, "golsContra"),
      valorB: valOuNulo(resumoB, "golsContra"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "mediaGolsContra",
      rotulo: "Média de Gols Contra / jogo",
      tipo: "dec2",
      polaridade: "lower",
      valorA: resumoA.mediaGolsContra,
      valorB: resumoB.mediaGolsContra,
      compararPermitido: ambosComJogos,
    },
    {
      chave: "saldoGols",
      rotulo: "Saldo de Gols",
      tipo: "signedInt",
      polaridade: "higher",
      valorA: valOuNulo(resumoA, "saldoGols"),
      valorB: valOuNulo(resumoB, "saldoGols"),
      compararPermitido: ambosComJogos,
    },
    {
      chave: "jogosSemSofrerGol",
      rotulo: "Jogos sem sofrer gol",
      tipo: "int",
      polaridade: "higher",
      valorA: valOuNulo(resumoA, "jogosSemSofrerGol"),
      valorB: valOuNulo(resumoB, "jogosSemSofrerGol"),
      subtextoA: resumoA.taxaSemSofrerGol !== null ? formatPct(resumoA.taxaSemSofrerGol) : "",
      subtextoB: resumoB.taxaSemSofrerGol !== null ? formatPct(resumoB.taxaSemSofrerGol) : "",
      compararPermitido: ambosComJogos,
    },
  ];

  let vitoriasMetricasA = 0;
  let vitoriasMetricasB = 0;
  let empatesMetricas = 0;
  let totalMetricasComparaveis = 0;

  const metricas = definicoes.map((def) => {
    const aval = avaliarComparacaoMetrica(
      def.valorA,
      def.valorB,
      def.polaridade,
      mesmaTemporada,
      def.compararPermitido
    );

    if (def.polaridade !== "neutral") {
      totalMetricasComparaveis += 1;
      if (aval.vencedor === "A") vitoriasMetricasA += 1;
      else if (aval.vencedor === "B") vitoriasMetricasB += 1;
      else if (aval.vencedor === "tie") empatesMetricas += 1;
    }

    return {
      chave: def.chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      polaridade: def.polaridade,
      valorA: def.valorA,
      valorB: def.valorB,
      subtextoA: def.subtextoA || "",
      subtextoB: def.subtextoB || "",
      diferenca: aval.diferenca,
      diferencaAbsoluta: aval.diferencaAbsoluta,
      vencedor: aval.vencedor,
    };
  });

  const maxJogos = Math.max(
    resumoA.seriePontosAcumulados.length,
    resumoB.seriePontosAcumulados.length
  );
  const labels = [];
  const serieA = [];
  const serieB = [];

  for (let i = 0; i < maxJogos; i += 1) {
    labels.push(`J${i + 1}`);
    serieA.push(
      i < resumoA.seriePontosAcumulados.length ? resumoA.seriePontosAcumulados[i] : null
    );
    serieB.push(
      i < resumoB.seriePontosAcumulados.length ? resumoB.seriePontosAcumulados[i] : null
    );
  }

  return {
    temporadaA: anoAValido ? anoA : null,
    temporadaB: anoBValido ? anoB : null,
    mando: mandoNormalizado,
    mesmaTemporada,
    resumoA,
    resumoB,
    metricas,
    placarMetricas: {
      vitoriasA: vitoriasMetricasA,
      vitoriasB: vitoriasMetricasB,
      empates: empatesMetricas,
      comparaveis: totalMetricasComparaveis,
    },
    evolucao: {
      maxJogos,
      labels,
      serieA,
      serieB,
      jogosA: resumoA.jogosOrdenados,
      jogosB: resumoB.jogosOrdenados,
    },
  };
}

// =========================================================================
// Próximo Jogo — Lógica Pura de Domínio e Confronto Direto
// =========================================================================

export function formatarDataProximoJogo(isoDate) {
  const parsed = parseIsoCalendarDate(isoDate);
  if (!parsed) return null;
  const weekday = WEEKDAYS_PT_SHORT[parsed.weekdayIndex];
  return `${weekday}, ${parsed.day}/${parsed.month}/${parsed.year}`;
}

export function formatarHoraProximoJogo(hora, horarioDefinido) {
  const horaValida = horarioDefinido === true ? parseHoraValida(hora) : null;
  if (horaValida) {
    return {
      texto: `${horaValida.horas}h${horaValida.minutos} (Brasília)`,
      definido: true,
    };
  }
  return {
    texto: "Horário a definir",
    definido: false,
  };
}

export function calcularSeloTemporalProximoJogo(isoDate, hojeIso = getTodayIsoBRT()) {
  const alvo = parseIsoCalendarDate(isoDate);
  const ref = parseIsoCalendarDate(hojeIso);
  if (!alvo || !ref) return null;

  const diffDays = Math.round((alvo.utcMs - ref.utcMs) / MS_PER_DAY);
  if (diffDays === 0) {
    return { texto: "Hoje", tom: "today", dias: 0 };
  }
  if (diffDays === 1) {
    return { texto: "Amanhã", tom: "tomorrow", dias: 1 };
  }
  if (diffDays > 1) {
    return { texto: `Em ${fmtInt.format(diffDays)} dias`, tom: "upcoming", dias: diffDays };
  }
  return { texto: "Aguardando atualização do resultado", tom: "past", dias: diffDays };
}

export function calcularEstadoTemporalJogo(jogo, agoraMs = Date.now()) {
  if (!jogo || typeof jogo !== "object") return null;

  const alvo = parseIsoCalendarDate(jogo.data);
  if (!alvo) return null;

  const msValido =
    typeof agoraMs === "number" && Number.isFinite(agoraMs) ? agoraMs : Date.now();
  const hojeBrtIso = getTodayIsoBRT(msValido);
  const seloData = calcularSeloTemporalProximoJogo(jogo.data, hojeBrtIso);
  if (!seloData) return null;

  const ehHoje = seloData.dias === 0;
  const horaValida = jogo.horario_definido === true ? parseHoraValida(jogo.hora) : null;

  // Sem horário definido ou hora ausente/inválida: nunca exibir "Bola rolando"
  if (!horaValida) {
    const encerrado = seloData.dias < 0;
    return {
      estado: encerrado ? "aguardando" : ehHoje ? "hoje" : "futuro",
      texto: seloData.texto,
      subtexto: null,
      tom: seloData.tom,
      dias: seloData.dias,
      minutosDecorridos: null,
      emAndamento: false,
      encerrado,
      ehHoje,
      deveAtualizar: ehHoje && !encerrado,
    };
  }

  // Data (YYYY-MM-DD) e hora (HH:MM) válidas: timestamp explícito em Brasília (-03:00)
  const dataIso = `${alvo.year}-${alvo.month}-${alvo.day}`;
  const inicioMs = new Date(`${dataIso}T${horaValida.formatada}:00-03:00`).getTime();
  if (!Number.isFinite(inicioMs)) {
    const encerrado = seloData.dias < 0;
    return {
      estado: encerrado ? "aguardando" : ehHoje ? "hoje" : "futuro",
      texto: seloData.texto,
      subtexto: null,
      tom: seloData.tom,
      dias: seloData.dias,
      minutosDecorridos: null,
      emAndamento: false,
      encerrado,
      ehHoje,
      deveAtualizar: ehHoje && !encerrado,
    };
  }

  const minutosDecorridos = (msValido - inicioMs) / MS_PER_MINUTE;

  // 1. Antes do apito inicial
  if (minutosDecorridos < 0) {
    const seloAntes =
      seloData.dias < 0 ? { texto: "Hoje", tom: "today", dias: 0 } : seloData;
    const antesHoje = seloAntes.dias === 0;
    return {
      estado: antesHoje ? "hoje" : "futuro",
      texto: seloAntes.texto,
      subtexto: null,
      tom: seloAntes.tom,
      dias: seloAntes.dias,
      minutosDecorridos,
      emAndamento: false,
      encerrado: false,
      ehHoje: antesHoje,
      deveAtualizar: antesHoje,
    };
  }

  // 2. Janela estimada da partida: 0 <= minutosDecorridos < 135 (início até +2h15min)
  if (minutosDecorridos < MATCH_WINDOW_MINUTES) {
    return {
      estado: "em_andamento",
      texto: "Bola rolando",
      subtexto: MATCH_LIVE_SUBTEXT,
      tom: "live",
      dias: seloData.dias,
      minutosDecorridos,
      emAndamento: true,
      encerrado: false,
      ehHoje,
      deveAtualizar: true,
    };
  }

  // 3. Após 2h15min: aguardando atualização do pipeline
  return {
    estado: "aguardando",
    texto: "Aguardando atualização do resultado",
    subtexto: null,
    tom: "past",
    dias: seloData.dias,
    minutosDecorridos,
    emAndamento: false,
    encerrado: true,
    ehHoje,
    deveAtualizar: false,
  };
}

export function resolverAdversarioNaBase(adversario, clubsLookup) {
  if (typeof adversario !== "string" || !adversario.trim()) return null;
  if (!(clubsLookup instanceof Map) || clubsLookup.size === 0) return null;
  const canonical = clubsLookup.get(normalizeText(adversario));
  if (!canonical || canonical === "ALL" || canonical === "CLASSICOS") return null;
  return canonical;
}

export function calcularResumoConfronto(canonicalOpponent, matches) {
  if (!canonicalOpponent || !Array.isArray(matches) || matches.length === 0) return null;
  const h2hMatches = matches.filter((m) => m && m.adversario === canonicalOpponent);
  if (h2hMatches.length === 0) return null;
  const summary = computeSummary(h2hMatches);
  return {
    games: summary.games,
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    winrate: summary.winrate,
  };
}

export function montarModeloProximoJogo(payload, opcoes = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { estado: "oculto" };
  }

  const atualizadoEmFormatado =
    typeof payload.atualizado_em === "string" && payload.atualizado_em.trim()
      ? formatDateTimeBRT(payload.atualizado_em)
      : null;

  if (payload.tem_proximo_jogo === false || payload.proximo_jogo === null) {
    return {
      estado: "sem_jogo",
      mensagem: "Nenhum jogo do Brasileirão agendado no momento",
      atualizadoEmFormatado,
    };
  }

  if (
    payload.tem_proximo_jogo !== true ||
    typeof payload.proximo_jogo !== "object" ||
    Array.isArray(payload.proximo_jogo)
  ) {
    return { estado: "oculto" };
  }

  const pj = payload.proximo_jogo;
  const adversario = typeof pj.adversario === "string" ? pj.adversario.trim() : "";
  const dataFormatada = formatarDataProximoJogo(pj.data);
  if (!adversario || !dataFormatada) {
    return { estado: "oculto" };
  }

  const mandoRaw = typeof pj.mando === "string" ? pj.mando.trim() : "";
  const mando = mandoRaw === "Casa" ? "Casa" : mandoRaw === "Fora" ? "Fora" : null;
  const spfcEsquerda = mando !== "Fora";
  const timeEsquerda = spfcEsquerda ? "São Paulo" : adversario;
  const timeDireita = spfcEsquerda ? adversario : "São Paulo";

  const competicao =
    typeof pj.competicao === "string" && pj.competicao.trim()
      ? pj.competicao.trim()
      : "Brasileirão Série A";
  const rodada =
    typeof pj.rodada === "number" && Number.isInteger(pj.rodada) && pj.rodada > 0
      ? pj.rodada
      : null;
  const competicaoRodada = rodada ? `${competicao} · Rodada ${rodada}` : competicao;

  const horario = formatarHoraProximoJogo(pj.hora, pj.horario_definido);
  let seloTemporal;
  if (typeof opcoes.agoraMs === "number" && Number.isFinite(opcoes.agoraMs)) {
    seloTemporal = calcularEstadoTemporalJogo(pj, opcoes.agoraMs);
  } else if (typeof opcoes.hojeIso === "string" && opcoes.hojeIso.trim()) {
    const seloLegado = calcularSeloTemporalProximoJogo(pj.data, opcoes.hojeIso);
    seloTemporal = seloLegado
      ? {
          estado:
            seloLegado.dias < 0
              ? "aguardando"
              : seloLegado.dias === 0
                ? "hoje"
                : "futuro",
          texto: seloLegado.texto,
          subtexto: null,
          tom: seloLegado.tom,
          dias: seloLegado.dias,
          minutosDecorridos: null,
          emAndamento: false,
          encerrado: seloLegado.dias < 0,
          ehHoje: seloLegado.dias === 0,
          deveAtualizar: false,
        }
      : null;
  } else {
    seloTemporal = calcularEstadoTemporalJogo(pj, Date.now());
  }

  const baseCarregada = Boolean(opcoes.baseCarregada);
  const baseFalhou = Boolean(opcoes.baseFalhou);
  const clubsLookup = opcoes.clubsLookup instanceof Map ? opcoes.clubsLookup : new Map();
  const matches = Array.isArray(opcoes.matches) ? opcoes.matches : [];

  const adversarioCanonico = baseCarregada
    ? resolverAdversarioNaBase(adversario, clubsLookup)
    : null;
  const confrontoInedito = Boolean(baseCarregada && !adversarioCanonico);
  const resumoHistorico = adversarioCanonico
    ? calcularResumoConfronto(adversarioCanonico, matches)
    : null;

  return {
    estado: "disponivel",
    adversario,
    adversarioCanonico,
    confrontoInedito,
    baseCarregada,
    baseFalhou,
    mando,
    timeEsquerda,
    timeDireita,
    spfcEsquerda,
    competicaoRodada,
    dataFormatada,
    horario,
    seloTemporal,
    jogoTemporal: {
      data: pj.data,
      hora: pj.hora,
      horario_definido: pj.horario_definido,
    },
    resumoHistorico,
    atualizadoEmFormatado,
  };
}

// =========================================================================
// Sincronização de Controles DOM de Filtros e Compartilhamento de Link
// =========================================================================

export function populateFilterSelects(dom, bounds) {
  const seasonStartEl = dom["filter-season-start"];
  const seasonEndEl = dom["filter-season-end"];
  const oppEl = dom["filter-opponent"];

  seasonStartEl.replaceChildren();
  seasonEndEl.replaceChildren();
  for (let y = bounds.minSeason; y <= bounds.maxSeason; y += 1) {
    seasonStartEl.add(new Option(String(y), String(y)));
    seasonEndEl.add(new Option(String(y), String(y)));
  }

  // Remove optgroup anterior caso repopulado
  const existingOptGroup = oppEl.querySelector("optgroup");
  if (existingOptGroup) {
    existingOptGroup.remove();
  }

  const optGroup = document.createElement("optgroup");
  optGroup.label = "Adversários (A–Z)";
  for (const opp of bounds.opponents) {
    optGroup.appendChild(new Option(opp, opp));
  }
  oppEl.appendChild(optGroup);
}

export function syncTableFilterControlsUI(dom, state, bounds) {
  if (
    dom["table-search"] &&
    document.activeElement !== dom["table-search"] &&
    dom["table-search"].value !== state.tableSearch
  ) {
    dom["table-search"].value = state.tableSearch;
  }

  document.querySelectorAll("[data-result]").forEach((btn) => {
    const active = btn.dataset.result === state.tableResult;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  dom["btn-reset-filters"].disabled = isDefaultFilterState(state, bounds);
}

export function syncFilterControlsUI(dom, state, bounds, filteredCount, totalCount) {
  dom["filter-season-start"].value = String(state.seasonStart);
  dom["filter-season-end"].value = String(state.seasonEnd);
  dom["filter-opponent"].value = state.opponent;

  document.querySelectorAll("[data-venue]").forEach((btn) => {
    const active = btn.dataset.venue === state.venue;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  // Sincroniza pílulas/chips de período
  document.querySelectorAll("[data-preset-period]").forEach((btn) => {
    const active = isPeriodPresetActive(btn.dataset.presetPeriod, state, bounds);
    btn.classList.toggle("is-active", active);
  });

  // Sincroniza chips de clássicos
  document.querySelectorAll("[data-preset-opponent]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.presetOpponent === state.opponent);
  });

  syncTableFilterControlsUI(dom, state, bounds);

  dom["filter-status-count"].textContent = `Exibindo ${fmtInt.format(filteredCount)} de ${fmtInt.format(totalCount)} partidas`;
}

export async function copyTextToClipboard(text) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Segue para o fallback abaixo se a Clipboard API falhar ou negar permissão
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  return copied;
}

export function createShareLinkHandler({ dom, onBeforeCopy }) {
  let shareFeedbackTimer = null;

  function showShareFeedback(success) {
    const btn = dom["btn-share-link"];
    const labelEl = dom["btn-share-label"];
    const liveEl = dom["share-feedback-live"];
    if (!btn || !labelEl) return;

    const iconCopy = btn.querySelector(".btn-share-icon-copy");
    const iconCheck = btn.querySelector(".btn-share-icon-check");

    if (shareFeedbackTimer) {
      window.clearTimeout(shareFeedbackTimer);
      shareFeedbackTimer = null;
    }

    btn.classList.remove("is-copied", "is-error");
    if (success) {
      btn.classList.add("is-copied");
      labelEl.textContent = "Link copiado!";
      if (iconCopy) iconCopy.classList.add("is-hidden");
      if (iconCheck) iconCheck.classList.remove("is-hidden");
      if (liveEl) liveEl.textContent = "Link com os filtros atuais copiado para a área de transferência.";
    } else {
      btn.classList.add("is-error");
      labelEl.textContent = "Não copiado";
      if (iconCopy) iconCopy.classList.remove("is-hidden");
      if (iconCheck) iconCheck.classList.add("is-hidden");
      if (liveEl) liveEl.textContent = "Não foi possível copiar o link automaticamente.";
    }

    shareFeedbackTimer = window.setTimeout(() => {
      btn.classList.remove("is-copied", "is-error");
      labelEl.textContent = "Copiar link";
      if (iconCopy) iconCopy.classList.remove("is-hidden");
      if (iconCheck) iconCheck.classList.add("is-hidden");
      if (liveEl) liveEl.textContent = "";
      shareFeedbackTimer = null;
    }, 2000);
  }

  return async function handleShareLinkClick() {
    if (typeof onBeforeCopy === "function") {
      onBeforeCopy();
    }
    const copied = await copyTextToClipboard(window.location.href);
    showShareFeedback(copied);
  };
}

export function bindFilterEvents({ dom, state, bounds, onFilterChange, onReset, onShare }) {
  dom["filter-season-start"].addEventListener("change", (e) => {
    const val = Number(e.target.value);
    state.seasonStart = val;
    if (state.seasonEnd < val) state.seasonEnd = val;
    state.tablePage = 1;
    onFilterChange();
  });

  dom["filter-season-end"].addEventListener("change", (e) => {
    const val = Number(e.target.value);
    state.seasonEnd = val;
    if (state.seasonStart > val) state.seasonStart = val;
    state.tablePage = 1;
    onFilterChange();
  });

  dom["filter-opponent"].addEventListener("change", (e) => {
    state.opponent = e.target.value;
    state.tablePage = 1;
    onFilterChange();
  });

  document.querySelectorAll("[data-venue]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.venue = btn.dataset.venue;
      state.tablePage = 1;
      onFilterChange();
    });
  });

  document.querySelectorAll("[data-preset-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = resolvePeriodPreset(btn.dataset.presetPeriod, bounds);
      if (!range) return;
      state.seasonStart = range.seasonStart;
      state.seasonEnd = range.seasonEnd;
      state.tablePage = 1;
      onFilterChange();
    });
  });

  document.querySelectorAll("[data-preset-opponent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.presetOpponent;
      state.opponent = state.opponent === target ? "ALL" : target;
      state.tablePage = 1;
      onFilterChange();
    });
  });

  if (dom["btn-share-link"] && typeof onShare === "function") {
    dom["btn-share-link"].addEventListener("click", onShare);
  }
  dom["btn-reset-filters"].addEventListener("click", onReset);
  dom["btn-empty-reset"].addEventListener("click", onReset);
}

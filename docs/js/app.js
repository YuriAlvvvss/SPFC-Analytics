/**
 * Dados Tricolor — Aplicação Front-end (JS puro + Chart.js 4)
 * Carrega `data/spfc_pontos_corridos.json` e alimenta filtros, KPIs, gráficos e tabela.
 */

(() => {
  "use strict";

  const DATA_URL = "data/spfc_pontos_corridos.json";
  const META_URL = "data/meta.json";
  const CLASSICOS = new Set(["Corinthians", "Palmeiras", "Santos"]);
  const TITULOS_SPFC = new Set([2006, 2007, 2008]);
  const VALID_VENUES = new Map([
    ["casa", "Casa"],
    ["fora", "Fora"],
  ]);
  const VALID_RESULTS = new Set(["V", "E", "D"]);
  const MAX_SEARCH_URL_LENGTH = 120;

  const COLORS = {
    red: "#D5001C",
    redSoft: "rgba(213, 0, 28, 0.14)",
    black: "#111315",
    charcoal: "#272B33",
    win: "#16A34A",
    draw: "#CBD5E1",
    loss: "#1F2937",
    yellow: "#EAB308",
    yellowBorder: "#CA8A04",
    cardRed: "#DC2626",
    grid: "#EEF0F4",
    tick: "#6B7280",
  };

  // Formatadores pt-BR
  const fmtInt = new Intl.NumberFormat("pt-BR");
  const fmtDec1 = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const fmtDec2 = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Estado global (limites de temporada calculados dinamicamente a partir dos dados)
  let allMatches = [];
  let datasetMeta = null;
  let minSeason = 2003;
  let maxSeason = 2003;
  let modernStart = 2014;
  let validSeasons = new Set();
  let opponentLookup = new Map();
  let shareFeedbackTimer = null;

  const state = {
    seasonStart: 2003,
    seasonEnd: 2003,
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

  const charts = {
    evolution: null,
    venue: null,
    scorers: null,
    secondary: null,
  };

  // Cache de elementos DOM
  const dom = {};

  function cacheDom() {
    const ids = [
      "brand-subtitle",
      "header-dataset-badge",
      "header-updated-badge",
      "header-updated-text",
      "chip-period-all",
      "chip-period-modern",
      "chip-period-current",
      "filter-season-start",
      "filter-season-end",
      "filter-opponent",
      "btn-share-link",
      "btn-share-label",
      "share-feedback-live",
      "btn-reset-filters",
      "filter-status-count",
      "state-loading",
      "state-error",
      "state-error-message",
      "dashboard-root",
      "empty-filter-banner",
      "empty-filter-detail",
      "btn-empty-reset",
      "kpi-seasons-tag",
      "kpi-games",
      "kpi-games-split",
      "kpi-points-tag",
      "kpi-winrate",
      "kpi-winrate-bar",
      "kpi-points-detail",
      "kpi-wins",
      "kpi-draws",
      "kpi-losses",
      "kpi-bar-win",
      "kpi-bar-draw",
      "kpi-bar-loss",
      "kpi-ved-pct",
      "kpi-gd-badge",
      "kpi-gf",
      "kpi-ga",
      "kpi-goals-avg",
      "kpi-yellow-total",
      "kpi-yellow-avg",
      "kpi-red-total",
      "kpi-red-avg",
      "kpi-cards-coverage",
      "evolution-title",
      "evolution-subtitle",
      "btn-back-all-seasons",
      "chart-evolution",
      "empty-evolution",
      "venue-subtitle",
      "chart-venue",
      "empty-venue",
      "venue-home-games",
      "venue-home-stats",
      "venue-away-games",
      "venue-away-stats",
      "scorers-subtitle",
      "scorers-coverage-badge",
      "chart-scorers",
      "empty-scorers",
      "empty-scorers-text",
      "btn-jump-modern-scorers",
      "secondary-title",
      "secondary-subtitle",
      "chart-secondary",
      "empty-secondary",
      "empty-secondary-text",
      "btn-jump-modern-cards",
      "table-total-badge",
      "table-search",
      "matches-tbody",
      "pagination-info",
      "table-page-size",
      "btn-prev-page",
      "btn-next-page",
      "page-indicator",
      "footer-range-all",
      "footer-games-all",
      "footer-range-modern",
      "footer-games-modern",
      "footer-updated-at",
    ];
    for (const id of ids) {
      dom[id] = document.getElementById(id);
    }
  }

  // =========================================================================
  // Utilitários seguros (zero NaN / XSS-safe)
  // =========================================================================

  function safePct(num, den) {
    return den > 0 ? (num / den) * 100 : null;
  }

  function safeAvg(num, den) {
    return den > 0 ? num / den : null;
  }

  function formatPct(value) {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${fmtDec1.format(value)}%`;
  }

  function formatAvg(value, decimals = 2) {
    if (value === null || !Number.isFinite(value)) return "—";
    return decimals === 1 ? fmtDec1.format(value) : fmtDec2.format(value);
  }

  function formatSigned(value) {
    if (value > 0) return `+${fmtInt.format(value)}`;
    return fmtInt.format(value);
  }

  function formatDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== "string") return "—";
    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return isoDate;
    return `${day}/${month}/${year}`;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function setChartEmptyState(canvasEl, emptyEl, isEmpty) {
    canvasEl.classList.toggle("is-hidden", isEmpty);
    emptyEl.classList.toggle("is-hidden", !isEmpty);
  }

  function computeSummary(matches) {
    const games = matches.length;
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

    for (const m of matches) {
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
      if (m.cartoes_amarelos !== null && m.cartoes_vermelhos !== null) {
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

  // =========================================================================
  // Filtragem e Sincronização de Controles
  // =========================================================================

  function getFilteredMatches() {
    return allMatches.filter((m) => {
      if (m.temporada < state.seasonStart || m.temporada > state.seasonEnd) {
        return false;
      }
      if (state.opponent === "CLASSICOS") {
        if (!CLASSICOS.has(m.adversario)) return false;
      } else if (state.opponent !== "ALL") {
        if (m.adversario !== state.opponent) return false;
      }
      if (state.venue !== "ALL" && m.mando !== state.venue) {
        return false;
      }
      return true;
    });
  }

  function isDefaultFilter() {
    return (
      state.seasonStart === minSeason &&
      state.seasonEnd === maxSeason &&
      state.opponent === "ALL" &&
      state.venue === "ALL" &&
      state.tableResult === "ALL" &&
      state.tableSearch.trim() === ""
    );
  }

  function syncTableFilterControlsUI() {
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

    dom["btn-reset-filters"].disabled = isDefaultFilter();
  }

  function syncFilterControlsUI(filteredCount) {
    dom["filter-season-start"].value = String(state.seasonStart);
    dom["filter-season-end"].value = String(state.seasonEnd);
    dom["filter-opponent"].value = state.opponent;

    document.querySelectorAll("[data-venue]").forEach((btn) => {
      const active = btn.dataset.venue === state.venue;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    // Sincroniza chips de período
    document.querySelectorAll("[data-preset-period]").forEach((btn) => {
      const p = btn.dataset.presetPeriod;
      let active = false;
      if (p === "ALL") active = state.seasonStart === minSeason && state.seasonEnd === maxSeason;
      else if (p === "TRI") active = state.seasonStart === 2006 && state.seasonEnd === 2008;
      else if (p === "MODERN") active = state.seasonStart === modernStart && state.seasonEnd === maxSeason;
      else if (p === "LAST5") active = state.seasonStart === Math.max(minSeason, maxSeason - 4) && state.seasonEnd === maxSeason;
      else if (p === "CURRENT") active = state.seasonStart === maxSeason && state.seasonEnd === maxSeason;
      btn.classList.toggle("is-active", active);
    });

    // Sincroniza chips de clássicos
    document.querySelectorAll("[data-preset-opponent]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.presetOpponent === state.opponent);
    });

    syncTableFilterControlsUI();

    const total = allMatches.length;
    dom["filter-status-count"].textContent = `Exibindo ${fmtInt.format(filteredCount)} de ${fmtInt.format(total)} partidas`;
  }

  // =========================================================================
  // Sincronização Bidirecional com a URL (Query Parameters) e Compartilhamento
  // =========================================================================

  function parseValidSeasonParam(rawValue) {
    if (typeof rawValue !== "string") return null;
    const trimmed = rawValue.trim();
    if (!/^\d{4}$/.test(trimmed)) return null;
    const year = Number(trimmed);
    return validSeasons.has(year) ? year : null;
  }

  function applyFiltersFromUrl() {
    if (!window.location.search) return;

    try {
      const params = new URLSearchParams(window.location.search);

      // Intervalo de temporadas: de / ate
      const parsedStart = parseValidSeasonParam(params.get("de"));
      const parsedEnd = parseValidSeasonParam(params.get("ate"));

      if (parsedStart !== null) {
        state.seasonStart = parsedStart;
      }
      if (parsedEnd !== null) {
        state.seasonEnd = parsedEnd;
      }
      if (state.seasonStart > state.seasonEnd) {
        const tmp = state.seasonStart;
        state.seasonStart = state.seasonEnd;
        state.seasonEnd = tmp;
      }

      // Adversário (aceita correspondência exata ou normalizada sem acentos/maiúsculas)
      const rawOpponent = params.get("adversario");
      if (typeof rawOpponent === "string" && rawOpponent.trim()) {
        const canonicalOpponent = opponentLookup.get(normalizeText(rawOpponent));
        if (canonicalOpponent) {
          state.opponent = canonicalOpponent;
        }
      }

      // Mando de campo (Casa | Fora)
      const rawVenue = params.get("mando");
      if (typeof rawVenue === "string" && rawVenue.trim()) {
        const canonicalVenue = VALID_VENUES.get(normalizeText(rawVenue));
        if (canonicalVenue) {
          state.venue = canonicalVenue;
        }
      }

      // Resultado na tabela (V | E | D)
      const rawResult = params.get("resultado");
      if (typeof rawResult === "string" && rawResult.trim()) {
        const upperResult = rawResult.trim().toUpperCase();
        if (VALID_RESULTS.has(upperResult)) {
          state.tableResult = upperResult;
        }
      }

      // Busca textual na tabela
      const rawSearch = params.get("busca");
      if (typeof rawSearch === "string") {
        const cleanedSearch = rawSearch.trim().slice(0, MAX_SEARCH_URL_LENGTH);
        if (cleanedSearch) {
          state.tableSearch = cleanedSearch;
        }
      }
    } catch {
      // Fallback seguro: ignora query string malformada sem quebrar a página
    }
  }

  function buildUrlFromState() {
    const params = new URLSearchParams();

    if (state.seasonStart !== minSeason) {
      params.set("de", String(state.seasonStart));
    }
    if (state.seasonEnd !== maxSeason) {
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
    const trimmedSearch = state.tableSearch.trim();
    if (trimmedSearch) {
      params.set("busca", trimmedSearch);
    }

    const queryString = params.toString();
    const pathname = window.location.pathname;
    const hash = window.location.hash;
    return `${pathname}${queryString ? `?${queryString}` : ""}${hash}`;
  }

  function syncUrlWithState() {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    const nextUrl = buildUrlFromState();
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;
    try {
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // Ignora silenciosamente em ambientes com History API restrita
    }
  }

  async function copyTextToClipboard(text) {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function" &&
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

  async function handleShareLinkClick() {
    syncUrlWithState();
    const copied = await copyTextToClipboard(window.location.href);
    showShareFeedback(copied);
  }

  function describeActiveFilters() {
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
  // Renderização dos KPIs
  // =========================================================================

  function renderKPIs(matches) {
    const s = computeSummary(matches);

    // Banner global de estado vazio
    const isEmpty = s.games === 0;
    dom["empty-filter-banner"].classList.toggle("is-hidden", !isEmpty);
    if (isEmpty) {
      dom["empty-filter-detail"].textContent = `Recorte sem partidas: ${describeActiveFilters()}.`;
    }

    // Card 1: Partidas
    dom["kpi-games"].textContent = fmtInt.format(s.games);
    dom["kpi-seasons-tag"].textContent =
      s.seasonsCount === 1 ? "1 temp." : `${fmtInt.format(s.seasonsCount)} temps.`;
    dom["kpi-games-split"].textContent = `${fmtInt.format(s.homeGames)} Casa · ${fmtInt.format(s.awayGames)} Fora`;

    // Card 2: Aproveitamento
    dom["kpi-winrate"].textContent = formatPct(s.winrate);
    dom["kpi-points-tag"].textContent = `${fmtInt.format(s.points)} pts`;
    dom["kpi-winrate-bar"].style.width = `${s.winrate !== null ? Math.min(100, Math.max(0, s.winrate)) : 0}%`;
    dom["kpi-points-detail"].textContent =
      s.games > 0
        ? `${fmtInt.format(s.points)} de ${fmtInt.format(s.maxPoints)} pontos possíveis`
        : "Sem partidas no recorte";

    // Card 3: Retrospecto V/E/D
    dom["kpi-wins"].textContent = fmtInt.format(s.wins);
    dom["kpi-draws"].textContent = fmtInt.format(s.draws);
    dom["kpi-losses"].textContent = fmtInt.format(s.losses);
    dom["kpi-bar-win"].style.width = `${s.winPct ?? 0}%`;
    dom["kpi-bar-draw"].style.width = `${s.drawPct ?? 0}%`;
    dom["kpi-bar-loss"].style.width = `${s.lossPct ?? 0}%`;
    dom["kpi-ved-pct"].textContent =
      s.games > 0
        ? `${formatPct(s.winPct)} V · ${formatPct(s.drawPct)} E · ${formatPct(s.lossPct)} D`
        : "Sem distribuição de resultados";

    // Card 4: Gols & Saldo
    dom["kpi-gf"].textContent = fmtInt.format(s.gf);
    dom["kpi-ga"].textContent = fmtInt.format(s.ga);
    const gdBadge = dom["kpi-gd-badge"];
    gdBadge.textContent = `SG ${formatSigned(s.gd)}`;
    gdBadge.classList.remove("kpi-tag--pos", "kpi-tag--neg");
    if (s.gd > 0) gdBadge.classList.add("kpi-tag--pos");
    else if (s.gd < 0) gdBadge.classList.add("kpi-tag--neg");

    dom["kpi-goals-avg"].textContent =
      s.games > 0
        ? `Média: ${formatAvg(s.gfAvg)} GP · ${formatAvg(s.gaAvg)} GC / jogo`
        : "Média: —";

    // Card 5: Disciplina (Garantia 1: média dividida apenas por s.cardGames)
    if (s.cardGames === 0) {
      dom["kpi-yellow-total"].textContent = "—";
      dom["kpi-yellow-avg"].textContent = "—";
      dom["kpi-red-total"].textContent = "—";
      dom["kpi-red-avg"].textContent = "—";
      dom["kpi-cards-coverage"].textContent =
        s.games === 0
          ? "Nenhuma partida no filtro"
          : `Sem registros (cobertura ${modernStart}–${maxSeason})`;
    } else {
      dom["kpi-yellow-total"].textContent = fmtInt.format(s.yellowTotal);
      dom["kpi-yellow-avg"].textContent = `${formatAvg(s.yellowAvg)} / jogo`;
      dom["kpi-red-total"].textContent = fmtInt.format(s.redTotal);
      dom["kpi-red-avg"].textContent = `${formatAvg(s.redAvg)} / jogo`;

      if (s.cardGames < s.games) {
        dom["kpi-cards-coverage"].textContent = `Base: ${fmtInt.format(s.cardGames)} de ${fmtInt.format(s.games)} jogos (${modernStart}–${maxSeason})`;
      } else {
        const labelJogos = s.cardGames === 1 ? "jogo" : "jogos";
        dom["kpi-cards-coverage"].textContent = `Média em ${fmtInt.format(s.cardGames)} ${labelJogos} (${modernStart}–${maxSeason})`;
      }
    }
  }

  // =========================================================================
  // Gráfico 1: Evolução por Temporada / Rodada a Rodada
  // =========================================================================

  function renderEvolutionChart(matches) {
    const canvas = dom["chart-evolution"];
    const emptyEl = dom["empty-evolution"];

    const isSingleSeasonFilter = state.seasonStart === state.seasonEnd;
    dom["btn-back-all-seasons"].classList.toggle("is-hidden", !isSingleSeasonFilter);

    if (matches.length === 0 || typeof Chart === "undefined") {
      destroyChart("evolution");
      setChartEmptyState(canvas, emptyEl, true);
      dom["evolution-title"].textContent = isSingleSeasonFilter
        ? `Campanha na Temporada ${state.seasonStart}`
        : "Evolução por Temporada";
      dom["evolution-subtitle"].textContent = "Sem partidas para o recorte atual";
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);

    // Agrupa por temporada
    const bySeason = new Map();
    for (const m of matches) {
      if (!bySeason.has(m.temporada)) bySeason.set(m.temporada, []);
      bySeason.get(m.temporada).push(m);
    }
    const seasons = [...bySeason.keys()].sort((a, b) => a - b);

    // Visão detalhada rodada a rodada quando apenas 1 temporada está ativa
    if (seasons.length === 1) {
      const seasonYear = seasons[0];
      const seasonMatches = [...bySeason.get(seasonYear)].sort(
        (a, b) => a.rodada - b.rodada || a.data.localeCompare(b.data)
      );
      const isTitle = TITULOS_SPFC.has(seasonYear);
      dom["evolution-title"].textContent = `Campanha Rodada a Rodada — ${seasonYear}${isTitle ? " ★" : ""}`;
      dom["evolution-subtitle"].textContent =
        state.evolutionMode === "performance"
          ? "Evolução acumulada de aproveitamento (%) e pontos ao longo das rodadas filtradas"
          : "Evolução acumulada de Gols Pró vs. Gols Contra ao longo das rodadas filtradas";

      const labels = seasonMatches.map((m) => `R${m.rodada}`);
      let cumPts = 0;
      let cumGf = 0;
      let cumGa = 0;
      const cumPtsSeries = [];
      const cumWrSeries = [];
      const cumGfSeries = [];
      const cumGaSeries = [];
      const pointColors = [];

      seasonMatches.forEach((m, idx) => {
        cumPts += m.pontos;
        cumGf += m.gols_pro;
        cumGa += m.gols_contra;
        cumPtsSeries.push(cumPts);
        cumWrSeries.push(Number(((cumPts / ((idx + 1) * 3)) * 100).toFixed(1)));
        cumGfSeries.push(cumGf);
        cumGaSeries.push(cumGa);
        pointColors.push(
          m.resultado === "V" ? COLORS.win : m.resultado === "E" ? "#94A3B8" : COLORS.loss
        );
      });

      destroyChart("evolution");

      if (state.evolutionMode === "performance") {
        charts.evolution = new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                type: "bar",
                label: "Pontos acumulados",
                data: cumPtsSeries,
                backgroundColor: "rgba(17, 19, 21, 0.14)",
                borderColor: "rgba(17, 19, 21, 0.35)",
                borderWidth: 1,
                borderRadius: 4,
                yAxisID: "yPts",
                order: 2,
              },
              {
                type: "line",
                label: "Aproveitamento acumulado (%)",
                data: cumWrSeries,
                borderColor: COLORS.red,
                backgroundColor: COLORS.redSoft,
                borderWidth: 2.5,
                tension: 0.25,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: pointColors,
                pointBorderColor: "#FFFFFF",
                pointBorderWidth: 1.5,
                yAxisID: "yPct",
                order: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  title(items) {
                    const m = seasonMatches[items[0].dataIndex];
                    return `Rodada ${m.rodada} (${formatDateBR(m.data)}) — ${m.mando} vs ${m.adversario}`;
                  },
                  afterTitle(items) {
                    const m = seasonMatches[items[0].dataIndex];
                    return `Placar SPFC: ${m.gols_pro} × ${m.gols_contra} (${m.resultado})`;
                  },
                  label(ctx) {
                    if (ctx.dataset.yAxisID === "yPct") {
                      return `Aproveitamento: ${fmtDec1.format(ctx.parsed.y)}%`;
                    }
                    return `Pontos acumulados: ${ctx.parsed.y} pts`;
                  },
                },
              },
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: COLORS.tick } },
              yPts: {
                position: "left",
                beginAtZero: true,
                title: { display: true, text: "Pontos", color: COLORS.tick },
                grid: { color: COLORS.grid },
                ticks: { color: COLORS.tick },
              },
              yPct: {
                position: "right",
                min: 0,
                max: 100,
                title: { display: true, text: "Aproveitamento (%)", color: COLORS.red },
                grid: { drawOnChartArea: false },
                ticks: { color: COLORS.red, callback: (v) => `${v}%` },
              },
            },
          },
        });
      } else {
        charts.evolution = new Chart(canvas, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Gols Pró acumulados",
                data: cumGfSeries,
                borderColor: COLORS.red,
                backgroundColor: COLORS.redSoft,
                fill: true,
                borderWidth: 2.5,
                tension: 0.2,
                pointRadius: 3,
              },
              {
                label: "Gols Contra acumulados",
                data: cumGaSeries,
                borderColor: COLORS.black,
                backgroundColor: "rgba(17, 19, 21, 0.06)",
                fill: true,
                borderWidth: 2,
                borderDash: [5, 4],
                tension: 0.2,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
              tooltip: {
                callbacks: {
                  title(items) {
                    const m = seasonMatches[items[0].dataIndex];
                    return `Rodada ${m.rodada} (${formatDateBR(m.data)}) — ${m.mando} vs ${m.adversario} (${m.gols_pro}×${m.gols_contra})`;
                  },
                  afterBody(items) {
                    const idx = items[0].dataIndex;
                    const sg = cumGfSeries[idx] - cumGaSeries[idx];
                    return `Saldo acumulado: ${formatSigned(sg)}`;
                  },
                },
              },
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: COLORS.tick } },
              y: {
                beginAtZero: true,
                grid: { color: COLORS.grid },
                ticks: { color: COLORS.tick, precision: 0 },
              },
            },
          },
        });
      }
      return;
    }

    // Visão multi-temporada
    dom["evolution-title"].textContent = "Evolução por Temporada";
    dom["evolution-subtitle"].textContent =
      "Clique em qualquer ano para filtrar a campanha específica · ★ Tricampeonato (2006–2008)";

    const statsBySeason = seasons.map((year) => ({
      year,
      ...computeSummary(bySeason.get(year)),
    }));
    const labels = statsBySeason.map((s) => (TITULOS_SPFC.has(s.year) ? `${s.year} ★` : String(s.year)));

    destroyChart("evolution");

    const onSeasonClick = (_event, elements) => {
      if (!elements || elements.length === 0) return;
      const clickedYear = statsBySeason[elements[0].index].year;
      state.seasonStart = clickedYear;
      state.seasonEnd = clickedYear;
      state.tablePage = 1;
      updateDashboard();
    };

    if (state.evolutionMode === "performance") {
      charts.evolution = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              type: "bar",
              label: "Vitórias",
              data: statsBySeason.map((s) => s.wins),
              backgroundColor: "rgba(22, 163, 74, 0.82)",
              stack: "ved",
              yAxisID: "yGames",
              order: 2,
            },
            {
              type: "bar",
              label: "Empates",
              data: statsBySeason.map((s) => s.draws),
              backgroundColor: "rgba(148, 163, 184, 0.65)",
              stack: "ved",
              yAxisID: "yGames",
              order: 2,
            },
            {
              type: "bar",
              label: "Derrotas",
              data: statsBySeason.map((s) => s.losses),
              backgroundColor: "rgba(31, 41, 55, 0.78)",
              stack: "ved",
              borderRadius: { topLeft: 4, topRight: 4 },
              yAxisID: "yGames",
              order: 2,
            },
            {
              type: "line",
              label: "Aproveitamento (%)",
              data: statsBySeason.map((s) => (s.winrate !== null ? Number(s.winrate.toFixed(1)) : 0)),
              borderColor: COLORS.red,
              backgroundColor: COLORS.red,
              borderWidth: 2.8,
              tension: 0.25,
              pointRadius: statsBySeason.map((s) => (TITULOS_SPFC.has(s.year) ? 5.5 : 3.5)),
              pointHoverRadius: 7,
              pointBackgroundColor: statsBySeason.map((s) =>
                TITULOS_SPFC.has(s.year) ? "#FACC15" : COLORS.red
              ),
              pointBorderColor: "#FFFFFF",
              pointBorderWidth: 1.5,
              yAxisID: "yPct",
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: onSeasonClick,
          onHover: (event, elements) => {
            event.native.target.style.cursor = elements.length ? "pointer" : "default";
          },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
            tooltip: {
              callbacks: {
                title(items) {
                  const s = statsBySeason[items[0].dataIndex];
                  const titleTag = TITULOS_SPFC.has(s.year) ? " — Campeão Brasileiro ★" : "";
                  return `Temporada ${s.year}${titleTag}`;
                },
                label(ctx) {
                  if (ctx.dataset.yAxisID === "yPct") {
                    return `Aproveitamento: ${fmtDec1.format(ctx.parsed.y)}%`;
                  }
                  return `${ctx.dataset.label}: ${ctx.parsed.y}`;
                },
                afterBody(items) {
                  const s = statsBySeason[items[0].dataIndex];
                  return [
                    `Pontos: ${s.points}/${s.maxPoints} (${s.games} jogos)`,
                    `Gols: ${s.gf} pró · ${s.ga} contra (SG ${formatSigned(s.gd)})`,
                  ];
                },
              },
            },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: COLORS.tick } },
            yGames: {
              stacked: true,
              position: "left",
              beginAtZero: true,
              title: { display: true, text: "Jogos", color: COLORS.tick },
              grid: { color: COLORS.grid },
              ticks: { color: COLORS.tick, precision: 0 },
            },
            yPct: {
              position: "right",
              min: 0,
              max: 100,
              title: { display: true, text: "Aproveitamento (%)", color: COLORS.red },
              grid: { drawOnChartArea: false },
              ticks: { color: COLORS.red, callback: (v) => `${v}%` },
            },
          },
        },
      });
    } else {
      charts.evolution = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Gols Pró",
              data: statsBySeason.map((s) => s.gf),
              backgroundColor: COLORS.red,
              borderRadius: 4,
            },
            {
              label: "Gols Contra",
              data: statsBySeason.map((s) => s.ga),
              backgroundColor: COLORS.charcoal,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: onSeasonClick,
          onHover: (event, elements) => {
            event.native.target.style.cursor = elements.length ? "pointer" : "default";
          },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
            tooltip: {
              callbacks: {
                title(items) {
                  const s = statsBySeason[items[0].dataIndex];
                  return `Temporada ${s.year} (${s.games} jogos)`;
                },
                afterBody(items) {
                  const s = statsBySeason[items[0].dataIndex];
                  return `Saldo de gols: ${formatSigned(s.gd)} (Média ${formatAvg(s.gfAvg)} GP / ${formatAvg(s.gaAvg)} GC)`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: COLORS.tick } },
            y: {
              beginAtZero: true,
              title: { display: true, text: "Gols", color: COLORS.tick },
              grid: { color: COLORS.grid },
              ticks: { color: COLORS.tick, precision: 0 },
            },
          },
        },
      });
    }
  }

  // =========================================================================
  // Gráfico 2: Desempenho por Mando (Casa vs Fora)
  // =========================================================================

  function renderVenueChart(matches) {
    const canvas = dom["chart-venue"];
    const emptyEl = dom["empty-venue"];

    const homeMatches = matches.filter((m) => m.mando === "Casa");
    const awayMatches = matches.filter((m) => m.mando === "Fora");
    const home = computeSummary(homeMatches);
    const away = computeSummary(awayMatches);

    // Atualiza resumo textual Casa vs Fora
    dom["venue-home-games"].textContent = `${fmtInt.format(home.games)} ${home.games === 1 ? "jogo" : "jogos"}`;
    dom["venue-home-stats"].textContent =
      home.games > 0
        ? `${home.wins}V ${home.draws}E ${home.losses}D · ${formatPct(home.winrate)} · ${home.gf}–${home.ga} (SG ${formatSigned(home.gd)})`
        : "Sem jogos em Casa neste recorte";

    dom["venue-away-games"].textContent = `${fmtInt.format(away.games)} ${away.games === 1 ? "jogo" : "jogos"}`;
    dom["venue-away-stats"].textContent =
      away.games > 0
        ? `${away.wins}V ${away.draws}E ${away.losses}D · ${formatPct(away.winrate)} · ${away.gf}–${away.ga} (SG ${formatSigned(away.gd)})`
        : "Sem jogos Fora neste recorte";

    if (matches.length === 0 || typeof Chart === "undefined") {
      destroyChart("venue");
      setChartEmptyState(canvas, emptyEl, true);
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);

    if (state.venue !== "ALL") {
      dom["venue-subtitle"].textContent = `Recorte filtrado exclusivamente por jogos em ${state.venue}`;
    } else {
      dom["venue-subtitle"].textContent = "Comparativo percentual entre jogos em Casa e Fora";
    }

    const datasets = [];
    if (home.games > 0) {
      datasets.push({
        label: "Casa",
        data: [
          Number((home.winrate ?? 0).toFixed(1)),
          Number((home.winPct ?? 0).toFixed(1)),
          Number((home.cleanSheetPct ?? 0).toFixed(1)),
        ],
        backgroundColor: COLORS.red,
        borderRadius: 6,
        maxBarThickness: 44,
      });
    }
    if (away.games > 0) {
      datasets.push({
        label: "Fora",
        data: [
          Number((away.winrate ?? 0).toFixed(1)),
          Number((away.winPct ?? 0).toFixed(1)),
          Number((away.cleanSheetPct ?? 0).toFixed(1)),
        ],
        backgroundColor: COLORS.black,
        borderRadius: 6,
        maxBarThickness: 44,
      });
    }

    destroyChart("venue");
    charts.venue = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Aproveitamento", "Vitórias", "Sem sofrer gol"],
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${fmtDec1.format(ctx.parsed.y)}%`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: COLORS.ink, font: { weight: 600 } } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.tick, callback: (v) => `${v}%` },
          },
        },
      },
    });
  }

  // =========================================================================
  // Gráfico 3: Top 10 Artilheiros Dinâmico (exclui gols contra)
  // =========================================================================

  function renderScorersChart(matches) {
    const canvas = dom["chart-scorers"];
    const emptyEl = dom["empty-scorers"];
    const emptyText = dom["empty-scorers-text"];
    const jumpBtn = dom["btn-jump-modern-scorers"];

    if (matches.length === 0 || typeof Chart === "undefined") {
      destroyChart("scorers");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent = "Nenhuma partida no recorte atual para calcular artilheiros.";
      jumpBtn.classList.add("is-hidden");
      dom["scorers-subtitle"].textContent = "Ranking dinâmico conforme os filtros · exclui gols contra";
      return;
    }

    const withGoalData = matches.filter((m) => Array.isArray(m.gols));
    if (withGoalData.length === 0) {
      destroyChart("scorers");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent = `Os registros individuais de gols estão disponíveis de ${modernStart} a ${maxSeason}.`;
      jumpBtn.classList.remove("is-hidden");
      dom["scorers-subtitle"].textContent = `Sem registros de artilharia para ${state.seasonStart}–${state.seasonEnd}`;
      return;
    }

    const scorersMap = new Map();
    let totalPlayerGoals = 0;
    let totalOwnGoals = 0;

    for (const m of withGoalData) {
      for (const g of m.gols) {
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
      .slice(0, 10);

    if (topScorers.length === 0) {
      destroyChart("scorers");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent =
        totalOwnGoals > 0
          ? "Neste recorte houve apenas gol contra a favor do SPFC (excluído da artilharia individual)."
          : "Nenhum gol marcado por atletas do SPFC neste recorte.";
      jumpBtn.classList.add("is-hidden");
      dom["scorers-subtitle"].textContent = `${fmtInt.format(withGoalData.length)} jogos analisados (${modernStart}–${maxSeason})`;
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);
    jumpBtn.classList.add("is-hidden");
    dom["scorers-subtitle"].textContent =
      `${fmtInt.format(totalPlayerGoals)} gols de ${fmtInt.format(scorersMap.size)} atletas` +
      (totalOwnGoals > 0 ? ` · ${totalOwnGoals} gol(s) contra ignorado(s)` : "");

    destroyChart("scorers");
    charts.scorers = new Chart(canvas, {
      type: "bar",
      data: {
        labels: topScorers.map((s) => s.name),
        datasets: [
          {
            label: "Bola rolando",
            data: topScorers.map((s) => s.normal),
            backgroundColor: COLORS.red,
            borderRadius: 4,
            barThickness: 18,
          },
          {
            label: "Pênalti",
            data: topScorers.map((s) => s.penalty),
            backgroundColor: COLORS.black,
            borderRadius: 4,
            barThickness: 18,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title(items) {
                const sc = topScorers[items[0].dataIndex];
                return `${sc.name} — ${sc.total} ${sc.total === 1 ? "gol" : "gols"}`;
              },
              afterBody(items) {
                const sc = topScorers[items[0].dataIndex];
                const j = sc.matchIds.size;
                return `Marcou em ${j} ${j === 1 ? "partida" : "partidas"} no recorte`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.tick, precision: 0 },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: COLORS.ink, font: { size: 12, weight: 600 } },
          },
        },
      },
    });
  }

  // =========================================================================
  // Gráfico 4: Disciplina por Temporada & Retrospecto por Adversário
  // =========================================================================

  function renderSecondaryChart(matches) {
    const canvas = dom["chart-secondary"];
    const emptyEl = dom["empty-secondary"];
    const emptyText = dom["empty-secondary-text"];
    const jumpBtn = dom["btn-jump-modern-cards"];

    if (state.secondaryTab === "discipline") {
      dom["secondary-title"].textContent = "Disciplina por Temporada";
      dom["secondary-subtitle"].textContent =
        `Média de cartões amarelos por jogo e total de vermelhos do SPFC (base ${modernStart}–${maxSeason})`;

      const withCards = matches.filter(
        (m) => m.cartoes_amarelos !== null && m.cartoes_vermelhos !== null
      );

      if (matches.length === 0 || typeof Chart === "undefined") {
        destroyChart("secondary");
        setChartEmptyState(canvas, emptyEl, true);
        emptyText.textContent = "Nenhuma partida no recorte atual para análise disciplinar.";
        jumpBtn.classList.add("is-hidden");
        return;
      }

      if (withCards.length === 0) {
        destroyChart("secondary");
        setChartEmptyState(canvas, emptyEl, true);
        emptyText.textContent = `Os dados de cartões estão disponíveis de ${modernStart} a ${maxSeason}.`;
        jumpBtn.classList.remove("is-hidden");
        return;
      }

      setChartEmptyState(canvas, emptyEl, false);
      jumpBtn.classList.add("is-hidden");

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

      const rows = [...bySeason.values()].sort((a, b) => a.year - b.year);

      destroyChart("secondary");
      charts.secondary = new Chart(canvas, {
        type: "bar",
        data: {
          labels: rows.map((r) => String(r.year)),
          datasets: [
            {
              type: "bar",
              label: "Amarelos / jogo (SPFC)",
              data: rows.map((r) => Number((r.yellow / r.games).toFixed(2))),
              backgroundColor: "rgba(234, 179, 8, 0.85)",
              borderColor: COLORS.yellowBorder,
              borderWidth: 1,
              borderRadius: 5,
              yAxisID: "yYellow",
              order: 2,
            },
            {
              type: "line",
              label: "Vermelhos (total SPFC)",
              data: rows.map((r) => r.red),
              borderColor: COLORS.cardRed,
              backgroundColor: COLORS.cardRed,
              borderWidth: 2.5,
              tension: 0.25,
              pointRadius: 4.5,
              pointHoverRadius: 6.5,
              pointBackgroundColor: COLORS.cardRed,
              pointBorderColor: "#FFFFFF",
              pointBorderWidth: 1.5,
              yAxisID: "yRed",
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } },
            tooltip: {
              callbacks: {
                title(items) {
                  const r = rows[items[0].dataIndex];
                  return `Temporada ${r.year} (${r.games} ${r.games === 1 ? "jogo" : "jogos"} com registro)`;
                },
                label(ctx) {
                  const r = rows[ctx.dataIndex];
                  if (ctx.dataset.yAxisID === "yYellow") {
                    return `Amarelos SPFC: ${r.yellow} (${fmtDec2.format(r.yellow / r.games)}/jogo)`;
                  }
                  return `Vermelhos SPFC: ${r.red} (${fmtDec2.format(r.red / r.games)}/jogo)`;
                },
                afterBody(items) {
                  const r = rows[items[0].dataIndex];
                  return `Adversários no período: ${r.advYellow}A · ${r.advRed}V`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: COLORS.tick } },
            yYellow: {
              position: "left",
              beginAtZero: true,
              title: { display: true, text: "Média de Amarelos / jogo", color: COLORS.tick },
              grid: { color: COLORS.grid },
              ticks: { color: COLORS.tick },
            },
            yRed: {
              position: "right",
              beginAtZero: true,
              suggestedMax: 8,
              title: { display: true, text: "Cartões Vermelhos (total)", color: COLORS.cardRed },
              grid: { drawOnChartArea: false },
              ticks: { color: COLORS.cardRed, precision: 0 },
            },
          },
        },
      });
      return;
    }

    // Aba 2: Retrospecto por Adversário
    dom["secondary-title"].textContent = "Retrospecto por Adversário";
    jumpBtn.classList.add("is-hidden");

    if (matches.length === 0 || typeof Chart === "undefined") {
      destroyChart("secondary");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent = "Nenhuma partida no recorte atual para comparar adversários.";
      dom["secondary-subtitle"].textContent = "Aproveitamento contra os adversários do recorte";
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);

    const byOpponent = new Map();
    for (const m of matches) {
      if (!byOpponent.has(m.adversario)) byOpponent.set(m.adversario, []);
      byOpponent.get(m.adversario).push(m);
    }

    // Seleciona até os 15 adversários mais enfrentados no recorte e ordena por aproveitamento
    const oppList = [...byOpponent.entries()]
      .map(([name, list]) => ({ name, ...computeSummary(list) }))
      .sort((a, b) => b.games - a.games || b.winrate - a.winrate)
      .slice(0, 15)
      .sort((a, b) => (b.winrate ?? 0) - (a.winrate ?? 0) || b.games - a.games);

    dom["secondary-subtitle"].textContent =
      oppList.length > 1
        ? `Aproveitamento (%) nos ${oppList.length} confrontos mais frequentes do recorte · clique na barra para filtrar`
        : `Aproveitamento detalhado contra ${oppList[0].name}`;

    destroyChart("secondary");
    charts.secondary = new Chart(canvas, {
      type: "bar",
      data: {
        labels: oppList.map((o) => `${o.name} (${o.games}J)`),
        datasets: [
          {
            label: "Aproveitamento (%)",
            data: oppList.map((o) => Number((o.winrate ?? 0).toFixed(1))),
            backgroundColor: oppList.map((o) => {
              const wr = o.winrate ?? 0;
              if (wr >= 55) return COLORS.red;
              if (wr >= 45) return "#475569";
              return COLORS.black;
            }),
            borderRadius: 5,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick(_event, elements) {
          if (!elements || elements.length === 0) return;
          const opp = oppList[elements[0].index].name;
          state.opponent = state.opponent === opp ? "ALL" : opp;
          state.tablePage = 1;
          updateDashboard();
        },
        onHover(event, elements) {
          event.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items) {
                const o = oppList[items[0].dataIndex];
                return `São Paulo × ${o.name} (${o.games} ${o.games === 1 ? "jogo" : "jogos"})`;
              },
              label(ctx) {
                return `Aproveitamento: ${fmtDec1.format(ctx.parsed.y)}%`;
              },
              afterBody(items) {
                const o = oppList[items[0].dataIndex];
                return [
                  `Retrospecto: ${o.wins}V · ${o.draws}E · ${o.losses}D`,
                  `Gols: ${o.gf} pró · ${o.ga} contra (SG ${formatSigned(o.gd)})`,
                ];
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: COLORS.ink, font: { size: 11 } } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.tick, callback: (v) => `${v}%` },
          },
        },
      },
    });
  }

  // =========================================================================
  // Tabela de Partidas Filtradas (busca, filtro V/E/D, ordenação e paginação)
  // =========================================================================

  function getTableMatches(filteredMatches) {
    const query = normalizeText(state.tableSearch);

    const list = filteredMatches.filter((m) => {
      if (state.tableResult !== "ALL" && m.resultado !== state.tableResult) {
        return false;
      }
      if (!query) return true;

      if (normalizeText(m.adversario).includes(query)) return true;
      if (normalizeText(m.arena).includes(query)) return true;
      if (normalizeText(m.tecnico_spfc).includes(query)) return true;
      if (String(m.temporada).includes(query)) return true;
      if (Array.isArray(m.gols)) {
        for (const g of m.gols) {
          if (normalizeText(g.jogador).includes(query)) return true;
        }
      }
      return false;
    });

    const dir = state.tableSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      if (state.tableSortBy === "data") {
        cmp = a.data.localeCompare(b.data) || a.id - b.id;
      } else if (state.tableSortBy === "temporada") {
        cmp = a.temporada - b.temporada || a.rodada - b.rodada || a.id - b.id;
      } else if (state.tableSortBy === "adversario") {
        cmp = a.adversario.localeCompare(b.adversario, "pt-BR") || b.data.localeCompare(a.data);
      } else if (state.tableSortBy === "saldo_gols") {
        cmp = a.saldo_gols - b.saldo_gols || a.gols_pro - b.gols_pro || b.data.localeCompare(a.data);
      }
      return cmp * dir;
    });

    return list;
  }

  function renderGoalsCell(match) {
    if (match.gols === null) {
      return '<span class="muted-dash">Sem registro (03–13)</span>';
    }
    if (match.gols.length === 0) {
      return '<span class="muted-dash">—</span>';
    }
    const chips = match.gols.map((g) => {
      const minute = g.minuto ? `<span class="goal-minute">${escapeHtml(g.minuto)}'</span>` : "";
      let tag = "";
      if (g.tipo === "Pênalti") tag = '<span class="goal-tag">(P)</span>';
      else if (g.gol_contra) tag = '<span class="goal-tag">(GC)</span>';

      const ownClass = g.gol_contra ? " goal-chip--own" : "";
      return `<span class="goal-chip${ownClass}">${escapeHtml(g.jogador)} ${minute}${tag}</span>`;
    });
    return `<div class="goals-list">${chips.join("")}</div>`;
  }

  function renderCardsCell(match) {
    if (match.cartoes_amarelos === null || match.cartoes_vermelhos === null) {
      return '<span class="muted-dash">—</span>';
    }
    return `
      <span class="card-count" title="Cartões amarelos do SPFC">
        <span class="mini-card mini-card--yellow" aria-hidden="true"></span>${match.cartoes_amarelos}
      </span>
      <span class="card-count" title="Cartões vermelhos do SPFC">
        <span class="mini-card mini-card--red" aria-hidden="true"></span>${match.cartoes_vermelhos}
      </span>
    `;
  }

  function renderTable(filteredMatches) {
    const tableList = getTableMatches(filteredMatches);
    const total = tableList.length;
    dom["table-total-badge"].textContent = fmtInt.format(total);

    const totalPages = Math.max(1, Math.ceil(total / state.tablePageSize));
    if (state.tablePage > totalPages) state.tablePage = totalPages;
    if (state.tablePage < 1) state.tablePage = 1;

    const startIdx = (state.tablePage - 1) * state.tablePageSize;
    const endIdx = Math.min(total, startIdx + state.tablePageSize);
    const pageRows = tableList.slice(startIdx, endIdx);

    if (pageRows.length === 0) {
      dom["matches-tbody"].innerHTML = `
        <tr class="table-empty-row">
          <td colspan="8">
            Nenhuma partida encontrada para os filtros e busca informados.
          </td>
        </tr>
      `;
    } else {
      dom["matches-tbody"].innerHTML = pageRows
        .map((m) => {
          const venueClass = m.mando === "Casa" ? "venue-pill--home" : "venue-pill--away";
          const ufTag = m.adversario_estado
            ? `<span class="opponent-uf">${escapeHtml(m.adversario_estado)}</span>`
            : "";
          const coachHtml = m.tecnico_spfc
            ? `<span class="coach-name">Téc.: ${escapeHtml(m.tecnico_spfc)}</span>`
            : "";

          return `
            <tr>
              <td class="cell-date">${formatDateBR(m.data)}</td>
              <td class="cell-season">${m.temporada} · R${String(m.rodada).padStart(2, "0")}</td>
              <td><span class="venue-pill ${venueClass}">${escapeHtml(m.mando)}</span></td>
              <td class="opponent-cell">${escapeHtml(m.adversario)}${ufTag}</td>
              <td>
                <span class="score-cell">
                  <span class="score-text">${m.gols_pro} × ${m.gols_contra}</span>
                  <span class="result-badge result-badge--${m.resultado}">${m.resultado}</span>
                </span>
              </td>
              <td>${renderGoalsCell(m)}</td>
              <td class="cards-cell">${renderCardsCell(m)}</td>
              <td class="arena-cell">
                <span class="arena-name">${escapeHtml(m.arena || "—")}</span>
                ${coachHtml}
              </td>
            </tr>
          `;
        })
        .join("");
    }

    // Paginação
    dom["pagination-info"].textContent =
      total === 0
        ? "Mostrando 0 de 0 partidas"
        : `Mostrando ${fmtInt.format(startIdx + 1)}–${fmtInt.format(endIdx)} de ${fmtInt.format(total)} partidas`;
    dom["page-indicator"].textContent = `${state.tablePage} / ${totalPages}`;
    dom["btn-prev-page"].disabled = state.tablePage <= 1;
    dom["btn-next-page"].disabled = state.tablePage >= totalPages;

    // Indicadores de ordenação nos cabeçalhos
    document.querySelectorAll(".sort-btn").forEach((btn) => {
      const col = btn.dataset.sort;
      const icon = btn.querySelector(".sort-icon");
      btn.classList.remove("is-sorted-asc", "is-sorted-desc");
      if (col === state.tableSortBy) {
        btn.classList.add(state.tableSortDir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
        if (icon) icon.textContent = state.tableSortDir === "asc" ? "↑" : "↓";
      } else if (icon) {
        icon.textContent = "↕";
      }
    });
  }

  // =========================================================================
  // Orquestração Central
  // =========================================================================

  function updateDashboard() {
    const filtered = getFilteredMatches();
    syncFilterControlsUI(filtered.length);
    syncUrlWithState();
    renderKPIs(filtered);
    renderEvolutionChart(filtered);
    renderVenueChart(filtered);
    renderScorersChart(filtered);
    renderSecondaryChart(filtered);
    renderTable(filtered);
  }

  function resetAllFilters() {
    state.seasonStart = minSeason;
    state.seasonEnd = maxSeason;
    state.opponent = "ALL";
    state.venue = "ALL";
    state.tableResult = "ALL";
    state.tableSearch = "";
    state.tablePage = 1;
    if (dom["table-search"]) {
      dom["table-search"].value = "";
    }
    updateDashboard();
  }

  function jumpToModernPeriod() {
    state.seasonStart = modernStart;
    state.seasonEnd = maxSeason;
    state.tablePage = 1;
    updateDashboard();
  }

  // =========================================================================
  // Inicialização e Eventos
  // =========================================================================

  function populateSelectOptions() {
    const seasonStartEl = dom["filter-season-start"];
    const seasonEndEl = dom["filter-season-end"];
    const oppEl = dom["filter-opponent"];

    seasonStartEl.innerHTML = "";
    seasonEndEl.innerHTML = "";
    validSeasons = new Set();
    for (let y = minSeason; y <= maxSeason; y += 1) {
      validSeasons.add(y);
      seasonStartEl.add(new Option(String(y), String(y)));
      seasonEndEl.add(new Option(String(y), String(y)));
    }

    const opponents = [...new Set(allMatches.map((m) => m.adversario))].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );

    opponentLookup = new Map([["classicos", "CLASSICOS"]]);
    const optGroup = document.createElement("optgroup");
    optGroup.label = "Adversários (A–Z)";
    for (const opp of opponents) {
      opponentLookup.set(normalizeText(opp), opp);
      optGroup.appendChild(new Option(opp, opp));
    }
    oppEl.appendChild(optGroup);
  }

  function bindEvents() {
    dom["filter-season-start"].addEventListener("change", (e) => {
      const val = Number(e.target.value);
      state.seasonStart = val;
      if (state.seasonEnd < val) state.seasonEnd = val;
      state.tablePage = 1;
      updateDashboard();
    });

    dom["filter-season-end"].addEventListener("change", (e) => {
      const val = Number(e.target.value);
      state.seasonEnd = val;
      if (state.seasonStart > val) state.seasonStart = val;
      state.tablePage = 1;
      updateDashboard();
    });

    dom["filter-opponent"].addEventListener("change", (e) => {
      state.opponent = e.target.value;
      state.tablePage = 1;
      updateDashboard();
    });

    document.querySelectorAll("[data-venue]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.venue = btn.dataset.venue;
        state.tablePage = 1;
        updateDashboard();
      });
    });

    document.querySelectorAll("[data-preset-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.presetPeriod;
        if (p === "ALL") {
          state.seasonStart = minSeason;
          state.seasonEnd = maxSeason;
        } else if (p === "TRI") {
          state.seasonStart = 2006;
          state.seasonEnd = 2008;
        } else if (p === "MODERN") {
          state.seasonStart = modernStart;
          state.seasonEnd = maxSeason;
        } else if (p === "LAST5") {
          state.seasonStart = Math.max(minSeason, maxSeason - 4);
          state.seasonEnd = maxSeason;
        } else if (p === "CURRENT") {
          state.seasonStart = maxSeason;
          state.seasonEnd = maxSeason;
        }
        state.tablePage = 1;
        updateDashboard();
      });
    });

    document.querySelectorAll("[data-preset-opponent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.presetOpponent;
        state.opponent = state.opponent === target ? "ALL" : target;
        state.tablePage = 1;
        updateDashboard();
      });
    });

    if (dom["btn-share-link"]) {
      dom["btn-share-link"].addEventListener("click", handleShareLinkClick);
    }
    dom["btn-reset-filters"].addEventListener("click", resetAllFilters);
    dom["btn-empty-reset"].addEventListener("click", resetAllFilters);

    dom["btn-back-all-seasons"].addEventListener("click", () => {
      state.seasonStart = minSeason;
      state.seasonEnd = maxSeason;
      state.tablePage = 1;
      updateDashboard();
    });

    dom["btn-jump-modern-scorers"].addEventListener("click", jumpToModernPeriod);
    dom["btn-jump-modern-cards"].addEventListener("click", jumpToModernPeriod);

    document.querySelectorAll("[data-evolution-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.evolutionMode = btn.dataset.evolutionMode;
        document.querySelectorAll("[data-evolution-mode]").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", String(active));
        });
        renderEvolutionChart(getFilteredMatches());
      });
    });

    document.querySelectorAll("[data-secondary-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.secondaryTab = btn.dataset.secondaryTab;
        document.querySelectorAll("[data-secondary-tab]").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", String(active));
        });
        renderSecondaryChart(getFilteredMatches());
      });
    });

    dom["table-search"].addEventListener("input", (e) => {
      state.tableSearch = e.target.value;
      state.tablePage = 1;
      dom["btn-reset-filters"].disabled = isDefaultFilter();
      syncUrlWithState();
      renderTable(getFilteredMatches());
    });

    document.querySelectorAll("[data-result]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tableResult = btn.dataset.result;
        state.tablePage = 1;
        syncTableFilterControlsUI();
        syncUrlWithState();
        renderTable(getFilteredMatches());
      });
    });

    document.querySelectorAll(".sort-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.sort;
        if (state.tableSortBy === col) {
          state.tableSortDir = state.tableSortDir === "asc" ? "desc" : "asc";
        } else {
          state.tableSortBy = col;
          state.tableSortDir = col === "adversario" ? "asc" : "desc";
        }
        state.tablePage = 1;
        renderTable(getFilteredMatches());
      });
    });

    dom["table-page-size"].addEventListener("change", (e) => {
      state.tablePageSize = Number(e.target.value) || 25;
      state.tablePage = 1;
      renderTable(getFilteredMatches());
    });

    dom["btn-prev-page"].addEventListener("click", () => {
      if (state.tablePage > 1) {
        state.tablePage -= 1;
        renderTable(getFilteredMatches());
      }
    });

    dom["btn-next-page"].addEventListener("click", () => {
      state.tablePage += 1;
      renderTable(getFilteredMatches());
    });
  }

  function configureChartDefaults() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = COLORS.tick;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(17, 19, 21, 0.94)";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12 };
  }

  function formatDateTimeBRT(isoString) {
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

  function applyDynamicSeasonLabels() {
    const shortMin = String(minSeason).slice(-2);
    const shortMax = String(maxSeason).slice(-2);
    const shortModern = String(modernStart).slice(-2);
    const totalSeasons = new Set(allMatches.map((m) => m.temporada)).size;
    const detailedGames = allMatches.filter(
      (m) => (m.cartoes_amarelos !== null && m.cartoes_vermelhos !== null) || Array.isArray(m.gols)
    ).length;

    document.title = `Dados Tricolor — São Paulo FC nos Pontos Corridos (${minSeason}–${maxSeason})`;
    if (dom["brand-subtitle"]) {
      dom["brand-subtitle"].textContent = `São Paulo FC no Campeonato Brasileiro · Era dos Pontos Corridos (${minSeason}–${maxSeason})`;
    }
    dom["header-dataset-badge"].textContent = `${totalSeasons} temporadas · ${fmtInt.format(allMatches.length)} jogos`;

    if (dom["chip-period-all"]) {
      dom["chip-period-all"].textContent = `Todas (${shortMin}–${shortMax})`;
    }
    if (dom["chip-period-modern"]) {
      dom["chip-period-modern"].textContent = `Com Gols/Cartões (${shortModern}–${shortMax})`;
    }
    if (dom["chip-period-current"]) {
      dom["chip-period-current"].textContent = String(maxSeason);
    }
    if (dom["scorers-coverage-badge"]) {
      dom["scorers-coverage-badge"].textContent = `Base ${modernStart}–${maxSeason}`;
    }
    if (dom["btn-jump-modern-scorers"]) {
      dom["btn-jump-modern-scorers"].textContent = `Ver período ${modernStart}–${maxSeason}`;
    }
    if (dom["btn-jump-modern-cards"]) {
      dom["btn-jump-modern-cards"].textContent = `Ver período ${modernStart}–${maxSeason}`;
    }
    if (dom["footer-range-all"]) {
      dom["footer-range-all"].textContent = `${minSeason} a ${maxSeason}`;
    }
    if (dom["footer-games-all"]) {
      dom["footer-games-all"].textContent = fmtInt.format(allMatches.length);
    }
    if (dom["footer-range-modern"]) {
      dom["footer-range-modern"].textContent = `${modernStart} a ${maxSeason}`;
    }
    if (dom["footer-games-modern"]) {
      dom["footer-games-modern"].textContent = fmtInt.format(detailedGames);
    }
  }

  function applyAutoUpdateBadge(syncMeta) {
    let formatted = null;
    if (syncMeta && typeof syncMeta.atualizado_em_brt === "string" && syncMeta.atualizado_em_brt.trim()) {
      formatted = syncMeta.atualizado_em_brt.trim();
    } else if (syncMeta && syncMeta.atualizado_em) {
      formatted = formatDateTimeBRT(syncMeta.atualizado_em);
    } else if (datasetMeta && datasetMeta.gerado_em) {
      formatted = formatDateTimeBRT(datasetMeta.gerado_em);
    }

    if (!formatted) return;

    const label = `Atualizado automaticamente em ${formatted}`;
    if (dom["header-updated-badge"] && dom["header-updated-text"]) {
      dom["header-updated-text"].textContent = label;
      dom["header-updated-badge"].classList.remove("is-hidden");
    }
    if (dom["footer-updated-at"]) {
      dom["footer-updated-at"].textContent = `${label} · GitHub Pages`;
    }
  }

  async function fetchSyncMeta() {
    try {
      const resp = await fetch(META_URL, { cache: "no-cache" });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  async function init() {
    cacheDom();
    configureChartDefaults();

    try {
      const [response, syncMeta] = await Promise.all([
        fetch(DATA_URL, { cache: "no-cache" }),
        fetchSyncMeta(),
      ]);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ao carregar ${DATA_URL}`);
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.partidas) || payload.partidas.length === 0) {
        throw new Error("Formato de JSON inválido: campo 'partidas' ausente ou vazio.");
      }

      allMatches = payload.partidas;
      datasetMeta = payload.metadata || {};

      // Calcula os limites de temporada dinamicamente a partir das partidas carregadas
      const seasons = allMatches.map((m) => m.temporada);
      minSeason = Math.min(...seasons);
      maxSeason = Math.max(...seasons);

      const detailedSeasons = allMatches
        .filter((m) => (m.cartoes_amarelos !== null && m.cartoes_vermelhos !== null) || Array.isArray(m.gols))
        .map((m) => m.temporada);
      if (detailedSeasons.length > 0) {
        modernStart = Math.min(...detailedSeasons);
      } else if (Array.isArray(datasetMeta.temporadas_com_cartoes) && datasetMeta.temporadas_com_cartoes.length) {
        modernStart = Math.min(...datasetMeta.temporadas_com_cartoes);
      }

      state.seasonStart = minSeason;
      state.seasonEnd = maxSeason;

      applyDynamicSeasonLabels();
      applyAutoUpdateBadge(syncMeta);

      populateSelectOptions();
      applyFiltersFromUrl();
      bindEvents();

      dom["state-loading"].classList.add("is-hidden");
      dom["dashboard-root"].classList.remove("is-hidden");
      updateDashboard();
    } catch (error) {
      console.error("Erro ao inicializar Dados Tricolor:", error);
      dom["state-loading"].classList.add("is-hidden");
      dom["state-error"].classList.remove("is-hidden");
      const extraHint =
        window.location.protocol === "file:"
          ? " Abra via servidor HTTP local (ex.: python -m http.server -d docs 8000) ou pelo GitHub Pages."
          : "";
      dom["state-error-message"].textContent = `${error.message}.${extraHint}`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

/**
 * Dados Tricolor — Aplicação Front-end (JS puro + Chart.js 4)
 * Carrega `data/spfc_pontos_corridos.json` e alimenta filtros, KPIs, gráficos e tabela.
 */

(() => {
  "use strict";

  const DATA_URL = "data/spfc_pontos_corridos.json";
  const META_URL = "data/meta.json";
  const NEXT_MATCH_URL = "data/proximo_jogo.json";
  const CLASSICOS = new Set(["Corinthians", "Palmeiras", "Santos"]);
  const TITULOS_SPFC = new Set([2006, 2007, 2008]);
  const WEEKDAYS_PT_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const MS_PER_DAY = 86400000;
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
  let validOpponentClubs = new Map();
  let dashboardReady = false;
  let dashboardFailed = false;
  let nextMatchPayload = null;
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

  // Estado independente do Comparador de Temporadas (sempre consulta allMatches)
  const comparatorState = {
    seasonA: null,
    seasonB: null,
    venue: "ALL", // "ALL" | "Casa" | "Fora"
  };

  const charts = {
    evolution: null,
    venue: null,
    scorers: null,
    secondary: null,
    comparator: null,
  };

  // Cache de elementos DOM
  const dom = {};

  function cacheDom() {
    const ids = [
      "brand-subtitle",
      "header-dataset-badge",
      "header-updated-badge",
      "header-updated-text",
      "next-match-section",
      "next-match-card",
      "filters-section",
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
      "records-section",
      "records-section-subtitle",
      "records-scope-badge",
      "records-empty",
      "records-empty-text",
      "records-grid",
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
      "comparator-section",
      "comparator-scope-badge",
      "comparator-season-a",
      "comparator-season-b",
      "comparator-swap",
      "comparator-notice",
      "comparator-a-games",
      "comparator-a-year",
      "comparator-a-title-pill",
      "comparator-a-quick",
      "comparator-b-games",
      "comparator-b-year",
      "comparator-b-title-pill",
      "comparator-b-quick",
      "comparator-advantage-summary",
      "comparator-col-a",
      "comparator-col-b",
      "comparator-metrics-body",
      "comparator-chart-title",
      "comparator-chart-subtitle",
      "comparator-chart-badge",
      "chart-comparator",
      "empty-comparator",
      "empty-comparator-text",
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

  const MONTHS_PT_SHORT = [
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

  function parseIsoDateParts(isoDate) {
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

  function formatDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== "string") return "—";
    const parts = parseIsoDateParts(isoDate);
    if (parts) return `${parts.day}/${parts.month}/${parts.year}`;
    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return isoDate;
    return `${day}/${month}/${year}`;
  }

  function formatMonthYearBR(isoDate) {
    const parts = parseIsoDateParts(isoDate);
    if (!parts) return formatDateBR(isoDate);
    return `${MONTHS_PT_SHORT[parts.monthNum - 1]}/${parts.year}`;
  }

  function formatStreakPeriodBR(startIso, endIso, count) {
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

  function pluralizar(quantidade, singular, plural) {
    return quantidade === 1 ? singular : plural;
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
  // Recordes e Sequências (Streaks) — Cálculo Puro e Renderização Segura
  // =========================================================================

  function compareNormalizedMatchesAsc(a, b) {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.temporada !== b.temporada) return a.temporada - b.temporada;
    if (a.rodada !== b.rodada) return a.rodada - b.rodada;
    return a.id - b.id;
  }

  function findLongestStreak(sortedMatches, predicate) {
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
      } else {
        if (curLen > 0) {
          closeStreak(sortedMatches[i - 1]);
          curLen = 0;
          curStart = null;
        }
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

  function computeRecentStreak(sortedMatches) {
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

  function formatScoreRecord(match) {
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
  function calcularRecordesESequencias(jogosFiltrados) {
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

  const RECORD_ICON_PATHS = {
    shield: "M12 3l7 3v5c0 4.5-3 8.2-7 9.5C8 19.2 5 15.5 5 11V6l7-3z",
    flame: "M13 3L4 14h6l-1 7 9-11h-6l1-7z",
    clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
    trophy: "M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0V4zM6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2",
    alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18.5A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.5L13.7 3.9a2 2 0 0 0-3.4 0z",
  };

  function createRecordIcon(iconKey, toneClass) {
    const svgNs = "http://www.w3.org/2000/svg";
    const wrap = document.createElement("span");
    wrap.className = `record-icon${toneClass ? ` record-icon--${toneClass}` : ""}`;
    wrap.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", RECORD_ICON_PATHS[iconKey] || RECORD_ICON_PATHS.pulse);
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
  }

  function createRecordCard({
    title,
    icon,
    tone = "neutral", // "positive" | "negative" | "neutral" | "empty"
    badgeText = "",
    valueText = "—",
    compactValue = false,
    isEmptyValue = false,
    metaText = "",
    opponentName = "",
    metaSuffix = "",
    tieCount = 0,
  }) {
    const card = document.createElement("article");
    card.className = `record-card record-card--${tone}`;

    const head = document.createElement("div");
    head.className = "record-card-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "record-title-wrap";
    const iconTone = tone === "empty" ? "" : tone;
    titleWrap.appendChild(createRecordIcon(icon, iconTone));

    const titleEl = document.createElement("span");
    titleEl.className = "record-title";
    titleEl.textContent = title;
    titleWrap.appendChild(titleEl);
    head.appendChild(titleWrap);

    if (badgeText) {
      const badgeEl = document.createElement("span");
      const badgeToneClass =
        tone === "positive" || tone === "negative" || tone === "neutral"
          ? ` record-badge--${tone}`
          : "";
      badgeEl.className = `record-badge${badgeToneClass}`;
      badgeEl.textContent = badgeText;
      head.appendChild(badgeEl);
    }

    const valueEl = document.createElement("div");
    valueEl.className =
      `record-value${compactValue ? " record-value--compact" : ""}${isEmptyValue ? " record-value--muted" : ""}`;
    valueEl.textContent = valueText;

    const metaEl = document.createElement("p");
    metaEl.className = "record-meta";

    if (opponentName) {
      const textWrap = document.createElement("span");
      textWrap.appendChild(document.createTextNode("vs "));

      const oppEl = document.createElement("span");
      oppEl.className = "record-opponent";
      oppEl.textContent = opponentName;
      textWrap.appendChild(oppEl);

      if (metaSuffix) {
        textWrap.appendChild(document.createTextNode(` · ${metaSuffix}`));
      }
      metaEl.appendChild(textWrap);
    } else {
      const textEl = document.createElement("span");
      textEl.textContent = metaText;
      metaEl.appendChild(textEl);
    }

    if (tieCount > 0) {
      const tieEl = document.createElement("span");
      tieEl.className = "record-tie-pill";
      tieEl.textContent = `+${fmtInt.format(tieCount)} ${pluralizar(tieCount, "outra vez", "outras vezes")}`;
      tieEl.title = `Marca igualada em ${fmtInt.format(tieCount + 1)} ocasiões; exibindo a mais recente`;
      metaEl.appendChild(tieEl);
    }

    card.appendChild(head);
    card.appendChild(valueEl);
    card.appendChild(metaEl);
    return card;
  }

  function renderRecordsAndStreaks(matches) {
    const gridEl = dom["records-grid"];
    const emptyEl = dom["records-empty"];
    const emptyTextEl = dom["records-empty-text"];
    const scopeBadgeEl = dom["records-scope-badge"];
    if (!gridEl || !emptyEl) return;

    const rec = calcularRecordesESequencias(matches);

    if (scopeBadgeEl) {
      scopeBadgeEl.textContent = `${fmtInt.format(rec.totalJogosValidos)} ${pluralizar(rec.totalJogosValidos, "jogo analisado", "jogos analisados")}`;
    }

    if (rec.vazio) {
      gridEl.replaceChildren();
      gridEl.classList.add("is-hidden");
      emptyEl.classList.remove("is-hidden");
      if (emptyTextEl) {
        emptyTextEl.textContent = "Nenhum jogo encontrado para os filtros selecionados.";
      }
      return;
    }

    emptyEl.classList.add("is-hidden");
    gridEl.classList.remove("is-hidden");

    const toneMap = {
      positivo: "positive",
      negativo: "negative",
      neutro: "neutral",
    };

    const cards = [];

    // 1. Maior Invencibilidade
    if (rec.maiorInvencibilidade) {
      const s = rec.maiorInvencibilidade;
      cards.push(
        createRecordCard({
          title: "Maior Invencibilidade",
          icon: "shield",
          tone: "positive",
          badgeText: "Sem perder",
          valueText: `${fmtInt.format(s.quantidade)} ${pluralizar(s.quantidade, "jogo", "jogos")}`,
          metaText: s.periodoFormatado,
          tieCount: s.empatesAdicionais,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Maior Invencibilidade",
          icon: "shield",
          tone: "empty",
          badgeText: "0 jogos",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Apenas derrotas no recorte",
        })
      );
    }

    // 2. Maior Sequência de Vitórias
    if (rec.maiorSequenciaVitorias) {
      const s = rec.maiorSequenciaVitorias;
      cards.push(
        createRecordCard({
          title: "Maior Sequência de Vitórias",
          icon: "flame",
          tone: "positive",
          badgeText: "Vitórias",
          valueText: `${fmtInt.format(s.quantidade)} ${pluralizar(s.quantidade, "vitória", "vitórias")}`,
          metaText: s.periodoFormatado,
          tieCount: s.empatesAdicionais,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Maior Sequência de Vitórias",
          icon: "flame",
          tone: "empty",
          badgeText: "0 vitórias",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Sem vitórias no recorte",
        })
      );
    }

    // 3. Maior Jejum sem Vencer
    if (rec.maiorJejumSemVencer) {
      const s = rec.maiorJejumSemVencer;
      cards.push(
        createRecordCard({
          title: "Maior Jejum sem Vencer",
          icon: "clock",
          tone: "negative",
          badgeText: "Sem vitórias",
          valueText: `${fmtInt.format(s.quantidade)} ${pluralizar(s.quantidade, "jogo", "jogos")}`,
          metaText: s.periodoFormatado,
          tieCount: s.empatesAdicionais,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Maior Jejum sem Vencer",
          icon: "clock",
          tone: "empty",
          badgeText: "0 jejum",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Nenhum jejum no recorte",
        })
      );
    }

    // 4. Sequência Recente (fim do recorte)
    if (rec.sequenciaRecente) {
      const r = rec.sequenciaRecente;
      cards.push(
        createRecordCard({
          title: "Sequência Recente",
          icon: "pulse",
          tone: toneMap[r.tom] || "neutral",
          badgeText: r.badge,
          valueText: r.rotuloPrincipal,
          compactValue: true,
          metaText: r.detalhe,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Sequência Recente",
          icon: "pulse",
          tone: "empty",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Sem partidas no recorte",
        })
      );
    }

    // 5. Maior Goleada a Favor
    if (rec.maiorGoleadaAFavor) {
      const g = rec.maiorGoleadaAFavor;
      const mandoSuffix = g.mando ? ` (${g.mando})` : "";
      cards.push(
        createRecordCard({
          title: "Maior Goleada a Favor",
          icon: "trophy",
          tone: "positive",
          badgeText: `SG ${formatSigned(g.saldo)}`,
          valueText: g.placarSpfc,
          opponentName: g.adversario,
          metaSuffix: `${g.dataFormatada}${mandoSuffix}`,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Maior Goleada a Favor",
          icon: "trophy",
          tone: "empty",
          badgeText: "0 vitórias",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Sem vitórias no recorte",
        })
      );
    }

    // 6. Pior Derrota
    if (rec.piorDerrota) {
      const d = rec.piorDerrota;
      const mandoSuffix = d.mando ? ` (${d.mando})` : "";
      cards.push(
        createRecordCard({
          title: "Pior Derrota",
          icon: "alert",
          tone: "negative",
          badgeText: `SG ${formatSigned(d.saldo)}`,
          valueText: d.placarSpfc,
          opponentName: d.adversario,
          metaSuffix: `${d.dataFormatada}${mandoSuffix}`,
        })
      );
    } else {
      cards.push(
        createRecordCard({
          title: "Pior Derrota",
          icon: "alert",
          tone: "empty",
          badgeText: "0 derrotas",
          valueText: "—",
          isEmptyValue: true,
          metaText: "Nenhuma derrota no recorte",
        })
      );
    }

    const fragment = document.createDocumentFragment();
    for (const card of cards) {
      fragment.appendChild(card);
    }
    gridEl.replaceChildren(fragment);
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
  // Comparador de Temporadas Lado a Lado — Funções Puras, UI Segura e Gráfico
  // =========================================================================

  function normalizarMandoComparador(mando) {
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
  function normalizarEOrdenarJogosTemporada(jogos) {
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
  function resumirTemporada(jogos) {
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

  function avaliarComparacaoMetrica(valorA, valorB, polaridade, mesmaTemporada, compararPermitido) {
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
  function compararTemporadas(dadosCompletos, tempA, tempB, mando = "ALL") {
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

  function formatComparatorValue(valor, tipo) {
    if (valor === null || !Number.isFinite(valor)) return "—";
    if (tipo === "pct") return formatPct(valor);
    if (tipo === "dec2") return formatAvg(valor, 2);
    if (tipo === "signedInt") return formatSigned(valor);
    return fmtInt.format(valor);
  }

  function formatComparatorMagnitude(absValue, tipo) {
    if (absValue === null || !Number.isFinite(absValue)) return "—";
    if (tipo === "pct") {
      if (absValue > 1e-9 && absValue < 0.05) return "< 0,1 p.p.";
      return `${fmtDec1.format(absValue)} p.p.`;
    }
    if (tipo === "dec2") {
      if (absValue > 1e-9 && absValue < 0.005) return "< 0,01";
      return fmtDec2.format(absValue);
    }
    return fmtInt.format(absValue);
  }

  function buildComparatorDeltaDisplay(metrica, anoA, anoB, mesmaTemporada) {
    if (mesmaTemporada) {
      return {
        text: "=",
        tone: "neutral",
        title: "Mesma temporada selecionada nos dois lados (diferença 0)",
      };
    }

    if (metrica.diferenca === null || !Number.isFinite(metrica.diferenca)) {
      return {
        text: "—",
        tone: "neutral",
        title: "Sem jogos suficientes para comparar",
      };
    }

    if (metrica.diferencaAbsoluta < 1e-9 || metrica.vencedor === "tie") {
      return {
        text: "=",
        tone: "neutral",
        title: "Empate exato entre as duas temporadas (diferença 0)",
      };
    }

    const mag = formatComparatorMagnitude(metrica.diferencaAbsoluta, metrica.tipo);

    if (metrica.polaridade === "neutral") {
      const aMaior = metrica.diferenca > 0;
      const lado = aMaior ? anoA : anoB;
      return {
        text: aMaior ? `← +${mag}` : `+${mag} →`,
        tone: "neutral",
        title: `Indicador neutro: ${lado} registrou ${mag} a mais`,
      };
    }

    if (metrica.polaridade === "lower") {
      const aVenceu = metrica.vencedor === "A";
      const vencedorAno = aVenceu ? anoA : anoB;
      const outroAno = aVenceu ? anoB : anoA;
      return {
        text: aVenceu ? `← −${mag}` : `−${mag} →`,
        tone: aVenceu ? "a" : "b",
        title: `Menor é melhor: ${vencedorAno} teve ${mag} a menos que ${outroAno}`,
      };
    }

    const aVenceu = metrica.vencedor === "A";
    const vencedorAno = aVenceu ? anoA : anoB;
    const outroAno = aVenceu ? anoB : anoA;
    return {
      text: aVenceu ? `← +${mag}` : `+${mag} →`,
      tone: aVenceu ? "a" : "b",
      title: `${vencedorAno} superou ${outroAno} em ${mag}`,
    };
  }

  function formatSeasonQuickSummary(resumo) {
    if (!resumo || resumo.jogos === 0) {
      return "Sem partidas registradas neste mando.";
    }
    return `${fmtInt.format(resumo.pontos)} pts · ${formatPct(resumo.aproveitamento)} · ${fmtInt.format(resumo.vitorias)}V ${fmtInt.format(resumo.empates)}E ${fmtInt.format(resumo.derrotas)}D · SG ${formatSigned(resumo.saldoGols)}`;
  }

  function syncComparatorControlsUI() {
    if (dom["comparator-season-a"] && comparatorState.seasonA !== null) {
      dom["comparator-season-a"].value = String(comparatorState.seasonA);
    }
    if (dom["comparator-season-b"] && comparatorState.seasonB !== null) {
      dom["comparator-season-b"].value = String(comparatorState.seasonB);
    }

    document.querySelectorAll("[data-comparator-venue]").forEach((btn) => {
      const active = btn.dataset.comparatorVenue === comparatorState.venue;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function createComparatorValueCell(side, valor, subtexto, tipo, cellState, barPct) {
    const cell = document.createElement("div");
    cell.className = `comparator-cell comparator-cell--${side} is-${cellState}`;

    const pill = document.createElement("span");
    pill.className = "comparator-val-pill";
    pill.textContent = formatComparatorValue(valor, tipo);
    cell.appendChild(pill);

    if (subtexto) {
      const subEl = document.createElement("span");
      subEl.className = "comparator-val-sub";
      subEl.textContent = subtexto;
      cell.appendChild(subEl);
    }

    if (barPct !== null && Number.isFinite(barPct)) {
      const track = document.createElement("div");
      track.className = "comparator-bar-track";
      track.setAttribute("aria-hidden", "true");

      const fill = document.createElement("span");
      fill.className = `comparator-bar-fill comparator-bar-fill--${side}`;
      fill.style.width = `${Math.min(100, Math.max(0, barPct))}%`;

      track.appendChild(fill);
      cell.appendChild(track);
    }

    return cell;
  }

  function renderComparatorChart(comp) {
    const canvas = dom["chart-comparator"];
    const emptyEl = dom["empty-comparator"];
    const emptyTextEl = dom["empty-comparator-text"];
    if (!canvas || !emptyEl) return;

    const { temporadaA, temporadaB, mando, mesmaTemporada, resumoA, resumoB, evolucao } = comp;
    const mandoLabel =
      mando === "Casa" ? "em Casa" : mando === "Fora" ? "Fora de Casa" : "em todos os jogos";

    if (dom["comparator-chart-subtitle"]) {
      const notaTam =
        resumoA.jogos !== resumoB.jogos
          ? ` · série menor interrompida naturalmente (${fmtInt.format(resumoA.jogos)} vs ${fmtInt.format(resumoB.jogos)} jogos)`
          : "";
      dom["comparator-chart-subtitle"].textContent = `Pontos acumulados jogo a jogo ${mandoLabel}${notaTam}`;
    }

    if (dom["comparator-chart-badge"]) {
      dom["comparator-chart-badge"].textContent =
        evolucao.maxJogos > 0
          ? `Eixo até ${fmtInt.format(evolucao.maxJogos)} ${pluralizar(evolucao.maxJogos, "jogo", "jogos")}`
          : "0 jogos";
    }

    if (evolucao.maxJogos === 0 || typeof Chart === "undefined") {
      destroyChart("comparator");
      setChartEmptyState(canvas, emptyEl, true);
      if (emptyTextEl) {
        emptyTextEl.textContent = "Sem partidas válidas para exibir a curva de pontos acumulados.";
      }
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);
    destroyChart("comparator");

    const labelA = `${temporadaA}${TITULOS_SPFC.has(temporadaA) ? " ★" : ""} (${resumoA.jogos}J)`;
    const labelB = `${temporadaB}${TITULOS_SPFC.has(temporadaB) ? " ★" : ""} (${resumoB.jogos}J)`;
    const baseRadius = evolucao.maxJogos > 28 ? 2.2 : 3.2;

    const makePointRadii = (len) =>
      evolucao.labels.map((_, idx) => {
        if (idx >= len) return 0;
        return idx === len - 1 ? 5 : baseRadius;
      });

    const xAxisTitle =
      mando === "Casa"
        ? "Jogo em Casa na temporada"
        : mando === "Fora"
          ? "Jogo Fora na temporada"
          : "Jogo na temporada";

    charts.comparator = new Chart(canvas, {
      type: "line",
      data: {
        labels: evolucao.labels,
        datasets: [
          {
            label: labelA,
            data: evolucao.serieA,
            borderColor: COLORS.red,
            backgroundColor: "rgba(213, 0, 28, 0.08)",
            borderWidth: 2.8,
            tension: 0.2,
            spanGaps: false,
            pointRadius: makePointRadii(resumoA.jogos),
            pointHoverRadius: 6,
            pointBackgroundColor: COLORS.red,
            pointBorderColor: "#FFFFFF",
            pointBorderWidth: 1.5,
          },
          {
            label: labelB,
            data: evolucao.serieB,
            borderColor: COLORS.black,
            backgroundColor: "rgba(17, 19, 21, 0.07)",
            borderWidth: 2.6,
            borderDash: mesmaTemporada ? [6, 4] : [],
            tension: 0.2,
            spanGaps: false,
            pointStyle: "rectRounded",
            pointRadius: makePointRadii(resumoB.jogos),
            pointHoverRadius: 6,
            pointBackgroundColor: COLORS.black,
            pointBorderColor: "#FFFFFF",
            pointBorderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { boxWidth: 12, usePointStyle: true },
          },
          tooltip: {
            filter(item) {
              return item.parsed.y !== null && item.parsed.y !== undefined;
            },
            callbacks: {
              title(items) {
                if (!items || !items.length) return "";
                const idx = items[0].dataIndex;
                return `Jogo ${idx + 1} (${mando === "ALL" ? "Todos" : mando})`;
              },
              label(ctx) {
                if (ctx.parsed.y === null || ctx.parsed.y === undefined) return null;
                const idx = ctx.dataIndex;
                const isA = ctx.datasetIndex === 0;
                const ano = isA ? temporadaA : temporadaB;
                const jogo = isA ? evolucao.jogosA[idx] : evolucao.jogosB[idx];
                if (!jogo) return `${ano}: ${ctx.parsed.y} pts`;
                return `${ano}: ${ctx.parsed.y} pts — ${jogo.resultado} ${jogo.golsPro}×${jogo.golsContra} vs ${jogo.adversario} (R${jogo.rodada}, ${formatDateBR(jogo.data)})`;
              },
              afterBody(items) {
                if (!items || !items.length) return "";
                const idx = items[0].dataIndex;
                const ptsA = evolucao.serieA[idx];
                const ptsB = evolucao.serieB[idx];
                if (mesmaTemporada) {
                  return "Mesma temporada selecionada nos dois lados (diferença: 0 pts)";
                }
                if (ptsA !== null && ptsB !== null) {
                  const diff = ptsA - ptsB;
                  if (diff === 0) return `Empatadas com ${ptsA} pts no Jogo ${idx + 1}`;
                  const lider = diff > 0 ? temporadaA : temporadaB;
                  return `Diferença no Jogo ${idx + 1}: ${lider} +${Math.abs(diff)} ${pluralizar(Math.abs(diff), "ponto", "pontos")} à frente`;
                }
                if (ptsA === null && ptsB !== null) {
                  return `${temporadaA} encerrou com ${resumoA.jogos} ${pluralizar(resumoA.jogos, "jogo", "jogos")}`;
                }
                if (ptsB === null && ptsA !== null) {
                  return `${temporadaB} encerrou com ${resumoB.jogos} ${pluralizar(resumoB.jogos, "jogo", "jogos")}`;
                }
                return "";
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            title: { display: true, text: xAxisTitle, color: COLORS.tick },
            ticks: {
              color: COLORS.tick,
              autoSkip: true,
              maxTicksLimit: 12,
            },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Pontos acumulados", color: COLORS.tick },
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.tick, precision: 0 },
          },
        },
      },
    });
  }

  function renderSeasonComparator() {
    if (!dom["comparator-section"] || comparatorState.seasonA === null || comparatorState.seasonB === null) {
      return;
    }

    syncComparatorControlsUI();

    const comp = compararTemporadas(
      allMatches,
      comparatorState.seasonA,
      comparatorState.seasonB,
      comparatorState.venue
    );

    const { temporadaA, temporadaB, mando, mesmaTemporada, resumoA, resumoB, metricas, placarMetricas } =
      comp;

    // Aviso contextual (mesma temporada ou quantidades diferentes de jogos)
    if (dom["comparator-notice"]) {
      const avisos = [];
      if (mesmaTemporada) {
        avisos.push(
          `A mesma temporada (${temporadaA}) está selecionada nos dois lados — todos os indicadores aparecem em estado neutro (=).`
        );
      } else if (resumoA.jogos !== resumoB.jogos) {
        avisos.push(
          `As temporadas possuem quantidades diferentes de jogos (${temporadaA}: ${resumoA.jogos} vs ${temporadaB}: ${resumoB.jogos}). Use Aproveitamento (%) e médias por jogo para comparação proporcional.`
        );
      }

      if (avisos.length > 0) {
        dom["comparator-notice"].textContent = avisos.join(" ");
        dom["comparator-notice"].classList.remove("is-hidden");
      } else {
        dom["comparator-notice"].textContent = "";
        dom["comparator-notice"].classList.add("is-hidden");
      }
    }

    // Cabeçalho com resumo rápido das duas temporadas
    const mandoTag = mando === "ALL" ? "" : ` (${mando})`;
    dom["comparator-a-year"].textContent = String(temporadaA);
    dom["comparator-a-games"].textContent = `${fmtInt.format(resumoA.jogos)} ${pluralizar(resumoA.jogos, "jogo", "jogos")}${mandoTag}`;
    dom["comparator-a-title-pill"].classList.toggle("is-hidden", !TITULOS_SPFC.has(temporadaA));
    dom["comparator-a-quick"].textContent = formatSeasonQuickSummary(resumoA);

    dom["comparator-b-year"].textContent = String(temporadaB);
    dom["comparator-b-games"].textContent = `${fmtInt.format(resumoB.jogos)} ${pluralizar(resumoB.jogos, "jogo", "jogos")}${mandoTag}`;
    dom["comparator-b-title-pill"].classList.toggle("is-hidden", !TITULOS_SPFC.has(temporadaB));
    dom["comparator-b-quick"].textContent = formatSeasonQuickSummary(resumoB);

    // Resumo central de vantagem
    if (dom["comparator-advantage-summary"]) {
      if (mesmaTemporada) {
        dom["comparator-advantage-summary"].textContent = "Mesma temporada · 0 diferenças";
      } else if (resumoA.jogos === 0 || resumoB.jogos === 0) {
        dom["comparator-advantage-summary"].textContent = "Aguardando jogos nos dois lados";
      } else if (placarMetricas.vitoriasA > placarMetricas.vitoriasB) {
        dom["comparator-advantage-summary"].textContent = `${temporadaA} lidera em ${placarMetricas.vitoriasA} de ${placarMetricas.comparaveis} métricas`;
      } else if (placarMetricas.vitoriasB > placarMetricas.vitoriasA) {
        dom["comparator-advantage-summary"].textContent = `${temporadaB} lidera em ${placarMetricas.vitoriasB} de ${placarMetricas.comparaveis} métricas`;
      } else {
        dom["comparator-advantage-summary"].textContent = `Equilíbrio: ${placarMetricas.vitoriasA} × ${placarMetricas.vitoriasB} (${placarMetricas.empates} ${pluralizar(placarMetricas.empates, "empate", "empates")})`;
      }
    }

    // Cabeçalho das colunas da tabela comparativa
    dom["comparator-col-a"].textContent = `${temporadaA}${TITULOS_SPFC.has(temporadaA) ? " ★" : ""}`;
    dom["comparator-col-b"].textContent = `${temporadaB}${TITULOS_SPFC.has(temporadaB) ? " ★" : ""}`;

    // Grid comparativo de 3 colunas (DOM seguro, zero innerHTML)
    const bodyEl = dom["comparator-metrics-body"];
    const fragment = document.createDocumentFragment();

    for (const m of metricas) {
      const row = document.createElement("div");
      row.className = "comparator-row";

      let stateA = "neutral";
      let stateB = "neutral";
      if (!mesmaTemporada && m.vencedor === "A") {
        stateA = "winner";
        stateB = "loser";
      } else if (!mesmaTemporada && m.vencedor === "B") {
        stateA = "loser";
        stateB = "winner";
      }

      // Barra proporcional sutil somente quando ambos os valores são não-negativos
      let barA = null;
      let barB = null;
      if (
        Number.isFinite(m.valorA) &&
        Number.isFinite(m.valorB) &&
        m.valorA >= 0 &&
        m.valorB >= 0
      ) {
        const maxVal = Math.max(m.valorA, m.valorB);
        barA = maxVal > 0 ? (m.valorA / maxVal) * 100 : 0;
        barB = maxVal > 0 ? (m.valorB / maxVal) * 100 : 0;
      }

      const cellA = createComparatorValueCell("a", m.valorA, m.subtextoA, m.tipo, stateA, barA);
      const cellB = createComparatorValueCell("b", m.valorB, m.subtextoB, m.tipo, stateB, barB);

      const centerCell = document.createElement("div");
      centerCell.className = "comparator-center-cell";

      const labelEl = document.createElement("span");
      labelEl.className = "comparator-metric-label";
      labelEl.textContent = m.rotulo;
      centerCell.appendChild(labelEl);

      if (m.polaridade === "lower") {
        const hintEl = document.createElement("span");
        hintEl.className = "comparator-polarity-hint";
        hintEl.textContent = "↓ menor é melhor";
        centerCell.appendChild(hintEl);
      }

      const deltaInfo = buildComparatorDeltaDisplay(m, temporadaA, temporadaB, mesmaTemporada);
      const deltaBadge = document.createElement("span");
      deltaBadge.className = `comparator-delta-badge comparator-delta-badge--${deltaInfo.tone}`;
      deltaBadge.textContent = deltaInfo.text;
      deltaBadge.title = deltaInfo.title;
      centerCell.appendChild(deltaBadge);

      row.appendChild(cellA);
      row.appendChild(centerCell);
      row.appendChild(cellB);
      fragment.appendChild(row);
    }

    bodyEl.replaceChildren(fragment);

    // Gráfico comparativo de evolução (Pontos Acumulados)
    renderComparatorChart(comp);
  }

  function populateComparatorSelects() {
    const selectA = dom["comparator-season-a"];
    const selectB = dom["comparator-season-b"];
    if (!selectA || !selectB) return;

    const availableSeasonsDesc = [
      ...new Set(
        allMatches
          .map((m) => m.temporada)
          .filter((year) => typeof year === "number" && Number.isFinite(year))
      ),
    ].sort((a, b) => b - a);

    selectA.replaceChildren();
    selectB.replaceChildren();

    for (const year of availableSeasonsDesc) {
      const label = TITULOS_SPFC.has(year) ? `${year} ★` : String(year);
      selectA.add(new Option(label, String(year)));
      selectB.add(new Option(label, String(year)));
    }

    // Valores padrão inteligentes: duas temporadas mais recentes disponíveis na base
    if (availableSeasonsDesc.length > 0) {
      comparatorState.seasonA = availableSeasonsDesc[0];
      comparatorState.seasonB =
        availableSeasonsDesc.length > 1 ? availableSeasonsDesc[1] : availableSeasonsDesc[0];
      comparatorState.venue = "ALL";
    }
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
    renderRecordsAndStreaks(filtered);
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
    validOpponentClubs = new Map();
    const optGroup = document.createElement("optgroup");
    optGroup.label = "Adversários (A–Z)";
    for (const opp of opponents) {
      const normalized = normalizeText(opp);
      opponentLookup.set(normalized, opp);
      validOpponentClubs.set(normalized, opp);
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

    // Eventos isolados do Comparador de Temporadas (não alteram filtros globais nem URL)
    if (dom["comparator-season-a"]) {
      dom["comparator-season-a"].addEventListener("change", (e) => {
        const val = Number(e.target.value);
        if (Number.isFinite(val)) {
          comparatorState.seasonA = val;
          renderSeasonComparator();
        }
      });
    }

    if (dom["comparator-season-b"]) {
      dom["comparator-season-b"].addEventListener("change", (e) => {
        const val = Number(e.target.value);
        if (Number.isFinite(val)) {
          comparatorState.seasonB = val;
          renderSeasonComparator();
        }
      });
    }

    if (dom["comparator-swap"]) {
      dom["comparator-swap"].addEventListener("click", () => {
        const prevA = comparatorState.seasonA;
        comparatorState.seasonA = comparatorState.seasonB;
        comparatorState.seasonB = prevA;
        renderSeasonComparator();
      });
    }

    document.querySelectorAll("[data-comparator-venue]").forEach((btn) => {
      btn.addEventListener("click", () => {
        comparatorState.venue = normalizarMandoComparador(btn.dataset.comparatorVenue);
        renderSeasonComparator();
      });
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

  // =========================================================================
  // Card de Próximo Jogo (carregamento resiliente e atalho de retrospecto)
  // =========================================================================

  function parseIsoCalendarDate(isoDate) {
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

  function getLocalTodayIso(referenceDate = new Date()) {
    const ref = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate
      : new Date();
    const year = String(ref.getFullYear());
    const month = String(ref.getMonth() + 1).padStart(2, "0");
    const day = String(ref.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatarDataProximoJogo(isoDate) {
    const parsed = parseIsoCalendarDate(isoDate);
    if (!parsed) return null;
    const weekday = WEEKDAYS_PT_SHORT[parsed.weekdayIndex];
    return `${weekday}, ${parsed.day}/${parsed.month}/${parsed.year}`;
  }

  function formatarHoraProximoJogo(hora, horarioDefinido) {
    if (horarioDefinido === true && typeof hora === "string") {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
      if (match) {
        return {
          texto: `${match[1]}h${match[2]} (Brasília)`,
          definido: true,
        };
      }
    }
    return {
      texto: "Horário a definir",
      definido: false,
    };
  }

  function calcularSeloTemporalProximoJogo(isoDate, hojeIso = getLocalTodayIso()) {
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

  function resolverAdversarioNaBase(adversario, clubsLookup = validOpponentClubs) {
    if (typeof adversario !== "string" || !adversario.trim()) return null;
    if (!(clubsLookup instanceof Map) || clubsLookup.size === 0) return null;
    const canonical = clubsLookup.get(normalizeText(adversario));
    if (!canonical || canonical === "ALL" || canonical === "CLASSICOS") return null;
    return canonical;
  }

  function calcularResumoConfronto(canonicalOpponent, matches = allMatches) {
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

  function montarModeloProximoJogo(payload, opcoes = {}) {
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
    const seloTemporal = calcularSeloTemporalProximoJogo(
      pj.data,
      opcoes.hojeIso || getLocalTodayIso()
    );

    const baseCarregada = Boolean(opcoes.baseCarregada);
    const baseFalhou = Boolean(opcoes.baseFalhou);
    const clubsLookup = opcoes.clubsLookup instanceof Map ? opcoes.clubsLookup : validOpponentClubs;
    const matches = Array.isArray(opcoes.matches) ? opcoes.matches : allMatches;

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
      resumoHistorico,
      atualizadoEmFormatado,
    };
  }

  function createNextMatchSvgIcon(iconName) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    const pathsByIcon = {
      calendar: [
        "M8 2v4",
        "M16 2v4",
        "M3 10h18",
        "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
      ],
      clock: [
        "M12 6v6l4 2",
        "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
      ],
      arrowRight: [
        "M5 12h14",
        "M13 6l6 6-6 6",
      ],
    };

    const paths = pathsByIcon[iconName] || [];
    for (const d of paths) {
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function aplicarFiltroRetrospectoAdversario(canonicalOpponent) {
    if (!dashboardReady || !canonicalOpponent) return;
    const resolved = resolverAdversarioNaBase(canonicalOpponent, validOpponentClubs);
    if (!resolved) return;

    const oppSelect = dom["filter-opponent"];
    if (oppSelect) {
      const hasOption = Array.from(oppSelect.options).some((opt) => opt.value === resolved);
      if (!hasOption) return;
    }

    state.seasonStart = minSeason;
    state.seasonEnd = maxSeason;
    state.opponent = resolved;
    state.venue = "ALL";
    state.tableResult = "ALL";
    state.tableSearch = "";
    state.tablePage = 1;
    if (dom["table-search"]) {
      dom["table-search"].value = "";
    }

    updateDashboard();

    const scrollTarget = dom["filters-section"] || dom["dashboard-root"];
    if (scrollTarget && typeof scrollTarget.scrollIntoView === "function") {
      scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderNextMatchCard() {
    const sectionEl = dom["next-match-section"];
    const cardEl = dom["next-match-card"];
    if (!sectionEl || !cardEl) return;

    const modelo = montarModeloProximoJogo(nextMatchPayload, {
      baseCarregada: dashboardReady,
      baseFalhou: dashboardFailed,
      clubsLookup: validOpponentClubs,
      matches: allMatches,
    });

    if (modelo.estado === "oculto") {
      sectionEl.classList.add("is-hidden");
      cardEl.className = "next-match-card";
      cardEl.replaceChildren();
      return;
    }

    sectionEl.classList.remove("is-hidden");

    if (modelo.estado === "sem_jogo") {
      cardEl.className = "next-match-card next-match-card--empty";

      const mainWrap = document.createElement("div");
      mainWrap.className = "next-match-empty-main";

      const kicker = document.createElement("h2");
      kicker.id = "next-match-heading";
      kicker.className = "next-match-kicker";
      const dot = document.createElement("span");
      dot.className = "next-match-dot";
      dot.setAttribute("aria-hidden", "true");
      kicker.appendChild(dot);
      kicker.appendChild(document.createTextNode("Próximo jogo"));

      const msgEl = document.createElement("p");
      msgEl.className = "next-match-empty-text";
      msgEl.textContent = modelo.mensagem;

      mainWrap.appendChild(kicker);
      mainWrap.appendChild(msgEl);

      const children = [mainWrap];
      if (modelo.atualizadoEmFormatado) {
        const metaEl = document.createElement("span");
        metaEl.className = "next-match-empty-meta";
        metaEl.textContent = `Atualizado em ${modelo.atualizadoEmFormatado}`;
        children.push(metaEl);
      }

      cardEl.replaceChildren(...children);
      return;
    }

    // Estado 1: Próximo jogo disponível
    cardEl.className = "next-match-card next-match-card--ready";

    const infoCol = document.createElement("div");
    infoCol.className = "next-match-info";

    // Linha superior: kicker + competição/rodada + selo temporal
    const metaTop = document.createElement("div");
    metaTop.className = "next-match-meta-top";

    const kicker = document.createElement("h2");
    kicker.id = "next-match-heading";
    kicker.className = "next-match-kicker";
    const dot = document.createElement("span");
    dot.className = "next-match-dot";
    dot.setAttribute("aria-hidden", "true");
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode("Próximo jogo"));
    metaTop.appendChild(kicker);

    const compEl = document.createElement("span");
    compEl.className = "next-match-comp";
    compEl.textContent = modelo.competicaoRodada;
    metaTop.appendChild(compEl);

    if (modelo.seloTemporal) {
      const badgeEl = document.createElement("span");
      badgeEl.className = `next-match-countdown next-match-countdown--${modelo.seloTemporal.tom}`;
      badgeEl.textContent = modelo.seloTemporal.texto;
      metaTop.appendChild(badgeEl);
    }

    infoCol.appendChild(metaTop);

    // Linha principal: Confronto (Mandante × Visitante) + Badge de mando
    const matchupRow = document.createElement("div");
    matchupRow.className = "next-match-matchup";

    const teamsEl = document.createElement("div");
    teamsEl.className = "next-match-teams";

    const leftTeamEl = document.createElement("span");
    leftTeamEl.className = `next-match-team${modelo.spfcEsquerda ? " is-spfc" : ""}`;
    leftTeamEl.textContent = modelo.timeEsquerda;

    const vsEl = document.createElement("span");
    vsEl.className = "next-match-vs";
    vsEl.setAttribute("aria-hidden", "true");
    vsEl.textContent = "×";

    const rightTeamEl = document.createElement("span");
    rightTeamEl.className = `next-match-team${!modelo.spfcEsquerda ? " is-spfc" : ""}`;
    rightTeamEl.textContent = modelo.timeDireita;

    teamsEl.appendChild(leftTeamEl);
    teamsEl.appendChild(vsEl);
    teamsEl.appendChild(rightTeamEl);
    matchupRow.appendChild(teamsEl);

    if (modelo.mando) {
      const venueBadge = document.createElement("span");
      const venueClass =
        modelo.mando === "Casa" ? "next-match-venue--home" : "next-match-venue--away";
      venueBadge.className = `next-match-venue ${venueClass}`;
      venueBadge.textContent = modelo.mando;
      venueBadge.setAttribute("aria-label", `Mando de campo: ${modelo.mando}`);
      matchupRow.appendChild(venueBadge);
    }

    infoCol.appendChild(matchupRow);

    // Linha de detalhes: Data + Horário
    const detailsRow = document.createElement("div");
    detailsRow.className = "next-match-details";

    const dateItem = document.createElement("span");
    dateItem.className = "next-match-detail-item";
    dateItem.appendChild(createNextMatchSvgIcon("calendar"));
    const dateText = document.createElement("span");
    dateText.textContent = modelo.dataFormatada;
    dateItem.appendChild(dateText);
    detailsRow.appendChild(dateItem);

    const timeItem = document.createElement("span");
    timeItem.className = `next-match-detail-item${modelo.horario.definido ? "" : " is-tbd"}`;
    timeItem.appendChild(createNextMatchSvgIcon("clock"));
    const timeText = document.createElement("span");
    timeText.textContent = modelo.horario.texto;
    timeItem.appendChild(timeText);
    detailsRow.appendChild(timeItem);

    infoCol.appendChild(detailsRow);

    // Mini resumo histórico na base (calculado em memória, sem chamadas extras)
    if (modelo.resumoHistorico) {
      const h2h = modelo.resumoHistorico;
      const h2hEl = document.createElement("div");
      h2hEl.className = "next-match-h2h";

      const labelEl = document.createElement("span");
      labelEl.className = "next-match-h2h-label";
      labelEl.textContent = "Histórico na base:";
      h2hEl.appendChild(labelEl);

      const gamesEl = document.createElement("span");
      gamesEl.className = "next-match-h2h-record";
      gamesEl.textContent = `${fmtInt.format(h2h.games)} ${pluralizar(h2h.games, "jogo", "jogos")}`;
      h2hEl.appendChild(gamesEl);

      h2hEl.appendChild(document.createTextNode("·"));

      const winEl = document.createElement("span");
      winEl.className = "next-match-h2h-record next-match-h2h-win";
      winEl.textContent = `${fmtInt.format(h2h.wins)}V`;
      h2hEl.appendChild(winEl);

      const drawEl = document.createElement("span");
      drawEl.className = "next-match-h2h-record next-match-h2h-draw";
      drawEl.textContent = `${fmtInt.format(h2h.draws)}E`;
      h2hEl.appendChild(drawEl);

      const lossEl = document.createElement("span");
      lossEl.className = "next-match-h2h-record next-match-h2h-loss";
      lossEl.textContent = `${fmtInt.format(h2h.losses)}D`;
      h2hEl.appendChild(lossEl);

      if (h2h.winrate !== null) {
        const pctEl = document.createElement("span");
        pctEl.textContent = `(${formatPct(h2h.winrate)})`;
        h2hEl.appendChild(pctEl);
      }

      infoCol.appendChild(h2hEl);
    }

    // Coluna de ação direta (atalho para o retrospecto)
    const actionCol = document.createElement("div");
    actionCol.className = "next-match-action";

    if (modelo.adversarioCanonico) {
      const ctaBtn = document.createElement("button");
      ctaBtn.type = "button";
      ctaBtn.id = "btn-next-match-h2h";
      ctaBtn.className = "next-match-cta";

      const btnLabel = document.createElement("span");
      btnLabel.textContent = `Ver retrospecto contra ${modelo.adversarioCanonico}`;
      ctaBtn.appendChild(btnLabel);
      ctaBtn.appendChild(createNextMatchSvgIcon("arrowRight"));

      ctaBtn.addEventListener("click", () => {
        aplicarFiltroRetrospectoAdversario(modelo.adversarioCanonico);
      });
      actionCol.appendChild(ctaBtn);
    } else if (modelo.confrontoInedito) {
      const disabledBtn = document.createElement("button");
      disabledBtn.type = "button";
      disabledBtn.id = "btn-next-match-h2h";
      disabledBtn.className = "next-match-cta next-match-cta--disabled";
      disabledBtn.disabled = true;
      disabledBtn.setAttribute("aria-disabled", "true");
      disabledBtn.title = "Ainda não há confrontos contra este clube na base dos pontos corridos";
      disabledBtn.textContent = "Confronto inédito na base";
      actionCol.appendChild(disabledBtn);
    } else if (!modelo.baseCarregada && !modelo.baseFalhou) {
      const loadingHint = document.createElement("span");
      loadingHint.className = "next-match-loading-hint";
      loadingHint.textContent = "Carregando histórico...";
      actionCol.appendChild(loadingHint);
    }

    const cardChildren = [infoCol];
    if (actionCol.childNodes.length > 0) {
      cardChildren.push(actionCol);
    }
    cardEl.replaceChildren(...cardChildren);
  }

  async function fetchNextMatch() {
    try {
      const resp = await fetch(NEXT_MATCH_URL, { cache: "no-cache" });
      if (!resp.ok) {
        console.warn(
          `[Dados Tricolor] Próximo jogo indisponível (HTTP ${resp.status}) em ${NEXT_MATCH_URL}.`
        );
        return { ok: false, data: null };
      }
      const data = await resp.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        console.warn(`[Dados Tricolor] Formato inválido em ${NEXT_MATCH_URL}.`);
        return { ok: false, data: null };
      }
      return { ok: true, data };
    } catch (err) {
      console.warn(`[Dados Tricolor] Falha ao carregar ${NEXT_MATCH_URL}:`, err);
      return { ok: false, data: null };
    }
  }

  async function loadNextMatch() {
    const result = await fetchNextMatch();
    nextMatchPayload = result.ok ? result.data : null;
    renderNextMatchCard();
  }

  async function init() {
    cacheDom();
    configureChartDefaults();

    // Carregamento independente e não bloqueante do card de Próximo Jogo
    loadNextMatch();

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
      populateComparatorSelects();
      applyFiltersFromUrl();
      bindEvents();

      dashboardReady = true;
      dom["state-loading"].classList.add("is-hidden");
      dom["dashboard-root"].classList.remove("is-hidden");
      updateDashboard();
      renderSeasonComparator();
      renderNextMatchCard();
    } catch (error) {
      dashboardFailed = true;
      renderNextMatchCard();
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

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      resumirTemporada,
      compararTemporadas,
      calcularRecordesESequencias,
      parseIsoCalendarDate,
      formatarDataProximoJogo,
      formatarHoraProximoJogo,
      calcularSeloTemporalProximoJogo,
      resolverAdversarioNaBase,
      calcularResumoConfronto,
      montarModeloProximoJogo,
    };
  }
})();

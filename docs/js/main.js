/**
 * Dados Tricolor — Entrypoint e Orquestração (`main.js`)
 * Coordena o bootstrap da aplicação, cache do DOM, renderização de KPIs,
 * Recordes/Streaks, Comparador de Temporadas, Card de Próximo Jogo e eventos.
 */

import {
  NEXT_MATCH_REFRESH_MS,
  TITULOS_SPFC,
  fmtDec1,
  fmtDec2,
  fmtInt,
  formatAvg,
  formatDateTimeBRT,
  formatPct,
  formatSigned,
  loadMatchesDataset,
  loadNextMatch,
  loadSyncMeta,
  pluralizar,
} from "./data.js";
import {
  applyFiltersFromUrl,
  bindFilterEvents,
  calcularEstadoTemporalJogo,
  calcularRecordesESequencias,
  compararTemporadas,
  computeSummary,
  createFilterState,
  createShareLinkHandler,
  describeActiveFilters,
  filterMatches,
  isDefaultFilterState,
  montarModeloProximoJogo,
  normalizarMandoComparador,
  populateFilterSelects,
  resetFilterState,
  resolverAdversarioNaBase,
  syncFilterControlsUI,
  syncTableFilterControlsUI,
  syncUrlWithState,
} from "./filters.js";
import {
  configureChartDefaults,
  renderComparatorChart,
  renderEvolutionChart,
  renderScorersChart,
  renderSecondaryChart,
  renderVenueChart,
} from "./charts.js";
import { bindTableEvents, renderTable } from "./table.js";

// =========================================================================
// Estado encapsulado da aplicação (zero variáveis globais em window)
// =========================================================================

const DOM_IDS = [
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

const dom = {};

let allMatches = [];
let datasetMeta = {};
let bounds = {
  minSeason: 2003,
  maxSeason: 2003,
  modernStart: 2014,
  totalSeasons: 0,
  detailedGamesCount: 0,
  validSeasons: new Set(),
  availableSeasonsDesc: [],
  opponents: [],
  opponentLookup: new Map(),
  validOpponentClubs: new Map(),
};
let state = createFilterState(bounds);

const comparatorState = {
  seasonA: null,
  seasonB: null,
  venue: "ALL", // "ALL" | "Casa" | "Fora"
};

let dashboardReady = false;
let dashboardFailed = false;
let nextMatchPayload = null;
let nextMatchStatusTimer = null;

function cacheDom() {
  for (const id of DOM_IDS) {
    dom[id] = document.getElementById(id);
  }
}

// =========================================================================
// Renderização dos KPIs
// =========================================================================

function clampPercent(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;
}

const VALID_RECORD_TONES = new Set(["positive", "negative", "neutral", "empty"]);
const VALID_COUNTDOWN_TONES = new Set(["today", "tomorrow", "upcoming", "past", "live"]);
const VALID_EVOLUTION_MODES = new Set(["performance", "goals"]);
const VALID_SECONDARY_TABS = new Set(["discipline", "opponents"]);

function renderKPIs(matches) {
  const s = computeSummary(matches);

  // Banner global de estado vazio
  const isEmpty = s.games === 0;
  dom["empty-filter-banner"].classList.toggle("is-hidden", !isEmpty);
  if (isEmpty) {
    dom["empty-filter-detail"].textContent = `Recorte sem partidas: ${describeActiveFilters(state)}.`;
  }

  // Card 1: Partidas
  dom["kpi-games"].textContent = fmtInt.format(s.games);
  dom["kpi-seasons-tag"].textContent =
    s.seasonsCount === 1 ? "1 temp." : `${fmtInt.format(s.seasonsCount)} temps.`;
  dom["kpi-games-split"].textContent = `${fmtInt.format(s.homeGames)} Casa · ${fmtInt.format(s.awayGames)} Fora`;

  // Card 2: Aproveitamento
  dom["kpi-winrate"].textContent = formatPct(s.winrate);
  dom["kpi-points-tag"].textContent = `${fmtInt.format(s.points)} pts`;
  dom["kpi-winrate-bar"].style.width = `${clampPercent(s.winrate)}%`;
  dom["kpi-points-detail"].textContent =
    s.games > 0
      ? `${fmtInt.format(s.points)} de ${fmtInt.format(s.maxPoints)} pontos possíveis`
      : "Sem partidas no recorte";

  // Card 3: Retrospecto V/E/D
  dom["kpi-wins"].textContent = fmtInt.format(s.wins);
  dom["kpi-draws"].textContent = fmtInt.format(s.draws);
  dom["kpi-losses"].textContent = fmtInt.format(s.losses);
  dom["kpi-bar-win"].style.width = `${clampPercent(s.winPct)}%`;
  dom["kpi-bar-draw"].style.width = `${clampPercent(s.drawPct)}%`;
  dom["kpi-bar-loss"].style.width = `${clampPercent(s.lossPct)}%`;
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
        : `Sem registros (cobertura ${bounds.modernStart}–${bounds.maxSeason})`;
  } else {
    dom["kpi-yellow-total"].textContent = fmtInt.format(s.yellowTotal);
    dom["kpi-yellow-avg"].textContent = `${formatAvg(s.yellowAvg)} / jogo`;
    dom["kpi-red-total"].textContent = fmtInt.format(s.redTotal);
    dom["kpi-red-avg"].textContent = `${formatAvg(s.redAvg)} / jogo`;

    if (s.cardGames < s.games) {
      dom["kpi-cards-coverage"].textContent = `Base: ${fmtInt.format(s.cardGames)} de ${fmtInt.format(s.games)} jogos (${bounds.modernStart}–${bounds.maxSeason})`;
    } else {
      const labelJogos = s.cardGames === 1 ? "jogo" : "jogos";
      dom["kpi-cards-coverage"].textContent = `Média em ${fmtInt.format(s.cardGames)} ${labelJogos} (${bounds.modernStart}–${bounds.maxSeason})`;
    }
  }
}

// =========================================================================
// Renderização de Recordes e Sequências (Streaks)
// =========================================================================

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
  const safeTone =
    toneClass === "positive" || toneClass === "negative" || toneClass === "neutral"
      ? toneClass
      : "";
  const wrap = document.createElement("span");
  wrap.className = `record-icon${safeTone ? ` record-icon--${safeTone}` : ""}`;
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
  const pathData = Object.hasOwn(RECORD_ICON_PATHS, iconKey)
    ? RECORD_ICON_PATHS[iconKey]
    : RECORD_ICON_PATHS.pulse;
  path.setAttribute("d", pathData);
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

function createRecordCard({
  title,
  icon,
  tone = "neutral",
  badgeText = "",
  valueText = "—",
  compactValue = false,
  isEmptyValue = false,
  metaText = "",
  opponentName = "",
  metaSuffix = "",
  tieCount = 0,
}) {
  const safeTone = VALID_RECORD_TONES.has(tone) ? tone : "neutral";
  const card = document.createElement("article");
  card.className = `record-card record-card--${safeTone}`;

  const head = document.createElement("div");
  head.className = "record-card-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "record-title-wrap";
  const iconTone = safeTone === "empty" ? "" : safeTone;
  titleWrap.appendChild(createRecordIcon(icon, iconTone));

  const titleEl = document.createElement("span");
  titleEl.className = "record-title";
  titleEl.textContent = title;
  titleWrap.appendChild(titleEl);
  head.appendChild(titleWrap);

  if (badgeText) {
    const badgeEl = document.createElement("span");
    const badgeToneClass =
      safeTone === "positive" || safeTone === "negative" || safeTone === "neutral"
        ? ` record-badge--${safeTone}`
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
// Renderização do Comparador de Temporadas Lado a Lado
// =========================================================================

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

function populateComparatorSelects() {
  const selectA = dom["comparator-season-a"];
  const selectB = dom["comparator-season-b"];
  if (!selectA || !selectB) return;

  const { availableSeasonsDesc } = bounds;

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
  renderComparatorChart({ dom, comparison: comp });
}

// =========================================================================
// Card de Próximo Jogo (renderização segura e atualização periódica)
// =========================================================================

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

  const paths = Object.hasOwn(pathsByIcon, iconName) ? pathsByIcon[iconName] : [];
  for (const d of paths) {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function stopNextMatchStatusTimer() {
  if (nextMatchStatusTimer !== null) {
    window.clearInterval(nextMatchStatusTimer);
    nextMatchStatusTimer = null;
  }
}

function applyNextMatchTemporalState(seloTemporal, elements) {
  if (!seloTemporal || !elements) return;
  const { badgeEl, noteEl } = elements;

  if (badgeEl) {
    const safeTone = VALID_COUNTDOWN_TONES.has(seloTemporal.tom) ? seloTemporal.tom : "upcoming";
    const nextClassName = `next-match-countdown next-match-countdown--${safeTone}`;
    if (badgeEl.className !== nextClassName) {
      badgeEl.className = nextClassName;
    }
    if (badgeEl.textContent !== seloTemporal.texto) {
      badgeEl.textContent = seloTemporal.texto;
    }
  }

  if (noteEl) {
    const subtexto = typeof seloTemporal.subtexto === "string" ? seloTemporal.subtexto : "";
    if (subtexto) {
      if (noteEl.textContent !== subtexto) {
        noteEl.textContent = subtexto;
      }
      noteEl.classList.remove("is-hidden");
    } else {
      if (noteEl.textContent !== "") {
        noteEl.textContent = "";
      }
      noteEl.classList.add("is-hidden");
    }
  }
}

function scheduleNextMatchStatusRefresh(jogoTemporal, estadoInicial, elements) {
  stopNextMatchStatusTimer();
  if (
    typeof window === "undefined" ||
    !jogoTemporal ||
    !estadoInicial ||
    !estadoInicial.deveAtualizar
  ) {
    return;
  }

  nextMatchStatusTimer = window.setInterval(() => {
    if (elements.badgeEl && !elements.badgeEl.isConnected) {
      stopNextMatchStatusTimer();
      return;
    }
    const proximoEstado = calcularEstadoTemporalJogo(jogoTemporal, Date.now());
    if (!proximoEstado) {
      stopNextMatchStatusTimer();
      return;
    }
    applyNextMatchTemporalState(proximoEstado, elements);
    if (!proximoEstado.deveAtualizar) {
      stopNextMatchStatusTimer();
    }
  }, NEXT_MATCH_REFRESH_MS);
}

function aplicarFiltroRetrospectoAdversario(canonicalOpponent) {
  if (!dashboardReady || !canonicalOpponent) return;
  const resolved = resolverAdversarioNaBase(canonicalOpponent, bounds.validOpponentClubs);
  if (!resolved) return;

  const oppSelect = dom["filter-opponent"];
  if (oppSelect) {
    const hasOption = Array.from(oppSelect.options).some((opt) => opt.value === resolved);
    if (!hasOption) return;
  }

  resetFilterState(state, bounds);
  state.opponent = resolved;
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

  stopNextMatchStatusTimer();

  const modelo = montarModeloProximoJogo(nextMatchPayload, {
    baseCarregada: dashboardReady,
    baseFalhou: dashboardFailed,
    clubsLookup: bounds.validOpponentClubs,
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

  // Estado: Próximo jogo disponível
  cardEl.className = "next-match-card next-match-card--ready";

  const infoCol = document.createElement("div");
  infoCol.className = "next-match-info";

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

  let statusBadgeEl = null;
  let statusNoteEl = null;

  if (modelo.seloTemporal) {
    const statusGroup = document.createElement("span");
    statusGroup.className = "next-match-status-group";

    statusBadgeEl = document.createElement("span");
    statusBadgeEl.id = "next-match-countdown-badge";

    statusNoteEl = document.createElement("span");
    statusNoteEl.id = "next-match-status-note";
    statusNoteEl.className = "next-match-status-note is-hidden";

    applyNextMatchTemporalState(modelo.seloTemporal, {
      badgeEl: statusBadgeEl,
      noteEl: statusNoteEl,
    });

    statusGroup.appendChild(statusBadgeEl);
    statusGroup.appendChild(statusNoteEl);
    metaTop.appendChild(statusGroup);
  }

  infoCol.appendChild(metaTop);

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

  if (modelo.seloTemporal && statusBadgeEl && statusNoteEl) {
    scheduleNextMatchStatusRefresh(modelo.jogoTemporal, modelo.seloTemporal, {
      badgeEl: statusBadgeEl,
      noteEl: statusNoteEl,
    });
  }
}

// =========================================================================
// Rótulos Dinâmicos e Selo de Atualização
// =========================================================================

function applyDynamicSeasonLabels() {
  const shortMin = String(bounds.minSeason).slice(-2);
  const shortMax = String(bounds.maxSeason).slice(-2);
  const shortModern = String(bounds.modernStart).slice(-2);

  document.title = `Dados Tricolor — São Paulo FC nos Pontos Corridos (${bounds.minSeason}–${bounds.maxSeason})`;
  if (dom["brand-subtitle"]) {
    dom["brand-subtitle"].textContent = `São Paulo FC no Campeonato Brasileiro · Era dos Pontos Corridos (${bounds.minSeason}–${bounds.maxSeason})`;
  }
  dom["header-dataset-badge"].textContent = `${bounds.totalSeasons} temporadas · ${fmtInt.format(allMatches.length)} jogos`;

  if (dom["chip-period-all"]) {
    dom["chip-period-all"].textContent = `Todas (${shortMin}–${shortMax})`;
  }
  if (dom["chip-period-modern"]) {
    dom["chip-period-modern"].textContent = `Com Gols/Cartões (${shortModern}–${shortMax})`;
  }
  if (dom["chip-period-current"]) {
    dom["chip-period-current"].textContent = String(bounds.maxSeason);
  }
  if (dom["scorers-coverage-badge"]) {
    dom["scorers-coverage-badge"].textContent = `Base ${bounds.modernStart}–${bounds.maxSeason}`;
  }
  if (dom["btn-jump-modern-scorers"]) {
    dom["btn-jump-modern-scorers"].textContent = `Ver período ${bounds.modernStart}–${bounds.maxSeason}`;
  }
  if (dom["btn-jump-modern-cards"]) {
    dom["btn-jump-modern-cards"].textContent = `Ver período ${bounds.modernStart}–${bounds.maxSeason}`;
  }
  if (dom["footer-range-all"]) {
    dom["footer-range-all"].textContent = `${bounds.minSeason} a ${bounds.maxSeason}`;
  }
  if (dom["footer-games-all"]) {
    dom["footer-games-all"].textContent = fmtInt.format(allMatches.length);
  }
  if (dom["footer-range-modern"]) {
    dom["footer-range-modern"].textContent = `${bounds.modernStart} a ${bounds.maxSeason}`;
  }
  if (dom["footer-games-modern"]) {
    dom["footer-games-modern"].textContent = fmtInt.format(bounds.detailedGamesCount);
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

// =========================================================================
// Orquestração Central e Vínculo de Eventos
// =========================================================================

function getCurrentFilteredMatches() {
  return filterMatches(allMatches, state);
}

function handleSeasonDrillDown(year) {
  state.seasonStart = year;
  state.seasonEnd = year;
  state.tablePage = 1;
  updateDashboard();
}

function handleOpponentToggle(opponent) {
  state.opponent = state.opponent === opponent ? "ALL" : opponent;
  state.tablePage = 1;
  updateDashboard();
}

function updateDashboard() {
  const filtered = getCurrentFilteredMatches();
  syncFilterControlsUI(dom, state, bounds, filtered.length, allMatches.length);
  syncUrlWithState(state, bounds);
  renderKPIs(filtered);
  renderRecordsAndStreaks(filtered);
  renderEvolutionChart({
    dom,
    matches: filtered,
    state,
    onSelectSeason: handleSeasonDrillDown,
  });
  renderVenueChart({ dom, matches: filtered, state });
  renderScorersChart({ dom, matches: filtered, state, bounds });
  renderSecondaryChart({
    dom,
    matches: filtered,
    state,
    bounds,
    onToggleOpponent: handleOpponentToggle,
  });
  renderTable({ dom, filteredMatches: filtered, state, modernStart: bounds.modernStart });
}

function resetAllFilters() {
  resetFilterState(state, bounds);
  if (dom["table-search"]) {
    dom["table-search"].value = "";
  }
  updateDashboard();
}

function jumpToModernPeriod() {
  state.seasonStart = bounds.modernStart;
  state.seasonEnd = bounds.maxSeason;
  state.tablePage = 1;
  updateDashboard();
}

function bindEvents() {
  const handleShareLinkClick = createShareLinkHandler({
    dom,
    onBeforeCopy: () => syncUrlWithState(state, bounds),
  });

  bindFilterEvents({
    dom,
    state,
    bounds,
    onFilterChange: updateDashboard,
    onReset: resetAllFilters,
    onShare: handleShareLinkClick,
  });

  dom["btn-back-all-seasons"].addEventListener("click", () => {
    state.seasonStart = bounds.minSeason;
    state.seasonEnd = bounds.maxSeason;
    state.tablePage = 1;
    updateDashboard();
  });

  dom["btn-jump-modern-scorers"].addEventListener("click", jumpToModernPeriod);
  dom["btn-jump-modern-cards"].addEventListener("click", jumpToModernPeriod);

  document.querySelectorAll("[data-evolution-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextMode = btn.dataset.evolutionMode;
      if (!VALID_EVOLUTION_MODES.has(nextMode)) return;
      state.evolutionMode = nextMode;
      document.querySelectorAll("[data-evolution-mode]").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
      renderEvolutionChart({
        dom,
        matches: getCurrentFilteredMatches(),
        state,
        onSelectSeason: handleSeasonDrillDown,
      });
    });
  });

  document.querySelectorAll("[data-secondary-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextTab = btn.dataset.secondaryTab;
      if (!VALID_SECONDARY_TABS.has(nextTab)) return;
      state.secondaryTab = nextTab;
      document.querySelectorAll("[data-secondary-tab]").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
      renderSecondaryChart({
        dom,
        matches: getCurrentFilteredMatches(),
        state,
        bounds,
        onToggleOpponent: handleOpponentToggle,
      });
    });
  });

  bindTableEvents({
    dom,
    state,
    onTableFilterChange({ skipInputSync }) {
      if (skipInputSync) {
        dom["btn-reset-filters"].disabled = isDefaultFilterState(state, bounds);
      } else {
        syncTableFilterControlsUI(dom, state, bounds);
      }
      syncUrlWithState(state, bounds);
      renderTable({
        dom,
        filteredMatches: getCurrentFilteredMatches(),
        state,
        modernStart: bounds.modernStart,
      });
    },
    onTableViewChange() {
      renderTable({
        dom,
        filteredMatches: getCurrentFilteredMatches(),
        state,
        modernStart: bounds.modernStart,
      });
    },
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

// =========================================================================
// Bootstrap da Aplicação
// =========================================================================

async function bootstrapNextMatch() {
  const result = await loadNextMatch();
  nextMatchPayload = result.ok ? result.data : null;
  renderNextMatchCard();
}

export async function init() {
  cacheDom();
  configureChartDefaults();

  // Carregamento independente e não bloqueante do card de Próximo Jogo
  bootstrapNextMatch();

  try {
    const [dataset, syncMeta] = await Promise.all([loadMatchesDataset(), loadSyncMeta()]);

    allMatches = dataset.matches;
    datasetMeta = dataset.meta;
    bounds = dataset.bounds;
    state = createFilterState(bounds);

    applyDynamicSeasonLabels();
    applyAutoUpdateBadge(syncMeta);

    populateFilterSelects(dom, bounds);
    populateComparatorSelects();
    applyFiltersFromUrl(state, bounds);
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
      typeof window !== "undefined" && window.location.protocol === "file:"
        ? " Abra via servidor HTTP local (ex.: python -m http.server -d docs 8000) ou pelo GitHub Pages."
        : "";
    const errorMessage =
      error && typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : "Erro inesperado ao carregar a base de partidas";
    dom["state-error-message"].textContent = `${errorMessage}.${extraHint}`;
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

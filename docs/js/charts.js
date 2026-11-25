/**
 * Dados Tricolor — Módulo de Gráficos (`charts.js`)
 * Responsável pela paleta visual, configuração global, ciclo de vida e
 * atualização das instâncias do Chart.js 4.
 */

import {
  TITULOS_SPFC,
  fmtDec1,
  fmtDec2,
  fmtInt,
  formatAvg,
  formatDateBR,
  formatPct,
  formatSigned,
  pluralizar,
} from "./data.js";
import {
  aggregateByOpponent,
  aggregateBySeason,
  aggregateDisciplineBySeason,
  aggregateScorers,
  computeSummary,
} from "./filters.js";

export const COLORS = {
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

// Registro isolado no escopo do módulo (zero globais soltas em window)
const charts = {
  evolution: null,
  venue: null,
  scorers: null,
  secondary: null,
  comparator: null,
};

function getChartConstructor() {
  return typeof globalThis !== "undefined" && typeof globalThis.Chart === "function"
    ? globalThis.Chart
    : null;
}

export function configureChartDefaults(chartLib = getChartConstructor()) {
  if (!chartLib || !chartLib.defaults) return;
  chartLib.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  chartLib.defaults.font.size = 12;
  chartLib.defaults.color = COLORS.tick;
  chartLib.defaults.plugins.tooltip.backgroundColor = "rgba(17, 19, 21, 0.94)";
  chartLib.defaults.plugins.tooltip.padding = 10;
  chartLib.defaults.plugins.tooltip.cornerRadius = 8;
  chartLib.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12 };
}

export function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

export function destroyAllCharts() {
  for (const key of Object.keys(charts)) {
    destroyChart(key);
  }
}

export function getChartInstance(key) {
  return charts[key] || null;
}

export function setChartEmptyState(canvasEl, emptyEl, isEmpty) {
  canvasEl.classList.toggle("is-hidden", isEmpty);
  emptyEl.classList.toggle("is-hidden", !isEmpty);
}

// =========================================================================
// Gráfico 1: Evolução por Temporada / Rodada a Rodada
// =========================================================================

export function renderEvolutionChart({ dom, matches, state, onSelectSeason }) {
  const ChartLib = getChartConstructor();
  const canvas = dom["chart-evolution"];
  const emptyEl = dom["empty-evolution"];

  const isSingleSeasonFilter = state.seasonStart === state.seasonEnd;
  dom["btn-back-all-seasons"].classList.toggle("is-hidden", !isSingleSeasonFilter);

  if (matches.length === 0 || !ChartLib) {
    destroyChart("evolution");
    setChartEmptyState(canvas, emptyEl, true);
    dom["evolution-title"].textContent = isSingleSeasonFilter
      ? `Campanha na Temporada ${state.seasonStart}`
      : "Evolução por Temporada";
    dom["evolution-subtitle"].textContent = "Sem partidas para o recorte atual";
    return;
  }

  setChartEmptyState(canvas, emptyEl, false);

  const { bySeason, seasons, statsBySeason } = aggregateBySeason(matches);

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
      charts.evolution = new ChartLib(canvas, {
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
      charts.evolution = new ChartLib(canvas, {
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

  const labels = statsBySeason.map((s) => (TITULOS_SPFC.has(s.year) ? `${s.year} ★` : String(s.year)));

  destroyChart("evolution");

  const onSeasonClick = (_event, elements) => {
    if (!elements || elements.length === 0) return;
    const clickedYear = statsBySeason[elements[0].index].year;
    if (typeof onSelectSeason === "function") {
      onSelectSeason(clickedYear);
    }
  };

  if (state.evolutionMode === "performance") {
    charts.evolution = new ChartLib(canvas, {
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
    charts.evolution = new ChartLib(canvas, {
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

export function renderVenueChart({ dom, matches, state }) {
  const ChartLib = getChartConstructor();
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

  if (matches.length === 0 || !ChartLib) {
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
  charts.venue = new ChartLib(canvas, {
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
        x: { grid: { display: false }, ticks: { color: COLORS.tick, font: { weight: 600 } } },
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

export function renderScorersChart({ dom, matches, state, bounds }) {
  const ChartLib = getChartConstructor();
  const canvas = dom["chart-scorers"];
  const emptyEl = dom["empty-scorers"];
  const emptyText = dom["empty-scorers-text"];
  const jumpBtn = dom["btn-jump-modern-scorers"];

  if (matches.length === 0 || !ChartLib) {
    destroyChart("scorers");
    setChartEmptyState(canvas, emptyEl, true);
    emptyText.textContent = "Nenhuma partida no recorte atual para calcular artilheiros.";
    jumpBtn.classList.add("is-hidden");
    dom["scorers-subtitle"].textContent = "Ranking dinâmico conforme os filtros · exclui gols contra";
    return;
  }

  const {
    withGoalDataCount,
    totalPlayerGoals,
    totalOwnGoals,
    uniqueScorersCount,
    topScorers,
  } = aggregateScorers(matches, 10);

  if (withGoalDataCount === 0) {
    destroyChart("scorers");
    setChartEmptyState(canvas, emptyEl, true);
    emptyText.textContent = `Os registros individuais de gols estão disponíveis de ${bounds.modernStart} a ${bounds.maxSeason}.`;
    jumpBtn.classList.remove("is-hidden");
    dom["scorers-subtitle"].textContent = `Sem registros de artilharia para ${state.seasonStart}–${state.seasonEnd}`;
    return;
  }

  if (topScorers.length === 0) {
    destroyChart("scorers");
    setChartEmptyState(canvas, emptyEl, true);
    emptyText.textContent =
      totalOwnGoals > 0
        ? "Neste recorte houve apenas gol contra a favor do SPFC (excluído da artilharia individual)."
        : "Nenhum gol marcado por atletas do SPFC neste recorte.";
    jumpBtn.classList.add("is-hidden");
    dom["scorers-subtitle"].textContent = `${fmtInt.format(withGoalDataCount)} jogos analisados (${bounds.modernStart}–${bounds.maxSeason})`;
    return;
  }

  setChartEmptyState(canvas, emptyEl, false);
  jumpBtn.classList.add("is-hidden");
  dom["scorers-subtitle"].textContent =
    `${fmtInt.format(totalPlayerGoals)} gols de ${fmtInt.format(uniqueScorersCount)} atletas` +
    (totalOwnGoals > 0 ? ` · ${totalOwnGoals} gol(s) contra ignorado(s)` : "");

  destroyChart("scorers");
  charts.scorers = new ChartLib(canvas, {
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
          ticks: { color: COLORS.tick, font: { size: 12, weight: 600 } },
        },
      },
    },
  });
}

// =========================================================================
// Gráfico 4: Disciplina por Temporada & Retrospecto por Adversário
// =========================================================================

export function renderSecondaryChart({ dom, matches, state, bounds, onToggleOpponent }) {
  const ChartLib = getChartConstructor();
  const canvas = dom["chart-secondary"];
  const emptyEl = dom["empty-secondary"];
  const emptyText = dom["empty-secondary-text"];
  const jumpBtn = dom["btn-jump-modern-cards"];

  if (state.secondaryTab === "discipline") {
    dom["secondary-title"].textContent = "Disciplina por Temporada";
    dom["secondary-subtitle"].textContent =
      `Média de cartões amarelos por jogo e total de vermelhos do SPFC (base ${bounds.modernStart}–${bounds.maxSeason})`;

    if (matches.length === 0 || !ChartLib) {
      destroyChart("secondary");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent = "Nenhuma partida no recorte atual para análise disciplinar.";
      jumpBtn.classList.add("is-hidden");
      return;
    }

    const { withCardsCount, rows } = aggregateDisciplineBySeason(matches);
    if (withCardsCount === 0) {
      destroyChart("secondary");
      setChartEmptyState(canvas, emptyEl, true);
      emptyText.textContent = `Os dados de cartões estão disponíveis de ${bounds.modernStart} a ${bounds.maxSeason}.`;
      jumpBtn.classList.remove("is-hidden");
      return;
    }

    setChartEmptyState(canvas, emptyEl, false);
    jumpBtn.classList.add("is-hidden");

    destroyChart("secondary");
    charts.secondary = new ChartLib(canvas, {
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

  if (matches.length === 0 || !ChartLib) {
    destroyChart("secondary");
    setChartEmptyState(canvas, emptyEl, true);
    emptyText.textContent = "Nenhuma partida no recorte atual para comparar adversários.";
    dom["secondary-subtitle"].textContent = "Aproveitamento contra os adversários do recorte";
    return;
  }

  setChartEmptyState(canvas, emptyEl, false);

  const oppList = aggregateByOpponent(matches, 15);

  dom["secondary-subtitle"].textContent =
    oppList.length > 1
      ? `Aproveitamento (%) nos ${oppList.length} confrontos mais frequentes do recorte · clique na barra para filtrar`
      : `Aproveitamento detalhado contra ${oppList[0].name}`;

  destroyChart("secondary");
  charts.secondary = new ChartLib(canvas, {
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
        if (typeof onToggleOpponent === "function") {
          onToggleOpponent(opp);
        }
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
        x: { grid: { display: false }, ticks: { color: COLORS.tick, font: { size: 11 } } },
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
// Gráfico 5: Comparador de Temporadas (Pontos Acumulados Jogo a Jogo)
// =========================================================================

export function renderComparatorChart({ dom, comparison }) {
  const ChartLib = getChartConstructor();
  const canvas = dom["chart-comparator"];
  const emptyEl = dom["empty-comparator"];
  const emptyTextEl = dom["empty-comparator-text"];
  if (!canvas || !emptyEl) return;

  const { temporadaA, temporadaB, mando, mesmaTemporada, resumoA, resumoB, evolucao } = comparison;
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

  if (evolucao.maxJogos === 0 || !ChartLib) {
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

  charts.comparator = new ChartLib(canvas, {
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

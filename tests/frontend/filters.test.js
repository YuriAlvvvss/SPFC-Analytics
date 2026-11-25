import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractDatasetBounds, normalizeMatch } from "../../docs/js/data.js";
import {
  MAX_SEARCH_URL_LENGTH,
  aggregateByOpponent,
  aggregateBySeason,
  aggregateDisciplineBySeason,
  aggregateScorers,
  applyFiltersFromUrl,
  buildSearchParamsFromState,
  buildUrlFromState,
  calcularEstadoTemporalJogo,
  calcularRecordesESequencias,
  compararTemporadas,
  computeSummary,
  createFilterState,
  describeActiveFilters,
  filterMatches,
  isDefaultFilterState,
  isPeriodPresetActive,
  montarModeloProximoJogo,
  parseFiltersFromSearch,
  parseValidSeasonParam,
  resetFilterState,
  resolvePeriodPreset,
  syncUrlWithState,
} from "../../docs/js/filters.js";

function createFixtureMatches() {
  const rawMatches = [
    // Início dos pontos corridos (2003) — sem gols/cartões
    {
      id: 0,
      temporada: 2003,
      rodada: 1,
      data: "2003-03-30",
      mando: "Fora",
      adversario: "Juventude",
      gols_pro: 1,
      gols_contra: 1,
      cartoes_amarelos: null,
      cartoes_vermelhos: null,
      gols: null,
    },
    // Era histórica sem gols/cartões (2006–2008: Tricampeonato)
    {
      id: 1,
      temporada: 2006,
      rodada: 1,
      data: "2006-04-16",
      mando: "Casa",
      adversario: "Flamengo",
      gols_pro: 1,
      gols_contra: 0,
      cartoes_amarelos: null,
      cartoes_vermelhos: null,
      gols: null,
    },
    {
      id: 2,
      temporada: 2007,
      rodada: 10,
      data: "2007-07-14",
      mando: "Fora",
      adversario: "Corinthians",
      gols_pro: 1,
      gols_contra: 1,
      cartoes_amarelos: null,
      cartoes_vermelhos: null,
      gols: null,
    },
    {
      id: 3,
      temporada: 2008,
      rodada: 20,
      data: "2008-08-17",
      mando: "Casa",
      adversario: "Palmeiras",
      gols_pro: 2,
      gols_contra: 1,
      cartoes_amarelos: null,
      cartoes_vermelhos: null,
      gols: null,
    },
    // Era moderna com gols e cartões (2014 e 2024–2026)
    {
      id: 4,
      temporada: 2014,
      rodada: 5,
      data: "2014-05-18",
      mando: "Casa",
      adversario: "Atlético-MG",
      gols_pro: 3,
      gols_contra: 0,
      cartoes_amarelos: 2,
      cartoes_vermelhos: 0,
      cartoes_amarelos_adversario: 3,
      cartoes_vermelhos_adversario: 1,
      gols: [
        { jogador: "Luís Fabiano", minuto: "15", tipo: "Normal", gol_contra: false },
        { jogador: "Rogério Ceni", minuto: "52", tipo: "Pênalti", gol_contra: false },
        { jogador: "Zagueiro Adv", minuto: "88", tipo: "Gol contra", gol_contra: true },
      ],
    },
    {
      id: 5,
      temporada: 2024,
      rodada: 12,
      data: "2024-06-27",
      mando: "Fora",
      adversario: "Santos",
      gols_pro: 1,
      gols_contra: 2,
      cartoes_amarelos: 4,
      cartoes_vermelhos: 1,
      cartoes_amarelos_adversario: 2,
      cartoes_vermelhos_adversario: 0,
      gols: [
        { jogador: "Luciano", minuto: "61", tipo: "Normal", gol_contra: false },
      ],
    },
    {
      id: 6,
      temporada: 2026,
      rodada: 1,
      data: "2026-01-28",
      mando: "Casa",
      adversario: "Corinthians",
      gols_pro: 2,
      gols_contra: 0,
      cartoes_amarelos: 3,
      cartoes_vermelhos: 0,
      cartoes_amarelos_adversario: 4,
      cartoes_vermelhos_adversario: 0,
      gols: [
        { jogador: "Luciano", minuto: "19", tipo: "Normal", gol_contra: false },
        { jogador: "Jonathan Calleri", minuto: "74", tipo: "Pênalti", gol_contra: false },
      ],
    },
    // Partida 2026 ainda não enriquecida pela ESPN (gols/cartões nulos)
    {
      id: 7,
      temporada: 2026,
      rodada: 2,
      data: "2026-02-04",
      mando: "Fora",
      adversario: "Atlético-MG",
      gols_pro: 0,
      gols_contra: 0,
      cartoes_amarelos: null,
      cartoes_vermelhos: null,
      gols: null,
    },
  ];

  return rawMatches.map((m, idx) => normalizeMatch(m, idx));
}

describe("filters.js — recorte por ano/período, pílulas e filtros combinados", () => {
  const matches = createFixtureMatches();
  const bounds = extractDatasetBounds(matches);

  it("resolve corretamente todas as pílulas de período (ALL, TRI, MODERN, LAST5, CURRENT)", () => {
    assert.deepEqual(resolvePeriodPreset("ALL", bounds), { seasonStart: 2003, seasonEnd: 2026 });
    assert.deepEqual(resolvePeriodPreset("TRI", bounds), { seasonStart: 2006, seasonEnd: 2008 });
    assert.deepEqual(resolvePeriodPreset("MODERN", bounds), { seasonStart: 2014, seasonEnd: 2026 });
    assert.deepEqual(resolvePeriodPreset("LAST5", bounds), { seasonStart: 2022, seasonEnd: 2026 });
    assert.deepEqual(resolvePeriodPreset("CURRENT", bounds), { seasonStart: 2026, seasonEnd: 2026 });
    assert.equal(resolvePeriodPreset("UNKNOWN", bounds), null);

    const state = createFilterState(bounds);
    assert.equal(isPeriodPresetActive("ALL", state, bounds), true);
    assert.equal(isPeriodPresetActive("TRI", state, bounds), false);
    state.seasonStart = 2006;
    state.seasonEnd = 2008;
    assert.equal(isPeriodPresetActive("TRI", state, bounds), true);
  });

  it("filtra por intervalo de temporadas, clássico, adversário específico e mando", () => {
    // Recorte Tri (2006–2008)
    const tri = filterMatches(matches, { seasonStart: 2006, seasonEnd: 2008, opponent: "ALL", venue: "ALL" });
    assert.deepEqual(tri.map((m) => m.id), [1, 2, 3]);

    // Apenas clássicos em todo o período
    const classicos = filterMatches(matches, { seasonStart: 2003, seasonEnd: 2026, opponent: "CLASSICOS", venue: "ALL" });
    assert.deepEqual(classicos.map((m) => m.id), [2, 3, 5, 6]);

    // Clássicos em Casa no Tricampeonato
    const triClassicosCasa = filterMatches(matches, {
      seasonStart: 2006,
      seasonEnd: 2008,
      opponent: "CLASSICOS",
      venue: "Casa",
    });
    assert.deepEqual(triClassicosCasa.map((m) => m.id), [3]);

    // Adversário específico Fora de Casa
    const galoFora = filterMatches(matches, {
      seasonStart: 2003,
      seasonEnd: 2026,
      opponent: "Atlético-MG",
      venue: "Fora",
    });
    assert.deepEqual(galoFora.map((m) => m.id), [7]);

    // Combinação vazia
    const empty = filterMatches(matches, {
      seasonStart: 2006,
      seasonEnd: 2008,
      opponent: "Atlético-MG",
      venue: "ALL",
    });
    assert.deepEqual(empty, []);
  });

  it("controla estado padrão, reset e descrição textual dos filtros ativos", () => {
    const state = createFilterState(bounds);
    assert.equal(isDefaultFilterState(state, bounds), true);
    assert.equal(describeActiveFilters(state), "período 2003–2026");

    state.seasonStart = 2026;
    state.seasonEnd = 2026;
    state.opponent = "CLASSICOS";
    state.venue = "Casa";
    assert.equal(isDefaultFilterState(state, bounds), false);
    assert.equal(describeActiveFilters(state), "temporada 2026 · Clássicos (COR · PAL · SAN) · mando Casa");

    resetFilterState(state, bounds);
    assert.equal(isDefaultFilterState(state, bounds), true);
  });
});

describe("filters.js — agregação de KPIs e tratamento de períodos sem gols/cartões", () => {
  const matches = createFixtureMatches();

  it("calcula KPIs completos sem distorcer médias disciplinares em recortes mistos", () => {
    // 8 jogos no total, porém apenas 3 (ids 4, 5, 6) possuem cartões registrados
    const summary = computeSummary(matches);

    assert.equal(summary.games, 8);
    assert.equal(summary.seasonsCount, 7);
    assert.equal(summary.homeGames, 4);
    assert.equal(summary.awayGames, 4);
    assert.equal(summary.wins, 4);
    assert.equal(summary.draws, 3);
    assert.equal(summary.losses, 1);
    assert.equal(summary.points, 15);
    assert.equal(summary.maxPoints, 24);
    assert.ok(Math.abs(summary.winrate - (15 / 24) * 100) < 1e-9);
    assert.equal(summary.gf, 11);
    assert.equal(summary.ga, 5);
    assert.equal(summary.gd, 6);
    assert.ok(Math.abs(summary.cleanSheetPct - (4 / 8) * 100) < 1e-9);

    // Disciplina: amarelos = 2 + 4 + 3 = 9 em 3 jogos (média 3.00, NUNCA 9/8!)
    assert.equal(summary.cardGames, 3);
    assert.equal(summary.yellowTotal, 9);
    assert.equal(summary.redTotal, 1);
    assert.equal(summary.yellowAvg, 3);
    assert.ok(Math.abs(summary.redAvg - 1 / 3) < 1e-9);
  });

  it("trata períodos sem registros de cartões (2006–2008) retornando médias nulas sem NaN", () => {
    const triMatches = filterMatches(matches, { seasonStart: 2006, seasonEnd: 2008, opponent: "ALL", venue: "ALL" });
    const summary = computeSummary(triMatches);

    assert.equal(summary.games, 3);
    assert.equal(summary.wins, 2);
    assert.equal(summary.draws, 1);
    assert.equal(summary.losses, 0);
    assert.equal(summary.points, 7);
    assert.equal(summary.cardGames, 0);
    assert.equal(summary.yellowTotal, 0);
    assert.equal(summary.redTotal, 0);
    assert.equal(summary.yellowAvg, null);
    assert.equal(summary.redAvg, null);
  });

  it("trata lista vazia de partidas sem gerar NaN ou Infinity", () => {
    const summary = computeSummary([]);
    assert.equal(summary.games, 0);
    assert.equal(summary.winrate, null);
    assert.equal(summary.winPct, null);
    assert.equal(summary.gfAvg, null);
    assert.equal(summary.gaAvg, null);
    assert.equal(summary.cleanSheetPct, null);
    assert.equal(summary.yellowAvg, null);
    assert.equal(summary.redAvg, null);
  });

  it("trata corretamente períodos sem registros de artilharia e exclui gols contra do ranking", () => {
    // 2006–2008: sem cobertura de gols individuais
    const triMatches = filterMatches(matches, { seasonStart: 2006, seasonEnd: 2008, opponent: "ALL", venue: "ALL" });
    const triScorers = aggregateScorers(triMatches);
    assert.equal(triScorers.withGoalDataCount, 0);
    assert.deepEqual(triScorers.topScorers, []);

    // Base completa: Luciano (2), Jonathan Calleri (1 P), Luís Fabiano (1), Rogério Ceni (1 P) + 1 gol contra excluído
    const allScorers = aggregateScorers(matches);
    assert.equal(allScorers.withGoalDataCount, 3);
    assert.equal(allScorers.totalPlayerGoals, 5);
    assert.equal(allScorers.totalOwnGoals, 1);
    assert.equal(allScorers.uniqueScorersCount, 4);
    assert.equal(allScorers.topScorers[0].name, "Luciano");
    assert.equal(allScorers.topScorers[0].total, 2);
    assert.equal(allScorers.topScorers[0].normal, 2);
    assert.equal(allScorers.topScorers[0].penalty, 0);
    assert.equal(allScorers.topScorers[0].matchIds.size, 2);

    // Recorte apenas com gol contra a favor
    const onlyOwnGoalMatch = normalizeMatch({
      id: 99,
      temporada: 2022,
      rodada: 1,
      data: "2022-04-10",
      mando: "Casa",
      adversario: "Palmeiras",
      gols_pro: 1,
      gols_contra: 0,
      cartoes_amarelos: 1,
      cartoes_vermelhos: 0,
      gols: [{ jogador: "Defensor", minuto: "33", tipo: "Gol contra", gol_contra: true }],
    });
    const ownOnly = aggregateScorers([onlyOwnGoalMatch]);
    assert.equal(ownOnly.withGoalDataCount, 1);
    assert.equal(ownOnly.totalPlayerGoals, 0);
    assert.equal(ownOnly.totalOwnGoals, 1);
    assert.deepEqual(ownOnly.topScorers, []);
  });

  it("agrega disciplina por temporada ignorando jogos sem cartões e agrega por temporada/adversário", () => {
    const triMatches = filterMatches(matches, { seasonStart: 2006, seasonEnd: 2008, opponent: "ALL", venue: "ALL" });
    assert.deepEqual(aggregateDisciplineBySeason(triMatches), { withCardsCount: 0, rows: [] });

    const disc = aggregateDisciplineBySeason(matches);
    assert.equal(disc.withCardsCount, 3);
    assert.deepEqual(
      disc.rows.map((r) => r.year),
      [2014, 2024, 2026]
    );
    assert.equal(disc.rows[2].games, 1); // Jogo 7 de 2026 (null) não entra na média!
    assert.equal(disc.rows[2].yellowAvg, 3);

    const bySeason = aggregateBySeason(matches);
    assert.deepEqual(bySeason.seasons, [2003, 2006, 2007, 2008, 2014, 2024, 2026]);

    const byOpp = aggregateByOpponent(matches);
    assert.equal(byOpp.length, 6);
    assert.equal(byOpp[0].winrate, 100);
  });
});

describe("filters.js — deep-linking bidirecional e parsing de query string", () => {
  const matches = createFixtureMatches();
  const bounds = extractDatasetBounds(matches);

  it("valida anos de temporada com rigor contra bounds.validSeasons", () => {
    assert.equal(parseValidSeasonParam("2006", bounds.validSeasons), 2006);
    assert.equal(parseValidSeasonParam(" 2026 ", bounds.validSeasons), 2026);
    assert.equal(parseValidSeasonParam("1999", bounds.validSeasons), null);
    assert.equal(parseValidSeasonParam("2026abc", bounds.validSeasons), null);
    assert.equal(parseValidSeasonParam(null, bounds.validSeasons), null);
  });

  it("faz parsing completo de query string (período, inversão de>ate, adversário sem acento, mando, resultado e busca)", () => {
    // Caso padrão de deep-linking
    const parsed = parseFiltersFromSearch(
      "?de=2006&ate=2008&adversario=atletico-mg&mando=casa&resultado=v&busca=%20Luciano%20",
      bounds
    );
    assert.deepEqual(parsed, {
      seasonStart: 2006,
      seasonEnd: 2008,
      opponent: "Atlético-MG",
      venue: "Casa",
      tableResult: "V",
      tableSearch: "Luciano",
    });

    // Inversão automática quando de > ate + adversário "clássicos"
    const swapped = parseFiltersFromSearch("?de=2024&ate=2007&adversario=cl%C3%A1ssicos&mando=FORA", bounds);
    assert.equal(swapped.seasonStart, 2007);
    assert.equal(swapped.seasonEnd, 2024);
    assert.equal(swapped.opponent, "CLASSICOS");
    assert.equal(swapped.venue, "Fora");

    // Parâmetro único (`de` apenas) preserva `ate` no maxSeason
    const onlyStart = parseFiltersFromSearch("?de=2014", bounds);
    assert.equal(onlyStart.seasonStart, 2014);
    assert.equal(onlyStart.seasonEnd, 2026);

    // Parâmetro único (`ate` apenas) preserva `de` no minSeason
    const onlyEnd = parseFiltersFromSearch("?ate=2008", bounds);
    assert.equal(onlyEnd.seasonStart, 2003);
    assert.equal(onlyEnd.seasonEnd, 2008);
  });

  it("ignora parâmetros inválidos/inexistentes e limita tamanho do campo busca", () => {
    const longSearch = "a".repeat(200);
    const parsed = parseFiltersFromSearch(
      `?de=1990&ate=invalido&adversario=TimeInexistente&mando=Neutro&resultado=X&busca=${longSearch}`,
      bounds
    );
    assert.equal(parsed.seasonStart, bounds.minSeason);
    assert.equal(parsed.seasonEnd, bounds.maxSeason);
    assert.equal(parsed.opponent, "ALL");
    assert.equal(parsed.venue, "ALL");
    assert.equal(parsed.tableResult, "ALL");
    assert.equal(parsed.tableSearch.length, MAX_SEARCH_URL_LENGTH);
  });

  it("serializa apenas filtros não-padrão e mantém ida-e-volta consistente (round-trip)", () => {
    const state = createFilterState(bounds);

    // Estado padrão gera URL limpa sem "?"
    assert.equal(buildSearchParamsFromState(state, bounds).toString(), "");
    assert.equal(buildUrlFromState(state, bounds, { pathname: "/index.html", hash: "#top" }), "/index.html#top");

    // Aplica filtros específicos e verifica serialização e round-trip
    state.seasonStart = 2006;
    state.seasonEnd = 2008;
    state.opponent = "CLASSICOS";
    state.venue = "Casa";
    state.tableResult = "V";
    state.tableSearch = "  Morumbi  ";

    const url = buildUrlFromState(state, bounds, { pathname: "/", hash: "" });
    assert.equal(url, "/?de=2006&ate=2008&adversario=CLASSICOS&mando=Casa&resultado=V&busca=Morumbi");

    const restored = createFilterState(bounds);
    applyFiltersFromUrl(restored, bounds, url.slice(1));
    assert.equal(restored.seasonStart, 2006);
    assert.equal(restored.seasonEnd, 2008);
    assert.equal(restored.opponent, "CLASSICOS");
    assert.equal(restored.venue, "Casa");
    assert.equal(restored.tableResult, "V");
    assert.equal(restored.tableSearch, "Morumbi");
  });

  it("syncUrlWithState chama history.replaceState apenas quando a URL muda", () => {
    const state = createFilterState(bounds);
    state.seasonStart = 2006;
    state.seasonEnd = 2008;

    const calls = [];
    const mockHistory = {
      replaceState: (...args) => calls.push(args),
    };

    syncUrlWithState(state, bounds, { pathname: "/", search: "", hash: "" }, mockHistory);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2], "/?de=2006&ate=2008");

    // Mesma URL: não deve disparar nova chamada
    syncUrlWithState(state, bounds, { pathname: "/", search: "?de=2006&ate=2008", hash: "" }, mockHistory);
    assert.equal(calls.length, 1);
  });
});

describe("filters.js — recordes, comparador de temporadas e próximo jogo", () => {
  const matches = createFixtureMatches();
  const bounds = extractDatasetBounds(matches);

  it("calcula sequências, maior goleada e pior derrota sem mutar a entrada", () => {
    const copy = [...matches].reverse();
    const rec = calcularRecordesESequencias(copy);

    assert.equal(rec.vazio, false);
    assert.equal(rec.totalJogosValidos, 8);
    assert.equal(rec.maiorInvencibilidade.quantidade, 5); // ids 0, 1, 2, 3, 4
    assert.equal(rec.maiorSequenciaVitorias.quantidade, 2); // ids 3, 4
    assert.equal(rec.maiorGoleadaAFavor.placarSpfc, "SPFC 3 × 0");
    assert.equal(rec.piorDerrota.placarSpfc, "SPFC 1 × 2");
    assert.equal(calcularRecordesESequencias([]).vazio, true);
  });

  it("compara duas temporadas alinhando séries acumuladas com null e avaliando polaridades", () => {
    const comp = compararTemporadas(matches, 2026, 2014, "ALL");
    assert.equal(comp.resumoA.jogos, 2);
    assert.equal(comp.resumoB.jogos, 1);
    assert.deepEqual(comp.evolucao.serieA, [3, 4]);
    assert.deepEqual(comp.evolucao.serieB, [3, null]);

    // Mesma temporada gera estado neutro em todas as métricas
    const same = compararTemporadas(matches, 2026, 2026, "ALL");
    assert.equal(same.mesmaTemporada, true);
    assert.equal(same.placarMetricas.vitoriasA, 0);
    assert.equal(same.placarMetricas.vitoriasB, 0);
  });

  it("calcula estado temporal e modelo do próximo jogo (antes, bola rolando, encerrado e sem jogo)", () => {
    const jogo = { data: "2026-11-26", hora: "20:00", horario_definido: true };
    const beforeMs = new Date("2026-11-26T18:00:00-03:00").getTime();
    const liveMs = new Date("2026-11-26T20:45:00-03:00").getTime();
    const afterMs = new Date("2026-11-26T22:30:00-03:00").getTime();

    assert.equal(calcularEstadoTemporalJogo(jogo, beforeMs).estado, "hoje");
    assert.equal(calcularEstadoTemporalJogo(jogo, liveMs).estado, "em_andamento");
    assert.equal(calcularEstadoTemporalJogo(jogo, afterMs).estado, "aguardando");

    const model = montarModeloProximoJogo(
      {
        atualizado_em: "2026-11-24T14:00:00-03:00",
        tem_proximo_jogo: true,
        proximo_jogo: {
          ...jogo,
          adversario: "Corinthians",
          mando: "Casa",
          rodada: 37,
          competicao: "Brasileirão Série A",
        },
      },
      {
        agoraMs: beforeMs,
        baseCarregada: true,
        clubsLookup: bounds.validOpponentClubs,
        matches,
      }
    );

    assert.equal(model.estado, "disponivel");
    assert.equal(model.adversarioCanonico, "Corinthians");
    assert.equal(model.resumoHistorico.games, 2);
    assert.equal(
      montarModeloProximoJogo({ tem_proximo_jogo: false, proximo_jogo: null }).estado,
      "sem_jogo"
    );
  });
});

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  clearDataCache,
  escapeHtml,
  extractDatasetBounds,
  formatAvg,
  formatDateBR,
  formatPct,
  formatSigned,
  formatStreakPeriodBR,
  getCachedData,
  loadMatchesDataset,
  loadNextMatch,
  loadSyncMeta,
  normalizeGoal,
  normalizeMatch,
  normalizeMatchesDataset,
  normalizeText,
  parseIsoCalendarDate,
  safeAvg,
  safePct,
} from "../../docs/js/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_JSON_PATH = path.resolve(__dirname, "../../docs/data/spfc_pontos_corridos.json");

function makeSamplePayload() {
  return {
    metadata: {
      clube: "São Paulo FC",
      temporada_inicio: 2006,
      temporada_fim: 2024,
      temporadas_com_cartoes: [2014, 2024],
    },
    partidas: [
      {
        id: 101,
        temporada: 2006,
        rodada: 1,
        data: "2006-04-16",
        hora: "16:00",
        mando: "casa",
        adversario: "  Flamengo ",
        adversario_estado: "RJ",
        arena: "Morumbi",
        gols_pro: 1,
        gols_contra: 0,
        cartoes_amarelos: null,
        cartoes_vermelhos: null,
        gols: null,
      },
      {
        id: 202,
        temporada: 2014,
        rodada: 5,
        data: "2014-05-18",
        hora: "18:30",
        mando: "Fora",
        adversario: "Atlético-MG",
        adversario_estado: "MG",
        arena: "Independência",
        gols_pro: 2,
        gols_contra: 2,
        saldo_gols: 0,
        resultado: "E",
        pontos: 1,
        cartoes_amarelos: 3,
        cartoes_vermelhos: 0,
        cartoes_amarelos_adversario: 2,
        cartoes_vermelhos_adversario: 1,
        gols: [
          { jogador: "Luís Fabiano", minuto: "22", tipo: "Normal", gol_contra: false },
          { jogador: "Rogério Ceni", minuto: "79", tipo: "Pênalti", gol_contra: false },
        ],
      },
      {
        id: 303,
        temporada: 2024,
        rodada: 10,
        data: "2024-06-20",
        hora: "20:00",
        mando: "Casa",
        adversario: "Corinthians",
        adversario_estado: "SP",
        arena: "MorumBIS",
        gols_pro: 0,
        gols_contra: 1,
        cartoes_amarelos: 2,
        cartoes_vermelhos: 1,
        gols: [],
      },
    ],
  };
}

describe("data.js — utilitários de formatação e normalização de texto/datas", () => {
  it("protege divisões contra zero sem produzir NaN ou Infinity", () => {
    assert.equal(safePct(3, 0), null);
    assert.equal(safeAvg(10, 0), null);
    assert.equal(formatPct(null), "—");
    assert.equal(formatPct(Number.NaN), "—");
    assert.equal(formatAvg(null), "—");
    assert.equal(formatSigned(4), "+4");
    assert.equal(formatSigned(0), "0");
    assert.equal(formatSigned(-2), "-2");
  });

  it("normaliza texto removendo acentos/espaços e escapa HTML contra XSS", () => {
    assert.equal(normalizeText("  Atlético-MG  "), "atletico-mg");
    assert.equal(normalizeText("São Paulo"), "sao paulo");
    assert.equal(
      escapeHtml(`<img src=x onerror="alert('xss')">`),
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;"
    );
  });

  it("valida e formata datas ISO sem distorções de fuso horário", () => {
    assert.equal(formatDateBR("2006-04-16"), "16/04/2006");
    assert.equal(formatDateBR(null), "—");
    assert.equal(parseIsoCalendarDate("2024-02-29")?.dayNum, 29);
    assert.equal(parseIsoCalendarDate("2025-02-29"), null);
    assert.equal(
      formatStreakPeriodBR("2008-08-03", "2008-08-31", 4),
      "03/08 – 31/08/2008"
    );
    assert.equal(
      formatStreakPeriodBR("2008-08-03", "2008-11-16", 12),
      "ago/2008 – nov/2008"
    );
  });
});

describe("data.js — normalização de partidas, gols e limites dinâmicos", () => {
  it("deriva saldo, resultado, pontos e preserva null em períodos sem gols/cartões", () => {
    const rawPre2014 = makeSamplePayload().partidas[0];
    const normalized = normalizeMatch(rawPre2014);

    assert.equal(normalized.mando, "Casa");
    assert.equal(normalized.adversario, "Flamengo");
    assert.equal(normalized.saldo_gols, 1);
    assert.equal(normalized.resultado, "V");
    assert.equal(normalized.pontos, 3);
    assert.equal(normalized.cartoes_amarelos, null);
    assert.equal(normalized.cartoes_vermelhos, null);
    assert.equal(normalized.gols, null);
  });

  it("sanitiza cartões parcialmente nulos para null e preserva lista vazia de gols []", () => {
    const partialCards = normalizeMatch({
      id: 1,
      temporada: 2026,
      rodada: 1,
      data: "2026-02-01",
      mando: "Casa",
      adversario: "Remo",
      gols_pro: 0,
      gols_contra: 0,
      cartoes_amarelos: 2,
      cartoes_vermelhos: null,
      gols: [],
    });

    assert.equal(partialCards.cartoes_amarelos, null);
    assert.equal(partialCards.cartoes_vermelhos, null);
    assert.deepEqual(partialCards.gols, []);
  });

  it("normaliza gols individuais e marca gol contra corretamente", () => {
    assert.deepEqual(
      normalizeGoal({ jogador: "  Lucas Moura ", minuto: "45+2", tipo: "Pênalti", gol_contra: false }),
      { jogador: "Lucas Moura", minuto: "45+2", tipo: "Pênalti", gol_contra: false }
    );
    assert.deepEqual(
      normalizeGoal({ jogador: "", minuto: "12", tipo: "Gol contra", gol_contra: true }),
      { jogador: "Gol contra", minuto: "12", tipo: "Gol contra", gol_contra: true }
    );
    assert.equal(normalizeGoal(null), null);
  });

  it("descarta partidas inválidas e extrai limites dinâmicos e lookups de adversários", () => {
    const payload = makeSamplePayload();
    payload.partidas.push({ id: 999, temporada: null, gols_pro: "x", gols_contra: 0 });

    const { matches, bounds } = normalizeMatchesDataset(payload);
    assert.equal(matches.length, 3);
    assert.equal(bounds.minSeason, 2006);
    assert.equal(bounds.maxSeason, 2024);
    assert.equal(bounds.modernStart, 2014);
    assert.equal(bounds.totalSeasons, 3);
    assert.equal(bounds.detailedGamesCount, 2);
    assert.equal(bounds.validSeasons.has(2006), true);
    assert.equal(bounds.validSeasons.has(2024), true);
    assert.equal(bounds.opponentLookup.get("classicos"), "CLASSICOS");
    assert.equal(bounds.opponentLookup.get("atletico-mg"), "Atlético-MG");
    assert.equal(bounds.validOpponentClubs.has("classicos"), false);
    assert.deepEqual(bounds.availableSeasonsDesc, [2024, 2014, 2006]);
  });

  it("usa metadata.temporadas_com_cartoes como fallback de modernStart quando não há registros detalhados", () => {
    const bounds = extractDatasetBounds(
      [
        normalizeMatch({
          id: 1,
          temporada: 2003,
          gols_pro: 1,
          gols_contra: 0,
          adversario: "Santos",
          mando: "Casa",
          cartoes_amarelos: null,
          cartoes_vermelhos: null,
          gols: null,
        }),
      ],
      { temporadas_com_cartoes: [2015, 2016] }
    );
    assert.equal(bounds.modernStart, 2015);
    assert.equal(bounds.detailedGamesCount, 0);
  });

  it("lança erro claro quando o JSON não possui array de partidas válido", () => {
    assert.throws(() => normalizeMatchesDataset({}), /campo 'partidas' ausente ou vazio/);
    assert.throws(() => normalizeMatchesDataset({ partidas: [] }), /campo 'partidas' ausente ou vazio/);
  });

  it("normaliza integralmente o dataset real de produção (docs/data/spfc_pontos_corridos.json)", async () => {
    const raw = JSON.parse(await readFile(PROD_JSON_PATH, "utf-8"));
    const { matches, bounds } = normalizeMatchesDataset(raw);

    assert.equal(matches.length, raw.partidas.length);
    assert.equal(bounds.minSeason, 2003);
    assert.ok(bounds.maxSeason >= 2026);
    assert.equal(bounds.modernStart, 2014);
    assert.equal(bounds.opponentLookup.get("corinthians"), "Corinthians");
    assert.equal(bounds.opponentLookup.get("atletico-mg"), "Atlético-MG");
  });
});

describe("data.js — carregamento assíncrono e cache em memória", () => {
  beforeEach(() => {
    clearDataCache();
  });

  it("armazena dataset normalizado em cache e respeita forceRefresh e clearDataCache", async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => makeSamplePayload(),
      };
    };

    const first = await loadMatchesDataset({ url: "test/data.json", fetchImpl: fakeFetch });
    const second = await loadMatchesDataset({ url: "test/data.json", fetchImpl: fakeFetch });

    assert.equal(calls, 1);
    assert.strictEqual(first, second);
    assert.ok(getCachedData("matches:test/data.json"));

    const refreshed = await loadMatchesDataset({
      url: "test/data.json",
      fetchImpl: fakeFetch,
      forceRefresh: true,
    });
    assert.equal(calls, 2);
    assert.notStrictEqual(first, refreshed);

    clearDataCache("matches:test/data.json");
    assert.equal(getCachedData("matches:test/data.json"), undefined);
  });

  it("não envenena o cache em caso de erro HTTP e retorna fallbacks seguros em meta/próximo jogo", async () => {
    let calls = 0;
    const failingFetch = async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    };

    await assert.rejects(
      () => loadMatchesDataset({ url: "test/fail.json", fetchImpl: failingFetch }),
      /HTTP 503/
    );
    assert.equal(getCachedData("matches:test/fail.json"), undefined);

    const meta = await loadSyncMeta({ url: "test/meta.json", fetchImpl: failingFetch });
    assert.equal(meta, null);

    const next = await loadNextMatch({ url: "test/next.json", fetchImpl: failingFetch });
    assert.deepEqual(next, { ok: false, data: null });
    assert.equal(calls, 3);
  });

  it("faz cache de meta.json e proximo_jogo.json quando válidos", async () => {
    let metaCalls = 0;
    let nextCalls = 0;

    const metaFetch = async () => {
      metaCalls += 1;
      return { ok: true, status: 200, json: async () => ({ atualizado_em_brt: "24/11/2026 às 17:34" }) };
    };
    const nextFetch = async () => {
      nextCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ tem_proximo_jogo: false, proximo_jogo: null, atualizado_em: "2026-11-24T14:00:00-03:00" }),
      };
    };

    const m1 = await loadSyncMeta({ url: "m.json", fetchImpl: metaFetch });
    const m2 = await loadSyncMeta({ url: "m.json", fetchImpl: metaFetch });
    assert.equal(metaCalls, 1);
    assert.strictEqual(m1, m2);

    const n1 = await loadNextMatch({ url: "n.json", fetchImpl: nextFetch });
    const n2 = await loadNextMatch({ url: "n.json", fetchImpl: nextFetch });
    assert.equal(nextCalls, 1);
    assert.equal(n1.ok, true);
    assert.strictEqual(n1, n2);
  });
});

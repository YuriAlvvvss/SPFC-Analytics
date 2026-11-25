import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeMatch } from "../../docs/js/data.js";
import {
  getTableMatches,
  paginateMatches,
  renderCardsCell,
  renderGoalsCell,
} from "../../docs/js/table.js";

const SAMPLE_MATCHES = [
  normalizeMatch({
    id: 1,
    temporada: 2008,
    rodada: 10,
    data: "2008-07-13",
    mando: "Casa",
    adversario: "Palmeiras",
    arena: "Morumbi",
    tecnico_spfc: "Muricy Ramalho",
    gols_pro: 2,
    gols_contra: 1,
    cartoes_amarelos: null,
    cartoes_vermelhos: null,
    gols: null,
  }),
  normalizeMatch({
    id: 2,
    temporada: 2024,
    rodada: 5,
    data: "2024-05-05",
    mando: "Fora",
    adversario: "Atlético-MG",
    arena: "Arena MRV",
    tecnico_spfc: "Luis Zubeldía",
    gols_pro: 0,
    gols_contra: 2,
    cartoes_amarelos: 3,
    cartoes_vermelhos: 1,
    gols: [],
  }),
  normalizeMatch({
    id: 3,
    temporada: 2025,
    rodada: 20,
    data: "2025-08-20",
    mando: "Casa",
    adversario: "Flamengo",
    arena: "MorumBIS",
    tecnico_spfc: "Hernán Crespo",
    gols_pro: 3,
    gols_contra: 0,
    cartoes_amarelos: 1,
    cartoes_vermelhos: 0,
    gols: [
      { jogador: "Luciano", minuto: "12", tipo: "Pênalti", gol_contra: false },
      { jogador: "<script>alert(1)</script>", minuto: "44", tipo: "Normal", gol_contra: false },
      { jogador: "Zagueiro", minuto: "77", tipo: "Gol contra", gol_contra: true },
    ],
  }),
];

describe("table.js — busca, ordenação, paginação e renderização segura", () => {
  it("filtra por resultado e busca textual tolerante a acentos em adversário, técnico e artilheiro", () => {
    const byScorer = getTableMatches(SAMPLE_MATCHES, { tableSearch: "luciano", tableResult: "ALL" });
    assert.deepEqual(byScorer.map((m) => m.id), [3]);

    const byCoach = getTableMatches(SAMPLE_MATCHES, { tableSearch: "zubeldia", tableResult: "ALL" });
    assert.deepEqual(byCoach.map((m) => m.id), [2]);

    const winsOnly = getTableMatches(SAMPLE_MATCHES, { tableSearch: "", tableResult: "V" });
    assert.deepEqual(winsOnly.map((m) => m.id), [3, 1]);
  });

  it("ordena por data, temporada, adversário e saldo de gols", () => {
    const bySaldoDesc = getTableMatches(SAMPLE_MATCHES, {
      tableSortBy: "saldo_gols",
      tableSortDir: "desc",
    });
    assert.deepEqual(bySaldoDesc.map((m) => m.id), [3, 1, 2]);

    const byOppAsc = getTableMatches(SAMPLE_MATCHES, {
      tableSortBy: "adversario",
      tableSortDir: "asc",
    });
    assert.deepEqual(byOppAsc.map((m) => m.adversario), ["Atlético-MG", "Flamengo", "Palmeiras"]);
  });

  it("pagina corretamente e ajusta páginas fora do limite", () => {
    const p1 = paginateMatches(SAMPLE_MATCHES, 1, 2);
    assert.equal(p1.total, 3);
    assert.equal(p1.totalPages, 2);
    assert.equal(p1.page, 1);
    assert.equal(p1.rows.length, 2);

    const overflow = paginateMatches(SAMPLE_MATCHES, 99, 2);
    assert.equal(overflow.page, 2);
    assert.equal(overflow.rows.length, 1);

    const empty = paginateMatches([], 3, 25);
    assert.equal(empty.page, 1);
    assert.equal(empty.totalPages, 1);
    assert.deepEqual(empty.rows, []);
  });

  it("renderiza células de gols e cartões tratando períodos sem registro e escapando HTML", () => {
    assert.match(renderGoalsCell(SAMPLE_MATCHES[0], 2014), /Sem registro \(03–13\)/);
    assert.match(renderCardsCell(SAMPLE_MATCHES[0]), /muted-dash/);

    assert.match(renderGoalsCell(SAMPLE_MATCHES[1], 2014), /muted-dash/);
    assert.match(renderCardsCell(SAMPLE_MATCHES[1]), /mini-card--yellow/);
    assert.match(renderCardsCell(SAMPLE_MATCHES[1]), /mini-card--red/);

    const goalsHtml = renderGoalsCell(SAMPLE_MATCHES[2], 2014);
    assert.match(goalsHtml, /\(P\)/);
    assert.match(goalsHtml, /\(GC\)/);
    assert.doesNotMatch(goalsHtml, /<script>/);
    assert.match(goalsHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

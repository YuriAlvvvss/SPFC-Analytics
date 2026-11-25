import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeMatch } from "../../docs/js/data.js";
import {
  getTableMatches,
  paginateMatches,
  renderCardsCell,
  renderGoalsCell,
  renderTable,
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

    // Sanitização estrita de cartões malformados ou ausentes (anti-XSS)
    const maliciousCards = renderCardsCell({
      cartoes_amarelos: '<img src=x onerror="alert(1)">',
      cartoes_vermelhos: 0,
    });
    assert.equal(maliciousCards, '<span class="muted-dash">—</span>');
    assert.equal(renderCardsCell({}), '<span class="muted-dash">—</span>');
  });

  it("renderTable constrói o DOM sem innerHTML e neutraliza payloads XSS em data/adversário/arena/gols", () => {
    const createMockNode = (tagName) => {
      const node = {
        tagName,
        className: "",
        title: "",
        colSpan: 1,
        attributes: {},
        children: [],
        _textContent: "",
        get textContent() {
          if (this.children.length === 0) return this._textContent;
          return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
        },
        set textContent(val) {
          this._textContent = String(val ?? "");
          this.children = [];
        },
        set innerHTML(_val) {
          throw new Error("innerHTML não deve ser utilizado em renderTable!");
        },
        setAttribute(k, v) {
          this.attributes[k] = String(v);
        },
        appendChild(child) {
          if (child && child.isFragment) {
            this.children.push(...child.children);
          } else {
            this.children.push(child);
          }
          return child;
        },
        replaceChildren(...nodes) {
          this.children = [];
          for (const n of nodes) {
            this.appendChild(n);
          }
        },
      };
      return node;
    };

    const prevDocument = globalThis.document;
    globalThis.document = {
      createElement: (tag) => createMockNode(tag),
      createTextNode: (text) => String(text ?? ""),
      createDocumentFragment: () => ({
        isFragment: true,
        children: [],
        appendChild(child) {
          if (child && child.isFragment) this.children.push(...child.children);
          else this.children.push(child);
          return child;
        },
      }),
      querySelectorAll: () => [],
    };

    try {
      const tbody = createMockNode("tbody");
      const dom = {
        "table-total-badge": { textContent: "" },
        "matches-tbody": tbody,
        "pagination-info": { textContent: "" },
        "page-indicator": { textContent: "" },
        "btn-prev-page": { disabled: false },
        "btn-next-page": { disabled: false },
      };

      const xssMatch = {
        id: 999,
        temporada: 2026,
        rodada: 1,
        data: '<img src=x onerror="alert(1)">',
        mando: 'Casa"><script>alert(2)</script>',
        adversario: "<svg onload=alert(3)>",
        adversario_estado: 'SP" onclick="alert(4)',
        arena: "<b>Estádio</b>",
        tecnico_spfc: "<script>alert(5)</script>",
        gols_pro: 1,
        gols_contra: 0,
        saldo_gols: 1,
        resultado: 'V"><script>alert(6)</script>',
        cartoes_amarelos: 2,
        cartoes_vermelhos: 0,
        gols: [{ jogador: "<img src=x onerror=alert(7)>", minuto: "10'<b>", tipo: "Normal", gol_contra: false }],
      };

      renderTable({
        dom,
        filteredMatches: [xssMatch],
        state: {
          tableSearch: "",
          tableResult: "ALL",
          tableSortBy: "data",
          tableSortDir: "desc",
          tablePage: 1,
          tablePageSize: 25,
        },
        modernStart: 2014,
      });

      assert.equal(tbody.children.length, 1);
      const row = tbody.children[0];
      assert.equal(row.tagName, "tr");
      // Data maliciosa permanece texto literal via textContent, sem parsing HTML
      assert.equal(row.children[0].textContent, '<img src=x onerror="alert(1)">');
      // Resultado inválido sanitizado para fallback seguro na classe CSS
      const resultBadge = row.children[4].children[0].children[1];
      assert.equal(resultBadge.className, "result-badge result-badge--E");
      assert.equal(resultBadge.textContent, "E");
    } finally {
      globalThis.document = prevDocument;
    }
  });
});

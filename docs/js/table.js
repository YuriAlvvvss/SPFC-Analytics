/**
 * Dados Tricolor — Módulo da Tabela de Partidas (`table.js`)
 * Responsável por busca textual, filtro por resultado, ordenação, paginação
 * e renderização segura da tabela de partidas filtradas.
 */

import { VALID_RESULTS, escapeHtml, fmtInt, formatDateBR, normalizeText } from "./data.js";

const VALID_SORT_COLUMNS = new Set(["data", "temporada", "adversario", "saldo_gols"]);
const VALID_TABLE_RESULTS = new Set(["ALL", "V", "E", "D"]);

function isFiniteCardCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function getMissingGoalsLabel(match, modernStart) {
  return typeof match?.temporada === "number" && Number.isFinite(match.temporada) && match.temporada < modernStart
    ? "Sem registro (03–13)"
    : "Sem registro";
}

function createTextSpan(className, text) {
  const el = document.createElement("span");
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Filtra por resultado (V/E/D) e busca textual, e ordena as partidas conforme o estado da tabela.
 * Função pura: não muta o array de entrada.
 */
export function getTableMatches(filteredMatches, tableState) {
  const source = Array.isArray(filteredMatches) ? filteredMatches : [];
  const query = normalizeText(tableState?.tableSearch);
  const tableResult = tableState?.tableResult || "ALL";
  const sortBy = tableState?.tableSortBy || "data";
  const sortDir = tableState?.tableSortDir === "asc" ? "asc" : "desc";

  const list = source.filter((m) => {
    if (tableResult !== "ALL" && m.resultado !== tableResult) {
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

  const dir = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "data") {
      cmp = a.data.localeCompare(b.data) || a.id - b.id;
    } else if (sortBy === "temporada") {
      cmp = a.temporada - b.temporada || a.rodada - b.rodada || a.id - b.id;
    } else if (sortBy === "adversario") {
      cmp = a.adversario.localeCompare(b.adversario, "pt-BR") || b.data.localeCompare(a.data);
    } else if (sortBy === "saldo_gols") {
      cmp = a.saldo_gols - b.saldo_gols || a.gols_pro - b.gols_pro || b.data.localeCompare(a.data);
    }
    return cmp * dir;
  });

  return list;
}

/**
 * Função pura: calcula os índices de paginação e retorna a fatia correspondente.
 */
export function paginateMatches(list, requestedPage = 1, pageSize = 25) {
  const safeList = Array.isArray(list) ? list : [];
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 25;
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage || 1)));
  const startIdx = (page - 1) * safePageSize;
  const endIdx = Math.min(total, startIdx + safePageSize);

  return {
    total,
    totalPages,
    page,
    pageSize: safePageSize,
    startIdx,
    endIdx,
    rows: safeList.slice(startIdx, endIdx),
  };
}

export function renderGoalsCell(match, modernStart = 2014) {
  if (!match || !Array.isArray(match.gols)) {
    const label = getMissingGoalsLabel(match, modernStart);
    return `<span class="muted-dash">${escapeHtml(label)}</span>`;
  }
  if (match.gols.length === 0) {
    return '<span class="muted-dash">—</span>';
  }
  const chips = match.gols
    .filter((g) => g && typeof g === "object")
    .map((g) => {
      const minute = g.minuto ? `<span class="goal-minute">${escapeHtml(g.minuto)}'</span>` : "";
      let tag = "";
      if (g.tipo === "Pênalti") tag = '<span class="goal-tag">(P)</span>';
      else if (g.gol_contra) tag = '<span class="goal-tag">(GC)</span>';

      const ownClass = g.gol_contra ? " goal-chip--own" : "";
      return `<span class="goal-chip${ownClass}">${escapeHtml(g.jogador ?? "")} ${minute}${tag}</span>`;
    });
  if (chips.length === 0) {
    return '<span class="muted-dash">—</span>';
  }
  return `<div class="goals-list">${chips.join("")}</div>`;
}

export function renderCardsCell(match) {
  if (!match || !isFiniteCardCount(match.cartoes_amarelos) || !isFiniteCardCount(match.cartoes_vermelhos)) {
    return '<span class="muted-dash">—</span>';
  }
  const yellow = escapeHtml(String(match.cartoes_amarelos));
  const red = escapeHtml(String(match.cartoes_vermelhos));
  return `
    <span class="card-count" title="Cartões amarelos do SPFC">
      <span class="mini-card mini-card--yellow" aria-hidden="true"></span>${yellow}
    </span>
    <span class="card-count" title="Cartões vermelhos do SPFC">
      <span class="mini-card mini-card--red" aria-hidden="true"></span>${red}
    </span>
  `;
}

function buildGoalsCellContent(match, modernStart = 2014) {
  if (!match || !Array.isArray(match.gols)) {
    return createTextSpan("muted-dash", getMissingGoalsLabel(match, modernStart));
  }
  const validGoals = match.gols.filter((g) => g && typeof g === "object");
  if (validGoals.length === 0) {
    return createTextSpan("muted-dash", "—");
  }

  const list = document.createElement("div");
  list.className = "goals-list";

  for (const g of validGoals) {
    const chip = document.createElement("span");
    chip.className = g.gol_contra ? "goal-chip goal-chip--own" : "goal-chip";

    const playerName = typeof g.jogador === "string" ? g.jogador : String(g.jogador ?? "");
    chip.appendChild(document.createTextNode(g.minuto || g.tipo === "Pênalti" || g.gol_contra ? `${playerName} ` : playerName));

    if (g.minuto) {
      chip.appendChild(createTextSpan("goal-minute", `${String(g.minuto)}'`));
    }
    if (g.tipo === "Pênalti") {
      chip.appendChild(createTextSpan("goal-tag", "(P)"));
    } else if (g.gol_contra) {
      chip.appendChild(createTextSpan("goal-tag", "(GC)"));
    }

    list.appendChild(chip);
  }

  return list;
}

function buildCardsCellContent(match) {
  const frag = document.createDocumentFragment();
  if (!match || !isFiniteCardCount(match.cartoes_amarelos) || !isFiniteCardCount(match.cartoes_vermelhos)) {
    frag.appendChild(createTextSpan("muted-dash", "—"));
    return frag;
  }

  const yellowWrap = document.createElement("span");
  yellowWrap.className = "card-count";
  yellowWrap.title = "Cartões amarelos do SPFC";
  const yellowIcon = document.createElement("span");
  yellowIcon.className = "mini-card mini-card--yellow";
  yellowIcon.setAttribute("aria-hidden", "true");
  yellowWrap.appendChild(yellowIcon);
  yellowWrap.appendChild(document.createTextNode(String(match.cartoes_amarelos)));

  const redWrap = document.createElement("span");
  redWrap.className = "card-count";
  redWrap.title = "Cartões vermelhos do SPFC";
  const redIcon = document.createElement("span");
  redIcon.className = "mini-card mini-card--red";
  redIcon.setAttribute("aria-hidden", "true");
  redWrap.appendChild(redIcon);
  redWrap.appendChild(document.createTextNode(String(match.cartoes_vermelhos)));

  frag.appendChild(yellowWrap);
  frag.appendChild(redWrap);
  return frag;
}

function buildMatchRowElement(m, modernStart = 2014) {
  const tr = document.createElement("tr");

  // 1. Data
  const tdDate = document.createElement("td");
  tdDate.className = "cell-date";
  tdDate.textContent = formatDateBR(m?.data);
  tr.appendChild(tdDate);

  // 2. Temporada / Rodada
  const tdSeason = document.createElement("td");
  tdSeason.className = "cell-season";
  const seasonLabel = Number.isFinite(m?.temporada) ? String(m.temporada) : "—";
  const roundLabel = Number.isFinite(m?.rodada) ? String(m.rodada).padStart(2, "0") : "00";
  tdSeason.textContent = `${seasonLabel} · R${roundLabel}`;
  tr.appendChild(tdSeason);

  // 3. Mando
  const tdVenue = document.createElement("td");
  const venueClass = m?.mando === "Casa" ? "venue-pill--home" : "venue-pill--away";
  tdVenue.appendChild(createTextSpan(`venue-pill ${venueClass}`, String(m?.mando || "—")));
  tr.appendChild(tdVenue);

  // 4. Adversário + UF
  const tdOpp = document.createElement("td");
  tdOpp.className = "opponent-cell";
  tdOpp.appendChild(document.createTextNode(String(m?.adversario || "—")));
  if (m?.adversario_estado) {
    tdOpp.appendChild(createTextSpan("opponent-uf", String(m.adversario_estado)));
  }
  tr.appendChild(tdOpp);

  // 5. Placar + Selo de Resultado
  const tdScore = document.createElement("td");
  const scoreCell = document.createElement("span");
  scoreCell.className = "score-cell";
  const gp = Number.isFinite(m?.gols_pro) ? String(m.gols_pro) : "—";
  const gc = Number.isFinite(m?.gols_contra) ? String(m.gols_contra) : "—";
  scoreCell.appendChild(createTextSpan("score-text", `${gp} × ${gc}`));

  const safeResult = VALID_RESULTS.has(m?.resultado) ? m.resultado : "E";
  scoreCell.appendChild(createTextSpan(`result-badge result-badge--${safeResult}`, safeResult));
  tdScore.appendChild(scoreCell);
  tr.appendChild(tdScore);

  // 6. Gols do SPFC
  const tdGoals = document.createElement("td");
  tdGoals.appendChild(buildGoalsCellContent(m, modernStart));
  tr.appendChild(tdGoals);

  // 7. Cartões
  const tdCards = document.createElement("td");
  tdCards.className = "cards-cell";
  tdCards.appendChild(buildCardsCellContent(m));
  tr.appendChild(tdCards);

  // 8. Estádio / Técnico
  const tdArena = document.createElement("td");
  tdArena.className = "arena-cell";
  tdArena.appendChild(createTextSpan("arena-name", String(m?.arena || "—")));
  if (m?.tecnico_spfc) {
    tdArena.appendChild(createTextSpan("coach-name", `Téc.: ${String(m.tecnico_spfc)}`));
  }
  tr.appendChild(tdArena);

  return tr;
}

export function renderTable({ dom, filteredMatches, state, modernStart = 2014 }) {
  const tableList = getTableMatches(filteredMatches, state);
  const { total, totalPages, page, startIdx, endIdx, rows: pageRows } = paginateMatches(
    tableList,
    state.tablePage,
    state.tablePageSize
  );

  state.tablePage = page;
  dom["table-total-badge"].textContent = fmtInt.format(total);

  const tbody = dom["matches-tbody"];
  const fragment = document.createDocumentFragment();

  if (pageRows.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "table-empty-row";
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 8;
    emptyCell.textContent = "Nenhuma partida encontrada para os filtros e busca informados.";
    emptyRow.appendChild(emptyCell);
    fragment.appendChild(emptyRow);
  } else {
    for (const m of pageRows) {
      fragment.appendChild(buildMatchRowElement(m, modernStart));
    }
  }
  tbody.replaceChildren(fragment);

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

export function bindTableEvents({ dom, state, onTableFilterChange, onTableViewChange }) {
  dom["table-search"].addEventListener("input", (e) => {
    state.tableSearch = e.target.value;
    state.tablePage = 1;
    onTableFilterChange({ skipInputSync: true });
  });

  document.querySelectorAll("[data-result]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextResult = btn.dataset.result;
      if (!VALID_TABLE_RESULTS.has(nextResult)) return;
      state.tableResult = nextResult;
      state.tablePage = 1;
      onTableFilterChange({ skipInputSync: false });
    });
  });

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.sort;
      if (!VALID_SORT_COLUMNS.has(col)) return;
      if (state.tableSortBy === col) {
        state.tableSortDir = state.tableSortDir === "asc" ? "desc" : "asc";
      } else {
        state.tableSortBy = col;
        state.tableSortDir = col === "adversario" ? "asc" : "desc";
      }
      state.tablePage = 1;
      onTableViewChange();
    });
  });

  dom["table-page-size"].addEventListener("change", (e) => {
    state.tablePageSize = Number(e.target.value) || 25;
    state.tablePage = 1;
    onTableViewChange();
  });

  dom["btn-prev-page"].addEventListener("click", () => {
    if (state.tablePage > 1) {
      state.tablePage -= 1;
      onTableViewChange();
    }
  });

  dom["btn-next-page"].addEventListener("click", () => {
    state.tablePage += 1;
    onTableViewChange();
  });
}

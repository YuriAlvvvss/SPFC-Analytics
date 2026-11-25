/**
 * Dados Tricolor — Módulo da Tabela de Partidas (`table.js`)
 * Responsável por busca textual, filtro por resultado, ordenação, paginação
 * e renderização segura da tabela de partidas filtradas.
 */

import { escapeHtml, fmtInt, formatDateBR, normalizeText } from "./data.js";

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
  if (match.gols === null) {
    const label =
      typeof match.temporada === "number" && match.temporada < modernStart
        ? "Sem registro (03–13)"
        : "Sem registro";
    return `<span class="muted-dash">${escapeHtml(label)}</span>`;
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

export function renderCardsCell(match) {
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

export function renderTable({ dom, filteredMatches, state, modernStart = 2014 }) {
  const tableList = getTableMatches(filteredMatches, state);
  const { total, totalPages, page, startIdx, endIdx, rows: pageRows } = paginateMatches(
    tableList,
    state.tablePage,
    state.tablePageSize
  );

  state.tablePage = page;
  dom["table-total-badge"].textContent = fmtInt.format(total);

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
            <td>${renderGoalsCell(m, modernStart)}</td>
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

export function bindTableEvents({ dom, state, onTableFilterChange, onTableViewChange }) {
  dom["table-search"].addEventListener("input", (e) => {
    state.tableSearch = e.target.value;
    state.tablePage = 1;
    onTableFilterChange({ skipInputSync: true });
  });

  document.querySelectorAll("[data-result]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tableResult = btn.dataset.result;
      state.tablePage = 1;
      onTableFilterChange({ skipInputSync: false });
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

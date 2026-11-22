"""
Suíte de Qualidade de Dados (Data Quality) do projeto Dados Tricolor.

Valida os arquivos JSON de produção e histórico do São Paulo FC no Campeonato
Brasileiro Série A (era dos pontos corridos, 2003–Atual):
- `docs/data/spfc_pontos_corridos.json` (dataset principal publicado no GitHub Pages)
- `data/historico_2003_2025.json` (base histórica congelada)
- `docs/data/meta.json` (metadados da última sincronização automática)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
from typing import Any
import unicodedata

import pytest

# ---------------------------------------------------------------------------
# Caminhos e constantes de domínio
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
PROD_DATA_PATH = REPO_ROOT / "docs" / "data" / "spfc_pontos_corridos.json"
HIST_DATA_PATH = REPO_ROOT / "data" / "historico_2003_2025.json"
META_DATA_PATH = REPO_ROOT / "docs" / "data" / "meta.json"
PROXIMO_JOGO_PATH = REPO_ROOT / "docs" / "data" / "proximo_jogo.json"

ALL_JSON_PATHS = (PROD_DATA_PATH, HIST_DATA_PATH, META_DATA_PATH)
DATASET_PATHS = (PROD_DATA_PATH, HIST_DATA_PATH)

# Fundação do São Paulo FC: 25/01/1930; início dos pontos corridos: 2003
DATA_FUNDACAO_SPFC = date(1930, 1, 25)
INICIO_PONTOS_CORRIDOS = date(2003, 1, 1)
ANO_INICIO_ERA_MODERNA = 2014
ANO_FIM_HISTORICO_KAGGLE = 2025

PROXIMO_JOGO_ROOT_KEYS = {"atualizado_em", "tem_proximo_jogo", "proximo_jogo"}
PROXIMO_JOGO_ITEM_KEYS = {
    "data",
    "hora",
    "horario_definido",
    "adversario",
    "mando",
    "rodada",
    "temporada",
    "competicao",
    "status",
}
PROXIMO_JOGO_STATUS_VALIDOS = {"TIMED", "SCHEDULED"}

# Número oficial de rodadas por edição dos pontos corridos
RODADAS_POR_TEMPORADA: dict[int, int] = {
    2003: 46,
    2004: 46,
    2005: 42,
}
RODADAS_PADRAO = 38

METADATA_KEYS = {
    "clube",
    "competicao",
    "temporada_inicio",
    "temporada_fim",
    "total_partidas",
    "temporadas_com_cartoes",
    "temporadas_com_gols",
    "temporadas_com_estatisticas",
    "fonte_cartoes",
    "fonte_gols",
    "gerado_em",
}

META_SYNC_KEYS = {
    "atualizado_em",
    "atualizado_em_brt",
    "fuso_horario",
    "temporada_inicio",
    "temporada_fim",
    "temporada_atual",
    "total_jogos",
    "jogos_historico",
    "jogos_temporada_atual",
    "ultima_partida_data",
    "fonte_atualizacao",
}

PARTIDA_REQUIRED_FIELDS = {
    "id",
    "temporada",
    "rodada",
    "data",
    "hora",
    "mando",
    "adversario",
    "adversario_estado",
    "arena",
    "gols_pro",
    "gols_contra",
    "saldo_gols",
    "resultado",
    "pontos",
}

PARTIDA_OPTIONAL_FIELDS = {
    "tecnico_spfc",
    "formacao_spfc",
    "cartoes_amarelos",
    "cartoes_vermelhos",
    "cartoes_amarelos_adversario",
    "cartoes_vermelhos_adversario",
    "gols",
    "chutes",
    "chutes_no_alvo",
    "posse_de_bola",
    "passes",
    "precisao_passes",
    "faltas",
    "escanteios",
    "impedimentos",
}

PARTIDA_ALL_FIELDS = PARTIDA_REQUIRED_FIELDS | PARTIDA_OPTIONAL_FIELDS

GOL_KEYS = {"jogador", "minuto", "tipo", "gol_contra"}
TIPOS_GOL_VALIDOS = {"Normal", "Pênalti", "Gol contra"}

MANDOS_VALIDOS = {"Casa", "Fora"}
RESULTADOS_VALIDOS = {"V", "E", "D"}
PONTOS_POR_RESULTADO = {"V": 3, "E": 1, "D": 0}

UFS_BRASIL = {
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO",
    "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
    "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
}

CAMPOS_CARTOES = (
    "cartoes_amarelos",
    "cartoes_vermelhos",
    "cartoes_amarelos_adversario",
    "cartoes_vermelhos_adversario",
)

CAMPOS_STATS_CONTAGEM = (
    "chutes",
    "chutes_no_alvo",
    "passes",
    "faltas",
    "escanteios",
    "impedimentos",
)

CAMPOS_STATS_PERCENTUAL = (
    "posse_de_bola",
    "precisao_passes",
)

RE_DATA_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_HORA = re.compile(r"^\d{2}:\d{2}$")
RE_MINUTO = re.compile(r"^\d+(\+\d+)?$")
RE_FORMACAO = re.compile(r"^\d+(-\d+)+$")
RE_CONTROL_OR_BROKEN = re.compile(r"[\x00-\x1f\x7f\ufffd\xa0]")
RE_MOJIBAKE = re.compile(r"(?:Ã|Â)[\u0080-\u00ff]")


# ---------------------------------------------------------------------------
# Utilitários de validação e formatação de erros
# ---------------------------------------------------------------------------


def _rejeitar_constante_json(constante: str) -> None:
    raise ValueError(f"Constante JSON não-padrão encontrada: {constante!r}")


def _carregar_json_estrito(path: Path) -> dict[str, Any]:
    raw_bytes = path.read_bytes()
    texto = raw_bytes.decode("utf-8")
    dados = json.loads(texto, parse_constant=_rejeitar_constante_json)
    if not isinstance(dados, dict):
        raise ValueError(f"Raiz de {path.name} deve ser um objeto JSON, obtido {type(dados).__name__}")
    return dados


def _eh_inteiro(valor: Any) -> bool:
    """Retorna True apenas para int nativo (excluindo bool, que herda de int em Python)."""
    return isinstance(valor, int) and not isinstance(valor, bool)


def _eh_nan_ou_inf(valor: Any) -> bool:
    return isinstance(valor, float) and (math.isnan(valor) or math.isinf(valor))


def _texto_invalido(valor: Any) -> str | None:
    """Retorna motivo da invalidez de uma string ou None se estiver limpa."""
    if not isinstance(valor, str):
        return f"tipo inválido ({type(valor).__name__})"
    if not valor:
        return "string vazia"
    if valor != valor.strip():
        return f"espaços sobrando nas extremidades ({valor!r})"
    if "  " in valor:
        return f"espaços duplicados internos ({valor!r})"
    if RE_CONTROL_OR_BROKEN.search(valor):
        return f"caractere de controle, NBSP ou U+FFFD ({valor!r})"
    if RE_MOJIBAKE.search(valor):
        return f"possível mojibake UTF-8/Latin-1 ({valor!r})"
    return None


def _normalizar_chave_texto(texto: str) -> str:
    nfd = unicodedata.normalize("NFD", texto)
    sem_acentos = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return " ".join(sem_acentos.lower().split())


def _fmt_partida(idx: int, p: dict[str, Any]) -> str:
    return (
        f"[idx={idx} | id={p.get('id')} | temp={p.get('temporada')} R{p.get('rodada')} | "
        f"data={p.get('data')} | {p.get('mando')} vs {p.get('adversario')}]"
    )


def _formatar_erros(titulo: str, erros: list[str], limite: int = 25) -> str:
    exibidos = erros[:limite]
    restante = len(erros) - len(exibidos)
    corpo = "\n".join(f"  - {e}" for e in exibidos)
    if restante > 0:
        corpo += f"\n  ... e mais {restante} ocorrência(s)."
    return f"{titulo} ({len(erros)} ocorrência(s)):\n{corpo}"


def _max_rodadas_temporada(temporada: int) -> int:
    return RODADAS_POR_TEMPORADA.get(temporada, RODADAS_PADRAO)


def _chave_minuto(minuto: str) -> tuple[int, int]:
    partes = minuto.split("+")
    return (int(partes[0]), int(partes[1]) if len(partes) > 1 else 0)


# ---------------------------------------------------------------------------
# Fixtures (carregamento único por módulo)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def dataset_producao() -> dict[str, Any]:
    return _carregar_json_estrito(PROD_DATA_PATH)


@pytest.fixture(scope="module")
def dataset_historico() -> dict[str, Any]:
    return _carregar_json_estrito(HIST_DATA_PATH)


@pytest.fixture(scope="module")
def meta_sincronizacao() -> dict[str, Any]:
    return _carregar_json_estrito(META_DATA_PATH)


@pytest.fixture(
    scope="module",
    params=["producao", "historico"],
    ids=["spfc_pontos_corridos.json", "historico_2003_2025.json"],
)
def dataset_partidas(
    request: pytest.FixtureRequest,
    dataset_producao: dict[str, Any],
    dataset_historico: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    if request.param == "producao":
        return ("docs/data/spfc_pontos_corridos.json", dataset_producao)
    return ("data/historico_2003_2025.json", dataset_historico)


# ===========================================================================
# 1. Estrutura e leitura dos arquivos
# ===========================================================================


@pytest.mark.parametrize("arquivo", ALL_JSON_PATHS, ids=lambda p: p.name)
def test_arquivo_existe_nao_vazio_utf8_e_json_valido(arquivo: Path) -> None:
    """Garante existência, tamanho > 0, codificação UTF-8 limpa e JSON estrito (sem NaN/Infinity)."""
    assert arquivo.exists() and arquivo.is_file(), f"Arquivo ausente: {arquivo}"
    tamanho = arquivo.stat().st_size
    assert tamanho > 0, f"Arquivo está vazio (0 bytes): {arquivo}"

    raw = arquivo.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), f"Arquivo contém BOM UTF-8 inesperado: {arquivo}"

    try:
        texto = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        pytest.fail(f"Arquivo {arquivo} não está em UTF-8 válido: {exc}")

    assert "\ufffd" not in texto, f"Arquivo {arquivo} contém caractere de substituição UTF-8 (U+FFFD)."

    try:
        dados = json.loads(texto, parse_constant=_rejeitar_constante_json)
    except (json.JSONDecodeError, ValueError) as exc:
        pytest.fail(f"Falha ao parsear JSON estrito em {arquivo}: {exc}")

    assert isinstance(dados, dict) and len(dados) > 0, (
        f"Raiz de {arquivo} deve ser um objeto JSON não vazio."
    )


def test_estrutura_raiz_datasets(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """Valida as chaves raiz `metadata` e `partidas` dos datasets de jogos."""
    nome, payload = dataset_partidas
    assert set(payload.keys()) == {"metadata", "partidas"}, (
        f"[{nome}] Chaves raiz inesperadas: {sorted(payload.keys())}"
    )
    assert isinstance(payload["metadata"], dict), f"[{nome}] 'metadata' deve ser um objeto."
    assert isinstance(payload["partidas"], list) and len(payload["partidas"]) > 0, (
        f"[{nome}] 'partidas' deve ser uma lista não vazia."
    )


# ===========================================================================
# 2. Schema e completude
# ===========================================================================


def test_schema_metadata_completo(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """Valida presença e não-nulidade de todas as chaves de `metadata`."""
    nome, payload = dataset_partidas
    meta = payload["metadata"]

    faltando = METADATA_KEYS - set(meta.keys())
    extras = set(meta.keys()) - METADATA_KEYS
    assert not faltando and not extras, (
        f"[{nome}] Divergência no schema de metadata | faltando={sorted(faltando)} | extras={sorted(extras)}"
    )

    for campo in ("clube", "competicao", "fonte_cartoes", "fonte_gols", "gerado_em"):
        motivo = _texto_invalido(meta[campo])
        assert motivo is None, f"[{nome}] metadata.{campo} inválido: {motivo}"

    for campo in ("temporada_inicio", "temporada_fim", "total_partidas"):
        assert _eh_inteiro(meta[campo]), (
            f"[{nome}] metadata.{campo} deve ser int, obtido {meta[campo]!r}"
        )

    for campo in ("temporadas_com_cartoes", "temporadas_com_gols", "temporadas_com_estatisticas"):
        assert isinstance(meta[campo], list) and len(meta[campo]) > 0, (
            f"[{nome}] metadata.{campo} deve ser lista não vazia."
        )
        assert all(_eh_inteiro(t) for t in meta[campo]), (
            f"[{nome}] metadata.{campo} contém temporada não inteira: {meta[campo]!r}"
        )


def test_schema_e_completude_campos_obrigatorios_partidas(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """Confirma que todas as 29 chaves existem e nenhum campo obrigatório está nulo, NaN ou vazio."""
    nome, payload = dataset_partidas
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        if not isinstance(p, dict):
            erros.append(f"[idx={idx}] Registro não é objeto dict ({type(p).__name__})")
            continue

        chaves = set(p.keys())
        faltando = PARTIDA_ALL_FIELDS - chaves
        extras = chaves - PARTIDA_ALL_FIELDS
        if faltando or extras:
            erros.append(
                f"{_fmt_partida(idx, p)} schema divergente: faltando={sorted(faltando)}, extras={sorted(extras)}"
            )

        for campo in sorted(PARTIDA_REQUIRED_FIELDS):
            val = p.get(campo)
            if val is None or _eh_nan_ou_inf(val):
                erros.append(f"{_fmt_partida(idx, p)} campo obrigatório '{campo}' é nulo/NaN ({val!r})")
            elif isinstance(val, str) and not val.strip():
                erros.append(f"{_fmt_partida(idx, p)} campo obrigatório '{campo}' está vazio ({val!r})")

        for campo, val in p.items():
            if _eh_nan_ou_inf(val):
                erros.append(f"{_fmt_partida(idx, p)} campo '{campo}' contém NaN/Infinity ({val!r})")

    assert not erros, _formatar_erros(f"[{nome}] Violações de schema/completude", erros)


def test_schema_meta_sincronizacao(meta_sincronizacao: dict[str, Any]) -> None:
    """Valida o schema e a completude de `docs/data/meta.json`."""
    faltando = META_SYNC_KEYS - set(meta_sincronizacao.keys())
    extras = set(meta_sincronizacao.keys()) - META_SYNC_KEYS
    assert not faltando and not extras, (
        f"[meta.json] Schema divergente | faltando={sorted(faltando)} | extras={sorted(extras)}"
    )

    for campo in ("atualizado_em", "atualizado_em_brt", "fuso_horario", "ultima_partida_data", "fonte_atualizacao"):
        motivo = _texto_invalido(meta_sincronizacao[campo])
        assert motivo is None, f"[meta.json] Campo '{campo}' inválido: {motivo}"

    for campo in (
        "temporada_inicio",
        "temporada_fim",
        "temporada_atual",
        "total_jogos",
        "jogos_historico",
        "jogos_temporada_atual",
    ):
        assert _eh_inteiro(meta_sincronizacao[campo]) and meta_sincronizacao[campo] >= 0, (
            f"[meta.json] Campo '{campo}' deve ser int >= 0, obtido {meta_sincronizacao[campo]!r}"
        )

    try:
        datetime.fromisoformat(meta_sincronizacao["atualizado_em"])
    except ValueError as exc:
        pytest.fail(
            f"[meta.json] 'atualizado_em' não é ISO 8601 válido ({meta_sincronizacao['atualizado_em']!r}): {exc}"
        )

    assert RE_DATA_ISO.fullmatch(meta_sincronizacao["ultima_partida_data"]), (
        f"[meta.json] 'ultima_partida_data' fora do padrão YYYY-MM-DD: {meta_sincronizacao['ultima_partida_data']!r}"
    )


def test_cobertura_era_moderna_cartoes_e_gols(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """
    Garante que:
    - Nenhuma partida possua cartões parcialmente preenchidos.
    - Partidas da era moderna histórica (2014–2025) tenham gols e os 4 campos de cartões preenchidos.
    - Partidas pós-histórico (2026+) vindas de APIs sem eventos detalhados (ex.: football-data.org)
      possam manter gols/cartões como None, mas se preenchidos respeitem o tipo esperado.
    """
    nome, payload = dataset_partidas
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        cartoes = [p.get(c) for c in CAMPOS_CARTOES]
        preenchidos = [c is not None for c in cartoes]

        # Se algum campo de cartão estiver preenchido, todos os 4 devem estar preenchidos
        if any(preenchidos) and not all(preenchidos):
            erros.append(
                f"{_fmt_partida(idx, p)} cartões parcialmente nulos: "
                f"{ {c: p.get(c) for c in CAMPOS_CARTOES} }"
            )

        if ANO_INICIO_ERA_MODERNA <= p["temporada"] <= ANO_FIM_HISTORICO_KAGGLE:
            if not all(preenchidos):
                erros.append(
                    f"{_fmt_partida(idx, p)} partida {ANO_INICIO_ERA_MODERNA}–{ANO_FIM_HISTORICO_KAGGLE} "
                    f"sem cartões completos: { {c: p.get(c) for c in CAMPOS_CARTOES} }"
                )
            if not isinstance(p.get("gols"), list):
                erros.append(
                    f"{_fmt_partida(idx, p)} partida {ANO_INICIO_ERA_MODERNA}–{ANO_FIM_HISTORICO_KAGGLE} "
                    f"sem lista de gols (valor={p.get('gols')!r})"
                )
        elif p["temporada"] > ANO_FIM_HISTORICO_KAGGLE:
            if p.get("gols") is not None and not isinstance(p.get("gols"), list):
                erros.append(
                    f"{_fmt_partida(idx, p)} campo 'gols' deve ser list ou None "
                    f"(valor={p.get('gols')!r})"
                )

    assert not erros, _formatar_erros(f"[{nome}] Falha de cobertura na era moderna (2014+)", erros)


# ===========================================================================
# 3. Regras de negócio de futebol
# ===========================================================================


def test_datas_horas_e_intervalo_coerente(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """
    Valida formato YYYY-MM-DD e HH:MM, intervalo coerente (pós-fundação / início dos
    pontos corridos até hoje, pois a base contém apenas jogos finalizados) e alinhamento
    entre data e temporada (incluindo a exceção da edição 2020 encerrada em jan–fev/2021).
    """
    nome, payload = dataset_partidas
    # Considera o maior entre data local e UTC para evitar falso positivo em jogos noturnos BRT
    limite_hoje = max(date.today(), datetime.now(timezone.utc).date())
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        data_str = p["data"]
        if not isinstance(data_str, str) or not RE_DATA_ISO.fullmatch(data_str):
            erros.append(f"{_fmt_partida(idx, p)} data fora do padrão YYYY-MM-DD: {data_str!r}")
            continue

        try:
            dt = date.fromisoformat(data_str)
        except ValueError:
            erros.append(f"{_fmt_partida(idx, p)} data inexistente no calendário: {data_str!r}")
            continue

        if dt < DATA_FUNDACAO_SPFC or dt < INICIO_PONTOS_CORRIDOS:
            erros.append(
                f"{_fmt_partida(idx, p)} data anterior ao início dos pontos corridos ({INICIO_PONTOS_CORRIDOS}): {dt}"
            )
        if dt > limite_hoje:
            erros.append(
                f"{_fmt_partida(idx, p)} data no futuro (base deve conter apenas jogos finalizados): {dt} > {limite_hoje}"
            )

        temp = p["temporada"]
        if not _eh_inteiro(temp) or not (2003 <= temp <= limite_hoje.year):
            erros.append(f"{_fmt_partida(idx, p)} temporada fora do intervalo válido (2003..{limite_hoje.year}): {temp!r}")
        elif temp == 2020:
            # Edição de 2020 teve rodadas finais disputadas em jan/fev de 2021 (pandemia)
            if not (date(2020, 1, 1) <= dt <= date(2021, 2, 28)):
                erros.append(
                    f"{_fmt_partida(idx, p)} data fora da janela da temporada 2020 (2020-01-01..2021-02-28): {dt}"
                )
        elif dt.year != temp:
            erros.append(
                f"{_fmt_partida(idx, p)} ano da data ({dt.year}) diverge da temporada ({temp})"
            )

        hora_str = p["hora"]
        if not isinstance(hora_str, str) or not RE_HORA.fullmatch(hora_str):
            erros.append(f"{_fmt_partida(idx, p)} hora fora do padrão HH:MM: {hora_str!r}")
        else:
            hh, mm = map(int, hora_str.split(":"))
            if not (0 <= hh <= 23 and 0 <= mm <= 59):
                erros.append(f"{_fmt_partida(idx, p)} hora inválida: {hora_str!r}")

    assert not erros, _formatar_erros(f"[{nome}] Datas/horas inválidas ou incoerentes", erros)


def test_ordenacao_cronologica_partidas(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """Garante ordenação monotônica por (temporada, data, id)."""
    nome, payload = dataset_partidas
    partidas = payload["partidas"]
    erros: list[str] = []

    for idx in range(1, len(partidas)):
        ant = partidas[idx - 1]
        atu = partidas[idx]
        chave_ant = (ant["temporada"], ant["data"], ant["id"])
        chave_atu = (atu["temporada"], atu["data"], atu["id"])
        if chave_atu < chave_ant:
            erros.append(
                f"Fora de ordem em idx={idx}: {_fmt_partida(idx - 1, ant)} seguido de {_fmt_partida(idx, atu)}"
            )

    assert not erros, _formatar_erros(f"[{nome}] Partidas fora de ordem cronológica", erros)


def test_placares_inteiros_nao_negativos_e_coerencia_matematica(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """
    Valida que placares são inteiros >= 0 e que todas as colunas derivadas
    (`saldo_gols`, `resultado`, `pontos`) batem exatamente com `gols_pro` e `gols_contra`.
    """
    nome, payload = dataset_partidas
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        gp = p["gols_pro"]
        gc = p["gols_contra"]
        sg = p["saldo_gols"]
        res = p["resultado"]
        pts = p["pontos"]

        if not _eh_inteiro(gp) or gp < 0:
            erros.append(f"{_fmt_partida(idx, p)} gols_pro inválido: {gp!r}")
            continue
        if not _eh_inteiro(gc) or gc < 0:
            erros.append(f"{_fmt_partida(idx, p)} gols_contra inválido: {gc!r}")
            continue

        sg_esperado = gp - gc
        if not _eh_inteiro(sg) or sg != sg_esperado:
            erros.append(
                f"{_fmt_partida(idx, p)} saldo_gols={sg!r} diverge de gols_pro({gp}) - gols_contra({gc}) = {sg_esperado}"
            )

        res_esperado = "V" if gp > gc else ("D" if gp < gc else "E")
        if res != res_esperado:
            erros.append(
                f"{_fmt_partida(idx, p)} resultado={res!r} diverge do placar {gp}x{gc} (esperado {res_esperado!r})"
            )

        pts_esperado = PONTOS_POR_RESULTADO[res_esperado]
        if not _eh_inteiro(pts) or pts != pts_esperado:
            erros.append(
                f"{_fmt_partida(idx, p)} pontos={pts!r} diverge do resultado {res_esperado!r} (esperado {pts_esperado})"
            )

    assert not erros, _formatar_erros(f"[{nome}] Inconsistência em placares ou colunas derivadas", erros)


def test_integridade_gols_detalhados(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """
    Valida que, quando `gols` está presente, a contagem bate exatamente com `gols_pro`,
    cada gol respeita o schema, minuto, tipo/flag `gol_contra` e ordem cronológica.
    """
    nome, payload = dataset_partidas
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        gols = p["gols"]
        if gols is None:
            continue
        if not isinstance(gols, list):
            erros.append(f"{_fmt_partida(idx, p)} campo 'gols' deve ser list ou None, obtido {type(gols).__name__}")
            continue

        if len(gols) != p["gols_pro"]:
            erros.append(
                f"{_fmt_partida(idx, p)} len(gols)={len(gols)} diverge de gols_pro={p['gols_pro']}"
            )

        chaves_minutos: list[tuple[int, int]] = []
        for g_idx, g in enumerate(gols):
            if not isinstance(g, dict) or set(g.keys()) != GOL_KEYS:
                erros.append(
                    f"{_fmt_partida(idx, p)} gol[{g_idx}] com schema inválido: {g!r}"
                )
                continue

            motivo_jog = _texto_invalido(g["jogador"])
            if motivo_jog is not None:
                erros.append(f"{_fmt_partida(idx, p)} gol[{g_idx}].jogador inválido: {motivo_jog}")

            tipo = g["tipo"]
            gol_contra = g["gol_contra"]
            if tipo not in TIPOS_GOL_VALIDOS:
                erros.append(f"{_fmt_partida(idx, p)} gol[{g_idx}].tipo fora do domínio: {tipo!r}")
            if not isinstance(gol_contra, bool):
                erros.append(f"{_fmt_partida(idx, p)} gol[{g_idx}].gol_contra deve ser bool: {gol_contra!r}")
            elif (tipo == "Gol contra") != gol_contra:
                erros.append(
                    f"{_fmt_partida(idx, p)} gol[{g_idx}] inconsistente: tipo={tipo!r} mas gol_contra={gol_contra!r}"
                )

            minuto = g["minuto"]
            if not isinstance(minuto, str) or not RE_MINUTO.fullmatch(minuto):
                erros.append(f"{_fmt_partida(idx, p)} gol[{g_idx}].minuto fora do padrão: {minuto!r}")
            else:
                base, acr = _chave_minuto(minuto)
                if not (1 <= base <= 90) or not (0 <= acr <= 30):
                    erros.append(f"{_fmt_partida(idx, p)} gol[{g_idx}].minuto fora da faixa plausível: {minuto!r}")
                chaves_minutos.append((base, acr))

        if chaves_minutos != sorted(chaves_minutos):
            erros.append(
                f"{_fmt_partida(idx, p)} gols fora de ordem cronológica: {[g.get('minuto') for g in gols]}"
            )

    assert not erros, _formatar_erros(f"[{nome}] Inconsistência nos gols detalhados", erros)


def test_cartoes_e_estatisticas_tecnicas_coerentes(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """Valida faixas numéricas e coerência matemática de cartões e estatísticas técnicas."""
    nome, payload = dataset_partidas
    erros: list[str] = []

    for idx, p in enumerate(payload["partidas"]):
        for campo in CAMPOS_CARTOES:
            val = p[campo]
            if val is not None and (not _eh_inteiro(val) or val < 0):
                erros.append(f"{_fmt_partida(idx, p)} {campo} inválido (deve ser int >= 0): {val!r}")

        for campo in CAMPOS_STATS_CONTAGEM:
            val = p[campo]
            if val is not None and (not _eh_inteiro(val) or val < 0):
                erros.append(f"{_fmt_partida(idx, p)} {campo} inválido (deve ser int >= 0): {val!r}")

        if p["chutes"] is not None and p["chutes_no_alvo"] is not None:
            if p["chutes_no_alvo"] > p["chutes"]:
                erros.append(
                    f"{_fmt_partida(idx, p)} chutes_no_alvo ({p['chutes_no_alvo']}) > chutes ({p['chutes']})"
                )

        for campo in CAMPOS_STATS_PERCENTUAL:
            val = p[campo]
            if val is not None and (not _eh_inteiro(val) or not (0 <= val <= 100)):
                erros.append(f"{_fmt_partida(idx, p)} {campo} fora de 0..100: {val!r}")

        formacao = p["formacao_spfc"]
        if formacao is not None:
            if not isinstance(formacao, str) or not RE_FORMACAO.fullmatch(formacao):
                erros.append(f"{_fmt_partida(idx, p)} formacao_spfc fora do padrão tático: {formacao!r}")

    assert not erros, _formatar_erros(f"[{nome}] Inconsistência em cartões ou estatísticas", erros)


def test_dominio_categorias_e_higiene_textual(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """
    Valida domínio de `mando`, `resultado`, `adversario_estado` (UFs válidas e
    consistentes por clube), ausência do próprio SPFC como adversário, ausência de
    duplicatas ortográficas de adversários e higiene de todas as strings.
    """
    nome, payload = dataset_partidas
    erros: list[str] = []
    ufs_por_adversario: dict[str, set[str]] = defaultdict(set)
    nomes_por_chave_norm: dict[str, set[str]] = defaultdict(set)

    for idx, p in enumerate(payload["partidas"]):
        if p["mando"] not in MANDOS_VALIDOS:
            erros.append(f"{_fmt_partida(idx, p)} mando fora do domínio {sorted(MANDOS_VALIDOS)}: {p['mando']!r}")

        if p["resultado"] not in RESULTADOS_VALIDOS:
            erros.append(
                f"{_fmt_partida(idx, p)} resultado fora do domínio {sorted(RESULTADOS_VALIDOS)}: {p['resultado']!r}"
            )

        if p["adversario_estado"] not in UFS_BRASIL:
            erros.append(
                f"{_fmt_partida(idx, p)} adversario_estado não é UF brasileira válida: {p['adversario_estado']!r}"
            )

        for campo in ("adversario", "adversario_estado", "arena"):
            motivo = _texto_invalido(p[campo])
            if motivo is not None:
                erros.append(f"{_fmt_partida(idx, p)} campo '{campo}' inválido: {motivo}")

        for campo in ("tecnico_spfc", "formacao_spfc"):
            if p[campo] is not None:
                motivo = _texto_invalido(p[campo])
                if motivo is not None:
                    erros.append(f"{_fmt_partida(idx, p)} campo '{campo}' inválido: {motivo}")

        adv = p["adversario"]
        if isinstance(adv, str):
            chave_adv = _normalizar_chave_texto(adv)
            if chave_adv == "sao paulo":
                erros.append(f"{_fmt_partida(idx, p)} São Paulo aparece listado como próprio adversário")
            ufs_por_adversario[adv].add(p["adversario_estado"])
            nomes_por_chave_norm[chave_adv].add(adv)

    for adv, ufs in sorted(ufs_por_adversario.items()):
        if len(ufs) > 1:
            erros.append(f"Adversário '{adv}' aparece associado a múltiplas UFs: {sorted(ufs)}")

    for chave, variantes in sorted(nomes_por_chave_norm.items()):
        if len(variantes) > 1:
            erros.append(f"Adversário com múltiplas grafias normalizadas ({chave!r}): {sorted(variantes)}")

    assert not erros, _formatar_erros(f"[{nome}] Violações de domínio categórico ou higiene textual", erros)


def test_rodadas_e_estrutura_temporadas(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """Valida limites de rodadas por edição e contagem de jogos em temporadas encerradas e atual."""
    nome, payload = dataset_partidas
    partidas = payload["partidas"]
    temporada_fim = payload["metadata"]["temporada_fim"]
    por_temporada: dict[int, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    erros: list[str] = []

    for idx, p in enumerate(partidas):
        temp = p["temporada"]
        rod = p["rodada"]
        max_rod = _max_rodadas_temporada(temp)
        if not _eh_inteiro(rod) or not (1 <= rod <= max_rod):
            erros.append(f"{_fmt_partida(idx, p)} rodada {rod!r} fora da faixa 1..{max_rod}")
        por_temporada[temp].append((idx, p))

    for temp, itens in sorted(por_temporada.items()):
        esperado = _max_rodadas_temporada(temp)
        if temp < temporada_fim:
            if len(itens) != esperado:
                erros.append(
                    f"Temporada encerrada {temp} tem {len(itens)} partidas (esperado exatamente {esperado})"
                )
        else:
            if not (1 <= len(itens) <= esperado):
                erros.append(
                    f"Temporada {temp} tem {len(itens)} partidas (esperado entre 1 e {esperado})"
                )

    assert not erros, _formatar_erros(f"[{nome}] Inconsistência na estrutura de rodadas/temporadas", erros)


def test_unicidade_id_e_chaves_compostas_campeonato(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """
    Garante ausência de jogos duplicados por:
    - `id`
    - `(temporada, rodada)` (1 jogo por rodada)
    - `(data, adversario)` (não enfrentar o mesmo adversário duas vezes na mesma data)
    - `(temporada, mando, adversario)` (pontos corridos: no máximo 1 Casa e 1 Fora por adversário/ano)
    """
    nome, payload = dataset_partidas
    partidas = payload["partidas"]
    erros: list[str] = []

    indices_por_id: dict[int, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    indices_por_temp_rod: dict[tuple[int, int], list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    indices_por_data_adv: dict[tuple[str, str], list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    indices_por_confronto: dict[tuple[int, str, str], list[tuple[int, dict[str, Any]]]] = defaultdict(list)

    for idx, p in enumerate(partidas):
        indices_por_id[p["id"]].append((idx, p))
        indices_por_temp_rod[(p["temporada"], p["rodada"])].append((idx, p))
        indices_por_data_adv[(p["data"], p["adversario"])].append((idx, p))
        indices_por_confronto[(p["temporada"], p["mando"], p["adversario"])].append((idx, p))

    for chave, grupo in indices_por_id.items():
        if len(grupo) > 1:
            desc = " ; ".join(_fmt_partida(i, r) for i, r in grupo)
            erros.append(f"ID duplicado ({chave}): {desc}")

    for chave, grupo in indices_por_temp_rod.items():
        if len(grupo) > 1:
            desc = " ; ".join(_fmt_partida(i, r) for i, r in grupo)
            erros.append(f"Rodada duplicada {chave}: {desc}")

    for chave, grupo in indices_por_data_adv.items():
        if len(grupo) > 1:
            desc = " ; ".join(_fmt_partida(i, r) for i, r in grupo)
            erros.append(f"Chave (data, adversario) duplicada {chave}: {desc}")

    for chave, grupo in indices_por_confronto.items():
        if len(grupo) > 1:
            desc = " ; ".join(_fmt_partida(i, r) for i, r in grupo)
            erros.append(f"Chave (temporada, mando, adversario) duplicada {chave}: {desc}")

    assert not erros, _formatar_erros(f"[{nome}] Registros duplicados encontrados", erros)


def test_unicidade_data_clube_nao_joga_duas_vezes_no_mesmo_dia(
    dataset_partidas: tuple[str, dict[str, Any]],
) -> None:
    """
    Regra de negócio de futebol: o São Paulo FC não pode disputar duas partidas
    oficiais do Campeonato Brasileiro Série A na mesma data.
    """
    nome, payload = dataset_partidas
    por_data: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for idx, p in enumerate(payload["partidas"]):
        por_data[p["data"]].append((idx, p))

    erros: list[str] = []
    for data_jogo, grupo in sorted(por_data.items()):
        if len(grupo) > 1:
            detalhes = " ; ".join(
                f"{_fmt_partida(i, r)} hora={r.get('hora')} arena={r.get('arena')!r} "
                f"placar={r.get('gols_pro')}x{r.get('gols_contra')}"
                for i, r in grupo
            )
            erros.append(f"Data duplicada {data_jogo} ({len(grupo)} jogos): {detalhes}")

    assert not erros, _formatar_erros(
        f"[{nome}] Clube com múltiplos jogos na mesma data", erros
    )


# ===========================================================================
# 4. Consistência interna de metadata e integridade entre arquivos
# ===========================================================================


def test_consistencia_metadata_com_partidas(dataset_partidas: tuple[str, dict[str, Any]]) -> None:
    """Confirma que todos os totalizadores e listas de `metadata` batem exatamente com `partidas`."""
    nome, payload = dataset_partidas
    meta = payload["metadata"]
    partidas = payload["partidas"]

    assert meta["total_partidas"] == len(partidas), (
        f"[{nome}] metadata.total_partidas={meta['total_partidas']} != len(partidas)={len(partidas)}"
    )

    temporadas = [p["temporada"] for p in partidas]
    assert meta["temporada_inicio"] == min(temporadas), (
        f"[{nome}] metadata.temporada_inicio={meta['temporada_inicio']} != {min(temporadas)}"
    )
    assert meta["temporada_fim"] == max(temporadas), (
        f"[{nome}] metadata.temporada_fim={meta['temporada_fim']} != {max(temporadas)}"
    )

    esperado_cartoes = sorted(
        {
            p["temporada"]
            for p in partidas
            if p["cartoes_amarelos"] is not None and p["cartoes_vermelhos"] is not None
        }
    )
    esperado_gols = sorted({p["temporada"] for p in partidas if isinstance(p["gols"], list)})
    esperado_stats = sorted({p["temporada"] for p in partidas if p["chutes"] is not None})

    assert meta["temporadas_com_cartoes"] == esperado_cartoes, (
        f"[{nome}] metadata.temporadas_com_cartoes={meta['temporadas_com_cartoes']} != {esperado_cartoes}"
    )
    assert meta["temporadas_com_gols"] == esperado_gols, (
        f"[{nome}] metadata.temporadas_com_gols={meta['temporadas_com_gols']} != {esperado_gols}"
    )
    assert meta["temporadas_com_estatisticas"] == esperado_stats, (
        f"[{nome}] metadata.temporadas_com_estatisticas={meta['temporadas_com_estatisticas']} != {esperado_stats}"
    )


def test_consistencia_entre_historico_producao_e_meta(
    dataset_producao: dict[str, Any],
    dataset_historico: dict[str, Any],
    meta_sincronizacao: dict[str, Any],
) -> None:
    """
    Garante que:
    1. A base histórica congelada (2003–2025) está preservada intacta no dataset de produção.
    2. Todos os contadores e datas de `docs/data/meta.json` batem exatamente com os dados.
    """
    partidas_prod = dataset_producao["partidas"]
    partidas_hist = dataset_historico["partidas"]
    temp_fim_hist = dataset_historico["metadata"]["temporada_fim"]

    slice_hist_em_prod = [p for p in partidas_prod if p["temporada"] <= temp_fim_hist]
    assert len(slice_hist_em_prod) == len(partidas_hist), (
        f"Dataset de produção tem {len(slice_hist_em_prod)} partidas até {temp_fim_hist}, "
        f"mas histórico congelado tem {len(partidas_hist)}"
    )
    assert slice_hist_em_prod == partidas_hist, (
        f"Partidas até {temp_fim_hist} em docs/data/spfc_pontos_corridos.json divergem "
        "da base histórica congelada data/historico_2003_2025.json"
    )

    temp_atual = meta_sincronizacao["temporada_atual"]
    jogos_temp_atual = sum(1 for p in partidas_prod if p["temporada"] == temp_atual)
    jogos_hist_esperado = sum(1 for p in partidas_prod if p["temporada"] < temp_atual)
    ultima_data = max(p["data"] for p in partidas_prod)

    assert meta_sincronizacao["total_jogos"] == len(partidas_prod), (
        f"[meta.json] total_jogos={meta_sincronizacao['total_jogos']} != {len(partidas_prod)}"
    )
    assert meta_sincronizacao["jogos_historico"] == jogos_hist_esperado, (
        f"[meta.json] jogos_historico={meta_sincronizacao['jogos_historico']} != {jogos_hist_esperado}"
    )
    assert meta_sincronizacao["jogos_temporada_atual"] == jogos_temp_atual, (
        f"[meta.json] jogos_temporada_atual={meta_sincronizacao['jogos_temporada_atual']} != {jogos_temp_atual}"
    )
    assert (
        meta_sincronizacao["jogos_historico"] + meta_sincronizacao["jogos_temporada_atual"]
        == meta_sincronizacao["total_jogos"]
    ), (
        f"[meta.json] jogos_historico({meta_sincronizacao['jogos_historico']}) + "
        f"jogos_temporada_atual({meta_sincronizacao['jogos_temporada_atual']}) != "
        f"total_jogos({meta_sincronizacao['total_jogos']})"
    )
    assert meta_sincronizacao["temporada_inicio"] == dataset_producao["metadata"]["temporada_inicio"], (
        f"[meta.json] temporada_inicio={meta_sincronizacao['temporada_inicio']} "
        f"!= {dataset_producao['metadata']['temporada_inicio']}"
    )
    assert meta_sincronizacao["temporada_fim"] == dataset_producao["metadata"]["temporada_fim"], (
        f"[meta.json] temporada_fim={meta_sincronizacao['temporada_fim']} "
        f"!= {dataset_producao['metadata']['temporada_fim']}"
    )
    assert meta_sincronizacao["ultima_partida_data"] == ultima_data, (
        f"[meta.json] ultima_partida_data={meta_sincronizacao['ultima_partida_data']!r} != {ultima_data!r}"
    )


# ===========================================================================
# 5. Testes offline da ingestão incremental (football-data.org) e Próximo Jogo
# ===========================================================================


def _importar_modulos_etl() -> tuple[Any, Any]:
    import sys

    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    from etl import atualizar_jogos_api, processar_dados

    return atualizar_jogos_api, processar_dados


def _validar_schema_proximo_jogo(payload: dict[str, Any]) -> None:
    """Valida todas as invariantes de schema e domínio de `proximo_jogo.json`."""
    assert isinstance(payload, dict), "Raiz de proximo_jogo.json deve ser objeto JSON."
    assert set(payload.keys()) == PROXIMO_JOGO_ROOT_KEYS, (
        f"Chaves raiz divergentes em proximo_jogo.json: {sorted(payload.keys())}"
    )

    motivo_at = _texto_invalido(payload["atualizado_em"])
    assert motivo_at is None, f"Campo 'atualizado_em' inválido: {motivo_at}"
    dt_at = datetime.fromisoformat(payload["atualizado_em"])
    assert dt_at.tzinfo is not None, "'atualizado_em' deve incluir fuso horário (ex.: -03:00)."

    tem_proximo = payload["tem_proximo_jogo"]
    proximo = payload["proximo_jogo"]
    assert isinstance(tem_proximo, bool), "'tem_proximo_jogo' deve ser bool."

    if not tem_proximo:
        assert proximo is None, "Quando tem_proximo_jogo=False, proximo_jogo deve ser None."
        return

    assert isinstance(proximo, dict), "Quando tem_proximo_jogo=True, proximo_jogo deve ser dict."
    assert set(proximo.keys()) == PROXIMO_JOGO_ITEM_KEYS, (
        f"Chaves de proximo_jogo divergentes: {sorted(proximo.keys())}"
    )

    assert isinstance(proximo["data"], str) and RE_DATA_ISO.fullmatch(proximo["data"]), (
        f"data fora do padrão YYYY-MM-DD: {proximo['data']!r}"
    )
    date.fromisoformat(proximo["data"])

    horario_definido = proximo["horario_definido"]
    hora = proximo["hora"]
    assert isinstance(horario_definido, bool), "'horario_definido' deve ser bool."
    if horario_definido:
        assert isinstance(hora, str) and RE_HORA.fullmatch(hora), (
            f"hora inválida com horario_definido=True: {hora!r}"
        )
        hh, mm = map(int, hora.split(":"))
        assert 0 <= hh <= 23 and 0 <= mm <= 59, f"hora fora de 00:00..23:59: {hora!r}"
    else:
        assert hora is None, f"Quando horario_definido=False, hora deve ser None (obtido {hora!r})."

    motivo_adv = _texto_invalido(proximo["adversario"])
    assert motivo_adv is None, f"adversario inválido: {motivo_adv}"
    assert _normalizar_chave_texto(proximo["adversario"]) != "sao paulo", (
        "São Paulo não pode constar como próprio adversário em proximo_jogo.json."
    )

    assert proximo["mando"] in MANDOS_VALIDOS, f"mando inválido: {proximo['mando']!r}"
    assert proximo["status"] in PROXIMO_JOGO_STATUS_VALIDOS, (
        f"status fora de {sorted(PROXIMO_JOGO_STATUS_VALIDOS)}: {proximo['status']!r}"
    )
    assert proximo["competicao"] == "Brasileirão Série A", (
        f"competicao inesperada: {proximo['competicao']!r}"
    )
    assert _eh_inteiro(proximo["temporada"]) and proximo["temporada"] >= 2003, (
        f"temporada inválida: {proximo['temporada']!r}"
    )
    if proximo["rodada"] is not None:
        max_rod = _max_rodadas_temporada(proximo["temporada"])
        assert _eh_inteiro(proximo["rodada"]) and 1 <= proximo["rodada"] <= max_rod, (
            f"rodada fora de 1..{max_rod}: {proximo['rodada']!r}"
        )


def test_api_conversao_fuso_utc_para_brasilia() -> None:
    """
    Valida offline a conversão UTC -> America/Sao_Paulo:
    - Jogo noturno 00:30:00Z vira 21:30 do dia anterior em Brasília.
    - Jogo TIMED 00:00:00Z (21h BRT confirmado) vira 21:00 do dia anterior.
    - Jogo SCHEDULED 00:00:00Z (horário não definido pela CBF) preserva a data
      sem recuar um dia e marca hora=None / horario_definido=False.
    - Jogo vespertino 19:00:00Z vira 16:00 do mesmo dia.
    """
    api_mod, _ = _importar_modulos_etl()

    # 21h30 BRT no dia 15/08 vem como 00:30:00Z do dia 16/08 em UTC
    data_fin, hora_fin, def_fin = api_mod.converter_data_hora_api(
        "2026-08-16T00:30:00Z", "FINISHED"
    )
    assert (data_fin, hora_fin, def_fin) == ("2026-08-15", "21:30", True)

    # TIMED às 00:30:00Z também deve recuar para 21:30 do dia anterior
    data_t1, hora_t1, def_t1 = api_mod.converter_data_hora_api(
        "2026-11-26T00:30:00Z", "TIMED"
    )
    assert (data_t1, hora_t1, def_t1) == ("2026-11-25", "21:30", True)

    # TIMED às 00:00:00Z é jogo confirmado às 21:00 BRT do dia anterior
    data_t2, hora_t2, def_t2 = api_mod.converter_data_hora_api(
        "2026-11-26T00:00:00Z", "TIMED"
    )
    assert (data_t2, hora_t2, def_t2) == ("2026-11-25", "21:00", True)

    # SCHEDULED com 00:00:00Z (horário a definir pela CBF): NÃO recua para o dia anterior!
    data_sch, hora_sch, def_sch = api_mod.converter_data_hora_api(
        "2026-12-06T00:00:00Z", "SCHEDULED"
    )
    assert (data_sch, hora_sch, def_sch) == ("2026-12-06", None, False)

    # Jogo vespertino no mesmo dia
    data_vesp, hora_vesp, def_vesp = api_mod.converter_data_hora_api(
        "2026-11-22T19:00:00Z", "TIMED"
    )
    assert (data_vesp, hora_vesp, def_vesp) == ("2026-11-22", "16:00", True)


def test_api_normalizacao_clubes_e_separacao_status(
    dataset_producao: dict[str, Any],
) -> None:
    """
    Valida offline:
    - O de-para MAPA_TIMES_API mapeia nomes oficiais da football-data.org para
      exatamente os nomes usados na base histórica (sem criar duplicatas).
    - Partidas IN_PLAY/PAUSED/POSTPONED/SUSPENDED/CANCELLED são ignoradas.
    - A seleção do próximo jogo escolhe a partida futura mais próxima e trata fim de campeonato.
    """
    api_mod, _ = _importar_modulos_etl()
    adversarios_base = {p["adversario"] for p in dataset_producao["partidas"]}

    casos_de_para = [
        ({"name": "CA Mineiro", "shortName": "Mineiro"}, "Atlético-MG"),
        ({"name": "CA Paranaense", "shortName": "Paranaense"}, "Athletico-PR"),
        ({"name": "CR Flamengo", "shortName": "Flamengo"}, "Flamengo"),
        ({"name": "SE Palmeiras", "shortName": "Palmeiras"}, "Palmeiras"),
        ({"name": "SC Corinthians Paulista", "shortName": "Corinthians"}, "Corinthians"),
        ({"name": "CR Vasco da Gama", "shortName": "Vasco da Gama"}, "Vasco"),
        ({"name": "RB Bragantino", "shortName": "Bragantino"}, "Bragantino"),
        ({"name": "Botafogo FR", "shortName": "Botafogo"}, "Botafogo"),
        ({"name": "EC Vitória", "shortName": "Vitória"}, "Vitória"),
        ({"name": "Clube do Remo", "shortName": "Remo"}, "Remo"),
        ({"name": "Mirassol FC", "shortName": "Mirassol"}, "Mirassol"),
        ({"name": "Chapecoense AF", "shortName": "Chapecoense"}, "Chapecoense"),
    ]
    for team_obj, esperado in casos_de_para:
        normalizado, mapeado = api_mod.normalizar_clube_api(team_obj)
        assert mapeado is True and normalizado == esperado
        assert esperado in adversarios_base, f"'{esperado}' deveria existir na base do projeto."

    spfc_team = {"id": 1776, "name": "São Paulo FC", "shortName": "São Paulo"}
    adv_bota = {"id": 1770, "name": "Botafogo FR", "shortName": "Botafogo"}
    adv_remo = {"id": 9991, "name": "Clube do Remo", "shortName": "Remo"}

    # Status em andamento/adiados não entram como partida encerrada nem como próximo jogo
    for status_ignorado in ("IN_PLAY", "PAUSED", "POSTPONED", "SUSPENDED", "CANCELLED"):
        match_ign = {
            "id": 700001,
            "utcDate": "2026-11-25T21:30:00Z",
            "status": status_ignorado,
            "matchday": 36,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": adv_bota,
            "awayTeam": spfc_team,
            "score": {"fullTime": {"home": 1, "away": 1}},
        }
        assert api_mod.extrair_partida_encerrada_api(match_ign) is None

    # Seleção do próximo jogo futuro mais próximo
    ref_brt = datetime(2026, 11, 22, 14, 0, tzinfo=api_mod.BRT)
    matches_mock = [
        {
            "id": 700010,
            "utcDate": "2026-11-20T00:30:00Z",
            "status": "FINISHED",
            "matchday": 35,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": spfc_team,
            "awayTeam": {"id": 1765, "name": "Fluminense FC", "shortName": "Fluminense"},
            "score": {"fullTime": {"home": 0, "away": 1}},
        },
        {
            "id": 700012,
            "utcDate": "2026-12-02T00:00:00Z",
            "status": "SCHEDULED",
            "matchday": 37,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": spfc_team,
            "awayTeam": adv_remo,
            "score": {"fullTime": {"home": None, "away": None}},
        },
        {
            "id": 700011,
            "utcDate": "2026-11-26T00:30:00Z",
            "status": "TIMED",
            "matchday": 36,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": adv_bota,
            "awayTeam": spfc_team,
            "score": {"fullTime": {"home": None, "away": None}},
        },
    ]

    proximo = api_mod.selecionar_proximo_jogo(matches_mock, agora_brt=ref_brt)
    assert proximo is not None
    assert proximo["rodada"] == 36
    assert proximo["data"] == "2026-11-25"
    assert proximo["hora"] == "21:30"
    assert proximo["horario_definido"] is True
    assert proximo["adversario"] == "Botafogo"
    assert proximo["mando"] == "Fora"
    assert proximo["status"] == "TIMED"

    payload_com_jogo = api_mod.montar_payload_proximo_jogo(proximo, agora_brt=ref_brt)
    _validar_schema_proximo_jogo(payload_com_jogo)

    # Caso SCHEDULED com 00:00:00Z (somente R37 futura)
    proximo_sch = api_mod.selecionar_proximo_jogo([matches_mock[1]], agora_brt=ref_brt)
    assert proximo_sch is not None
    assert proximo_sch["data"] == "2026-12-02"
    assert proximo_sch["hora"] is None
    assert proximo_sch["horario_definido"] is False
    _validar_schema_proximo_jogo(
        api_mod.montar_payload_proximo_jogo(proximo_sch, agora_brt=ref_brt)
    )

    # Fim de campeonato (apenas jogos encerrados) -> tem_proximo_jogo=False
    proximo_vazio = api_mod.selecionar_proximo_jogo([matches_mock[0]], agora_brt=ref_brt)
    assert proximo_vazio is None
    payload_sem_jogo = api_mod.montar_payload_proximo_jogo(proximo_vazio, agora_brt=ref_brt)
    assert payload_sem_jogo["tem_proximo_jogo"] is False
    assert payload_sem_jogo["proximo_jogo"] is None
    _validar_schema_proximo_jogo(payload_sem_jogo)


def test_merge_idempotente_e_deduplicacao_api(
    dataset_historico: dict[str, Any],
) -> None:
    """
    Valida offline a idempotência e a deduplicação determinística do merge:
    1. `mesclar_incremental_api` rodando duas vezes com os mesmos jogos não duplica
       registros e preserva temporadas anteriores.
    2. `mesclar_partidas_deterministico` em `etl/processar_dados.py`:
       - Deduplica sobreposição com a base histórica Kaggle (2025 R38) preservando o histórico.
       - Insere novos jogos da API preenchendo todas as 29 chaves (inclusive `arena` padrão).
       - Rodar o merge duas vezes seguidas produz exatamente o mesmo resultado (0 duplicatas).
    """
    api_mod, etl_mod = _importar_modulos_etl()

    hist_sample = dataset_historico["partidas"][-3:]  # últimas 3 partidas de 2025 (inclui R38)
    ultima_hist = hist_sample[-1]

    # Simula 1 jogo sobreposto ao Kaggle (mesma temporada/rodada) + 2 jogos novos em 2026
    jogo_sobreposto_2025 = {
        "id": 555001,
        "temporada": ultima_hist["temporada"],
        "rodada": ultima_hist["rodada"],
        "data": ultima_hist["data"],
        "hora": "16:00",
        "mando": ultima_hist["mando"],
        "adversario": ultima_hist["adversario"],
        "adversario_estado": ultima_hist["adversario_estado"],
        "arena": None,
        "gols_pro": ultima_hist["gols_pro"],
        "gols_contra": ultima_hist["gols_contra"],
    }
    jogo_novo_fora = {
        "id": 555036,
        "temporada": 2026,
        "rodada": 36,
        "data": "2026-11-25",
        "hora": "21:30",
        "mando": "Fora",
        "adversario": "Botafogo",
        "adversario_estado": None,
        "arena": None,
        "gols_pro": 2,
        "gols_contra": 1,
    }
    jogo_novo_casa = {
        "id": 555037,
        "temporada": 2026,
        "rodada": 37,
        "data": "2026-12-02",
        "hora": "20:00",
        "mando": "Casa",
        "adversario": "Remo",
        "adversario_estado": None,
        "arena": None,
        "gols_pro": 3,
        "gols_contra": 0,
    }
    lote_api = [jogo_sobreposto_2025, jogo_novo_fora, jogo_novo_casa]

    # 1. Idempotência no arquivo incremental da API
    inc_1, novos_1, atual_1 = api_mod.mesclar_incremental_api([], lote_api)
    assert len(inc_1) == 3 and novos_1 == 3 and atual_1 == 0

    inc_2, novos_2, atual_2 = api_mod.mesclar_incremental_api(inc_1, lote_api)
    assert inc_2 == inc_1
    assert novos_2 == 0 and atual_2 == 0

    # 2. Primeira execução do merge no processar_dados.py
    merged_1, stats_1 = etl_mod.mesclar_partidas_deterministico(
        partidas_historicas=hist_sample,
        partidas_api=lote_api,
    )
    assert len(merged_1) == len(hist_sample) + 2
    assert stats_1["novos_da_api"] == 2
    assert stats_1["duplicatas_ignoradas"] == 1

    # Histórico 2025 intacto (não foi sobrescrito pelo registro da API)
    assert merged_1[: len(hist_sample)] == hist_sample

    # Novos registros possuem todas as 29 chaves, arena preenchida e derivados coerentes
    for novo in merged_1[len(hist_sample) :]:
        assert set(novo.keys()) == PARTIDA_ALL_FIELDS
        assert novo["arena"] and _texto_invalido(novo["arena"]) is None
        assert novo["adversario_estado"] in UFS_BRASIL
        assert novo["saldo_gols"] == novo["gols_pro"] - novo["gols_contra"]
    assert merged_1[-2]["arena"] == "Estádio Nilton Santos, Rio de Janeiro"
    assert merged_1[-1]["arena"] == "MorumBIS, São Paulo"
    assert merged_1[-1]["resultado"] == "V" and merged_1[-1]["pontos"] == 3

    # 3. Segunda execução do merge (repassando os pós-histórico + mesmo lote da API) -> 100% idempotente
    posteriores_1 = [p for p in merged_1 if p["temporada"] > 2025]
    merged_2, stats_2 = etl_mod.mesclar_partidas_deterministico(
        partidas_historicas=hist_sample,
        partidas_api=lote_api,
        partidas_posteriores_existentes=posteriores_1,
    )
    assert merged_2 == merged_1
    assert stats_2["novos_da_api"] == 0
    assert stats_2["duplicatas_ignoradas"] == len(lote_api)

    # 4. Mesmo passando o lote da API duplicado na mesma chamada, não duplica nada
    merged_dup, stats_dup = etl_mod.mesclar_partidas_deterministico(
        partidas_historicas=hist_sample,
        partidas_api=lote_api + lote_api,
    )
    assert merged_dup == merged_1
    assert stats_dup["novos_da_api"] == 2
    assert len({p["id"] for p in merged_dup}) == len(merged_dup)


def test_schema_proximo_jogo_quando_presente() -> None:
    """
    Valida o contrato de schema de `proximo_jogo.json` (via escrita/leitura JSON
    estrita offline) e, quando `docs/data/proximo_jogo.json` existir na pasta de
    produção, valida integralmente o arquivo real.
    """
    import tempfile

    api_mod, _ = _importar_modulos_etl()

    # Sempre exercita serialização atômica + leitura estrita + validação de schema offline
    with tempfile.TemporaryDirectory() as tmp_dir:
        amostra_path = Path(tmp_dir) / "proximo_jogo.json"
        amostra_payload = api_mod.montar_payload_proximo_jogo(
            {
                "data": "2026-11-25",
                "hora": "21:30",
                "horario_definido": True,
                "adversario": "Botafogo",
                "mando": "Fora",
                "rodada": 36,
                "temporada": 2026,
                "competicao": "Brasileirão Série A",
                "status": "TIMED",
            },
            agora_brt=datetime(2026, 11, 22, 14, 0, tzinfo=api_mod.BRT),
        )
        api_mod.salvar_json_atomico(amostra_payload, amostra_path)
        _validar_schema_proximo_jogo(_carregar_json_estrito(amostra_path))

    # Se o arquivo real existir em docs/data/, valida rigorosamente o arquivo de produção
    if PROXIMO_JOGO_PATH.exists():
        raw = PROXIMO_JOGO_PATH.read_bytes()
        assert len(raw) > 0, "docs/data/proximo_jogo.json está vazio."
        assert not raw.startswith(b"\xef\xbb\xbf"), "docs/data/proximo_jogo.json contém BOM UTF-8."
        assert "\ufffd" not in raw.decode("utf-8"), "docs/data/proximo_jogo.json contém U+FFFD."

        payload_real = _carregar_json_estrito(PROXIMO_JOGO_PATH)
        _validar_schema_proximo_jogo(payload_real)


def test_sincronizacao_etl_offline_e_com_api_incremental(
    dataset_historico: dict[str, Any],
) -> None:
    """
    Valida ponta a ponta (em diretório temporário) que `sincronizar_producao_com_historico`:
    - Funciona normalmente offline quando `jogos_api_brasileirao.json` não existe.
    - Quando `jogos_api_brasileirao.json` existe, faz merge determinístico sem duplicatas
      e atualiza `meta.json` com contadores consistentes.
    - É idempotente em execuções repetidas.
    """
    import tempfile

    api_mod, etl_mod = _importar_modulos_etl()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        hist_dst = tmp / "historico_2003_2025.json"
        prod_dst = tmp / "spfc_pontos_corridos.json"
        meta_dst = tmp / "meta.json"
        api_src = tmp / "jogos_api_brasileirao.json"

        # 1. Execução offline (sem arquivo da API)
        payload_off, stats_off = etl_mod.sincronizar_producao_com_historico(
            dataset_historico,
            destino_historico=hist_dst,
            destino_producao=prod_dst,
            caminho_api=api_src,
            destino_meta=meta_dst,
        )
        assert stats_off["arquivo_api_existe"] is False
        assert len(payload_off["partidas"]) == len(dataset_historico["partidas"])
        meta_off = _carregar_json_estrito(meta_dst)
        assert meta_off["total_jogos"] == len(dataset_historico["partidas"])

        # 2. Cria arquivo incremental da API com 1 jogo sobreposto (2025 R38) + 1 novo (2026 R1)
        ultima_hist = dataset_historico["partidas"][-1]
        api_mod.salvar_json_atomico(
            {
                "metadata": {"fonte": "football-data.org (v4 / BSA)", "total_partidas": 2},
                "partidas": [
                    {
                        "id": 600001,
                        "temporada": ultima_hist["temporada"],
                        "rodada": ultima_hist["rodada"],
                        "data": ultima_hist["data"],
                        "hora": "16:00",
                        "mando": ultima_hist["mando"],
                        "adversario": ultima_hist["adversario"],
                        "adversario_estado": ultima_hist["adversario_estado"],
                        "arena": None,
                        "gols_pro": ultima_hist["gols_pro"],
                        "gols_contra": ultima_hist["gols_contra"],
                    },
                    {
                        "id": 600002,
                        "temporada": 2026,
                        "rodada": 1,
                        "data": "2026-01-28",
                        "hora": "21:30",
                        "mando": "Casa",
                        "adversario": "Flamengo",
                        "adversario_estado": "RJ",
                        "arena": None,
                        "gols_pro": 2,
                        "gols_contra": 1,
                    },
                ],
            },
            api_src,
        )

        payload_1, stats_1 = etl_mod.sincronizar_producao_com_historico(
            dataset_historico,
            destino_historico=hist_dst,
            destino_producao=prod_dst,
            caminho_api=api_src,
            destino_meta=meta_dst,
        )
        assert stats_1["arquivo_api_existe"] is True
        assert stats_1["novos_da_api"] == 1
        assert stats_1["duplicatas_ignoradas"] == 1
        assert len(payload_1["partidas"]) == len(dataset_historico["partidas"]) + 1
        meta_1 = _carregar_json_estrito(meta_dst)
        assert meta_1["total_jogos"] == len(payload_1["partidas"])
        assert meta_1["jogos_temporada_atual"] == 1
        assert meta_1["jogos_historico"] == len(dataset_historico["partidas"])
        assert meta_1["ultima_partida_data"] == "2026-01-28"

        # 3. Segunda execução (idempotente — não reescreve arquivos nem muda timestamps)
        bytes_prod_antes = prod_dst.read_bytes()
        bytes_meta_antes = meta_dst.read_bytes()
        payload_2, stats_2 = etl_mod.sincronizar_producao_com_historico(
            dataset_historico,
            destino_historico=hist_dst,
            destino_producao=prod_dst,
            caminho_api=api_src,
            destino_meta=meta_dst,
        )
        assert stats_2["novos_da_api"] == 0
        assert stats_2["duplicatas_ignoradas"] == 2
        assert payload_2["partidas"] == payload_1["partidas"]
        assert prod_dst.read_bytes() == bytes_prod_antes
        assert meta_dst.read_bytes() == bytes_meta_antes


def test_api_idempotencia_contra_commits_fantasma(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Valida offline que `atualizar_jogos_api` evita commits fantasma:
    1. Sem mudança nos encerrados nem em `(tem_proximo_jogo, proximo_jogo)`,
       NÃO reescreve `proximo_jogo.json` nem `jogos_api_brasileirao.json` apenas
       para atualizar `atualizado_em`.
    2. Quando muda horário/status do próximo jogo, atualiza `proximo_jogo.json`
       (inclusive `atualizado_em`) sem tocar em `jogos_api_brasileirao.json`.
    3. Quando entra novo jogo encerrado na base, atualiza ambos os arquivos e
       `atualizado_em` mesmo que o próximo jogo permaneça idêntico.
    4. Em transição para fim de campeonato (`tem_proximo_jogo=False`), grava uma
       vez e permanece idempotente nas execuções seguintes.
    """
    import tempfile

    api_mod, _ = _importar_modulos_etl()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        inc_path = tmp / "jogos_api_brasileirao.json"
        prox_path = tmp / "proximo_jogo.json"

        spfc_team = {"id": 1776, "name": "São Paulo FC", "shortName": "São Paulo"}
        adv_flu = {"id": 1765, "name": "Fluminense FC", "shortName": "Fluminense"}
        adv_bota = {"id": 1770, "name": "Botafogo FR", "shortName": "Botafogo"}
        adv_remo = {"id": 9991, "name": "Clube do Remo", "shortName": "Remo"}

        jogo_r35_encerrado = {
            "id": 800035,
            "utcDate": "2026-11-20T00:30:00Z",
            "status": "FINISHED",
            "matchday": 35,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": spfc_team,
            "awayTeam": adv_flu,
            "score": {"fullTime": {"home": 2, "away": 0}},
        }
        jogo_r36_scheduled = {
            "id": 800036,
            "utcDate": "2026-11-24T00:00:00Z",
            "status": "SCHEDULED",
            "matchday": 36,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": adv_bota,
            "awayTeam": spfc_team,
            "score": {"fullTime": {"home": None, "away": None}},
        }

        matches_correntes: list[dict[str, Any]] = [jogo_r35_encerrado, jogo_r36_scheduled]
        monkeypatch.setattr(api_mod, "obter_api_key", lambda: "token-teste-offline")
        monkeypatch.setattr(api_mod, "consultar_partidas_bsa", lambda token, temporada=None: list(matches_correntes))

        # 1. Primeira execução: cria ambos os arquivos em t1
        t1 = datetime(2026, 11, 22, 3, 0, 0, tzinfo=api_mod.BRT)
        res_1 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t1,
        )
        assert res_1["incremental_gravado"] is True
        assert res_1["proximo_jogo_gravado"] is True
        bytes_inc_t1 = inc_path.read_bytes()
        bytes_prox_t1 = prox_path.read_bytes()
        prox_t1 = _carregar_json_estrito(prox_path)
        _validar_schema_proximo_jogo(prox_t1)
        assert prox_t1["atualizado_em"] == t1.isoformat(timespec="seconds")
        assert prox_t1["proximo_jogo"]["status"] == "SCHEDULED"
        assert prox_t1["proximo_jogo"]["horario_definido"] is False

        # 2. Segunda execução (t2 posterior, mesma resposta da API): ZERO reescrita
        t2 = datetime(2026, 11, 23, 3, 0, 0, tzinfo=api_mod.BRT)
        res_2 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t2,
        )
        assert res_2["novos_adicionados"] == 0
        assert res_2["atualizados"] == 0
        assert res_2["incremental_gravado"] is False
        assert res_2["proximo_jogo_gravado"] is False
        assert inc_path.read_bytes() == bytes_inc_t1
        assert prox_path.read_bytes() == bytes_prox_t1
        assert _carregar_json_estrito(prox_path)["atualizado_em"] == t1.isoformat(timespec="seconds")

        # 3. Mudança real de status/horário no próximo jogo (SCHEDULED -> TIMED 20:00 BRT):
        #    reescreve apenas proximo_jogo.json; mantém jogos_api_brasileirao.json intacto.
        jogo_r36_timed = dict(jogo_r36_scheduled, utcDate="2026-11-24T23:00:00Z", status="TIMED")
        matches_correntes = [jogo_r35_encerrado, jogo_r36_timed]
        t3 = datetime(2026, 11, 23, 15, 0, 0, tzinfo=api_mod.BRT)
        res_3 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t3,
        )
        assert res_3["incremental_gravado"] is False
        assert res_3["proximo_jogo_gravado"] is True
        assert inc_path.read_bytes() == bytes_inc_t1
        prox_t3 = _carregar_json_estrito(prox_path)
        _validar_schema_proximo_jogo(prox_t3)
        assert prox_t3["atualizado_em"] == t3.isoformat(timespec="seconds")
        assert prox_t3["proximo_jogo"]["status"] == "TIMED"
        assert prox_t3["proximo_jogo"]["hora"] == "20:00"
        assert prox_t3["proximo_jogo"]["horario_definido"] is True

        # 4. Novo jogo encerrado (jogo adiado da R34 finalizado), mesmo próximo jogo R36:
        #    reescreve ambos os arquivos e atualiza `atualizado_em` em ambos.
        jogo_r34_adiado_encerrado = {
            "id": 800034,
            "utcDate": "2026-11-16T22:00:00Z",
            "status": "FINISHED",
            "matchday": 34,
            "season": {"startDate": "2026-01-28"},
            "homeTeam": spfc_team,
            "awayTeam": adv_remo,
            "score": {"fullTime": {"home": 3, "away": 1}},
        }
        matches_correntes = [jogo_r34_adiado_encerrado, jogo_r35_encerrado, jogo_r36_timed]
        t4 = datetime(2026, 11, 24, 3, 0, 0, tzinfo=api_mod.BRT)
        res_4 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t4,
        )
        assert res_4["novos_adicionados"] == 1
        assert res_4["incremental_gravado"] is True
        assert res_4["proximo_jogo_gravado"] is True
        assert _carregar_json_estrito(inc_path)["metadata"]["atualizado_em"] == t4.isoformat(timespec="seconds")
        assert _carregar_json_estrito(prox_path)["atualizado_em"] == t4.isoformat(timespec="seconds")

        # 5. Fim de campeonato (sem próximos jogos): grava na transição e depois estabiliza
        jogo_r36_encerrado = dict(
            jogo_r36_timed,
            status="FINISHED",
            score={"fullTime": {"home": 1, "away": 2}},
        )
        matches_correntes = [jogo_r34_adiado_encerrado, jogo_r35_encerrado, jogo_r36_encerrado]
        t5 = datetime(2026, 11, 25, 3, 0, 0, tzinfo=api_mod.BRT)
        res_5 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t5,
        )
        assert res_5["incremental_gravado"] is True
        assert res_5["proximo_jogo_gravado"] is True
        prox_t5 = _carregar_json_estrito(prox_path)
        _validar_schema_proximo_jogo(prox_t5)
        assert prox_t5["tem_proximo_jogo"] is False
        assert prox_t5["proximo_jogo"] is None
        bytes_inc_t5 = inc_path.read_bytes()
        bytes_prox_t5 = prox_path.read_bytes()

        # Nova execução na entressafra (t6): zero reescrita
        t6 = datetime(2026, 11, 26, 3, 0, 0, tzinfo=api_mod.BRT)
        res_6 = api_mod.atualizar_jogos_api(
            caminho_incremental=inc_path,
            caminho_proximo_jogo=prox_path,
            agora_brt=t6,
        )
        assert res_6["incremental_gravado"] is False
        assert res_6["proximo_jogo_gravado"] is False
        assert inc_path.read_bytes() == bytes_inc_t5
        assert prox_path.read_bytes() == bytes_prox_t5

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

ALL_JSON_PATHS = (PROD_DATA_PATH, HIST_DATA_PATH, META_DATA_PATH)
DATASET_PATHS = (PROD_DATA_PATH, HIST_DATA_PATH)

# Fundação do São Paulo FC: 25/01/1930; início dos pontos corridos: 2003
DATA_FUNDACAO_SPFC = date(1930, 1, 25)
INICIO_PONTOS_CORRIDOS = date(2003, 1, 1)
ANO_INICIO_ERA_MODERNA = 2014

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
    """Garante que partidas da era moderna (2014+) tenham gols e os 4 campos de cartões preenchidos."""
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

        if p["temporada"] >= ANO_INICIO_ERA_MODERNA:
            if not all(preenchidos):
                erros.append(
                    f"{_fmt_partida(idx, p)} partida >= {ANO_INICIO_ERA_MODERNA} sem cartões completos: "
                    f"{ {c: p.get(c) for c in CAMPOS_CARTOES} }"
                )
            if not isinstance(p.get("gols"), list):
                erros.append(
                    f"{_fmt_partida(idx, p)} partida >= {ANO_INICIO_ERA_MODERNA} sem lista de gols "
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

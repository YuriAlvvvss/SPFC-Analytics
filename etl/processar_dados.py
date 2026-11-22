"""
ETL do projeto Dados Tricolor.

Lê os CSVs brutos do Campeonato Brasileiro (Kaggle) em `data/raw/`,
filtra exclusivamente as partidas do São Paulo Futebol Clube na era dos
pontos corridos (2003 a 2025), padroniza todos os campos sob a perspectiva
do SPFC (incluindo cartões, estatísticas técnicas e gols detalhados) e
exporta o arquivo limpo para `docs/data/spfc_pontos_corridos.json`.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import pandas as pd
except ModuleNotFoundError:  # Permite executar --patch-json / merge sem pandas instalado
    pd = None  # type: ignore[assignment]

try:
    from etl.atualizar_jogos_api import (
        ARENA_CASA_SPFC,
        ARENA_FORA_FALLBACK,
        ARENAS_PADRAO_POR_CLUBE,
        ESTADOS_TIMES,
    )
except ModuleNotFoundError:
    from atualizar_jogos_api import (  # type: ignore[no-redef]
        ARENA_CASA_SPFC,
        ARENA_FORA_FALLBACK,
        ARENAS_PADRAO_POR_CLUBE,
        ESTADOS_TIMES,
    )

# Caminhos do projeto (relativos ao repositório, independentes do diretório atual)
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "data" / "raw"
HISTORICO_PATH = BASE_DIR / "data" / "historico_2003_2025.json"
API_INCREMENTAL_PATH = BASE_DIR / "data" / "jogos_api_brasileirao.json"
OUTPUT_PATH = BASE_DIR / "docs" / "data" / "spfc_pontos_corridos.json"
META_PATH = BASE_DIR / "docs" / "data" / "meta.json"

try:
    BRT = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:
    BRT = timezone(timedelta(hours=-3))

ARQUIVO_PARTIDAS = RAW_DIR / "campeonato-brasileiro-full.csv"
ARQUIVO_CARTOES = RAW_DIR / "campeonato-brasileiro-cartoes.csv"
ARQUIVO_ESTATISTICAS = RAW_DIR / "campeonato-brasileiro-estatisticas-full.csv"
ARQUIVO_GOLS = RAW_DIR / "campeonato-brasileiro-gols.csv"

# Nos CSVs originais do Kaggle, o clube aparece sem acento
CLUBE_ALVO = "Sao Paulo"
TEMPORADA_INICIO = 2003
TEMPORADA_FIM = 2025

# Padronização dos nomes de clubes para exibição com acentuação correta
NOMES_CLUBES: dict[str, str] = {
    "America-MG": "América-MG",
    "America-RN": "América-RN",
    "Atletico-GO": "Atlético-GO",
    "Atletico-MG": "Atlético-MG",
    "Avai": "Avaí",
    "Botafogo-RJ": "Botafogo",
    "Ceara": "Ceará",
    "Criciuma": "Criciúma",
    "Cuiaba": "Cuiabá",
    "Goias": "Goiás",
    "Gremio": "Grêmio",
    "Gremio Prudente": "Grêmio Prudente",
    "Nautico": "Náutico",
    "Parana": "Paraná",
    "Santo Andre": "Santo André",
    "Sao Caetano": "São Caetano",
    "Sao Paulo": "São Paulo",
    "Vitoria": "Vitória",
}

# Padronização de atletas (unificação de duplicatas, acentos e nomes civis da súmula)
# Obs.: "Maicon" (2014, volante) e "Maicon Pereira Roque" (2016, zagueiro) são mantidos
# distintos propositalmente porque são jogadores diferentes.
NOMES_ATLETAS: dict[str, str] = {
    # Duplicatas reais identificadas entre temporadas
    "Aldemir Ferreira": "Ferreirinha",
    "Diego Henrique Costa Barbosa": "Diego Costa",
    # Correção de acentuação
    "Joao Rojas": "João Rojas",
    # Nomes civis de súmula padronizados para o nome esportivo amplamente reconhecido
    "Alisson Euler de Freitas Castro": "Alisson",
    "Antônio Carlos dos Santos Aguiar": "Antônio Carlos",
    "Antonio Thomaz Santos de Barros": "Thomaz",
    "Antony Matheus dos Santos": "Antony",
    "Breno Vinícius Rodrigues Borges": "Breno",
    "Carlos Andrade Souza": "Carlinhos",
    "Danilo Neves": "Tchê Tchê",
    "David Corrêa da Fonseca": "David",
    "David Neres Campos": "David Neres",
    "Denílson Pereira Júnior": "Denílson",
    "Douglas Pereira dos Santos": "Douglas",
    "Eder Citadin Martins": "Éder",
    "Édson José da Silva": "Edson Silva",
    "Erison Danilo de Souza": "Erison",
    "Éverton Cardoso da Silva": "Everton",
    "Gilberto Oliveira Souza Junior": "Gilberto",
    "Hélio Junio Nunes de Castro": "Helinho",
    "José Rogério de Oliveira Melo": "Rogério",
    "Josef de Souza Dias": "Souza",
    "Juan Santos da Silva": "Juan",
    "Kelvin Mateus de Oliveira": "Kelvin",
    "Luan Vinícius da Silva Santos": "Luan",
    "Lucas Cavalcante Silva Afonso": "Lucão",
    "Luciano da Rocha Neves": "Luciano",
    "Marcio Antonio de Sousa Junior": "Marcinho",
    "Marcos Paulo Costa do Nascimento": "Marcos Paulo",
    "Matheus Dória Macedo": "Dória",
    "Pablo Felipe Teixeira": "Pablo",
    "Reinaldo Manoel da Silva": "Reinaldo",
    "Thiago Henrique Mendes Ribeiro": "Thiago Mendes",
    "Wesley Lopes Beltrame": "Wesley",
    "Ytalo José dos Santos": "Ytalo",
}

MAPA_TIPO_GOL: dict[str, str] = {
    "Penalty": "Pênalti",
    "Gol Contra": "Gol contra",
}

# Correções pontuais de datas comprovadamente incorretas nos CSVs originais do Kaggle,
# indexadas por `ID` da partida (mantendo os arquivos brutos em `data/raw/` intactos).
# Erros identificados pela suíte de qualidade de dados (`tests/test_data_quality.py`).
CORRECOES_DATAS_POR_ID: dict[int, str] = {
    # 2008 R11 (Casa vs Palmeiras): CSV trazia 2008-07-06 (mesma data da R9 vs Ipatinga)
    2417: "2008-07-13",
    # 2010 R5 (Fora vs Guarani): CSV trazia 2010-05-23 (mesma data/hora da R3 vs Internacional)
    3130: "2010-05-30",
}


def limpar_texto(valor: Any) -> str | None:
    """Remove espaços extras/NBSP, trata vazios e corrige mojibake UTF-8/Latin-1."""
    if pd.isna(valor):
        return None

    texto = " ".join(str(valor).replace("\xa0", " ").split())
    if not texto or texto == "-":
        return None

    if "Ã" in texto or "Â" in texto:
        try:
            texto = texto.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass

    return texto


def padronizar_clube(nome: Any) -> str:
    """Retorna o nome do clube padronizado com acentuação em português."""
    limpo = limpar_texto(nome) or ""
    return NOMES_CLUBES.get(limpo, limpo)


def padronizar_atleta(nome: Any) -> str:
    """Retorna o nome do atleta limpo e unificado."""
    limpo = limpar_texto(nome) or ""
    return NOMES_ATLETAS.get(limpo, limpo)


def parse_percentual(valor: Any) -> int | None:
    """Converte strings percentuais como '57%' em inteiro (57)."""
    texto = limpar_texto(valor)
    if not texto:
        return None
    texto = texto.rstrip("%").replace(",", ".").strip()
    try:
        return int(round(float(texto)))
    except ValueError:
        return None


def para_int_ou_none(valor: Any) -> int | None:
    """Converte valores numéricos do Pandas em int nativo do Python ou None."""
    if pd.isna(valor):
        return None
    return int(valor)


def chave_ordenacao_minuto(minuto: str) -> tuple[int, int]:
    """Converte minutos como '45+2' ou '90' em tupla ordenável (base, acrescimo)."""
    partes = minuto.split("+")
    try:
        base = int(partes[0])
        acrescimo = int(partes[1]) if len(partes) > 1 else 0
        return (base, acrescimo)
    except ValueError:
        return (999, 0)


def calcular_temporada(datas: pd.Series) -> pd.Series:
    """
    Deriva a temporada esportiva a partir da data da partida.

    A edição de 2020 teve rodadas finais (28 a 38) disputadas em janeiro e
    fevereiro de 2021 em razão da pandemia de COVID-19.
    """
    temporadas = datas.dt.year.copy()
    edicao_2020_em_2021 = (datas.dt.year == 2021) & (datas.dt.month <= 2)
    temporadas.loc[edicao_2020_em_2021] = 2020
    return temporadas.astype(int)


def aplicar_correcoes_datas_df(sp: pd.DataFrame) -> pd.Series:
    """
    Aplica o dicionário explícito `CORRECOES_DATAS_POR_ID` sobre a série `dt`,
    mantendo os arquivos brutos em `data/raw/` intactos.
    """
    datas_corrigidas = sp["dt"].copy()
    ids_int = sp["ID"].astype(int)
    for partida_id, data_corrigida in CORRECOES_DATAS_POR_ID.items():
        mascara = ids_int == partida_id
        if mascara.any():
            datas_corrigidas.loc[mascara] = pd.Timestamp(data_corrigida)
    return datas_corrigidas


def aplicar_correcoes_datas_partidas(
    partidas: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """
    Aplica `CORRECOES_DATAS_POR_ID` em uma lista de partidas no schema JSON v1 e
    reordena cronologicamente por `(temporada, data, id)`.
    """
    alteradas = 0
    atualizadas: list[dict[str, Any]] = []
    for partida in partidas:
        registro = dict(partida)
        partida_id = int(registro["id"])
        nova_data = CORRECOES_DATAS_POR_ID.get(partida_id)
        if nova_data is not None and registro.get("data") != nova_data:
            registro["data"] = nova_data
            alteradas += 1
        atualizadas.append(registro)

    atualizadas.sort(key=lambda p: (int(p["temporada"]), str(p["data"]), int(p["id"])))
    return atualizadas, alteradas


def validar_arquivos_entrada() -> None:
    """Garante que o Pandas esteja disponível e os CSVs originais existam em `data/raw/`."""
    if pd is None:
        raise ModuleNotFoundError(
            "O pacote 'pandas' é necessário para processar os CSVs em data/raw/. "
            "Instale com: pip install pandas"
        )
    obrigatorios = [
        ARQUIVO_PARTIDAS,
        ARQUIVO_CARTOES,
        ARQUIVO_ESTATISTICAS,
        ARQUIVO_GOLS,
    ]
    ausentes = [arq.name for arq in obrigatorios if not arq.exists()]
    if ausentes:
        lista = ", ".join(ausentes)
        raise FileNotFoundError(
            f"Arquivos ausentes em '{RAW_DIR}': {lista}. "
            "Coloque os CSVs originais do Kaggle na pasta data/raw/."
        )


def carregar_partidas_spfc() -> pd.DataFrame:
    """Carrega o CSV principal e filtra/padroniza as partidas do SPFC."""
    df = pd.read_csv(ARQUIVO_PARTIDAS)

    mascara_spfc = (df["mandante"] == CLUBE_ALVO) | (df["visitante"] == CLUBE_ALVO)
    sp = df.loc[mascara_spfc].copy()

    sp["dt"] = pd.to_datetime(sp["data"], format="%d/%m/%Y")
    # Aplica correções documentadas de datas incorretas no CSV original antes de calcular temporada e ordenar
    sp["dt"] = aplicar_correcoes_datas_df(sp)
    sp["temporada"] = calcular_temporada(sp["dt"])
    sp = sp[sp["temporada"].between(TEMPORADA_INICIO, TEMPORADA_FIM)].copy()

    mandante_sp = sp["mandante"] == CLUBE_ALVO

    sp["mando"] = mandante_sp.map({True: "Casa", False: "Fora"})
    sp["adversario_raw"] = sp["visitante"].where(mandante_sp, sp["mandante"])
    sp["adversario"] = sp["adversario_raw"].map(padronizar_clube)
    sp["adversario_estado"] = (
        sp["visitante_Estado"].where(mandante_sp, sp["mandante_Estado"]).map(limpar_texto)
    )
    sp["arena_limpa"] = sp["arena"].map(limpar_texto)
    sp["hora_limpa"] = sp["hora"].map(limpar_texto)

    sp["gols_pro"] = (
        sp["mandante_Placar"].where(mandante_sp, sp["visitante_Placar"]).astype(int)
    )
    sp["gols_contra"] = (
        sp["visitante_Placar"].where(mandante_sp, sp["mandante_Placar"]).astype(int)
    )
    sp["saldo_gols"] = sp["gols_pro"] - sp["gols_contra"]

    sp["resultado"] = "E"
    sp.loc[sp["gols_pro"] > sp["gols_contra"], "resultado"] = "V"
    sp.loc[sp["gols_pro"] < sp["gols_contra"], "resultado"] = "D"
    sp["pontos"] = sp["resultado"].map({"V": 3, "E": 1, "D": 0}).astype(int)

    sp["tecnico_spfc"] = (
        sp["tecnico_mandante"]
        .where(mandante_sp, sp["tecnico_visitante"])
        .map(limpar_texto)
    )
    sp["formacao_spfc"] = (
        sp["formacao_mandante"]
        .where(mandante_sp, sp["formacao_visitante"])
        .map(limpar_texto)
    )

    sp = sp.sort_values(["temporada", "dt", "ID"]).reset_index(drop=True)
    return sp


def agregar_cartoes_por_evento(ids_spfc: set[int]) -> tuple[pd.DataFrame, int, int]:
    """
    Agrega cartões amarelos e vermelhos por partida a partir de `cartoes.csv`.

    `cartoes.csv` é a fonte mais fiel para 2014–2024 porque registra todos os
    eventos de cartão (inclusive 2014, 2024 e o 1º amarelo em expulsões por
    segundo amarelo, omitidos no arquivo de estatísticas).
    """
    cartoes = pd.read_csv(ARQUIVO_CARTOES)
    min_id = int(cartoes["partida_id"].min())
    max_id = int(cartoes["partida_id"].max())

    cartoes_sp = cartoes[cartoes["partida_id"].isin(ids_spfc)].copy()
    cartoes_sp["is_spfc"] = cartoes_sp["clube"] == CLUBE_ALVO

    def resumir(df_sub: pd.DataFrame, prefixo: str) -> pd.DataFrame:
        tabela = (
            df_sub.groupby(["partida_id", "cartao"])
            .size()
            .unstack(fill_value=0)
            .reindex(columns=["Amarelo", "Vermelho"], fill_value=0)
            .reset_index()
        )
        tabela.columns.name = None
        return tabela.rename(
            columns={
                "Amarelo": f"{prefixo}_amarelos_csv",
                "Vermelho": f"{prefixo}_vermelhos_csv",
            }
        )

    sp_agg = resumir(cartoes_sp[cartoes_sp["is_spfc"]], "spfc")
    adv_agg = resumir(cartoes_sp[~cartoes_sp["is_spfc"]], "adv")
    combinado = pd.merge(sp_agg, adv_agg, on="partida_id", how="outer")
    return combinado, min_id, max_id


def carregar_gols_spfc(
    ids_spfc: set[int],
) -> tuple[dict[int, list[dict[str, Any]]], int, int]:
    """
    Carrega os gols a favor do SPFC de `gols.csv`, agrupados por `partida_id`.

    No dataset, gols com `clube == 'Sao Paulo'` e `tipo_de_gol == 'Gol Contra'`
    são gols contra marcados por atletas adversários em favor do SPFC. Eles são
    mantidos na linha do tempo da partida com `tipo='Gol contra'` e
    `gol_contra=True`, para que o placar da partida bata exatamente com a lista
    de gols enquanto o ranking de artilheiros ignora gols contra.
    """
    gols = pd.read_csv(ARQUIVO_GOLS)
    min_id = int(gols["partida_id"].min())
    max_id = int(gols["partida_id"].max())

    gols_sp = gols[(gols["partida_id"].isin(ids_spfc)) & (gols["clube"] == CLUBE_ALVO)].copy()

    mapa_gols: dict[int, list[dict[str, Any]]] = {}
    for row in gols_sp.itertuples(index=False):
        partida_id = int(row.partida_id)
        tipo_bruto = limpar_texto(row.tipo_de_gol)
        eh_gol_contra = tipo_bruto == "Gol Contra"
        tipo_padronizado = MAPA_TIPO_GOL.get(tipo_bruto or "", "Normal")

        # Para gols contra (atleta adversário), apenas limpa o texto; para atletas do SPFC, unifica nomes
        jogador = limpar_texto(row.atleta) if eh_gol_contra else padronizar_atleta(row.atleta)
        minuto = limpar_texto(row.minuto) or ""

        mapa_gols.setdefault(partida_id, []).append(
            {
                "jogador": jogador,
                "minuto": minuto,
                "tipo": tipo_padronizado,
                "gol_contra": eh_gol_contra,
            }
        )

    for lista in mapa_gols.values():
        lista.sort(key=lambda item: chave_ordenacao_minuto(item["minuto"]))

    return mapa_gols, min_id, max_id


def carregar_estatisticas(ids_spfc: set[int]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Carrega estatísticas técnicas do SPFC e cartões de fallback (2025) de `estatisticas-full.csv`."""
    stats = pd.read_csv(ARQUIVO_ESTATISTICAS)
    stats_jogos = stats[stats["partida_id"].isin(ids_spfc)].copy()

    stats_sp = stats_jogos[stats_jogos["clube"] == CLUBE_ALVO].copy()
    stats_adv = stats_jogos[stats_jogos["clube"] != CLUBE_ALVO].copy()

    sem_dados_sp = (
        (stats_sp["chutes"] == 0)
        & (stats_sp["chutes_no_alvo"] == 0)
        & (stats_sp["passes"] == 0)
        & (stats_sp["faltas"] == 0)
        & (stats_sp["escanteios"] == 0)
        & (stats_sp["posse_de_bola"].isna())
    )
    stats_sp["tem_estatisticas"] = ~sem_dados_sp

    stats_sp["posse_num"] = stats_sp["posse_de_bola"].map(parse_percentual)
    stats_sp["precisao_num"] = stats_sp["precisao_passes"].map(parse_percentual)

    colunas_sp = [
        "partida_id",
        "tem_estatisticas",
        "chutes",
        "chutes_no_alvo",
        "posse_num",
        "passes",
        "precisao_num",
        "faltas",
        "escanteios",
        "impedimentos",
        "cartao_amarelo",
        "cartao_vermelho",
    ]
    stats_sp = stats_sp[colunas_sp].rename(
        columns={
            "cartao_amarelo": "spfc_amarelos_est",
            "cartao_vermelho": "spfc_vermelhos_est",
        }
    )

    stats_adv = stats_adv[["partida_id", "cartao_amarelo", "cartao_vermelho"]].rename(
        columns={
            "cartao_amarelo": "adv_amarelos_est",
            "cartao_vermelho": "adv_vermelhos_est",
        }
    )
    return stats_sp, stats_adv


def montar_dataset() -> dict[str, Any]:
    """Executa todo o pipeline de limpeza, integração e montagem do JSON final."""
    validar_arquivos_entrada()

    sp = carregar_partidas_spfc()
    ids_spfc = set(sp["ID"].astype(int))

    cartoes_agg, min_id_cartoes, max_id_cartoes = agregar_cartoes_por_evento(ids_spfc)
    mapa_gols, min_id_gols, max_id_gols = carregar_gols_spfc(ids_spfc)
    stats_sp, stats_adv = carregar_estatisticas(ids_spfc)

    df = (
        sp.merge(cartoes_agg, left_on="ID", right_on="partida_id", how="left")
        .drop(columns=["partida_id"], errors="ignore")
        .merge(stats_sp, left_on="ID", right_on="partida_id", how="left")
        .drop(columns=["partida_id"], errors="ignore")
        .merge(stats_adv, left_on="ID", right_on="partida_id", how="left")
        .drop(columns=["partida_id"], errors="ignore")
    )

    partidas: list[dict[str, Any]] = []
    temporadas_cartoes: set[int] = set()
    temporadas_gols: set[int] = set()
    temporadas_stats: set[int] = set()

    for row in df.itertuples(index=False):
        partida_id = int(row.ID)
        temporada = int(row.temporada)
        tem_stats = bool(row.tem_estatisticas) if pd.notna(row.tem_estatisticas) else False

        # Cartões: 2014–2024 via cartoes.csv, 2025 via estatisticas-full.csv, 2003–2013 como null
        if min_id_cartoes <= partida_id <= max_id_cartoes:
            am_sp = int(row.spfc_amarelos_csv) if pd.notna(row.spfc_amarelos_csv) else 0
            vm_sp = int(row.spfc_vermelhos_csv) if pd.notna(row.spfc_vermelhos_csv) else 0
            am_adv = int(row.adv_amarelos_csv) if pd.notna(row.adv_amarelos_csv) else 0
            vm_adv = int(row.adv_vermelhos_csv) if pd.notna(row.adv_vermelhos_csv) else 0
            temporadas_cartoes.add(temporada)
        elif partida_id > max_id_cartoes and tem_stats:
            am_sp = para_int_ou_none(row.spfc_amarelos_est)
            vm_sp = para_int_ou_none(row.spfc_vermelhos_est)
            am_adv = para_int_ou_none(row.adv_amarelos_est)
            vm_adv = para_int_ou_none(row.adv_vermelhos_est)
            if am_sp is not None or vm_sp is not None:
                temporadas_cartoes.add(temporada)
        else:
            am_sp = None
            vm_sp = None
            am_adv = None
            vm_adv = None

        # Gols detalhados: lista de gols para 2014–2025 (vazia se 0 gols pró); null para 2003–2013
        if min_id_gols <= partida_id <= max_id_gols:
            gols_partida: list[dict[str, Any]] | None = mapa_gols.get(partida_id, [])
            temporadas_gols.add(temporada)
        else:
            gols_partida = None

        if tem_stats:
            temporadas_stats.add(temporada)

        registro: dict[str, Any] = {
            "id": partida_id,
            "temporada": temporada,
            "rodada": int(row.rodata),
            "data": row.dt.strftime("%Y-%m-%d"),
            "hora": row.hora_limpa,
            "mando": row.mando,
            "adversario": row.adversario,
            "adversario_estado": row.adversario_estado,
            "arena": row.arena_limpa,
            "gols_pro": int(row.gols_pro),
            "gols_contra": int(row.gols_contra),
            "saldo_gols": int(row.saldo_gols),
            "resultado": row.resultado,
            "pontos": int(row.pontos),
            "tecnico_spfc": row.tecnico_spfc,
            "formacao_spfc": row.formacao_spfc,
            "cartoes_amarelos": am_sp,
            "cartoes_vermelhos": vm_sp,
            "cartoes_amarelos_adversario": am_adv,
            "cartoes_vermelhos_adversario": vm_adv,
            "gols": gols_partida,
            "chutes": para_int_ou_none(row.chutes) if tem_stats else None,
            "chutes_no_alvo": para_int_ou_none(row.chutes_no_alvo) if tem_stats else None,
            "posse_de_bola": para_int_ou_none(row.posse_num) if tem_stats else None,
            "passes": para_int_ou_none(row.passes) if tem_stats else None,
            "precisao_passes": para_int_ou_none(row.precisao_num) if tem_stats else None,
            "faltas": para_int_ou_none(row.faltas) if tem_stats else None,
            "escanteios": para_int_ou_none(row.escanteios) if tem_stats else None,
            "impedimentos": para_int_ou_none(row.impedimentos) if tem_stats else None,
        }
        partidas.append(registro)

    payload = {
        "metadata": {
            "clube": "São Paulo FC",
            "competicao": "Campeonato Brasileiro Série A — Era dos Pontos Corridos",
            "temporada_inicio": min(p["temporada"] for p in partidas),
            "temporada_fim": max(p["temporada"] for p in partidas),
            "total_partidas": len(partidas),
            "temporadas_com_cartoes": sorted(temporadas_cartoes),
            "temporadas_com_gols": sorted(temporadas_gols),
            "temporadas_com_estatisticas": sorted(temporadas_stats),
            "fonte_cartoes": (
                "campeonato-brasileiro-cartoes.csv (2014–2024) e "
                "campeonato-brasileiro-estatisticas-full.csv (2025)"
            ),
            "fonte_gols": "campeonato-brasileiro-gols.csv (2014–2025)",
            "gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "partidas": partidas,
    }
    return payload


def salvar_json(payload: dict[str, Any], destino: Path = OUTPUT_PATH) -> None:
    """Exporta o dataset limpo em UTF-8 garantindo JSON estritamente válido (escrita atômica)."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destino.with_suffix(destino.suffix + ".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as arquivo:
            json.dump(payload, arquivo, ensure_ascii=False, indent=2, allow_nan=False)
            arquivo.write("\n")
        os.replace(tmp_path, destino)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def _limpar_str_puro(valor: Any) -> str | None:
    """Limpeza textual sem dependência de pandas para uso no merge incremental."""
    if valor is None:
        return None
    texto = " ".join(str(valor).replace("\xa0", " ").split())
    if not texto or texto == "-":
        return None
    if "Ã" in texto or "Â" in texto:
        try:
            texto = texto.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return texto


def normalizar_partida_api_para_schema_v1(partida: dict[str, Any]) -> dict[str, Any]:
    """
    Converte/padroniza uma partida vinda de `data/jogos_api_brasileirao.json`
    para o schema v1 exato de 29 chaves, preenchendo de forma coerente os campos
    obrigatórios não fornecidos pela API (como `arena` e campos derivados).
    """
    adversario_raw = _limpar_str_puro(partida.get("adversario")) or ""
    adversario = NOMES_CLUBES.get(adversario_raw, adversario_raw)
    mando = _limpar_str_puro(partida.get("mando")) or "Casa"

    adversario_estado = (
        _limpar_str_puro(partida.get("adversario_estado"))
        or ESTADOS_TIMES.get(adversario)
    )

    arena = _limpar_str_puro(partida.get("arena"))
    if not arena:
        arena = (
            ARENA_CASA_SPFC
            if mando == "Casa"
            else ARENAS_PADRAO_POR_CLUBE.get(adversario, ARENA_FORA_FALLBACK)
        )

    hora = _limpar_str_puro(partida.get("hora")) or "00:00"
    gols_pro = int(partida["gols_pro"])
    gols_contra = int(partida["gols_contra"])
    saldo_gols = gols_pro - gols_contra

    if gols_pro > gols_contra:
        resultado, pontos = "V", 3
    elif gols_pro < gols_contra:
        resultado, pontos = "D", 0
    else:
        resultado, pontos = "E", 1

    return {
        "id": int(partida["id"]),
        "temporada": int(partida["temporada"]),
        "rodada": int(partida["rodada"]),
        "data": str(partida["data"]),
        "hora": hora,
        "mando": mando,
        "adversario": adversario,
        "adversario_estado": adversario_estado,
        "arena": arena,
        "gols_pro": gols_pro,
        "gols_contra": gols_contra,
        "saldo_gols": saldo_gols,
        "resultado": resultado,
        "pontos": pontos,
        "tecnico_spfc": _limpar_str_puro(partida.get("tecnico_spfc")),
        "formacao_spfc": _limpar_str_puro(partida.get("formacao_spfc")),
        "cartoes_amarelos": partida.get("cartoes_amarelos"),
        "cartoes_vermelhos": partida.get("cartoes_vermelhos"),
        "cartoes_amarelos_adversario": partida.get("cartoes_amarelos_adversario"),
        "cartoes_vermelhos_adversario": partida.get("cartoes_vermelhos_adversario"),
        "gols": partida.get("gols"),
        "chutes": partida.get("chutes"),
        "chutes_no_alvo": partida.get("chutes_no_alvo"),
        "posse_de_bola": partida.get("posse_de_bola"),
        "passes": partida.get("passes"),
        "precisao_passes": partida.get("precisao_passes"),
        "faltas": partida.get("faltas"),
        "escanteios": partida.get("escanteios"),
        "impedimentos": partida.get("impedimentos"),
    }


def carregar_partidas_api_incremental(
    caminho_api: Path = API_INCREMENTAL_PATH,
) -> tuple[list[dict[str, Any]], bool]:
    """
    Carrega partidas encerradas do arquivo incremental da API (football-data.org).

    Retorna `(partidas, arquivo_existe)`. Quando o arquivo não existe, retorna
    `([], False)` para que o ETL continue funcionando normalmente offline.
    """
    if not caminho_api.exists():
        return [], False

    with caminho_api.open("r", encoding="utf-8") as arquivo:
        dados = json.load(arquivo)

    if isinstance(dados, dict) and isinstance(dados.get("partidas"), list):
        return list(dados["partidas"]), True
    if isinstance(dados, list):
        return list(dados), True
    return [], True


def mesclar_partidas_deterministico(
    partidas_historicas: list[dict[str, Any]],
    partidas_api: list[dict[str, Any]],
    partidas_posteriores_existentes: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """
    Faz merge determinístico e idempotente entre base histórica (prioridade 1),
    partidas pós-histórico já existentes em produção (prioridade 2, ex.: ESPN)
    e partidas incrementais da API football-data.org (prioridade 3).

    Deduplica pelas chaves naturais do campeonato:
    - `(temporada, rodada)`
    - `(data, adversario)`
    - `(temporada, mando, adversario)`
    - `data` (o clube não disputa dois jogos oficiais no mesmo dia)

    Garante IDs únicos e ordenação cronológica estrita por `(temporada, data, id)`.
    """
    resultado: list[dict[str, Any]] = []
    ids_usados: set[int] = set()
    chaves_temp_rod: set[tuple[int, int]] = set()
    chaves_data_adv: set[tuple[str, str]] = set()
    chaves_confronto: set[tuple[int, str, str]] = set()
    chaves_data: set[str] = set()

    def _registrar(p: dict[str, Any]) -> None:
        resultado.append(p)
        ids_usados.add(int(p["id"]))
        chaves_temp_rod.add((int(p["temporada"]), int(p["rodada"])))
        chaves_data_adv.add((str(p["data"]), str(p["adversario"])))
        chaves_confronto.add((int(p["temporada"]), str(p["mando"]), str(p["adversario"])))
        chaves_data.add(str(p["data"]))

    def _eh_duplicata(p: dict[str, Any]) -> bool:
        return (
            (int(p["temporada"]), int(p["rodada"])) in chaves_temp_rod
            or (str(p["data"]), str(p["adversario"])) in chaves_data_adv
            or (int(p["temporada"]), str(p["mando"]), str(p["adversario"])) in chaves_confronto
            or str(p["data"]) in chaves_data
        )

    # 1. Base histórica congelada (intacta)
    for p in partidas_historicas:
        _registrar(dict(p))

    # 2. Partidas pós-histórico já presentes em produção (ex.: ESPN com gols/cartões/stats)
    for p in sorted(
        partidas_posteriores_existentes or [],
        key=lambda item: (int(item["temporada"]), str(item["data"]), int(item["id"])),
    ):
        if _eh_duplicata(p):
            continue
        registro = dict(p)
        if int(registro["id"]) in ids_usados:
            novo_id = 900_000_000 + int(registro["id"])
            while novo_id in ids_usados:
                novo_id += 1
            registro["id"] = novo_id
        _registrar(registro)

    # 3. Partidas incrementais da API football-data.org (apenas o que ainda não existe)
    novos_da_api = 0
    duplicatas_ignoradas = 0
    api_ordenadas = sorted(
        partidas_api,
        key=lambda item: (int(item["temporada"]), str(item["data"]), int(item["id"])),
    )
    for item_api in api_ordenadas:
        registro = normalizar_partida_api_para_schema_v1(item_api)
        if _eh_duplicata(registro):
            duplicatas_ignoradas += 1
            continue

        if int(registro["id"]) in ids_usados:
            novo_id = 900_000_000 + int(registro["id"])
            while novo_id in ids_usados:
                novo_id += 1
            registro["id"] = novo_id

        _registrar(registro)
        novos_da_api += 1

    resultado.sort(key=lambda p: (int(p["temporada"]), str(p["data"]), int(p["id"])))
    stats = {
        "lidos_da_api": len(partidas_api),
        "novos_da_api": novos_da_api,
        "duplicatas_ignoradas": duplicatas_ignoradas,
    }
    return resultado, stats


def sincronizar_meta_json(
    payload_producao: dict[str, Any],
    destino_meta: Path = META_PATH,
    novos_da_api: int = 0,
) -> None:
    """
    Mantém `docs/data/meta.json` consistente com `docs/data/spfc_pontos_corridos.json`.

    Só regrava o arquivo quando ele não existe, quando houve novos jogos incorporados
    da API ou quando algum contador/data divergir do dataset de produção.
    """
    partidas = payload_producao["partidas"]
    meta_prod = payload_producao["metadata"]
    temp_inicio = int(meta_prod["temporada_inicio"])
    temp_fim = int(meta_prod["temporada_fim"])
    temp_atual = temp_fim
    total_jogos = len(partidas)
    jogos_temp_atual = sum(1 for p in partidas if int(p["temporada"]) == temp_atual)
    jogos_historico = sum(1 for p in partidas if int(p["temporada"]) < temp_atual)
    ultima_partida_data = max(str(p["data"]) for p in partidas)

    meta_atual: dict[str, Any] | None = None
    if destino_meta.exists():
        with destino_meta.open("r", encoding="utf-8") as arquivo:
            meta_atual = json.load(arquivo)

    campos_consistentes = (
        isinstance(meta_atual, dict)
        and meta_atual.get("temporada_inicio") == temp_inicio
        and meta_atual.get("temporada_fim") == temp_fim
        and meta_atual.get("temporada_atual") == temp_atual
        and meta_atual.get("total_jogos") == total_jogos
        and meta_atual.get("jogos_historico") == jogos_historico
        and meta_atual.get("jogos_temporada_atual") == jogos_temp_atual
        and meta_atual.get("ultima_partida_data") == ultima_partida_data
    )

    if campos_consistentes and novos_da_api == 0:
        return

    agora_brt = datetime.now(BRT)
    fonte_anterior = str((meta_atual or {}).get("fonte_atualizacao") or "").strip()
    if novos_da_api > 0:
        if "football-data.org" in fonte_anterior:
            fonte_atualizacao = fonte_anterior
        elif fonte_anterior:
            fonte_atualizacao = f"{fonte_anterior} + football-data.org (v4 / BSA)"
        else:
            fonte_atualizacao = "football-data.org (v4 / BSA)"
    else:
        fonte_atualizacao = fonte_anterior or "Kaggle + ETL Dados Tricolor"

    novo_meta = {
        "atualizado_em": agora_brt.isoformat(timespec="seconds"),
        "atualizado_em_brt": agora_brt.strftime("%d/%m/%Y às %H:%M"),
        "fuso_horario": "America/Sao_Paulo",
        "temporada_inicio": temp_inicio,
        "temporada_fim": temp_fim,
        "temporada_atual": temp_atual,
        "total_jogos": total_jogos,
        "jogos_historico": jogos_historico,
        "jogos_temporada_atual": jogos_temp_atual,
        "ultima_partida_data": ultima_partida_data,
        "fonte_atualizacao": fonte_atualizacao,
    }
    salvar_json(novo_meta, destino_meta)


def _dataset_producao_alterado(
    atual: dict[str, Any] | None,
    novo: dict[str, Any],
) -> bool:
    """Compara o dataset atual e o novo ignorando apenas `metadata.gerado_em`."""
    if not isinstance(atual, dict):
        return True
    if atual.get("partidas") != novo.get("partidas"):
        return True
    meta_atual = atual.get("metadata")
    meta_novo = novo.get("metadata")
    if not isinstance(meta_atual, dict) or not isinstance(meta_novo, dict):
        return True
    gerado_atual = meta_atual.get("gerado_em")
    if not isinstance(gerado_atual, str) or not gerado_atual.strip():
        return True
    meta_ant_funcional = {k: v for k, v in meta_atual.items() if k != "gerado_em"}
    meta_novo_funcional = {k: v for k, v in meta_novo.items() if k != "gerado_em"}
    return meta_ant_funcional != meta_novo_funcional


def sincronizar_producao_com_historico(
    historico_payload: dict[str, Any],
    destino_historico: Path = HISTORICO_PATH,
    destino_producao: Path = OUTPUT_PATH,
    caminho_api: Path = API_INCREMENTAL_PATH,
    destino_meta: Path = META_PATH,
    salvar_historico: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Salva a base histórica congelada (`data/historico_2003_2025.json`) e regenera
    `docs/data/spfc_pontos_corridos.json` integrando:
    1. Base histórica congelada (2003–2025)
    2. Partidas de temporadas posteriores já presentes em produção (ex.: ESPN)
    3. Partidas encerradas do arquivo incremental da API (`data/jogos_api_brasileirao.json`),
       caso exista (continuando 100% funcional offline quando ausente).
    """
    if salvar_historico:
        salvar_json(historico_payload, destino_historico)

    partidas_historicas = historico_payload["partidas"]
    temp_fim_hist = int(historico_payload["metadata"]["temporada_fim"])

    prod_atual: dict[str, Any] | None = None
    partidas_posteriores: list[dict[str, Any]] = []
    meta_producao_existente: dict[str, Any] = {}
    if destino_producao.exists():
        with destino_producao.open("r", encoding="utf-8") as arquivo:
            prod_atual = json.load(arquivo)
        if isinstance(prod_atual, dict) and isinstance(prod_atual.get("partidas"), list):
            partidas_posteriores = [
                p for p in prod_atual["partidas"] if int(p["temporada"]) > temp_fim_hist
            ]
            meta_producao_existente = dict(prod_atual.get("metadata") or {})

    partidas_api, arquivo_api_existe = carregar_partidas_api_incremental(caminho_api)
    todas_partidas, stats_merge = mesclar_partidas_deterministico(
        partidas_historicas=partidas_historicas,
        partidas_api=partidas_api,
        partidas_posteriores_existentes=partidas_posteriores,
    )
    stats_merge["arquivo_api_existe"] = arquivo_api_existe

    if len(todas_partidas) == len(partidas_historicas) and not partidas_posteriores:
        if _dataset_producao_alterado(prod_atual, historico_payload):
            salvar_json(historico_payload, destino_producao)
            payload_final = historico_payload
        else:
            payload_final = prod_atual  # type: ignore[assignment]
        sincronizar_meta_json(payload_final, destino_meta=destino_meta, novos_da_api=0)
        return payload_final, stats_merge

    temporadas_cartoes = sorted(
        {
            p["temporada"]
            for p in todas_partidas
            if p.get("cartoes_amarelos") is not None and p.get("cartoes_vermelhos") is not None
        }
    )
    temporadas_gols = sorted(
        {p["temporada"] for p in todas_partidas if isinstance(p.get("gols"), list)}
    )
    temporadas_stats = sorted(
        {p["temporada"] for p in todas_partidas if p.get("chutes") is not None}
    )

    gerado_em_novo = (
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if stats_merge["novos_da_api"] > 0
        else str(
            meta_producao_existente.get("gerado_em")
            or historico_payload["metadata"]["gerado_em"]
        )
    )
    meta_prod = dict(meta_producao_existente or historico_payload["metadata"])
    meta_prod.update(
        {
            "temporada_inicio": min(p["temporada"] for p in todas_partidas),
            "temporada_fim": max(p["temporada"] for p in todas_partidas),
            "total_partidas": len(todas_partidas),
            "temporadas_com_cartoes": temporadas_cartoes,
            "temporadas_com_gols": temporadas_gols,
            "temporadas_com_estatisticas": temporadas_stats,
            "gerado_em": gerado_em_novo,
        }
    )

    payload_producao = {"metadata": meta_prod, "partidas": todas_partidas}
    if _dataset_producao_alterado(prod_atual, payload_producao):
        salvar_json(payload_producao, destino_producao)
    else:
        payload_producao = prod_atual  # type: ignore[assignment]
    sincronizar_meta_json(
        payload_producao,
        destino_meta=destino_meta,
        novos_da_api=stats_merge["novos_da_api"],
    )
    return payload_producao, stats_merge


def aplicar_patch_datas_base_existente() -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Aplica `CORRECOES_DATAS_POR_ID` e reordenação cronológica diretamente sobre a
    base histórica congelada (`data/historico_2003_2025.json`) e sincroniza o
    arquivo final de produção (`docs/data/spfc_pontos_corridos.json`) com
    eventuais jogos incrementais da API, sem exigir os CSVs brutos do Kaggle.
    """
    if not HISTORICO_PATH.exists():
        raise FileNotFoundError(
            f"Base histórica congelada não encontrada em '{HISTORICO_PATH}'."
        )

    with HISTORICO_PATH.open("r", encoding="utf-8") as arquivo:
        historico_payload = json.load(arquivo)

    partidas_corrigidas, qtd_alteradas = aplicar_correcoes_datas_partidas(
        historico_payload["partidas"]
    )
    houve_alteracao_hist = qtd_alteradas > 0 or partidas_corrigidas != historico_payload["partidas"]
    if houve_alteracao_hist:
        historico_payload["partidas"] = partidas_corrigidas
        historico_payload["metadata"]["gerado_em"] = datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )

    print(
        f"[PATCH] Correções de datas verificadas via CORRECOES_DATAS_POR_ID: "
        f"{qtd_alteradas} partida(s) atualizada(s)."
    )
    return sincronizar_producao_com_historico(
        historico_payload,
        salvar_historico=houve_alteracao_hist,
    )


def csvs_kaggle_disponiveis() -> bool:
    """Retorna True se pandas e os 4 CSVs originais do Kaggle estiverem disponíveis."""
    if pd is None:
        return False
    obrigatorios = (
        ARQUIVO_PARTIDAS,
        ARQUIVO_CARTOES,
        ARQUIVO_ESTATISTICAS,
        ARQUIVO_GOLS,
    )
    return all(arq.exists() for arq in obrigatorios)


def exibir_resumo(
    payload: dict[str, Any],
    stats_merge: dict[str, Any] | None = None,
) -> None:
    """Imprime um resumo de validação dos dados processados."""
    meta = payload["metadata"]
    partidas = payload["partidas"]

    vitorias = sum(1 for p in partidas if p["resultado"] == "V")
    empates = sum(1 for p in partidas if p["resultado"] == "E")
    derrotas = sum(1 for p in partidas if p["resultado"] == "D")
    pontos = sum(p["pontos"] for p in partidas)
    aproveitamento = (pontos / (len(partidas) * 3)) * 100
    gols_pro = sum(p["gols_pro"] for p in partidas)
    gols_contra = sum(p["gols_contra"] for p in partidas)

    com_cartoes = [p for p in partidas if p["cartoes_amarelos"] is not None]
    amarelos = sum(p["cartoes_amarelos"] for p in com_cartoes)
    vermelhos = sum(p["cartoes_vermelhos"] for p in com_cartoes)
    com_stats = sum(1 for p in partidas if p["chutes"] is not None)

    com_gols = [p for p in partidas if p["gols"] is not None]
    todos_gols = [g for p in com_gols for g in p["gols"]]
    gols_contra_favor = sum(1 for g in todos_gols if g["gol_contra"])
    gols_penalti = sum(1 for g in todos_gols if g["tipo"] == "Pênalti")

    contagem_artilheiros: dict[str, int] = {}
    for g in todos_gols:
        if not g["gol_contra"] and g["jogador"]:
            contagem_artilheiros[g["jogador"]] = contagem_artilheiros.get(g["jogador"], 0) + 1
    top5 = sorted(contagem_artilheiros.items(), key=lambda x: (-x[1], x[0]))[:5]

    tamanho_kb = OUTPUT_PATH.stat().st_size / 1024

    print("=" * 64)
    print("DADOS TRICOLOR — ETL CONCLUÍDO COM SUCESSO")
    print("=" * 64)
    print(f"Período:           {meta['temporada_inicio']} a {meta['temporada_fim']}")
    print(f"Total de jogos:    {len(partidas)}")
    print(f"Campanha geral:    {vitorias}V | {empates}E | {derrotas}D ({aproveitamento:.2f}% de aproveitamento)")
    print(f"Gols:              {gols_pro} pró | {gols_contra} contra | saldo {gols_pro - gols_contra:+d}")
    print(
        f"Cartões SPFC:      {amarelos} amarelos | {vermelhos} vermelhos "
        f"({len(com_cartoes)} jogos, {min(meta['temporadas_com_cartoes'])}–{max(meta['temporadas_com_cartoes'])})"
    )
    print(
        f"Gols detalhados:   {len(todos_gols)} gols ({len(todos_gols) - gols_contra_favor} de atletas SPFC, "
        f"{gols_penalti} de pênalti, {gols_contra_favor} gols contra a favor | {len(contagem_artilheiros)} artilheiros)"
    )
    print(
        f"Top 5 ({min(meta['temporadas_com_gols'])}–{max(meta['temporadas_com_gols'])}): "
        + ", ".join(f"{nome} ({qtd})" for nome, qtd in top5)
    )
    print(f"Estatísticas:      {com_stats} jogos com dados técnicos detalhados")
    if stats_merge is not None:
        if stats_merge.get("arquivo_api_existe"):
            print(
                f"Merge API (BSA):   {stats_merge['lidos_da_api']} lido(s) | "
                f"+{stats_merge['novos_da_api']} novo(s) na base | "
                f"{stats_merge['duplicatas_ignoradas']} duplicata(s) ignorada(s)"
            )
        else:
            print(f"Merge API (BSA):   '{API_INCREMENTAL_PATH.name}' ausente (execução offline)")
    print(f"Arquivo gerado:    {OUTPUT_PATH} ({tamanho_kb:.1f} KB)")
    print("=" * 64)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ETL histórico e merge incremental do Dados Tricolor."
    )
    parser.add_argument(
        "--patch-json",
        action="store_true",
        help=(
            "Aplica CORRECOES_DATAS_POR_ID e reordenação cronológica diretamente sobre "
            "data/historico_2003_2025.json e sincroniza docs/data/spfc_pontos_corridos.json "
            "com eventuais jogos incrementais da API, sem precisar dos CSVs brutos em data/raw/."
        ),
    )
    args = parser.parse_args()

    if args.patch_json:
        payload, stats_merge = aplicar_patch_datas_base_existente()
    elif csvs_kaggle_disponiveis():
        historico_payload = montar_dataset()
        payload, stats_merge = sincronizar_producao_com_historico(historico_payload)
    elif HISTORICO_PATH.exists():
        print(
            "[INFO] CSVs brutos em data/raw/ ou pacote pandas indisponíveis; "
            "utilizando base histórica congelada data/historico_2003_2025.json para sincronização e merge."
        )
        payload, stats_merge = aplicar_patch_datas_base_existente()
    else:
        validar_arquivos_entrada()
        historico_payload = montar_dataset()
        payload, stats_merge = sincronizar_producao_com_historico(historico_payload)

    exibir_resumo(payload, stats_merge=stats_merge)


if __name__ == "__main__":
    main()

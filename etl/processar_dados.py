"""
ETL do projeto Dados Tricolor.

Lê os CSVs brutos do Campeonato Brasileiro (Kaggle) em `data/raw/`,
filtra exclusivamente as partidas do São Paulo Futebol Clube na era dos
pontos corridos (2003 a 2025), padroniza todos os campos sob a perspectiva
do SPFC (incluindo cartões, estatísticas técnicas e gols detalhados) e
exporta o arquivo limpo para `docs/data/spfc_pontos_corridos.json`.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

import pandas as pd

# Caminhos do projeto (relativos ao repositório, independentes do diretório atual)
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "data" / "raw"
OUTPUT_PATH = BASE_DIR / "docs" / "data" / "spfc_pontos_corridos.json"

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


def validar_arquivos_entrada() -> None:
    """Garante que os CSVs originais existam em `data/raw/`."""
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
    """Exporta o dataset limpo em UTF-8 garantindo JSON estritamente válido."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", encoding="utf-8") as arquivo:
        json.dump(payload, arquivo, ensure_ascii=False, indent=2, allow_nan=False)


def exibir_resumo(payload: dict[str, Any]) -> None:
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
    print("Top 5 (2014–2025): " + ", ".join(f"{nome} ({qtd})" for nome, qtd in top5))
    print(f"Estatísticas:      {com_stats} jogos com dados técnicos detalhados")
    print(f"Arquivo gerado:    {OUTPUT_PATH} ({tamanho_kb:.1f} KB)")
    print("=" * 64)


def main() -> None:
    payload = montar_dataset()
    salvar_json(payload)
    exibir_resumo(payload)


if __name__ == "__main__":
    main()

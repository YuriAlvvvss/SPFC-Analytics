"""
ETL incremental via API football-data.org (v4) do projeto Dados Tricolor.

Consulta o Campeonato Brasileiro Série A (`BSA`) em uma única requisição HTTP,
filtra as partidas do São Paulo Futebol Clube, normaliza fuso horário (UTC -> BRT)
e nomes de clubes para o exato padrão da base histórica, e gera duas saídas:

1. `data/jogos_api_brasileirao.json`: base incremental idempotente apenas com
   partidas encerradas (`status == "FINISHED"` e placar válido), preservando
   temporadas já coletadas anteriormente e sem nunca alterar os CSVs brutos
   do Kaggle nem `data/historico_2003_2025.json`.
2. `docs/data/proximo_jogo.json`: metadados leves do próximo jogo futuro do SPFC
   (`status in ("TIMED", "SCHEDULED")`) para consumo direto do front-end.

Autenticação:
- Lê o token exclusivamente da variável de ambiente `FOOTBALL_DATA_API_KEY`.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
from typing import Any
import unicodedata
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

# Caminhos do projeto
BASE_DIR = Path(__file__).resolve().parent.parent
API_INCREMENTAL_PATH = BASE_DIR / "data" / "jogos_api_brasileirao.json"
PROXIMO_JOGO_PATH = BASE_DIR / "docs" / "data" / "proximo_jogo.json"

# Configuração da API football-data.org v4
API_URL = "https://api.football-data.org/v4/competitions/BSA/matches"
ENV_TOKEN_NAME = "FOOTBALL_DATA_API_KEY"
HTTP_TIMEOUT = 30
SPFC_API_ID = 1776
COMPETICAO_NOME = "Brasileirão Série A"

STATUS_FUTUROS = {"TIMED", "SCHEDULED"}
STATUS_IGNORADOS_ESTATISTICAS = {
    "IN_PLAY",
    "PAUSED",
    "POSTPONED",
    "SUSPENDED",
    "CANCELLED",
}

# Fuso horário oficial de Brasília (America/Sao_Paulo)
try:
    BRT = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:
    BRT = timezone(timedelta(hours=-3))

# De-para explícito dos nomes da football-data.org (name e shortName) para o
# exato padrão de nomes usado na base histórica do Dados Tricolor.
MAPA_TIMES_API: dict[str, str] = {
    # São Paulo
    "São Paulo FC": "São Paulo",
    "Sao Paulo FC": "São Paulo",
    "São Paulo": "São Paulo",
    "Sao Paulo": "São Paulo",
    # Série A 2026 (nomes oficiais football-data.org v4 + shortNames + variantes)
    "CA Mineiro": "Atlético-MG",
    "Clube Atlético Mineiro": "Atlético-MG",
    "Clube Atletico Mineiro": "Atlético-MG",
    "Atlético Mineiro": "Atlético-MG",
    "Atletico Mineiro": "Atlético-MG",
    "Mineiro": "Atlético-MG",
    "Atlético-MG": "Atlético-MG",
    "Atletico-MG": "Atlético-MG",
    "CA Paranaense": "Athletico-PR",
    "Club Athletico Paranaense": "Athletico-PR",
    "Clube Atlético Paranaense": "Athletico-PR",
    "Athletico Paranaense": "Athletico-PR",
    "Atlético Paranaense": "Athletico-PR",
    "Paranaense": "Athletico-PR",
    "Athletico-PR": "Athletico-PR",
    "EC Bahia": "Bahia",
    "Esporte Clube Bahia": "Bahia",
    "Bahia": "Bahia",
    "Botafogo FR": "Botafogo",
    "Botafogo de Futebol e Regatas": "Botafogo",
    "Botafogo-RJ": "Botafogo",
    "Botafogo": "Botafogo",
    "RB Bragantino": "Bragantino",
    "Red Bull Bragantino": "Bragantino",
    "CA Bragantino": "Bragantino",
    "Bragantino": "Bragantino",
    "Chapecoense AF": "Chapecoense",
    "ACF Chapecoense": "Chapecoense",
    "Associação Chapecoense de Futebol": "Chapecoense",
    "Chapecoense": "Chapecoense",
    "SC Corinthians Paulista": "Corinthians",
    "Sport Club Corinthians Paulista": "Corinthians",
    "Corinthians Paulista": "Corinthians",
    "Corinthians": "Corinthians",
    "Coritiba FBC": "Coritiba",
    "Coritiba FC": "Coritiba",
    "Coritiba Foot Ball Club": "Coritiba",
    "Coritiba": "Coritiba",
    "Cruzeiro EC": "Cruzeiro",
    "Cruzeiro Esporte Clube": "Cruzeiro",
    "Cruzeiro": "Cruzeiro",
    "CR Flamengo": "Flamengo",
    "Clube de Regatas do Flamengo": "Flamengo",
    "Flamengo": "Flamengo",
    "Fluminense FC": "Fluminense",
    "Fluminense Football Club": "Fluminense",
    "Fluminense": "Fluminense",
    "Grêmio FBPA": "Grêmio",
    "Gremio FBPA": "Grêmio",
    "Grêmio Foot-Ball Porto Alegrense": "Grêmio",
    "Grêmio": "Grêmio",
    "Gremio": "Grêmio",
    "SC Internacional": "Internacional",
    "Sport Club Internacional": "Internacional",
    "Internacional": "Internacional",
    "Mirassol FC": "Mirassol",
    "Mirassol Futebol Clube": "Mirassol",
    "Mirassol": "Mirassol",
    "SE Palmeiras": "Palmeiras",
    "Sociedade Esportiva Palmeiras": "Palmeiras",
    "Palmeiras": "Palmeiras",
    "Clube do Remo": "Remo",
    "Remo": "Remo",
    "Santos FC": "Santos",
    "Santos Futebol Clube": "Santos",
    "Santos": "Santos",
    "CR Vasco da Gama": "Vasco",
    "Club de Regatas Vasco da Gama": "Vasco",
    "Vasco da Gama": "Vasco",
    "Vasco": "Vasco",
    "EC Vitória": "Vitória",
    "EC Vitoria": "Vitória",
    "Esporte Clube Vitória": "Vitória",
    "Vitória": "Vitória",
    "Vitoria": "Vitória",
    # Demais clubes históricos da Série A / recorrentes da Série B
    "América FC": "América-MG",
    "America FC": "América-MG",
    "América FC (MG)": "América-MG",
    "América Futebol Clube": "América-MG",
    "América Mineiro": "América-MG",
    "America Mineiro": "América-MG",
    "América-MG": "América-MG",
    "America-MG": "América-MG",
    "América FC (RN)": "América-RN",
    "América de Natal": "América-RN",
    "América-RN": "América-RN",
    "America-RN": "América-RN",
    "AC Goianiense": "Atlético-GO",
    "Atlético Clube Goianiense": "Atlético-GO",
    "Atlético Goianiense": "Atlético-GO",
    "Atletico Goianiense": "Atlético-GO",
    "Goianiense": "Atlético-GO",
    "Atlético-GO": "Atlético-GO",
    "Atletico-GO": "Atlético-GO",
    "Avaí FC": "Avaí",
    "Avai FC": "Avaí",
    "Avaí": "Avaí",
    "Avai": "Avaí",
    "Grêmio Barueri": "Barueri",
    "Barueri": "Barueri",
    "Brasiliense FC": "Brasiliense",
    "Brasiliense": "Brasiliense",
    "CS Alagoano": "CSA",
    "CSA": "CSA",
    "Clube de Regatas Brasil": "CRB",
    "CRB": "CRB",
    "Ceará SC": "Ceará",
    "Ceara SC": "Ceará",
    "Ceará": "Ceará",
    "Ceara": "Ceará",
    "Criciúma EC": "Criciúma",
    "Criciuma EC": "Criciúma",
    "Criciúma": "Criciúma",
    "Criciuma": "Criciúma",
    "Cuiabá EC": "Cuiabá",
    "Cuiaba EC": "Cuiabá",
    "Cuiabá": "Cuiabá",
    "Cuiaba": "Cuiabá",
    "Figueirense FC": "Figueirense",
    "Figueirense": "Figueirense",
    "Fortaleza EC": "Fortaleza",
    "Fortaleza Esporte Clube": "Fortaleza",
    "Fortaleza": "Fortaleza",
    "Goiás EC": "Goiás",
    "Goias EC": "Goiás",
    "Goiás": "Goiás",
    "Goias": "Goiás",
    "Grêmio Prudente": "Grêmio Prudente",
    "Gremio Prudente": "Grêmio Prudente",
    "Guarani FC": "Guarani",
    "Guarani": "Guarani",
    "Ipatinga FC": "Ipatinga",
    "Ipatinga": "Ipatinga",
    "Joinville EC": "Joinville",
    "Joinville": "Joinville",
    "EC Juventude": "Juventude",
    "Esporte Clube Juventude": "Juventude",
    "Juventude": "Juventude",
    "Clube Náutico Capibaribe": "Náutico",
    "Náutico": "Náutico",
    "Nautico": "Náutico",
    "Grêmio Novorizontino": "Novorizontino",
    "Novorizontino": "Novorizontino",
    "Operário Ferroviário EC": "Operário-PR",
    "Operário Ferroviário": "Operário-PR",
    "Operário-PR": "Operário-PR",
    "Operario-PR": "Operário-PR",
    "Paraná Clube": "Paraná",
    "Parana Clube": "Paraná",
    "Paraná": "Paraná",
    "Parana": "Paraná",
    "Paysandu SC": "Paysandu",
    "Paysandu": "Paysandu",
    "AA Ponte Preta": "Ponte Preta",
    "Ponte Preta": "Ponte Preta",
    "Associação Portuguesa de Desportos": "Portuguesa",
    "Portuguesa": "Portuguesa",
    "Santa Cruz FC": "Santa Cruz",
    "Santa Cruz": "Santa Cruz",
    "EC Santo André": "Santo André",
    "Santo André": "Santo André",
    "Santo Andre": "Santo André",
    "SC Recife": "Sport",
    "Sport Club do Recife": "Sport",
    "Sport Recife": "Sport",
    "Recife": "Sport",
    "Sport": "Sport",
    "AD São Caetano": "São Caetano",
    "São Caetano": "São Caetano",
    "Sao Caetano": "São Caetano",
    "Vila Nova FC": "Vila Nova",
    "Vila Nova": "Vila Nova",
}

# UF oficial de cada clube normalizado (compatível com o campo `adversario_estado`)
ESTADOS_TIMES: dict[str, str] = {
    "América-MG": "MG",
    "América-RN": "RN",
    "Athletico-PR": "PR",
    "Atlético-GO": "GO",
    "Atlético-MG": "MG",
    "Avaí": "SC",
    "Bahia": "BA",
    "Barueri": "SP",
    "Botafogo": "RJ",
    "Bragantino": "SP",
    "Brasiliense": "DF",
    "CSA": "AL",
    "CRB": "AL",
    "Ceará": "CE",
    "Chapecoense": "SC",
    "Corinthians": "SP",
    "Coritiba": "PR",
    "Criciúma": "SC",
    "Cruzeiro": "MG",
    "Cuiabá": "MT",
    "Figueirense": "SC",
    "Flamengo": "RJ",
    "Fluminense": "RJ",
    "Fortaleza": "CE",
    "Goiás": "GO",
    "Grêmio": "RS",
    "Grêmio Prudente": "SP",
    "Guarani": "SP",
    "Internacional": "RS",
    "Ipatinga": "MG",
    "Joinville": "SC",
    "Juventude": "RS",
    "Mirassol": "SP",
    "Náutico": "PE",
    "Novorizontino": "SP",
    "Operário-PR": "PR",
    "Palmeiras": "SP",
    "Paraná": "PR",
    "Paysandu": "PA",
    "Ponte Preta": "SP",
    "Portuguesa": "SP",
    "Remo": "PA",
    "Santa Cruz": "PE",
    "Santo André": "SP",
    "Santos": "SP",
    "Sport": "PE",
    "São Caetano": "SP",
    "São Paulo": "SP",
    "Vasco": "RJ",
    "Vila Nova": "GO",
    "Vitória": "BA",
}

# Arena padrão quando a API não informar o campo `venue`
ARENA_CASA_SPFC = "MorumBIS, São Paulo"
ARENA_FORA_FALLBACK = "Estádio não informado"

ARENAS_PADRAO_POR_CLUBE: dict[str, str] = {
    "América-MG": "Arena Independência, Belo Horizonte",
    "América-RN": "Arena das Dunas, Natal",
    "Athletico-PR": "Ligga Arena, Curitiba",
    "Atlético-GO": "Estádio Antônio Accioly, Goiânia",
    "Atlético-MG": "Arena MRV, Belo Horizonte",
    "Avaí": "Ressacada, Florianópolis",
    "Bahia": "Arena Fonte Nova, Salvador",
    "Barueri": "Arena Barueri, Barueri",
    "Botafogo": "Estádio Nilton Santos, Rio de Janeiro",
    "Bragantino": "Estádio Municipal Cícero de Souza Marques, Bragança Paulista",
    "Ceará": "Arena Castelão, Fortaleza",
    "Chapecoense": "Arena Condá, Chapecó",
    "Corinthians": "Neo Química Arena, São Paulo",
    "Coritiba": "Couto Pereira, Curitiba",
    "Criciúma": "Heriberto Hülse, Criciúma",
    "Cruzeiro": "Mineirão, Belo Horizonte",
    "Cuiabá": "Arena Pantanal, Cuiabá",
    "Figueirense": "Orlando Scarpelli, Florianópolis",
    "Flamengo": "Maracanã, Rio de Janeiro",
    "Fluminense": "Maracanã, Rio de Janeiro",
    "Fortaleza": "Arena Castelão, Fortaleza",
    "Goiás": "Serrinha, Goiânia",
    "Grêmio": "Arena do Grêmio, Porto Alegre",
    "Guarani": "Brinco de Ouro, Campinas",
    "Internacional": "Estádio Beira-Rio, Porto Alegre",
    "Juventude": "Alfredo Jaconi, Caxias do Sul",
    "Mirassol": "Campos Maia, Mirassol",
    "Náutico": "Aflitos, Recife",
    "Novorizontino": "Jorge Ismael de Biasi, Novo Horizonte",
    "Operário-PR": "Germano Krüger, Ponta Grossa",
    "Palmeiras": "Allianz Parque, São Paulo",
    "Paysandu": "Curuzu, Belém",
    "Ponte Preta": "Moisés Lucarelli, Campinas",
    "Portuguesa": "Estádio do Canindé, São Paulo",
    "Remo": "Mangueirão, Belém",
    "Santos": "Estádio Urbano Caldeira, Santos",
    "Sport": "Ilha do Retiro, Recife",
    "São Paulo": ARENA_CASA_SPFC,
    "Vasco": "Estádio São Januário, Rio de Janeiro",
    "Vila Nova": "Onésio Brasileiro Alvarenga, Goiânia",
    "Vitória": "Barradão, Salvador",
}


def _normalizar_chave(texto: str) -> str:
    """Remove acentos, converte para minúsculas e colapsa espaços para lookup seguro."""
    nfd = unicodedata.normalize("NFD", texto)
    sem_acentos = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return " ".join(sem_acentos.lower().split())


def _limpar_texto(valor: Any) -> str:
    """Normaliza espaços e NBSP de uma string sem criar espaços duplicados."""
    return " ".join(str(valor or "").replace("\xa0", " ").split())


# Índice normalizado (case/accent-insensitive) derivado de MAPA_TIMES_API
_MAPA_TIMES_NORM: dict[str, str] = {
    _normalizar_chave(chave): valor for chave, valor in MAPA_TIMES_API.items()
}


def obter_api_key() -> str:
    """Lê a chave da API exclusivamente da variável de ambiente FOOTBALL_DATA_API_KEY."""
    token = (os.getenv(ENV_TOKEN_NAME) or "").strip()
    if not token:
        raise EnvironmentError(
            f"Variável de ambiente '{ENV_TOKEN_NAME}' não definida ou vazia.\n"
            f"Configure o token da football-data.org antes de executar este script:\n"
            f'  Linux/macOS: export {ENV_TOKEN_NAME}="SEU_TOKEN_AQUI"\n'
            f'  PowerShell:  $env:{ENV_TOKEN_NAME}="SEU_TOKEN_AQUI"\n'
            "Nunca salve chaves de API em arquivos versionados no repositório."
        )
    return token


def eh_sao_paulo(team: dict[str, Any] | None) -> bool:
    """Identifica de forma segura se o objeto de equipe corresponde ao São Paulo FC."""
    if not isinstance(team, dict):
        return False

    team_id = team.get("id")
    if isinstance(team_id, int) and not isinstance(team_id, bool) and team_id == SPFC_API_ID:
        return True

    for campo in ("name", "shortName"):
        texto = _limpar_texto(team.get(campo))
        if texto and "sao paulo" in _normalizar_chave(texto):
            return True

    return False


def normalizar_clube_api(team: dict[str, Any] | None) -> tuple[str, bool]:
    """
    Mapeia um clube retornado pela football-data.org para o padrão exato da base
    histórica do projeto.

    Retorna `(nome_normalizado, mapeado_explicitamente)`. Quando um clube inédito
    não constar em `MAPA_TIMES_API`, usa `shortName` (ou `name` limpo) e emite
    aviso claro em stderr.
    """
    if not isinstance(team, dict):
        return "", False

    nome = _limpar_texto(team.get("name"))
    short_name = _limpar_texto(team.get("shortName"))

    # 1. Busca exata (prioriza `name` para evitar ambiguidades de shortName)
    for candidato in (nome, short_name):
        if candidato and candidato in MAPA_TIMES_API:
            return MAPA_TIMES_API[candidato], True

    # 2. Busca tolerante a caixa/acentos
    for candidato in (nome, short_name):
        if candidato:
            chave = _normalizar_chave(candidato)
            if chave in _MAPA_TIMES_NORM:
                return _MAPA_TIMES_NORM[chave], True

    # 3. Fallback limpo + aviso explícito para manutenção futura
    fallback = short_name or nome
    print(
        f"[AVISO] Clube não encontrado em MAPA_TIMES_API: "
        f"id={team.get('id')!r}, name={nome!r}, shortName={short_name!r}, "
        f"tla={team.get('tla')!r}. Utilizando fallback '{fallback}'. "
        "Adicione este clube a MAPA_TIMES_API para evitar duplicações nos filtros.",
        file=sys.stderr,
    )
    return fallback, False


def converter_data_hora_api(
    utc_date: str,
    status: str,
) -> tuple[str, str | None, bool]:
    """
    Converte `utcDate` da football-data.org para o fuso `America/Sao_Paulo` (BRT).

    Regras críticas:
    - Para jogos `SCHEDULED` cuja hora UTC é `00:00:00Z` (horário ainda não
      confirmado pela CBF), preserva a data base sem deslocar para o dia
      anterior e retorna `(YYYY-MM-DD, None, False)`.
    - Para `TIMED`, `FINISHED` (e qualquer horário definido), converte primeiro
      para `America/Sao_Paulo` e só então extrai data (`YYYY-MM-DD`) e hora
      (`HH:MM`), garantindo que jogos noturnos como `00:30:00Z` caiam às `21:30`
      do dia anterior no Brasil.
    """
    texto = _limpar_texto(utc_date)
    if not texto:
        raise ValueError("Campo 'utcDate' ausente ou vazio.")

    dt_utc = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    else:
        dt_utc = dt_utc.astimezone(timezone.utc)

    status_norm = _limpar_texto(status).upper()
    if (
        status_norm == "SCHEDULED"
        and dt_utc.hour == 0
        and dt_utc.minute == 0
        and dt_utc.second == 0
    ):
        return dt_utc.strftime("%Y-%m-%d"), None, False

    dt_brt = dt_utc.astimezone(BRT)
    return dt_brt.strftime("%Y-%m-%d"), dt_brt.strftime("%H:%M"), True


def extrair_temporada_match(match: dict[str, Any], data_brt: str) -> int:
    """Deriva o ano da temporada a partir de `season.startDate` ou da data BRT."""
    season = match.get("season")
    if isinstance(season, dict):
        start_date = _limpar_texto(season.get("startDate"))
        if len(start_date) >= 4 and start_date[:4].isdigit():
            return int(start_date[:4])

    ano = int(data_brt[:4])
    mes = int(data_brt[5:7])
    if ano == 2021 and mes <= 2:
        return 2020
    return ano


def resolver_arena_api(
    mando: str,
    adversario: str,
    venue_api: Any = None,
) -> str:
    """Resolve a arena de forma compatível com o schema obrigatório do projeto."""
    venue_limpo = _limpar_texto(venue_api)
    if venue_limpo:
        return venue_limpo
    if mando == "Casa":
        return ARENA_CASA_SPFC
    return ARENAS_PADRAO_POR_CLUBE.get(adversario, ARENA_FORA_FALLBACK)


def _eh_inteiro_valido(valor: Any) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def consultar_partidas_bsa(
    token: str,
    temporada: int | None = None,
) -> list[dict[str, Any]]:
    """
    Executa uma única requisição GET na API football-data.org v4 (`/competitions/BSA/matches`).

    Trata explicitamente erros 401, 403, 429, 5xx e falhas de rede/JSON.
    """
    headers = {
        "X-Auth-Token": token,
        "Accept": "application/json",
        "User-Agent": "DadosTricolor-ETL/1.0 (+https://dadostricolor.live)",
    }
    params: dict[str, Any] | None = {"season": temporada} if temporada is not None else None

    try:
        resp = requests.get(
            API_URL,
            headers=headers,
            params=params,
            timeout=HTTP_TIMEOUT,
        )
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Tempo limite ({HTTP_TIMEOUT}s) excedido ao consultar {API_URL}: {exc}"
        ) from exc
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Erro de conexão ao acessar a API football-data.org ({API_URL}): {exc}"
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(
            f"Falha de rede na requisição à API football-data.org: {exc}"
        ) from exc

    status_code = resp.status_code
    if status_code == 401:
        raise RuntimeError(
            "HTTP 401 (Unauthorized): token FOOTBALL_DATA_API_KEY inválido ou ausente. "
            "Verifique sua chave em https://www.football-data.org/."
        )
    if status_code == 403:
        raise RuntimeError(
            "HTTP 403 (Forbidden): sua chave não tem permissão para acessar a competição BSA "
            "na football-data.org v4."
        )
    if status_code == 429:
        retry_after = resp.headers.get("X-RequestCounter-Reset") or resp.headers.get("Retry-After")
        detalhe = f" Tente novamente em ~{retry_after}s." if retry_after else ""
        raise RuntimeError(
            f"HTTP 429 (Too Many Requests): limite de requisições da football-data.org excedido.{detalhe}"
        )
    if 500 <= status_code <= 599:
        raise RuntimeError(
            f"HTTP {status_code}: erro interno no servidor da football-data.org. Tente novamente mais tarde."
        )
    if status_code != 200:
        raise RuntimeError(
            f"HTTP {status_code} inesperado ao consultar {API_URL}: {resp.text[:300]}"
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise RuntimeError(f"Resposta da API não é um JSON válido: {exc}") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("matches"), list):
        raise RuntimeError("Estrutura inesperada na resposta da API: lista 'matches' ausente.")

    return payload["matches"]


def filtrar_partidas_spfc(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retorna apenas partidas em que o São Paulo FC é mandante ou visitante."""
    return [
        m
        for m in matches
        if isinstance(m, dict)
        and (eh_sao_paulo(m.get("homeTeam")) or eh_sao_paulo(m.get("awayTeam")))
    ]


def extrair_partida_encerrada_api(match: dict[str, Any]) -> dict[str, Any] | None:
    """
    Converte um match `FINISHED` da API no schema v1 de 29 campos do projeto.

    Retorna None caso o status não seja `FINISHED` ou o placar `fullTime` não
    contenha inteiros válidos >= 0.
    """
    status = _limpar_texto(match.get("status")).upper()
    if status != "FINISHED":
        return None

    full_time = (match.get("score") or {}).get("fullTime") or {}
    home_goals = full_time.get("home")
    away_goals = full_time.get("away")
    if not (_eh_inteiro_valido(home_goals) and _eh_inteiro_valido(away_goals)):
        return None
    if home_goals < 0 or away_goals < 0:
        return None

    match_id = match.get("id")
    rodada = match.get("matchday")
    if not (_eh_inteiro_valido(match_id) and _eh_inteiro_valido(rodada) and rodada >= 1):
        return None

    home_team = match.get("homeTeam") or {}
    away_team = match.get("awayTeam") or {}
    spfc_em_casa = eh_sao_paulo(home_team)
    spfc_fora = eh_sao_paulo(away_team)
    if spfc_em_casa == spfc_fora:
        return None

    if spfc_em_casa:
        mando = "Casa"
        adv_team = away_team
        gols_pro = int(home_goals)
        gols_contra = int(away_goals)
    else:
        mando = "Fora"
        adv_team = home_team
        gols_pro = int(away_goals)
        gols_contra = int(home_goals)

    adversario, _ = normalizar_clube_api(adv_team)
    if not adversario or _normalizar_chave(adversario) == "sao paulo":
        return None

    adversario_estado = ESTADOS_TIMES.get(adversario)
    if adversario_estado is None:
        print(
            f"[AVISO] UF desconhecida para adversário '{adversario}' em ESTADOS_TIMES.",
            file=sys.stderr,
        )

    data_brt, hora_brt, _ = converter_data_hora_api(str(match.get("utcDate") or ""), status)
    temporada = extrair_temporada_match(match, data_brt)
    arena = resolver_arena_api(mando, adversario, match.get("venue"))

    saldo_gols = gols_pro - gols_contra
    if gols_pro > gols_contra:
        resultado, pontos = "V", 3
    elif gols_pro < gols_contra:
        resultado, pontos = "D", 0
    else:
        resultado, pontos = "E", 1

    return {
        "id": int(match_id),
        "temporada": temporada,
        "rodada": int(rodada),
        "data": data_brt,
        "hora": hora_brt or "00:00",
        "mando": mando,
        "adversario": adversario,
        "adversario_estado": adversario_estado,
        "arena": arena,
        "gols_pro": gols_pro,
        "gols_contra": gols_contra,
        "saldo_gols": saldo_gols,
        "resultado": resultado,
        "pontos": pontos,
        "tecnico_spfc": None,
        "formacao_spfc": None,
        "cartoes_amarelos": None,
        "cartoes_vermelhos": None,
        "cartoes_amarelos_adversario": None,
        "cartoes_vermelhos_adversario": None,
        "gols": None,
        "chutes": None,
        "chutes_no_alvo": None,
        "posse_de_bola": None,
        "passes": None,
        "precisao_passes": None,
        "faltas": None,
        "escanteios": None,
        "impedimentos": None,
    }


def selecionar_proximo_jogo(
    matches_spfc: list[dict[str, Any]],
    agora_brt: datetime | None = None,
) -> dict[str, Any] | None:
    """
    Seleciona a partida futura cronologicamente mais próxima do São Paulo FC
    dentre jogos com `status in ("TIMED", "SCHEDULED")`.

    Ignora partidas já encerradas, em andamento, adiadas ou com data anterior
    ao dia atual em Brasília.
    """
    referencia = agora_brt.astimezone(BRT) if agora_brt else datetime.now(BRT)
    hoje_brt_iso = referencia.strftime("%Y-%m-%d")

    candidatos: list[tuple[tuple[str, str, int, int], dict[str, Any]]] = []

    for match in matches_spfc:
        status = _limpar_texto(match.get("status")).upper()
        if status not in STATUS_FUTUROS:
            continue

        utc_date = match.get("utcDate")
        if not utc_date:
            continue

        home_team = match.get("homeTeam") or {}
        away_team = match.get("awayTeam") or {}
        spfc_em_casa = eh_sao_paulo(home_team)
        spfc_fora = eh_sao_paulo(away_team)
        if spfc_em_casa == spfc_fora:
            continue

        mando = "Casa" if spfc_em_casa else "Fora"
        adv_team = away_team if spfc_em_casa else home_team
        adversario, _ = normalizar_clube_api(adv_team)
        if not adversario:
            continue

        data_brt, hora_brt, horario_definido = converter_data_hora_api(str(utc_date), status)
        if data_brt < hoje_brt_iso:
            continue

        temporada = extrair_temporada_match(match, data_brt)
        rodada_raw = match.get("matchday")
        rodada = int(rodada_raw) if _eh_inteiro_valido(rodada_raw) else None
        match_id = int(match["id"]) if _eh_inteiro_valido(match.get("id")) else 0

        registro_proximo = {
            "data": data_brt,
            "hora": hora_brt,
            "horario_definido": horario_definido,
            "adversario": adversario,
            "mando": mando,
            "rodada": rodada,
            "temporada": temporada,
            "competicao": COMPETICAO_NOME,
            "status": status,
        }
        chave_ordem = (data_brt, hora_brt or "23:59", rodada or 999, match_id)
        candidatos.append((chave_ordem, registro_proximo))

    if not candidatos:
        return None

    candidatos.sort(key=lambda item: item[0])
    return candidatos[0][1]


def montar_payload_proximo_jogo(
    proximo: dict[str, Any] | None,
    agora_brt: datetime | None = None,
) -> dict[str, Any]:
    """Monta o JSON leve `docs/data/proximo_jogo.json`."""
    referencia = agora_brt.astimezone(BRT) if agora_brt else datetime.now(BRT)
    return {
        "atualizado_em": referencia.isoformat(timespec="seconds"),
        "tem_proximo_jogo": proximo is not None,
        "proximo_jogo": proximo,
    }


def mesclar_incremental_api(
    existentes: list[dict[str, Any]],
    novos: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, int]:
    """
    Faz merge incremental idempotente das partidas encerradas vindas da API,
    preservando temporadas já coletadas anteriormente.

    Deduplica por `(temporada, rodada)` (e fallback `(data, adversario)`),
    retornando `(lista_ordenada, qtd_novos, qtd_atualizados)`.
    """
    por_chave: dict[tuple[int, int], dict[str, Any]] = {}
    chaves_data_adv: dict[tuple[str, str], tuple[int, int]] = {}

    for p in existentes:
        chave_tr = (int(p["temporada"]), int(p["rodada"]))
        chave_da = (str(p["data"]), str(p["adversario"]))
        por_chave[chave_tr] = dict(p)
        chaves_data_adv[chave_da] = chave_tr

    qtd_novos = 0
    qtd_atualizados = 0

    for p in novos:
        chave_tr = (int(p["temporada"]), int(p["rodada"]))
        chave_da = (str(p["data"]), str(p["adversario"]))
        chave_destino = chave_tr if chave_tr in por_chave else chaves_data_adv.get(chave_da)

        if chave_destino is None:
            por_chave[chave_tr] = dict(p)
            chaves_data_adv[chave_da] = chave_tr
            qtd_novos += 1
        else:
            if por_chave[chave_destino] != p:
                antigo = por_chave.pop(chave_destino)
                antiga_da = (str(antigo["data"]), str(antigo["adversario"]))
                if chaves_data_adv.get(antiga_da) == chave_destino:
                    chaves_data_adv.pop(antiga_da, None)
                por_chave[chave_tr] = dict(p)
                chaves_data_adv[chave_da] = chave_tr
                qtd_atualizados += 1

    mescladas = sorted(
        por_chave.values(),
        key=lambda item: (int(item["temporada"]), str(item["data"]), int(item["id"])),
    )
    return mescladas, qtd_novos, qtd_atualizados


def carregar_json_seguro(caminho: Path) -> dict[str, Any] | None:
    """Lê um arquivo JSON caso exista; retorna None caso contrário."""
    if not caminho.exists():
        return None
    with caminho.open("r", encoding="utf-8") as arquivo:
        return json.load(arquivo)


def salvar_json_atomico(payload: dict[str, Any], destino: Path) -> None:
    """Grava JSON UTF-8 de forma atômica (arquivo temporário + os.replace)."""
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


def incremental_alterado(
    anterior: dict[str, Any] | None,
    novo: dict[str, Any],
) -> bool:
    """
    Indica se `data/jogos_api_brasileirao.json` precisa ser reescrito.

    Compara `partidas` e os metadados funcionais ignorando apenas
    `metadata.atualizado_em`, evitando commits fantasma quando nenhum jogo
    encerrado novo ou alterado entrou na base.
    """
    if not isinstance(anterior, dict):
        return True
    if anterior.get("partidas") != novo.get("partidas"):
        return True
    meta_anterior = anterior.get("metadata")
    meta_novo = novo.get("metadata")
    if not isinstance(meta_anterior, dict) or not isinstance(meta_novo, dict):
        return True
    atualizado_anterior = meta_anterior.get("atualizado_em")
    if not isinstance(atualizado_anterior, str) or not atualizado_anterior.strip():
        return True
    meta_ant_funcional = {k: v for k, v in meta_anterior.items() if k != "atualizado_em"}
    meta_novo_funcional = {k: v for k, v in meta_novo.items() if k != "atualizado_em"}
    return meta_ant_funcional != meta_novo_funcional


def proximo_jogo_alterado(
    anterior: dict[str, Any] | None,
    novo: dict[str, Any],
    houve_novos_encerrados: bool = False,
) -> bool:
    """
    Indica se `docs/data/proximo_jogo.json` precisa ser reescrito.

    Retorna False quando o arquivo já existe em disco com schema válido,
    não houve entrada/atualização de jogos encerrados na base e o conteúdo
    funcional (`tem_proximo_jogo` e `proximo_jogo`) é exatamente igual ao
    novo resultado da API — evitando commits fantasma só para alterar
    `atualizado_em`.
    """
    if houve_novos_encerrados:
        return True
    if not isinstance(anterior, dict):
        return True
    if set(anterior.keys()) != {"atualizado_em", "tem_proximo_jogo", "proximo_jogo"}:
        return True
    atualizado_anterior = anterior.get("atualizado_em")
    if not isinstance(atualizado_anterior, str) or not atualizado_anterior.strip():
        return True
    return (
        anterior.get("tem_proximo_jogo") != novo.get("tem_proximo_jogo")
        or anterior.get("proximo_jogo") != novo.get("proximo_jogo")
    )


def atualizar_jogos_api(
    temporada: int | None = None,
    caminho_incremental: Path = API_INCREMENTAL_PATH,
    caminho_proximo_jogo: Path = PROXIMO_JOGO_PATH,
    agora_brt: datetime | None = None,
) -> dict[str, Any]:
    """Orquestra a coleta na football-data.org v4 e grava as saídas incrementais."""
    token = obter_api_key()
    referencia_brt = agora_brt.astimezone(BRT) if agora_brt else datetime.now(BRT)

    todos_matches = consultar_partidas_bsa(token, temporada=temporada)
    matches_spfc = filtrar_partidas_spfc(todos_matches)

    encerrados_api: list[dict[str, Any]] = []
    ignorados_status = 0

    for match in matches_spfc:
        status = _limpar_texto(match.get("status")).upper()
        if status == "FINISHED":
            registro = extrair_partida_encerrada_api(match)
            if registro is not None:
                encerrados_api.append(registro)
        elif status in STATUS_IGNORADOS_ESTATISTICAS:
            ignorados_status += 1

    # 1. Merge incremental idempotente dos jogos encerrados
    anterior = carregar_json_seguro(caminho_incremental)
    partidas_anteriores = (
        anterior.get("partidas", [])
        if isinstance(anterior, dict) and isinstance(anterior.get("partidas"), list)
        else []
    )
    partidas_mescladas, qtd_novos, qtd_atualizados = mesclar_incremental_api(
        partidas_anteriores, encerrados_api
    )

    temporadas_presentes = sorted({int(p["temporada"]) for p in partidas_mescladas})
    payload_incremental = {
        "metadata": {
            "fonte": "football-data.org (v4 / BSA)",
            "clube": "São Paulo FC",
            "competicao": COMPETICAO_NOME,
            "atualizado_em": referencia_brt.isoformat(timespec="seconds"),
            "temporadas": temporadas_presentes,
            "total_partidas": len(partidas_mescladas),
        },
        "partidas": partidas_mescladas,
    }
    incremental_gravado = incremental_alterado(anterior, payload_incremental)
    if incremental_gravado:
        salvar_json_atomico(payload_incremental, caminho_incremental)

    # 2. Seleção e gravação idempotente do próximo jogo em docs/data/proximo_jogo.json
    proximo = selecionar_proximo_jogo(matches_spfc, agora_brt=referencia_brt)
    payload_proximo = montar_payload_proximo_jogo(proximo, agora_brt=referencia_brt)
    proximo_anterior = carregar_json_seguro(caminho_proximo_jogo)
    houve_novos_encerrados = qtd_novos > 0 or qtd_atualizados > 0
    proximo_jogo_gravado = proximo_jogo_alterado(
        proximo_anterior,
        payload_proximo,
        houve_novos_encerrados=houve_novos_encerrados,
    )
    if proximo_jogo_gravado:
        salvar_json_atomico(payload_proximo, caminho_proximo_jogo)

    resumo = {
        "total_spfc_api": len(matches_spfc),
        "encerrados_api": len(encerrados_api),
        "ignorados_status": ignorados_status,
        "total_incremental": len(partidas_mescladas),
        "novos_adicionados": qtd_novos,
        "atualizados": qtd_atualizados,
        "incremental_gravado": incremental_gravado,
        "tem_proximo_jogo": payload_proximo["tem_proximo_jogo"],
        "proximo_jogo": proximo,
        "proximo_jogo_gravado": proximo_jogo_gravado,
    }
    exibir_resumo(resumo, caminho_incremental, caminho_proximo_jogo)
    return resumo


def exibir_resumo(
    resumo: dict[str, Any],
    caminho_incremental: Path,
    caminho_proximo_jogo: Path,
) -> None:
    """Exibe resumo operacional da ingestão incremental via football-data.org."""
    print("=" * 68)
    print("DADOS TRICOLOR — INGESTÃO INCREMENTAL (football-data.org v4 / BSA)")
    print("=" * 68)
    print(f"Partidas do SPFC retornadas pela API: {resumo['total_spfc_api']}")
    print(f"Jogos encerrados (FINISHED válidos):  {resumo['encerrados_api']}")
    print(f"Ignorados (em andamento/adiados):     {resumo['ignorados_status']}")
    status_inc = "gravado" if resumo.get("incremental_gravado", True) else "sem alterações (mantido)"
    print(
        f"Base incremental ({caminho_incremental.name}): "
        f"{resumo['total_incremental']} jogo(s) "
        f"(+{resumo['novos_adicionados']} novo(s), {resumo['atualizados']} atualizado(s)) "
        f"[{status_inc}]"
    )
    status_prox = "gravado" if resumo.get("proximo_jogo_gravado", True) else "sem alterações (mantido)"
    proximo = resumo["proximo_jogo"]
    if proximo:
        hora_txt = proximo["hora"] if proximo["horario_definido"] else "A definir"
        print(
            f"Próximo jogo ({caminho_proximo_jogo.name}): "
            f"R{proximo['rodada']} | {proximo['data']} ({hora_txt}) | "
            f"{proximo['mando']} vs {proximo['adversario']} [{proximo['status']}] "
            f"({status_prox})"
        )
    else:
        print(
            f"Próximo jogo ({caminho_proximo_jogo.name}): "
            f"nenhum jogo agendado no momento (tem_proximo_jogo=false) ({status_prox})"
        )
    print("=" * 68)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ingestão incremental de jogos do São Paulo FC no Brasileirão Série A "
            "via API football-data.org (v4)."
        )
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Temporada opcional (YYYY) enviada como query param '?season=YYYY'. Padrão: temporada corrente da API.",
    )
    args = parser.parse_args()

    try:
        atualizar_jogos_api(temporada=args.season)
    except Exception as exc:
        print(f"[ERRO] {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

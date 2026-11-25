"""
ETL incremental (v2) do projeto Dados Tricolor.

Mantém intacta a base histórica congelada (2003–2025) em
`data/historico_2003_2025.json` e busca os jogos finalizados da temporada
atual (2026) na API pública da ESPN (`bra.1`), utilizando cache/delta para
consultar `/summary?event={id}` apenas para partidas novas ou sem detalhes.

Saídas geradas:
- `docs/data/spfc_pontos_corridos.json` (base completa 2003–2026 no schema v1)
- `docs/data/meta.json` (data/hora da última execução em BRT e contagem de jogos)
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Caminhos do projeto
BASE_DIR = Path(__file__).resolve().parent.parent
HISTORICO_PATH = BASE_DIR / "data" / "historico_2003_2025.json"
OUTPUT_PATH = BASE_DIR / "docs" / "data" / "spfc_pontos_corridos.json"
META_PATH = BASE_DIR / "docs" / "data" / "meta.json"

# Configuração da API pública da ESPN (Brasileirão Série A)
ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1"
ANO_INICIO_ESPN = 2026
TEMPORADA_PADRAO = 2026
HTTP_TIMEOUT = 20

ARENA_CASA_SPFC = "MorumBIS, São Paulo"
ARENA_FORA_FALLBACK = "Estádio não informado"
RE_MINUTO_VALIDO = re.compile(r"^(\d+)(?:\+(\d+))?$")
RE_FORMACAO_VALIDA = re.compile(r"^\d+(-\d+)+$")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

# Fuso horário de Brasília (BRT, UTC-3)
try:
    BRT = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:
    BRT = timezone(timedelta(hours=-3))

# Normalização dos nomes de clubes retornados pela ESPN para o exato padrão
# da base histórica (2003–2025), evitando duplicações nos filtros do front-end.
MAPA_TIMES: dict[str, str] = {
    # Clubes confirmados na Série A 2026 (API ESPN)
    "Athletico Paranaense": "Athletico-PR",
    "Athletico-PR": "Athletico-PR",
    "Atlético Paranaense": "Athletico-PR",
    "Atlético-MG": "Atlético-MG",
    "Atlético Mineiro": "Atlético-MG",
    "Atletico-MG": "Atlético-MG",
    "Atletico Mineiro": "Atlético-MG",
    "Bahia": "Bahia",
    "Botafogo": "Botafogo",
    "Botafogo-RJ": "Botafogo",
    "Chapecoense": "Chapecoense",
    "Corinthians": "Corinthians",
    "Coritiba": "Coritiba",
    "Cruzeiro": "Cruzeiro",
    "Flamengo": "Flamengo",
    "Fluminense": "Fluminense",
    "Grêmio": "Grêmio",
    "Gremio": "Grêmio",
    "Internacional": "Internacional",
    "Mirassol": "Mirassol",
    "Palmeiras": "Palmeiras",
    "Red Bull Bragantino": "Bragantino",
    "RB Bragantino": "Bragantino",
    "Bragantino": "Bragantino",
    "Remo": "Remo",
    "Clube do Remo": "Remo",
    "Santos": "Santos",
    "São Paulo": "São Paulo",
    "Sao Paulo": "São Paulo",
    "Vasco da Gama": "Vasco",
    "Vasco": "Vasco",
    "Vitória": "Vitória",
    "Vitoria": "Vitória",
    # Outros clubes recorrentes da Série A / B para compatibilidade futura
    "América-MG": "América-MG",
    "América Mineiro": "América-MG",
    "America-MG": "América-MG",
    "America Mineiro": "América-MG",
    "Atlético-GO": "Atlético-GO",
    "Atlético Goianiense": "Atlético-GO",
    "Atletico-GO": "Atlético-GO",
    "Atletico Goianiense": "Atlético-GO",
    "Avaí": "Avaí",
    "Avai": "Avaí",
    "Ceará": "Ceará",
    "Ceara": "Ceará",
    "Criciúma": "Criciúma",
    "Criciuma": "Criciúma",
    "Cuiabá": "Cuiabá",
    "Cuiaba": "Cuiabá",
    "Fortaleza": "Fortaleza",
    "Goiás": "Goiás",
    "Goias": "Goiás",
    "Juventude": "Juventude",
    "Sport": "Sport",
    "Sport Recife": "Sport",
    "Ponte Preta": "Ponte Preta",
    "Guarani": "Guarani",
    "Náutico": "Náutico",
    "Nautico": "Náutico",
    "Paysandu": "Paysandu",
    "Figueirense": "Figueirense",
    "Paraná": "Paraná",
    "Parana": "Paraná",
    "Santa Cruz": "Santa Cruz",
    "CSA": "CSA",
    "CRB": "CRB",
    "Novorizontino": "Novorizontino",
    "Vila Nova": "Vila Nova",
    "Operário-PR": "Operário-PR",
    "Operario-PR": "Operário-PR",
    "Operário Ferroviário": "Operário-PR",
}

# UF de cada clube normalizado (usado no campo `adversario_estado` do schema v1)
ESTADOS_TIMES: dict[str, str] = {
    "América-MG": "MG",
    "América-RN": "RN",
    "Athletico-PR": "PR",
    "Atlético-GO": "GO",
    "Atlético-MG": "MG",
    "Avaí": "SC",
    "Bahia": "BA",
    "Botafogo": "RJ",
    "Bragantino": "SP",
    "Ceará": "CE",
    "Chapecoense": "SC",
    "Corinthians": "SP",
    "Coritiba": "PR",
    "CRB": "AL",
    "Criciúma": "SC",
    "Cruzeiro": "MG",
    "CSA": "AL",
    "Cuiabá": "MT",
    "Figueirense": "SC",
    "Flamengo": "RJ",
    "Fluminense": "RJ",
    "Fortaleza": "CE",
    "Goiás": "GO",
    "Grêmio": "RS",
    "Guarani": "SP",
    "Internacional": "RS",
    "Juventude": "RS",
    "Mirassol": "SP",
    "Náutico": "PE",
    "Novorizontino": "SP",
    "Operário-PR": "PR",
    "Palmeiras": "SP",
    "Paraná": "PR",
    "Paysandu": "PA",
    "Ponte Preta": "SP",
    "Remo": "PA",
    "Santa Cruz": "PE",
    "Santos": "SP",
    "São Paulo": "SP",
    "Sport": "PE",
    "Vasco": "RJ",
    "Vila Nova": "GO",
    "Vitória": "BA",
}

# Padronização de atletas do SPFC da ESPN para unificar com a base histórica 2014–2025
MAPA_ATLETAS: dict[str, str] = {
    "Ferreira": "Ferreirinha",
    "Aldemir Ferreira": "Ferreirinha",
    "Marcos Antonio": "Marcos Antônio",
    "Joao Victor": "João Victor",
    "Cédric": "Cédric Soares",
    "Calleri": "Jonathan Calleri",
    "Bobadilla": "Damián Bobadilla",
    "Arboleda": "Robert Arboleda",
    "Luciano da Rocha Neves": "Luciano",
    "Alisson Euler de Freitas Castro": "Alisson",
    "Matheus Dória Macedo": "Dória",
}

# Padronização de estádios retornados pela ESPN para o padrão em português (2025)
MAPA_ARENAS: dict[str, str] = {
    "Estádio Cícero Pompeu de Toledo": "MorumBIS, São Paulo",
    "Allianz Parque": "Allianz Parque, São Paulo",
    "Neo Química Arena": "Neo Química Arena, São Paulo",
    "Estádio do Canindé": "Estádio do Canindé, São Paulo",
    "Estádio Brinco de Ouro da Princesa": "Brinco de Ouro, Campinas",
    "Estádio Vila Belmiro (Urbano Caldeira)": "Estádio Urbano Caldeira, Santos",
    "Estádio Urbano Caldeira": "Estádio Urbano Caldeira, Santos",
    "Estádio Municipal Cicero de Souza Marques": "Estádio Municipal Cícero de Souza Marques, Bragança Paulista",
    "Estadio Municipal José Maria de Campos Maia": "Campos Maia, Mirassol",
    "Estadio do Maracana": "Maracanã, Rio de Janeiro",
    "Estádio do Maracanã": "Maracanã, Rio de Janeiro",
    "Estádio São Januário": "Estádio São Januário, Rio de Janeiro",
    "Estádio Olímpico Nilton Santos": "Estádio Nilton Santos, Rio de Janeiro",
    "Estadio Olimpico Nilton Santos": "Estádio Nilton Santos, Rio de Janeiro",
    "Estádio Nilton Santos": "Estádio Nilton Santos, Rio de Janeiro",
    "Joao Havelange Stadium": "Estádio Nilton Santos, Rio de Janeiro",
    "João Havelange Stadium": "Estádio Nilton Santos, Rio de Janeiro",
    "Estadio Mineirão": "Mineirão, Belo Horizonte",
    "Arena MRV": "Arena MRV, Belo Horizonte",
    "Arena Fonte Nova": "Arena Fonte Nova, Salvador",
    "Estadio Manoel Barradas": "Barradão, Salvador",
    "Arena do Grêmio": "Arena do Grêmio, Porto Alegre",
    "Estadio Beira-Rio": "Estádio Beira-Rio, Porto Alegre",
    "Estádio Alfredo Jaconi": "Alfredo Jaconi, Caxias do Sul",
    "Couto Pereira": "Couto Pereira, Curitiba",
    "Arena da Baixada": "Ligga Arena, Curitiba",
    "Ligga Arena": "Ligga Arena, Curitiba",
    "Estádio Joaquim Américo Guimarães": "Ligga Arena, Curitiba",
    "Estádio Mário Celso Petraglia": "Ligga Arena, Curitiba",
    "Arena Condá": "Arena Condá, Chapecó",
    "Mangueirão": "Mangueirão, Belém",
    "Arena Castelão": "Arena Castelão, Fortaleza",
    "Arena Barueri": "Arena Barueri, Barueri",
}


def criar_sessao_http() -> requests.Session:
    """Cria sessão HTTP com User-Agent de navegador e retries para erros transitórios."""
    sessao = requests.Session()
    sessao.headers.update(HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    adapter = HTTPAdapter(max_retries=retry)
    sessao.mount("https://", adapter)
    sessao.mount("http://", adapter)
    return sessao


def get_json(
    sessao: requests.Session,
    endpoint: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Executa GET na API da ESPN e valida status HTTP + corpo JSON."""
    url = f"{ESPN_BASE_URL}/{endpoint.lstrip('/')}"
    resp = sessao.get(url, params=params, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    dados = resp.json()
    if not isinstance(dados, dict):
        raise ValueError(f"Resposta inesperada (não-objeto JSON) em {url}")
    return dados


def normalizar_nome_time(nome: str, short_name: str | None = None) -> str:
    """Traduz o nome do clube da ESPN para o padrão exato da base histórica."""
    candidatos = [nome.strip()]
    if short_name and short_name.strip():
        candidatos.append(short_name.strip())

    for cand in candidatos:
        if cand in MAPA_TIMES:
            return MAPA_TIMES[cand]

    return nome.strip()


def normalizar_atleta(nome: str | None) -> str:
    """Padroniza o nome do atleta do SPFC para evitar duplicação na artilharia."""
    limpo = " ".join(str(nome or "").split())
    return MAPA_ATLETAS.get(limpo, limpo)


def normalizar_arena(venue: dict[str, Any] | None) -> str | None:
    """Normaliza nome do estádio/arena para o padrão em português da base v1."""
    if not venue or not isinstance(venue, dict):
        return None

    full_name = " ".join(str(venue.get("fullName") or "").split())
    if not full_name:
        return None

    if full_name in MAPA_ARENAS:
        return MAPA_ARENAS[full_name]

    nome = re.sub(r"^Estadio\b", "Estádio", full_name)
    address = venue.get("address")
    cidade_raw = address.get("city") if isinstance(address, dict) else ""
    cidade = " ".join(str(cidade_raw or "").split())
    if cidade == "Sao Paulo":
        cidade = "São Paulo"

    if cidade and cidade.lower() not in nome.lower():
        return f"{nome}, {cidade}"
    return nome


def normalizar_minuto(clock_str: str | None) -> str:
    """Converte o relógio da ESPN (ex.: \"90'+4'\", \"61'\") para o padrão v1 (\"90+4\", \"61\")."""
    if not clock_str:
        return ""
    limpo = re.sub(r"['\s]", "", str(clock_str))
    match = RE_MINUTO_VALIDO.fullmatch(limpo)
    if match and match.group(2) is None:
        base = int(match.group(1))
        if 91 <= base <= 120:
            return f"90+{base - 90}"
    return limpo


def minuto_valido_v1(minuto: str) -> bool:
    """Verifica se o minuto está no formato v1 plausível (1..90 e acréscimo 0..30)."""
    match = RE_MINUTO_VALIDO.fullmatch(minuto or "")
    if not match:
        return False
    base = int(match.group(1))
    acr = int(match.group(2)) if match.group(2) is not None else 0
    return 1 <= base <= 90 and 0 <= acr <= 30


def chave_ordenacao_minuto(minuto: str) -> tuple[int, int]:
    """Ordena minutos como '45+2' ou '90' cronologicamente."""
    partes = minuto.split("+")
    try:
        base = int(partes[0])
        acrescimo = int(partes[1]) if len(partes) > 1 else 0
        return (base, acrescimo)
    except ValueError:
        return (999, 0)


def parse_int_ou_none(valor: Any) -> int | None:
    """Converte número/string em int ou None de forma segura (rejeitando bool/NaN/Inf)."""
    if valor is None or valor == "" or isinstance(valor, bool):
        return None
    try:
        num = float(str(valor).replace(",", ".").rstrip("%").strip())
        if not math.isfinite(num):
            return None
        return int(round(num))
    except (ValueError, TypeError, OverflowError):
        return None


def parse_nonneg_int_ou_none(valor: Any) -> int | None:
    """Converte para inteiro >= 0 ou None."""
    num = parse_int_ou_none(valor)
    return num if num is not None and num >= 0 else None


def parse_pct_ou_none(valor: Any) -> int | None:
    """Converte para percentual inteiro em 0..100 ou None."""
    num = parse_int_ou_none(valor)
    return num if num is not None and 0 <= num <= 100 else None


def converter_data_hora_brt(iso_utc: str) -> tuple[str, str]:
    """Converte timestamp UTC da ESPN (ex.: '2026-11-20T00:30Z') para (YYYY-MM-DD, HH:MM) em BRT."""
    dt_utc = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    dt_brt = dt_utc.astimezone(BRT)
    return dt_brt.strftime("%Y-%m-%d"), dt_brt.strftime("%H:%M")


def descobrir_id_spfc(sessao: requests.Session, temporada: int) -> str:
    """Consulta `/teams` na ESPN e retorna o ID numérico do São Paulo FC."""
    dados = get_json(sessao, "teams", params={"season": temporada})

    for sport in dados.get("sports", []):
        for league in sport.get("leagues", []):
            for item in league.get("teams", []):
                team = item.get("team", item)
                nome = str(team.get("displayName") or team.get("name") or "").lower()
                abbr = str(team.get("abbreviation") or "").upper()
                if "são paulo" in nome or "sao paulo" in nome or abbr == "SAO":
                    team_id = str(team.get("id") or "").strip()
                    if team_id:
                        return team_id

    raise RuntimeError(
        f"Não foi possível localizar o São Paulo FC em /teams?season={temporada}."
    )


def buscar_agenda_temporada(
    sessao: requests.Session,
    spfc_id: str,
    temporada: int,
) -> tuple[list[dict[str, Any]], dict[int, int]]:
    """
    Busca a agenda do SPFC na temporada e calcula o mapa `event_id -> rodada`.

    A ESPN separa jogos já realizados (`/schedule?season=YYYY`) de jogos
    futuros (`/schedule?season=YYYY&fixture=true`). Combinando todos os IDs da
    temporada em ordem crescente obtemos a rodada oficial exata (1 a 38),
    inclusive quando há jogos adiados fora de ordem cronológica.
    """
    sched = get_json(sessao, f"teams/{spfc_id}/schedule", params={"season": temporada})
    eventos_passados = sched.get("events")
    if not isinstance(eventos_passados, list):
        raise ValueError("Campo 'events' ausente ou inválido na resposta de /schedule.")

    # Busca jogos futuros (fixtures) apenas para compor a numeração oficial das 38 rodadas
    eventos_futuros: list[dict[str, Any]] = []
    try:
        fix = get_json(
            sessao,
            f"teams/{spfc_id}/schedule",
            params={"season": temporada, "fixture": "true"},
        )
        if isinstance(fix.get("events"), list):
            eventos_futuros = fix["events"]
    except (requests.RequestException, ValueError) as exc:
        print(
            f"[AVISO] Não foi possível consultar fixtures futuros (usando apenas agenda principal): {exc}",
            file=sys.stderr,
        )

    todos_por_id: dict[int, dict[str, Any]] = {}
    for ev in eventos_passados + eventos_futuros:
        if not isinstance(ev, dict) or ev.get("id") is None:
            continue
        try:
            ev_id = int(ev["id"])
        except (ValueError, TypeError):
            continue
        todos_por_id[ev_id] = ev

    mapa_rodadas: dict[int, int] = {}
    for idx, ev_id in enumerate(sorted(todos_por_id.keys()), start=1):
        ev = todos_por_id[ev_id]
        week = ev.get("week")
        week_num = week.get("number") if isinstance(week, dict) else week
        if isinstance(week_num, int) and not isinstance(week_num, bool) and week_num > 0:
            mapa_rodadas[ev_id] = week_num
        elif isinstance(week_num, str) and week_num.isdigit() and int(week_num) > 0:
            mapa_rodadas[ev_id] = int(week_num)
        else:
            mapa_rodadas[ev_id] = idx

    # Filtra apenas partidas finalizadas (`completed == True`)
    concluidos: list[dict[str, Any]] = []
    for ev in todos_por_id.values():
        comps = ev.get("competitions") or []
        if not comps or not isinstance(comps[0], dict):
            continue
        status_obj = comps[0].get("status")
        status_type = status_obj.get("type") if isinstance(status_obj, dict) else None
        if isinstance(status_type, dict) and status_type.get("completed") is True:
            concluidos.append(ev)

    concluidos.sort(key=lambda e: (str(e.get("date", "")), int(e["id"])))
    return concluidos, mapa_rodadas


def extrair_placar_competitor(comp: dict[str, Any]) -> int:
    """Extrai o placar inteiro de um competidor (formato schedule ou summary)."""
    score = comp.get("score")
    if isinstance(score, dict):
        val = score.get("value")
        if val is not None:
            return int(round(float(val)))
        val = score.get("displayValue")
        if val is not None:
            return int(val)
    if score is not None:
        return int(round(float(score)))
    raise ValueError(f"Placar ausente para competidor {comp.get('id')}")


def extrair_dados_basicos_evento(
    ev: dict[str, Any],
    spfc_id: str,
    temporada: int,
    rodada: int,
) -> dict[str, Any]:
    """Extrai campos básicos da partida diretamente do endpoint `/schedule`."""
    ev_id = int(ev["id"])
    comp = ev["competitions"][0]
    competitors = comp.get("competitors", [])

    sp_comp = next(
        (c for c in competitors if isinstance(c, dict) and str((c.get("team") or {}).get("id")) == spfc_id),
        None,
    )
    adv_comp = next(
        (c for c in competitors if isinstance(c, dict) and str((c.get("team") or {}).get("id")) != spfc_id),
        None,
    )
    if not sp_comp or not adv_comp:
        raise ValueError(f"Competidores inválidos no evento {ev_id}.")

    mando = "Casa" if sp_comp.get("homeAway") == "home" else "Fora"
    adv_team = adv_comp.get("team") or {}
    adversario = normalizar_nome_time(
        str(adv_team.get("displayName") or adv_team.get("name") or ""),
        adv_team.get("shortDisplayName"),
    )
    adversario_estado = ESTADOS_TIMES.get(adversario)
    if adversario_estado is None:
        print(
            f"[AVISO] Clube '{adversario}' (evento {ev_id}) não possui UF mapeada em ESTADOS_TIMES.",
            file=sys.stderr,
        )

    gols_pro = extrair_placar_competitor(sp_comp)
    gols_contra = extrair_placar_competitor(adv_comp)
    saldo_gols = gols_pro - gols_contra

    if gols_pro > gols_contra:
        resultado, pontos = "V", 3
    elif gols_pro < gols_contra:
        resultado, pontos = "D", 0
    else:
        resultado, pontos = "E", 1

    data_brt, hora_brt = converter_data_hora_brt(str(ev["date"]))
    arena = normalizar_arena(comp.get("venue"))

    return {
        "id": ev_id,
        "temporada": temporada,
        "rodada": rodada,
        "data": data_brt,
        "hora": hora_brt,
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


def partida_tem_detalhes(partida: dict[str, Any]) -> bool:
    """Verifica se uma partida em cache já possui detalhes completos (gols, cartões e stats)."""
    gols = partida.get("gols")
    if not isinstance(gols, list):
        return False
    if len(gols) != partida.get("gols_pro"):
        return False

    campos_obrigatorios = (
        "cartoes_amarelos",
        "cartoes_vermelhos",
        "cartoes_amarelos_adversario",
        "cartoes_vermelhos_adversario",
        "chutes",
    )
    return all(partida.get(campo) is not None for campo in campos_obrigatorios)


def extrair_gols_spfc(summary: dict[str, Any], spfc_id: str) -> list[dict[str, Any]]:
    """Extrai os gols a favor do SPFC no exato schema v1 a partir de `/summary`."""
    gols: list[dict[str, Any]] = []

    header = summary.get("header")
    hcomps = (header.get("competitions") if isinstance(header, dict) else None) or []
    hcomp = hcomps[0] if hcomps and isinstance(hcomps[0], dict) else {}
    details = hcomp.get("details") or []

    if details:
        for d in details:
            if not isinstance(d, dict) or not d.get("scoringPlay"):
                continue
            if str((d.get("team") or {}).get("id")) != spfc_id:
                continue

            eh_gol_contra = bool(d.get("ownGoal"))
            eh_penalti = bool(d.get("penaltyKick"))
            if eh_gol_contra:
                tipo = "Gol contra"
            elif eh_penalti:
                tipo = "Pênalti"
            else:
                tipo = "Normal"

            participantes = d.get("participants") or []
            primeiro_part = participantes[0] if participantes and isinstance(participantes[0], dict) else {}
            atleta_raw = (primeiro_part.get("athlete") or {}).get("displayName") or ""
            jogador = (
                " ".join(str(atleta_raw or "").split())
                if eh_gol_contra
                else normalizar_atleta(atleta_raw)
            )
            minuto = normalizar_minuto((d.get("clock") or {}).get("displayValue"))

            gols.append(
                {
                    "jogador": jogador,
                    "minuto": minuto,
                    "tipo": tipo,
                    "gol_contra": eh_gol_contra,
                }
            )
    else:
        # Fallback para keyEvents caso `header.competitions[0].details` esteja ausente
        for ke in summary.get("keyEvents") or []:
            if not isinstance(ke, dict) or not ke.get("scoringPlay"):
                continue
            if str((ke.get("team") or {}).get("id")) != spfc_id:
                continue

            tipo_slug = str((ke.get("type") or {}).get("type") or "").lower()
            eh_gol_contra = bool(ke.get("ownGoal")) or tipo_slug == "own-goal"
            eh_penalti = bool(ke.get("penaltyKick")) or tipo_slug == "penalty---scored"
            if eh_gol_contra:
                tipo = "Gol contra"
            elif eh_penalti:
                tipo = "Pênalti"
            else:
                tipo = "Normal"

            participantes = ke.get("participants") or []
            primeiro_part = participantes[0] if participantes and isinstance(participantes[0], dict) else {}
            atleta_raw = (primeiro_part.get("athlete") or {}).get("displayName") or ""
            jogador = (
                " ".join(str(atleta_raw or "").split())
                if eh_gol_contra
                else normalizar_atleta(atleta_raw)
            )
            minuto = normalizar_minuto((ke.get("clock") or {}).get("displayValue"))
            gols.append(
                {
                    "jogador": jogador,
                    "minuto": minuto,
                    "tipo": tipo,
                    "gol_contra": eh_gol_contra,
                }
            )

    gols.sort(key=lambda item: chave_ordenacao_minuto(item["minuto"]))
    return gols


def extrair_cartoes_e_stats(
    summary: dict[str, Any],
    spfc_id: str,
) -> dict[str, Any]:
    """
    Extrai cartões (SPFC e adversário), formação tática e estatísticas técnicas.

    Para cartões, cruza `keyEvents` (que preserva o 1º amarelo em expulsões por
    segundo amarelo, assim como `cartoes.csv` de 2014–2024) com `boxscore.teams`,
    garantindo fidelidade máxima e fallback seguro.
    """
    bs_sp: dict[str, str] = {}
    bs_adv: dict[str, str] = {}

    boxscore = summary.get("boxscore")
    bs_teams = (boxscore.get("teams") if isinstance(boxscore, dict) else None) or []
    for bt in bs_teams:
        if not isinstance(bt, dict):
            continue
        tid = str((bt.get("team") or {}).get("id") or "")
        st_map = {
            str(s.get("name")): str(s.get("displayValue"))
            for s in (bt.get("statistics") or [])
            if isinstance(s, dict) and s.get("name")
        }
        if tid == spfc_id:
            bs_sp = st_map
        elif tid:
            bs_adv = st_map

    # Cartões via boxscore
    bs_am_sp = parse_nonneg_int_ou_none(bs_sp.get("yellowCards"))
    bs_vm_sp = parse_nonneg_int_ou_none(bs_sp.get("redCards"))
    bs_am_adv = parse_nonneg_int_ou_none(bs_adv.get("yellowCards"))
    bs_vm_adv = parse_nonneg_int_ou_none(bs_adv.get("redCards"))

    # Cartões via keyEvents (eventos cronológicos individuais)
    key_events = summary.get("keyEvents") or []
    if key_events:
        ke_am_sp = ke_vm_sp = ke_am_adv = ke_vm_adv = 0
        for ke in key_events:
            if not isinstance(ke, dict):
                continue
            tipo = str((ke.get("type") or {}).get("type") or "")
            ktid = str((ke.get("team") or {}).get("id") or "")
            if not ktid:
                continue
            if tipo == "yellow-card":
                if ktid == spfc_id:
                    ke_am_sp += 1
                else:
                    ke_am_adv += 1
            elif tipo == "red-card":
                if ktid == spfc_id:
                    ke_vm_sp += 1
                else:
                    ke_vm_adv += 1

        am_sp = max(ke_am_sp, bs_am_sp) if bs_am_sp is not None else ke_am_sp
        vm_sp = max(ke_vm_sp, bs_vm_sp) if bs_vm_sp is not None else ke_vm_sp
        am_adv = max(ke_am_adv, bs_am_adv) if bs_am_adv is not None else ke_am_adv
        vm_adv = max(ke_vm_adv, bs_vm_adv) if bs_vm_adv is not None else ke_vm_adv
    else:
        am_sp, vm_sp, am_adv, vm_adv = bs_am_sp, bs_vm_sp, bs_am_adv, bs_vm_adv

    # Formação tática do SPFC (validada contra padrão tático `N-N-...`)
    formacao_spfc: str | None = None
    for ros in summary.get("rosters") or []:
        if not isinstance(ros, dict):
            continue
        if str((ros.get("team") or {}).get("id")) == spfc_id:
            form = str(ros.get("formation") or "").strip()
            if form and RE_FORMACAO_VALIDA.fullmatch(form):
                formacao_spfc = form
            break

    # Estatísticas técnicas do SPFC (com validação de domínio coerente com o Quality Gate)
    chutes = parse_nonneg_int_ou_none(bs_sp.get("totalShots"))
    chutes_no_alvo = parse_nonneg_int_ou_none(bs_sp.get("shotsOnTarget"))
    if chutes is not None and chutes_no_alvo is not None and chutes_no_alvo > chutes:
        chutes_no_alvo = chutes

    posse_de_bola = parse_pct_ou_none(bs_sp.get("possessionPct"))
    passes = parse_nonneg_int_ou_none(bs_sp.get("totalPasses"))
    passes_certos = parse_nonneg_int_ou_none(bs_sp.get("accuratePasses"))

    precisao_passes: int | None = None
    if passes and passes > 0 and passes_certos is not None:
        precisao_passes = max(0, min(100, int(round((passes_certos / passes) * 100))))
    elif bs_sp.get("passPct"):
        try:
            raw_pct = float(str(bs_sp["passPct"]).replace(",", ".").rstrip("%").strip())
            if math.isfinite(raw_pct):
                pct_val = int(round(raw_pct * 100 if 0.0 <= raw_pct <= 1.0 else raw_pct))
                precisao_passes = pct_val if 0 <= pct_val <= 100 else None
        except (ValueError, TypeError, OverflowError):
            precisao_passes = None

    faltas = parse_nonneg_int_ou_none(bs_sp.get("foulsCommitted"))
    escanteios = parse_nonneg_int_ou_none(bs_sp.get("wonCorners"))
    impedimentos = parse_nonneg_int_ou_none(bs_sp.get("offsides"))

    return {
        "formacao_spfc": formacao_spfc,
        "cartoes_amarelos": am_sp,
        "cartoes_vermelhos": vm_sp,
        "cartoes_amarelos_adversario": am_adv,
        "cartoes_vermelhos_adversario": vm_adv,
        "chutes": chutes,
        "chutes_no_alvo": chutes_no_alvo,
        "posse_de_bola": posse_de_bola,
        "passes": passes,
        "precisao_passes": precisao_passes,
        "faltas": faltas,
        "escanteios": escanteios,
        "impedimentos": impedimentos,
    }


def enriquecer_com_summary(
    sessao: requests.Session,
    registro: dict[str, Any],
    spfc_id: str,
) -> dict[str, Any]:
    """Consulta `/summary?event={id}` e completa gols, cartões, arena e estatísticas."""
    summary = get_json(sessao, "summary", params={"event": registro["id"]})

    # Arena (prefere gameInfo.venue se mais completo; garante fallback obrigatório não-nulo)
    game_info = summary.get("gameInfo")
    venue = game_info.get("venue") if isinstance(game_info, dict) else None
    arena_summary = normalizar_arena(venue)
    if arena_summary:
        registro["arena"] = arena_summary
    elif not registro.get("arena"):
        registro["arena"] = (
            ARENA_CASA_SPFC if registro.get("mando") == "Casa" else ARENA_FORA_FALLBACK
        )

    gols_extraidos = extrair_gols_spfc(summary, spfc_id)
    gols_validos = all(
        bool(g.get("jogador")) and minuto_valido_v1(str(g.get("minuto") or ""))
        for g in gols_extraidos
    )
    if len(gols_extraidos) == registro["gols_pro"] and gols_validos:
        registro["gols"] = gols_extraidos
    else:
        motivo = (
            f"retornou {len(gols_extraidos)} gol(s), divergindo de gols_pro={registro['gols_pro']}"
            if len(gols_extraidos) != registro["gols_pro"]
            else "retornou gols com jogador ou minuto inválido/ausente"
        )
        print(
            f"[AVISO] /summary da ESPN para evento {registro['id']} "
            f"(R{registro['rodada']} vs {registro['adversario']}) {motivo}. "
            "Mantendo 'gols=None' para nova tentativa na próxima execução.",
            file=sys.stderr,
        )
        registro["gols"] = None

    detalhes = extrair_cartoes_e_stats(summary, spfc_id)
    campos_cartoes = (
        "cartoes_amarelos",
        "cartoes_vermelhos",
        "cartoes_amarelos_adversario",
        "cartoes_vermelhos_adversario",
    )
    preenchidos = [detalhes.get(c) is not None for c in campos_cartoes]
    if any(preenchidos) and not all(preenchidos):
        print(
            f"[AVISO] /summary da ESPN para evento {registro['id']} retornou cartões "
            "parcialmente preenchidos. Zerando os 4 campos para None até a próxima execução.",
            file=sys.stderr,
        )
        for campo in campos_cartoes:
            detalhes[campo] = None

    registro.update(detalhes)
    return registro


def mesclar_partidas_espn_com_cache_basico(
    partidas_espn: list[dict[str, Any]],
    cache_temporada: dict[int, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """
    Preserva partidas da temporada atual já presentes no cache local (ex.: vindas
    da API football-data.org) que ainda não constam na resposta da ESPN, evitando
    perda temporária de jogos quando a ESPN atrasar em relação à football-data.org.

    Deduplica pelas mesmas chaves naturais do campeonato usadas no Quality Gate:
    `(temporada, rodada)`, `(data, adversario)`, `(temporada, mando, adversario)` e `data`.
    """
    resultado: list[dict[str, Any]] = [dict(p) for p in partidas_espn]
    ids_usados = {int(p["id"]) for p in resultado}
    chaves_temp_rod = {(int(p["temporada"]), int(p["rodada"])) for p in resultado}
    chaves_data_adv = {(str(p["data"]), str(p["adversario"])) for p in resultado}
    chaves_confronto = {
        (int(p["temporada"]), str(p["mando"]), str(p["adversario"])) for p in resultado
    }
    chaves_data = {str(p["data"]) for p in resultado}

    preservados = 0
    for cached in sorted(
        cache_temporada.values(),
        key=lambda item: (int(item["temporada"]), str(item["data"]), int(item["id"])),
    ):
        chave_tr = (int(cached["temporada"]), int(cached["rodada"]))
        chave_da = (str(cached["data"]), str(cached["adversario"]))
        chave_conf = (
            int(cached["temporada"]),
            str(cached["mando"]),
            str(cached["adversario"]),
        )
        data_jogo = str(cached["data"])

        if (
            chave_tr in chaves_temp_rod
            or chave_da in chaves_data_adv
            or chave_conf in chaves_confronto
            or data_jogo in chaves_data
        ):
            continue

        registro = dict(cached)
        if int(registro["id"]) in ids_usados:
            novo_id = 900_000_000 + int(registro["id"])
            while novo_id in ids_usados:
                novo_id += 1
            registro["id"] = novo_id

        resultado.append(registro)
        ids_usados.add(int(registro["id"]))
        chaves_temp_rod.add(chave_tr)
        chaves_data_adv.add(chave_da)
        chaves_confronto.add(chave_conf)
        chaves_data.add(data_jogo)
        preservados += 1

    resultado.sort(key=lambda p: (int(p["temporada"]), str(p["data"]), int(p["id"])))
    return resultado, preservados


def carregar_json_seguro(caminho: Path) -> dict[str, Any] | None:
    """Lê um arquivo JSON caso exista; retorna None se não existir."""
    if not caminho.exists():
        return None
    with caminho.open("r", encoding="utf-8") as f:
        return json.load(f)


def salvar_json_atomico(payload: dict[str, Any], destino: Path) -> None:
    """Grava JSON de forma atômica (arquivo temporário + replace) para evitar corrupção."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destino.with_suffix(destino.suffix + ".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write("\n")
        os.replace(tmp_path, destino)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def montar_metadata(
    partidas: list[dict[str, Any]],
    gerado_em_utc: str,
) -> dict[str, Any]:
    """Reconstrói o bloco `metadata` mantendo 100% de compatibilidade com a v1."""
    temporadas_cartoes = sorted(
        {
            p["temporada"]
            for p in partidas
            if p.get("cartoes_amarelos") is not None
            and p.get("cartoes_vermelhos") is not None
        }
    )
    temporadas_gols = sorted(
        {p["temporada"] for p in partidas if isinstance(p.get("gols"), list)}
    )
    temporadas_stats = sorted(
        {p["temporada"] for p in partidas if p.get("chutes") is not None}
    )

    temporada_inicio = min(p["temporada"] for p in partidas)
    temporada_fim = max(p["temporada"] for p in partidas)

    sufixo_espn = f" e API pública ESPN ({ANO_INICIO_ESPN})" if temporada_fim >= ANO_INICIO_ESPN else ""
    if temporada_fim > ANO_INICIO_ESPN:
        sufixo_espn = f" e API pública ESPN ({ANO_INICIO_ESPN}–{temporada_fim})"

    return {
        "clube": "São Paulo FC",
        "competicao": "Campeonato Brasileiro Série A — Era dos Pontos Corridos",
        "temporada_inicio": temporada_inicio,
        "temporada_fim": temporada_fim,
        "total_partidas": len(partidas),
        "temporadas_com_cartoes": temporadas_cartoes,
        "temporadas_com_gols": temporadas_gols,
        "temporadas_com_estatisticas": temporadas_stats,
        "fonte_cartoes": (
            "campeonato-brasileiro-cartoes.csv (2014–2024), "
            f"campeonato-brasileiro-estatisticas-full.csv (2025){sufixo_espn}"
        ),
        "fonte_gols": f"campeonato-brasileiro-gols.csv (2014–2025){sufixo_espn}",
        "gerado_em": gerado_em_utc,
    }


def dataset_alterado(atual: dict[str, Any] | None, novo: dict[str, Any]) -> bool:
    """Compara dataset atual e novo ignorando apenas o carimbo `metadata.gerado_em`."""
    if not atual or not isinstance(atual, dict):
        return True
    if atual.get("partidas") != novo.get("partidas"):
        return True
    meta_atual = {k: v for k, v in (atual.get("metadata") or {}).items() if k != "gerado_em"}
    meta_novo = {k: v for k, v in (novo.get("metadata") or {}).items() if k != "gerado_em"}
    return meta_atual != meta_novo


def exibir_resumo(
    partidas_temporada: list[dict[str, Any]],
    temporada: int,
    total_geral: int,
    qtd_cache: int,
    qtd_api: int,
    houve_mudanca: bool,
) -> None:
    """Imprime resumo detalhado da carga incremental da temporada."""
    jogos = len(partidas_temporada)
    vitorias = sum(1 for p in partidas_temporada if p["resultado"] == "V")
    empates = sum(1 for p in partidas_temporada if p["resultado"] == "E")
    derrotas = sum(1 for p in partidas_temporada if p["resultado"] == "D")
    pontos = sum(p["pontos"] for p in partidas_temporada)
    aproveitamento = (pontos / (jogos * 3) * 100) if jogos else 0.0
    gp = sum(p["gols_pro"] for p in partidas_temporada)
    gc = sum(p["gols_contra"] for p in partidas_temporada)

    amarelos = sum(p["cartoes_amarelos"] or 0 for p in partidas_temporada)
    vermelhos = sum(p["cartoes_vermelhos"] or 0 for p in partidas_temporada)
    amarelos_adv = sum(p["cartoes_amarelos_adversario"] or 0 for p in partidas_temporada)
    vermelhos_adv = sum(p["cartoes_vermelhos_adversario"] or 0 for p in partidas_temporada)

    artilheiros: dict[str, int] = {}
    penaltis = 0
    gols_contra_favor = 0
    for p in partidas_temporada:
        for g in p.get("gols") or []:
            if g.get("gol_contra"):
                gols_contra_favor += 1
                continue
            if g.get("tipo") == "Pênalti":
                penaltis += 1
            nome = g.get("jogador") or ""
            if nome:
                artilheiros[nome] = artilheiros.get(nome, 0) + 1

    top_artilheiros = sorted(artilheiros.items(), key=lambda x: (-x[1], x[0]))[:8]

    print("=" * 68)
    print(f"DADOS TRICOLOR v2 — ATUALIZAÇÃO INCREMENTAL ({temporada})")
    print("=" * 68)
    print(f"Jogos de {temporada} importados:  {jogos} (reaproveitados do cache: {qtd_cache} | consultados /summary: {qtd_api})")
    print(f"Total geral na base:         {total_geral} partidas")
    print(f"Campanha {temporada}:               {vitorias}V · {empates}E · {derrotas}D | {pontos} pts ({aproveitamento:.1f}%)")
    print(f"Gols {temporada}:                   {gp} GP · {gc} GC (SG {gp - gc:+d})")
    print(f"Cartões SPFC ({temporada}):         {amarelos} amarelos · {vermelhos} vermelhos")
    print(f"Cartões adversários ({temporada}):  {amarelos_adv} amarelos · {vermelhos_adv} vermelhos")
    print(f"Gols detalhados ({temporada}):      {sum(artilheiros.values())} de atletas ({penaltis} pênaltis) + {gols_contra_favor} gol(s) contra a favor")
    if top_artilheiros:
        print("Artilheiros " + f"{temporada}:           " + ", ".join(f"{n} ({q})" for n, q in top_artilheiros))
    if partidas_temporada:
        print(f"\nÚltimos 5 jogos de {temporada}:")
        for p in partidas_temporada[-5:]:
            gols_txt = ", ".join(
                f"{g['jogador']} {g['minuto']}'" + (" (P)" if g["tipo"] == "Pênalti" else (" (GC)" if g["gol_contra"] else ""))
                for g in (p.get("gols") or [])
            ) or "—"
            cartoes_txt = (
                f"{p['cartoes_amarelos']}A {p['cartoes_vermelhos']}V"
                if p.get("cartoes_amarelos") is not None and p.get("cartoes_vermelhos") is not None
                else "—"
            )
            print(
                f"  R{p['rodada']:02d} | {p['data']} ({p['hora']}) | {p['mando']:4s} vs {p['adversario']:15s} | "
                f"{p['gols_pro']}x{p['gols_contra']} ({p['resultado']}) | "
                f"Cartões: {cartoes_txt} | Gols: {gols_txt}"
            )
    print(f"\nStatus de gravação:          {'Dataset atualizado' if houve_mudanca else 'Sem alterações nos jogos (cache mantido)'}")
    print("=" * 68)


def atualizar_temporada(temporada: int = TEMPORADA_PADRAO, forcar_refresh: bool = False) -> None:
    """Orquestra a carga incremental fail-safe da temporada via ESPN."""
    # 1. Carrega base histórica congelada (2003–2025)
    if not HISTORICO_PATH.exists():
        raise FileNotFoundError(
            f"Base histórica congelada não encontrada em '{HISTORICO_PATH}'."
        )
    historico_payload = carregar_json_seguro(HISTORICO_PATH)
    if not historico_payload or not isinstance(historico_payload.get("partidas"), list):
        raise ValueError(f"Arquivo histórico inválido: '{HISTORICO_PATH}'.")

    partidas_historicas = [
        p for p in historico_payload["partidas"] if int(p["temporada"]) < temporada
    ]
    temp_fim_hist = (
        max(int(p["temporada"]) for p in partidas_historicas) if partidas_historicas else 0
    )

    # 2. Carrega cache local da temporada atual (se existir em docs/data/spfc_pontos_corridos.json)
    dataset_atual = carregar_json_seguro(OUTPUT_PATH)
    cache_temporada: dict[int, dict[str, Any]] = {}
    partidas_intermediarias: list[dict[str, Any]] = []
    if dataset_atual and isinstance(dataset_atual.get("partidas"), list):
        for p in dataset_atual["partidas"]:
            temp_p = int(p.get("temporada", 0))
            if temp_fim_hist < temp_p < temporada:
                partidas_intermediarias.append(p)
            elif temp_p == temporada:
                cache_temporada[int(p["id"])] = p

    base_anterior = partidas_historicas + partidas_intermediarias
    adversarios_historicos = {p["adversario"] for p in base_anterior}

    # 3. Consulta API pública da ESPN (qualquer falha aborta ANTES de gravar arquivos)
    sessao = criar_sessao_http()
    spfc_id = descobrir_id_spfc(sessao, temporada)
    eventos_concluidos, mapa_rodadas = buscar_agenda_temporada(sessao, spfc_id, temporada)

    qtd_enriquecidos_cache = sum(
        1 for p in cache_temporada.values() if partida_tem_detalhes(p)
    )
    if not forcar_refresh and len(eventos_concluidos) < qtd_enriquecidos_cache:
        raise RuntimeError(
            f"API ESPN retornou apenas {len(eventos_concluidos)} jogos finalizados em {temporada}, "
            f"menos que os {qtd_enriquecidos_cache} jogos já enriquecidos em cache. "
            "Abortando para evitar perda de dados."
        )

    partidas_temporada: list[dict[str, Any]] = []
    qtd_cache = 0
    qtd_api = 0
    novos_clubes: set[str] = set()

    for ev in eventos_concluidos:
        ev_id = int(ev["id"])
        rodada = mapa_rodadas.get(ev_id, len(partidas_temporada) + 1)
        registro = extrair_dados_basicos_evento(ev, spfc_id, temporada, rodada)

        if registro["adversario"] not in adversarios_historicos:
            novos_clubes.add(registro["adversario"])

        cached = cache_temporada.get(ev_id)
        if (
            not forcar_refresh
            and cached is not None
            and partida_tem_detalhes(cached)
            and cached.get("gols_pro") == registro["gols_pro"]
            and cached.get("gols_contra") == registro["gols_contra"]
        ):
            # Reaproveita detalhes do cache sem consultar /summary
            reaproveitado = dict(cached)
            reaproveitado["rodada"] = registro["rodada"]
            reaproveitado["data"] = registro["data"]
            reaproveitado["hora"] = registro["hora"]
            reaproveitado["mando"] = registro["mando"]
            reaproveitado["adversario"] = registro["adversario"]
            reaproveitado["adversario_estado"] = registro["adversario_estado"]
            if not reaproveitado.get("arena"):
                reaproveitado["arena"] = registro["arena"] or (
                    ARENA_CASA_SPFC if registro["mando"] == "Casa" else ARENA_FORA_FALLBACK
                )
            partidas_temporada.append(reaproveitado)
            qtd_cache += 1
        else:
            registro = enriquecer_com_summary(sessao, registro, spfc_id)
            partidas_temporada.append(registro)
            qtd_api += 1

    # Preserva jogos recentes de outra fonte (ex.: football-data.org) ainda não liberados pela ESPN
    partidas_temporada, qtd_preservados_basicos = mesclar_partidas_espn_com_cache_basico(
        partidas_temporada, cache_temporada
    )
    if qtd_preservados_basicos > 0:
        print(
            f"[INFO] Preservado(s) {qtd_preservados_basicos} jogo(s) da temporada {temporada} "
            "ainda não retornado(s) pela ESPN (serão enriquecidos assim que disponíveis)."
        )

    if novos_clubes:
        print(
            f"[INFO] Clube(s) inédito(s) na era dos pontos corridos em {temporada}: "
            f"{', '.join(sorted(novos_clubes))}"
        )

    # 4. Mescla histórico + temporada atual ordenados cronologicamente
    todas_partidas = sorted(
        base_anterior + partidas_temporada,
        key=lambda p: (int(p["temporada"]), str(p["data"]), int(p["id"])),
    )

    agora_utc = datetime.now(timezone.utc)
    agora_brt = agora_utc.astimezone(BRT)
    gerado_em_utc = agora_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    novo_payload = {
        "metadata": montar_metadata(todas_partidas, gerado_em_utc),
        "partidas": todas_partidas,
    }

    houve_mudanca = dataset_alterado(dataset_atual, novo_payload)
    if houve_mudanca:
        salvar_json_atomico(novo_payload, OUTPUT_PATH)

    # 5. Gera docs/data/meta.json com data/hora da última execução em BRT e contagem de jogos
    meta_anterior = carregar_json_seguro(META_PATH)
    ultima_partida_data = max(str(p["data"]) for p in todas_partidas) if todas_partidas else None
    fonte_atualizacao = (
        "ESPN API (bra.1) + football-data.org (v4 / BSA)"
        if qtd_preservados_basicos > 0
        else "ESPN API (bra.1)"
    )
    meta_payload = {
        "atualizado_em": agora_brt.isoformat(timespec="seconds"),
        "atualizado_em_brt": agora_brt.strftime("%d/%m/%Y às %H:%M"),
        "fuso_horario": "America/Sao_Paulo",
        "temporada_inicio": novo_payload["metadata"]["temporada_inicio"],
        "temporada_fim": novo_payload["metadata"]["temporada_fim"],
        "temporada_atual": temporada,
        "total_jogos": len(todas_partidas),
        "jogos_historico": len(base_anterior),
        "jogos_temporada_atual": len(partidas_temporada),
        "ultima_partida_data": ultima_partida_data,
        "fonte_atualizacao": fonte_atualizacao,
    }

    # Só regrava meta.json se houver alteração nos jogos ou se meta.json ainda não existir
    # (ou se for solicitado refresh), evitando commits vazios só de timestamp no CI
    if houve_mudanca or meta_anterior is None or forcar_refresh:
        salvar_json_atomico(meta_payload, META_PATH)

    exibir_resumo(
        partidas_temporada=partidas_temporada,
        temporada=temporada,
        total_geral=len(todas_partidas),
        qtd_cache=qtd_cache,
        qtd_api=qtd_api,
        houve_mudanca=houve_mudanca,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Atualiza a temporada atual do Dados Tricolor via API pública da ESPN."
    )
    parser.add_argument(
        "--temporada",
        type=int,
        default=TEMPORADA_PADRAO,
        help=f"Temporada a atualizar (padrão: {TEMPORADA_PADRAO}).",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Ignora cache local da temporada atual e reconsulta /summary de todos os jogos.",
    )
    args = parser.parse_args()

    try:
        atualizar_temporada(temporada=args.temporada, forcar_refresh=args.force_refresh)
    except Exception as exc:
        print(
            f"[ERRO] Falha ao atualizar temporada {args.temporada} via ESPN: {exc}\n"
            f"O arquivo '{OUTPUT_PATH}' foi preservado sem alterações.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()

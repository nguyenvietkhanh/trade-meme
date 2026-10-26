import os
import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from .config import number

NAMES={'SIGNER_PRIVATE_KEY','POLYMARKET_WALLET_ADDRESS','MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME',
       'DRY_RUN','MAX_TEST_BUDGET','MAX_USD_PER_TRADE','MIN_FORECAST_EDGE_PCT','MIN_AI_CONFIDENCE',
       'AI_INTERVAL_SECONDS','MAX_MODEL_CALLS_PER_DAY','DAILY_LOSS_LIMIT','MAX_OPEN_POSITIONS','NEWS_RESEARCH_ENABLED','BROWSER_HEADLESS','MAX_SPREAD_PCT'}


def load_local(path=Path('.env.ai')):
    if not path.exists():return
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        if '=' not in line:raise ValueError('INVALID_AI_ENV_FILE')
        key,value=line.split('=',1);key=key.strip();value=value.strip()
        if key not in NAMES:continue
        if len(value)>=2 and value[0]==value[-1] and value[0] in (chr(34),chr(39)):value=value[1:-1]
        os.environ.setdefault(key,value)


@dataclass(frozen=True)
class AISettings:
    wallet: str
    private_key: str = field(repr=False)
    model_key: str = field(default='',repr=False)
    model_base: str = 'https://api.river.ai/v1'
    model_name: str = 'deepseek-ai/DeepSeek-V4.1-Flash'
    dry_run: bool = True
    test_budget: Decimal = Decimal('7')
    max_trade: Decimal = Decimal('2')
    min_edge: Decimal = Decimal('8')
    confidence: Decimal = Decimal('.6')
    interval: float = 180
    max_calls: int = 24
    daily_loss: Decimal = Decimal('1')
    max_positions: int = 3
    news_enabled: bool = True
    browser_headless: bool = True
    max_spread: Decimal = Decimal('.04')

    @classmethod
    def from_env(cls):
        wallet=os.getenv('POLYMARKET_WALLET_ADDRESS','').strip()
        key=os.getenv('SIGNER_PRIVATE_KEY','').strip()
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}',wallet):raise ValueError('SET_POLYMARKET_WALLET_ADDRESS_LOCALLY')
        if not re.fullmatch(r'(0x)?[0-9a-fA-F]{64}',key):raise ValueError('SET_SIGNER_PRIVATE_KEY_LOCALLY_NEVER_IN_CHAT')
        dry=os.getenv('DRY_RUN','true').lower()
        if dry not in ('true','false'):raise ValueError('INVALID_DRY_RUN')
        budget=number(os.getenv('MAX_TEST_BUDGET','7'))
        trade=number(os.getenv('MAX_USD_PER_TRADE','2'))
        edge=number(os.getenv('MIN_FORECAST_EDGE_PCT','8'))
        confidence=number(os.getenv('MIN_AI_CONFIDENCE','.6'))
        spread=number(os.getenv('MAX_SPREAD_PCT','4'))/100
        interval=float(number(os.getenv('AI_INTERVAL_SECONDS','180')))
        calls=int(os.getenv('MAX_MODEL_CALLS_PER_DAY','24'))
        loss=number(os.getenv('DAILY_LOSS_LIMIT','1'))
        max_positions=int(os.getenv('MAX_OPEN_POSITIONS','3'))
        if not 0<budget<=7 or not 0<trade<=7 or not 0<=edge<100 or not 0<=confidence<=1 or not 0<=spread<1 or interval<30 or not 1<=calls<=1000 or loss<=0 or not 1<=max_positions<=10:
            raise ValueError('INVALID_TEST_LIMITS_MAXIMUM_7_USD')
        base=os.getenv('MODEL_BASE_URL','https://api.river.ai/v1').rstrip('/')
        if base!='https://api.river.ai/v1':raise ValueError('MODEL_ENDPOINT_NOT_APPROVED')
        model_key=os.getenv('MODEL_API_KEY','')
        if any(c in model_key for c in ('\r','\n')):raise ValueError('INVALID_MODEL_API_KEY')
        news=os.getenv('NEWS_RESEARCH_ENABLED','true').lower()
        if news not in ('true','false'):raise ValueError('INVALID_NEWS_RESEARCH_ENABLED')
        headless=os.getenv('BROWSER_HEADLESS','true').lower()
        if headless not in ('true','false'):raise ValueError('INVALID_BROWSER_HEADLESS')
        return cls(wallet,key,model_key,base,os.getenv('MODEL_NAME',cls.model_name),dry=='true',budget,min(trade,Decimal(2)),max(edge,Decimal(8)),max(confidence,Decimal('.6')),interval,calls,loss,max_positions,news=='true',headless=='true',min(spread,Decimal('.04')))


def state_directory(wallet):
    base=Path(os.getenv('LOCALAPPDATA',str(Path.home()/'.local/share')))
    return base/'PolymarketAITest'/wallet.lower()

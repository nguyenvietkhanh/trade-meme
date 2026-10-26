"""Bounded public headline research. No article navigation, keys, or order access."""
import hashlib
import re
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode,urlsplit
import xml.etree.ElementTree as ET
import httpx

NEWS_HOST='news.google.com'
STOP_WORDS=set('will would could should the and for with from before after above below reach price this that what when where which how does have has are was were market yes not end next year month'.split())
MAX_AGE=24*3600


def keywords(question):
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9'-]{2,}",question) if w.lower() not in STOP_WORDS}


def news_url(question):
    # Question is query DATA, never a user/model-selected URL or executable instruction.
    query=' '.join(question.split())[:240]+' when:1d'
    return 'https://'+NEWS_HOST+'/rss/search?'+urlencode({'q':query,'hl':'en-US','gl':'US','ceid':'US:en'})


def parse_feed(body,question,now):
    if len(body)>512000:raise ValueError('NEWS_FEED_INVALID')
    try:text=body.decode('utf-8-sig')
    except UnicodeError:raise ValueError('NEWS_FEED_INVALID') from None
    if '\x00' in text or '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('NEWS_FEED_INVALID')
    try:root=ET.fromstring(text)
    except ET.ParseError:raise ValueError('NEWS_FEED_INVALID') from None
    if root.tag!='rss':raise ValueError('NEWS_FEED_INVALID')
    terms=keywords(question)
    sources=[];seen=set()
    for item in root.findall('./channel/item')[:60]:
        title=' '.join((item.findtext('title') or '').split())[:500]
        if not terms or not terms.intersection(keywords(title)):continue
        try:
            stamp=parsedate_to_datetime(item.findtext('pubDate') or '')
            if stamp.tzinfo is None:continue
            published=stamp.astimezone(timezone.utc).timestamp()
        except (ValueError,TypeError,OverflowError):continue
        if not 0<=now-published<=MAX_AGE:continue
        source=item.find('source')
        if source is None:continue
        publisher=' '.join((source.text or '').split())[:150]
        try:
            origin=urlsplit(source.get('url',''));link=urlsplit(item.findtext('link') or '')
            if origin.scheme!='https' or origin.username is not None or origin.port not in (None,443):continue
            host=(origin.hostname or '').lower().removeprefix('www.')
            if not publisher or '.' not in host or host.endswith(('.local','.localhost')) or re.fullmatch(r'[0-9.]+',host):continue
            if link.scheme!='https' or link.hostname!=NEWS_HOST or link.username is not None or link.port not in (None,443):continue
            if not link.path.startswith(('/rss/articles/','/articles/')):continue
        except ValueError:continue
        identity=hashlib.sha256((title+'|'+str(published)+'|'+host).encode()).hexdigest()[:20]
        if identity in seen:continue
        seen.add(identity)
        sources.append({'id':'news:'+identity,'title':title,'publisher':publisher,'publisher_host':host,
                        'url':link.geturl(),'published_at':published,'retrieved_at':now,
                        'evidence_type':'RSS_HEADLINE_ONLY_NOT_FULL_ARTICLE'})
    return sorted(sources,key=lambda x:x['published_at'],reverse=True)[:5]


class NewsResearch:
    def __init__(self,bridge,enabled=True):self.bridge=bridge;self.enabled=enabled;self.cache={}

    def collect(self,market_id,question):
        if not self.enabled:return {'status':'DISABLED','sources':[]}
        now=time.time();key=(str(market_id),question)
        if key in self.cache and now-self.cache[key][0]<(600 if self.cache[key][1]['status'] in ('HEADLINES_ONLY','NO_RECENT_RELEVANT_HEADLINES') else 60):
            cached=self.cache[key][1]
            return dict(cached,sources=[s for s in cached['sources'] if 0<=now-s['published_at']<=MAX_AGE])
        try:
            response=self.bridge.handle_request(httpx.Request('GET',news_url(question)))
            if response.status_code!=200:
                report={'status':'HTTP_'+str(response.status_code),'sources':[]}
            else:
                sources=parse_feed(response.content,question,now)
                report={'status':'HEADLINES_ONLY' if sources else 'NO_RECENT_RELEVANT_HEADLINES','sources':sources}
        except Exception:
            # News outages are not trading account errors. Never attach stale facts.
            report={'status':'UNAVAILABLE','sources':[]}
        self.cache[key]=(now,report)
        if len(self.cache)>256:self.cache.pop(next(iter(self.cache)))
        return report


def cited_evidence(raw,market,now=None):
    """Only accept citations present in this market's fetched, recent evidence set."""
    now=time.time() if now is None else now
    ids=raw.get('cited_source_ids',[])
    if not isinstance(ids,list) or len(ids)>5 or any(not isinstance(x,str) for x in ids):
        raise ValueError('INVALID_NEWS_CITATIONS')
    available={s['id']:s for s in market.get('research',{}).get('sources',[])
               if isinstance(s.get('published_at'),(int,float)) and 0<=now-s['published_at']<=MAX_AGE
               and isinstance(s.get('retrieved_at'),(int,float)) and 0<=now-s['retrieved_at']<=900}
    if any(x not in available for x in ids):raise ValueError('NEWS_CITATION_NOT_IN_FRESH_INPUT')
    return [available[x] for x in dict.fromkeys(ids)]


def enforce_buy_research(decision,required=True):
    if required and decision['action'].startswith('BUY_'):
        sources=decision.get('cited_sources',[])
        if len({s['publisher_host'] for s in sources})<2:
            return {'action':'HOLD','reason':'Chưa có trích dẫn mới từ ít nhất hai nguồn tin khác nhau; không gửi lệnh.'}
    return decision

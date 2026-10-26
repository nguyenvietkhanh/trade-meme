import contextlib
import io
import json
import time
import unittest
from datetime import datetime,timezone
from email.utils import format_datetime
from types import SimpleNamespace
from unittest.mock import Mock,patch
from urllib.parse import parse_qs,urlsplit
import httpx
from polymarket_arb.news_research import parse_feed,news_url,NewsResearch,cited_evidence,enforce_buy_research,MAX_AGE
from polymarket_arb.ai_model import validate_decision,decide
from polymarket_arb.ai_settings import AISettings
from polymarket_arb.secure_bridge import SDKBridge,GuardError


def feed(now,age=60,host='example.org',title='Federal Reserve rates announcement'):
    stamp=format_datetime(datetime.fromtimestamp(now-age,timezone.utc))
    return ('<rss><channel><item><title>'+title+'</title><link>https://news.google.com/rss/articles/fixture</link>'
            '<pubDate>'+stamp+'</pubDate><source url="https://'+host+'">Fixture Publisher</source></item></channel></rss>').encode()


def evidence(now,identity='news:one',host='publisher-one.example'):
    return {'id':identity,'title':'Federal Reserve rates','publisher_host':host,'publisher':host,
            'published_at':now-60,'retrieved_at':now,'url':'https://news.google.com/rss/articles/fixture',
            'evidence_type':'RSS_HEADLINE_ONLY_NOT_FULL_ARTICLE'}


class NewsTests(unittest.TestCase):
    def test_query_has_fixed_host_and_encoded_data(self):
        url=news_url('Federal Reserve rates & url=https://127.0.0.1/secret')
        self.assertEqual(urlsplit(url).hostname,'news.google.com')
        self.assertEqual(urlsplit(url).path,'/rss/search')
        self.assertIn('when:1d',parse_qs(urlsplit(url).query)['q'][0])

    def test_relevant_recent_feed_records_provenance(self):
        now=time.time();sources=parse_feed(feed(now),'Will Federal Reserve cut rates?',now)
        self.assertEqual(len(sources),1)
        self.assertEqual(sources[0]['evidence_type'],'RSS_HEADLINE_ONLY_NOT_FULL_ARTICLE')
        self.assertEqual(sources[0]['retrieved_at'],now)
        self.assertEqual(sources[0]['publisher_host'],'example.org')

    def test_stale_future_irrelevant_and_private_source_are_excluded(self):
        now=time.time()
        for body in (feed(now,age=MAX_AGE+1),feed(now,age=-3600),
                     feed(now,title='Football match cancelled'),feed(now,host='127.0.0.1')):
            self.assertEqual(parse_feed(body,'Federal Reserve rates',now),[])

    def test_entities_and_html_are_not_research(self):
        for body in (b'<html>challenge</html>',b'<!DOCTYPE rss [<!ENTITY x "test">]><rss/>',
                     '<!DOCTYPE rss [<!ENTITY x "test">]><rss/>'.encode('utf-16'),
                     '<!DOCTYPE rss [<!ENTITY x "test">]><rss/>'.encode('utf-16-le')):
            with self.assertRaises(ValueError):parse_feed(body,'Federal Reserve',time.time())

    def test_news_cache_does_not_reuse_expired_headlines(self):
        now=time.time();bridge=Mock()
        bridge.handle_request.return_value=httpx.Response(200,content=feed(now,age=MAX_AGE-20))
        reader=NewsResearch(bridge)
        with patch('polymarket_arb.news_research.time.time',return_value=now):
            self.assertEqual(len(reader.collect('1','Federal Reserve')['sources']),1)
        with patch('polymarket_arb.news_research.time.time',return_value=now+30):
            self.assertEqual(reader.collect('1','Federal Reserve')['sources'],[])
        self.assertEqual(bridge.handle_request.call_count,1)

    def test_outage_is_explicit_and_has_no_sources(self):
        bridge=Mock();bridge.handle_request.side_effect=httpx.TransportError('fixture network')
        self.assertEqual(NewsResearch(bridge).collect('1','Federal Reserve'),{'status':'UNAVAILABLE','sources':[]})

    def test_news_transport_blocks_writes_and_auth_headers(self):
        b=SDKBridge()
        b.policy('GET',news_url('Federal Reserve'))
        with self.assertRaises(GuardError):b.policy('POST',news_url('Federal Reserve'),b'{}')
        with self.assertRaisesRegex(GuardError,'AUTH_ORIGIN_BLOCKED'):
            b.handle_request(httpx.Request('GET',news_url('Federal Reserve'),headers={'POLY_SIGNATURE':'fixture-secret'}))
        with self.assertRaises(GuardError):b.policy('GET','https://news.google.com/articles/fixture')

    def test_fake_foreign_stale_and_old_retrieval_citations_are_rejected(self):
        now=time.time();source=evidence(now)
        for sources,ids in (([source],['invented']),([],['news:one']),
                            ([dict(source,published_at=now-MAX_AGE-1)],['news:one']),
                            ([dict(source,retrieved_at=now-901)],['news:one'])):
            with self.assertRaises(ValueError):
                cited_evidence({'cited_source_ids':ids},{'research':{'sources':sources}},now=now)

    def test_two_publishers_needed_and_sell_can_exit_without_news(self):
        now=time.time();one=evidence(now);two=evidence(now,'news:two','publisher-two.example')
        self.assertEqual(enforce_buy_research({'action':'BUY_YES','cited_sources':[one]})['action'],'HOLD')
        self.assertEqual(enforce_buy_research({'action':'BUY_YES','cited_sources':[one,dict(two,publisher_host=one['publisher_host'])]})['action'],'HOLD')
        self.assertEqual(enforce_buy_research({'action':'BUY_NO','cited_sources':[one,two]})['action'],'BUY_NO')
        self.assertEqual(enforce_buy_research({'action':'SELL'})['action'],'SELL')

    def test_model_accepts_only_sources_for_selected_market(self):
        now=time.time();one=evidence(now);two=evidence(now,'news:two','publisher-two.example')
        market={'market_id':'1','research':{'sources':[one,two]}}
        raw={'action':'BUY_YES','market_id':'1','all_in_usd':2,'probability_yes':.8,'confidence':.8,
             'uses_external_facts':True,'cited_source_ids':[one['id'],two['id']],'reason':'fixture uncertainty'}
        decision=validate_decision(raw,[market],[])
        self.assertEqual(len(decision['cited_sources']),2)
        with self.assertRaises(ValueError):validate_decision(raw,[dict(market,research={'sources':[]})],[])

    def test_uncited_model_buy_becomes_hold_even_if_model_claims_no_external_facts(self):
        response=Mock(status_code=200)
        response.json.return_value={'choices':[{'message':{'content':json.dumps({'action':'BUY_YES','market_id':'1',
            'all_in_usd':2,'probability_yes':.8,'confidence':.9,'uses_external_facts':False,'reason':'fixture'})}}]}
        client=Mock();client.post.return_value=response
        settings=AISettings('fixture','fixture',model_key='fixture')
        with patch('polymarket_arb.ai_model.httpx.Client') as factory:
            factory.return_value.__enter__.return_value=client
            result=decide(settings,[{'market_id':'1'}],[],2,7)
        self.assertEqual(result['action'],'HOLD')

    def test_model_buy_with_fresh_provided_citations_keeps_decision_and_audit(self):
        now=time.time();sources=[evidence(now),evidence(now,'news:two','publisher-two.example')]
        raw={'action':'BUY_NO','market_id':'1','all_in_usd':2,'probability_yes':.2,'confidence':.8,
             'uses_external_facts':True,'cited_source_ids':[s['id'] for s in sources],'reason':'fixture uncertainty'}
        response=Mock(status_code=200);response.json.return_value={'choices':[{'message':{'content':json.dumps(raw)}}]}
        client=Mock();client.post.return_value=response
        settings=AISettings('fixture-wallet','fixture-private',model_key='fixture-model')
        with patch('polymarket_arb.ai_model.httpx.Client') as factory:
            factory.return_value.__enter__.return_value=client
            result=decide(settings,[{'market_id':'1','research':{'sources':sources}}],[],2,7)
        self.assertEqual(result['action'],'BUY_NO')
        self.assertEqual(result['cited_sources'],sources)
        payload=client.post.call_args.kwargs['json']
        self.assertIn('HEADLINE_RESEARCH_REQUIRED',json.dumps(payload))
        self.assertNotIn('fixture-private',json.dumps(payload))
        self.assertNotIn('fixture-wallet',json.dumps(payload))

    def test_model_can_sell_owned_position_without_news(self):
        raw={'action':'SELL','position_asset':'held','probability_yes':.2,'confidence':.8,
             'uses_external_facts':False,'reason':'reduce owned risk','cited_source_ids':[]}
        positions=[{'asset':'held','qty':5000000,'cost':'2','outcome':'YES','market':{'id':'1','title':'fixture public question'}}]
        self.assertEqual(validate_decision(raw,[{'market_id':'1','research':{'sources':[]}}],positions)['action'],'SELL')
        response=Mock(status_code=200);response.json.return_value={'choices':[{'message':{'content':json.dumps(raw)}}]}
        client=Mock();client.post.return_value=response
        with patch('polymarket_arb.ai_model.httpx.Client') as factory:
            factory.return_value.__enter__.return_value=client
            result=decide(AISettings('fixture','fixture',model_key='fixture'),[{'market_id':'1'}],positions,0,0)
        self.assertEqual(result['action'],'SELL')
        packet=json.loads(client.post.call_args.kwargs['json']['messages'][1]['content'])
        self.assertEqual(packet['owned_positions'][0]['market_id'],'1')

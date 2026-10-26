import copy
import contextlib
import io
import json
import unittest
from datetime import datetime,timedelta,timezone
from decimal import Decimal as D
from unittest.mock import Mock,patch
import httpx
from polymarket_arb.forecast import parse_json,enrich_market,pick_best
from polymarket_arb.news_research import enforce_buy_research


def market(mid='1',**changes):
    raw={'market_id':mid,'question':'Fixture question','description':'Resolves YES if fixture event occurs.',
         'resolution_source':'https://example.org/rules','end_date':(datetime.now(timezone.utc)+timedelta(days=2)).isoformat(),
         'volume':'50000','yes_ask':'.3','yes_bid':'.29','no_ask':'.7','no_bid':'.69',
         'yes_asset':'yes-'+mid,'no_asset':'no-'+mid,'minimum_shares':'5',
         'yes_asks':[{'price':'.3','size':'100'}],'yes_bids':[{'price':'.29','size':'100'}],
         'no_asks':[{'price':'.7','size':'100'}],'no_bids':[{'price':'.69','size':'100'}],
         'fee_rate':'0','fee_exponent':1,'research':{'sources':[]}}
    raw.update(changes)
    return enrich_market(raw,datetime.now(timezone.utc))


def buy(mid='1',**changes):
    d={'market_id':mid,'position_asset':None,'action':'BUY_YES','basis':'base_rate',
       'probability_yes':D('.7'),'confidence':D('.8'),'size_fraction':D(1),'edge':999,
       'uses_external_facts':False,'cited_source_ids':[],'reason':'Fixture prior; uncertainty.'}
    d.update(changes);return d


def hold(mid='1',**changes):return buy(mid,action='HOLD',basis='none',size_fraction=D(0),**changes)


def inputs(markets,**changes):
    u={'markets':markets,'available_usd':'6.5','remaining_test_spend_usd':'7','max_usd_per_trade':'2',
       'min_edge':D('.08'),'max_spread':D('.04'),'min_confidence':D('.6'),'max_open_positions':3}
    u.update(changes);return u


class ForecastTests(unittest.TestCase):
    def test_api_batch_base_rate_buy_and_request_contract(self):
        from polymarket_arb.ai_model import decide
        from polymarket_arb.ai_settings import AISettings
        response=Mock(status_code=200)
        response.json.return_value={'choices':[{'message':{'content':'```json\n'+json.dumps({'decisions':[buy()]},default=str)+'\n```'}}]}
        client=Mock();client.post.return_value=response
        settings=AISettings('fixture-wallet','fixture-private',model_key='fixture-key')
        with patch('polymarket_arb.ai_model.httpx.Client') as factory:
            factory.return_value.__enter__.return_value=client
            result=decide(settings,[market()],[],D('6.5'),D(7))
        self.assertEqual(result['action'],'BUY_YES')
        self.assertEqual(result['basis'],'base_rate')
        self.assertEqual(result['cited_sources'],[])
        payload=client.post.call_args.kwargs['json']
        self.assertEqual(payload['max_tokens'],2500)
        self.assertEqual(payload['response_format'],{'type':'json_object'})
        factory.assert_called_once_with(timeout=90,follow_redirects=False)
        data=json.loads(payload['messages'][1]['content'])
        self.assertEqual(D(data['min_edge']),D('.08'))
        self.assertEqual(D(data['max_spread']),D('.04'))
        self.assertEqual(D(data['min_confidence']),D('.6'))
        self.assertIn('now_utc',data);self.assertIn('days_left',data['markets'][0])
        for secret in ('fixture-wallet','fixture-private','fixture-key'):self.assertNotIn(secret,json.dumps(payload))

    def test_api_errors_and_malformed_batch_do_not_dump_response(self):
        from polymarket_arb.ai_model import decide
        from polymarket_arb.ai_settings import AISettings
        for case,code in (('status','MODEL_API_REQUEST_FAILED_HTTP_400'),('network','MODEL_API_NETWORK_FAILED'),
                          ('malformed','MODEL_RESPONSE_REJECTED')):
            response=Mock(status_code=400 if case=='status' else 200)
            response.json.return_value={'choices':[{'message':{'content':'fixture_response_secret not JSON'}}]}
            client=Mock();client.post.return_value=response
            if case=='network':client.post.side_effect=httpx.TransportError('fixture_response_secret')
            output=io.StringIO()
            with patch('polymarket_arb.ai_model.httpx.Client') as factory,contextlib.redirect_stdout(output):
                factory.return_value.__enter__.return_value=client
                with self.assertRaisesRegex(RuntimeError,code):decide(AISettings('fixture','fixture',model_key='fixture'),[market()],[],2,7)
            self.assertNotIn('fixture_response_secret',output.getvalue())
            client.post.assert_called_once()

    def test_base_rate_can_buy_without_any_headlines(self):
        result=pick_best([buy()],inputs([market()]),[])
        self.assertEqual(result['action'],'BUY_YES')
        self.assertEqual(result['all_in_usd'],D(2))
        self.assertEqual(result['edge'],D('.4'))
        self.assertEqual(result['basis'],'base_rate')
        self.assertEqual(enforce_buy_research(result,True)['action'],'BUY_YES')

    def test_size_fraction_uses_wallet_cash_then_two_dollar_cap(self):
        m=market(minimum_shares='1')
        for fraction,want in ((D('.25'),D('1.625')),(D(1),D(2))):
            result=pick_best([buy(size_fraction=fraction)],inputs([m]),[])
            self.assertEqual(result['all_in_usd'],want)
        result=pick_best([buy()],inputs([m],remaining_test_spend_usd='.75'),[])
        self.assertEqual(result['all_in_usd'],D('.75'))

    def test_model_edge_is_ignored_when_ranking(self):
        result=pick_best([buy('1',probability_yes=D('.7'),confidence=D('.6'),edge=100000),
                          buy('2',probability_yes=D('.6'),confidence=D('.9'),edge=-100000)],
                         inputs([market('1'),market('2')]),[])
        self.assertEqual(result['market_id'],'2')
        self.assertEqual(result['edge'],D('.3'))

    def test_no_side_uses_its_own_spread(self):
        m=market(yes_ask='.7',yes_bid='.69',no_ask='.3',no_bid='.1',
                 no_asks=[{'price':'.3','size':'100'}],no_bids=[{'price':'.1','size':'100'}])
        result=pick_best([buy(action='BUY_NO',probability_yes=D('.2'))],inputs([m]),[])
        self.assertEqual(result['action'],'HOLD')
        self.assertEqual(result['evaluations'][0]['blocked_by'],'SPREAD')

    def test_missing_crossed_or_wide_bid_blocks_buy(self):
        for bid in (None,'.31','.1'):
            self.assertEqual(pick_best([buy()],inputs([market(yes_bid=bid)]),[])['action'],'HOLD')

    def test_horizon_rules_and_source_are_required_without_crashing_batch(self):
        for changes in ({'end_date':''},{'end_date':'not-a-date'},
                        {'end_date':'2020-01-01T00:00:00Z'},{'end_date':'2027-01-01'},
                        {'description':''},{'resolution_source':''}):
            result=pick_best([buy()],inputs([market(**changes)]),[])
            self.assertEqual(result['action'],'HOLD')
        self.assertGreater(market()['days_left'],1.9)

    def test_probability_confidence_and_fraction_bounds(self):
        for changes in ({'probability_yes':0},{'probability_yes':1},{'probability_yes':'NaN'},
                        {'confidence':2},{'size_fraction':-1},{'size_fraction':D('1.1')}):
            with self.assertRaises(ValueError):pick_best([buy(**changes)],inputs([market()]),[])
        for changes in ({'probability_yes':D('.35')},{'confidence':D('.59')},{'size_fraction':0}):
            self.assertEqual(pick_best([buy(**changes)],inputs([market()]),[])['action'],'HOLD')

    def test_coverage_foreign_or_duplicate_targets_reject_entire_batch(self):
        for decisions in ([],[buy('foreign')],[buy(),buy()],[buy()]):
            with self.assertRaises(ValueError):pick_best(decisions,inputs([market(),market('2')]),[])

    def test_each_owned_position_requires_its_own_forecast(self):
        pos={'asset':'held','qty':5000000,'cost':'1','outcome':'YES','market':{'id':'1'}}
        with self.assertRaises(ValueError):pick_best([hold()],inputs([market()]),[pos])
        self.assertEqual(pick_best([hold(),hold(position_asset='held')],inputs([market()]),[pos])['action'],'HOLD')

    def test_unknown_or_foreign_sell_is_never_selected(self):
        with self.assertRaises(ValueError):pick_best([buy(action='SELL',position_asset='foreign')],inputs([market()]),[])

    def test_valid_sell_is_prioritized_over_buy_and_does_not_require_cash(self):
        pos={'asset':'held','qty':5000000,'cost':'1','outcome':'YES','market':{'id':'1'}}
        sell=buy(action='SELL',position_asset='held',probability_yes=D('.2'),size_fraction=0,edge=-999)
        result=pick_best([buy(),sell],inputs([market()]),[pos])
        self.assertEqual(result['action'],'SELL')
        self.assertEqual(result['edge'],D('.09'))
        self.assertEqual(result['all_in_usd'],0)
        result=pick_best([hold(),sell],inputs([market()],available_usd=0,remaining_test_spend_usd=0),[pos])
        self.assertEqual(result['action'],'SELL')

    def test_sell_below_fair_requires_explicit_risk_change(self):
        pos={'asset':'held','qty':5000000,'cost':'1','outcome':'NO','market':{'id':'1'}}
        sell=buy(action='SELL',position_asset='held',probability_yes=D('.2'),size_fraction=0)
        self.assertEqual(pick_best([hold(),sell],inputs([market()]),[pos])['action'],'HOLD')
        self.assertEqual(pick_best([hold(),dict(sell,risk_changed=True)],inputs([market()]),[pos])['action'],'SELL')

    def test_depth_min_size_and_net_fee_edge_are_checked_before_selection(self):
        for m in (market(yes_asks=[{'price':'.3','size':'1'}]),market(minimum_shares='1000'),
                  market(yes_ask='.6',yes_bid='.59',minimum_shares='1',
                         yes_asks=[{'price':'.6','size':'100'}],yes_bids=[{'price':'.59','size':'100'}],fee_rate='.1')):
            self.assertEqual(pick_best([buy()],inputs([m]),[])['action'],'HOLD')

    def test_base_rate_cannot_claim_external_facts(self):
        with self.assertRaises(ValueError):pick_best([buy(uses_external_facts=True)],inputs([market()]),[])

    def test_news_failure_does_not_displace_valid_base_rate_candidate(self):
        news=buy('1',basis='news',uses_external_facts=True)
        result=pick_best([news,buy('2')],inputs([market(),market('2')]),[])
        self.assertEqual(result['market_id'],'2')
        self.assertEqual(result['evaluations'][0]['blocked_by'],'NEWS_REQUIRES_TWO_PUBLISHERS')

    def test_existing_asset_buy_is_filtered_before_selecting_other_market(self):
        pos={'asset':'yes-1','qty':5000000,'cost':'1','outcome':'YES','market':{'id':'1'}}
        result=pick_best([buy(),buy('2'),hold(position_asset='yes-1')],inputs([market(),market('2')]),[pos])
        self.assertEqual(result['market_id'],'2')
        self.assertEqual(result['evaluations'][0]['blocked_by'],'ASSET_ALREADY_HELD')

    def test_json_fences_supported_but_extra_objects_duplicates_and_nonfinite_rejected(self):
        self.assertEqual(parse_json('```json\n{"decisions":[]}\n```'),{'decisions':[]})
        for text in ('prefix {"decisions":[]}', '{"decisions":[]} {"decisions":[]}',
                     '{"decisions":[],"decisions":[1]}','{"decisions":NaN}', '[]'):
            with self.assertRaises(ValueError):parse_json(text)

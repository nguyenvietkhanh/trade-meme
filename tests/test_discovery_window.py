import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from polymarket_arb.config import Config
from polymarket_arb.market_data import MarketData, Requests, APIError
from polymarket_arb.browser_data import validation_fields
from polymarket_arb.storage import Storage


class DiscoveryWindowTests(unittest.TestCase):
    def test_offset_stays_in_configured_window(self):
        config=Config(max_markets=30,discovery_window_pages=1)
        data=MarketData(config,client=object())
        rows=[dict(id=str(i),version='v1',active=True,closed=False,acceptingOrders=True,
                   enableOrderBook=True,negRisk=False,liquidityNum=100000,volumeNum=100000,
                   outcomes='["Yes","No"]',clobTokenIds=json.dumps([str(2*i),str(2*i+1)]),
                   conditionId='0x'+format(i,'064x')) for i in range(1,121)]
        offsets=[]
        def page(origin,path,params):
            offsets.append(params['offset'])
            self.assertLess(params['offset'],100)
            self.assertLessEqual(params['offset']+params['limit'],100)
            return rows[params['offset']:params['offset']+params['limit']]
        with patch.object(data.requests,'get',side_effect=page):
            sizes=[len(data.markets()) for _ in range(5)]
        self.assertEqual(offsets,[0,30,60,90,0])
        self.assertEqual(sizes,[30,30,30,10,30])

    def test_422_preserves_stage_parameters_and_validation_without_retry(self):
        requests=Requests(Config(),sleep=lambda _:None)
        error=HTTPError('fixture',422,'fixture',{},None)
        error.public_validation=[{'field':'offset','kind':'less_than_equal','le':1000}]
        with patch.object(requests,'read_json',side_effect=error) as read:
            with self.assertRaises(APIError) as caught:
                requests.get('https://gamma-api.polymarket.com','/markets',{'offset':1005,'limit':100})
        self.assertEqual(read.call_count,1)
        e=caught.exception
        self.assertEqual(e.stage,'gamma_markets')
        self.assertEqual(e.request_parameters,{'offset':1005,'limit':100})
        self.assertEqual(e.validation[0]['le'],1000)
        with tempfile.TemporaryDirectory() as folder:
            store=Storage(Path(folder))
            try:
                store.api_stop(e)
                self.assertEqual(json.loads((Path(folder)/'api_stop.json').read_text())['parameters']['offset'],1005)
            finally: store.close()

    def test_only_safe_validation_fields_are_exposed(self):
        payload={'detail':[{'loc':['query','offset'],'type':'less_than_equal','ctx':{'le':1000},
                            'input':'fixture-secret','msg':'fixture-secret'},
                           {'loc':['query','PRIVATE_KEY'],'msg':'fixture-secret'}]}
        out=validation_fields(json.dumps(payload).encode())
        self.assertEqual(out,[{'field':'offset','kind':'less_than_equal','le':1000}])
        self.assertNotIn('fixture-secret',str(out))
        self.assertEqual(validation_fields(b'<html>error</html>'),[])

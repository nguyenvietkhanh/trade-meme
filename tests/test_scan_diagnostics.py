import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from decimal import Decimal as D
from pathlib import Path
from unittest.mock import patch
from polymarket_arb.config import Config
from polymarket_arb.market_data import MarketData, Market, DataError, fee_parameters
from polymarket_arb.pricing import evaluate, Fees
from polymarket_arb.main import scan
from polymarket_arb.storage import Storage


class ScanDiagnosticTests(unittest.TestCase):
    def test_discovery_rotates_beyond_first_n_and_wraps(self):
        data=MarketData(Config(max_markets=2,request_spacing=.00001),client=object())
        rows=[dict(id=str(i),version='v1',active=True,closed=False,acceptingOrders=True,
                   enableOrderBook=True,negRisk=False,liquidityNum=100000,volumeNum=100000,
                   outcomes='["Yes","No"]',clobTokenIds=json.dumps([str(2*i),str(2*i+1)]),
                   conditionId='0x'+format(i,'064x')) for i in range(1,6)]
        def page(origin,path,params): return rows[params['offset']:params['offset']+100]
        with patch.object(data.requests,'get',side_effect=page):
            self.assertEqual([x.id for x in data.markets()],['1','2'])
            self.assertEqual([x.id for x in data.markets()],['3','4'])
            self.assertEqual([x.id for x in data.markets()],['5'])
            self.assertEqual([x.id for x in data.markets()],['1','2'])

    def test_real_uploaded_snapshot_does_not_offer_arbitrage(self):
        raw=json.loads((Path(__file__).parent/'fixtures/public_binary_snapshot.json').read_text())
        y,n=raw['yes'],raw['no']
        market=Market('559651',y['market'],'fixture',y['asset_id'],n['asset_id'])
        f=fee_parameters(raw['metadata'],market)
        self.assertEqual(f.rate,0)
        plan=evaluate(y['asks'],n['asks'],f,f,budget=25,min_edge_pct=D('.5'),slippage_bps=20)
        self.assertIsNone(plan)
        diagnostic=evaluate(y['asks'],n['asks'],f,f,budget=25,min_edge_pct=D('.5'),slippage_bps=20,profitable_only=False)
        self.assertEqual(diagnostic.ask_yes+D(diagnostic.ask_no),D('1.001'))
        self.assertEqual(diagnostic.edge_pct,D('-.300200'))

    def test_summary_and_public_skip_sample_are_explicit(self):
        m=Market('1','0x'+'ab'*32,'fixture','111','222')
        class Fixture:
            def markets(self): return [m,m]
            def snapshot(self,market):
                if getattr(self,'seen',False):
                    raise DataError('FEE_DATA_UNKNOWN',{'metadata_fee_details':None})
                self.seen=True
                return {'asks':[{'price':'.6','size':'50'}]}, {'asks':[{'price':'.5','size':'50'}]},Fees(D(0),1),D(1),100,100
        with tempfile.TemporaryDirectory() as temp:
            config=Config(output_dir=Path(temp),stop_file=Path(temp)/'STOP')
            storage=Storage(config.output_dir)
            try:
                out=io.StringIO()
                with redirect_stdout(out): scan(config,Fixture(),storage)
                self.assertIn('NO_EDGE=1',out.getvalue())
                self.assertIn('SKIP_DATA=1',out.getvalue())
                self.assertIn('FEE_DATA_UNKNOWN=1',out.getvalue())
                samples=list(storage.sample_dir.glob('*.json'))
                self.assertEqual(len(samples),1)
                data=json.loads(samples[0].read_text())
                self.assertIsNone(data['public_details']['metadata_fee_details'])
                storage.sample(m,'FEE_DATA_UNKNOWN',{'metadata_fee_details':None})
                self.assertEqual(len(list(storage.sample_dir.glob('*.json'))),1)
            finally: storage.close()

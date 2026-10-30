import ast
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from filters import assess, backtest, weekly

def sample():
    return dict(mint='fixture', top10_pct=21, top10_excludes_curve=True,
                dev_pct=3, dev_sold_first15m=False, dev_history_complete=True,
                creation_block_complete=True,
                creation_block_buyers=[dict(wallet='a', sol=1)],
                curve_progress_pct=40, top10_wallets=['a'],
                blacklist_loaded=True, blocked_wallet_matches=[],
                socials_verified=True, socials_age_hours=80, socials_followers=100)

class Filters(unittest.TestCase):
    def test_valid(self): self.assertEqual(assess(sample())['verdict'], 'SETUP VALID')
    def test_boundaries(self):
        for key,value in [('top10_pct',22),('dev_pct',4),('curve_progress_pct',14.99),('curve_progress_pct',75.01)]:
            self.assertEqual(assess({**sample(),key:value})['verdict'],'SKIP')
    def test_unknown(self):
        for key in ['dev_history_complete','creation_block_complete','blacklist_loaded','socials_verified']:
            self.assertEqual(assess({**sample(),key:False})['verdict'],'WATCH')
    def test_social_and(self):
        for age,followers,result in [(31,41,'SKIP'),(72,41,'SETUP VALID'),(31,200,'SETUP VALID')]:
            self.assertEqual(assess({**sample(),'socials_age_hours':age,'socials_followers':followers})['verdict'],result)
    def test_bundle_dev_blacklist(self):
        for patch in [dict(dev_sold_first15m=True),dict(blocked_wallet_matches=['a']),dict(creation_block_buyers=[dict(wallet=str(i),sol=1) for i in range(4)])]:
            self.assertEqual(assess({**sample(),**patch})['verdict'],'SKIP')
    def test_duplicate_wallets(self):
        self.assertEqual(assess({**sample(),'creation_block_buyers':[dict(wallet='a',sol=1)]*4})['verdict'],'SETUP VALID')
    def test_backtest_unknown_not_filled(self):
        rows=[dict(mint='x',verdict='SETUP VALID',curve_progress_pct=40),dict(mint='y',verdict='SETUP VALID',curve_progress_pct=20,outcome_verified=True,outcome='graduated')]
        r=backtest(rows);self.assertEqual(r['unverified'],1);self.assertEqual(r['graduated'],1)
    def test_weekly_positions_and_r(self):
        rows=[dict(position_id='a',closed=True,net_pnl_sol=.02,risk_sol=.01,hour=10),dict(position_id='b',closed=True,net_pnl_sol=-.01,risk_sol=.01,hour=10),dict(position_id='a',closed=False,net_pnl_sol=.01)]
        r=weekly(rows);self.assertEqual(r['closed_positions'],2);self.assertEqual(r['by_hour']['10']['win_rate'],.5);self.assertEqual(r['by_hour']['10']['average_R'],.5)
    def test_no_execution_imports(self):
        text=(Path(__file__).resolve().parents[1]/'scanner.py').read_text()
        tree=ast.parse(text)
        names=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
        self.assertFalse(any(n.lower() in {'buy','sell','sign','send_transaction'} for n in names))
        self.assertNotIn('Keypair',text);self.assertNotIn('PRIVATE_KEY',text)

if __name__=='__main__': unittest.main()

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal


class Journal:
    def __init__(self,directory,wallet):
        directory.mkdir(parents=True,exist_ok=True)
        self.directory=directory
        self.lock=(directory/'process.lock').open('a+b')
        self.lock.seek(0);self.lock.write(b'0');self.lock.flush();self.lock.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.lock.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.lock.close();raise RuntimeError('ANOTHER_AI_PROCESS_IS_RUNNING') from None
        if (directory/'created.json').exists() and not (directory/'ledger.sqlite3').exists():
            self.lock.close();raise RuntimeError('JOURNAL_MISSING_DO_NOT_RESET')
        try:
            self.db=sqlite3.connect(directory/'ledger.sqlite3')
            self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
            self.db.executescript('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT);\nCREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,state TEXT,asset TEXT,side TEXT,cap TEXT,signed TEXT,response TEXT,before_cash INTEGER,before_qty INTEGER,created TEXT);\nCREATE TABLE IF NOT EXISTS positions(asset TEXT PRIMARY KEY,qty INTEGER,cost TEXT,market TEXT,outcome TEXT);\nCREATE TABLE IF NOT EXISTS events(at TEXT,kind TEXT,details TEXT);\nCREATE TABLE IF NOT EXISTS calls(day TEXT PRIMARY KEY,n INTEGER);')
            previous=self.db.execute("SELECT v FROM meta WHERE k='wallet'").fetchone()
            if previous and previous[0].lower()!=wallet.lower():raise RuntimeError('JOURNAL_WALLET_MISMATCH')
            with self.db:self.db.execute("INSERT OR IGNORE INTO meta VALUES ('wallet',?)",(wallet.lower(),))
            marker=directory/'created.json'
            if not marker.exists():
                with marker.open('x',encoding='utf-8') as file:
                    json.dump({'wallet':wallet.lower(),'created':self.now()},file);file.flush();os.fsync(file.fileno())
        except BaseException:
            self.lock.close();raise

    @staticmethod
    def now():return datetime.now(timezone.utc).isoformat()

    def event(self,kind,details):
        with self.db:self.db.execute('INSERT INTO events VALUES (?,?,?)',(self.now(),kind,json.dumps(details,default=str)))

    def remaining(self,budget):
        spent=sum((Decimal(r[0]) for r in self.db.execute("SELECT cap FROM orders WHERE side='BUY' AND state NOT IN ('REJECTED')")),Decimal(0))
        return max(Decimal(0),budget-spent)

    def pending(self):return self.db.execute("SELECT id FROM orders WHERE state IN ('PREPARED','SENDING','UNKNOWN','ACCEPTED') LIMIT 1").fetchone() is not None

    def prepare(self,asset,side,cap,signed,before_cash,before_qty,budget):
        if not budget.is_finite() or not 0<budget<=7 or not cap.is_finite() or side not in ('BUY','SELL') or (side=='BUY' and not 0<cap<=budget) or (side=='SELL' and cap!=0):
            raise RuntimeError('INVALID_JOURNAL_BUDGET')
        if self.pending():raise RuntimeError('UNRESOLVED_ORDER_BLOCKS_NEW_SUBMISSION')
        if side=='BUY' and cap>self.remaining(budget):raise RuntimeError('TEST_BUDGET_EXCEEDED')
        identifier=uuid.uuid4().hex
        with self.db:self.db.execute('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)',
            (identifier,'PREPARED',asset,side,str(cap),json.dumps(signed,default=str),'',before_cash,before_qty,self.now()))
        return identifier

    def transition(self,identifier,state,response=None):
        with self.db:
            if response is None:self.db.execute('UPDATE orders SET state=? WHERE id=?',(state,identifier))
            else:self.db.execute('UPDATE orders SET state=?,response=? WHERE id=?',(state,json.dumps(response,default=str),identifier))

    def positions(self):
        return [dict(asset=r[0],qty=r[1],cost=r[2],market=json.loads(r[3]),outcome=r[4])
                for r in self.db.execute('SELECT asset,qty,cost,market,outcome FROM positions WHERE qty>0')]

    def confirmed(self,identifier,asset,side,cash_delta,qty_delta,market,outcome,before_qty):
        from dataclasses import asdict
        with self.db:
            if side=='BUY':
                row=self.db.execute('SELECT qty FROM positions WHERE asset=?',(asset,)).fetchone()
                if row and row[0]>0:raise RuntimeError('POSITION_ACCOUNTING_MISMATCH')
                self.db.execute('INSERT OR REPLACE INTO positions VALUES (?,?,?,?,?)',(asset,qty_delta,str(-cash_delta),json.dumps(asdict(market)),outcome))
                self.db.execute('UPDATE orders SET cap=? WHERE id=?',(str(-cash_delta),identifier))
            else:
                row=self.db.execute('SELECT qty,cost FROM positions WHERE asset=?',(asset,)).fetchone()
                if not row or row[0]!=before_qty:raise RuntimeError('POSITION_ACCOUNTING_MISMATCH')
                sold=-qty_delta
                basis=Decimal(row[1])*Decimal(sold)/Decimal(row[0])
                pnl=cash_delta-basis
                self.db.execute('UPDATE positions SET qty=?,cost=? WHERE asset=?',(row[0]-sold,str(Decimal(row[1])-basis),asset))
                self.db.execute('INSERT INTO events VALUES (?,?,?)',(self.now(),'REALIZED_PNL',json.dumps({'pnl':str(pnl)})))
            self.db.execute("UPDATE orders SET state='CONFIRMED' WHERE id=?",(identifier,))

    def daily_pnl(self):
        day=datetime.now(timezone.utc).date().isoformat()
        return sum((Decimal(json.loads(r[0])['pnl']) for r in self.db.execute("SELECT details FROM events WHERE kind='REALIZED_PNL' AND at LIKE ?",(day+'%',))),Decimal(0))

    def take_model_call(self,maximum):
        day=datetime.now(timezone.utc).date().isoformat()
        with self.db:
            row=self.db.execute('SELECT n FROM calls WHERE day=?',(day,)).fetchone()
            n=row[0] if row else 0
            if n>=maximum:raise RuntimeError('MODEL_DAILY_CALL_LIMIT')
            self.db.execute('INSERT OR REPLACE INTO calls VALUES (?,?)',(day,n+1))

    def close(self):
        self.db.close();self.lock.close()

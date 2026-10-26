"""Human-readable live status; no threads, network calls, signing or trading."""
import math
import time
from datetime import datetime,timedelta,timezone
from pathlib import Path

VN=timezone(timedelta(hours=7))


def display_time(offset=0):
    return (datetime.now(VN)+timedelta(seconds=offset)).strftime('%H:%M:%S VN')


def wait_next_cycle(seconds,cycle,last_action,stop_file=Path('STOP')):
    deadline=time.monotonic()+seconds
    next_heartbeat=time.monotonic()+30
    print(f'WAIT | cycle={cycle} | last={last_action} | next={display_time(seconds)} | in={math.ceil(seconds)}s',flush=True)
    while True:
        if stop_file.exists():
            print('STOP file found. No new order.',flush=True)
            return False
        now=time.monotonic()
        if now>=deadline:return True
        if now>=next_heartbeat:
            print(f'ALIVE | {display_time()} | cycle={cycle} | last={last_action} | next_in={math.ceil(deadline-now)}s',flush=True)
            next_heartbeat=now+30
        time.sleep(min(1,deadline-now))

"""Public news diagnostic: does not load .env.ai, signer, model key or account."""
import argparse
from datetime import datetime,timezone
from polymarket_arb.news_research import NewsResearch
from polymarket_arb.secure_bridge import SDKBridge


def main():
    parser=argparse.ArgumentParser(description='Read public RSS only; no wallet, model call or order')
    parser.add_argument('--query',default='Federal Reserve interest rates')
    args=parser.parse_args()
    bridge=SDKBridge()
    try:
        report=NewsResearch(bridge).collect('public-diagnostic',args.query)
        print('NEWS CHECK | '+report['status']+' | sources='+str(len(report['sources'])))
        for source in report['sources']:
            print(source['publisher_host']+' | '+datetime.fromtimestamp(source['published_at'],timezone.utc).isoformat())
            print(''.join(c for c in source['title'] if c.isprintable()))
            print(source['url'])
        print('HEADLINES ONLY. No account files, signer or model API loaded. No order sent.')
        return 0 if report['status'] in ('HEADLINES_ONLY','NO_RECENT_RELEVANT_HEADLINES') else 1
    finally:bridge.shutdown()


if __name__=='__main__':raise SystemExit(main())

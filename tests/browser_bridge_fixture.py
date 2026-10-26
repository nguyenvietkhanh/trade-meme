"""Optional real-Chromium OFFLINE transport test. Every API request is fulfilled locally."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import httpx
from playwright.sync_api import sync_playwright
from polymarket_arb.secure_bridge import SDKBridge,GuardError


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--executable');args=parser.parse_args()
    records=[]
    with sync_playwright() as p:
        options={'executable_path':args.executable} if args.executable else {'channel':'chrome'}
        browser=p.chromium.launch(headless=True,args=['--disable-background-networking'],**options)
        class ContextFacade:
            def __init__(self,context):self.context=context
            def route(self,pattern,handler):
                def wrapped(real):
                    class LocalRoute:
                        request=real.request
                        def fulfill(self,**kwargs):return real.fulfill(**kwargs)
                        def abort(self,*a,**k):return real.abort(*a,**k)
                        def continue_(self):
                            request=real.request
                            records.append((request.method,request.url))
                            if request.url.startswith('https://news.google.com/rss/search?'):
                                assert not any(k.lower().startswith('poly_') for k in request.headers)
                                real.fulfill(status=200,content_type='application/rss+xml',body='<rss><channel><title>OFFLINE_NEWS_FIXTURE</title></channel></rss>')
                                return
                            if '/auth/' in request.url: data={'secret':'FIXTURE_ONLY_SECRET'}
                            else:data={'ok':True}
                            real.fulfill(status=200,content_type='application/json',body=json.dumps(data))
                    handler(LocalRoute())
                self.context.route(pattern,wrapped)
            def new_page(self):return self.context.new_page()
            def close(self):return self.context.close()
        class BrowserFacade:
            def is_connected(self):return browser.is_connected()
            def new_context(self,**kwargs):return ContextFacade(browser.new_context(**kwargs))
            def close(self):return browser.close()
        bridge=SDKBridge();bridge.browser=BrowserFacade()
        try:
            r=bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/time'))
            assert r.status_code==200 and r.json()['ok']
            r=bridge.handle_request(httpx.Request('GET','https://clob.polymarket.com/auth/derive-api-key',headers={'POLY_SIGNATURE':'FIXTURE_ONLY'}))
            assert r.json()['secret']=='FIXTURE_ONLY_SECRET'
            assert 'FIXTURE_ONLY_SECRET' not in bridge.pages['clob.polymarket.com'].content()
            body=b'{"order":"fixture-only-not-a-real-order"}'
            bridge.authorize_order(body)
            r=bridge.handle_request(httpx.Request('POST','https://clob.polymarket.com/order',content=body))
            assert r.json()['ok']
            try:
                bridge.handle_request(httpx.Request('POST','https://clob.polymarket.com/order',content=body))
                raise AssertionError('replay was not blocked')
            except GuardError:pass
            assert len([r for r in records if r[0]=='POST'])==1
            r=bridge.handle_request(httpx.Request('GET','https://news.google.com/rss/search?q=fixture'))
            assert r.status_code==200 and r.content.startswith(b'<rss>')
            assert 'OFFLINE_NEWS_FIXTURE' not in bridge.pages['news.google.com'].content()
        finally:bridge.shutdown()
    print('OFFLINE CHROMIUM BRIDGE PASSED: local fixtures only; no real keys, API calls or orders.')


if __name__=='__main__':main()

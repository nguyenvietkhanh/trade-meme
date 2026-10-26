"""Pinned SDK transport adapter. No wallet deployment, approval or fund transfer."""
import hashlib
import json
import threading
import time
from urllib.parse import urlsplit
from unittest.mock import patch
import httpx

CLOB='clob.polymarket.com'
RPC='polygon.drpc.org'
NEWS='news.google.com'
HOSTS={CLOB,'gamma-api.polymarket.com','relayer-v2.polymarket.com',RPC,NEWS}
READ_RPC={'eth_chainId','eth_call','eth_getCode','eth_getBalance','eth_getTransactionReceipt','eth_blockNumber'}
_FACTORY_LOCK=threading.Lock()


def failure_code(error):
    """Return a fixed label, never raw browser errors containing request data."""
    text=str(error).upper()
    for marker,code in (
        ('ERR_CONNECTION_RESET','CONNECTION_RESET'),('ERR_NAME_NOT_RESOLVED','DNS_FAILED'),
        ('ERR_CONNECTION_REFUSED','CONNECTION_REFUSED'),('ERR_CERT_','TLS_CERTIFICATE_ERROR'),
        ('ERR_PROXY_CONNECTION_FAILED','PROXY_FAILED'),('ERR_TUNNEL_CONNECTION_FAILED','PROXY_FAILED'),
        ('EXECUTABLE DOESN\'T EXIST','CHROME_NOT_INSTALLED'),('ERR_TIMED_OUT','TIMEOUT'),
        ('ABORTERROR','TIMEOUT'),('TIMEOUT','TIMEOUT'),('TARGETCLOSED','BROWSER_CLOSED'),
        ('HAS BEEN CLOSED','BROWSER_CLOSED'),('RESPONSE_LIMIT','RESPONSE_TOO_LARGE')):
        if marker in text:return code
    return 'FETCH_FAILED'


def request_stage(request):
    host,path=request.url.host,request.url.path
    if host==RPC:
        try:method=json.loads(request.content).get('method')
        except (ValueError,AttributeError):method=None
        return 'POLYGON_CHAIN_ID' if method=='eth_chainId' else 'POLYGON_READ'
    if host=='relayer-v2.polymarket.com':return 'WALLET_DEPLOYMENT_READ'
    if host=='gamma-api.polymarket.com':return 'MARKET_DISCOVERY'
    if host==NEWS:return 'NEWS_RSS_READ'
    return {'/auth/api-key':'AUTH_CREATE','/auth/derive-api-key':'AUTH_DERIVE',
            '/balance-allowance':'ACCOUNT_BALANCE','/balance-allowance/update':'BALANCE_REFRESH',
            '/data/orders':'OPEN_ORDERS','/data/trades':'SETTLEMENT_READ',
            '/order':'ORDER_SUBMIT','/time':'SERVER_TIME','/book':'ORDER_BOOK'}.get(path,'CLOB_READ')


class GuardError(RuntimeError):
    pass


class SDKBridge(httpx.BaseTransport):
    def __init__(self):
        self.driver=self.browser=None
        self.pages={}
        self.contexts=[]
        self.clients=[]
        self.permit=None
        self.routing_permit=None
        self.last_error=None
        self.last_stage=None
        self.network_failures={}

    def authorize_order(self, payload):
        # Called only AFTER durable journal commit; grants one exact request.
        self.permit=(hashlib.sha256(payload).hexdigest(),time.monotonic()+5)

    def policy(self, method, url, body=b'', *, consume=False):
        p=urlsplit(str(url))
        if p.scheme!='https' or p.hostname not in HOSTS or p.username is not None or p.port not in (None,443) or p.fragment:
            raise GuardError('SDK_HOST_BLOCKED')
        host,path=p.hostname,p.path
        if method=='GET':
            if host==NEWS and path=='/rss/search':return
            if host==CLOB and (path in {'/','/time','/version','/auth/derive-api-key','/auth/api-keys','/balance-allowance','/balance-allowance/update','/closed-only','/data/orders','/data/trades','/book','/tick-size','/neg-risk'} or path.startswith(('/data/order/','/clob-markets/','/markets-by-token/'))):return
            if host=='gamma-api.polymarket.com' and (path=='/' or path.startswith('/markets')):return
            if host=='relayer-v2.polymarket.com' and path in {'/','/deployed'}:return
            if host==RPC and path=='/':return  # origin initialization only
        if method=='POST' and host==CLOB and path=='/auth/api-key':return
        if method=='POST' and host==RPC:
            try: d=json.loads(body)
            except ValueError: raise GuardError('RPC_PAYLOAD_INVALID') from None
            items=d if isinstance(d,list) else [d]
            if items and all(isinstance(x,dict) and x.get('method') in READ_RPC for x in items):return
        if method=='POST' and host==CLOB and path=='/order':
            digest=hashlib.sha256(body).hexdigest()
            permit=self.permit
            if permit and permit[0]==digest and time.monotonic()<=permit[1]:
                if consume:self.permit=None;self.routing_permit=digest
                return
        raise GuardError('SDK_WRITE_OR_UNAUTHORIZED_ORDER_BLOCKED')

    def _page(self,host):
        if host in self.pages:return self.pages[host]
        if self.browser is None:
            from playwright.sync_api import sync_playwright
            self.driver=sync_playwright().start()
            self.browser=self.driver.chromium.launch(channel='chrome',headless=False,
                args=['--disable-background-networking','--disable-component-update'])
        context=self.browser.new_context(ignore_https_errors=False,service_workers='block',accept_downloads=False)
        def route(r):
            req=r.request
            try:
                p=urlsplit(req.url)
                if p.hostname!=host:raise GuardError('CROSS_ORIGIN_BLOCKED')
                if p.path=='/__local_polymarket_sdk__' and req.method=='GET' and req.is_navigation_request():
                    # This document is fulfilled LOCALLY, never requested from Polymarket.
                    # No remote scripts or cookies; responses/credentials never render in UI.
                    r.fulfill(status=200,content_type='text/html',body='<html><head><meta charset="utf-8"></head><body>Local SDK bridge: private data is not displayed.</body></html>',
                              headers={'Content-Security-Policy':"default-src 'none'; connect-src 'self'"})
                    return
                body=(req.post_data or '').encode()
                if req.method=='POST' and p.path=='/order':
                    if host!=CLOB or self.routing_permit!=hashlib.sha256(body).hexdigest():
                        raise GuardError('ORDER_NOT_AUTHORIZED')
                    self.routing_permit=None
                else:self.policy(req.method,req.url,body)
                r.continue_()
            except Exception:r.abort('blockedbyclient')
        context.route('**/*',route)
        page=context.new_page()
        def failed(request):
            if urlsplit(request.url).hostname==host:
                self.network_failures[host]=failure_code(request.failure or '')
        page.on('requestfailed',failed)
        self.contexts.append(context)
        seed='/__local_polymarket_sdk__'
        try:page.goto('https://'+host+seed,wait_until='domcontentloaded',timeout=25000)
        except Exception:
            # Never retry a write. Caller may retry this READ-ONLY initialization.
            raise GuardError('SDK_BROWSER_ORIGIN_CONNECTION_FAILED') from None
        if urlsplit(page.url).hostname!=host:raise GuardError('SDK_BROWSER_ORIGIN_MISMATCH')
        self.pages[host]=page
        return page

    def handle_request(self,request):
        body=request.content
        self.policy(request.method,str(request.url),body,consume=True)
        host=request.url.host
        headers={k:v for k,v in request.headers.items() if k.lower().startswith('poly_') or k.lower()=='content-type'}
        if host!=CLOB and any(k.lower().startswith('poly_') for k in headers):raise GuardError('AUTH_ORIGIN_BLOCKED')
        stage=request_stage(request)
        self.last_stage=stage
        # Only idempotent reads may retry. Neither auth creation nor orders replay.
        attempts=3 if request.method=='GET' or (request.method=='POST' and host==RPC) else 1
        for attempt in range(1,attempts+1):
          self.network_failures.pop(host,None)
          try:
            page=self._page(host)
            result=page.evaluate('''async ({url,method,headers,body}) => {
              const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20000);
              try {
                const r=await fetch(url,{method,headers,body:body||undefined,credentials:'omit',
                  redirect:'error',cache:'no-store',signal:controller.signal});
                const text=await r.text();
                if(text.length>8000000)throw new Error('response_limit');
                return {status:r.status,text,retry:r.headers.get('retry-after')||'',content_type:r.headers.get('content-type')||''};
              } finally {clearTimeout(timer);}
            }''',{'url':str(request.url),'method':request.method,'headers':headers,'body':body.decode() if body else None})
            self.last_error=None
            if 200<=result['status']<300 and host!=NEWS:
                acknowledgement=(host==CLOB and request.method=='GET' and
                                 request.url.path=='/balance-allowance/update' and
                                 result['text'].strip() in ('','OK'))
                try:json.loads(result['text'])
                except (ValueError,TypeError):
                    # Never print the response: even a malformed auth response may contain secrets.
                    if not acknowledgement:
                        self.last_error=f'SDK_{stage}_NON_JSON_RESPONSE'
                        raise GuardError(self.last_error)
                    print(f'SDK ACK | stage={stage} | status={int(result["status"])} | balance must be read separately',flush=True)
            if result['status']>=400:
                # No body, query, wallet, auth header or credential is logged.
                self.last_error=f'SDK_{stage}_HTTP_{int(result["status"])}'
                print(f'SDK HTTP | host={host} | stage={stage} | status={int(result["status"])}',flush=True)
            return httpx.Response(result['status'],content=result['text'].encode(),
                                  headers={'content-type':result.get('content_type','application/json'),'retry-after':result['retry']},request=request)
          except GuardError as exc:
            self.last_error=str(exc)
            raise
          except Exception as exc:
            code=self.network_failures.get(host) or failure_code(exc)
            self.last_error=f'SDK_{stage}_{code}'
            print(f'SDK NETWORK | host={host} | stage={stage} | code={code} | attempt={attempt}/{attempts}',flush=True)
            if attempt<attempts and code in {'CONNECTION_RESET','DNS_FAILED','CONNECTION_REFUSED','TIMEOUT','FETCH_FAILED'}:
                time.sleep(.5*attempt)
                continue
            raise httpx.TransportError(self.last_error) from None
          finally:
            self.routing_permit=None

    def close(self):pass  # SDK transports share this bridge; lifecycle belongs to application.

    def shutdown(self):
        for client in self.clients:
            try:client.close()
            except Exception:pass
        for context in self.contexts:
            try:context.close()
            except Exception:pass
        if self.browser:
            try:self.browser.close()
            except Exception:pass
        if self.driver:
            try:self.driver.stop()
            except Exception:pass
        self.driver=self.browser=None
        self.pages.clear();self.contexts.clear();self.clients.clear();self.permit=None


def connect_sdk(private_key, wallet, bridge):
    from importlib.metadata import version
    if version('polymarket-client')!='0.14.0':raise GuardError('SDK_VERSION_CHANGED_REVIEW_REQUIRED')
    from polymarket import SecureClient
    import polymarket.clients.secure as module
    original=module.SyncTransport
    class InjectedTransport(original):
        def __init__(self,*,base_url,**kwargs):
            client=httpx.Client(base_url=base_url,transport=bridge,timeout=30,follow_redirects=False)
            bridge.clients.append(client)
            kwargs.pop('client',None)
            super().__init__(base_url=base_url,client=client,**kwargs)
    class ExistingAccountClient(SecureClient):
        def _ensure_wallet_ready(self):
            # Existing wallets are verified on chain rather than via the relayer
            # deployment-status service. No wallet creation or transaction is submitted.
            ctx=self._ctx
            if ctx.signer_type!='OWNER':raise GuardError('WALLET_OWNER_NOT_VERIFIED')
            ctx.rpc.verify_chain_id(137)
            if ctx.wallet_type=='EOA':return self
            code=ctx.rpc._call('eth_getCode',[str(ctx.wallet),'latest'])
            if not isinstance(code,str) or not code.startswith('0x') or len(code)%2:
                raise GuardError('WALLET_CODE_RESPONSE_INVALID')
            try:raw=bytes.fromhex(code[2:])
            except ValueError:raise GuardError('WALLET_CODE_RESPONSE_INVALID') from None
            if not raw or not any(raw):raise GuardError('EXISTING_WALLET_REQUIRED_NO_AUTO_DEPLOY')
            return self

        def _deploy_default_deposit_wallet(self):
            raise GuardError('EXISTING_WALLET_REQUIRED_NO_AUTO_DEPLOY')
    def derive_existing_credentials(*,config,signer,clob,provided,nonce,validate,logger):
        # This account has already provisioned credentials. Derive them using
        # the SDK's official L1 signature and GET, never create/rotate on startup.
        signature=module.sign_api_key_auth(signer,chain_id=config.chain_id,
                                           timestamp=int(time.time()),nonce=nonce)
        return module._auth_actions.derive_api_key_sync(clob,signature)
    # Constructor injection is confined to a single-threaded factory call, SDK 0.14.0.
    with _FACTORY_LOCK,patch.object(module,'SyncTransport',InjectedTransport),\
         patch.object(module,'_bootstrap_credentials_sync',derive_existing_credentials):
        client=ExistingAccountClient.create(private_key=private_key,wallet=wallet,logger=None)
    if client.wallet.lower()!=wallet.lower() or client._ctx.signer_type!='OWNER':
        client.close();raise GuardError('WALLET_OWNER_NOT_VERIFIED')
    client._ctx.rpc.verify_chain_id(137)
    return client

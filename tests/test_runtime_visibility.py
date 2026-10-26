import contextlib
import io
import os
import sys
import types
import unittest
from unittest.mock import Mock,patch
from polymarket_arb.secure_bridge import SDKBridge,GuardError
from polymarket_arb.runtime_status import wait_next_cycle
from polymarket_arb.ai_settings import AISettings


def fake_chrome(host='clob.polymarket.com'):
    page=Mock();page.is_closed.return_value=False
    page.url='https://'+host+'/__local_polymarket_sdk__'
    context=Mock();context.new_page.return_value=page
    browser=Mock();browser.is_connected.return_value=True;browser.new_context.return_value=context
    driver=Mock();driver.chromium.launch.return_value=browser
    manager=Mock();manager.start.return_value=driver
    parent=types.ModuleType('playwright');parent.__path__=[]
    module=types.ModuleType('playwright.sync_api');module.sync_playwright=Mock(return_value=manager)
    return page,context,browser,driver,{'playwright':parent,'playwright.sync_api':module}


class VisibilityTests(unittest.TestCase):
    def test_hidden_chrome_reuses_one_context_for_repeated_host_reads(self):
        page,context,browser,driver,modules=fake_chrome();bridge=SDKBridge()
        with patch.dict(sys.modules,modules):
            for _ in range(10):self.assertIs(bridge._page('clob.polymarket.com'),page)
        driver.chromium.launch.assert_called_once()
        self.assertTrue(driver.chromium.launch.call_args.kwargs['headless'])
        self.assertFalse(browser.new_context.call_args.kwargs['ignore_https_errors'])
        self.assertEqual(browser.new_context.call_count,1)
        self.assertEqual(len(bridge.contexts),1)
        self.assertEqual(len(bridge.page_contexts),1)

    def test_failed_page_initializations_close_their_contexts(self):
        page,context,browser,driver,modules=fake_chrome()
        page.goto.side_effect=RuntimeError('fixture timeout');bridge=SDKBridge()
        with patch.dict(sys.modules,modules):
            for _ in range(10):
                with self.assertRaises(GuardError):bridge._page('clob.polymarket.com')
        self.assertEqual(context.close.call_count,10)
        self.assertEqual(bridge.contexts,[])
        self.assertEqual(bridge.pages,{})
        self.assertEqual(bridge.page_contexts,{})
        page,context,browser,driver,modules=fake_chrome();bridge=SDKBridge()
        driver.chromium.launch.side_effect=RuntimeError('fixture launch failed')
        with patch.dict(sys.modules,modules):
            for _ in range(2):
                with self.assertRaises(RuntimeError):bridge._page('clob.polymarket.com')
        self.assertEqual(driver.stop.call_count,2)
        self.assertIsNone(bridge.driver)
        self.assertIsNone(bridge.browser)

    def test_closed_page_is_replaced_and_old_context_is_released(self):
        page,old,browser,driver,modules=fake_chrome()
        next_page=Mock();next_page.url=page.url;next_page.is_closed.return_value=False
        next_context=Mock();next_context.new_page.return_value=next_page
        browser.new_context.side_effect=[old,next_context];bridge=SDKBridge()
        with patch.dict(sys.modules,modules):
            self.assertIs(bridge._page('clob.polymarket.com'),page)
            page.is_closed.return_value=True
            self.assertIs(bridge._page('clob.polymarket.com'),next_page)
        old.close.assert_called_once()
        self.assertEqual(bridge.contexts,[next_context])

    def test_disconnected_browser_restarts_without_closing_sdk_clients(self):
        page,context,browser,driver,modules=fake_chrome();bridge=SDKBridge()
        dead=Mock();dead.is_connected.return_value=False
        old_driver=Mock();old_context=Mock();client=Mock()
        bridge.browser=dead;bridge.driver=old_driver;bridge.contexts=[old_context];bridge.clients=[client]
        with patch.dict(sys.modules,modules):bridge._page('clob.polymarket.com')
        old_driver.stop.assert_called_once();old_context.close.assert_called_once()
        client.close.assert_not_called()
        self.assertIs(bridge.browser,browser)

    def test_visible_fallback_and_invalid_configuration(self):
        env={'POLYMARKET_WALLET_ADDRESS':'0x'+'12'*20,'SIGNER_PRIVATE_KEY':'01'*32,'BROWSER_HEADLESS':'false'}
        with patch.dict(os.environ,env,clear=True):self.assertFalse(AISettings.from_env().browser_headless)
        with patch.dict(os.environ,dict(env,BROWSER_HEADLESS='wrong'),clear=True):
            with self.assertRaisesRegex(ValueError,'INVALID_BROWSER_HEADLESS'):AISettings.from_env()
        page,context,browser,driver,modules=fake_chrome()
        with patch.dict(sys.modules,modules):SDKBridge(headless=False)._page('clob.polymarket.com')
        self.assertFalse(driver.chromium.launch.call_args.kwargs['headless'])

    def test_idle_countdown_emits_regular_heartbeat_without_network_calls(self):
        clock=[0.0];sleeps=[]
        def sleep(seconds):sleeps.append(seconds);clock[0]+=seconds
        stop=Mock();stop.exists.return_value=False;output=io.StringIO()
        with patch('polymarket_arb.runtime_status.time.monotonic',side_effect=lambda:clock[0]),\
             patch('polymarket_arb.runtime_status.time.sleep',side_effect=sleep),contextlib.redirect_stdout(output):
            self.assertTrue(wait_next_cycle(65,3,'HOLD',stop))
        text=output.getvalue()
        self.assertIn('WAIT | cycle=3 | last=HOLD',text)
        self.assertEqual(text.count('ALIVE |'),2)
        self.assertIn('next_in=35s',text)
        self.assertTrue(all(0<seconds<=1 for seconds in sleeps))

    def test_stop_file_interrupts_idle_wait(self):
        clock=[0.0];stop=Mock();stop.exists.side_effect=[False,True]
        with patch('polymarket_arb.runtime_status.time.monotonic',side_effect=lambda:clock[0]),\
             patch('polymarket_arb.runtime_status.time.sleep',side_effect=lambda s:clock.__setitem__(0,clock[0]+s)),\
             contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(wait_next_cycle(180,1,'HOLD',stop))
        self.assertEqual(clock[0],1)

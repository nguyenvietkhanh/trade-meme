import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from run_local import load_env
from local_verify import fetch


class LocalTests(unittest.TestCase):
    def test_dotenv_is_data_and_does_not_load_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('INTERVAL=15\nPRIVATE_KEY=fixture-not-a-key\nOUTPUT_DIR=$(never_execute)\n')
            with patch.dict(os.environ, {}, clear=True):
                load_env(path)
                self.assertEqual(os.environ['INTERVAL'], '15')
                self.assertEqual(os.environ['OUTPUT_DIR'], '$(never_execute)')
                self.assertNotIn('PRIVATE_KEY', os.environ)

    def test_environment_overrides_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('INTERVAL=15\n')
            with patch.dict(os.environ, {'INTERVAL': '30'}):
                load_env(path)
                self.assertEqual(os.environ['INTERVAL'], '30')

    def test_verifier_rejects_external_urls_before_request(self):
        for url in ('http://docs.polymarket.com', 'https://example.com',
                    'https://user@docs.polymarket.com', 'https://docs.polymarket.com:123/'):
            with self.assertRaises(ValueError): fetch(url)

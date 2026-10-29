import unittest, smtplib
from mail_delivery import send_notification,permanent_failure,address
class Client:
    calls=[]
    refused={}
    def __init__(self,*args,**kwargs):self.calls.append(('connect',args,kwargs))
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def ehlo(self):self.calls.append(('ehlo',))
    def starttls(self,**kwargs):self.calls.append(('starttls',kwargs))
    def login(self,*args):self.calls.append(('login',args))
    def send_message(self,message):self.calls.append(('send',message));return self.refused
class SMTP:
    SMTP=SMTP_SSL=Client
class DeliveryTests(unittest.TestCase):
    def setUp(self):Client.calls=[];Client.refused={};self.values={'SMTP_HOST':'smtp.invalid','MAIL_FROM':'sender@example.test','SMTP_USER':'user','SMTP_PASSWORD':'test-only'};self.item={'id':'unit-test','recipient':'recipient@example.test','message':'Test body'}
    def send(self):send_notification(self.item,'https://example.test',lambda key,default='':self.values.get(key,default),SMTP)
    def test_starttls_and_current_prefix_credentials(self):
        self.send();names=[c[0] for c in Client.calls];self.assertLess(names.index('starttls'),names.index('login'));self.assertEqual(next(c[1] for c in Client.calls if c[0]=='login'),('user','test-only'));self.assertTrue(next(c[1] for c in Client.calls if c[0]=='send')['Message-ID'].startswith('<rinlu-'))
    def test_implicit_tls_has_verifying_context(self):
        self.values['SMTP_PORT']='465';self.send();self.assertIn('context',Client.calls[0][2]);self.assertFalse(any(c[0]=='starttls' for c in Client.calls))
    def test_plaintext_transport_rejected(self):
        self.values['SMTP_MODE']='plain'
        with self.assertRaises(ValueError):self.send()
        self.assertEqual(Client.calls,[])
    def test_header_injection_and_refusal(self):
        with self.assertRaises(ValueError):address('test@example.test\r\nBcc: other@example.test')
        Client.refused={'recipient@example.test':(550,b'blocked')}
        with self.assertRaises(smtplib.SMTPRecipientsRefused):self.send()
    def test_permanent_vs_temporary(self):
        self.assertTrue(permanent_failure(smtplib.SMTPResponseException(550,b'blocked')));self.assertFalse(permanent_failure(smtplib.SMTPResponseException(450,b'retry')));self.assertFalse(permanent_failure(TimeoutError()))
if __name__=='__main__':unittest.main()

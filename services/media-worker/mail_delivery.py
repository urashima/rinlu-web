"""TLS-only transport. SMTP acceptance is distinct from inbox delivery."""
import smtplib, ssl
from email.message import EmailMessage
from email.utils import parseaddr

def address(value):
    if not value or '\r' in value or '\n' in value:
        raise ValueError('Invalid mail address')
    _, parsed = parseaddr(value)
    if parsed != value or parsed.count('@') != 1:
        raise ValueError('Use one bare email address')
    return parsed

def send_notification(item, origin, setting, smtp=smtplib):
    host=setting('SMTP_HOST');sender=address(setting('MAIL_FROM'));recipient=address(item['recipient'])
    port=int(setting('SMTP_PORT','587'));mode=setting('SMTP_MODE') or ('tls' if port==465 else 'starttls')
    if mode not in ('tls','starttls') or not host or not 1<=port<=65535:
        raise ValueError('Configure a TLS SMTP transport')
    message=EmailMessage();message['From']=sender;message['To']=recipient
    message['Subject']='RINLU account notification'
    message['Message-ID']='<rinlu-'+item['id']+'@'+sender.rsplit('@',1)[1]+'>'
    message.set_content(item['message']+'\n\nManage your recordings and notifications at '+origin)
    context=ssl.create_default_context()
    connection=smtp.SMTP_SSL(host,port,timeout=30,context=context) if mode=='tls' else smtp.SMTP(host,port,timeout=30)
    with connection as client:
        client.ehlo()
        if mode=='starttls':
            client.starttls(context=context);client.ehlo()
        username=setting('SMTP_USER')
        if username:client.login(username,setting('SMTP_PASSWORD'))
        refused=client.send_message(message)
        if refused:raise smtplib.SMTPRecipientsRefused(refused)

def permanent_failure(error):
    if isinstance(error,smtplib.SMTPRecipientsRefused):
        return bool(error.recipients) and all(500<=value[0]<600 for value in error.recipients.values())
    return isinstance(error,smtplib.SMTPResponseException) and 500<=error.smtp_code<600

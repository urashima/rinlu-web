#!/usr/bin/env python3
"""Trusted, pull-based RINLU processor. No public listener or inbound port."""
import json, os, time, tempfile, subprocess, urllib.request, urllib.error, uuid, hashlib, smtplib, ssl, signal, threading
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse
from media_validation import audio_stream

def setting(key, default=''):
    return os.environ.get('RINLU_'+key, os.environ.get('SONORA_'+key, default))

ORIGIN = setting('ORIGIN', '').rstrip('/')
TOKEN = setting('PROCESSOR_TOKEN', '')
ALERT = setting('ALERT_WEBHOOK', '')
if not ORIGIN.startswith('https://') or not TOKEN:
    raise SystemExit('Set HTTPS SONORA_ORIGIN and SONORA_PROCESSOR_TOKEN')
WORKER = setting('WORKER_NAME', 'media-worker')
HEADERS = {'Authorization': 'Bearer ' + TOKEN}
# Optional supported private-Site service access; never substitutes for job auth.
if setting('SITES_ACCESS_TOKEN'):
    HEADERS['OAI-Sites-Authorization'] = 'Bearer ' + setting('SITES_ACCESS_TOKEN')

class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a processor or private-Site credential to a redirect.
        raise RuntimeError('Unexpected redirect from RINLU; check host access')
OPENER = urllib.request.build_opener(SameOriginRedirect())

def request(path, data=None, lease=None, content_type='application/json'):
    if not path.startswith('/api/service/'):
        raise ValueError('Unexpected processor path')
    headers = dict(HEADERS)
    if lease: headers['X-Job-Lease'] = lease
    if data is not None: headers['Content-Type'] = content_type
    body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
    return OPENER.open(urllib.request.Request(ORIGIN + path, data=body, headers=headers), timeout=240)

def post(path, data, lease=None):
    with request(path, data, lease) as response:
        return json.load(response)

def command(args, timeout=180):
    # Every subprocess receives literal arguments, a fixed executable and a
    # private per-job directory. No shell, input URL, playlist or protocol fetch.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Media validation or conversion failed (exit %d)' % result.returncode)
    return result.stdout

def scan(path):
    result = subprocess.run(['clamscan', '--no-summary', '--infected', '--max-filesize=40M', '--max-scansize=80M', str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    if result.returncode == 1: raise ValueError('infected')
    if result.returncode: raise RuntimeError('Malware scanner unavailable')

def heartbeat():
    # clamscan --version does not prove usable signatures. A fresh empty file
    # is actually scanned and the signature database must be younger than 48h.
    files = [p for p in Path('/var/lib/clamav').glob('*') if p.suffix in ('.cvd', '.cld')]
    if not files or time.time() - max(p.stat().st_mtime for p in files) > 48*3600:
        raise RuntimeError('Scanner signatures absent or stale')
    with tempfile.NamedTemporaryFile() as probe:
        probe.write(b'RINLU scanner readiness probe'); probe.flush(); scan(probe.name)
    post('/api/service/heartbeat', {'worker': WORKER, 'scanner': 'ready', 'version': '2'})

def process(job):
    lease=job['lease']
    try:
        with tempfile.TemporaryDirectory(prefix='sonora-') as directory:
            source=Path(directory)/'source.bin'; output=Path(directory)/'stream.mp3'
            size=0
            with request(job['input'], lease=lease) as response, source.open('wb') as target:
                while True:
                    chunk=response.read(65536)
                    if not chunk: break
                    size+=len(chunk)
                    if size>25*1024*1024: raise RuntimeError('Original exceeds input limit')
                    target.write(chunk)
            scan(source)
            metadata=json.loads(command(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=codec_type,sample_rate,channels:stream_disposition=attached_pic:format=duration','-of','json',str(source)]))
            audio_stream(metadata)
            command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(source),'-map','0:a:0','-vn','-map_metadata','-1','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-codec:a','libmp3lame','-b:a','128k','-ar','44100','-ac','2','-id3v2_version','3','-f','mp3',str(output)],timeout=240)
            if output.stat().st_size>32*1024*1024: raise RuntimeError('Rendition exceeds 32 MB; use a shorter recording')
            scan(output)
            boundary='sonora-'+uuid.uuid4().hex
            body=(f'--{boundary}\r\nContent-Disposition: form-data; name="scan"\r\n\r\nclean\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="stream.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n').encode()+output.read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
            with request(job['complete'],body,lease,'multipart/form-data; boundary='+boundary) as response:
                json.load(response)
            print(json.dumps({'job':job['id'],'status':'complete'}),flush=True)
    except Exception as error:
        infected=str(error)=='infected'
        post(job['fail'],{'error':'Malware detected' if infected else str(error)[:500],'scan':'infected' if infected else 'error'},lease)
        print(json.dumps({'job':job['id'],'status':'failed'}),flush=True)

def alert():
    if not ALERT.startswith('https://'): return
    try:
        payload=json.dumps({'text':'RINLU media worker or maintenance failed. Check processor logs.','worker':WORKER}).encode()
        with urllib.request.urlopen(urllib.request.Request(ALERT,payload,{'Content-Type':'application/json'}),timeout=10): pass
    except Exception: pass

def deliver_mail():
    host = setting('SMTP_HOST')
    if not host: return
    item = post('/api/service/mail-claim', {}).get('mail')
    if not item: return
    try:
        sender=os.environ['SONORA_MAIL_FROM']
        message=EmailMessage();message['From']=sender;message['To']=item['recipient']
        message['Subject']='RINLU account notification'
        message['Message-ID']='<sonora-'+item['id']+'@'+sender.split('@')[-1]+'>'
        message.set_content(item['message']+'\n\nManage your recordings and notifications at '+ORIGIN)
        port=int(setting('SMTP_PORT','587'))
        with smtplib.SMTP(host,port,timeout=30) as smtp:
            smtp.ehlo();smtp.starttls(context=ssl.create_default_context());smtp.ehlo()
            if setting('SMTP_USER'):smtp.login(os.environ['SONORA_SMTP_USER'],os.environ['SONORA_SMTP_PASSWORD'])
            smtp.send_message(message)
        post('/api/service/mail-complete',{'id':item['id'],'lease':item['lease']})
    except Exception:
        post('/api/service/mail-fail',{'id':item['id'],'lease':item['lease'],'error':'SMTP delivery failed; inspect the configured mail service'})

STOP=threading.Event()
signal.signal(signal.SIGTERM,lambda *_:STOP.set())
signal.signal(signal.SIGINT,lambda *_:STOP.set())
last_maintenance=last_heartbeat=last_update=0
while not STOP.is_set():
    try:
        current=time.time()
        if current-last_maintenance>60: post('/api/service/maintenance',{});last_maintenance=current
        deliver_mail()
        if current-last_update>12*3600:
            command(['freshclam','--stdout','--config-file=/app/freshclam.conf'],timeout=300);last_update=current
        if current-last_heartbeat>60: heartbeat();last_heartbeat=current
        if STOP.is_set(): break
        job=post('/api/service/claim',{}).get('job')
        if job: process(job)
        else: STOP.wait(5)
    except Exception as error:
        # Never log response bodies, signed playback URLs, source paths or keys.
        print(json.dumps({'status':'unavailable','error_type':type(error).__name__}),flush=True)
        alert();STOP.wait(60)

#!/usr/bin/env python3
"""Trusted, pull-based RINLU processor. No public listener or inbound port."""
import json, os, time, tempfile, subprocess, urllib.request, urllib.error, uuid, hashlib, smtplib, ssl, signal, threading
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse
from media_validation import audio_stream
from audio_analysis import analyze_pcm
from mail_delivery import send_notification, permanent_failure
from s3_io import Storage, validate_key

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
    ready={'worker': WORKER, 'scanner': 'ready', 'version': '3'}
    if setting('S3_PROCESSOR_MODE')=='1':
        Storage()  # Fail closed if private S3 credentials or endpoint are missing.
        ready['s3_primary']='ready'
    post('/api/service/heartbeat', ready)

def process_artwork(job):
    """S3-only normalized JPEG, antivirus, dimensions and metadata-only D1 completion."""
    lease=job['lease']
    try:
        if setting('S3_PROCESSOR_MODE')!='1':raise RuntimeError('S3 artwork scanning is disabled')
        store=Storage()
        with tempfile.TemporaryDirectory(prefix='rinlu-artwork-') as directory:
            source=Path(directory)/'original.jpg';output=Path(directory)/'normalized.jpg'
            meta=store.read(validate_key(job['input_storage_key'],'original'),source,5*1024*1024)
            scan(source)
            with source.open('rb') as image:
                if not image.read(3).startswith(b'\xff\xd8\xff'):raise RuntimeError('Only JPEG cover artwork is supported')
            details=json.loads(command(['ffprobe','-v','error','-f','image2',
                '-show_entries','stream=codec_name,width,height','-of','json',str(source)],timeout=90))
            frames=details.get('streams',[])
            if len(frames)!=1 or frames[0].get('codec_name')!='mjpeg':
                raise RuntimeError('Unsupported cover art stream')
            width=int(frames[0].get('width',0));height=int(frames[0].get('height',0))
            if min(width,height)<500 or max(width,height)>8192 or abs(width/height-1)>.05:
                raise RuntimeError('Cover artwork must be square and between 500 and 8192 pixels')
            command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe',
                '-f','image2','-i',str(source),'-frames:v','1','-map_metadata','-1',
                '-q:v','3','-y','-f','image2',str(output)],timeout=120)
            if not output.is_file() or output.stat().st_size>5*1024*1024:
                raise RuntimeError('Normalized cover exceeds 5 MB')
            scan(output)
            uploaded=store.put_artwork(validate_key(job['output_storage_key'],'artwork'),output)
            post(job['complete'],{
                'storage_provider':'ovh-s3',
                'kind':'artwork',
                'input_storage_key':job['input_storage_key'],
                'output_storage_key':uploaded['storage_key'],
                'original_sha256':meta['sha256'],
                'normalized_sha256':uploaded['sha256'],
                'normalized_size':uploaded['size'],
                'width':width,'height':height,
                'scan':'clean','processor_version':'s3-primary-image-v1'
            },lease)
            print(json.dumps({'job':job['id'],'status':'artwork_complete'}),flush=True)
    except Exception as error:
        infected=str(error)=='infected'
        post(job['fail'],{'error':'Malware detected' if infected else str(error)[:500],
             'scan':'infected' if infected else 'error'},lease)
        print(json.dumps({'job':job['id'],'status':'artwork_failed'}),flush=True)

def process(job):
    if job.get('storage_provider')=='ovh-s3' and job.get('kind')=='artwork':
        return process_artwork(job)
    lease=job['lease']
    try:
        with tempfile.TemporaryDirectory(prefix='sonora-') as directory:
            source=Path(directory)/'source.bin'; output=Path(directory)/'stream.mp3'
            is_s3=job.get('storage_provider')=='ovh-s3'
            storage=None
            if is_s3:
                if setting('S3_PROCESSOR_MODE')!='1':raise RuntimeError('S3-only scanning has not been enabled')
                storage=Storage()
                source_meta=storage.read(validate_key(job['input_storage_key'],'original'),source)
                if job.get('original_sha256') and job['original_sha256']!=source_meta['sha256']:
                    raise RuntimeError('S3 original hash mismatch')
            else:
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
            if is_s3:
                # Upload a scanned rendition directly to private OVH S3, never R2.
                result=storage.put_rendition(validate_key(job['output_storage_key'],'rendition'),output)
                post(job['complete'],{
                    'storage_provider':'ovh-s3',
                    'input_storage_key':job['input_storage_key'],
                    'output_storage_key':result['storage_key'],
                    'original_sha256':source_meta['sha256'],
                    'rendition_sha256':result['sha256'],
                    'rendition_size':result['size'],
                    'scan':'clean',
                    'processor_version':'s3-primary-v1',
                },lease)
            else:
                boundary='sonora-'+uuid.uuid4().hex
                body=(f'--{boundary}\r\nContent-Disposition: form-data; name="scan"\r\n\r\nclean\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="stream.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n').encode()+output.read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
                with request(job['complete'],body,lease,'multipart/form-data; boundary='+boundary) as response:
                    json.load(response)
            print(json.dumps({'job':job['id'],'status':'complete'}),flush=True)
    except Exception as error:
        infected=str(error)=='infected'
        post(job['fail'],{'error':'Malware detected' if infected else str(error)[:500],'scan':'infected' if infected else 'error'},lease)
        print(json.dumps({'job':job['id'],'status':'failed'}),flush=True)

def analyze_rendition(job):
    try:
        with tempfile.TemporaryDirectory(prefix='rinlu-analysis-') as directory:
            source=Path(directory)/'stream.mp3'
            if job.get('storage_provider')=='ovh-s3':
                if setting('S3_PROCESSOR_MODE')!='1':raise RuntimeError('S3 analysis is not enabled')
                Storage().read(validate_key(job['input_storage_key'],'rendition'),source,32*1024*1024,'rendition')
            else:
                with request(job['input']) as response:
                    data=response.read(32*1024*1024+1)
                if len(data)>32*1024*1024: raise ValueError('Rendition too large')
                source.write_bytes(data)
            raw=command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(source),'-map','0:a:0','-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],timeout=240)
            analysis=analyze_pcm(raw)
            post(job['complete'],{'hash':job['hash'],'analysis':analysis})
            print(json.dumps({'job':job['id'],'status':'analysis_complete','version':1}),flush=True)
    except Exception:
        post('/api/service/analysis-fail/'+job['id'],{'hash':job['hash']})
        print(json.dumps({'job':job['id'],'status':'analysis_failed'}),flush=True)

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
        send_notification(item,ORIGIN,setting)
        post('/api/service/mail-complete',{'id':item['id'],'lease':item['lease']})
    except Exception as error:
        post('/api/service/mail-fail',{'id':item['id'],'lease':item['lease'],'retryable':not permanent_failure(error),'error':'SMTP delivery failed; inspect the configured mail service'})

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
        else:
            analysis_job=post('/api/service/analysis-claim',{}).get('job')
            if analysis_job: analyze_rendition(analysis_job)
            else: STOP.wait(5)
    except Exception as error:
        # Never log response bodies, signed playback URLs, source paths or keys.
        print(json.dumps({'status':'unavailable','error_type':type(error).__name__}),flush=True)
        alert();STOP.wait(60)

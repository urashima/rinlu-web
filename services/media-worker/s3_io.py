"""Private OVH S3 transport for the offline RINLU malware scanning processor.
All object locators are server-issued canonical job keys, never user URLs.
No new inbound ports or separate Python dependencies.
"""
import os, re, hashlib, hmac, datetime, urllib.request, urllib.error
from urllib.parse import quote

UUID=r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
ORIGINAL=re.compile(r'^originals/'+UUID+r'/'+UUID+r'$',re.I)
RENDITION=re.compile(r'^renditions/'+UUID+r'/v[1-9][0-9]*\.mp3$',re.I)
MAX_SOURCE=25*1024*1024
MAX_RENDITION=32*1024*1024

def validate_key(key,kind='original'):
    if not isinstance(key,str) or len(key)>250 or not ((ORIGINAL if kind=='original' else RENDITION).fullmatch(key)):
        raise ValueError('Untrusted S3 object locator')
    return key

def digest(data):
    return hashlib.sha256(data).hexdigest()

def _hmac(key,value):
    return hmac.new(key if isinstance(key,bytes) else key.encode(),value.encode(),hashlib.sha256).digest()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise RuntimeError('S3 request redirected outside the private bucket')

class Storage:
    def __init__(self,env=None,opener=None,clock=None):
        env=env or os.environ
        self.region=env.get('RINLU_S3_REGION','')
        self.bucket=env.get('RINLU_S3_BUCKET','')
        self.endpoint=env.get('RINLU_S3_ENDPOINT','')
        self.access=env.get('RINLU_S3_ACCESS_KEY_ID','')
        self.secret=env.get('RINLU_S3_SECRET_ACCESS_KEY','')
        suffix='us' if self.region.startswith('us-') else 'net'
        expected='https://s3.'+self.region+'.io.cloud.ovh.'+suffix
        if not self.region or self.endpoint.rstrip('/')!=expected or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',self.bucket) or not self.access or not self.secret:
            raise RuntimeError('Private OVH S3 processor configuration incomplete')
        if any(any(ch in value for ch in '\r\n\0') for value in (self.access,self.secret,self.bucket)):
            raise RuntimeError('Invalid S3 credential characters')
        self.opener=opener or urllib.request.build_opener(NoRedirect())
        self.clock=clock or (lambda:datetime.datetime.now(datetime.timezone.utc))

    def _signed(self,method,key,body=None,content_type=None):
        kind='rendition' if method=='PUT' or RENDITION.fullmatch(key or '') else 'original'
        validate_key(key,kind)
        path='/'+quote(self.bucket,safe='')+'/'+('/'.join(quote(c,safe='') for c in key.split('/')))
        stamp=self.clock().strftime('%Y%m%dT%H%M%SZ')
        day=stamp[:8]
        host=self.endpoint.split('https://',1)[1].rstrip('/')
        body=body or b''
        headers={'host':host,'x-amz-date':stamp,'x-amz-content-sha256':digest(body)}
        if content_type:headers['content-type']=content_type
        if method=='PUT':headers['content-length']=str(len(body))
        names=';'.join(sorted(headers))
        canonical='\n'.join([method,path,'',''.join(k+':'+str(headers[k]).strip()+'\n' for k in sorted(headers)),names,digest(body)])
        scope=day+'/'+self.region+'/s3/aws4_request'
        key1=_hmac('AWS4'+self.secret,day)
        key2=_hmac(key1,self.region)
        key3=_hmac(key2,'s3')
        key4=_hmac(key3,'aws4_request')
        to_sign='\n'.join(['AWS4-HMAC-SHA256',stamp,scope,digest(canonical.encode())])
        signature=hmac.new(key4,to_sign.encode(),hashlib.sha256).hexdigest()
        headers['authorization']='AWS4-HMAC-SHA256 Credential='+self.access+'/'+scope+', SignedHeaders='+names+', Signature='+signature
        return urllib.request.Request(self.endpoint.rstrip('/')+path,data=body if method=='PUT' else None,
          headers=headers,method=method)

    def read(self,key,destination,limit=MAX_SOURCE,kind='original'):
        validate_key(key,kind)
        if not 0<limit<=MAX_RENDITION:raise ValueError('Untrusted S3 file size limit')
        obj=self._signed('GET',key)
        total=0;sha=hashlib.sha256()
        with self.opener.open(obj,timeout=240) as response,open(destination,'wb') as out:
            while True:
                part=response.read(65536)
                if not part:break
                total+=len(part)
                if total>limit:raise RuntimeError('S3 original exceeded upload quota')
                out.write(part);sha.update(part)
        if total<100:raise RuntimeError('S3 original too small')
        return {'size':total,'sha256':sha.hexdigest()}

    def put_rendition(self,key,source):
        validate_key(key,'rendition')
        with open(source,'rb') as stream:
            body=stream.read(MAX_RENDITION+1)
        if not 0<len(body)<=MAX_RENDITION:raise RuntimeError('S3 rendition outside size bounds')
        req=self._signed('PUT',key,body,'audio/mpeg')
        with self.opener.open(req,timeout=240) as response:
            if response.status not in (200,201):raise RuntimeError('S3 rendition upload failed')
            response.read(2048)
        return {'storage_key':key,'size':len(body),'sha256':digest(body),'storage_provider':'ovh-s3'}

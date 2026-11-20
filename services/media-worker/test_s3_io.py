import unittest, datetime, io, tempfile, os
from pathlib import Path
from s3_io import Storage,validate_key,UUID,MAX_SOURCE,MAX_RENDITION
OWNER='11111111-1111-4111-8111-111111111111'
ID='22222222-2222-4222-8222-222222222222'
SOURCE='originals/'+OWNER+'/'+ID
RENDITION='renditions/'+ID+'/v2.mp3'
ENV={
 'RINLU_S3_BUCKET':'private-bucket-123',
 'RINLU_S3_REGION':'us-east-va',
 'RINLU_S3_ENDPOINT':'https://s3.us-east-va.io.cloud.ovh.us',
 'RINLU_S3_ACCESS_KEY_ID':'TESTACCESS',
 'RINLU_S3_SECRET_ACCESS_KEY':'TESTSECRET'
}
class FakeResponse(io.BytesIO):
    def __init__(self,data,status=200):
        super().__init__(data);self.status=status
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
class FakeOpener:
    def __init__(self):self.calls=[]
    def open(self,req,timeout=10):
        self.calls.append(req)
        if req.get_method()=='GET':return FakeResponse(b'X'*200)
        return FakeResponse(b'',status=200)
class S3Tests(unittest.TestCase):
    def test_invalid_objects_never_requested(self):
        opener=FakeOpener();s3=Storage(ENV,opener)
        for value in ('../secrets', 'staging/abc.mp3', 'http://evil', 'originals/'+OWNER+'/../'+ID):
            with self.assertRaises(ValueError):validate_key(value,'original')
        self.assertEqual(opener.calls,[])
    def test_signing_region_and_endpoint(self):
        opener=FakeOpener()
        instant=lambda:datetime.datetime(2026,11,20,10,15,0,tzinfo=datetime.timezone.utc)
        s3=Storage(ENV,opener,instant)
        with tempfile.TemporaryDirectory() as d:
            result=s3.read(SOURCE,str(Path(d)/'input.bin'))
        self.assertEqual(result['size'],200)
        req=opener.calls[0]
        self.assertIn('/private-bucket-123/originals/',req.full_url)
        self.assertIn('20261120/us-east-va/s3/aws4_request',req.get_header('Authorization'))
        self.assertEqual(req.get_method(),'GET')
    def test_put_rendition_no_r2_or_arbitrary_destination(self):
        opener=FakeOpener();s3=Storage(ENV,opener)
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'mp3.bin';path.write_bytes(b'T'*1024)
            result=s3.put_rendition(RENDITION,str(path))
        self.assertEqual(result['storage_provider'],'ovh-s3')
        self.assertEqual(result['size'],1024)
        self.assertEqual(opener.calls[0].get_method(),'PUT')
        self.assertIn('/renditions/',opener.calls[0].full_url)
    def test_reject_untrusted_s3_endpoint(self):
        with self.assertRaises(RuntimeError):Storage({**ENV,'RINLU_S3_ENDPOINT':'https://evil.test'})
    def test_cover_artwork_is_private_jpeg_only(self):
        opener=FakeOpener();s3=Storage(ENV,opener)
        key='artwork/'+ID+'/normalized.jpg'
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/'normalized.jpg'
            source.write_bytes(b'\xff\xd8\xff'+b'X'*1024)
            uploaded=s3.put_artwork(key,str(source))
        self.assertEqual(uploaded['storage_key'],key)
        self.assertEqual(uploaded['storage_provider'],'ovh-s3')
        self.assertEqual(opener.calls[0].get_header('Content-type'),'image/jpeg')
        with self.assertRaises(ValueError):s3.put_artwork('artwork/../raw.jpg','/dev/null')
    def test_allow_trusted_analysis_rendition(self):
        opener=FakeOpener();s3=Storage(ENV,opener)
        with tempfile.TemporaryDirectory() as d:
            result=s3.read(RENDITION,str(Path(d)/'analysis.bin'),MAX_RENDITION,'rendition')
        self.assertEqual(result['size'],200)
    def test_missing_credentials_fail_closed(self):
        with self.assertRaises(RuntimeError):Storage({**ENV,'RINLU_S3_SECRET_ACCESS_KEY':''})
if __name__=='__main__':unittest.main()

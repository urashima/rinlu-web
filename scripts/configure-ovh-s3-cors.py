#!/usr/bin/env python3
"""Merge RINLU direct-upload CORS into an existing private OVH S3 bucket.
Never grants anonymous access, never changes bucket public ACLs or other rules.
"""
import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
bucket=os.environ["OVH_S3_BUCKET"]
region=os.environ["OVH_S3_REGION"]
endpoint=os.environ["OVH_S3_ENDPOINT"]
assert endpoint=="https://s3."+region+".io.cloud.ovh."+("us" if region.startswith("us-") else "net"), "S3 endpoint mismatch"
s3=boto3.client("s3",region_name=region,endpoint_url=endpoint,
 aws_access_key_id=os.environ["OVH_S3_ACCESS_KEY_ID"],
 aws_secret_access_key=os.environ["OVH_S3_SECRET_ACCESS_KEY"],
 config=Config(signature_version="s3v4",s3={"addressing_style":"path"}))
try:
 existing=s3.get_bucket_cors(Bucket=bucket).get("CORSRules",[])
except ClientError as e:
 code=e.response["Error"]["Code"]
 if code not in ("NoSuchCORSConfiguration","NoSuchCORS","404"):
  raise
 existing=[]
desired={
 "ID":"rinlu-browser-direct-v1",
 "AllowedOrigins":["https://rinlu.com"],
 "AllowedMethods":["GET","HEAD","POST","PUT"],
 "AllowedHeaders":["*"],
 "ExposeHeaders":["ETag","Content-Length","Content-Range","Accept-Ranges"],
 "MaxAgeSeconds":1800,
}
rules=[desired]
for rule in existing:
 if rule.get("ID")=="rinlu-browser-direct-v1" or "https://rinlu.com" in rule.get("AllowedOrigins",[]):
  continue
 rules.append(rule)
if len(rules)>100:
 raise SystemExit("Too many existing S3 CORS rules; manual consolidation needed")
s3.put_bucket_cors(Bucket=bucket,CORSConfiguration={"CORSRules":rules})
actual=s3.get_bucket_cors(Bucket=bucket)["CORSRules"]
assert any(set(x.get("AllowedMethods",[]))>=set(desired["AllowedMethods"]) and "https://rinlu.com" in x.get("AllowedOrigins",[]) for x in actual)
print("OVH S3 private bucket CORS verified for https://rinlu.com; existing other origins preserved.")

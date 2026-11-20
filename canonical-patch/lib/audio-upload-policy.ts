/** Live audio-upload admission policy stored in canonical RINLU D1 settings.
 * Read on EVERY request; revisions are optimistic and writes are audited.
 * Only MP3 is implemented by the current scanner. Other format switches are
 * intentionally locked off until distinct trusted decoders/scanners exist.
 */
import {z} from 'zod';
import {one,q,db,now,fail,json,parse,log,type Row} from './backend';

export const audioFormatKeys=['mp3','wav','m4v','dolby_atmos','lossless'] as const;
const locked=z.object({enabled:z.literal(false)}).strict();
export const formatPolicySchema=z.object({
 mp3:z.object({
  enabled:z.boolean(),
  minKbps:z.number().int().min(32).max(320),
  maxKbps:z.number().int().min(32).max(320),
  allowVbr:z.boolean()
 }).strict(),
 wav:locked,m4v:locked,dolby_atmos:locked,lossless:locked
}).strict();
const envelope=z.object({
 revision:z.number().int().min(1),
 formats:formatPolicySchema,
 updatedAt:z.string().min(1).max(50),
 updatedBy:z.string().min(1).max(100)
}).strict();
export const defaultAudioUploadPolicy={
 revision:0,
 formats:{
  mp3:{enabled:true,minKbps:128,maxKbps:320,allowVbr:true},
  wav:{enabled:false},m4v:{enabled:false},
  dolby_atmos:{enabled:false},lossless:{enabled:false}
 },
 updatedAt:null,updatedBy:null
} as const;
const settingsKey='audio_upload_policy_v1';

export function validateFormatPolicy(value:unknown){
 const parsed=formatPolicySchema.parse(value);
 if(parsed.mp3.maxKbps<parsed.mp3.minKbps)fail(400,'Maximum MP3 bitrate must be >= minimum bitrate.');
 // Independent backend paths only decode MPEG Layer III; do not allow false
 // toggles to bypass quarantine, sound processing or review.
 return parsed;
}
export async function audioUploadPolicy(){
 const row=await one('SELECT value FROM settings WHERE key=?',settingsKey);
 if(!row)return structuredClone(defaultAudioUploadPolicy);
 let obj:unknown;
 try{obj=JSON.parse(row.value)}catch{fail(503,'Stored audio upload policy is malformed.');}
 const result=envelope.safeParse(obj);
 if(!result.success)fail(503,'Stored audio upload policy is invalid. Restore the previous revision.');
 return result.data;
}
export async function publicAudioUploadPolicy(){
 const policy=await audioUploadPolicy();
 return {
  ...policy,
  supportedFormats:['mp3'],
  features:{
   mp3:{kind:'lossy-audio',supportsCbr:true,supportsVbr:true},
   wav:{kind:'pcm-audio',available:false},
   m4v:{kind:'video-container',available:false},
   dolby_atmos:{kind:'immersive-audio',available:false},
   lossless:{kind:'lossless-audio',available:false}
  }
 };
}
export async function audioUploadPolicyAdmin(req:Request,account:Row){
 if(account.role!=='admin')fail(403,'Platform administrator access required.');
 if(req.method==='GET')return json(await publicAudioUploadPolicy());
 if(req.method!=='PUT')fail(405,'Use GET or PUT.');
 const body=await parse(req,z.object({
  expected_revision:z.number().int().min(0),
  formats:formatPolicySchema,
  reason:z.string().trim().min(6).max(300).default('Audio upload format policy updated')
 }).strict());
 const updated=validateFormatPolicy(body.formats);
 const previous=await one('SELECT value FROM settings WHERE key=?',settingsKey);
 let rev=0;
 if(previous){
  let record:unknown;
  try{record=JSON.parse(previous.value)}catch{fail(503,'Stored audio upload policy is malformed.');}
  const parsed=envelope.safeParse(record);
  if(!parsed.success)fail(503,'Stored audio upload policy is invalid.');
  rev=parsed.data!.revision;
 }
 if(rev!==body.expected_revision)fail(409,'Audio upload policy was updated by another administrator. Reload to continue.');
 const next={
  revision:rev+1,formats:updated,updatedAt:now(),updatedBy:account.id
 };
 const serialized=JSON.stringify(next);
 const sql=previous
  ?q('UPDATE settings SET value=? WHERE key=? AND value=?',serialized,settingsKey,previous.value)
  :q('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)',settingsKey,serialized);
 const results=await db().batch([
  sql,
  q("INSERT INTO audit SELECT ?,?,'audio_upload.policy_updated','platform',?,? WHERE changes()=1 AND (SELECT value FROM settings WHERE key=?)=?",
    crypto.randomUUID(),account.id,JSON.stringify({
      previous_revision:rev,revision:rev+1,
      formats:updated,reason:body.reason
    }),now(),settingsKey,serialized)
 ]);
 if(!results[0].meta.changes)fail(409,'Audio upload policy changed. Reload and try again.');
 return json({...next,supportedFormats:['mp3'],features:(await publicAudioUploadPolicy()).features});
}

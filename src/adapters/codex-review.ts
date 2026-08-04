import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalJson, validateReviewRequest, validateReviewResult } from "../evidence/schema.js";
import type { ReviewFinding, ReviewRequest } from "../evidence/types.js";
import { ReviewError } from "../review/errors.js";
import type { EphemeralProcessRunner, IndependentReviewAdapter, ProcessRun, ReviewDispatch } from "../review/types.js";

const LIMIT=1_000_000,MAX_REVIEW_TIMEOUT_MS=120_000,TEARDOWN_TIMEOUT_MS=2_000;
export type CodexReviewConfig=Readonly<{executable:string;runtimePath:string;codeHome:string;model:string;profile:string;timeoutMs?:number}>;
type ReviewClock=Readonly<{now():Date}>;

export const nodeEphemeralProcessRunner:EphemeralProcessRunner={run(input){return new Promise((resolve,reject)=>{
  let child:ChildProcessWithoutNullStreams;try{child=spawn(input.executable,[...input.args],{cwd:input.cwd,env:input.env,stdio:["pipe","pipe","pipe"],detached:process.platform!=="win32"});}catch{return reject(new Error("spawn-failed"));}
  let stdout="",stderr="",stdoutBytes=0,stderrBytes=0,timedOut=false,oversize=false,stdinFailed=false,terminating=false,settled=false,teardownTimer:NodeJS.Timeout|undefined;
  const clear=()=>{clearTimeout(runtimeTimer);if(teardownTimer)clearTimeout(teardownTimer);};
  const result=(exitCode:number|undefined,teardownComplete:boolean):ProcessRun=>({stdout,stderr,processId:child.pid??0,sessionId:input.env.SHIPYARD_REVIEW_SESSION??"",exitCode,timedOut,oversize,teardownComplete,...(stdinFailed?{stdinFailed:true}:{})});
  const finish=(value:ProcessRun)=>{if(settled)return;settled=true;clear();resolve(value);};
  const terminate=()=>{if(terminating)return;terminating=true;killTree(child);teardownTimer=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();child.unref();finish(result(undefined,false));},TEARDOWN_TIMEOUT_MS);};
  const add=(which:"stdout"|"stderr",chunk:Buffer)=>{const bytes=chunk.byteLength;if(which==="stdout"){stdoutBytes+=bytes;if(stdoutBytes>LIMIT){oversize=true;terminate();return;}stdout+=chunk.toString("utf8");}else{stderrBytes+=bytes;if(stderrBytes>LIMIT){oversize=true;terminate();return;}stderr+=chunk.toString("utf8");}};
  const runtimeTimer=setTimeout(()=>{timedOut=true;terminate();},input.timeoutMs);
  child.stdout.on("data",chunk=>add("stdout",chunk));child.stderr.on("data",chunk=>add("stderr",chunk));
  child.on("error",()=>{if(child.pid){stdinFailed=true;terminate();}else{if(!settled){settled=true;clear();reject(new Error("process-failed"));}}});
  child.on("close",code=>{void (async()=>{killTree(child);const complete=await waitForGroupExit(child.pid,TEARDOWN_TIMEOUT_MS);finish(result(code??undefined,complete));})();});
  child.stdin.on("error",()=>{stdinFailed=true;terminate();});
  try{child.stdin.end(input.stdin);}catch{stdinFailed=true;terminate();}
});}};

const outputSchema={
  type:"object",additionalProperties:false,required:["findings","successful"],
  properties:{
    successful:{type:"boolean"},
    findings:{type:"array",items:{
      type:"object",additionalProperties:false,required:["id","severity","disposition","evidenceRefs"],
      properties:{id:{type:"string"},severity:{enum:["critical","high","medium","low"]},disposition:{enum:["accepted","rejected","informational","resolved"]},evidenceRefs:{type:"array",minItems:1,items:{type:"string"}}},
    }},
  },
} as const;

export class CodexReviewAdapter implements IndependentReviewAdapter{
  private readonly config:CodexReviewConfig;
  constructor(rawConfig:CodexReviewConfig,private readonly runner:EphemeralProcessRunner=nodeEphemeralProcessRunner,private readonly clock:ReviewClock=Object.freeze({now:()=>new Date()})){
    try{this.config=JSON.parse(canonicalJson(rawConfig));}catch{throw new ReviewError("review-process-failed","Codex review configuration is invalid.");}
    const keys=Object.keys(this.config).sort().join(",");if(keys!=="codeHome,executable,model,profile,runtimePath"&&keys!=="codeHome,executable,model,profile,runtimePath,timeoutMs")throw new ReviewError("review-process-failed","Codex review configuration is invalid.");
    for(const key of ["executable","runtimePath","codeHome","model","profile"] as const)if(typeof this.config[key]!=="string"||this.config[key].trim()===""||this.config[key].length>4096)throw new ReviewError("review-process-failed","Codex review configuration is invalid.");
    if(!isAbsolute(this.config.executable)||!isAbsolute(this.config.codeHome)||this.config.codeHome==="/"||this.config.runtimePath.split(":").some(path=>!isAbsolute(path))||this.config.timeoutMs!==undefined&&(!Number.isSafeInteger(this.config.timeoutMs)||this.config.timeoutMs<=0||this.config.timeoutMs>MAX_REVIEW_TIMEOUT_MS))throw new ReviewError("review-process-failed","Codex executable, runtime, isolated home, or timeout is invalid.");
  }
  async review(rawDispatch:ReviewDispatch,rawRequest:ReviewRequest){
    let dispatch:ReviewDispatch,request:ReviewRequest;try{dispatch=JSON.parse(canonicalJson(rawDispatch));request=validateReviewRequest(rawRequest);}catch{throw new ReviewError("review-role-mismatch","Codex accepts one sealed trusted reviewer dispatch.");}
    const requestParts=dispatch.reviewRequestPath.split("/");if(dispatch.host!=="codex"||dispatch.role!=="reviewer"||request.reviewerEnvelopePath!==dispatch.reviewerEnvelopePath||!isAbsolute(dispatch.repoRoot)||dispatch.reviewRequestPath.length>4096||dispatch.reviewerEnvelopePath.length>4096||dispatch.repoRoot.length>4096||isAbsolute(dispatch.reviewRequestPath)||dispatch.reviewRequestPath.includes("\\")||requestParts.some(part=>part===""||part==="."||part==="..")||!/^deliveries\/[A-Za-z0-9][A-Za-z0-9-]*\/evidence\/review-request-[A-Za-z0-9-]+\.json$/.test(dispatch.reviewRequestPath))throw new ReviewError("review-role-mismatch","Codex accepts one sealed trusted reviewer dispatch.");
    if(this.runner===nodeEphemeralProcessRunner){try{if(!(await stat(this.config.executable)).isFile()||!(await stat(this.config.codeHome)).isDirectory())throw new Error();}catch{throw new ReviewError("review-process-failed","Codex executable or isolated home is unavailable.");}}
    const sessionId=randomUUID(),dir=await mkdtemp(join(tmpdir(),"shipyard-review-"));let cleanupSafe=true;
    try{
      await chmod(dir,0o700);const resultPath=join(dir,"result.json"),schemaPath=join(dir,"result.schema.json"),bundlePath=join(dir,"review-bundle.json"),bundleDigest=createHash("sha256").update(dispatch.sealedBundle).digest("hex"),env={PATH:this.config.runtimePath,CODEX_HOME:this.config.codeHome,SHIPYARD_REVIEW_SESSION:sessionId,SHIPYARD_REVIEW_SESSION_DIR:dir};
      await writeFile(bundlePath,dispatch.sealedBundle,{flag:"wx",mode:0o600});await writeFile(schemaPath,JSON.stringify(outputSchema),{flag:"wx",mode:0o600});await writeFile(resultPath,"",{flag:"wx",mode:0o600});
      let versionRun:ProcessRun;try{versionRun=await this.runner.run({executable:this.config.executable,args:["--version"],env,stdin:"",cwd:dispatch.repoRoot,timeoutMs:5_000});}catch{throw new ReviewError("review-process-failed","Codex version probe failed.");}
      if(versionRun.teardownComplete===false)cleanupSafe=false;const commandVersion=versionRun.stdout.trim();if(versionRun.exitCode!==0||versionRun.timedOut||versionRun.oversize||versionRun.stdinFailed||versionRun.teardownComplete===false||!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/.test(commandVersion))throw new ReviewError("review-process-failed","Codex version probe failed.");
      const args=["exec","--ephemeral","--ignore-user-config","--ignore-rules","--sandbox","read-only","-C",dispatch.repoRoot,"--model",this.config.model,"--profile",this.config.profile,"--output-schema",schemaPath,"-o",resultPath,"-"],stdin=`Review only the sealed Shipyard bundle at ${bundlePath}. Return only the required review result.`,startedAt=observedTime(this.clock);
      let run:ProcessRun;try{run=await this.runner.run({executable:this.config.executable,args,env,stdin,cwd:dispatch.repoRoot,timeoutMs:this.config.timeoutMs??30_000});}catch{throw new ReviewError("review-process-failed","Independent reviewer could not be started.");}
      const finishedAt=observedTime(this.clock);if(Date.parse(finishedAt)<Date.parse(startedAt))throw new ReviewError("review-process-failed","Trusted review clock moved backwards.");if(run.teardownComplete===false)cleanupSafe=false;
      if(run.teardownComplete===false||run.stdinFailed)throw new ReviewError("review-process-failed","Independent reviewer process teardown could not be proven.");if(run.oversize)throw new ReviewError("review-process-failed","Independent reviewer exceeded output bounds.");if(run.timedOut)throw new ReviewError("review-process-timeout","Independent reviewer exceeded its runtime bound.");if(run.exitCode!==0)throw new ReviewError("review-process-failed","Independent reviewer exited unsuccessfully.");if(run.reused||!run.processId||!run.sessionId)throw new ReviewError("review-process-reused","Reviewer process must be new.");
      let rawResult:unknown;try{const bytes=await readFile(resultPath);if(bytes.byteLength>LIMIT)throw new Error();rawResult=JSON.parse(bytes.toString("utf8"));}catch{throw new ReviewError("review-invalid-result","Reviewer result is missing, oversized, or malformed.");}
      const model=modelResult(rawResult),findings=model.findings.map(finding=>({...finding,recordedAt:finishedAt} as ReviewFinding)),result=validateReviewResult({schemaVersion:1,reviewId:request.reviewId,productSha:request.productSha,reviewer:"codex",startedAt,finishedAt,process:{processId:run.processId,sessionId:run.sessionId,fresh:true,commandVersion,bundleDigest},findings,successful:model.successful});
      return Object.freeze({result,attestation:Object.freeze({...result.process})});
    }finally{if(cleanupSafe)await rm(dir,{recursive:true,force:true}).catch(()=>{throw new ReviewError("review-process-failed","Reviewer temporary state cleanup failed.");});}
  }
}

function modelResult(value:unknown):Readonly<{findings:readonly Omit<ReviewFinding,"recordedAt">[];successful:boolean}>{let input:any;try{input=JSON.parse(canonicalJson(value));}catch{throw new ReviewError("review-invalid-result","Reviewer result is invalid.");}if(!input||typeof input!=="object"||Object.keys(input).sort().join(",")!=="findings,successful"||typeof input.successful!=="boolean"||!Array.isArray(input.findings))throw new ReviewError("review-invalid-result","Reviewer result is invalid.");for(const finding of input.findings)if(!finding||typeof finding!=="object"||Object.keys(finding).sort().join(",")!=="disposition,evidenceRefs,id,severity"||typeof finding.id!=="string"||finding.id.trim()===""||!["critical","high","medium","low"].includes(finding.severity)||!["accepted","rejected","informational","resolved"].includes(finding.disposition)||!Array.isArray(finding.evidenceRefs)||finding.evidenceRefs.length===0||finding.evidenceRefs.some((ref:unknown)=>typeof ref!=="string"))throw new ReviewError("review-invalid-result","Reviewer result is invalid.");return Object.freeze(input);}
function observedTime(clock:ReviewClock):string{let value:Date;try{value=clock.now();}catch{throw new ReviewError("review-process-failed","Trusted review clock is unavailable.");}if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new ReviewError("review-process-failed","Trusted review clock is unavailable.");return value.toISOString();}
function killTree(child:ChildProcessWithoutNullStreams):void{if(!child.pid)return;try{if(process.platform==="win32")child.kill("SIGKILL");else process.kill(-child.pid,"SIGKILL");}catch(error:unknown){if((error as NodeJS.ErrnoException).code!=="ESRCH")try{child.kill("SIGKILL");}catch{}}}
async function waitForGroupExit(pid:number|undefined,timeoutMs:number):Promise<boolean>{if(!pid||process.platform==="win32")return true;const deadline=Date.now()+timeoutMs;for(;;){try{process.kill(-pid,0);}catch(error:unknown){if((error as NodeJS.ErrnoException).code==="ESRCH")return true;}if(Date.now()>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,10));}}

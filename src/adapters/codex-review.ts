import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalJson, validateReviewRequest, validateReviewResult } from "../evidence/schema.js";
import type { ReviewFinding, ReviewRequest } from "../evidence/types.js";
import { ReviewError } from "../review/errors.js";
import type { EphemeralProcessRunner, IndependentReviewAdapter, ProcessRun, ReviewDispatch } from "../review/types.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { MAX_REVIEW_BUNDLE_BYTES, utf8Bytes } from "../evidence/limits.js";

const LIMIT=1_000_000,MAX_REVIEW_TIMEOUT_MS=120_000,TEARDOWN_TIMEOUT_MS=2_000,SNAPSHOT_GIT_MAX_TIMEOUT_MS=30_000,SNAPSHOT_GIT_MAX_OUTPUT_BYTES=100_000;
export type CodexReviewConfig=Readonly<{executable:string;runtimePath:string;codeHome:string;model:string;profile:string;timeoutMs?:number;gitExecutable?:string}>;
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
  private readonly gitExecutable:string;
  constructor(rawConfig:CodexReviewConfig,private readonly runner:EphemeralProcessRunner=nodeEphemeralProcessRunner,private readonly clock:ReviewClock=Object.freeze({now:()=>new Date()})){
    try{this.config=JSON.parse(canonicalJson(rawConfig));}catch{throw new ReviewError("review-process-failed","Codex review configuration is invalid.");}
    const keys=Object.keys(this.config).sort().join(",");if(!["codeHome,executable,model,profile,runtimePath","codeHome,executable,gitExecutable,model,profile,runtimePath","codeHome,executable,model,profile,runtimePath,timeoutMs","codeHome,executable,gitExecutable,model,profile,runtimePath,timeoutMs"].includes(keys))throw new ReviewError("review-process-failed","Codex review configuration is invalid.");
    for(const key of ["executable","runtimePath","codeHome","model","profile"] as const)if(typeof this.config[key]!=="string"||this.config[key].trim()===""||this.config[key].length>4096)throw new ReviewError("review-process-failed","Codex review configuration is invalid.");
    if(!isAbsolute(this.config.executable)||!isAbsolute(this.config.codeHome)||this.config.codeHome==="/"||this.config.runtimePath.split(":").some(path=>!isAbsolute(path))||this.config.timeoutMs!==undefined&&(!Number.isSafeInteger(this.config.timeoutMs)||this.config.timeoutMs<=0||this.config.timeoutMs>MAX_REVIEW_TIMEOUT_MS))throw new ReviewError("review-process-failed","Codex executable, runtime, isolated home, or timeout is invalid.");
    try{this.gitExecutable=canonicalGitExecutable(this.config.gitExecutable??DEFAULT_NODE_GIT_EXECUTABLE);}catch{throw new ReviewError("review-process-failed","Trusted Git executable is unavailable.");}
  }
  async review(rawDispatch:ReviewDispatch,rawRequest:ReviewRequest){
    let dispatch:ReviewDispatch,request:ReviewRequest;try{dispatch=JSON.parse(canonicalJson(rawDispatch));request=validateReviewRequest(rawRequest);}catch{throw new ReviewError("review-role-mismatch","Codex accepts one sealed trusted reviewer dispatch.");}
    const requestParts=dispatch.reviewRequestPath.split("/");if(dispatch.host!=="codex"||dispatch.role!=="reviewer"||request.reviewerEnvelopePath!==dispatch.reviewerEnvelopePath||!isAbsolute(dispatch.repoRoot)||dispatch.reviewRequestPath.length>4096||dispatch.reviewerEnvelopePath.length>4096||dispatch.repoRoot.length>4096||utf8Bytes(dispatch.sealedBundle)>MAX_REVIEW_BUNDLE_BYTES||isAbsolute(dispatch.reviewRequestPath)||dispatch.reviewRequestPath.includes("\\")||requestParts.some(part=>part===""||part==="."||part==="..")||!/^deliveries\/[A-Za-z0-9][A-Za-z0-9-]*\/evidence\/review-request-[A-Za-z0-9-]+\.json$/.test(dispatch.reviewRequestPath))throw new ReviewError("review-role-mismatch","Codex accepts one sealed trusted reviewer dispatch.");
    if(this.runner===nodeEphemeralProcessRunner){try{if(!(await stat(this.config.executable)).isFile()||!(await stat(this.config.codeHome)).isDirectory())throw new Error();}catch{throw new ReviewError("review-process-failed","Codex executable or isolated home is unavailable.");}}
    const sessionId=randomUUID(),dir=await mkdtemp(join(tmpdir(),"shipyard-review-"));let cleanupSafe=true,snapshot:ExactReviewSnapshot|undefined;
    const failSnapshot=(error:unknown):never=>{const failure=exactSnapshotError(error);if(!failure.cleanupSafe)cleanupSafe=false;throw failure;};
    const verifySnapshot=async()=>{try{await snapshot?.verify();}catch(error){failSnapshot(error);}};
    try{
      await chmod(dir,0o700);if(this.runner===nodeEphemeralProcessRunner)try{snapshot=await createExactReviewSnapshot(this.gitExecutable,dispatch.repoRoot,request.productSha,dir,Math.min(this.config.timeoutMs??SNAPSHOT_GIT_MAX_TIMEOUT_MS,SNAPSHOT_GIT_MAX_TIMEOUT_MS));}catch(error){failSnapshot(error);}const reviewRoot=snapshot?.path??dispatch.repoRoot;await verifySnapshot();const resultPath=join(dir,"result.json"),schemaPath=join(dir,"result.schema.json"),bundlePath=join(dir,"review-bundle.json"),bundleDigest=createHash("sha256").update(dispatch.sealedBundle).digest("hex"),env={PATH:this.config.runtimePath,CODEX_HOME:this.config.codeHome,SHIPYARD_REVIEW_SESSION:sessionId,SHIPYARD_REVIEW_SESSION_DIR:dir};
      await writeFile(bundlePath,dispatch.sealedBundle,{flag:"wx",mode:0o600});await writeFile(schemaPath,JSON.stringify(outputSchema),{flag:"wx",mode:0o600});await writeFile(resultPath,"",{flag:"wx",mode:0o600});
      let versionRun:ProcessRun;try{versionRun=await this.runner.run({executable:this.config.executable,args:["--version"],env,stdin:"",cwd:reviewRoot,timeoutMs:5_000});}catch{throw new ReviewError("review-process-failed","Codex version probe failed.");}
      if(versionRun.teardownComplete===false)cleanupSafe=false;const commandVersion=versionRun.stdout.trim();if(versionRun.exitCode!==0||versionRun.timedOut||versionRun.oversize||versionRun.stdinFailed||versionRun.teardownComplete===false||!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/.test(commandVersion))throw new ReviewError("review-process-failed","Codex version probe failed.");
      const args=["exec","--ephemeral","--ignore-user-config","--ignore-rules","--sandbox","read-only","-C",reviewRoot,"--model",this.config.model,"--profile",this.config.profile,"--output-schema",schemaPath,"-o",resultPath,"-"],stdin=`Review only product SHA ${request.productSha} in the immutable snapshot at ${reviewRoot} and the sealed Shipyard bundle at ${bundlePath}. Do not inspect the mutable source worktree. Return only the required review result.`,startedAt=observedTime(this.clock);
      let run:ProcessRun;try{run=await this.runner.run({executable:this.config.executable,args,env,stdin,cwd:reviewRoot,timeoutMs:this.config.timeoutMs??30_000});}catch{throw new ReviewError("review-process-failed","Independent reviewer could not be started.");}
      const finishedAt=observedTime(this.clock);if(Date.parse(finishedAt)<Date.parse(startedAt))throw new ReviewError("review-process-failed","Trusted review clock moved backwards.");if(run.teardownComplete===false)cleanupSafe=false;
      if(run.teardownComplete===false||run.stdinFailed)throw new ReviewError("review-process-failed","Independent reviewer process teardown could not be proven.");if(run.oversize)throw new ReviewError("review-process-failed","Independent reviewer exceeded output bounds.");if(run.timedOut)throw new ReviewError("review-process-timeout","Independent reviewer exceeded its runtime bound.");if(run.exitCode!==0)throw new ReviewError("review-process-failed","Independent reviewer exited unsuccessfully.");if(run.reused||!run.processId||!run.sessionId)throw new ReviewError("review-process-reused","Reviewer process must be new.");await verifySnapshot();
      let rawResult:unknown;try{const bytes=await readFile(resultPath);if(bytes.byteLength>LIMIT)throw new Error();rawResult=JSON.parse(bytes.toString("utf8"));}catch{throw new ReviewError("review-invalid-result","Reviewer result is missing, oversized, or malformed.");}
      const model=modelResult(rawResult),findings=model.findings.map(finding=>({...finding,recordedAt:finishedAt} as ReviewFinding)),result=validateReviewResult({schemaVersion:1,reviewId:request.reviewId,productSha:request.productSha,reviewer:"codex",startedAt,finishedAt,process:{processId:run.processId,sessionId:run.sessionId,fresh:true,commandVersion,bundleDigest},findings,successful:model.successful});
      return Object.freeze({result,attestation:Object.freeze({...result.process})});
    }finally{if(cleanupSafe)try{if(snapshot)await unlockTree(snapshot.path);await rm(dir,{recursive:true,force:true});}catch{throw new ReviewError("review-process-failed","Reviewer temporary state cleanup failed.");}}
  }
}

function modelResult(value:unknown):Readonly<{findings:readonly Omit<ReviewFinding,"recordedAt">[];successful:boolean}>{let input:any;try{input=JSON.parse(canonicalJson(value));}catch{throw new ReviewError("review-invalid-result","Reviewer result is invalid.");}if(!input||typeof input!=="object"||Object.keys(input).sort().join(",")!=="findings,successful"||typeof input.successful!=="boolean"||!Array.isArray(input.findings))throw new ReviewError("review-invalid-result","Reviewer result is invalid.");for(const finding of input.findings)if(!finding||typeof finding!=="object"||Object.keys(finding).sort().join(",")!=="disposition,evidenceRefs,id,severity"||typeof finding.id!=="string"||finding.id.trim()===""||!["critical","high","medium","low"].includes(finding.severity)||!["accepted","rejected","informational","resolved"].includes(finding.disposition)||!Array.isArray(finding.evidenceRefs)||finding.evidenceRefs.length===0||finding.evidenceRefs.some((ref:unknown)=>typeof ref!=="string"))throw new ReviewError("review-invalid-result","Reviewer result is invalid.");return Object.freeze(input);}
function observedTime(clock:ReviewClock):string{let value:Date;try{value=clock.now();}catch{throw new ReviewError("review-process-failed","Trusted review clock is unavailable.");}if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new ReviewError("review-process-failed","Trusted review clock is unavailable.");return value.toISOString();}
function killTree(child:ChildProcessWithoutNullStreams):void{if(!child.pid)return;try{if(process.platform==="win32")child.kill("SIGKILL");else process.kill(-child.pid,"SIGKILL");}catch(error:unknown){if((error as NodeJS.ErrnoException).code!=="ESRCH")try{child.kill("SIGKILL");}catch{}}}
async function waitForGroupExit(pid:number|undefined,timeoutMs:number):Promise<boolean>{if(!pid||process.platform==="win32")return true;const deadline=Date.now()+timeoutMs;for(;;){try{process.kill(-pid,0);}catch(error:unknown){if((error as NodeJS.ErrnoException).code==="ESRCH")return true;}if(Date.now()>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,10));}}
type ExactReviewSnapshot=Readonly<{path:string;verify():Promise<void>}>;
class SnapshotGitError extends Error{constructor(readonly teardownComplete:boolean){super("snapshot-git-failed");}}
class ExactSnapshotError extends ReviewError{constructor(readonly cleanupSafe:boolean){super("review-process-failed","Exact product snapshot could not be created or verified.");}}
function exactSnapshotError(error:unknown):ExactSnapshotError{if(error instanceof ExactSnapshotError)return error;return new ExactSnapshotError(!(error instanceof SnapshotGitError)||error.teardownComplete);}
async function createExactReviewSnapshot(gitExecutable:string,repoRoot:string,productSha:string,sessionDirectory:string,timeoutMs:number):Promise<ExactReviewSnapshot>{const path=join(sessionDirectory,"product-snapshot"),run=(args:readonly string[])=>git(gitExecutable,args,timeoutMs);try{const sourceCommit=await run(["-C",repoRoot,"rev-parse","--verify",`${productSha}^{commit}`]),tree=await run(["-C",repoRoot,"rev-parse","--verify",`${productSha}^{tree}`]);if(sourceCommit!==productSha||!fullSha(tree))throw new Error();await run(["-c","core.hooksPath=/dev/null","clone","--quiet","--no-checkout","--no-hardlinks","--local","--",repoRoot,path]);await run(["-C",path,"-c","core.hooksPath=/dev/null","checkout","--quiet","--detach","--force",productSha]);const verify=async()=>{const head=await run(["-C",path,"rev-parse","--verify","HEAD"]),currentTree=await run(["-C",path,"rev-parse","--verify","HEAD^{tree}"]),status=await run(["-C",path,"status","--porcelain=v1","--untracked-files=all"]),sourceTree=await run(["-C",repoRoot,"rev-parse","--verify",`${productSha}^{tree}`]);if(head!==productSha||currentTree!==tree||sourceTree!==tree||status!=="")throw new Error();};await verify();await lockTree(path);return Object.freeze({path,verify});}catch(error){const failure=exactSnapshotError(error);if(failure.cleanupSafe){await unlockTree(path).catch(()=>undefined);await rm(path,{recursive:true,force:true}).catch(()=>undefined);}throw failure;}}
async function git(executable:string,args:readonly string[],timeoutMs:number):Promise<string>{return new Promise((resolve,reject)=>{
  let child:ChildProcessWithoutNullStreams;try{child=spawn(executable,[...args],{env:sanitizedGitEnvironment({GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"}),stdio:["pipe","pipe","pipe"],detached:process.platform!=="win32"});}catch{return reject(new SnapshotGitError(true));}
  let stdout="",outputBytes=0,failed=false,settled=false,teardownTimer:NodeJS.Timeout|undefined;
  const finish=(value?:string,teardownComplete=true)=>{if(settled)return;settled=true;clearTimeout(runtimeTimer);if(teardownTimer)clearTimeout(teardownTimer);value===undefined?reject(new SnapshotGitError(teardownComplete)):resolve(value);};
  const terminate=()=>{if(failed)return;failed=true;killTree(child);teardownTimer=setTimeout(()=>{child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();finish(undefined,false);},TEARDOWN_TIMEOUT_MS);};
  const add=(target:"stdout"|"stderr",chunk:Buffer)=>{if(failed)return;outputBytes+=chunk.byteLength;if(outputBytes>SNAPSHOT_GIT_MAX_OUTPUT_BYTES){terminate();return;}if(target==="stdout")stdout+=chunk.toString("utf8");};
  const runtimeTimer=setTimeout(terminate,timeoutMs);
  child.stdout.on("data",chunk=>add("stdout",chunk));child.stderr.on("data",chunk=>add("stderr",chunk));
  child.once("error",()=>{if(child.pid)terminate();else finish(undefined,true);});
  child.once("close",code=>{void(async()=>{clearTimeout(runtimeTimer);if(teardownTimer){clearTimeout(teardownTimer);teardownTimer=undefined;}killTree(child);const teardownComplete=await waitForGroupExit(child.pid,TEARDOWN_TIMEOUT_MS);if(!teardownComplete)finish(undefined,false);else if(failed||code!==0)finish(undefined,true);else finish(stdout.trim());})();});
  child.stdin.once("error",terminate);try{child.stdin.end();}catch{terminate();}
});}
async function lockTree(path:string):Promise<void>{const entries=await readdir(path,{withFileTypes:true});for(const entry of entries){const child=join(path,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())await lockTree(child);else if(entry.isFile()){const mode=(await lstat(child)).mode;await chmod(child,mode&0o111?0o500:0o400);}}await chmod(path,0o500);}
async function unlockTree(path:string):Promise<void>{let info;try{info=await lstat(path);}catch{return;}if(info.isSymbolicLink())return;if(info.isDirectory()){await chmod(path,0o700);for(const entry of await readdir(path,{withFileTypes:true}))await unlockTree(join(path,entry.name));}else await chmod(path,0o600);}
function fullSha(value:string):boolean{return /^[a-f0-9]{40}$/.test(value)||/^[a-f0-9]{64}$/.test(value);}

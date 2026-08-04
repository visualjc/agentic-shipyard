import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalJson, validateReviewRequest, validateReviewResult } from "../evidence/schema.js";
import type { ReviewFinding, ReviewRequest } from "../evidence/types.js";
import { ReviewError } from "../review/errors.js";
import type { EphemeralProcessRunner, IndependentReviewAdapter, ProcessRun, ReviewDispatch } from "../review/types.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { MAX_REVIEW_BUNDLE_BYTES, utf8Bytes } from "../evidence/limits.js";
import { promisify } from "node:util";

const LIMIT=1_000_000,MAX_REVIEW_TIMEOUT_MS=120_000,TEARDOWN_TIMEOUT_MS=2_000;
const execFileAsync=promisify(execFile);
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
    try{
      await chmod(dir,0o700);if(this.runner===nodeEphemeralProcessRunner)snapshot=await createExactReviewSnapshot(this.gitExecutable,dispatch.repoRoot,request.productSha,dir);const reviewRoot=snapshot?.path??dispatch.repoRoot;await snapshot?.verify();const resultPath=join(dir,"result.json"),schemaPath=join(dir,"result.schema.json"),bundlePath=join(dir,"review-bundle.json"),bundleDigest=createHash("sha256").update(dispatch.sealedBundle).digest("hex"),env={PATH:this.config.runtimePath,CODEX_HOME:this.config.codeHome,SHIPYARD_REVIEW_SESSION:sessionId,SHIPYARD_REVIEW_SESSION_DIR:dir};
      await writeFile(bundlePath,dispatch.sealedBundle,{flag:"wx",mode:0o600});await writeFile(schemaPath,JSON.stringify(outputSchema),{flag:"wx",mode:0o600});await writeFile(resultPath,"",{flag:"wx",mode:0o600});
      let versionRun:ProcessRun;try{versionRun=await this.runner.run({executable:this.config.executable,args:["--version"],env,stdin:"",cwd:reviewRoot,timeoutMs:5_000});}catch{throw new ReviewError("review-process-failed","Codex version probe failed.");}
      if(versionRun.teardownComplete===false)cleanupSafe=false;const commandVersion=versionRun.stdout.trim();if(versionRun.exitCode!==0||versionRun.timedOut||versionRun.oversize||versionRun.stdinFailed||versionRun.teardownComplete===false||!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/.test(commandVersion))throw new ReviewError("review-process-failed","Codex version probe failed.");
      const args=["exec","--ephemeral","--ignore-user-config","--ignore-rules","--sandbox","read-only","-C",reviewRoot,"--model",this.config.model,"--profile",this.config.profile,"--output-schema",schemaPath,"-o",resultPath,"-"],stdin=`Review only product SHA ${request.productSha} in the immutable snapshot at ${reviewRoot} and the sealed Shipyard bundle at ${bundlePath}. Do not inspect the mutable source worktree. Return only the required review result.`,startedAt=observedTime(this.clock);
      let run:ProcessRun;try{run=await this.runner.run({executable:this.config.executable,args,env,stdin,cwd:reviewRoot,timeoutMs:this.config.timeoutMs??30_000});}catch{throw new ReviewError("review-process-failed","Independent reviewer could not be started.");}
      const finishedAt=observedTime(this.clock);if(Date.parse(finishedAt)<Date.parse(startedAt))throw new ReviewError("review-process-failed","Trusted review clock moved backwards.");if(run.teardownComplete===false)cleanupSafe=false;
      if(run.teardownComplete===false||run.stdinFailed)throw new ReviewError("review-process-failed","Independent reviewer process teardown could not be proven.");if(run.oversize)throw new ReviewError("review-process-failed","Independent reviewer exceeded output bounds.");if(run.timedOut)throw new ReviewError("review-process-timeout","Independent reviewer exceeded its runtime bound.");if(run.exitCode!==0)throw new ReviewError("review-process-failed","Independent reviewer exited unsuccessfully.");if(run.reused||!run.processId||!run.sessionId)throw new ReviewError("review-process-reused","Reviewer process must be new.");await snapshot?.verify();
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
async function createExactReviewSnapshot(gitExecutable:string,repoRoot:string,productSha:string,sessionDirectory:string):Promise<ExactReviewSnapshot>{const path=join(sessionDirectory,"product-snapshot");try{const sourceCommit=await git(gitExecutable,["-C",repoRoot,"rev-parse","--verify",`${productSha}^{commit}`]),tree=await git(gitExecutable,["-C",repoRoot,"rev-parse","--verify",`${productSha}^{tree}`]);if(sourceCommit!==productSha||!fullSha(tree))throw new Error();await git(gitExecutable,["-c","core.hooksPath=/dev/null","clone","--no-checkout","--no-hardlinks","--local","--",repoRoot,path]);await git(gitExecutable,["-C",path,"-c","core.hooksPath=/dev/null","checkout","--detach","--force",productSha]);const verify=async()=>{const [head,currentTree,status,sourceTree]=await Promise.all([git(gitExecutable,["-C",path,"rev-parse","--verify","HEAD"]),git(gitExecutable,["-C",path,"rev-parse","--verify","HEAD^{tree}"]),git(gitExecutable,["-C",path,"status","--porcelain=v1","--untracked-files=all"]),git(gitExecutable,["-C",repoRoot,"rev-parse","--verify",`${productSha}^{tree}`])]);if(head!==productSha||currentTree!==tree||sourceTree!==tree||status!=="")throw new Error();};await verify();await lockTree(path);return Object.freeze({path,verify});}catch{await unlockTree(path).catch(()=>undefined);await rm(path,{recursive:true,force:true}).catch(()=>undefined);throw new ReviewError("review-process-failed","Exact product snapshot could not be created or verified.");}}
async function git(executable:string,args:readonly string[]):Promise<string>{try{return (await execFileAsync(executable,[...args],{encoding:"utf8",env:sanitizedGitEnvironment({GIT_OPTIONAL_LOCKS:"0"}),maxBuffer:100_000})).stdout.trim();}catch{throw new Error("git-failed");}}
async function lockTree(path:string):Promise<void>{const entries=await readdir(path,{withFileTypes:true});for(const entry of entries){const child=join(path,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())await lockTree(child);else if(entry.isFile()){const mode=(await lstat(child)).mode;await chmod(child,mode&0o111?0o500:0o400);}}await chmod(path,0o500);}
async function unlockTree(path:string):Promise<void>{let info;try{info=await lstat(path);}catch{return;}if(info.isSymbolicLink())return;if(info.isDirectory()){await chmod(path,0o700);for(const entry of await readdir(path,{withFileTypes:true}))await unlockTree(join(path,entry.name));}else await chmod(path,0o600);}
function fullSha(value:string):boolean{return /^[a-f0-9]{40}$/.test(value)||/^[a-f0-9]{64}$/.test(value);}
